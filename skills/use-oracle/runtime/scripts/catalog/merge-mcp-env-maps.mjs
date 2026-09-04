#!/usr/bin/env node

// New for this kit: `oracle-node`'s catalog has no concept of counties published to the
// MCP env maps outside the canonical catalog. This kit needs one — currently
// `santa-clara` — so `catalog/mcp-overlays.json` carries just the URL fields the MCP env
// maps need for those counties, and this module merges them with the catalog-derived maps
// from `print-mcp-env-maps.mjs`. Overlay entries never override a catalog entry: a
// countyKey must live in exactly one of the catalog or the overlay.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mcpEnvMapsFromCatalog, stringifyMcpEnvMaps } from "./print-mcp-env-maps.mjs";

/**
 * @typedef {object} McpOverlayCounty
 * @property {string} countyKey
 * @property {string | null} [queryTableUrl]
 * @property {string | null} [permitQueryTableUrl]
 * @property {string | null} [datasetCoverageUrl]
 */

/**
 * @typedef {object} McpOverlayFile
 * @property {McpOverlayCounty[]} counties
 */

/**
 * Build Elephant MCP env maps from the overlay file, using the same
 * "omit null/empty, reject duplicate countyKey per field" rules as the catalog maps.
 *
 * @param {McpOverlayFile} overlay Parsed `mcp-overlays.json`.
 * @returns {ReturnType<typeof mcpEnvMapsFromCatalog>}
 */
export function mcpEnvMapsFromOverlay(overlay) {
  // The overlay's per-county shape is a strict subset of the catalog's per-county shape
  // (only the three URL fields the env maps read), so the catalog mapper can build the
  // overlay maps too.
  return mcpEnvMapsFromCatalog(overlay);
}

/**
 * Validate that the overlay never duplicates a catalog countyKey — an overlay county is,
 * by definition, one the canonical catalog does not (yet) carry.
 *
 * @param {McpOverlayFile} overlay Parsed `mcp-overlays.json`.
 * @param {{ counties: { countyKey: string }[] }} catalog Parsed `published-counties.json`.
 * @returns {void}
 */
export function assertOverlayDisjointFromCatalog(overlay, catalog) {
  const catalogKeys = new Set(
    (catalog?.counties ?? []).map((county) => county.countyKey),
  );
  for (const county of overlay?.counties ?? []) {
    if (catalogKeys.has(county.countyKey)) {
      throw new Error(
        `overlay countyKey '${county.countyKey}' is already in the published catalog; ` +
          "remove it from mcp-overlays.json and rely on the catalog entry instead",
      );
    }
  }
}

/**
 * Merge catalog-derived and overlay-derived MCP env maps. A countyKey may appear in at
 * most one source per field (enforced by {@link assertOverlayDisjointFromCatalog} at the
 * whole-catalog level, and defensively re-checked here per field).
 *
 * @param {ReturnType<typeof mcpEnvMapsFromCatalog>} catalogMaps
 * @param {ReturnType<typeof mcpEnvMapsFromCatalog>} overlayMaps
 * @returns {ReturnType<typeof mcpEnvMapsFromCatalog>}
 */
export function mergeMcpEnvMaps(catalogMaps, overlayMaps) {
  /** @type {Record<string, Record<string, string>>} */
  const merged = {};
  for (const field of [
    "PROPERTY_QUERY_TABLE_MAP",
    "PERMIT_QUERY_TABLE_MAP",
    "DATASET_COVERAGE_MAP",
  ]) {
    const catalogField = catalogMaps[field] ?? {};
    const overlayField = overlayMaps[field] ?? {};
    for (const countyKey of Object.keys(overlayField)) {
      if (Object.hasOwn(catalogField, countyKey)) {
        throw new Error(
          `countyKey '${countyKey}' appears in both the catalog and the overlay for ${field}`,
        );
      }
    }
    merged[field] = { ...catalogField, ...overlayField };
  }
  return /** @type {ReturnType<typeof mcpEnvMapsFromCatalog>} */ (merged);
}

/**
 * Load the catalog and overlay JSON files and return the fully merged MCP env maps.
 *
 * @param {{ catalogPath: string, overlayPath: string }} paths Absolute file paths.
 * @returns {Promise<ReturnType<typeof mcpEnvMapsFromCatalog>>}
 */
export async function buildMergedMcpEnvMaps({ catalogPath, overlayPath }) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  assertOverlayDisjointFromCatalog(overlay, catalog);
  return mergeMcpEnvMaps(mcpEnvMapsFromCatalog(catalog), mcpEnvMapsFromOverlay(overlay));
}

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const runtimeCatalogDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../catalog",
  );
  const maps = await buildMergedMcpEnvMaps({
    catalogPath: resolve(runtimeCatalogDir, "published-counties.json"),
    overlayPath: resolve(runtimeCatalogDir, "mcp-overlays.json"),
  });
  process.stdout.write(`${JSON.stringify(stringifyMcpEnvMaps(maps), null, 2)}\n`);
}
