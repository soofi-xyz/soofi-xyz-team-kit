/**
 * Pinellas seed-row construction from PublicWebGIS parcel features.
 *
 * Adapted from `oracle-node@ff68b0b6`
 * `scripts/build-pinellas-pilot-seed.mjs` (`toSeedRow`, `buildPrintUrl`,
 * `isValidStrap`, `classifyGeometry`, `dedupeByStrap`, `SEED_COLUMNS`),
 * trimmed to the single-parcel `buildSeed` path this package's CLI/replay
 * needs (the county-wide GIS pagination/use-code-quota logic in the source
 * script is intentionally not ported — see the Task 2 report).
 *
 * @module counties/pinellas/seed
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { renderCsv } from "../../core/csv.mjs";

export const PRINT_URL = "https://www.pcpao.gov/property/detail/print";
export const COUNTY_NAME = "Pinellas";
export const COUNTY_FIPS = "12103";
export const GIS_PARCELS_URL =
  "https://egis.pinellas.gov/gis/rest/services/PublicWebGIS/Parcels/MapServer/1";

/**
 * Stable CSV column order for a Pinellas seed row.
 *
 * @type {readonly string[]}
 */
export const SEED_COLUMNS = Object.freeze([
  "parcel_id",
  "source_identifier",
  "situs_address",
  "method",
  "url",
  "multiValueQueryString",
  "address",
  "city",
  "state",
  "zip",
  "county",
  "county_fips",
  "use_code",
  "use_group",
  "parcelid",
  "parcelid_display",
  "geometry_type",
  "ring_count",
  "vertex_count",
  "acres",
  "latitude",
  "longitude",
  "parcel_polygon",
  "source_url",
  "source_snapshot_at",
]);

/**
 * @typedef {object} GeoJsonPolygon
 * @property {"Polygon"} type
 * @property {number[][][]} coordinates
 */

/**
 * @typedef {object} GeoJsonMultiPolygon
 * @property {"MultiPolygon"} type
 * @property {number[][][][]} coordinates
 */

/**
 * @typedef {GeoJsonPolygon | GeoJsonMultiPolygon} ParcelGeometry
 */

/**
 * @typedef {object} GisFeature
 * @property {Record<string, unknown>} properties
 * @property {ParcelGeometry | null} geometry
 */

/**
 * Coerce an unknown GIS attribute to a trimmed string.
 *
 * @param {unknown} value - Attribute value.
 * @returns {string} Trimmed text, or empty string.
 */
export function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Return whether a value is an 18-digit Pinellas STRAP.
 *
 * @param {unknown} value - Candidate parcel identifier.
 * @returns {boolean} True only for exactly 18 digits.
 */
export function isValidStrap(value) {
  return /^[0-9]{18}$/.test(toText(value));
}

/**
 * Build the PCPAO print-page URL for a STRAP.
 *
 * @param {string} strap - 18-digit STRAP.
 * @returns {string} Absolute print URL.
 */
export function buildPrintUrl(strap) {
  return `${PRINT_URL}?is_print=1&s=${encodeURIComponent(strap)}`;
}

/**
 * Classify WGS84 parcel geometry for seed metadata.
 *
 * @param {ParcelGeometry | null} geometry - GeoJSON geometry.
 * @returns {{ geometryType: string, ringCount: number, vertexCount: number, latitude: string, longitude: string }}
 *   Geometry classification and centroid.
 */
export function classifyGeometry(geometry) {
  if (geometry === null || !Array.isArray(geometry.coordinates)) {
    return { geometryType: "empty", ringCount: 0, vertexCount: 0, latitude: "", longitude: "" };
  }
  /** @type {number[][][]} */
  const rings = [];
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) rings.push(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) rings.push(ring);
    }
  }
  const vertexCount = rings.reduce((sum, ring) => sum + ring.length, 0);
  const ringCount = rings.length;
  const geometryType =
    ringCount > 1 ? "multi-polygon" : vertexCount > 20 ? "complex-polygon" : "simple-polygon";
  const firstPoint = rings[0]?.[0];
  return {
    geometryType,
    ringCount,
    vertexCount,
    longitude: firstPoint ? String(firstPoint[0]) : "",
    latitude: firstPoint ? String(firstPoint[1]) : "",
  };
}

