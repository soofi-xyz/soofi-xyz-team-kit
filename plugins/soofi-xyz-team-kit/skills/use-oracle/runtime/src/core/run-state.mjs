/**
 * Persistent run state, failure ledger, and retry helpers shared by every
 * county ingestion adapter.
 *
 * Ported near-verbatim (already county-agnostic) from
 * `oracle-node@ff68b0b6` `scripts/hillsborough/run-state.mjs`.
 *
 * @module core/run-state
 */

import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import { join } from "node:path";

/**
 * @typedef {"transient" | "permanent" | "unknown"} FailureClass
 */

/**
 * @typedef {object} FailureRecord
 * @property {string} parcelId
 * @property {string} error
 * @property {FailureClass} classification
 * @property {number} attempts
 * @property {string} at
 * @property {string} [jobId]
 */

/**
 * @typedef {object} RunProgress
 * @property {string} jobId
 * @property {string} seedPath
 * @property {string} outputRoot
 * @property {number} seedTotal
 * @property {number} attempted
 * @property {number} succeeded
 * @property {number} failed
 * @property {number} skipped
 * @property {number} retried
 * @property {string} startedAt
 * @property {string} updatedAt
 * @property {string | null} [etaIso]
 * @property {number | null} [parcelsPerMinute]
 * @property {"running" | "completed" | "stopped"} status
 */

/**
 * @param {string} candidate - Filesystem path.
 * @returns {Promise<boolean>} Whether the path exists.
 */
async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify an error message for retry policy. Transient errors are safe to
 * auto-retry; permanent ones are not.
 *
 * @param {unknown} error - Error or message.
 * @returns {FailureClass} Retry classification.
 */
export function classifyFailure(error) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    /http 429|http 5\d\d|timeout|etimedout|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|temporarily|rate limit/.test(
      message,
    )
  ) {
    return "transient";
  }
  if (
    /missing source_identifier|parceldata empty|http 404|http 400|invalid pin|no seed|validation/.test(
      message,
    )
  ) {
    return "permanent";
  }
  return "unknown";
}

/**
 * @param {string} outputRoot - Run output root.
 * @param {string} jobId - Stable job identifier.
 * @returns {{ statePath: string; failuresPath: string; progressPath: string; jobDir: string }}
 *   Well-known paths for one job's state.
 */
export function runStatePaths(outputRoot, jobId) {
  const jobDir = join(outputRoot, "_run", jobId);
  return {
    jobDir,
    statePath: join(jobDir, "state.json"),
    failuresPath: join(jobDir, "failures.jsonl"),
    progressPath: join(jobDir, "progress.json"),
  };
}

/**
 * @param {string} outputRoot - Run output root.
 * @param {string} jobId - Stable job identifier.
 * @param {Partial<RunProgress>} seed - Initial values.
 * @returns {Promise<RunProgress>} Progress record (existing progress wins on resume).
 */
export async function initRunProgress(outputRoot, jobId, seed) {
  const paths = runStatePaths(outputRoot, jobId);
  await mkdir(paths.jobDir, { recursive: true });
  const now = new Date().toISOString();
  /** @type {RunProgress} */
  const progress = {
    jobId,
    seedPath: seed.seedPath ?? "",
    outputRoot,
    seedTotal: seed.seedTotal ?? 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    startedAt: seed.startedAt ?? now,
    updatedAt: now,
    etaIso: null,
    parcelsPerMinute: null,
    status: "running",
  };
  if (await pathExists(paths.progressPath)) {
    const existing = /** @type {RunProgress} */ (
      JSON.parse(await readFile(paths.progressPath, "utf8"))
    );
    return {
      ...existing,
      ...progress,
      startedAt: existing.startedAt || progress.startedAt,
      attempted: existing.attempted,
      succeeded: existing.succeeded,
      failed: existing.failed,
      skipped: existing.skipped,
      retried: existing.retried,
      status: "running",
    };
  }
  await writeFile(paths.progressPath, JSON.stringify(progress, null, 2), "utf8");
  await writeFile(
    paths.statePath,
    JSON.stringify({ jobId, createdAt: now, lastParcelId: null, lastEvent: "init" }, null, 2),
    "utf8",
  );
  return progress;
}

/** @type {Array<{ time: number; count: number }>} */
const rollingSamples = [];
const ROLLING_WINDOW_MS = 60000;

/**
 * @param {string} outputRoot - Run output root.
 * @param {string} jobId - Stable job identifier.
 * @param {RunProgress} progress - Mutated in place with fresh throughput/ETA.
 * @param {{ lastParcelId?: string | null; lastEvent?: string }} [meta] - Snapshot metadata.
 * @returns {Promise<void>} Resolves once both files are written.
 */
