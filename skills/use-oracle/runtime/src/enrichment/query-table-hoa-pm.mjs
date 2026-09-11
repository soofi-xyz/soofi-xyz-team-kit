import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import { toParquetRecord } from "../core/query-table.mjs";
import { resolveHoaAndPropertyManagement, stampPropertyCids } from "./hoa-pm-heuristic.mjs";

const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");
const { PARQUET_COMPRESSION_METHODS } = require(
  "@dsnp/parquetjs/dist/lib/compression.js",
);

// @dsnp/parquetjs supports GZIP and SNAPPY but omits ZSTD even though its
// Parquet metadata parser recognizes that codec. Node 22.18+ provides native
// ZSTD, matching this runtime's minimum Node version.
PARQUET_COMPRESSION_METHODS.ZSTD ??= {
  deflate: (value) => zstdCompressSync(value),
  inflate: (value) => zstdDecompressSync(value),
};

const PARQUET_COMPRESSION_NAMES = {
  0: "UNCOMPRESSED",
  1: "SNAPPY",
  2: "GZIP",
  4: "BROTLI",
  6: "ZSTD",
};

const REQUIRED_COLUMNS = {
  hoa_cid: "UTF8",
  hoa_name: "UTF8",
  hoa_sunbiz_document_number: "UTF8",
  property_manager_cid: "UTF8",
  property_manager_name: "UTF8",
  property_manager_sunbiz_document_number: "UTF8",
  hoa_pm_status: "UTF8",
};

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function withHoaPmSchema(schemaFields, compressionByField, defaultCompression) {
  const output = structuredClone(schemaFields);
  for (const [fieldName, compression] of compressionByField) {
    if (output[fieldName]) output[fieldName].compression = compression;
  }
  for (const [fieldName, fieldType] of Object.entries(REQUIRED_COLUMNS)) {
    if (output[fieldName] && output[fieldName].type !== fieldType) {
      throw new Error(
        `HOA/PM enrichment requires ${fieldName} ${fieldType} column`,
      );
    }
    output[fieldName] = {
      type: fieldType,
      optional: true,
      compression: output[fieldName]?.compression ?? defaultCompression,
    };
  }
  return output;
}

function parquetFieldDefinition(field) {
  if (field.path?.length !== 1 || field.isNested) {
    throw new Error(`HOA/PM enrichment only supports scalar Parquet field ${field.name}`);
  }
  const type = field.originalType === "UTF8" ? "UTF8" : field.primitiveType;
  if (!["BOOLEAN", "BYTE_ARRAY", "DOUBLE", "FLOAT", "INT32", "INT64", "INT96", "UTF8"].includes(type)) {
    throw new Error(`Unsupported Parquet field type for ${field.name}: ${type}`);
  }
  return {
    type,
    optional: field.repetitionType !== "REQUIRED",
  };
}

async function inspectInputParquet(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  try {
    const schemaFields = Object.fromEntries(
      Object.entries(reader.schema.fields).map(([name, field]) => [
        name,
        parquetFieldDefinition(field),
      ]),
    );
    const compressionByField = new Map();
    for (const rowGroup of reader.metadata.row_groups ?? []) {
      for (const column of rowGroup.columns ?? []) {
        const fieldName = column.meta_data?.path_in_schema?.[0];
        const compression = PARQUET_COMPRESSION_NAMES[column.meta_data?.codec];
        if (!fieldName || !compression) continue;
        const previous = compressionByField.get(fieldName);
        if (previous && previous !== compression) {
          throw new Error(
            `HOA/PM enrichment requires one compression codec per field; ${fieldName} uses ${previous} and ${compression}`,
          );
        }
        compressionByField.set(fieldName, compression);
      }
    }
    const codecs = [...new Set(compressionByField.values())];
    const defaultCompression =
      codecs.length === 1 ? codecs[0] : compressionByField.values().next().value ?? "UNCOMPRESSED";
    return { schemaFields, compressionByField, defaultCompression };
  } finally {
    await reader.close();
  }
}

export async function loadSunbizCompanies(sunbizExtractDir) {
  const manifest = JSON.parse(
    await readFile(path.join(sunbizExtractDir, "manifest.json"), "utf8"),
  );
  const companies = [];
  for (const chunk of manifest.chunks ?? []) {
    const chunkPath = path.join(sunbizExtractDir, chunk.relativePath);
    const body = await readFile(chunkPath, "utf8");
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      const entity = record.entity;
      if (!entity?.documentNumber) continue;
      companies.push({
        documentNumber: entity.documentNumber,
        entityName: entity.entityName,
        status: entity.status,
        filedDate: entity.filedDate ?? null,
        principalAddress: entity.principalAddress ?? null,
        registeredAgent: entity.registeredAgent ?? null,
      });
    }
  }
  return companies;
}

