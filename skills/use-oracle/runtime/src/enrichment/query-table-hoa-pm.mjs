import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import { toParquetRecord } from "../core/query-table.mjs";
import {
  emptyClerkOfficialRecords,
  loadClerkOfficialRecords,
  recordedCommunityEvidenceForParcel,
} from "./clerk-official-records.mjs";
import { isIpfsCid } from "./hoa-pm-object-publication.mjs";
import { emptyCtmhRecords, loadCtmhExtract } from "./ctmh-condo.mjs";
import { resolveHoaAndPropertyManagement, stampPropertyCids } from "./hoa-pm-heuristic.mjs";
import { loadSunbizAliasIndex } from "./sunbiz-aliases.mjs";

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
  property_cid: "UTF8",
  hoa_cid: "UTF8",
  hoa_name: "UTF8",
  homeowners_association_type: "UTF8",
  hoa_sunbiz_document_number: "UTF8",
  hoa_ctmh_project_number: "UTF8",
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
        filingTypeCode: entity.filingTypeCode ?? null,
        filingType: entity.filingType ?? null,
        principalAddress: entity.principalAddress ?? null,
        mailingAddress: entity.mailingAddress ?? null,
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

export function hoaPmPropertyLinkKey(row) {
  const parcel = hoaPmParcelReference(row);
  return JSON.stringify([
    row.property_cid ?? null,
    row.property_cid ? null : parcel.field,
    row.property_cid ? null : parcel.value,
    row.hoa_cid ?? null,
    row.property_manager_cid ?? null,
  ]);
}

export function hoaPmParcelReference(row) {
  for (const field of ["parcel_identifier", "parcel_id", "request_identifier"]) {
    const value = row[field];
    if (value != null && String(value).trim().length > 0) {
      return { field, value: String(value) };
    }
  }
  return { field: null, value: null };
}

function isHoaPmLinkedRow(row) {
  return Boolean(
    row.hoa_cid ||
      row.property_manager_cid ||
      row.hoa_pm_status === "matched",
  );
}

async function readOfficialPropertyCids(parquetPath, parcelIdentifiers) {
  const wanted = new Set(parcelIdentifiers);
  const cids = new Map();
  const reader = await ParquetReader.openFile(parquetPath);
  try {
    const cursor = reader.getCursor();
    let row = await cursor.next();
    while (row && cids.size < wanted.size) {
      const parcelIdentifier = row.parcel_identifier ?? row.parcel_id;
      if (wanted.has(parcelIdentifier) && isIpfsCid(row.property_cid)) {
        cids.set(parcelIdentifier, row.property_cid);
      }
      row = await cursor.next();
    }
  } finally {
    await reader.close();
  }
  return cids;
}

export async function readHoaPmPropertyLinks(
  parquetPath,
  officialParquetPath = null,
  { allowThinOverlay = false } = {},
) {
  const rows = await readQueryRows(parquetPath);
  const missingParcels = rows
    .filter(
      (row) =>
        isHoaPmLinkedRow(row) &&
        !isIpfsCid(row.property_cid),
    )
    .map((row) => hoaPmParcelReference(row).value)
    .filter(Boolean);
  const officialPropertyCids =
    missingParcels.length > 0 && officialParquetPath
      ? await readOfficialPropertyCids(officialParquetPath, missingParcels)
      : new Map();
  const links = new Map();
  for (const row of rows) {
    if (!isHoaPmLinkedRow(row)) continue;
    const parcel = hoaPmParcelReference(row);
    const propertyCid = isIpfsCid(row.property_cid)
      ? row.property_cid
      : officialPropertyCids.get(parcel.value);
    if (!isIpfsCid(propertyCid) && !allowThinOverlay) {
      throw new Error(
        `Matched HOA/PM row ${parcel.value ?? "<unknown>"} has invalid property_cid`,
      );
    }
    for (const [field, value] of [
      ["hoa_cid", row.hoa_cid],
      ["property_manager_cid", row.property_manager_cid],
    ]) {
      if (value != null && !isIpfsCid(value)) {
        throw new Error(
          `Matched HOA/PM row ${parcel.value ?? "<unknown>"} has invalid ${field}`,
        );
      }
    }
    const linkedRow = { ...row, property_cid: propertyCid };
    const key = hoaPmPropertyLinkKey(linkedRow);
    links.set(key, {
      key,
      parcelField: parcel.field,
      parcelIdentifier: parcel.value,
      propertyCid: propertyCid ?? null,
      hoaCid: row.hoa_cid ?? null,
      propertyManagerCid: row.property_manager_cid ?? null,
      hoaPmStatus: row.hoa_pm_status ?? null,
      thinProperty:
        propertyCid == null
          ? Object.fromEntries(
              [
                ["county", row.county ?? row.county_name],
                [parcel.field, parcel.value],
                ["address_street", row.address_street],
                ["address_city", row.address_city],
                ["address_zip", row.address_zip],
                ["primary_address", row.primary_address],
                ["subdivision", row.subdivision],
              ].filter(([field, value]) => field && value != null),
            )
          : null,
    });
  }
  return {
    rowCount: rows.length,
    matchedRowCount: rows.filter(isHoaPmLinkedRow).length,
    links: [...links.values()],
  };
}