/**
 * Convert a PublicWebGIS feature into one Pinellas seed row.
 *
 * @param {GisFeature} feature - GIS feature with WGS84 geometry.
 * @param {string} useGroup - Free-text quota/use-group label.
 * @param {string} snapshotAt - ISO timestamp shared by the snapshot.
 * @returns {Record<string, string>} CSV row keyed by {@link SEED_COLUMNS}.
 */
export function toSeedRow(feature, useGroup, snapshotAt) {
  const properties = feature.properties;
  const strap = toText(properties.STRAP);
  if (!isValidStrap(strap)) {
    throw new Error(`Invalid STRAP for seed row: ${strap}`);
  }
  const stats = classifyGeometry(feature.geometry);
  const city = toText(properties.SITE_CITY);
  const zip = toText(properties.SITE_ZIP);
  const street = toText(properties.SITE_ADDRESS);
  const addressParts = [street, [city, "FL", zip].filter(Boolean).join(" ")].filter(
    (part) => part.length > 0,
  );
  const address = addressParts.join(", ");
  return {
    parcel_id: strap,
    source_identifier: strap,
    situs_address: address,
    method: "GET",
    url: PRINT_URL,
    multiValueQueryString: JSON.stringify({ is_print: ["1"], s: [strap] }),
    address,
    city,
    state: toText(properties.SITE_STATE) || "FL",
    zip,
    county: COUNTY_NAME,
    county_fips: COUNTY_FIPS,
    use_code: toText(properties.USE_CODE),
    use_group: useGroup,
    parcelid: toText(properties.PARCELID),
    parcelid_display: toText(properties.PARCELID_DSP1),
    geometry_type: stats.geometryType,
    ring_count: String(stats.ringCount),
    vertex_count: String(stats.vertexCount),
    acres: toText(properties.Acres),
    latitude: stats.latitude,
    longitude: stats.longitude,
    parcel_polygon: feature.geometry === null ? "" : JSON.stringify(feature.geometry),
    source_url: GIS_PARCELS_URL,
    source_snapshot_at: snapshotAt,
  };
}

/**
 * Deduplicate candidate rows by STRAP, keeping the first occurrence.
 *
 * @param {readonly Record<string, string>[]} rows - Candidate seed rows.
 * @returns {Record<string, string>[]} Unique STRAP rows.
 */
export function dedupeByStrap(rows) {
  const seen = new Set();
  /** @type {Record<string, string>[]} */
  const unique = [];
  for (const row of rows) {
    const strap = row.parcel_id;
    if (!isValidStrap(strap)) {
      throw new Error(`Cannot stage a non-STRAP parcel_id: ${strap}`);
    }
    if (seen.has(strap)) continue;
    seen.add(strap);
    unique.push(row);
  }
  return unique;
}

/**
 * Build Pinellas seed rows from already-fetched GIS features (the network
 * query itself is out of scope for this package; callers supply features).
 *
 * @param {object} options - Seed inputs.
 * @param {readonly GisFeature[]} options.features - GIS features to stage.
 * @param {string} [options.useGroup] - Use-group label applied to every row. Defaults to `"unspecified"`.
 * @param {string} [options.snapshotAt] - Shared snapshot timestamp. Defaults to now.
 * @returns {Record<string, string>[]} Deduplicated seed rows.
 */
export function buildSeedRows({ features, useGroup = "unspecified", snapshotAt = new Date().toISOString() }) {
  const rows = features
    .filter((feature) => isValidStrap(feature.properties.STRAP))
    .map((feature) => toSeedRow(feature, useGroup, snapshotAt));
  return dedupeByStrap(rows);
}

/**
 * Build the Pinellas seed CSV for the county adapter's `buildSeed(options)`.
 *
 * @param {object} options - Seed inputs.
 * @param {readonly GisFeature[]} options.features - GIS features to stage.
 * @param {string} [options.outputPath] - When set, the CSV is written to this path.
 * @param {string} [options.useGroup] - Use-group label applied to every row.
 * @param {string} [options.snapshotAt] - Shared snapshot timestamp.
 * @returns {Promise<{ rows: Record<string, string>[], csv: string, outputPath: string | null }>}
 *   Seed rows, rendered CSV, and the path written (if any).
 */
export async function buildSeed(options) {
  const rows = buildSeedRows(options);
  const csv = renderCsv(SEED_COLUMNS, rows);
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(options.outputPath, csv, "utf8");
  }
  return { rows, csv, outputPath: options.outputPath ?? null };
}
