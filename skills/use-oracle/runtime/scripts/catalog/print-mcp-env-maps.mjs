#!/usr/bin/env node

// Ported from `oracle-node@ff68b0b6812598d07e0f4aaa322ddbfe230f20b9`
// `scripts/print-mcp-env-maps.mjs`. Behavior is unchanged; the default catalog path
// resolves from this file's own location under the bundled runtime, never a sibling
// `oracle-node` checkout.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {object} PublishedCounty
 * @property {string} countyKey
 * @property {string | null} [queryTableUrl]
 * @property {string | null} [permitQueryTableUrl]
 * @property {string | null} [datasetCoverageUrl]
 */

/**
 * @typedef {object} PublishedCountyCatalog
 * @property {PublishedCounty[]} counties
 */

/**
 * Build Elephant MCP env maps from the published-county catalog.
 * Counties without a URL for a given field are omitted from that map.
 *
 * @param {PublishedCountyCatalog} catalog Canonical catalog JSON.
 * @returns {{ PROPERTY_QUERY_TABLE_MAP: Record<string, string>, PERMIT_QUERY_TABLE_MAP: Record<string, string>, DATASET_COVERAGE_MAP: Record<string, string> }}
 */
export function mcpEnvMapsFromCatalog(catalog) {
  const counties = Array.isArray(catalog?.counties) ? catalog.counties : [];

  /**
   * @param {keyof PublishedCounty} field
   * @returns {Record<string, string>}
   */
  function mapField(field) {
    const entries = counties
      .filter(
        (county) =>
          typeof county.countyKey === "string" &&
          typeof county[field] === "string" &&
          county[field].length > 0,
      )
      .map((county) => [county.countyKey, county[field]]);
    const seen = new Set();
    for (const [countyKey] of entries) {
      if (seen.has(countyKey)) {
        throw new Error(
          `Duplicate countyKey "${countyKey}" while building ${field}`,
        );
      }
      seen.add(countyKey);
    }
    return Object.fromEntries(entries);
  }

  return {
    PROPERTY_QUERY_TABLE_MAP: mapField("queryTableUrl"),
    PERMIT_QUERY_TABLE_MAP: mapField("permitQueryTableUrl"),
    DATASET_COVERAGE_MAP: mapField("datasetCoverageUrl"),
  };
}

/**
 * JSON-encode each map so values paste into MCP `env` as a JSON string.
 *
 * @param {ReturnType<typeof mcpEnvMapsFromCatalog>} maps
 * @returns {Record<string, string>}
 */
export function stringifyMcpEnvMaps(maps) {
  return Object.fromEntries(
    Object.entries(maps).map(([name, value]) => [name, JSON.stringify(value)]),
  );
}

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const catalogPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../catalog/published-counties.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  process.stdout.write(
    `${JSON.stringify(stringifyMcpEnvMaps(mcpEnvMapsFromCatalog(catalog)), null, 2)}\n`,
  );
}
