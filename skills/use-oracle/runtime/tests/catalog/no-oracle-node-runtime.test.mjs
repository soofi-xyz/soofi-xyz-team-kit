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
const repoRoot = resolve(runtimeRoot, "../../..");
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
  it("includes the reviewed Pasco and Osceola publications", async () => {
    const catalog = await loadCatalogLike(DEFAULT_CATALOG_PATH);
    const keys = catalog.counties.map((county) => county.countyKey);

    expect(keys).toContain("pasco");
    expect(keys).toContain("osceola");
  });

  it("rejects a catalogized Santa Clara — it must stay overlay-only", async () => {
    const catalog = await loadCatalogLike(DEFAULT_CATALOG_PATH);
    const keys = catalog.counties.map((county) => county.countyKey);

    expect(keys).not.toContain("santa-clara");
  });

  it("keeps CSV-parcel OpenDoor counties overlay-only, never catalogized", async () => {
    const catalog = await loadCatalogLike(DEFAULT_CATALOG_PATH);
    const keys = catalog.counties.map((county) => county.countyKey);

    for (const county of [
      "sumter",
      "alachua",
      "okaloosa",
      "bay",
      "walton",
      "holmes",
      "jackson",
      "leon",
      "levy",
      "flagler",
      "brevard",
      "indian-river",
      "hardee",
      "hendry",
      "monroe",
    ]) {
      expect(keys).not.toContain(county);
    }
  });

  it("keeps base counties catalog-only while allowing distinct HOA/PM overlays", async () => {
    const overlay = await loadCatalogLike(DEFAULT_OVERLAY_PATH);
    const keys = overlay.counties.map((county) => county.countyKey);

    expect(keys).not.toContain("seminole");
    expect(keys).toEqual([
      "broward-hoa-pm",
      "duval-hoa-pm",
      "hillsborough-hoa-pm",
      "lee-hoa-pm",
      "miami-dade-hoa-pm",
      "orange-hoa-pm",
      "osceola-hoa-pm",
      "palm-beach-hoa-pm",
      "pasco-hoa-pm",
      "pinellas-hoa-pm",
      "polk-hoa-pm",
      "seminole-hoa-pm",
      "clay-hoa-pm",
      "hernando-hoa-pm",
      "lake-hoa-pm",
      "manatee-hoa-pm",
      "marion-hoa-pm",
      "sarasota-hoa-pm",
      "st-johns-hoa-pm",
      "volusia-hoa-pm",
      "clay",
      "hernando",
      "lake",
      "manatee",
      "marion",
      "santa-clara",
      "sarasota",
      "st-johns",
      "volusia",
      "sumter",
      "alachua",
      "okaloosa",
      "bay",
      "walton",
      "holmes",
      "jackson",
      "leon",
      "levy",
      "flagler",
      "brevard",
      "indian-river",
      "hardee",
      "hendry",
      "monroe",
    ]);
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
      expect(path.startsWith(repoRoot)).toBe(true);
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
