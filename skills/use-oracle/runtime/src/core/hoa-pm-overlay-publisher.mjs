/**
 * Fail-closed guards for HOA/PM overlay IPNS moves.
 *
 * One overlay publisher at a time. Never rewind a live overlay name to an
 * older approved receipt. Apply only this run's byte-bound CID. Never move
 * official county query-table names.
 *
 * @module core/hoa-pm-overlay-publisher
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OVERLAY_PUBLISHER_LOCK_FILENAME =
  "elephant-hoa-pm-overlay-publisher.lock";

/**
 * @param {string} [lockDir] - Directory that holds the overlay publisher lock.
 * @returns {string} Absolute lockfile path.
 */
export function overlayPublisherLockPath(lockDir = os.tmpdir()) {
  return path.join(lockDir, OVERLAY_PUBLISHER_LOCK_FILENAME);
}

/**
 * @param {string | undefined} label - Filebase IPNS label.
 * @returns {boolean} True for overlay query-table or coverage names.
 */
export function isHoaPmOverlayIpnsLabel(label) {
  return (
    typeof label === "string" &&
    label.endsWith("-hoa-pm") &&
    (label.startsWith("oracle-query-table-") ||
      label.startsWith("oracle-dataset-coverage-"))
  );
}

/**
 * @param {string | undefined} label - Filebase IPNS label.
 * @returns {boolean} True for the official county query-table name.
 */
export function isOfficialQueryTableIpnsLabel(label) {
  return (
    typeof label === "string" &&
    label.startsWith("oracle-query-table-") &&
    !label.endsWith("-hoa-pm")
  );
}

/**
 * @param {string | undefined} label - Filebase IPNS label.
 * @returns {boolean} True for the official county coverage name.
 */
export function isOfficialCoverageIpnsLabel(label) {
  return (
    typeof label === "string" &&
    label.startsWith("oracle-dataset-coverage-") &&
    !label.endsWith("-hoa-pm")
  );
}

/**
 * Refuse official county IPNS names and any non-overlay label.
 *
 * @param {{ queryTableIpnsLabel?: string, coverageIpnsLabel?: string }} artifacts
 *   Destination labels for this overlay publish.
 * @returns {void}
 */
export function assertOverlayOnlyIpnsLabels(artifacts) {
  const labels = [
    artifacts.queryTableIpnsLabel,
    artifacts.coverageIpnsLabel,
  ].filter((label) => typeof label === "string" && label.length > 0);
  for (const label of labels) {
    if (isOfficialQueryTableIpnsLabel(label) || isOfficialCoverageIpnsLabel(label)) {
      throw new Error(
        `Refuse overlay IPNS move: ${label} is an official county name. Overlay-only: never move oracle-query-table-<county> or oracle-dataset-coverage-<county>.`,
      );
    }
    if (!isHoaPmOverlayIpnsLabel(label)) {
      throw new Error(
        `Refuse overlay IPNS move: ${label} is not an HOA/PM overlay name (oracle-query-table-<county>-hoa-pm or oracle-dataset-coverage-<county>-hoa-pm).`,
      );
    }
  }
}

/**
 * Apply only the CID this process just bound to the approved artifact bytes.
 *
 * @param {{ label: string, targetCid: string, thisRunCid: string }} params
 *   Label, CID about to be applied, and this run's receipt CID.
 * @returns {void}
 */
export function assertThisRunReceiptCid(params) {
  if (typeof params.thisRunCid !== "string" || params.thisRunCid.length === 0) {
    throw new Error(
      `Refuse overlay IPNS move for ${params.label}: apply only this run's byte-bound CID; no this-run CID is bound.`,
    );
  }
  if (params.targetCid !== params.thisRunCid) {
    throw new Error(
      `Refuse overlay IPNS move for ${params.label}: apply only this run's byte-bound CID ${params.thisRunCid}; refusing replay CID ${params.targetCid}.`,
    );
  }
}

/**
 * @param {object | null | undefined} record - Filebase name record.
 * @returns {string | null} ISO timestamp when the live name last changed.
 */
export function filebaseNameUpdatedAt(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of [
    "updated_at",
    "published_at",
    "updatedAt",
    "publishedAt",
    "updated",
    "created_at",
  ]) {
    const value = record[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return value;
    }
  }
  return null;
}

