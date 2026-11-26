import { describe, expect, it } from "vitest";

import {
  addCounts,
  applyRecord,
  emptyCounts,
  entryKey,
  type LedgerEntry,
  type LedgerRecordInput,
  parseRecordInput,
  type StatusCounts,
  summarize,
} from "../services/lib/ledger-state.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** In-memory stand-in for the CountyLedger object state. */
function ledger() {
  const state = new Map<string, unknown>();
  let tick = 0;
  return {
    state,
    record(payload: Partial<LedgerRecordInput> & Record<string, unknown>) {
      const input = parseRecordInput(payload);
      const key = entryKey(input.stage, input.parcel_id);
      const applied = applyRecord((state.get(key) as LedgerEntry) ?? null, input, `2026-11-25T00:00:${String(tick++).padStart(2, "0")}Z`);
      if (!applied.changed) return applied;
      state.set(key, applied.next);
      const countsKey = input.stage === "permits" ? "permitCounts" : "counts";
      state.set(countsKey, addCounts((state.get(countsKey) as StatusCounts) ?? emptyCounts(), applied.countsDelta));
      state.set("tombstones", ((state.get("tombstones") as number) ?? 0) + applied.tombstoneDelta);
      return applied;
    },
    summary() {
      return summarize(
        "testcounty-job-1",
        (state.get("counts") as StatusCounts) ?? null,
        (state.get("permitCounts") as StatusCounts) ?? null,
        (state.get("tombstones") as number) ?? null,
        null,
      );
    },
    entry(parcelId: string) {
      return state.get(`p:${parcelId}`) as LedgerEntry | undefined;
    },
  };
}

describe("CountyLedger state transitions", () => {
  it("moves pending → ready and keeps counts consistent", () => {
    const book = ledger();
    book.record({ parcel_id: "1", stage: "capture", status: "pending" });
    book.record({ parcel_id: "2", stage: "capture", status: "pending" });
    expect(book.summary().counts).toMatchObject({ pending: 2, ready: 0 });
    book.record({ parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_A, transformVersion: "handler:v1" });
    book.record({ parcel_id: "2", stage: "capture", status: "dead", reason: "gone-at-source: HTTP 404" });
    expect(book.summary()).toMatchObject({
      parcels: 2,
      counts: { pending: 0, ready: 1, dead: 1, invalid: 0, failed: 0 },
      tombstones: 0,
    });
    expect(book.entry("1")).toMatchObject({ wasReady: true, tombstoned: false, previousStatus: "pending" });
  });

  it("is idempotent: re-recording the same status changes nothing", () => {
    const book = ledger();
    const input = { parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_A, transformVersion: "v1" } as const;
    expect(book.record(input).changed).toBe(true);
    const again = book.record(input);
    expect(again.changed).toBe(false);
    expect(book.summary().counts.ready).toBe(1);
    expect(book.entry("1")!.transitions).toBe(0);
  });

  it("tombstones ready → invalid and ready → dead, and clears the tombstone on a later ready", () => {
    const book = ledger();
    book.record({ parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_A, transformVersion: "v1" });
    book.record({ parcel_id: "2", stage: "ready", status: "ready", artifactHash: HASH_A, transformVersion: "v1" });
    book.record({ parcel_id: "1", stage: "validate", status: "invalid", reason: "validation-failed: 2 finding(s)" });
    book.record({ parcel_id: "2", stage: "capture", status: "dead", reason: "gone-at-source" });
    expect(book.summary()).toMatchObject({ counts: { ready: 0, invalid: 1, dead: 1 }, tombstones: 2 });
    expect(book.entry("1")).toMatchObject({ tombstoned: true, previousStatus: "ready" });

    // invalid → ok and dead → ok (through pending, as a redrive does)
    book.record({ parcel_id: "1", stage: "capture", status: "pending" });
    book.record({ parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_B, transformVersion: "v2" });
    book.record({ parcel_id: "2", stage: "ready", status: "ready", artifactHash: HASH_B, transformVersion: "v2" });
    expect(book.summary()).toMatchObject({ counts: { ready: 2, invalid: 0, dead: 0, pending: 0 }, tombstones: 0 });
    expect(book.entry("1")).toMatchObject({ tombstoned: false, artifactHash: HASH_B, transitions: 3 });
  });

  it("never tombstones a parcel that was never ready", () => {
    const book = ledger();
    book.record({ parcel_id: "1", stage: "capture", status: "pending" });
    book.record({ parcel_id: "1", stage: "validate", status: "invalid", reason: "validation-failed: 1 finding(s)" });
    expect(book.summary().tombstones).toBe(0);
    expect(book.entry("1")).toMatchObject({ tombstoned: false, wasReady: false });
  });

  it("records permit link results separately from the parcel status", () => {
    const book = ledger();
    book.record({ parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_A, transformVersion: "v1" });
    book.record({
      parcel_id: "1",
      stage: "permits",
      status: "ready",
      reason: "unlinked: 1",
      detail: { permitCount: 3, linked: 2, unlinked: 1 },
    });
    book.record({ parcel_id: "2", stage: "permits", status: "dead", reason: "no_permit_profile" });
    const summary = book.summary();
    expect(summary.counts).toMatchObject({ ready: 1 });
    expect(summary.parcels).toBe(1);
    expect(summary.permits).toMatchObject({ parcels: 2, counts: { ready: 1, dead: 1 } });
    expect(book.state.get("permit:1")).toMatchObject({ detail: { linked: 2, unlinked: 1 }, tombstoned: false });
  });

  it("rejects malformed records", () => {
    expect(() => parseRecordInput({ stage: "capture", status: "pending" })).toThrow("parcel_id");
    expect(() => parseRecordInput({ parcel_id: "1", stage: "load", status: "pending" })).toThrow("stage");
    expect(() => parseRecordInput({ parcel_id: "1", stage: "capture", status: "loaded" })).toThrow("status");
    expect(() => parseRecordInput({ parcel_id: "1", stage: "ready", status: "ready", transformVersion: "v1" })).toThrow(
      "artifactHash",
    );
    expect(() => parseRecordInput({ parcel_id: "1", stage: "ready", status: "ready", artifactHash: HASH_A })).toThrow(
      "transformVersion",
    );
    expect(() => parseRecordInput({ parcel_id: "1", stage: "capture", status: "dead" })).toThrow("reason");
  });
});
