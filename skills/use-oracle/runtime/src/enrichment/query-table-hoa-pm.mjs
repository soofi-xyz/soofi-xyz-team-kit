import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import { toParquetRecord } from "../core/query-table.mjs";
import { resolveHoaAndPropertyManagement, stampPropertyCids } from "./hoa-pm-heuristic.mjs";

const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");

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

function withHoaPmSchema(schemaFields) {
  const output = structuredClone(schemaFields);
  for (const [fieldName, fieldType] of Object.entries(REQUIRED_COLUMNS)) {
    if (output[fieldName] && output[fieldName].type !== fieldType) {
      throw new Error(
        `HOA/PM enrichment requires ${fieldName} ${fieldType} column`,
      );
    }
    output[fieldName] = { type: fieldType, optional: true };
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

async function inferSchemaFields(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  try {
    return Object.fromEntries(
      Object.entries(reader.schema.fields).map(([name, field]) => [
        name,
        parquetFieldDefinition(field),
      ]),
    );
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
  const outputSchemaFields = withHoaPmSchema(
    schemaFields ?? (await inferSchemaFields(inputParquet)),
  );
  const sunbizCompanies =
    companies ?? (await loadSunbizCompanies(sunbizExtractDir));
  const rows = await readQueryRows(inputParquet);
  const objects = [];
  const stamped = [];
  const statusCounts = {};
  for (const row of rows) {
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: row.subdivision,
      companies: sunbizCompanies,
    });
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