export async function enrichQueryTableWithHoaPm({
  countyKey,
  schemaFields,
  inputParquet,
  inputCoverage,
  sunbizExtractDir,
  companies = null,
  pmCompanies = null,
  sunbizPmExtractDir = null,
  ctmhExtractDir = null,
  ctmhRecords = null,
  sunbizEventsExtractDir = null,
  sunbizFictitiousExtractDir = null,
  sunbizAliases = null,
  clerkRecordsPath = null,
  clerkSourceManifestPath = null,
  clerkOfficialRecords = null,
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
  const loadedPmCompanies =
    pmCompanies ??
    (sunbizPmExtractDir ? await loadSunbizCompanies(sunbizPmExtractDir) : null);
  const pmPool = loadedPmCompanies
    ? [...sunbizCompanies, ...loadedPmCompanies]
    : null;
  const loadedCtmh =
    ctmhRecords ??
    (ctmhExtractDir ? await loadCtmhExtract(ctmhExtractDir) : emptyCtmhRecords());
  const loadedSunbizAliases =
    sunbizAliases ??
    (sunbizEventsExtractDir || sunbizFictitiousExtractDir
      ? await loadSunbizAliasIndex({
          companies: pmPool ?? sunbizCompanies,
          corporateEventsDir: sunbizEventsExtractDir,
          fictitiousNamesDir: sunbizFictitiousExtractDir,
        })
      : null);
  if (
    (clerkRecordsPath === null) !==
    (clerkSourceManifestPath === null)
  ) {
    throw new Error(
      "HOA/PM clerk fallback requires both clerk records and source manifest",
    );
  }
  const loadedClerkRecords =
    clerkOfficialRecords ??
    (clerkRecordsPath
      ? await loadClerkOfficialRecords({
          countyKey,
          recordsPath: clerkRecordsPath,
          sourceManifestPath: clerkSourceManifestPath,
        })
      : emptyClerkOfficialRecords());
  const rows = await readQueryRows(inputParquet);
  const objects = [];
  const stamped = [];
  const statusCounts = {};
  const sourceCounts = {};
  const clerkStatusCounts = {};
  let clerkMatchedHoaCount = 0;
  const joinCounts = {
    ctmh_hoa: 0,
    ctmh_sunbiz_joined: 0,
    ctmh_only: 0,
    sunbiz_only: 0,
    ctmh_eligible: 0,
    ctmh_unique: 0,
    ctmh_not_unique: 0,
    ctmh_miss: 0,
    ctmh_hoa_fee_simple: 0,
    ctmh_hoa_leasehold: 0,
    ctmh_hoa_missing_estate: 0,
    ctmh_hoa_condominium: 0,
    ctmh_hoa_cooperative: 0,
    ctmh_hoa_timeshare: 0,
  };
  const resolutionBySubdivision = new Map();
  for (const row of rows) {
    const clerkEvidence = recordedCommunityEvidenceForParcel(
      loadedClerkRecords,
      row.parcel_identifier,
    );
    const cacheKey = [
      row.subdivision ?? "",
      row.ownership_estate_type ?? "",
      row.address_city ?? row.city ?? "",
      row.county_name ?? row.county ?? countyKey,
      row.hoa_sunbiz_document_number ?? "",
      clerkEvidence.status,
      clerkEvidence.evidence?.normalizedName ?? "",
      clerkEvidence.evidence?.sourceProfileId ?? "",
    ].join("\0");
    let resolution = resolutionBySubdivision.get(cacheKey);
    if (!resolution) {
      resolution = resolveHoaAndPropertyManagement({
        subdivision: row.subdivision,
        companies: sunbizCompanies,
        pmCompanies: pmPool,
        countyKey,
        ownershipEstateType: row.ownership_estate_type,
        ctmhRecords: loadedCtmh,
        sunbizAliases: loadedSunbizAliases,
        parcelCity: row.address_city ?? row.city ?? null,
        parcelCounty: row.county_name ?? row.county ?? countyKey,
        officialDocumentNumbers: [
          row.hoa_sunbiz_document_number,
          row.ctmh_sunbiz_document_number,
          row.clerk_declaration_sunbiz_document_number,
        ],
        recordedCommunityEvidence: clerkEvidence.evidence,
        recordedCommunityEvidenceStatus: clerkEvidence.status,
      });
      resolutionBySubdivision.set(cacheKey, resolution);
    }
    joinCounts.ctmh_eligible += 1;
    if (resolution.ctmhStatus === "matched") joinCounts.ctmh_unique += 1;
    else if (resolution.ctmhStatus === "not_unique") joinCounts.ctmh_not_unique += 1;
    else if (resolution.ctmhStatus) joinCounts.ctmh_miss += 1;
    if (resolution.hoa) {
      if (resolution.source === "ctmh") {
        joinCounts.ctmh_hoa += 1;
        if (resolution.sunbizJoinStatus === "matched") joinCounts.ctmh_sunbiz_joined += 1;
        else joinCounts.ctmh_only += 1;
        const estate = String(row.ownership_estate_type ?? "")
          .replace(/\s+/g, "")
          .toLowerCase();
        if (estate === "feesimple") joinCounts.ctmh_hoa_fee_simple += 1;
        else if (estate === "leasehold") joinCounts.ctmh_hoa_leasehold += 1;
        else if (estate === "condominium" || estate === "condo") {
          joinCounts.ctmh_hoa_condominium += 1;
        } else if (estate === "cooperative" || estate === "coop") {
          joinCounts.ctmh_hoa_cooperative += 1;
        } else if (estate === "timeshare") joinCounts.ctmh_hoa_timeshare += 1;
        else joinCounts.ctmh_hoa_missing_estate += 1;
      } else {
        joinCounts.sunbiz_only += 1;
      }
    }
    sourceCounts[resolution.source ?? "none"] =
      (sourceCounts[resolution.source ?? "none"] ?? 0) + 1;
    if (resolution.status?.startsWith("clerk_")) {
      clerkStatusCounts[resolution.status] =
        (clerkStatusCounts[resolution.status] ?? 0) + 1;
    }
    if (resolution.source === "clerk_official_records" && resolution.hoa) {
      clerkMatchedHoaCount += 1;
    }
    if (resolution.hoa) objects.push(resolution.hoa);
    if (resolution.hoaCompany) objects.push(resolution.hoaCompany);
    if (resolution.propertyManagement) objects.push(resolution.propertyManagement);
    const stampedRow = stampPropertyCids(row, resolution);
    statusCounts[stampedRow.hoa_pm_status] =
      (statusCounts[stampedRow.hoa_pm_status] ?? 0) + 1;
    stamped.push(stampedRow);
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
    ctmh_join_counts: joinCounts,
    clerk_official_records: {
      ...loadedClerkRecords.summary,
      fallback_attempt_count: sourceCounts.clerk_official_records ?? 0,
      matched_hoa_count: clerkMatchedHoaCount,
      status_counts: clerkStatusCounts,
    },
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
    ctmhJoinCounts: joinCounts,
    sunbizAliasInputs: loadedSunbizAliases?.summary ?? null,
    clerkOfficialRecords: {
      ...loadedClerkRecords.summary,
      statusCounts: clerkStatusCounts,
    },
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

export async function restampHoaPmPropertyCids({
  inputParquet,
  outputParquet,
  publishedPropertyCidByParcel,
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
  let matchedRowCount = 0;
  try {
    for (const row of rows) {
      const restamped = { ...row };
      if (isHoaPmLinkedRow(row)) {
        matchedRowCount += 1;
        const parcel = hoaPmParcelReference(row);
        const published = publishedPropertyCidByParcel.get(
          parcel.value,
        );
        if (!isIpfsCid(published)) {
          throw new Error(
            `Matched HOA/PM row ${parcel.value ?? "<unknown>"} has no published property CID`,
          );
        }
        restamped.property_cid = published;
      }
      await writer.appendRow(toParquetRecord(restamped));
    }
  } finally {
    await writer.close();
  }
  return {
    rowCount: rows.length,
    matchedRowCount,
    outputParquetSha256: await sha256File(outputParquet),
  };
}
