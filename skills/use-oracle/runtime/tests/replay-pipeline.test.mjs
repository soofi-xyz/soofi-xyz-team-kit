import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

import { runReplay } from "../src/core/replay.mjs";
import { pinellasAdapter } from "../src/counties/pinellas/adapter.mjs";
import { ZIP_LOCAL_FILE_MAGIC } from "../src/counties/pinellas/adapter.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");

const RUNTIME_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(RUNTIME_ROOT, "fixtures", "pinellas-replay");
const CLI_PATH = path.join(RUNTIME_ROOT, "bin", "elephant-county.mjs");
const STRAP = "162805389030000430";

async function readParquetRows(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  try {
    const cursor = reader.getCursor();
    const rows = [];
    let record = await cursor.next();
    while (record) {
      rows.push(record);
      record = await cursor.next();
    }
    return rows;
  } finally {
    await reader.close();
  }
}

describe("runReplay (in-process pipeline)", () => {
  it("runs the full offline pipeline: seed -> capture/transform -> artifacts -> credential-free dry-run", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-replay-inprocess-"));
    try {
      const replay = await runReplay({
        adapter: pinellasAdapter,
        fixtureDir: FIXTURE_DIR,
        outputDir: tempDir,
        skipValidate: false,
      });

      expect(replay.seedRows).toHaveLength(1);
      expect(replay.manifest.results).toEqual([
        { parcelId: STRAP, transformSuccess: true, propertyUsageType: "Residential", error: null },
      ]);
      expect(replay.validation).toEqual({ valid: true, checked: 1, issues: [] });
      expect(replay.artifacts.rowCount).toBe(1);
      expect(replay.artifacts.expectedCount).toBe(1);
      expect(replay.publishResult).toEqual({
        dryRun: true,
        bucket: "elephant-oracle-query-table-pinellas",
        queryTableIpnsLabel: "oracle-query-table-pinellas",
        coverageIpnsLabel: "oracle-dataset-coverage-pinellas",
      });

      const rows = await readParquetRows(replay.artifacts.parquetPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].source_system).toBe("pinellas_appraiser");
      expect(rows[0].request_identifier).toBe(STRAP);
      expect(rows[0].county_name).toBe("Pinellas");

      const coverage = JSON.parse(await readFile(replay.artifacts.coveragePath, "utf8"));
      expect(coverage.datasets).toHaveLength(1);
      expect(coverage.datasets[0].ingested_count).toBe(1);
      expect(coverage.datasets[0].expected_count).toBe(1);
      expect(coverage.datasets[0].county).toBe("pinellas");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("elephant-county replay (public CLI, subprocess)", () => {
  it("produces required transformed JSON, a valid ZIP, one Parquet row, matching one-row coverage, and a dry-run publish, independent of the caller's cwd", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pinellas-replay-cli-"));
    const cwdDir = await mkdtemp(path.join(tmpdir(), "pinellas-replay-cwd-"));
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "replay", "--county", "pinellas", "--fixture", FIXTURE_DIR, "--output", tempDir],
        { cwd: cwdDir },
      );
      const summary = JSON.parse(stdout);
      expect(summary.event).toBe("replay_complete");
      expect(summary.county).toBe("pinellas");
      expect(summary.manifest.results[0].transformSuccess).toBe(true);

      // Pinellas source identity.
      expect(summary.artifacts.bucket).toBe("elephant-oracle-query-table-pinellas");
      expect(summary.artifacts.queryTableIpnsLabel).toBe("oracle-query-table-pinellas");
      expect(summary.artifacts.coverageIpnsLabel).toBe("oracle-dataset-coverage-pinellas");
      expect(summary.artifacts.rowCount).toBe(1);
      expect(summary.artifacts.expectedCount).toBe(1);

      // Credential-free Filebase dry-run: no live network call, no env credentials needed.
      expect(summary.publishResult).toEqual({
        dryRun: true,
        bucket: "elephant-oracle-query-table-pinellas",
        queryTableIpnsLabel: "oracle-query-table-pinellas",
        coverageIpnsLabel: "oracle-dataset-coverage-pinellas",
      });

      // Valid ZIP (PKZIP local-file magic bytes).
      const zipPath = path.join(tempDir, "ingest", STRAP, "transformed.zip");
      const zipBytes = await readFile(zipPath);
      expect(zipBytes.subarray(0, 4)).toEqual(ZIP_LOCAL_FILE_MAGIC);

      // Required transformed JSON artifacts.
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipPath);
      const entryNames = zip.getEntries().map((entry) => entry.entryName.replaceAll("\\", "/"));
      for (const required of ["data/property.json", "data/parcel.json", "data/address.json"]) {
        expect(entryNames).toContain(required);
      }

      // Exactly one Parquet row.
      const rows = await readParquetRows(summary.artifacts.parquetPath);
      expect(rows).toHaveLength(1);
      expect(rows[0].request_identifier).toBe(STRAP);
      expect(rows[0].source_system).toBe("pinellas_appraiser");

      // One-row coverage matching the Parquet row count.
      const coverage = JSON.parse(await readFile(summary.artifacts.coveragePath, "utf8"));
      expect(coverage.datasets).toHaveLength(1);
      expect(coverage.datasets[0].ingested_count).toBe(rows.length);
      expect(coverage.datasets[0].expected_count).toBe(1);

      // replay-summary.json written alongside stdout.
      const writtenSummary = JSON.parse(await readFile(path.join(tempDir, "replay-summary.json"), "utf8"));
      expect(writtenSummary.manifest).toEqual(summary.manifest);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(cwdDir, { recursive: true, force: true });
    }
  });

  it("resolves the county transform scripts from its own file location, not the caller's cwd", async () => {
    // Sanity check for the CWD-independence constraint: run from a directory
    // that has no counties/, fixtures/, or bin/ of its own.
    const cwdDir = await mkdtemp(path.join(tmpdir(), "pinellas-cwd-independent-"));
    const outputDir = await mkdtemp(path.join(tmpdir(), "pinellas-replay-cwd-independent-out-"));
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [CLI_PATH, "replay", "--county", "pinellas", "--fixture", FIXTURE_DIR, "--output", outputDir],
        { cwd: cwdDir },
      );
      expect(JSON.parse(stdout).event).toBe("replay_complete");
    } finally {
      await rm(cwdDir, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
