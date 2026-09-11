// @ts-check

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import {
  ParquetReader,
  ParquetSchema,
  ParquetWriter,
} from "@dsnp/parquetjs";

const QUERY_TABLE_FIELDS = Object.freeze({
  property_id: { type: "UTF8" },
  property_cid: { type: "UTF8", optional: true },
  request_identifier: { type: "UTF8" },
  parcel_identifier: { type: "UTF8" },
  source_system: { type: "UTF8" },
  county_name: { type: "UTF8" },
  state_code: { type: "UTF8" },
  address_street: { type: "UTF8", optional: true },
  address_city: { type: "UTF8", optional: true },
  address_zip: { type: "UTF8", optional: true },
  elephant_uuid: { type: "UTF8" },
  elephant_token: { type: "UTF8" },
  latitude: { type: "DOUBLE", optional: true },
  longitude: { type: "DOUBLE", optional: true },
  lot_size_acre: { type: "DOUBLE", optional: true },
  lot_area_sqft: { type: "DOUBLE", optional: true },
  exterior_wall_material: { type: "UTF8", optional: true },
  roof_covering_material: { type: "UTF8", optional: true },
  property_type: { type: "UTF8", optional: true },
  property_usage_type: { type: "UTF8", optional: true },
  built_year: { type: "INT64", optional: true },
  livable_floor_area: { type: "DOUBLE", optional: true },
  total_area: { type: "DOUBLE", optional: true },
  assessed_value: { type: "DOUBLE", optional: true },
  market_value: { type: "DOUBLE", optional: true },
  land_value: { type: "DOUBLE", optional: true },
  avm_value: { type: "DOUBLE", optional: true },
  owner_name: { type: "UTF8", optional: true },
  owners_text: { type: "UTF8", optional: true },
  owner_count: { type: "INT64", optional: true },
  owner_occupied: { type: "BOOLEAN", optional: true },
  last_sale_date: { type: "UTF8", optional: true },
  last_sale_price: { type: "DOUBLE", optional: true },
  subdivision: { type: "UTF8", optional: true },
  has_permits: { type: "BOOLEAN" },
  permit_count: { type: "INT64" },
  has_sunbiz_tenant: { type: "BOOLEAN" },
  has_bbb_contractor: { type: "BOOLEAN" },
  has_pa_corp_tenant: { type: "BOOLEAN" },
  hoa_flag: { type: "BOOLEAN", optional: true },
});

