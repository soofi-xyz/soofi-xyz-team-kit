/**
 * Duval seed-row construction from already-joined Florida DOR NAL/SDF/PIN
 * records.
 *
 * Adapted from `oracle-node@ff68b0b6` `scripts/duval/lib.mjs` (`toSeedRow`,
 * `mergeDuplicateParcels`, `isValidDorParcelId`, `toUndashedTenDigit`,
 * `toCanonicalReDisplay`, `toCojDetailUrl`, `assertSafeSourceFields`,
 * `assertSeedReconciliation`, `SEED_COLUMNS`, `NAL_SOURCE_FIELDS`,
 * `EXCLUDED_PII_FIELDS`, `PIN_BBOX`), trimmed to the single-parcel
 * `buildSeed(options)` path this package's CLI/replay needs. The source
 * script's county-wide NAL/SDF/PIN download + DuckDB spatial join
 * (`scripts/build-duval-seed.mjs`) that produces the real ~404k-row seed is
 * intentionally **not** ported: it requires `duckdb` + `unzip` and live
 * `floridarevenue.com` downloads, which this offline package must never
 * exercise (Global Constraint). Callers of `buildSeed` supply already-joined
 * records (analogous to how the Pinellas adapter's `buildSeed` takes
 * already-fetched GIS features rather than paginating the GIS service
 * itself) — see the Task 3 report.
 *
 * @module counties/duval/seed
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCsv } from "../../core/csv.mjs";

export const COUNTY_NAME = "Duval";
export const COUNTY_FIPS = "12031";
export const COJ_DETAIL_URL = "https://paopropertysearch.coj.net/Basic/Detail.aspx";

/** Published NAL/PIN centroid bounding box (`docs/duval-sources.yaml`). Wider than the Task 7 validation bbox in `validate.mjs`. */
export const PIN_BBOX = Object.freeze({
  minLat: 29.99,
  maxLat: 30.7,
  minLng: -82.2,
  maxLng: -81.2,
});

/**
 * Owner/fiduciary NAL columns. Never requested into the seed (Global
 * Constraint: no PII in the seed source request).
 *
 * @type {readonly string[]}
 */
export const EXCLUDED_PII_FIELDS = Object.freeze([
  "OWN_NAME",
  "OWN_ADDR1",
  "OWN_ADDR2",
  "OWN_CITY",
  "OWN_STATE",
  "OWN_ZIPCD",
  "FIDU_NAME",
]);

/**
 * Explicit non-PII NAL columns retained for provenance and stratification.
 *
 * @type {readonly string[]}
 */
export const NAL_SOURCE_FIELDS = Object.freeze([
  "PARCEL_ID",
  "CO_NO",
  "ASMNT_YR",
  "DOR_UC",
  "PA_UC",
  "JV",
  "AV_NSD",
  "TV_NSD",
  "LND_VAL",
  "LND_SQFOOT",
  "ACT_YR_BLT",
  "EFF_YR_BLT",
  "TOT_LVG_AREA",
  "NO_BULDNG",
  "NO_RES_UNTS",
  "NO_OWN_NM",
  "PHY_ADDR1",
  "PHY_ADDR2",
  "PHY_CITY",
  "PHY_ZIPCD",
  "NBRHD_CD",
  "MKT_AR",
  "CENSUS_BK",
  "SALE_PRC1",
  "SALE_YR1",
  "SALE_MO1",
  "QUAL_CD1",
]);

/**
 * Stable CSV column order for a Duval seed row.
 *
 * @type {readonly string[]}
 */
export const SEED_COLUMNS = Object.freeze([
  "parcel_id",
  "source_identifier",
  "method",
  "url",
  "multiValueQueryString",
  "address",
  "city",
  "state",
  "zip",
  "county",
  "county_fips",
  "latitude",
  "longitude",
  "parcel_polygon",
  "source_url",
  "source_item_id",
  "source_revision",
  "source_snapshot_at",
  "source_record_count",
  "source_object_ids",
  "source_features_json",
  "source_sdf_sale_count",
  ...NAL_SOURCE_FIELDS.map((field) => `source_${field}`),
]);

const DOR_PARCEL_ID_PATTERN = /^[0-9]{10}R$/;

/**
 * @param {unknown} value - Raw scalar.
 * @returns {string} Trimmed text, or empty string.
 */
