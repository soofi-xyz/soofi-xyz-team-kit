import { describe, expect, it } from "vitest";

import { parseRoofAgeBackfillArguments } from "../bin/roof-age-backfill.mjs";
import { runRoofAgeBackfill } from "../src/roof-age/backfill.mjs";

function record() {
  return {
    propertyId: "11111111-1111-4111-8111-111111111111",
    structureId: "22222222-2222-4222-8222-222222222222",
    sourceSystem: "broward_appraiser",
    sourceRecordId: "parcel-1",
    builtYear: 2000,
    roofDate: null,
    roofAgeYears: null,
    sourcePayload: {},
    permits: [],
  };
}

class MemoryRoofAgeStore {
  constructor({ failWrite = false } = {}) {
    this.records = [record()];
    this.failWrite = failWrite;
    this.writes = 0;
    this.rollbacks = 0;
    this.readOnlyTransactions = [];
  }

  async begin({ readOnly }) {
    this.snapshot = structuredClone(this.records);
    this.readOnlyTransactions.push(readOnly);
  }

  async commit() {
    this.snapshot = null;
  }

  async rollback() {
    this.records = this.snapshot;
    this.snapshot = null;
    this.rollbacks += 1;
  }

  async validateSchema() {}
  async acquireLock() {}
  async countRoofAgeRecords() {
    return this.records.length;
  }

  async readRoofAgeRecords() {
    return structuredClone(this.records);
  }

  async writeRoofAgeUpdates(plans) {
    if (this.failWrite) throw new Error("fixture write failure");
    for (const plan of plans) {
      if (!plan.changed) continue;
      const target = this.records.find(
        (candidate) => candidate.propertyId === plan.propertyId,
      );
      target.roofDate = plan.after.roofDate;
      target.roofAgeYears = plan.after.roofAgeYears;
      target.sourcePayload.roof_age_lineage = plan.after.lineage;
      this.writes += 1;
    }
    return plans.filter((plan) => plan.changed).length;
  }
}

const options = {
  state: "FL",
  county: "Broward",
  asOfDate: "2026-09-14",
  limit: 25,
};

describe("roof-age audit and backfill", () => {
  it("parses a bounded dry-run by default and requires --apply for writes", () => {
    const base = [
      "--state",
      "FL",
      "--county",
      "Broward",
      "--as-of-date",
      "2026-09-14",
      "--database-url-env",
      "DATABASE_URL",
      "--limit",
      "25",
    ];
    expect(parseRoofAgeBackfillArguments(base)).toMatchObject({
      apply: false,
      state: "FL",
      county: "Broward",
      limit: 25,
    });
    expect(
      parseRoofAgeBackfillArguments([...base, "--apply"]).apply,
    ).toBe(true);
  });

  it("defaults to a read-only dry-run with projected reconciliation counts", async () => {
    const store = new MemoryRoofAgeStore();
    const report = await runRoofAgeBackfill({ store, ...options });
    expect(report).toMatchObject({
      mode: "dry-run",
      evaluatedRows: 1,
      scopeTotalRows: 1,
      missingBefore: 1,
      missingAfter: 0,
      constructionYearDefaults: 1,
      projectedUpdatedRows: 1,
      rowsWritten: 0,
    });
    expect(store.readOnlyTransactions).toEqual([true]);
    expect(store.records[0].roofDate).toBeNull();
  });

  it("applies a bounded update and reruns idempotently", async () => {
    const store = new MemoryRoofAgeStore();
    const first = await runRoofAgeBackfill({
      store,
      ...options,
      apply: true,
    });
    expect(first.rowsWritten).toBe(1);
    expect(store.records[0]).toMatchObject({
      roofDate: "2000",
      roofAgeYears: 26,
    });
    const second = await runRoofAgeBackfill({
      store,
      ...options,
      apply: true,
    });
    expect(second.projectedUpdatedRows).toBe(0);
    expect(second.rowsWritten).toBe(0);
    expect(store.writes).toBe(1);
    expect(store.readOnlyTransactions).toEqual([false, false]);
  });

  it("rolls back the transaction when persistence fails", async () => {
    const store = new MemoryRoofAgeStore({ failWrite: true });
    await expect(
      runRoofAgeBackfill({ store, ...options, apply: true }),
    ).rejects.toThrow("fixture write failure");
    expect(store.rollbacks).toBe(1);
    expect(store.records[0].roofDate).toBeNull();
  });
});
