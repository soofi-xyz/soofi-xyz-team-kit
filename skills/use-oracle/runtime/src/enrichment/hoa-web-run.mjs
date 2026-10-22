// Run control for the HOA web scrape: adaptive request concurrency, resumable
// per-property checkpoints, and content-addressed cache keys.

import { createHash } from "node:crypto";

/**
 * Caps in-flight provider requests. Raises the cap by `step` after
 * `stableMs` of saturation without a 429; cuts it by `backoff` on a 429.
 * Measured on the 2026-10 run: start 20, cap 50 (plan concurrency), and the
 * provider's 500 requests/minute limit produced the first 429 at 50.
 */
export class AdaptiveLimiter {
  constructor({ start = 20, cap = 50, floor = 4, step = 5, backoff = 0.75, stableMs = 60_000, cooldownMs = 15_000, now = Date.now } = {}) {
    Object.assign(this, { limit: Math.min(start, cap), cap, floor, step, backoff, stableMs, cooldownMs, now });
    this.inflight = 0;
    this.windowPeak = 0;
    this.levelSince = now();
    this.last429 = -Infinity;
    this.count429 = 0;
    this.calls = 0;
    this.peakStable = 0;
    this.history = [];
    this.waiters = [];
  }

  async acquire() {
    while (this.inflight >= this.limit) await new Promise((resolve) => this.waiters.push(resolve));
    this.inflight += 1;
    this.windowPeak = Math.max(this.windowPeak, this.inflight);
  }

  release(status) {
    this.inflight -= 1;
    this.calls += 1;
    const now = this.now();
    if (status === 429) {
      this.count429 += 1;
      if (now - this.last429 > this.cooldownMs) {
        const from = this.limit;
        this.limit = Math.max(this.floor, Math.floor(this.limit * this.backoff));
        this.history.push({ at: now, event: "429", from, to: this.limit });
      }
      this.last429 = now;
      this.levelSince = now;
      this.windowPeak = 0;
    } else if (now - this.levelSince >= this.stableMs && now - this.last429 >= this.stableMs) {
      if (this.windowPeak >= this.limit - 1) {
        this.peakStable = Math.max(this.peakStable, this.limit);
        if (this.limit < this.cap) {
          const from = this.limit;
          this.limit = Math.min(this.cap, this.limit + this.step);
          this.history.push({ at: now, event: "raise", from, to: this.limit });
        }
      }
      this.levelSince = now;
      this.windowPeak = 0;
    }
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Rows still to run: a checkpoint record counts only when it carries the
// current parser version and did not end in a fetch error. Bump the parser
// version to invalidate stale rows.
export function pendingRows(rows, checkpointRecords, parserVersion, key = "property_id") {
  const done = new Map();
  for (const record of checkpointRecords) {
    if (record?.parserVersion === parserVersion && record.diagnostic !== "fetch_error" && record.status !== "error") done.set(record[key], record);
  }
  return { done, pending: rows.filter((row) => !done.has(row[key])) };
}

export function parseCheckpointLines(text) {
  const records = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn final line from an interrupted append is skipped, not fatal.
    }
  }
  return records;
}

// Cache by query hash and URL hash so community queries are shared across a
// subdivision and identical pages are never paid for twice.
export function cacheKey(kind, value) {
  return `${kind}/${createHash("sha256").update(String(value)).digest("hex")}.json`;
}

// Credits spent are the provider balance before minus after, read from the
// team credit-usage endpoint, not the sum of per-call estimates.
export function creditsSpent(startBalance, endBalance) {
  return Number.isFinite(startBalance) && Number.isFinite(endBalance) ? startBalance - endBalance : null;
}

export function budgetReached(spent, stopAt) {
  return spent !== null && spent >= stopAt;
}
