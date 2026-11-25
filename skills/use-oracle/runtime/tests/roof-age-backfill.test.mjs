import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseRoofAgeBackfillArguments } from "../bin/roof-age-backfill.mjs";
import { runRoofAgeBackfill } from "../src/roof-age/backfill.mjs";
import { createJsonlRoofAgeStore } from "../src/roof-age/jsonl-store.mjs";

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
      "--input",
      "records.jsonl",
      "--limit",
      "25",
    ];
    expect(parseRoofAgeBackfillArguments(base)).toMatchObject({
      apply: false,
      state: "FL",
      county: "Broward",
      limit: 25,
    });
    expect(() => parseRoofAgeBackfillArguments([...base, "--apply"])).toThrow(
      "--apply requires --output",
    );
    expect(
      parseRoofAgeBackfillArguments([
        ...base,
        "--apply",
        "--output",
        "records.roof-age.jsonl",
      ]),
    ).toMatchObject({ apply: true, outputPath: "records.roof-age.jsonl" });
    expect(() =>
      parseRoofAgeBackfillArguments([...base, "--database-url-env", "X"]),
    ).toThrow("Unknown option --database-url-env");
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

describe("roof-age JSONL file store", () => {
  const directories = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function fixtureFiles() {
    const dir = await mkdtemp(path.join(tmpdir(), "roof-age-jsonl-"));
    directories.push(dir);
    const inputPath = path.join(dir, "records.jsonl");
    const other = {
      ...record(),
      propertyId: "33333333-3333-4333-8333-333333333333",
      structureId: "44444444-4444-4444-8444-444444444444",
      county: "Duval",
    };
    await writeFile(
      inputPath,
      `${JSON.stringify({ state: "FL", county: "Broward", ...record() })}\n${JSON.stringify({ state: "FL", ...other })}\n`,
      "utf8",
    );
    return { dir, inputPath, outputPath: path.join(dir, "out", "records.roof-age.jsonl") };
  }

  async function readLines(filePath) {
    return (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("dry-runs without writing and scopes by county", async () => {
    const { inputPath, outputPath } = await fixtureFiles();
    const report = await runRoofAgeBackfill({
      store: createJsonlRoofAgeStore({ inputPath, outputPath }),
      ...options,
    });
    expect(report).toMatchObject({
      mode: "dry-run",
      scopeTotalRows: 1,
      evaluatedRows: 1,
      projectedUpdatedRows: 1,
      rowsWritten: 0,
    });
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });

  it("applies into a new file, leaves the input unchanged, and reruns idempotently", async () => {
    const { inputPath, outputPath } = await fixtureFiles();
    const before = await readFile(inputPath, "utf8");
    const first = await runRoofAgeBackfill({
      store: createJsonlRoofAgeStore({ inputPath, outputPath }),
      ...options,
      apply: true,
    });
    expect(first.rowsWritten).toBe(1);
    expect(await readFile(inputPath, "utf8")).toBe(before);
    const written = await readLines(outputPath);
    expect(written).toHaveLength(2);
    const broward = written.find((row) => row.county === "Broward");
    expect(broward).toMatchObject({ roofDate: "2000", roofAgeYears: 26 });
    expect(broward.sourcePayload.roof_age_lineage.source).toBe(
      "construction_year_default",
    );
    expect(written.find((row) => row.county === "Duval").roofDate).toBeNull();

    const secondOutput = `${outputPath}.second`;
    const second = await runRoofAgeBackfill({
      store: createJsonlRoofAgeStore({
        inputPath: outputPath,
        outputPath: secondOutput,
      }),
      ...options,
      apply: true,
    });
    expect(second.projectedUpdatedRows).toBe(0);
    expect(second.rowsWritten).toBe(0);
    expect(await readLines(secondOutput)).toEqual(written);
  });

  it("refuses to overwrite the input and refuses a second concurrent writer", async () => {
    const { inputPath, outputPath } = await fixtureFiles();
    expect(() =>
      createJsonlRoofAgeStore({ inputPath, outputPath: inputPath }),
    ).toThrow("never overwrite the input");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(`${outputPath}.lock`, "1\n");
    await expect(
      runRoofAgeBackfill({
        store: createJsonlRoofAgeStore({ inputPath, outputPath }),
        ...options,
        apply: true,
      }),
    ).rejects.toThrow("locked by another writer");
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });
});