/** @param {unknown} value */
function text(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** @param {unknown} value */
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Stable UUIDv5-shaped identifier used by the existing generic Elephant
 * query-table exporter. This is property identity, not OpenDoor identity.
 *
 * @param {string} sourceSystem
 * @param {string} requestIdentifier
 */
export function propertyId(sourceSystem, requestIdentifier) {
  const digest = createHash("sha1")
    .update(`${sourceSystem}:${requestIdentifier}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @param {unknown} value */
export function parseAddress(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const street = parts.shift() ?? null;
  let zip = null;
  if (parts.length) {
    const last = parts.at(-1) ?? "";
    zip = /\b(\d{5})(?:-\d{4})?\b/.exec(last)?.[1] ?? null;
    if (zip) {
      const withoutZip = last
        .replace(/\b\d{5}(?:-\d{4})?\b/, "")
        .trim();
      if (withoutZip) parts[parts.length - 1] = withoutZip;
      else parts.pop();
    }
  }
  if (/^[A-Za-z]{2}$/.test(parts.at(-1) ?? "")) parts.pop();
  return { street, city: parts.join(", ") || null, zip };
}

/** @param {string} filePath */
async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** @param {string} artifactDirectory */
async function loadArtifact(artifactDirectory) {
  const dataDirectory = path.join(artifactDirectory, "data");
  const files = new Map();
  for (const name of await readdir(dataDirectory)) {
    if (!name.endsWith(".json") || name.startsWith("relationship_")) continue;
    const record = await optionalJson(path.join(dataDirectory, name));
    if (record && typeof record === "object" && !Array.isArray(record)) {
      files.set(name, record);
    }
  }
  return {
    files,
    identity: await optionalJson(path.join(artifactDirectory, "identity.json")),
    captureAddress: await optionalJson(
      path.join(artifactDirectory, "unnormalized_address.json"),
    ),
  };
}

/**
 * @param {Map<string, Record<string, unknown>>} files
 * @param {RegExp} expression
 */
function matching(files, expression) {
  return [...files.entries()]
    .filter(([name]) => expression.test(name))
    .map(([, record]) => record);
}

/** @param {Record<string, unknown>} record */
function ownerName(record) {
  const assembled = [record.first_name, record.middle_name, record.last_name]
    .map(text)
    .filter(Boolean)
    .join(" ");
  return (
    text(record.name) ??
    text(record.full_name) ??
    text(record.company_name) ??
    text(assembled)
  );
}

/**
 * @param {{
 *   county: string,
 *   countyName: string,
 *   seedRow: Record<string, string>,
 *   files: Map<string, Record<string, unknown>>,
 *   identity: Record<string, unknown> | null,
 *   captureAddress: Record<string, unknown> | null,
 * }} input
 */
export function rowFromArtifacts(input) {
  const requestIdentifier = text(input.seedRow.parcel_id);
  if (!requestIdentifier) throw new Error("Seed row has no parcel_id");
  const sourceSystem = `${input.county.replaceAll("-", "_")}_appraiser`;
  const property = input.files.get("property.json") ?? {};
  const parcel = input.files.get("parcel.json") ?? {};
  const address = input.files.get("address.json") ?? {};
  const lot = input.files.get("lot.json") ?? {};
  const geometries = matching(
    input.files,
    /^(geometry|geometry_parcel_.*)\.json$/,
  );
  const geometry =
    geometries.find(
      (record) =>
        number(record.latitude) !== null &&
        number(record.longitude) !== null,
    ) ?? {};
  const structures = matching(input.files, /^structure(?:_\d+)?\.json$/);
  const structure =
    structures.find(
      (record) =>
        text(record.exterior_wall_material_primary) ||
        text(record.roof_covering_material),
    ) ??
    structures[0] ??
    {};
  const taxes = matching(input.files, /^tax_\d+\.json$/).sort(
    (left, right) =>
      (number(right.tax_year) ?? 0) - (number(left.tax_year) ?? 0),
  );
  const sales = matching(input.files, /^sales_history_\d+\.json$/).sort(
    (left, right) =>
      String(right.ownership_transfer_date ?? "").localeCompare(
        String(left.ownership_transfer_date ?? ""),
      ),
  );
  const owners = matching(input.files, /^(person|company)_\d+\.json$/)
    .map(ownerName)
    .filter((name) => name !== null);
  const uniqueOwners = [...new Set(owners)];
  const parsedAddress = parseAddress(
    input.seedRow.opendoor_address ||
      address.unnormalized_address ||
      input.captureAddress?.full_address ||
      input.seedRow.situs_address,
  );
  const uuid = text(
    input.identity?.elephant_uuid ?? input.seedRow.elephant_uuid,
  );
  const token = text(
    input.identity?.elephant_token ?? input.seedRow.elephant_token,
  )?.replace(/^address:v1:/, "");
  if (
    uuid !== input.seedRow.elephant_uuid ||
    token !== input.seedRow.elephant_token
  ) {
    throw new Error(
      `Artifact changed OpenDoor identity for ${requestIdentifier}`,
    );
  }
  const lotAreaSqft = number(lot.lot_area_sqft);
  const permitCount = matching(
    input.files,
    /^property_improvement_\d+\.json$/,
  ).length;
  return {
    property_id: propertyId(sourceSystem, requestIdentifier),
    property_cid: null,
    request_identifier: requestIdentifier,
    parcel_identifier:
      text(property.parcel_identifier) ??
      text(parcel.parcel_identifier) ??
      requestIdentifier,
    source_system: sourceSystem,
    county_name: input.countyName,
    state_code: "FL",
    address_street:
      text(address.street_address) ??
      text(address.address_street) ??
      parsedAddress.street,
    address_city: text(address.city) ?? parsedAddress.city,
    address_zip:
      text(address.postal_code) ?? text(address.zip_code) ?? parsedAddress.zip,
    elephant_uuid: uuid,
    elephant_token: token,
    latitude:
      number(geometry.latitude) ??
      number(input.captureAddress?.latitude) ??
      number(input.seedRow.latitude),
    longitude:
      number(geometry.longitude) ??
      number(input.captureAddress?.longitude) ??
      number(input.seedRow.longitude),
    lot_size_acre:
      number(lot.lot_size_acre) ??
      (lotAreaSqft === null ? null : lotAreaSqft / 43_560),
    lot_area_sqft: lotAreaSqft,
    exterior_wall_material:
      text(structure.exterior_wall_material_primary) ??
      text(structure.exterior_wall_material),
    roof_covering_material: text(structure.roof_covering_material),
    property_type: text(property.property_type),
    property_usage_type: text(property.property_usage_type),
    built_year:
      Math.trunc(number(property.property_structure_built_year) ?? 0) || null,
    livable_floor_area:
      number(property.livable_floor_area) ?? number(property.area_under_air),
    total_area: number(property.total_area),
    assessed_value: number(taxes[0]?.property_assessed_value_amount),
    market_value: number(taxes[0]?.property_market_value_amount),
    land_value: number(taxes[0]?.property_land_amount),
    avm_value: null,
    owner_name: uniqueOwners[0] ?? null,
    owners_text: uniqueOwners.length ? uniqueOwners.join(" | ") : null,
    owner_count: uniqueOwners.length || null,
    owner_occupied: null,
    last_sale_date: text(sales[0]?.ownership_transfer_date),
    last_sale_price: number(sales[0]?.purchase_price_amount),
    subdivision: text(property.subdivision),
    has_permits: permitCount > 0,
    permit_count: permitCount,
    has_sunbiz_tenant: false,
    has_bbb_contractor: false,
    has_pa_corp_tenant: false,
    hoa_flag: null,
  };
}

/** @param {Record<string, unknown>} row */
function sparse(row) {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

/**
 * @param {string} parquetPath
 * @param {readonly Record<string, string>[]} seedRows
 * @param {string} county
 * @param {readonly Record<string, unknown>[]} expectedRows
 */
async function validateParquet(parquetPath, seedRows, county, expectedRows) {
  const expected = new Map(
    seedRows.map((row) => [
      row.parcel_id,
      { uuid: row.elephant_uuid, token: row.elephant_token },
    ]),
  );
  const reader = await ParquetReader.openFile(parquetPath);
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  try {
    const cursor = reader.getCursor();
    let row = await cursor.next();
    while (row) {
      rows.push(/** @type {Record<string, unknown>} */ (row));
      row = await cursor.next();
    }
  } finally {
    await reader.close();
  }
  const requestIds = rows.map((row) => String(row.request_identifier ?? ""));
  const propertyIds = rows.map((row) => String(row.property_id ?? ""));
  if (
    rows.length !== seedRows.length ||
    new Set(requestIds).size !== rows.length ||
    new Set(propertyIds).size !== rows.length ||
    requestIds.some((identifier) => !expected.has(identifier))
  ) {
    throw new Error(
      `Parquet validation failed: ${rows.length} rows, ${new Set(requestIds).size} distinct requests, ${new Set(propertyIds).size} distinct properties, expected ${seedRows.length}`,
    );
  }
  for (const row of rows) {
    const requestIdentifier = String(row.request_identifier);
    const identity = expected.get(requestIdentifier);
    if (
      row.elephant_uuid !== identity?.uuid ||
      row.elephant_token !== identity?.token ||
      row.source_system !== `${county}_appraiser`
    ) {
      throw new Error(
        `Parquet identity/source validation failed for ${requestIdentifier}`,
      );
    }
    const expectedRow = expectedRows.find(
      (candidate) => candidate.request_identifier === requestIdentifier,
    );
    if (!expectedRow) {
      throw new Error(`No expected Parquet row for ${requestIdentifier}`);
    }
    for (const field of Object.keys(QUERY_TABLE_FIELDS)) {
      const actualValue =
        typeof row[field] === "bigint" ? Number(row[field]) : row[field];
      const expectedValue = expectedRow[field];
      const bothEmpty =
        (actualValue === null || actualValue === undefined) &&
        (expectedValue === null || expectedValue === undefined);
      if (!bothEmpty && actualValue !== expectedValue) {
        throw new Error(
          `Parquet readback mismatch for ${requestIdentifier} field ${field}`,
        );
      }
    }
  }
  return {
    rows: rows.length,
    distinctRequestIdentifiers: new Set(requestIds).size,
    distinctPropertyIds: new Set(propertyIds).size,
    identityMatches: rows.length,
  };
}

/**
 * @param {{
 *   county: string,
 *   countyName: string,
 *   rows: readonly Record<string, string>[],
 *   outputDir: string,
 *   artifactDirectory: (row: Record<string, string>) => string,
 * }} options
 */
export async function exportValidatedQueryTable(options) {
  if (options.rows.length === 0) {
    throw new Error("Refusing to export an empty query table");
  }
  const requestIds = options.rows.map((row) => row.parcel_id);
  const uuids = options.rows.map((row) => row.elephant_uuid);
  const tokens = options.rows.map((row) => row.elephant_token);
  if (
    new Set(requestIds).size !== options.rows.length ||
    new Set(uuids).size !== options.rows.length ||
    new Set(tokens).size !== options.rows.length
  ) {
    throw new Error("Seed has duplicate request identifiers or identities");
  }
  const records = [];
  for (const seedRow of options.rows) {
    records.push(
      rowFromArtifacts({
        county: options.county,
        countyName: options.countyName,
        seedRow,
        ...(await loadArtifact(options.artifactDirectory(seedRow))),
      }),
    );
  }

  await mkdir(options.outputDir, { recursive: true, mode: 0o700 });
  const parquetPath = path.join(options.outputDir, "query-table.parquet");
  if (!(await fileExists(parquetPath))) {
    const temporaryPath = `${parquetPath}.${process.pid}.tmp`;
    await rm(temporaryPath, { force: true });
    const writer = await ParquetWriter.openFile(
      new ParquetSchema(
        /** @type {import("@dsnp/parquetjs").SchemaDefinition} */ (
          structuredClone(QUERY_TABLE_FIELDS)
        ),
      ),
      temporaryPath,
    );
    try {
      for (const record of records) await writer.appendRow(sparse(record));
      await writer.close();
      await rename(temporaryPath, parquetPath);
    } catch (error) {
      await writer.close().catch(() => {});
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
  const validation = await validateParquet(
    parquetPath,
    options.rows,
    options.county,
    records,
  );
  const body = await readFile(parquetPath);
  return {
    path: "query-table.parquet",
    bytes: (await stat(parquetPath)).size,
    sha256: createHash("sha256").update(body).digest("hex"),
    validation,
  };
}

/** @param {string} filePath */
async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