export function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * @param {unknown} value - Candidate DOR parcel id.
 * @returns {boolean} True only for exactly 10 digits followed by `R`.
 */
export function isValidDorParcelId(value) {
  return DOR_PARCEL_ID_PATTERN.test(toText(value));
}

/**
 * Strip the trailing `R` from a canonical DOR parcel id.
 *
 * @param {unknown} value - Canonical DOR parcel id (e.g. `0969250000R`).
 * @returns {string} The 10-digit id with no trailing `R`.
 */
export function toUndashedTenDigit(value) {
  const identifier = toText(value);
  if (!isValidDorParcelId(identifier)) {
    throw new Error(`Not a canonical DOR parcel id: ${identifier}`);
  }
  return identifier.slice(0, 10);
}

/**
 * @param {unknown} value - Canonical DOR parcel id.
 * @returns {string} `RE #` display form, e.g. `096925-0000`.
 */
export function toCanonicalReDisplay(value) {
  const digits = toUndashedTenDigit(value);
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

/**
 * @param {unknown} value - Canonical DOR parcel id.
 * @returns {string} COJ detail-page URL with the `RE` query param.
 */
export function toCojDetailUrl(value) {
  return `${COJ_DETAIL_URL}?RE=${toText(value)}`;
}

/**
 * Fail closed if a NAL source-field list smuggles in a PII column or a
 * duplicate.
 *
 * @param {readonly string[]} sourceFields - Candidate NAL field names.
 * @returns {void}
 */
export function assertSafeSourceFields(sourceFields) {
  const normalizedExcluded = new Set(EXCLUDED_PII_FIELDS.map((field) => field.toLowerCase()));
  const seen = new Set();
  for (const field of sourceFields) {
    const normalized = field.toLowerCase();
    if (normalizedExcluded.has(normalized)) {
      throw new Error(`PII field is prohibited in the seed source request: ${field}`);
    }
    if (seen.has(normalized)) {
      throw new Error(`Duplicate source field: ${field}`);
    }
    seen.add(normalized);
  }
}

/**
 * @param {unknown} value - Raw NAL/PIN scalar.
 * @returns {string} Text form (JSON-stringified for objects/arrays).
 */
function sourceValueToText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * @param {Record<string, unknown>} nal - NAL fields for one row.
 * @returns {string} `"<street>, <city> FL <zip>"`, skipping empty parts.
 */
function buildSiteAddress(nal) {
  const street = [toText(nal.PHY_ADDR1), toText(nal.PHY_ADDR2)].filter((part) => part.length > 0).join(" ");
  const city = toText(nal.PHY_CITY);
  const zip = toText(nal.PHY_ZIPCD);
  const locality = [city, "FL", zip].filter((part) => part.length > 0).join(" ");
  return [street, locality].filter((part) => part.length > 0).join(", ");
}

/**
 * @typedef {object} DuvalSeedInput
 * @property {Record<string, unknown>} nal - Florida DOR NAL fields for one parcel.
 * @property {{ latitude?: unknown, longitude?: unknown, geometry?: unknown } | null} [pin] - Joined PIN centroid/geometry.
 * @property {number} [sdfSaleCount] - Joined SDF sale-record count.
 * @property {string} sourceRevision - NAL source-file fingerprint (e.g. a sha256).
 * @property {string} snapshotAt - ISO timestamp shared by the whole seed snapshot.
 * @property {number} [sourceRecordCount] - Number of raw NAL/PIN records folded into this row.
 * @property {string} [sourceObjectIds] - `|`-joined identifiers of the folded raw records.
 * @property {string} [sourceFeaturesJson] - JSON array of the folded raw NAL records, when more than one.
 */

/**
 * Build one Duval seed row from an already-joined NAL/PIN/SDF record.
 *
 * @param {DuvalSeedInput} input - Joined parcel data plus snapshot metadata.
 * @returns {Record<string, string>} CSV row keyed by {@link SEED_COLUMNS}.
 */
export function toSeedRow(input) {
  const nal = input.nal;
  const pin = input.pin ?? {};
  const identifier = toText(nal.PARCEL_ID);
  const geometry = pin.geometry ?? null;
  /** @type {Record<string, string>} */
  const row = {
    parcel_id: isValidDorParcelId(identifier) ? toUndashedTenDigit(identifier) : identifier,
    source_identifier: identifier,
    method: "GET",
    url: COJ_DETAIL_URL,
    multiValueQueryString: JSON.stringify({ RE: [identifier] }),
    address: buildSiteAddress(nal),
    city: toText(nal.PHY_CITY),
    state: "FL",
    zip: toText(nal.PHY_ZIPCD),
    county: COUNTY_NAME,
    county_fips: COUNTY_FIPS,
    latitude: sourceValueToText(pin.latitude ?? ""),
    longitude: sourceValueToText(pin.longitude ?? ""),
    parcel_polygon: geometry ? JSON.stringify(geometry) : "",
    source_url: "https://floridarevenue.com/property/dataportal",
    source_item_id: "fl-dor-nal-duval-26",
    source_revision: input.sourceRevision,
    source_snapshot_at: input.snapshotAt,
    source_record_count: String(input.sourceRecordCount ?? 1),
    source_object_ids: input.sourceObjectIds ?? "",
    source_features_json: input.sourceFeaturesJson ?? "",
    source_sdf_sale_count: String(input.sdfSaleCount ?? 0),
  };
  for (const field of NAL_SOURCE_FIELDS) {
    row[`source_${field}`] = sourceValueToText(nal[field]);
  }
  return row;
}

/**
 * @param {object | null | undefined} geometry - GeoJSON `Polygon`/`MultiPolygon`, or null.
 * @returns {unknown[]} Polygon ring arrays (empty for anything else).
 */
function polygonComponents(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const geo = /** @type {{ type?: string, coordinates?: unknown }} */ (geometry);
  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) return [geo.coordinates];
  if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) return [...geo.coordinates];
  return [];
}

