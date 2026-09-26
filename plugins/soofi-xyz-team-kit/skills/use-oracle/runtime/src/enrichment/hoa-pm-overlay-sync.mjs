import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

import { parseCsvRecords } from "../core/csv.mjs";
import { toParquetRecord } from "../core/query-table.mjs";

const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");
const { PARQUET_COMPRESSION_METHODS } = require(
  "@dsnp/parquetjs/dist/lib/compression.js",
);

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

const CSV_TOKEN_FIELDS = [
  "elephant_token",
  "canonical_token",
  "token",
  "address_token",
];
const CSV_UUID_FIELDS = ["elephant_uuid", "property_id", "uuid"];
const CSV_PARCEL_FIELDS = [
  "parcel_identifier",
  "parcel_id",
  "request_identifier",
  "APN",
  "ParcelID",
  "apn",
];
const HOA_PM_CID_FIELDS = ["hoa_cid", "property_manager_cid"];

function nonBlank(value) {
  return value != null && String(value).trim().length > 0;
}

export function canonicalElephantToken(value) {
  if (!nonBlank(value)) return null;
  const match = /([a-f0-9]{64})$/i.exec(String(value).trim());
  return match ? match[1].toLowerCase() : null;
}

function canonicalUuid(value) {
  return nonBlank(value) ? String(value).trim().toLowerCase() : null;
}

function canonicalParcel(value) {
  return nonBlank(value) ? String(value).trim().toUpperCase() : null;
}

function rowIdentity(row) {
  return {
    token: canonicalElephantToken(row.elephant_token),
    uuid: canonicalUuid(row.elephant_uuid ?? row.property_id),
    parcel: canonicalParcel(
      row.parcel_identifier ?? row.parcel_id ?? row.request_identifier,
    ),
  };
}

function addUnique(index, key, row) {
  if (!key) return;
  if (!index.has(key)) {
    index.set(key, row);
    return;
  }
  if (index.get(key) !== row) index.set(key, null);
}

function parquetFieldDefinition(field) {
  if (field.path?.length !== 1 || field.isNested) {
    throw new Error(`HOA/PM overlay sync only supports scalar field ${field.name}`);
  }
  const type = field.originalType === "UTF8" ? "UTF8" : field.primitiveType;
  if (
    !["BOOLEAN", "BYTE_ARRAY", "DOUBLE", "FLOAT", "INT32", "INT64", "INT96", "UTF8"].includes(
      type,
    )
  ) {
    throw new Error(`Unsupported Parquet field type for ${field.name}: ${type}`);
  }
  return { type, optional: field.repetitionType !== "REQUIRED" };
}

async function inspectParquet(parquetPath) {
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
        if (fieldName && compression) compressionByField.set(fieldName, compression);
      }
    }
    for (const [fieldName, compression] of compressionByField) {
      if (schemaFields[fieldName]) schemaFields[fieldName].compression = compression;
    }
    return { schemaFields };
  } finally {
    await reader.close();
  }
}

