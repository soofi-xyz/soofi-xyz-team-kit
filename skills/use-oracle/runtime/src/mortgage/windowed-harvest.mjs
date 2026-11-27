/**
 * Shared, resumable date-window harvest for mortgage index sources.
 *
 * A source adapter answers one window at a time:
 *   fetchWindow(from, to) -> { records, complete, expected? }
 * where `complete: false` means the portal truncated the answer (too many rows, a cut
 * connection, a "narrow your search" warning) and the window must be split. When the
 * portal states its own count (`expected`), the window is ready only if the rows match.
 *
 * Files: <output>/<county>/<jobId>/windows/<from>-<to>.jsonl and .ready.json (rows and
 * sha256), .failed.json on error, and manifest.json. Ready windows are skipped on resume.
 *
 * @module src/mortgage/windowed-harvest
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, readJson } from "../permits/storage.mjs";
import { sha256Hex } from "./ipfs-pin.mjs";
import { listDays, splitWindow } from "./publicsearch.mjs";

/**
 * Cut [from, to] into windows of `unit` ("day" | "month" | "year").
 *
 * @param {string} from - YYYYMMDD.
 * @param {string} to - YYYYMMDD.
 * @param {"day" | "month" | "year"} unit - Window size.
 * @returns {[string, string][]} Windows.
 */
export function calendarWindows(from, to, unit) {
  const days = listDays(from, to);
  const key = (day) => (unit === "day" ? day : unit === "month" ? day.slice(0, 6) : day.slice(0, 4));
  const windows = [];
  for (const day of days) {
    const last = windows.at(-1);
    if (last && key(last[0]) === key(day)) last[1] = day;
    else windows.push([day, day]);
  }
  return windows;
}

/**
 * @param {{
 *   county: string,
 *   jobId: string,
 *   outputDir: string,
 *   windows: [string, string][],
 *   fetchWindow: (from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected?: number | null }>,
 *   keyOf: (record: Record<string, unknown>) => string,
 *   attempts?: number,
 *   delayMs?: number,
 *   now?: () => Date,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} input - Run inputs.
 * @returns {Promise<{ manifestPath: string, windows: number, readyWindows: number, failedWindows: number, records: number }>}
 *   Summary.
 */
export async function harvestWindows(input) {
  if (!/^[A-Za-z0-9_.-]+$/.test(input.jobId)) throw new Error(`Invalid job id: ${input.jobId}`);
  const now = input.now ?? (() => new Date());
  const attempts = input.attempts ?? 3;
  const delayMs = input.delayMs ?? 1_500;
  const runDir = path.join(input.outputDir, input.county, input.jobId);
  const windowsDir = path.join(runDir, "windows");
  await mkdir(windowsDir, { recursive: true });

  const pending = [...input.windows];
  let windows = 0;
  let readyWindows = 0;
  let failedWindows = 0;
  let records = 0;
  let requested = 0;

  while (pending.length > 0) {
    const [from, to] = pending.shift();
    const key = `${from}-${to}`;
    const dataPath = path.join(windowsDir, `${key}.jsonl`);
    const readyPath = path.join(windowsDir, `${key}.ready.json`);
    try {
      const ready = await readJson(readyPath);
      if (sha256Hex(await readFile(dataPath)) === ready.sha256) {
        windows += 1;
        readyWindows += 1;
        records += ready.rows;
        continue;
      }
    } catch {
      // not ready yet
    }

    let result;
    let lastError;
    for (let attempt = 1; attempt <= attempts && !result; attempt += 1) {
      if (requested > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs * attempt));
      requested += 1;
      try {
        result = await input.fetchWindow(from, to);
      } catch (error) {
        lastError = error;
        input.onProgress?.({ event: "window_retry", county: input.county, window: key, attempt, error: String(error?.message ?? error) });
      }
    }

    try {
      if (!result) throw lastError ?? new Error("no result");
      if (!result.complete) {
        const halves = splitWindow(from, to);
        if (!halves) throw new Error(`Day ${from} is still truncated by the portal`);
        pending.unshift(...halves);
        input.onProgress?.({ event: "window_split", county: input.county, window: key });
        continue;
      }
      windows += 1;
      /** @type {Map<string, Record<string, unknown>>} */
      const rows = new Map();
      for (const record of result.records) rows.set(input.keyOf(record), record);
      if (Number.isFinite(result.expected) && rows.size !== result.expected) {
        throw new Error(`Window ${key}: wrote ${rows.size} rows but the portal reports ${result.expected}`);
      }
      const body = [...rows.values()].map((row) => JSON.stringify(row)).join("\n") + (rows.size ? "\n" : "");
      await writeFile(`${dataPath}.tmp`, body);
      await rename(`${dataPath}.tmp`, dataPath);
      await atomicWriteJson(readyPath, {
        county: input.county,
        from,
        to,
        rows: rows.size,
        portalNumRecords: Number.isFinite(result.expected) ? result.expected : null,
        sha256: sha256Hex(Buffer.from(body)),
        readyAt: now().toISOString(),
      });
      readyWindows += 1;
      records += rows.size;
      input.onProgress?.({ event: "window_ready", county: input.county, window: key, rows: rows.size, records });
    } catch (error) {
      windows += 1;
      failedWindows += 1;
      const message = error instanceof Error ? error.message : String(error);
      await atomicWriteJson(path.join(windowsDir, `${key}.failed.json`), { from, to, error: message, failedAt: now().toISOString() });
      input.onProgress?.({ event: "window_failed", county: input.county, window: key, error: message });
    }
  }

  const manifestPath = path.join(runDir, "manifest.json");
  await atomicWriteJson(manifestPath, {
    county: input.county,
    jobId: input.jobId,
    windows,
    readyWindows,
    failedWindows,
    records,
    complete: failedWindows === 0,
    completedAt: now().toISOString(),
  });
  return { manifestPath, windows, readyWindows, failedWindows, records };
}