async function readQueryRows(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  const rows = [];
  try {
    const cursor = reader.getCursor();
    let row = await cursor.next();
    while (row) {
      rows.push(row);
      row = await cursor.next();
    }
  } finally {
    await reader.close();
  }
  return rows;
}

export async function enrichQueryTableWithHoaPm({
  countyKey,
  schemaFields,
  inputParquet,
  inputCoverage,
  sunbizExtractDir,
  companies = null,
  outputParquet,
  outputCoverage,
  objectsDir,
  manifestPath,
}) {
  const input = await inspectInputParquet(inputParquet);
  const outputSchemaFields = withHoaPmSchema(
    schemaFields ?? input.schemaFields,
    input.compressionByField,
    input.defaultCompression,
  );
  const sunbizCompanies =
    companies ?? (await loadSunbizCompanies(sunbizExtractDir));
  const rows = await readQueryRows(inputParquet);
  const objects = [];
  const stamped = [];
  const statusCounts = {};
  const resolutionBySubdivision = new Map();
  for (const row of rows) {
    const cacheKey = `${row.subdivision ?? ""}`;
    let resolution = resolutionBySubdivision.get(cacheKey);
    if (!resolution) {
      resolution = resolveHoaAndPropertyManagement({
        subdivision: row.subdivision,
        companies: sunbizCompanies,
        countyKey,
      });
      resolutionBySubdivision.set(cacheKey, resolution);
    }
    statusCounts[resolution.status] = (statusCounts[resolution.status] ?? 0) + 1;
    if (resolution.hoa) objects.push(resolution.hoa);
    if (resolution.hoaCompany) objects.push(resolution.hoaCompany);
    if (resolution.propertyManagement) objects.push(resolution.propertyManagement);
    stamped.push(stampPropertyCids(row, resolution));
  }

  await mkdir(path.dirname(outputParquet), { recursive: true });
  if (objectsDir) await mkdir(objectsDir, { recursive: true });
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(outputSchemaFields),
    outputParquet,
  );
  try {
    for (const row of stamped) await writer.appendRow(toParquetRecord(row));
  } finally {
    await writer.close();
  }

  if (objectsDir) {
    await writeFile(
      path.join(objectsDir, "hoa-pm-objects.jsonl"),
      `${objects.map((object) => JSON.stringify(object)).join("\n")}${objects.length ? "\n" : ""}`,
    );
  }

  const coverage = JSON.parse(await readFile(inputCoverage, "utf8"));
  const hoaPmDataset = {
    county: countyKey,
    source: "hoa_pm",
    ingested_count: objects.length,
    expected_count: rows.length,
    matched_hoa_count: stamped.filter((row) => row.hoa_cid).length,
    matched_pm_count: stamped.filter((row) => row.property_manager_cid).length,
    status_counts: statusCounts,
  };
  const nextCoverage = {
    ...coverage,
    datasets: [
      ...(coverage.datasets ?? []).filter((dataset) => dataset?.source !== "hoa_pm"),
      hoaPmDataset,
    ],
  };
  await writeFile(outputCoverage, `${JSON.stringify(nextCoverage, null, 2)}\n`);

  const manifest = {
    schemaVersion: "elephant.hoa-pm-query-table-enrichment.v1",
    county: countyKey,
    inputParquetSha256: await sha256File(inputParquet),
    outputParquetSha256: await sha256File(outputParquet),
    propertyCount: rows.length,
    objectCount: objects.length,
    statusCounts,
  };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function restampHoaPmQueryTable({
  inputParquet,
  outputParquet,
  publishedCidByLocalCid,
}) {
  const input = await inspectInputParquet(inputParquet);
  const rows = await readQueryRows(inputParquet);
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(
      withHoaPmSchema(
        input.schemaFields,
        input.compressionByField,
        input.defaultCompression,
      ),
    ),
    outputParquet,
  );
  let hoaCidCount = 0;
  let propertyManagerCidCount = 0;
  try {
    for (const row of rows) {
      const restamped = { ...row };
      for (const [field, counter] of [
        ["hoa_cid", "hoa"],
        ["property_manager_cid", "propertyManager"],
      ]) {
        const current = restamped[field];
        if (typeof current !== "string" || current.length === 0) continue;
        if (current.startsWith("sha256:")) {
          const published = publishedCidByLocalCid.get(current);
          if (!published) {
            throw new Error(`Query table ${field} references unpublished object ${current}`);
          }
          restamped[field] = published;
        }
        if (restamped[field].startsWith("sha256:")) {
          throw new Error(`Query table ${field} retained a local sha256 CID`);
        }
        if (counter === "hoa") hoaCidCount += 1;
        else propertyManagerCidCount += 1;
      }
      await writer.appendRow(toParquetRecord(restamped));
    }
  } finally {
    await writer.close();
  }
  return {
    rowCount: rows.length,
    hoaCidCount,
    propertyManagerCidCount,
    outputParquetSha256: await sha256File(outputParquet),
  };
}
