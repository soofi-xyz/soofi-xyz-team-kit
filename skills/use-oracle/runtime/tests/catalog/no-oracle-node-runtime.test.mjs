import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG_PATH } from "../../scripts/catalog/update-published-county-catalog.mjs";
import {
  DEFAULT_MCP_JSON_PATH,
  DEFAULT_OVERLAY_PATH,
  PUBLISHED_COUNTY_CATALOG_URL,
} from "../../scripts/catalog/sync-mcp-json.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testDir, "../..");
const catalogScriptsDir = resolve(runtimeRoot, "scripts/catalog");
const catalogDataDir = resolve(runtimeRoot, "catalog");

/**
 * Load and parse a catalog-style JSON file (either the published-county catalog or the
 * MCP overlay file), which both use a `{ counties: [...] }` shape.
 *
 * @param {string} path Absolute file path.
 * @returns {Promise<{ counties: Array<Record<string, unknown>> }>}
 */
async function loadCatalogLike(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("catalog self-containment (no oracle-node at runtime)", () => {
  it("rejects Pasco from the bundled catalog (locked decision: no Pasco)", async () => {
    const catalog = await loadCatalogLike(DEFAULT_CATALOG_PATH);
    const keys = catalog.counties.map((county) => county.countyKey);

    expect(keys).not.toContain("pasco");
  });

  it("rejects a catalogized Santa Clara — it must stay overlay-only", async () => {
    const catalog = await loadCatalogLike(DEFAULT_CATALOG_PATH);
    const keys = catalog.counties.map((county) => county.countyKey);

    expect(keys).not.toContain("santa-clara");
  });

  it("rejects an overlay entry for Seminole — it must stay catalog-only", async () => {
    const overlay = await loadCatalogLike(DEFAULT_OVERLAY_PATH);
    const keys = overlay.counties.map((county) => county.countyKey);

    expect(keys).not.toContain("seminole");
    expect(keys).toEqual(["santa-clara"]);
  });

  it("PUBLISHED_COUNTY_CATALOG_URL points at this repository, never oracle-node", () => {
    expect(PUBLISHED_COUNTY_CATALOG_URL).toBe(
      "https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/main/skills/use-oracle/runtime/catalog/published-counties.json",
    );
    expect(PUBLISHED_COUNTY_CATALOG_URL).toContain("soofi-xyz/soofi-xyz-team-kit");
    expect(PUBLISHED_COUNTY_CATALOG_URL.toLowerCase()).not.toContain("oracle-node");
  });

  it("every default catalog-related path resolves inside this bundled runtime, never a sibling oracle-node checkout", () => {
    for (const path of [DEFAULT_CATALOG_PATH, DEFAULT_OVERLAY_PATH, DEFAULT_MCP_JSON_PATH]) {
      expect(path.toLowerCase()).not.toContain("oracle-node");
      expect(path).toContain("soofi-xyz-team-kit");
    }
    expect(DEFAULT_CATALOG_PATH).toContain("skills/use-oracle/runtime/catalog");
    expect(DEFAULT_OVERLAY_PATH).toContain("skills/use-oracle/runtime/catalog");
  });

  it("no catalog script under scripts/catalog references an oracle-node runtime URL or path", async () => {
    const entries = await readdir(catalogScriptsDir);
    const scriptFiles = entries.filter((name) => name.endsWith(".mjs"));
    expect(scriptFiles.length).toBeGreaterThan(0);

    for (const name of scriptFiles) {
      const source = await readFile(resolve(catalogScriptsDir, name), "utf8");
      // Provenance comments may cite the historical commit `oracle-node@ff68b0b6...` as
      // documentation, but no script may construct a runtime URL/path from the literal
      // string "oracle-node" (e.g. a default fetch target or sibling-checkout path).
      const functionalLines = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"));
      for (const line of functionalLines) {
        expect(line.toLowerCase()).not.toContain("oracle-node");
      }
    }
  });

  it("no catalog JSON file under catalog/ mentions oracle-node", async () => {
    const entries = await readdir(catalogDataDir);
    const jsonFiles = entries.filter((name) => name.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);

    for (const name of jsonFiles) {
      const source = await readFile(resolve(catalogDataDir, name), "utf8");
      expect(source.toLowerCase()).not.toContain("oracle-node");
    }
  });
});
