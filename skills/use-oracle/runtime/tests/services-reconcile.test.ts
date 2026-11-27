import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyRecord,
  type LedgerEntry,
  type LedgerRecordInput,
  parseRecordInput,
} from "../services/lib/ledger-state.ts";
import { parseParcelRequest, processParcel, type StepIO } from "../services/lib/parcel-flow.ts";
import { computePermitLinks, PERMIT_STATUS_SCHEMA } from "../services/lib/permit-steps.ts";
import {
  type LedgerSnapshot,
  loadLedger,
  loadLedgerWhenCaughtUp,
  readIngestSeedPath,
  reconcileCounty,
} from "../services/lib/reconcile.ts";
import { scanSeed, readSeedRange } from "../services/lib/seed.ts";
import { parseReconcileArguments } from "../bin/reconcile-county.mjs";
import { atomicWriteJson, exists, paths, safeKeyPart } from "../services/lib/storage.ts";
import { COUNTY, createSandbox, JOB, type Sandbox } from "./services-helpers.ts";

/** Runs parcels through the real step code and keeps the ledger in memory. */
function pipeline() {
  const parcels = new Map<string, LedgerEntry>();
  const permits = new Map<string, LedgerEntry>();
  const record = (payload: LedgerRecordInput) => {
    const input = parseRecordInput(payload);
    const store = input.stage === "permits" ? permits : parcels;
    const applied = applyRecord(store.get(input.parcel_id) ?? null, input, new Date().toISOString());
    store.set(input.parcel_id, applied.next);
  };
  const io: StepIO = {
    run: async (_name, action) => action(),
    record: async (input) => record(input),
  };
  return {
    record,
    process: (parcel_id: string, extra: Record<string, string> = {}) =>
      processParcel(io, parseParcelRequest({ county: COUNTY, jobId: JOB, parcel_id, extra })),
    snapshot: (): LedgerSnapshot => ({
      source: "admin-sql",
      parcels: new Map(parcels),
      permits: new Map(permits),
      summary: null,
      error: null,
    }),
  };
}

async function writeSeed(sandbox: Sandbox, ids: string[]) {
  await writeFile(
    path.join(sandbox.dataDir, "seeds", `${COUNTY}.csv`),
    `parcel_id,situs_address\n${ids.map((id) => `${id},"1 Main St, Testville"`).join("\n")}\n`,
  );
}

const gate = (manifest: { gates: Array<{ name: string; status: string }> }, name: string) =>
  manifest.gates.find((item) => item.name === name)?.status;

