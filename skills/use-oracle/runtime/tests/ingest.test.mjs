import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsvRecords } from "../src/core/csv.mjs";
import { readTransformedZipJsonFiles } from "../src/core/query-table.mjs";
import {
  parseSeedQueryString,
  buildPrintPageUrl,
  buildSourceHttpRequest,
  buildSeedJsonFiles,
  hasCompletedTransform,
  captureAndTransform,
  validateRun,
  pinellasAdapter,
  ZIP_LOCAL_FILE_MAGIC,
  TRANSFORMS_DIR,
} from "../src/counties/pinellas/adapter.mjs";

const RUNTIME_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(RUNTIME_ROOT, "fixtures", "pinellas-replay");
const STRAP = "162805389030000430";

async function loadFixtureSeedRows() {
  return parseCsvRecords(await readFile(path.join(FIXTURE_DIR, "seed.csv"), "utf8"));
}

describe("Pinellas capture request/seed-file construction", () => {
  it("defaults an empty multiValueQueryString to is_print=1/s=<strap>", () => {
    expect(parseSeedQueryString(undefined, STRAP)).toEqual({ is_print: ["1"], s: [STRAP] });
    expect(parseSeedQueryString("not json", STRAP)).toEqual({ is_print: ["1"], s: [STRAP] });
  });

  it("parses a well-formed multiValueQueryString JSON object", () => {
    expect(parseSeedQueryString('{"is_print":["1"],"s":["162805389030000430"]}', STRAP)).toEqual({
      is_print: ["1"],
      s: [STRAP],
    });
  });

  it("builds the print URL with is_print and s query params", () => {
    const url = new URL(buildPrintPageUrl(STRAP));
    expect(url.origin + url.pathname).toBe("https://www.pcpao.gov/property/detail/print");
    expect(url.searchParams.get("is_print")).toBe("1");
    expect(url.searchParams.get("s")).toBe(STRAP);
  });

  it("builds a source_http_request whose url has no query string", async () => {
    const [row] = await loadFixtureSeedRows();
    const request = buildSourceHttpRequest(row);
    expect(request.url).toBe("https://www.pcpao.gov/property/detail/print");
    expect(request.url).not.toContain("?");
    expect(request.multiValueQueryString).toEqual({ is_print: ["1"], s: [STRAP] });
  });

  it("builds property_seed.json / unnormalized_address.json seed files from the fixture row", async () => {
    const [row] = await loadFixtureSeedRows();
    const { propertySeed, unnormalizedAddress } = buildSeedJsonFiles(row);
    expect(propertySeed.parcel_id).toBe(STRAP);
    expect(propertySeed.request_identifier).toBe(STRAP);
    expect(unnormalizedAddress.full_address).toBe("3400 RUGBY CT, PALM HARBOR FL 34684");
    expect(unnormalizedAddress.county_jurisdiction).toBe("Pinellas");
  });

  it("reports no completed transform for a directory with no transformed.zip", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-no-zip-"));
    try {
      expect(await hasCompletedTransform(tempDir)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("captureAndTransform (Gate B fixture, no network)", () => {
  it("only ships the five allow-listed production transform scripts (no backup/node_modules)", async () => {
    const { readdir } = await import("node:fs/promises");
    const entries = (await readdir(TRANSFORMS_DIR)).filter((name) => name !== "package.json");
    expect(entries.sort()).toEqual(
      ["data_extractor.js", "layoutMapping.js", "ownerMapping.js", "structureMapping.js", "utilityMapping.js"].sort(),
    );
  });

  it("transforms the synthetic parcel from fixture HTML into a valid ZIP with the required JSON", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-ingest-"));
    try {
      const seedRows = await loadFixtureSeedRows();
      const outputDir = path.join(tempDir, "ingest");
      const manifest = await captureAndTransform({
        seedRows,
        htmlDir: path.join(FIXTURE_DIR, "html"),
        outputDir,
        liveFetch: false,
      });

      expect(manifest.county).toBe("pinellas");
      expect(manifest.results).toEqual([
        { parcelId: STRAP, transformSuccess: true, propertyUsageType: "Residential", error: null },
      ]);

      const zipPath = path.join(outputDir, STRAP, "transformed.zip");
      const zipBytes = await readFile(zipPath);
      expect(zipBytes.subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_MAGIC);
      expect(await hasCompletedTransform(path.join(outputDir, STRAP))).toBe(true);

      const files = readTransformedZipJsonFiles(zipPath);
      for (const required of ["property.json", "parcel.json", "address.json", "lot.json"]) {
        expect(files[required], `missing data/${required}`).toBeDefined();
      }

      const manifestOnDisk = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
      expect(manifestOnDisk).toEqual(manifest);

      const validation = await validateRun(manifest);
      expect(validation).toEqual({ valid: true, checked: 1, issues: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when a STRAP has no local HTML fixture and liveFetch is not requested", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-missing-html-"));
    try {
      const [fixtureRow] = await loadFixtureSeedRows();
      const missingRow = { ...fixtureRow, parcel_id: "999999999999999999", source_identifier: "999999999999999999" };
      const outputDir = path.join(tempDir, "ingest");
      const manifest = await captureAndTransform({
        seedRows: [missingRow],
        htmlDir: path.join(FIXTURE_DIR, "html"),
        outputDir,
        liveFetch: false,
      });
      expect(manifest.results).toHaveLength(1);
      expect(manifest.results[0].transformSuccess).toBe(false);
      expect(manifest.results[0].error).toMatch(/No local HTML fixture/);
      expect(manifest.results[0].error).toMatch(/--live-fetch was not supplied/);

      const validation = await validateRun(manifest);
      expect(validation.valid).toBe(false);
      expect(validation.issues).toHaveLength(1);
      expect(validation.issues[0].parcelId).toBe("999999999999999999");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not attempt a live PCPAO fetch (no network call) for a fixture-covered STRAP even without --live-fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("captureAndTransform must not call fetch() when a fixture HTML file is present");
    };
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-no-network-"));
    try {
      const seedRows = await loadFixtureSeedRows();
      const manifest = await captureAndTransform({
        seedRows,
        htmlDir: path.join(FIXTURE_DIR, "html"),
        outputDir: path.join(tempDir, "ingest"),
        liveFetch: false,
      });
      expect(manifest.results[0].transformSuccess).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("exposes the same captureAndTransform/validateRun functions on the pinellasAdapter object", () => {
    expect(pinellasAdapter.captureAndTransform).toBe(captureAndTransform);
    expect(pinellasAdapter.validateRun).toBe(validateRun);
    expect(pinellasAdapter.key).toBe("pinellas");
    expect(pinellasAdapter.countyName).toBe("Pinellas");
  });
});