async function readRows(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  const rows = [];
  try {
    const cursor = reader.getCursor();
    for (let row = await cursor.next(); row; row = await cursor.next()) rows.push(row);
  } finally {
    await reader.close();
  }
  return rows;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function collectCsvIdentity(rows) {
  const identity = { tokens: new Set(), uuids: new Set(), parcels: new Set() };
  for (const row of rows) {
    for (const field of CSV_TOKEN_FIELDS) {
      const token = canonicalElephantToken(row[field]);
      if (token) identity.tokens.add(token);
    }
    for (const value of Object.values(row)) {
      const token = canonicalElephantToken(value);
      if (token) identity.tokens.add(token);
    }
    for (const field of CSV_UUID_FIELDS) {
      const uuid = canonicalUuid(row[field]);
      if (uuid) identity.uuids.add(uuid);
    }
    for (const field of CSV_PARCEL_FIELDS) {
      const parcel = canonicalParcel(row[field]);
      if (parcel) identity.parcels.add(parcel);
    }
  }
  return identity;
}

function buildIdentityIndexes(rows) {
  const indexes = {
    tokens: new Map(),
    uuids: new Map(),
    parcels: new Map(),
  };
  for (const row of rows) {
    const identity = rowIdentity(row);
    addUnique(indexes.tokens, identity.token, row);
    addUnique(indexes.uuids, identity.uuid, row);
    addUnique(indexes.parcels, identity.parcel, row);
  }
  return indexes;
}

function intersects(identity, sets) {
  return Boolean(
    (identity.token && sets.tokens.has(identity.token)) ||
      (identity.uuid && sets.uuids.has(identity.uuid)) ||
      (identity.parcel && sets.parcels.has(identity.parcel)),
  );
}

function identityMatch(identity, indexes) {
  if (identity.token && indexes.tokens.has(identity.token)) {
    return indexes.tokens.get(identity.token);
  }
  if (identity.uuid && indexes.uuids.has(identity.uuid)) {
    return indexes.uuids.get(identity.uuid);
  }
  if (identity.parcel && indexes.parcels.has(identity.parcel)) {
    return indexes.parcels.get(identity.parcel);
  }
  return undefined;
}

function projectAddedRow(official, overlayFields) {
  const projected = {};
  for (const field of overlayFields) projected[field] = official[field] ?? null;
  for (const field of HOA_PM_CID_FIELDS) {
    if (field in projected) projected[field] = null;
  }
  if ("hoa_pm_status" in projected) projected.hoa_pm_status = null;
  return projected;
}

export async function syncHoaPmOverlay({
  county,
  overlayParquet,
  officialParquet = null,
  outputDir,
  parcelCsv = null,
}) {
  const overlayInspection = await inspectParquet(overlayParquet);
  const overlayRows = await readRows(overlayParquet);
  const overlayIdentities = overlayRows.map(rowIdentity);
  const overlayIdentitySets = {
    tokens: new Set(overlayIdentities.map((value) => value.token).filter(Boolean)),
    uuids: new Set(overlayIdentities.map((value) => value.uuid).filter(Boolean)),
    parcels: new Set(overlayIdentities.map((value) => value.parcel).filter(Boolean)),
  };
  const csvRows = parcelCsv
    ? parseCsvRecords(await readFile(parcelCsv, "utf8"))
    : [];
  const csvIdentity = parcelCsv
    ? collectCsvIdentity(csvRows)
    : { tokens: new Set(), uuids: new Set(), parcels: new Set() };
  const csvIndexes = buildIdentityIndexes(csvRows);
  const officialIndexes = {
    tokens: new Map(),
    uuids: new Map(),
    parcels: new Map(),
  };
  const selectedOfficialRows = [];
  let officialInspection = null;
  if (officialParquet) {
    officialInspection = await inspectParquet(officialParquet);
    const officialReader = await ParquetReader.openFile(officialParquet);
    try {
      const cursor = officialReader.getCursor();
      for (let row = await cursor.next(); row; row = await cursor.next()) {
        const identity = rowIdentity(row);
        if (identity.token && overlayIdentitySets.tokens.has(identity.token)) {
          addUnique(officialIndexes.tokens, identity.token, row);
        }
        if (identity.uuid && overlayIdentitySets.uuids.has(identity.uuid)) {
          addUnique(officialIndexes.uuids, identity.uuid, row);
        }
        if (identity.parcel && overlayIdentitySets.parcels.has(identity.parcel)) {
          addUnique(officialIndexes.parcels, identity.parcel, row);
        }
        if (parcelCsv && intersects(identity, csvIdentity)) {
          selectedOfficialRows.push({ row, identity });
        }
      }
    } finally {
      await officialReader.close();
    }
  }

  let officialMatched = 0;
  let subdivisionFilled = 0;
  let tokenFilled = 0;
  let tokenFilledFromOfficial = 0;
  let tokenFilledFromCsv = 0;
  const outputRows = overlayRows.map((overlayRow, index) => {
    const official = identityMatch(overlayIdentities[index], officialIndexes);
    const csv = identityMatch(overlayIdentities[index], csvIndexes);
    const outputRow = { ...overlayRow };
    if (official !== undefined && official !== null) officialMatched += 1;
    if (!nonBlank(overlayRow.subdivision) && nonBlank(official?.subdivision)) {
      subdivisionFilled += 1;
      outputRow.subdivision = String(official.subdivision).trim();
    }
    if (!canonicalElephantToken(overlayRow.elephant_token)) {
      const officialToken = canonicalElephantToken(official?.elephant_token);
      const csvToken = CSV_TOKEN_FIELDS
        .map((field) => canonicalElephantToken(csv?.[field]))
        .find(Boolean);
      const token = officialToken ?? csvToken;
      if (token) {
        outputRow.elephant_token = token;
        tokenFilled += 1;
        if (officialToken) tokenFilledFromOfficial += 1;
        else tokenFilledFromCsv += 1;
      }
    }
    return outputRow;
  });

  let rowsAdded = 0;
  const addedKeys = new Set();
  const outputSchemaFields = structuredClone(overlayInspection.schemaFields);
  const tokenAvailable =
    Boolean(officialInspection?.schemaFields.elephant_token) ||
    csvRows.some((row) =>
      CSV_TOKEN_FIELDS.some((field) => canonicalElephantToken(row[field])),
    );
  if (!outputSchemaFields.elephant_token && tokenAvailable) {
    outputSchemaFields.elephant_token = { type: "UTF8", optional: true };
  }
  const overlayFields = Object.keys(outputSchemaFields);
  for (const candidate of selectedOfficialRows) {
    if (intersects(candidate.identity, overlayIdentitySets)) continue;
    const key =
      candidate.identity.token ??
      candidate.identity.uuid ??
      candidate.identity.parcel;
    if (!key || addedKeys.has(key)) continue;
    addedKeys.add(key);
    outputRows.push(projectAddedRow(candidate.row, overlayFields));
    rowsAdded += 1;
  }

  const stillEmpty = outputRows.filter((row) => !nonBlank(row.subdivision)).length;
  const stillMissingToken = outputRows.filter(
    (row) => !canonicalElephantToken(row.elephant_token),
  ).length;
  await mkdir(outputDir, { recursive: true });
  const outputParquet = path.join(outputDir, "query-table.parquet");
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(outputSchemaFields),
    outputParquet,
  );
  try {
    for (const row of outputRows) await writer.appendRow(toParquetRecord(row));
  } finally {
    await writer.close();
  }
  const manifest = {
    schemaVersion: "elephant.hoa-pm-overlay-sync.v1",
    county,
    overlayIn: overlayRows.length,
    officialMatched,
    subdivisionFilled,
    tokenFilled,
    tokenFilledFromOfficial,
    tokenFilledFromCsv,
    rowsAdded,
    stillEmpty,
    stillMissingToken,
    outputRows: outputRows.length,
    overlayParquetSha256: await sha256File(overlayParquet),
    officialParquetSha256: officialParquet ? await sha256File(officialParquet) : null,
    parcelCsvSha256: parcelCsv ? await sha256File(parcelCsv) : null,
    outputParquetSha256: await sha256File(outputParquet),
  };
  const manifestPath = path.join(outputDir, "hoa-pm-overlay-sync-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, outputParquet, manifestPath };
}