describe("reconcile-county gates", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  async function completeRun() {
    const run = pipeline();
    await writeSeed(sandbox, ["A", "B", "C", "D"]);
    process.env.FAKE_INVALID = "D";
    await run.process("A");
    await run.process("B");
    await run.process("C", { source_url: "https://appraiser.example.gov/gone/C" });
    await run.process("D");
    delete process.env.FAKE_INVALID;
    return run;
  }

  it("passes every gate when seed = ready + dead + invalid and writes the manifest", async () => {
    const run = await completeRun();
    const { manifest, manifestPath, exitCode } = await reconcileCounty({
      county: COUNTY,
      jobId: JOB,
      ledger: run.snapshot(),
      strict: true,
    });
    expect(exitCode).toBe(0);
    expect(manifest.failedGates).toEqual([]);
    expect(manifest.counts).toMatchObject({ ready: 2, dead: 1, invalid: 1, pending: 0, failed: 0, unrecorded: 0 });
    expect(manifest.reasons.dead).toEqual({ "gone-at-source": 1 });
    expect(manifest.reasons.invalid).toEqual({ "validation-failed": 1 });
    expect(manifest.readyHashCoverage).toMatchObject({ ledgerReady: 2, readyMarkers: 2, verified: 2 });
    expect(gate(manifest, "permits_complete")).toBe("not_started");
    expect(manifestPath).toBe(path.join(sandbox.dataDir, "runs", COUNTY, JOB, "manifest.json"));
    expect(JSON.parse(await readFile(manifestPath, "utf8")).schemaVersion).toBe("oracle.run-manifest.v1");
  });

  it("accounts pending parcels but fails completion, and --strict blocks assembly", async () => {
    const run = await completeRun();
    await writeSeed(sandbox, ["A", "B", "C", "D", "E"]);
    run.record({ parcel_id: "E", stage: "capture", status: "pending" });
    const result = await reconcileCounty({
      county: COUNTY,
      jobId: JOB,
      ledger: run.snapshot(),
      strict: true,
      assemble: "county",
    });
    expect(gate(result.manifest, "seed_accounted")).toBe("pass");
    expect(gate(result.manifest, "seed_complete")).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.manifest.groups.assembly).toMatchObject({ skipped: true });
    expect(await exists(paths.group(COUNTY, JOB, "county"))).toBe(false);
  });

  it("fails seed accounting for an unrecorded seed parcel and duplicate keys for a repeated id", async () => {
    const run = await completeRun();
    await writeSeed(sandbox, ["A", "B", "C", "D", "F", "A"]);
    const { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() });
    expect(gate(manifest, "seed_accounted")).toBe("fail");
    expect(manifest.counts.unrecorded).toBe(1);
    expect(gate(manifest, "no_duplicate_keys")).toBe("fail");
    expect(manifest.seed.duplicates).toEqual(["A"]);
  });

  it("fails ready-hash coverage when transformed output no longer matches its ready marker", async () => {
    const run = await completeRun();
    await writeFile(path.join(paths.parcelDir(COUNTY, JOB, "A"), "transformed.zip"), "tampered");
    const { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() });
    expect(gate(manifest, "ready_hash_coverage")).toBe("fail");
    expect(manifest.readyHashCoverage.mismatches).toEqual([
      { parcel_id: "A", issue: "transformed.zip content differs from ready.json hash" },
    ]);
  });

  it("reports ledger/file mismatches", async () => {
    const run = await completeRun();
    const ledger = run.snapshot();
    ledger.parcels.set("C", { ...ledger.parcels.get("C")!, status: "failed", reason: "transform-failed: x" });
    const { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger });
    expect(gate(manifest, "ledger_files_agree")).toBe("fail");
    expect(manifest.mismatches.items).toContainEqual({ parcel_id: "C", issue: "ledger failed but failed.json missing" });
  });

  it("requires every harvested permit to be linked or unlinked with a reason", async () => {
    const run = await completeRun();
    const statusPath = (id: string) => paths.permitStatus(COUNTY, JOB, id);
    const base = {
      schemaVersion: PERMIT_STATUS_SCHEMA,
      county: COUNTY,
      jobId: JOB,
      requestedParcelIdentifier: "A",
      jurisdictionKey: "unincorporated",
      adapterKey: "accela",
      harvestStatus: "done",
      parcelReason: null,
      transientFailures: 0,
      artifacts: { raw: null, extracted: null, status: null },
      completedAt: "2026-11-25T00:00:00Z",
    };
    await atomicWriteJson(statusPath("A"), {
      ...base,
      parcel_id: "A",
      parcelKey: "A",
      permitCount: 2,
      linkedCount: 1,
      unlinkedCount: 1,
      permits: [
        { sourceRecordId: "BLD-1", permitNumber: "BLD-1", link: "linked", reason: null },
        { sourceRecordId: "BLD-2", permitNumber: "BLD-2", link: "unlinked", reason: null },
      ],
    });
    run.record({ parcel_id: "A", stage: "permits", status: "ready", reason: "unlinked: 1" });
    let { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() });
    expect(gate(manifest, "permits_linked")).toBe("fail");
    expect(manifest.permits.unlinkedWithoutReason).toEqual([{ parcel_id: "A", sourceRecordId: "BLD-2" }]);

    const fixed = JSON.parse(await readFile(statusPath("A"), "utf8"));
    fixed.permits[1].reason = "detail_failed: source_unavailable";
    await atomicWriteJson(statusPath("A"), fixed);
    ({ manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() }));
    expect(gate(manifest, "permits_linked")).toBe("pass");
    expect(manifest.permits).toMatchObject({ permits: 2, linked: 1, unlinked: 1, unlinkedByReason: { detail_failed: 1 } });
  });

  it("flags eligible parcels without a permit status once a permit pass has started", async () => {
    process.env.PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TESTCOUNTY = "__ALL__";
    const run = await completeRun();
    run.record({ parcel_id: "A", stage: "permits", status: "dead", reason: "no_permit_profile" });
    await atomicWriteJson(paths.permitStatus(COUNTY, JOB, "A"), {
      schemaVersion: PERMIT_STATUS_SCHEMA,
      parcel_id: "A",
      parcelKey: "A",
      harvestStatus: "no_profile",
      parcelReason: "no_permit_profile",
      permits: [],
    });
    const { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() });
    expect(gate(manifest, "permits_complete")).toBe("fail");
    expect(manifest.permits.eligibleWithoutStatus).toBe(1);
    expect(manifest.permits.parcelsWithoutPermitsByReason).toEqual({ no_permit_profile: 1 });
  });

  it("assembles one-group dirs from verified ready parcels and excludes tombstones", async () => {
    const run = await completeRun();
    let result = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot(), assemble: "county" });
    const groupDir = paths.group(COUNTY, JOB, "county");
    expect(result.manifest.groups.assembly).toMatchObject({ parcels: 2, written: 2 });
    const entries = new AdmZip(path.join(groupDir, "A.zip")).getEntries().map((entry) => entry.entryName).sort();
    expect(entries).toEqual([
      "data/address.json",
      "data/property.json",
      "data/relationship_property_has_address.json",
      "data/relationship_seed.json",
      expect.stringMatching(/^data\/root-[0-9a-f]{8}\.json$/),
      "data/root-seed.json",
    ]);
    expect(entries.join(",")).not.toContain("photo");
    expect(result.manifest.groups.assembly).toMatchObject({ withoutGroup: 0 });

    // A becomes invalid after it was ready: a tombstone still sitting in the group dir.
    process.env.FAKE_INVALID = "A";
    await writeFile(sandbox.transformZip, "handler-v2");
    await run.process("A");
    delete process.env.FAKE_INVALID;
    result = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot() });
    expect(result.manifest.tombstones).toMatchObject({ count: 1, parcels: ["A"] });
    expect(gate(result.manifest, "tombstones_excluded")).toBe("fail");

    result = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: run.snapshot(), assemble: "county" });
    expect(result.manifest.groups.assembly).toMatchObject({ parcels: 1, skipped: 1, removed: 1 });
    expect(gate(result.manifest, "tombstones_excluded")).toBe("pass");
    expect(await exists(path.join(groupDir, "A.zip"))).toBe(false);
  });

  it("reads the ledger through admin SQL, falls back to the ingress, and fails gates without either", async () => {
    const entry = (parcel_id: string, status: string): LedgerEntry => ({
      parcel_id,
      stage: "ready",
      status: status as LedgerEntry["status"],
      reason: null,
      artifactHash: null,
      transformVersion: null,
      detail: null,
      previousStatus: null,
      wasReady: false,
      tombstoned: false,
      transitions: 0,
      updatedAt: "t",
    });
    const json = (value: unknown, ok = true) =>
      new Response(JSON.stringify(value), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });
    const adminFetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe("http://admin:9070/query");
      expect(JSON.parse(String(init.body)).query).toContain("service_key = 'testcounty-job-1'");
      return json({
        rows: [
          { key: "p:A", value_utf8: JSON.stringify(entry("A", "ready")) },
          { key: "permit:A", value_utf8: JSON.stringify({ ...entry("A", "ready"), stage: "permits" }) },
          { key: "counts", value_utf8: JSON.stringify({ pending: 0, ready: 1, dead: 0, invalid: 0, failed: 0 }) },
        ],
      });
    }) as unknown as typeof fetch;
    const viaSql = await loadLedger({ adminUrl: "http://admin:9070", ingressUrl: "http://ingress:8080", key: "testcounty-job-1", fetchImpl: adminFetch });
    expect(viaSql.source).toBe("admin-sql");
    expect([...viaSql.parcels.keys()]).toEqual(["A"]);
    expect(viaSql.permits.size).toBe(1);
    expect(viaSql.summary?.counts.ready).toBe(1);

    const pages: Record<string, unknown> = {};
    const ingressFetch = (async (url: string, init: RequestInit) => {
      if (url.includes("/query")) return json({ message: "down" }, false);
      if (url.endsWith("/summary")) return json({ key: "k", parcels: 2, counts: {}, tombstones: 0, permits: {} });
      const body = JSON.parse(String(init.body ?? "{}"));
      pages[`${body.stage ?? "p"}:${body.cursor ?? ""}`] = true;
      if (body.stage === "permits") return json({ entries: [], cursor: null });
      return body.cursor
        ? json({ entries: [entry("B", "dead")], cursor: null })
        : json({ entries: [entry("A", "ready")], cursor: "A" });
    }) as unknown as typeof fetch;
    const viaIngress = await loadLedger({ adminUrl: "http://admin:9070", ingressUrl: "http://ingress:8080", key: "k", fetchImpl: ingressFetch });
    expect(viaIngress.source).toBe("ingress");
    expect([...viaIngress.parcels.keys()]).toEqual(["A", "B"]);
    expect(viaIngress.error).toContain("admin-sql");

    const down = (async () => json({}, false)) as unknown as typeof fetch;
    const none = await loadLedger({ adminUrl: "http://a", ingressUrl: "http://b", key: "k", fetchImpl: down });
    expect(none.source).toBe("none");
    await writeSeed(sandbox, ["A"]);
    const { manifest, exitCode } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: none, strict: true });
    expect(gate(manifest, "seed_accounted")).toBe("fail");
    expect(exitCode).toBe(1);
  });
});