/**
 * @param {object | null} left - First geometry, or null.
 * @param {object | null} right - Second geometry, or null.
 * @returns {object | ""} Merged `Polygon`/`MultiPolygon`, or `""` when both are empty.
 */
function mergeGeometries(left, right) {
  const components = [...polygonComponents(left), ...polygonComponents(right)];
  if (components.length === 0) return "";
  if (components.length === 1) return { type: "Polygon", coordinates: components[0] };
  return { type: "MultiPolygon", coordinates: components };
}

/**
 * @typedef {object} KeyedDuvalRecord
 * @property {Record<string, unknown>} nal - NAL fields.
 * @property {{ latitude?: unknown, longitude?: unknown, geometry?: unknown } | null} [pin] - Joined PIN centroid/geometry.
 * @property {number} [sdfSaleCount] - Joined SDF sale-record count.
 */

/**
 * Fold duplicate `PARCEL_ID` groups (multi-PIN parcels) into one seed row
 * each: the highest-`JV` record wins the NAL fields, and every group
 * member's PIN geometry is merged into one `Polygon`/`MultiPolygon`.
 *
 * @param {readonly KeyedDuvalRecord[]} keyed - Raw joined records, possibly with duplicate `PARCEL_ID`s.
 * @param {{ sourceRevision: string, snapshotAt: string }} meta - Shared seed-snapshot metadata.
 * @returns {Record<string, string>[]} One deduplicated seed row per unique `PARCEL_ID`.
 */
export function mergeDuplicateParcels(keyed, meta) {
  /** @type {Map<string, KeyedDuvalRecord[]>} */
  const groups = new Map();
  for (const record of keyed) {
    const identifier = toText(record.nal.PARCEL_ID);
    const existing = groups.get(identifier);
    if (existing) existing.push(record);
    else groups.set(identifier, [record]);
  }

  const rows = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) => Number(right.nal.JV ?? 0) - Number(left.nal.JV ?? 0),
    );
    const primary = ordered[0];
    let geometry = primary.pin?.geometry ?? null;
    for (const extra of ordered.slice(1)) {
      geometry = mergeGeometries(geometry, extra.pin?.geometry ?? null) || geometry;
    }
    rows.push(
      toSeedRow({
        nal: primary.nal,
        pin: { ...primary.pin, geometry },
        sdfSaleCount: primary.sdfSaleCount ?? 0,
        sourceRevision: meta.sourceRevision,
        snapshotAt: meta.snapshotAt,
        sourceRecordCount: ordered.length,
        sourceObjectIds: ordered.map((_, index) => String(index + 1)).join("|"),
        sourceFeaturesJson: ordered.length > 1 ? JSON.stringify(ordered.map((item) => item.nal)) : "",
      }),
    );
  }
  return rows;
}

