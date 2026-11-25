import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LedgerRecordInput } from "../services/lib/ledger-state.ts";
import { parseParcelRequest, processParcel, type StepIO } from "../services/lib/parcel-flow.ts";
import { exists, paths, safeKeyPart } from "../services/lib/storage.ts";
import { COUNTY, createSandbox, JOB, type Sandbox } from "./services-helpers.ts";

type Recorder = StepIO & { steps: string[]; records: LedgerRecordInput[] };

function recorder(): Recorder {
  const steps: string[] = [];
  const records: LedgerRecordInput[] = [];
  return {
    steps,
    records,
    run: async (name, action) => {
      steps.push(name);
      // Round-trip through JSON like a journaled ctx.run result.
      const value = await action();
      return value === undefined ? value : JSON.parse(JSON.stringify(value));
    },
    record: async (input) => {
      records.push(input);
    },
  };
}

const request = (parcel_id: string, extra: Record<string, string> = {}) =>
  parseParcelRequest({ county: COUNTY, jobId: JOB, parcel_id, situs_address: "1 Main St", extra });

const dirOf = (parcelId: string) => paths.parcelDir(COUNTY, JOB, parcelId);

describe("Parcel.process steps", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("runs capture → transform → validate → ready → ledger → eligibility in order", async () => {
    const io = recorder();
    const outcome = await processParcel(io, request("P-1"));
    expect(outcome).toMatchObject({ parcel_id: "P-1", status: "ready", eligible: false });
    expect(io.steps).toEqual(["capture", "transform", "validate", "mark-ready", "eligibility"]);
    expect(io.records.map((record) => record.status)).toEqual(["pending", "ready"]);
    const ready = JSON.parse(await readFile(path.join(dirOf("P-1"), "ready.json"), "utf8"));
    expect(ready).toMatchObject({
      parcel_id: "P-1",
      cli: { version: "2.0.0-fake", commit: "abcdef1" },
      dataGroups: ["County", "Photo", "Seed"],
    });
    expect(ready.transformedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(io.records[1]).toMatchObject({
      artifactHash: ready.transformedHash,
      transformVersion: ready.transformVersion,
    });
    const commands = (await sandbox.calls()).map((call) => call.command);
    expect(commands.filter((command) => command !== "--version")).toEqual([
      "prepare",
      "transform",
      "validate",
    ]);
  });

  it("skips existing capture, transform and validation when hash and version match", async () => {
    await processParcel(recorder(), request("P-2"));
    await sandbox.clearCalls();
    const second = await processParcel(recorder(), request("P-2"));
    expect(second.status).toBe("ready");
    const commands = (await sandbox.calls()).map((call) => call.command).filter((c) => c !== "--version");
    expect(commands).toEqual([]);
  });

  it("re-transforms and re-validates when the transform version changes, without re-capturing", async () => {
    await processParcel(recorder(), request("P-3"));
    const before = JSON.parse(await readFile(path.join(dirOf("P-3"), "ready.json"), "utf8"));
    await writeFile(sandbox.transformZip, "handler-v2");
    await sandbox.clearCalls();
    const outcome = await processParcel(recorder(), request("P-3"));
    expect(outcome.status).toBe("ready");
    const commands = (await sandbox.calls()).map((call) => call.command).filter((c) => c !== "--version");
    expect(commands).toEqual(["transform", "validate"]);
    const after = JSON.parse(await readFile(path.join(dirOf("P-3"), "ready.json"), "utf8"));
    expect(after.transformVersion).not.toBe(before.transformVersion);
    expect(after.captureHash).toBe(before.captureHash);
  });

  it("merges a Seed group from the seed row when the county transform emits none", async () => {
    process.env.FAKE_NO_SEED = "1";
    const outcome = await processParcel(recorder(), request("P-10"));
    expect(outcome.status).toBe("ready");
    const dir = dirOf("P-10");
    const meta = JSON.parse(await readFile(path.join(dir, "transformed.meta.json"), "utf8"));
    expect(meta.seed).toMatchObject({
      mode: "auto",
      merged: true,
      added: ["data/address_has_parcel.json", "data/parcel.json", "data/root-seed-mode.json"],
      keptCountyCopy: ["data/address.json"],
    });
    const ready = JSON.parse(await readFile(path.join(dir, "ready.json"), "utf8"));
    expect(ready.dataGroups).toContain("Seed");
    const transforms = (await sandbox.calls()).filter((call) => call.command === "transform");
    expect(transforms).toHaveLength(2);
    expect(transforms[1]!.args).not.toContain("--transform-zip");

    process.env.TRANSFORM_SEED_TESTCOUNTY = "off";
    await sandbox.clearCalls();
    await processParcel(recorder(), request("P-10"));
    const rerun = (await sandbox.calls()).filter((call) => call.command === "transform");
    expect(rerun).toHaveLength(1);
  });

  it("records invalid fail-closed and clears it when a later pass validates (ok→invalid→ok)", async () => {
    await processParcel(recorder(), request("P-4"));
    process.env.FAKE_INVALID = "P-4";
    await writeFile(sandbox.transformZip, "handler-v2");
    const io = recorder();
    const invalid = await processParcel(io, request("P-4"));
    expect(invalid).toMatchObject({ status: "invalid", reason: "validation-failed: 2 finding(s)" });
    expect(io.records.at(-1)).toMatchObject({ status: "invalid", stage: "validate" });
    expect(await exists(path.join(dirOf("P-4"), "ready.json"))).toBe(false);
    expect(await exists(path.join(dirOf("P-4"), "eligibility.json"))).toBe(false);
    const marker = JSON.parse(await readFile(path.join(dirOf("P-4"), "invalid.json"), "utf8"));
    expect(marker.errors).toHaveLength(2);

    delete process.env.FAKE_INVALID;
    await writeFile(sandbox.transformZip, "handler-v3");
    const again = await processParcel(recorder(), request("P-4"));
    expect(again.status).toBe("ready");
    expect(await exists(path.join(dirOf("P-4"), "invalid.json"))).toBe(false);
    expect(await exists(path.join(dirOf("P-4"), "ready.json"))).toBe(true);
  });

  it("records a parcel gone at the source as dead and never throws", async () => {
    const io = recorder();
    const outcome = await processParcel(io, request("P-5", { source_url: "https://appraiser.example.gov/gone/5" }));
    expect(outcome).toMatchObject({ status: "dead" });
    expect(io.records.at(-1)).toMatchObject({ status: "dead", stage: "capture" });
    expect(io.steps).toEqual(["capture", "record-dead"]);
    expect(await exists(path.join(dirOf("P-5"), "dead.json"))).toBe(true);
  });

  it("throws (retryable) on a transient prepare failure instead of recording it", async () => {
    await expect(
      processParcel(recorder(), request("P-6", { source_url: "https://appraiser.example.gov/flaky/6" })),
    ).rejects.toThrow("prepare failed");
    expect(await exists(path.join(dirOf("P-6"), "dead.json"))).toBe(false);
  });

  it("records a rejected transform as failed (not invalid, not retried)", async () => {
    process.env.FAKE_TRANSFORM_FAIL = "P-7";
    const io = recorder();
    const outcome = await processParcel(io, request("P-7"));
    expect(outcome).toMatchObject({ status: "failed" });
    expect(io.records.at(-1)).toMatchObject({ status: "failed", stage: "transform" });
    expect(await exists(path.join(dirOf("P-7"), "failed.json"))).toBe(true);
  });

  it("uses a county capture plug-in when present instead of prepare", async () => {
    const plugin = path.join(sandbox.root, "capture.mjs");
    await writeFile(
      plugin,
      `import AdmZip from ${JSON.stringify(path.resolve("node_modules/adm-zip/adm-zip.js"))};
export async function capture(input) {
  if (input.parcel_id === "GONE") return { status: "dead", reason: "parcel-retired" };
  const zip = new AdmZip();
  zip.addFile("parcel.json", Buffer.from(JSON.stringify({ parcel_identifier: input.parcel_id, request_identifier: input.parcel_id })));
  zip.addFile("captures.json", Buffer.from(JSON.stringify({ captures: [] })));
  zip.writeZip(input.dest);
  return { status: "captured" };
}
`,
    );
    process.env.CAPTURE_MODULE_TESTCOUNTY = plugin;
    const outcome = await processParcel(recorder(), request("P-8"));
    expect(outcome.status).toBe("ready");
    const commands = (await sandbox.calls()).map((call) => call.command);
    expect(commands).not.toContain("prepare");
    const dead = await processParcel(recorder(), request("GONE"));
    expect(dead).toMatchObject({ status: "dead", reason: "parcel-retired" });
  });

  it("computes eligibility from the transformed usage type and the county policy", async () => {
    process.env.FAKE_USAGE_TYPE = "Commercial";
    process.env.PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TESTCOUNTY = "Commercial,Industrial";
    const outcome = await processParcel(recorder(), request("P-9", { city: "Marietta" }));
    expect(outcome).toMatchObject({ status: "ready", eligible: true });
    const eligibility = JSON.parse(await readFile(path.join(dirOf("P-9"), "eligibility.json"), "utf8"));
    expect(eligibility).toMatchObject({
      eligible: true,
      usageType: "Commercial",
      policyMode: "list",
      routing: { parcel_identifier: "P-9", city: "Marietta", situs_address: "1 Main St" },
    });
  });

  it("rejects invalid requests with a terminal error and keeps keys collision-safe", () => {
    expect(() => parseParcelRequest({ county: "Bad County", jobId: JOB, parcel_id: "1" })).toThrow("county");
    expect(() => parseParcelRequest({ county: COUNTY, jobId: "../x", parcel_id: "1" })).toThrow("jobId");
    expect(() => parseParcelRequest({ county: COUNTY, jobId: JOB, parcel_id: " " })).toThrow("parcel_id");
    expect(safeKeyPart("12-345-678")).toBe("12-345-678");
    expect(safeKeyPart("12 345/678")).not.toBe(safeKeyPart("12_345_678"));
    expect(safeKeyPart("..")).toMatch(/^_.*-[a-f0-9]{12}$/);
  });
});