/**
 * Abort if the live overlay name already points at a newer approved receipt.
 *
 * @param {{
 *   label: string,
 *   liveCid?: string,
 *   targetCid: string,
 *   thisReceiptApprovedAt?: string,
 *   liveUpdatedAt?: string | null,
 * }} params
 *   Live Filebase pointer vs this process's approved receipt.
 * @returns {void}
 */
export function assertOverlayIpnsNotRewind(params) {
  const liveCid = params.liveCid;
  if (typeof liveCid !== "string" || liveCid.length === 0 || liveCid === params.targetCid) {
    return;
  }
  const liveTs =
    typeof params.liveUpdatedAt === "string"
      ? Date.parse(params.liveUpdatedAt)
      : Number.NaN;
  const thisTs =
    typeof params.thisReceiptApprovedAt === "string"
      ? Date.parse(params.thisReceiptApprovedAt)
      : Number.NaN;
  if (Number.isFinite(liveTs) && Number.isFinite(thisTs) && liveTs > thisTs) {
    throw new Error(
      `Refuse overlay IPNS rewind for ${params.label}: live CID ${liveCid} is already newer (updated ${params.liveUpdatedAt}) than this process's approved receipt (${params.thisReceiptApprovedAt}). Abort rather than last-write-wins.`,
    );
  }
}

function defaultProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the single overlay publisher lock, replacing a dead leftover pid.
 *
 * @param {{
 *   lockDir?: string,
 *   county?: string,
 *   command?: string,
 *   pid?: number,
 *   startedAt?: string,
 *   processIsAlive?: (pid: number) => boolean,
 * }} [options]
 *   Lock location and holder identity.
 * @returns {Promise<{ lockPath: string, pid: number, replacedStale?: boolean }>}
 *   Held lock.
 */
export async function acquireOverlayPublisherLock(options = {}) {
  const lockDir = options.lockDir ?? os.tmpdir();
  const pid = options.pid ?? process.pid;
  const startedAt = options.startedAt ?? new Date().toISOString();
  const processIsAlive = options.processIsAlive ?? defaultProcessIsAlive;
  const lockPath = overlayPublisherLockPath(lockDir);
  const payload = `${JSON.stringify(
    {
      pid,
      startedAt,
      county: options.county ?? null,
      command: options.command ?? null,
    },
    null,
    2,
  )}\n`;
  try {
    await writeFile(lockPath, payload, { flag: "wx" });
    return { lockPath, pid };
  } catch (caught) {
    if (!caught || caught.code !== "EEXIST") throw caught;
  }
  let existing = null;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    existing = null;
  }
  const existingPid =
    existing && Number.isInteger(existing.pid) ? existing.pid : null;
  if (existingPid !== null && existingPid !== pid && processIsAlive(existingPid)) {
    throw new Error(
      `Refuse overlay publish: another overlay publish/sync process is running (pid ${existingPid}, county ${existing.county ?? "unknown"}, command ${existing.command ?? "unknown"}). Stop the stale shell or leftover agent before moving overlay IPNS names.`,
    );
  }
  await writeFile(lockPath, payload);
  return { lockPath, pid, replacedStale: true };
}

/**
 * Release the overlay publisher lock when this process still owns it.
 *
 * @param {string} [lockDir] - Directory that holds the lockfile.
 * @param {number} [pid] - Pid that acquired the lock.
 * @returns {Promise<void>}
 */
export async function releaseOverlayPublisherLock(
  lockDir = os.tmpdir(),
  pid = process.pid,
) {
  const lockPath = overlayPublisherLockPath(lockDir);
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing.pid !== pid) return;
    await unlink(lockPath);
  } catch (caught) {
    if (caught && caught.code === "ENOENT") return;
    throw caught;
  }
}

/**
 * Run an overlay publish/sync callback under the single-publisher lock.
 *
 * @template T
 * @param {Parameters<typeof acquireOverlayPublisherLock>[0]} options
 *   Lock identity.
 * @param {() => Promise<T>} fn - Overlay work.
 * @returns {Promise<T>} Callback result.
 */
export async function withOverlayPublisherLock(options, fn) {
  const held = await acquireOverlayPublisherLock(options);
  try {
    return await fn();
  } finally {
    await releaseOverlayPublisherLock(options.lockDir, held.pid);
  }
}