/**
 * @param {unknown} dorUc - Raw `DOR_UC` NAL column value.
 * @returns {string} Coarse use-code band, for pilot/sample stratification.
 */
export function classifyDorUseBand(dorUc) {
  const code = Number.parseInt(toText(dorUc), 10);
  if (!Number.isFinite(code)) return "other";
  if (code === 0) return "vacant_residential";
  if (code === 1) return "single_family";
  if (code === 2) return "mobile_home";
  if (code === 3 || code === 8) return "multi_family";
  if (code === 4) return "condo";
  if (code >= 10 && code <= 39) return "commercial";
  if (code >= 40 && code <= 49) return "industrial";
  if (code >= 50 && code <= 69) return "agricultural";
  if (code >= 70 && code <= 79) return "institutional";
  if (code >= 80 && code <= 89) return "government";
  return "other";
}

/**
 * @param {Record<string, string>} row - Seed row.
 * @returns {boolean} Whether the row's PIN centroid falls inside the published Duval bbox.
 */
export function hasInRangePinGeometry(row) {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= PIN_BBOX.minLat &&
    latitude <= PIN_BBOX.maxLat &&
    longitude >= PIN_BBOX.minLng &&
    longitude <= PIN_BBOX.maxLng
  );
}

/**
 * @typedef {object} SeedReconciliationStats
 * @property {number} rowsWritten
 * @property {number} uniqueParcelIds
 * @property {number} expectedSeedRowCount
 * @property {number} unkeyedSourceRecords
 * @property {number} invalidRecordCount
 * @property {number} consolidatedRows
 * @property {number} duplicateGroups
 */

/**
 * Fail closed if a full-seed build's row/uniqueness/dedup counts don't
 * reconcile.
 *
 * @param {SeedReconciliationStats} stats - Seed-build counters.
 * @returns {void}
 */
export function assertSeedReconciliation(stats) {
  if (stats.rowsWritten !== stats.expectedSeedRowCount) {
    throw new Error(`rowsWritten ${stats.rowsWritten} != expectedSeedRowCount ${stats.expectedSeedRowCount}`);
  }
  if (stats.uniqueParcelIds !== stats.expectedSeedRowCount) {
    throw new Error(
      `uniqueParcelIds ${stats.uniqueParcelIds} != expectedSeedRowCount ${stats.expectedSeedRowCount}`,
    );
  }
  if (stats.unkeyedSourceRecords !== stats.invalidRecordCount) {
    throw new Error(
      `unkeyedSourceRecords ${stats.unkeyedSourceRecords} != invalidRecordCount ${stats.invalidRecordCount}`,
    );
  }
  if (stats.consolidatedRows !== stats.duplicateGroups) {
    throw new Error(`consolidatedRows ${stats.consolidatedRows} != duplicateGroups ${stats.duplicateGroups}`);
  }
}

/**
 * Build the Duval seed CSV for the county adapter's `buildSeed(options)`.
 *
 * Callers supply already-joined NAL/PIN/SDF records (the live
 * `floridarevenue.com` download, DOR NAL/SDF/PIN unzip, and DuckDB spatial
 * join that produce those records in production are out of scope for this
 * offline package — see the module doc comment).
 *
 * @param {object} options - Seed inputs.
 * @param {readonly KeyedDuvalRecord[]} options.records - Already-joined NAL/PIN/SDF records, possibly with duplicate `PARCEL_ID`s.
 * @param {string} [options.sourceRevision] - NAL source-file fingerprint. Defaults to `snapshotAt`.
 * @param {string} [options.snapshotAt] - Shared snapshot timestamp. Defaults to now.
 * @param {string} [options.outputPath] - When set, the CSV is written to this path.
 * @returns {Promise<{ rows: Record<string, string>[], csv: string, outputPath: string | null }>}
 *   Deduplicated seed rows, rendered CSV, and the path written (if any).
 */
export async function buildSeed(options) {
  assertSafeSourceFields(NAL_SOURCE_FIELDS);
  const snapshotAt = options.snapshotAt ?? new Date().toISOString();
  const sourceRevision = options.sourceRevision ?? snapshotAt;
  const rows = mergeDuplicateParcels(options.records, { sourceRevision, snapshotAt });
  const csv = renderCsv(SEED_COLUMNS, rows);
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, csv, "utf8");
  }
  return { rows, csv, outputPath: options.outputPath ?? null };
}