export async function writeRunProgress(outputRoot, jobId, progress, meta = {}) {
  const paths = runStatePaths(outputRoot, jobId);
  await mkdir(paths.jobDir, { recursive: true });

  const now = Date.now();
  const activeDone = progress.succeeded + progress.failed;
  rollingSamples.push({ time: now, count: activeDone });
  while (rollingSamples.length > 0 && now - rollingSamples[0].time > ROLLING_WINDOW_MS) {
    rollingSamples.shift();
  }

  let rate = 0;
  if (rollingSamples.length >= 2) {
    const oldest = rollingSamples[0];
    const deltaDone = activeDone - oldest.count;
    const deltaMin = (now - oldest.time) / 60000;
    if (deltaMin > 0 && deltaDone >= 0) rate = deltaDone / deltaMin;
  } else {
    const startedMs = Date.parse(progress.startedAt);
    const elapsedMin = Number.isFinite(startedMs) && startedMs > 0
      ? Math.max((now - startedMs) / 60000, 1 / 60)
      : 1 / 60;
    rate = activeDone / elapsedMin;
  }

  const done = progress.succeeded + progress.failed + progress.skipped;
  const remaining = Math.max(progress.seedTotal - done, 0);
  const etaIso = rate > 0 && remaining > 0
    ? new Date(now + (remaining / rate) * 60000).toISOString()
    : null;

  const next = {
    ...progress,
    updatedAt: new Date(now).toISOString(),
    parcelsPerMinute: Number(rate.toFixed(2)),
    etaIso,
  };
  await writeFile(paths.progressPath, JSON.stringify(next, null, 2), "utf8");
  await writeFile(
    paths.statePath,
    JSON.stringify(
      {
        jobId,
        updatedAt: next.updatedAt,
        lastParcelId: meta.lastParcelId ?? null,
        lastEvent: meta.lastEvent ?? "progress",
        attempted: next.attempted,
        succeeded: next.succeeded,
        failed: next.failed,
        skipped: next.skipped,
        status: next.status,
        parcelsPerMinute: next.parcelsPerMinute,
        etaIso: next.etaIso,
      },
      null,
      2,
    ),
    "utf8",
  );
  Object.assign(progress, next);
}

/**
 * Append a failure line for later retry.
 *
 * @param {string} outputRoot - Run output root.
 * @param {string} jobId - Stable job identifier.
 * @param {FailureRecord} record - Failure to persist.
 * @returns {Promise<void>} Resolves once appended.
 */
export async function appendFailure(outputRoot, jobId, record) {
  const paths = runStatePaths(outputRoot, jobId);
  await mkdir(paths.jobDir, { recursive: true });
  await appendFile(paths.failuresPath, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Load unique failure parcel ids (latest attempt wins). Transient/unknown are retryable.
 *
 * @param {string} outputRoot - Run output root.
 * @param {string} jobId - Stable job identifier.
 * @param {{ includePermanent?: boolean }} [options] - Whether to include permanent failures.
 * @returns {Promise<FailureRecord[]>} Retryable failures.
 */
export async function loadRetryableFailures(outputRoot, jobId, options = {}) {
  const paths = runStatePaths(outputRoot, jobId);
  if (!(await pathExists(paths.failuresPath))) return [];
  const text = await readFile(paths.failuresPath, "utf8");
  /** @type {Map<string, FailureRecord>} */
  const byParcelId = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = /** @type {FailureRecord} */ (JSON.parse(line));
      if (!row.parcelId) continue;
      byParcelId.set(row.parcelId, row);
    } catch {
      // Skip corrupt lines.
    }
  }
  const includePermanent = options.includePermanent === true;
  return [...byParcelId.values()].filter((row) => {
    if (includePermanent) return true;
    return row.classification === "transient" || row.classification === "unknown";
  });
}

/**
 * Sleep helper for backoff.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry a function for transient failures with exponential backoff.
 *
 * @template T
 * @param {() => Promise<T>} fn - Operation to retry.
 * @param {{ maxAttempts?: number; baseDelayMs?: number; onRetry?: (info: { attempt: number; error: unknown; classification: FailureClass }) => void }} [options] - Retry tuning.
 * @returns {Promise<T>} Operation result.
 */
export async function withTransientRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyFailure(error);
      if (classification !== "transient" || attempt >= maxAttempts) {
        throw error;
      }
      options.onRetry?.({ attempt, error, classification });
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "retry failed"));
}
