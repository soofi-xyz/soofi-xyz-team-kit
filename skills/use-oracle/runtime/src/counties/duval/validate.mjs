/**
 * Duval post-capture validation helpers: geometry bbox, manifest
 * reconciliation, parcel-id uniqueness, and labeled-field completeness
 * scoring against `counties/duval/static-parts.csv`.
 *
 * Adapted from `oracle-node@ff68b0b6` `scripts/duval/validate-lib.mjs`
 * (`DUVAL_VALIDATION_BBOX`, `collectGeometryPoints`,
 * `assertGeometryInCounty`, `parseStaticPartSelectors`,
 * `scoreLabeledFieldCoverage`, `classifyValidationGap`) and
 * `scripts/duval/pilot-lib.mjs` (`assertManifestReconciled`), trimmed to
 * offline structural checks. Never calls `@elephant-xyz/cli`'s
 * `transform`/`validate` (Global Constraint: never call
 * `@elephant-xyz/cli validate`) — `validate-duval-appraisal.mjs`'s CLI
 * lexicon-validation pass is intentionally not ported.
 *
 * @module counties/duval/validate
 */

import * as cheerio from "cheerio";

/** Task 7 geometry gate from `docs/duval-pilot-plan.md` (tighter than `seed.mjs`'s published `PIN_BBOX`). */
export const DUVAL_VALIDATION_BBOX = Object.freeze({
  minLat: 30.103,
  maxLat: 30.586,
  minLng: -82.05,
  maxLng: -81.318,
});

/**
 * @param {string} csvText - `static-parts.csv` contents (one CSS selector per row).
 * @returns {string[]} CSS selectors for COJ page chrome to exclude from completeness scoring.
 */
export function parseStaticPartSelectors(csvText) {
  const selectors = [];
  for (const rawLine of csvText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^cssselector$/i.test(line.replaceAll('"', ""))) continue;
    const unquoted = line.replace(/^"|"$/g, "").trim();
    if (unquoted) selectors.push(unquoted);
  }
  return selectors;
}

/**
 * @param {unknown} record - A transformed `data/*.json` object (e.g. `geometry.json`, `geometry_parcel_<n>.json`).
 * @returns {Array<{ latitude: number, longitude: number }>} Every finite lat/lon pair found on the record or its `polygon` array.
 */
export function collectGeometryPoints(record) {
  /** @type {Array<{ latitude: number, longitude: number }>} */
  const points = [];
  if (!record || typeof record !== "object") return points;
  const body = /** @type {Record<string, unknown>} */ (record);
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    points.push({ latitude: lat, longitude: lon });
  }
  if (Array.isArray(body.polygon)) {
    for (const vertex of body.polygon) {
      if (!vertex || typeof vertex !== "object") continue;
      const vertexLat = Number(/** @type {Record<string, unknown>} */ (vertex).latitude);
      const vertexLon = Number(/** @type {Record<string, unknown>} */ (vertex).longitude);
      if (Number.isFinite(vertexLat) && Number.isFinite(vertexLon)) {
        points.push({ latitude: vertexLat, longitude: vertexLon });
      }
    }
  }
  return points;
}

/**
 * Fail closed if a parcel's geometry points fall outside the Duval bbox, or
 * if there is no geometry at all.
 *
 * @param {Array<{ latitude: number, longitude: number }>} points - Points from {@link collectGeometryPoints}.
 * @returns {void}
 */
export function assertGeometryInCounty(points) {
  if (!points.length) {
    throw new Error("geometry is missing a centroid or polygon");
  }
  const { minLat, maxLat, minLng, maxLng } = DUVAL_VALIDATION_BBOX;
  for (const point of points) {
    if (point.latitude < minLat || point.latitude > maxLat || point.longitude < minLng || point.longitude > maxLng) {
      throw new Error(`coordinate ${point.latitude},${point.longitude} is outside the Duval bbox`);
    }
  }
}

/**
 * Completeness stand-in: labeled COJ body fields that are not chrome listed
 * in `counties/duval/static-parts.csv`, measured against transform JSON
 * text. Used because `@elephant-xyz/cli` is never invoked by this package
 * (Global Constraint).
 *
 * @param {string} html - Captured COJ detail-page HTML.
 * @param {readonly string[]} staticSelectors - Chrome selectors to exclude, from {@link parseStaticPartSelectors}.
 * @param {string} transformJsonText - Concatenated transformed `data/*.json` text.
 * @returns {{ onPage: number, inTransform: number, ratio: number, missing: string[] }} Coverage summary.
 */
export function scoreLabeledFieldCoverage(html, staticSelectors, transformJsonText) {
  const $ = cheerio.load(html);
  const staticSet = new Set(staticSelectors);
  const blob = transformJsonText.toLowerCase();
  let onPage = 0;
  let inTransform = 0;
  /** @type {string[]} */
  const missing = [];

  $("[id]").each((_, element) => {
    const id = $(element).attr("id") ?? "";
    if (!id.startsWith("ctl00_cphBody_lbl")) return;
    const selector = `#${id}`;
    if (staticSet.has(selector)) return;
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    onPage += 1;
    const needle = text.toLowerCase();
    const compact = needle.replace(/[^a-z0-9]+/g, "");
    if (blob.includes(needle) || (compact.length >= 6 && blob.includes(compact))) {
      inTransform += 1;
    } else {
      missing.push(text);
    }
  });

  return { onPage, inTransform, ratio: onPage === 0 ? 1 : inTransform / onPage, missing };
}

/**
 * @param {string} message - A validation-failure message.
 * @returns {"extractor" | "capture" | "lexicon"} Coarse gap classification.
 */
export function classifyValidationGap(message) {
  const lowered = message.toLowerCase();
  if (
    /enum|additionalproperties|unexpected property|missing required property|schema|lexicon|must match|must be equal|normalized version/.test(
      lowered,
    )
  ) {
    return "lexicon";
  }
  if (/labeled field|absent from json|not captured|static part/.test(lowered)) {
    return "capture";
  }
  return "extractor";
}

/**
 * @typedef {object} ManifestReconciliation
 * @property {number} seedRows - Seed rows attempted.
 * @property {number} success - Parcels that transformed successfully.
 * @property {number} permanentFailure - Parcels that failed with a non-retryable classification.
 * @property {number} retryableFailure - Parcels that failed with a transient/unknown classification.
 */

/**
 * Fail closed unless every seed row landed in exactly one of the three
 * outcome buckets (Global Constraint: `seed = success + permanent_failure +
 * retryable_failure`).
 *
 * @param {ManifestReconciliation} reconciled - Manifest outcome counts.
 * @returns {void}
 */
export function assertManifestReconciled(reconciled) {
  const total = reconciled.success + reconciled.permanentFailure + reconciled.retryableFailure;
  if (reconciled.seedRows !== total) {
    throw new Error(
      `manifest seedRows ${reconciled.seedRows} != success ${reconciled.success} + permanentFailure ${reconciled.permanentFailure} + retryableFailure ${reconciled.retryableFailure}`,
    );
  }
}

/**
 * Fail closed on a duplicate `parcelId` across an ingest run's results
 * (Global Constraint: unique parcel IDs).
 *
 * @param {readonly { parcelId: string }[]} results - Per-parcel ingest results.
 * @returns {void}
 */
export function assertUniqueParcelIds(results) {
  const ids = results.map((result) => result.parcelId);
  const distinct = new Set(ids);
  if (distinct.size !== ids.length) {
    throw new Error(`manifest results have duplicate parcelId values (${ids.length} rows, ${distinct.size} distinct)`);
  }
}
