/**
 * Generic dispatch over a county adapter's `buildSeed` / `captureAndTransform`
 * / `validateRun` / `buildReconciliationArtifacts` methods, plus the one-parcel
 * fixture replay pipeline the CLI's `replay` command and Gate B tests use.
 *
 * This module has no county-specific knowledge; every county-specific
 * behavior comes from the `adapter` object it is handed (see
 * `counties/pinellas/adapter.mjs`).
 *
 * @module core/replay
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsvRecords } from "./csv.mjs";

export const FIXTURE_REPLAY_AS_OF_DATE = "2026-09-14";

/**
 * @typedef {object} CountyAdapter
 * @property {string} key - County key (e.g. `pinellas`).
 * @property {(options: object) => Promise<object>} buildSeed
 * @property {(options: object) => Promise<object>} captureAndTransform
 * @property {(manifest: object) => Promise<object>} validateRun
 * @property {(run: object) => Promise<object>} buildReconciliationArtifacts
 */

/**
 * Build (or refresh) a county's seed CSV via its adapter.
 *
 * @param {CountyAdapter} adapter - County adapter.
 * @param {object} options - Adapter-specific seed inputs.
 * @returns {Promise<object>} Adapter-specific seed result.
 */
export async function buildSeed(adapter, options) {
  return adapter.buildSeed(options);
}

/**
 * Capture (or reuse fixture) HTML and transform every seed row via a
 * county's adapter.
 *
 * @param {CountyAdapter} adapter - County adapter.
 * @param {object} options - Adapter-specific capture/transform inputs.
 * @returns {Promise<object>} Ingest run manifest.
 */
export async function captureAndTransform(adapter, options) {
  return adapter.captureAndTransform(options);
}

/**
 * Structurally validate an ingest run via a county's adapter. Never calls
 * `@elephant-xyz/cli validate` (Global Constraint).
 *
 * @param {CountyAdapter} adapter - County adapter.
 * @param {object} manifest - Ingest run manifest.
 * @returns {Promise<object>} Validation summary.
 */
export async function validateRun(adapter, manifest) {
  return adapter.validateRun(manifest);
}

/**
 * Build internal query-table and coverage reconciliation artifacts.
 *
 * @param {CountyAdapter} adapter - County adapter.
 * @param {object} run - Ingest output directory plus seed rows.
 * @returns {Promise<object>} Reconciliation artifacts.
 */
export async function buildReconciliationArtifacts(adapter, run) {
  return adapter.buildReconciliationArtifacts(run);
}

/**
 * @typedef {object} ReplayOptions
 * @property {CountyAdapter} adapter - County adapter under test.
 * @property {string} fixtureDir - Directory containing `seed.csv` and an `html/` subdirectory.
 * @property {string} outputDir - Scratch directory for ingest and reconciliation output.
 * @property {boolean} [skipValidate] - When false, run {@link validateRun} and fail on issues. Defaults to true.
 */

/**
 * @typedef {object} ReplayResult
 * @property {object} manifest - Ingest run manifest.
 * @property {object | null} validation - Validation summary, or null when `skipValidate` is true.
 * @property {object} artifacts - Internal reconciliation artifacts.
 * @property {Record<string, string>[]} seedRows - Parsed fixture seed rows.
 * @property {string} ingestDir - Directory holding per-parcel `transformed.zip` output.
 * @property {string} workingDir - Directory holding private reconciliation artifacts.
 */

/**
 * Run the full offline replay pipeline for one county fixture: seed →
 * capture/transform (fixture HTML only, no network) → optional structural
 * validation → internal reconciliation artifacts.
 *
 * @param {ReplayOptions} options - Adapter, fixture directory, and output directory.
 * @returns {Promise<ReplayResult>} Every artifact produced by the replay.
 */
export async function runReplay({ adapter, fixtureDir, outputDir, skipValidate = true }) {
  const seedPath = path.join(fixtureDir, "seed.csv");
  const htmlDir = path.join(fixtureDir, "html");
  const seedRows = parseCsvRecords(await readFile(seedPath, "utf8"));
  if (seedRows.length === 0) {
    throw new Error(`Replay fixture seed is empty: ${seedPath}`);
  }

  const ingestDir = path.join(outputDir, "ingest");
  const workingDir = path.join(outputDir, "reconciliation");

  const manifest = await captureAndTransform(adapter, {
    seedRows,
    htmlDir,
    outputDir: ingestDir,
    liveFetch: false,
    asOfDate: FIXTURE_REPLAY_AS_OF_DATE,
  });

  let validation = null;
  if (skipValidate !== true) {
    validation = await validateRun(adapter, manifest);
    if (!validation.valid) {
      throw new Error(`Replay validation failed: ${JSON.stringify(validation.issues)}`);
    }
  }

  const artifacts = await buildReconciliationArtifacts(adapter, {
    outputDir: ingestDir,
    seedRows,
    workingDir,
  });

  return { manifest, validation, artifacts, seedRows, ingestDir, workingDir };
}