describe("reconcile seed source and blocked permits", () => {
  const json = (value: unknown, ok = true) =>
    new Response(JSON.stringify(value), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });

  it("reads the run's seed path from CountyIngest state, then its status handler", async () => {
    const viaSql = (async (url: string, init: RequestInit) => {
      expect(url).toBe("http://admin/query");
      expect(JSON.parse(String(init.body)).query).toContain("service_name = 'CountyIngest'");
      return json({ rows: [{ value_utf8: JSON.stringify({ path: "seeds/cobb-pilot.csv", rows: 25 }) }] });
    }) as unknown as typeof fetch;
    expect(await readIngestSeedPath({ adminUrl: "http://admin", ingressUrl: "http://ingress", key: "cobb-p1", fetchImpl: viaSql })).toEqual({
      path: "seeds/cobb-pilot.csv",
      source: "countyingest-state",
    });
    const viaStatus = (async (url: string) => {
      if (url.endsWith("/query")) return json({}, false);
      expect(url).toBe("http://ingress/CountyIngest/cobb-p1/status");
      return json({ phase: "done", seed: { path: "seeds/cobb-pilot.csv" } });
    }) as unknown as typeof fetch;
    expect(await readIngestSeedPath({ adminUrl: "http://admin", ingressUrl: "http://ingress", key: "cobb-p1", fetchImpl: viaStatus })).toMatchObject({
      source: "countyingest-status",
    });
    const none = (async () => json({}, false)) as unknown as typeof fetch;
    expect(await readIngestSeedPath({ adminUrl: "http://a", ingressUrl: "http://b", key: "k", fetchImpl: none })).toBeNull();
  });

  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("uses a non-default seed and reports blocked permit sources apart from dead ones", async () => {
    const run = pipeline();
    await writeFile(
      path.join(sandbox.dataDir, "seeds", "pilot.csv"),
      "parcel_id,situs_address\nA,1 Main St\nB,2 Main St\n",
    );
    process.env.PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TESTCOUNTY = "__ALL__";
    await run.process("A");
    await run.process("B");
    for (const [id, harvestStatus, reason, jurisdictionKey] of [
      ["A", "blocked", "blocked: no_public_historical_search", "beach"],
      ["B", "no_profile", "no_permit_profile", null],
    ] as const) {
      await atomicWriteJson(paths.permitStatus(COUNTY, JOB, id), {
        schemaVersion: PERMIT_STATUS_SCHEMA,
        parcel_id: id,
        parcelKey: id,
        jurisdictionKey,
        harvestStatus,
        parcelReason: reason,
        permits: [],
      });
      run.record({ parcel_id: id, stage: "permits", status: harvestStatus === "blocked" ? "blocked" : "dead", reason });
    }
    const { manifest } = await reconcileCounty({
      county: COUNTY,
      jobId: JOB,
      ledger: run.snapshot(),
      seedPath: "seeds/pilot.csv",
      seedSource: "countyingest-state",
      strict: true,
    });
    expect(manifest.seed).toMatchObject({ path: "seeds/pilot.csv", source: "countyingest-state", rows: 2 });
    expect(manifest.failedGates).toEqual([]);
    expect(manifest.permits.blocked).toEqual({ parcels: 1, byJurisdiction: { beach: 1 } });
    expect(manifest.permits.harvestStatus).toEqual({ blocked: 1, no_profile: 1 });
  });
});

