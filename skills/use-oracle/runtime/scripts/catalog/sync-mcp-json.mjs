#!/usr/bin/env node

// New for this kit: writes the merged catalog + overlay MCP env maps directly into the
// repo-root `mcp.json`, replacing the old "copy print-mcp-env-maps.mjs output into
// mcp.json by hand from an oracle-node checkout" workflow. Preserves every unmanaged env
// key (ORACLE_OPEN_DATA_*, ORACLE_GEO_INDEX_IPNS, and anything added later) and the
// bash/npx MCP launcher untouched — only the four catalog-derived keys are rewritten.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

import { buildMergedMcpEnvMaps } from "./merge-mcp-env-maps.mjs";

/**
 * The exact public raw-GitHub URL for this kit's bundled catalog. `listPublishedCounties`,
 * `getPlaceQuerySchema`, and `queryPlaces` read this instead of Oracle's own catalog so the
 * MCP server always matches the catalog this repository ships.
 */
export const PUBLISHED_COUNTY_CATALOG_URL =
  "https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/main/skills/use-oracle/runtime/catalog/published-counties.json";

/** Keys this script fully owns and rewrites on every sync, in their canonical order. */
export const MANAGED_ENV_KEYS = [
  "PROPERTY_QUERY_TABLE_MAP",
  "PERMIT_QUERY_TABLE_MAP",
  "DATASET_COVERAGE_MAP",
  "PUBLISHED_COUNTY_CATALOG_URL",
];

/**
 * This file lives at `skills/use-oracle/runtime/scripts/catalog/sync-mcp-json.mjs`; the
 * repo-root `mcp.json` this script writes is five directories up
 * (`catalog` → `scripts` → `runtime` → `use-oracle` → `skills` → repo root). Resolved from
 * `import.meta.url` rather than `process.cwd()` so this script works the same way no
 * matter where it is invoked from (matches every other path-resolution rule in this
 * package).
 */
export const DEFAULT_MCP_JSON_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../mcp.json",
);

const RUNTIME_CATALOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../catalog",
);

export const DEFAULT_CATALOG_PATH = resolve(
  RUNTIME_CATALOG_DIR,
  "published-counties.json",
);

export const DEFAULT_OVERLAY_PATH = resolve(
  RUNTIME_CATALOG_DIR,
  "mcp-overlays.json",
);

/**
 * Build the four managed env entries as MCP `env`-ready JSON strings.
 *
 * @param {ReturnType<typeof import("./print-mcp-env-maps.mjs").mcpEnvMapsFromCatalog>} maps
 * @returns {Record<string, string>}
 */
export function buildManagedEnvEntries(maps) {
  return {
    PROPERTY_QUERY_TABLE_MAP: JSON.stringify(maps.PROPERTY_QUERY_TABLE_MAP),
    PERMIT_QUERY_TABLE_MAP: JSON.stringify(maps.PERMIT_QUERY_TABLE_MAP),
    DATASET_COVERAGE_MAP: JSON.stringify(maps.DATASET_COVERAGE_MAP),
    PUBLISHED_COUNTY_CATALOG_URL,
  };
}

/**
 * Merge managed entries into an existing `env` object, placing the managed keys first (in
 * {@link MANAGED_ENV_KEYS} order) and preserving every other existing key — and its
 * relative order — untouched. This is how `ORACLE_OPEN_DATA_*` and `ORACLE_GEO_INDEX_IPNS`
 * survive a sync without being named explicitly.
 *
 * @param {Record<string, string>} existingEnv Current `mcpServers.elephant.env`.
 * @param {Record<string, string>} managedEntries From {@link buildManagedEnvEntries}.
 * @returns {Record<string, string>} New env object.
 */
export function mergeEnv(existingEnv, managedEntries) {
  /** @type {Record<string, string>} */
  const merged = {};
  for (const key of MANAGED_ENV_KEYS) {
    merged[key] = managedEntries[key];
  }
  for (const [key, value] of Object.entries(existingEnv ?? {})) {
    if (MANAGED_ENV_KEYS.includes(key)) continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * Read, merge, and rewrite the repo-root `mcp.json`'s `mcpServers.elephant.env`.
 *
 * @param {{ mcpJsonPath?: string, catalogPath?: string, overlayPath?: string }} [options]
 * @returns {Promise<{ mcpJsonPath: string, maps: Awaited<ReturnType<typeof buildMergedMcpEnvMaps>> }>}
 */
export async function syncMcpJson(options = {}) {
  const mcpJsonPath = options.mcpJsonPath ?? DEFAULT_MCP_JSON_PATH;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const overlayPath = options.overlayPath ?? DEFAULT_OVERLAY_PATH;

  if (!existsSync(mcpJsonPath)) {
    throw new Error(`repo-root mcp.json not found at resolved path: ${mcpJsonPath}`);
  }

  const maps = await buildMergedMcpEnvMaps({ catalogPath, overlayPath });
  const managedEntries = buildManagedEnvEntries(maps);

  const root = JSON.parse(await readFile(mcpJsonPath, "utf8"));
  const server = root?.mcpServers?.elephant;
  if (server === undefined || typeof server !== "object") {
    throw new Error(`${mcpJsonPath}: missing mcpServers.elephant`);
  }
  server.env = mergeEnv(server.env, managedEntries);

  await writeFile(mcpJsonPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  return { mcpJsonPath, maps };
}

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const { mcpJsonPath, maps } = await syncMcpJson();
  process.stdout.write(
    `Synced ${mcpJsonPath}: ${Object.keys(maps.PROPERTY_QUERY_TABLE_MAP).length} property, ` +
      `${Object.keys(maps.PERMIT_QUERY_TABLE_MAP).length} permit, ` +
      `${Object.keys(maps.DATASET_COVERAGE_MAP).length} coverage county entries\n`,
  );
}