describe("reconcile-county arguments", () => {
  it("parses the contract flags and refuses Seed as an assembled group", () => {
    expect(
      parseReconcileArguments(
        ["--county", "cobb", "--job", "2026q4", "--restate", "http://localhost:19070", "--strict", "--assemble", "county"],
        {},
      ),
    ).toMatchObject({
      county: "cobb",
      jobId: "2026q4",
      adminUrl: "http://localhost:19070",
      ingressUrl: "http://localhost:8080",
      strict: true,
      assemble: "county",
      rehash: true,
    });
    expect(() => parseReconcileArguments(["--county", "cobb"], {})).toThrow("reconcile-county");
    expect(() => parseReconcileArguments(["--county", "cobb", "--job", "j", "--assemble", "seed"], {})).toThrow(
      "never published as its own group",
    );
  });
});

describe("permit link classification", () => {
  it("links bound records and explains every unlinked reference", () => {
    const links = computePermitLinks(
      "12-345",
      [{ sourceRecordId: "P1" }, { sourceRecordId: "P2", permitNumber: "P2" }, { sourceRecordId: "P3" }],
      [
        { sourceRecordId: "P1", permit_number: "P1", parcel_identifier: "12-345", requestedParcelIdentifier: "12-345" },
        { sourceRecordId: "P3", permit_number: "P3", parcel_identifier: "99-999", requestedParcelIdentifier: "12-345" },
      ],
      [{ classification: "permanent", errorCode: "detail_unavailable", message: "x" }],
    );
    expect(links).toEqual([
      { sourceRecordId: "P1", permitNumber: "P1", link: "linked", reason: null },
      { sourceRecordId: "P2", permitNumber: "P2", link: "unlinked", reason: "detail_failed: detail_unavailable" },
      { sourceRecordId: "P3", permitNumber: "P3", link: "unlinked", reason: "parcel_mismatch: bound to 99-999" },
    ]);
  });
});

describe("seed index", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("chunks by byte range, honours quoted newlines and skips blank rows", async () => {
    const seed = path.join(sandbox.dataDir, "seeds", "chunks.csv");
    await writeFile(
      seed,
      '﻿parcel_id,situs_address\r\n1,"10 A St\nUnit 2"\r\n2,20 B St\r\n\r\n3,"30, C St"\r\n4,40 D St\r\n5,50 E St',
    );
    const index = await scanSeed(seed, 2);
    expect(index.header).toEqual(["parcel_id", "situs_address"]);
    expect(index.rows).toBe(5);
    expect(index.chunks.map((chunk) => chunk.rows)).toEqual([2, 2, 1]);
    const rows = [];
    for (const chunk of index.chunks) rows.push(...(await readSeedRange(seed, index.headerText, chunk.start, chunk.end)));
    expect(rows.map((row) => row.parcel_id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(rows[0]!.situs_address).toBe("10 A St\nUnit 2");
    expect(rows[2]!.situs_address).toBe("30, C St");
    expect(safeKeyPart(rows[0]!.parcel_id)).toBe("1");
  });
});

describe("reconcile ledger wait (RECONCILE_LEDGER_WAIT_MS)", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  const row = (id: string, status: string) => ({
    key: `p:${id}`,
    value_utf8: JSON.stringify({ parcel_id: id, stage: "ready", status }),
  });
  /** Admin SQL that returns the next scripted ledger on each read (last one repeats). */
  function scripted(reads: Array<Array<{ key: string; value_utf8: string }>>) {
    let calls = 0;
    const fetchImpl = (async () => json({ rows: reads[Math.min(calls++, reads.length - 1)] })) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  }
  function fakeTime() {
    let t = 0;
    const slept: number[] = [];
    return {
      clock: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
      slept,
    };
  }
  const base = { adminUrl: "http://admin:9070", ingressUrl: "http://ingress:8080", key: `${COUNTY}-${JOB}`, seedPath: `seeds/${COUNTY}.csv` };

  it("defaults to today's behaviour: one read, no wait, nothing recorded", async () => {
    await writeSeed(sandbox, ["A", "B"]);
    const ledger = scripted([[row("A", "ready")]]);
    const time = fakeTime();
    const { ledger: snapshot, wait } = await loadLedgerWhenCaughtUp({ ...base, timeoutMs: 0, pollMs: 10, fetchImpl: ledger.fetchImpl, ...time });
    expect(ledger.calls()).toBe(1);
    expect(time.slept).toEqual([]);
    expect(wait).toBeNull();
    expect(snapshot.parcels.size).toBe(1);

    const parsed = parseReconcileArguments(["--county", COUNTY, "--job", JOB], {});
    expect(parsed.ledgerWaitMs).toBe(0);
    expect(parseReconcileArguments(["--county", COUNTY, "--job", JOB], { RECONCILE_LEDGER_WAIT_MS: "60000" }).ledgerWaitMs).toBe(60000);
  });

  it("re-reads until every seed parcel is settled, then reconciles the caught-up ledger", async () => {
    await writeSeed(sandbox, ["A", "B"]);
    const ledger = scripted([[row("A", "ready")], [row("A", "ready"), row("B", "pending")], [row("A", "dead"), row("B", "invalid")]]);
    const time = fakeTime();
    const { ledger: snapshot, wait } = await loadLedgerWhenCaughtUp({ ...base, timeoutMs: 1000, pollMs: 100, fetchImpl: ledger.fetchImpl, ...time });
    expect(ledger.calls()).toBe(3);
    expect(wait).toMatchObject({ caughtUp: true, attempts: 3, waitedMs: 200, missing: 0, pending: 0 });
    const { manifest } = await reconcileCounty({ county: COUNTY, jobId: JOB, ledger: snapshot, ledgerWait: wait });
    expect(manifest.ledger.wait).toMatchObject({ caughtUp: true, attempts: 3 });
    expect(gate(manifest, "seed_accounted")).toBe("pass");
  });

  it("stops at the timeout and hands back the last read with the lag recorded", async () => {
    await writeSeed(sandbox, ["A", "B", "C"]);
    const ledger = scripted([[row("A", "ready"), row("B", "pending")]]);
    const time = fakeTime();
    const { wait } = await loadLedgerWhenCaughtUp({ ...base, timeoutMs: 250, pollMs: 100, fetchImpl: ledger.fetchImpl, ...time });
    expect(wait).toMatchObject({ caughtUp: false, attempts: 3, waitedMs: 200, missing: 1, pending: 1 });
    expect(time.slept).toEqual([100, 100]);
  });
});
