import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveEligibilityPolicy } from "../services/lib/county-config.ts";
import { enqueueParcels, enqueuePermits, permitStatusIsTerminal } from "../services/lib/enqueue.ts";
import {
  CONSOLE_PIPELINE_URL,
  type FetchLike,
  checkCap,
  configuredScopeCaps,
  handoffLinks,
  judgeSample,
  parcelIdempotencyKey,
  parseDurationMs,
  parseLevels,
  permitScope,
  appraisalScope,
  rampStep,
  rateAndEta,
  scopeCap,
} from "../services/lib/flow-control.ts";
import { readEnqueueSeedPath } from "../services/lib/reconcile.ts";
import { collectRunStatus, formatRunStatus } from "../services/lib/run-status.ts";
import { atomicWriteJson, paths } from "../services/lib/storage.ts";
import { COUNTY, JOB, createSandbox, type Sandbox } from "./services-helpers.ts";

const ADMIN = "http://restate.test:9070";
const INGRESS = "http://restate.test:8080";
const LOCAL_ENV = [
  "APPRAISAL_SCOPE_TESTCOUNTY",
  "SCOPE_CAP_QPUBLIC",
  "SCOPE_CAP_TESTCOUNTY_APPRAISAL",
  "CONCURRENCY_PREPARE",
  "CONCURRENCY_PREPARE_TESTCOUNTY",
  "CONCURRENCY_PERMIT_JAXEPICS",
  "PERMIT_SCOPE_DUVAL_CLICK2GOV",
];

type Sent = { scope: string; service: string; handler: string; key: string; body: Record<string, unknown> };

/** A minimal Restate: version, SQL over a few system tables, the rule book and the scoped ingress. */
function fakeRestate(options: { vqueues?: boolean; queues?: Array<Record<string, unknown>>; failFirst?: number; reject?: string } = {}) {
  const rules = new Map<string, { concurrency: number; version: number; description: string }>();
  const accepted = new Set<string>();
  const sent: Sent[] = [];
  const puts: unknown[] = [];
  let failures = options.failFirst ?? 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    if (url.origin === ADMIN) {
      if (url.pathname === "/version") {
        return json({ version: "1.7.9", features: { vqueues: options.vqueues ?? true } });
      }
      if (url.pathname === "/limits/rules" && method === "PUT") {
        const batch = JSON.parse(String(init?.body)) as Array<{ pattern: string; limits: { concurrency: number }; description: string }>;
        puts.push(...batch);
        for (const rule of batch) {
          const version = (rules.get(rule.pattern)?.version ?? 0) + 1;
          rules.set(rule.pattern, { concurrency: rule.limits.concurrency, version, description: rule.description });
        }
        return json(batch);
      }
      if (url.pathname === "/query") {
        const sql = (JSON.parse(String(init?.body)) as { query: string }).query;
        if (sql.includes("FROM sys_rules")) {
          const pattern = /pattern = '([^']+)'/.exec(sql)?.[1] ?? "";
          const rule = rules.get(pattern);
          return json({ rows: rule ? [{ pattern, concurrency: rule.concurrency, disabled: false, version: rule.version }] : [] });
        }
        if (sql.includes("FROM sys_vqueue_meta")) {
          const service = /service_name = '([^']+)'/.exec(sql)?.[1];
          const scope = /scope = '([^']+)'/.exec(sql)?.[1];
          return json({
            rows: (options.queues ?? []).filter(
              (row) => row.service_name === service && (scope === undefined || row.scope === scope),
            ),
          });
        }
        if (sql.includes("FROM sys_user_limits")) {
          return json({
            rows: [...rules.entries()].map(([scope, rule]) => ({
              scope,
              usage: rule.concurrency,
              concurrency_limit: rule.concurrency,
              available: 0,
              num_waiters: 1,
            })),
          });
        }
        if (sql.includes("FROM sys_invocation")) return json({ rows: [{ service: "Parcel", status: "backing-off", n: 2 }] });
        return json({ rows: [] });
      }
      return json({ message: "not found" }, 404);
    }
    const match = /^\/restate\/scope\/([^/]+)\/send\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (url.origin === INGRESS && match && method === "POST") {
      if (failures > 0) {
        failures -= 1;
        return json({ message: "unavailable" }, 503);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (options.reject && body.parcel_id === options.reject) return json({ message: "bad request" }, 400);
      const key = new Headers(init?.headers).get("idempotency-key") ?? "";
      const identity = `${match[1]}/${key}`;
      sent.push({ scope: match[1]!, service: match[2]!, handler: match[3]!, key, body });
      const status = accepted.has(identity) ? "PreviouslyAccepted" : "Accepted";
      accepted.add(identity);
      return json({ invocationId: `inv_${sent.length}`, status });
    }
    return json({ message: "unexpected" }, 500);
  };
  return { fetchImpl, rules, sent, puts };
}

describe("flow control: enqueue path", () => {
  let sandbox: Sandbox;
  let saved: Record<string, string | undefined>;
  beforeEach(async () => {
    saved = Object.fromEntries(LOCAL_ENV.map((name) => [name, process.env[name]]));
    for (const name of LOCAL_ENV) delete process.env[name];
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function seed(rows: string[]) {
    await writeFile(
      path.join(sandbox.dataDir, "seeds", "flow.csv"),
      `parcel_id,situs_address,city\n${rows.map((id) => `${id},1 Main St,Springfield`).join("\n")}\n`,
    );
  }

  it("sends one scoped, keyed Parcel.process per unfinished row, skips ready/dead, and is idempotent", async () => {
    await seed(["P-1", "P-2", "P-3", "P-4", "P-5"]);
    await atomicWriteJson(path.join(paths.parcelDir(COUNTY, JOB, "P-2"), "ready.json"), { parcel_id: "P-2" });
    await atomicWriteJson(path.join(paths.parcelDir(COUNTY, JOB, "P-4"), "dead.json"), { parcel_id: "P-4" });
    const restate = fakeRestate();
    const options = { county: COUNTY, jobId: JOB, seed: "seeds/flow.csv", ingressUrl: INGRESS, adminUrl: ADMIN, fetchImpl: restate.fetchImpl };

    const first = await enqueueParcels(options);
    expect(first).toMatchObject({
      scope: "testcounty-appraisal",
      seedRows: 5,
      sent: 3,
      skipped: 2,
      skippedBy: { "ready.json": 1, "dead.json": 1 },
      counts: { Accepted: 3 },
      failures: 0,
      rule: { scope: "testcounty-appraisal", cap: 6, action: "created" },
    });
    expect(restate.sent.map((call) => call.key).sort()).toEqual([
      "testcounty-job-1-P-1",
      "testcounty-job-1-P-3",
      "testcounty-job-1-P-5",
    ]);
    expect(new Set(restate.sent.map((call) => `${call.scope} ${call.service}/${call.handler}`))).toEqual(
      new Set(["testcounty-appraisal Parcel/process"]),
    );
    expect(restate.sent.find((call) => call.body.parcel_id === "P-1")?.body).toMatchObject({
      county: COUNTY,
      jobId: JOB,
      parcel_id: "P-1",
      situs_address: "1 Main St",
      extra: { city: "Springfield" },
    });
    // In-process capture cap (default 4) is not above the scope cap (6).
    expect(first.warnings.join(" ")).toContain("CONCURRENCY_PREPARE_TESTCOUNTY");

    // The ramp raised the cap meanwhile; a re-run keeps it and dedupes every key.
    restate.rules.set("testcounty-appraisal", { concurrency: 12, version: 2, description: "ramp" });
    const second = await enqueueParcels(options);
    expect(second).toMatchObject({ sent: 3, counts: { PreviouslyAccepted: 3 }, rule: { cap: 12, action: "kept" } });
    expect(restate.puts).toHaveLength(1);

    const record = JSON.parse(await readFile(path.join(paths.run(COUNTY, JOB), "enqueue.json"), "utf8"));
    expect(record).toMatchObject({ scope: "testcounty-appraisal", seed: "seeds/flow.csv", seedRows: 5 });
    expect(record.firstRunAt).toBeTruthy();
    await expect(readEnqueueSeedPath(COUNTY, JOB)).resolves.toEqual({ path: "seeds/flow.csv", source: "enqueue-record" });
  });

  it("routes to a configured shared scope at its configured cap, and --cap overrides a kept rule", async () => {
    await seed(["P-1"]);
    process.env.APPRAISAL_SCOPE_TESTCOUNTY = "qpublic";
    process.env.SCOPE_CAP_QPUBLIC = "4";
    process.env.CONCURRENCY_PREPARE_TESTCOUNTY = "24";
    const restate = fakeRestate();
    const options = { county: COUNTY, jobId: JOB, seed: "seeds/flow.csv", ingressUrl: INGRESS, adminUrl: ADMIN, fetchImpl: restate.fetchImpl };
    const first = await enqueueParcels(options);
    expect(first.rule).toEqual({ scope: "qpublic", cap: 4, action: "created" });
    expect(first.warnings).toEqual([]);
    expect(restate.sent[0]).toMatchObject({ scope: "qpublic", key: "testcounty-job-1-P-1" });
    const forced = await enqueueParcels({ ...options, cap: 12 });
    expect(forced.rule).toEqual({ scope: "qpublic", cap: 12, action: "set" });
    await expect(enqueueParcels({ ...options, cap: 24 })).rejects.toThrow(/above 18/);
    await expect(enqueueParcels({ ...options, cap: 24, benchmarked: true })).resolves.toMatchObject({ rule: { cap: 24 } });
  });

  it("retries transient ingress answers, records terminal ones, and refuses a server without VQueues", async () => {
    await seed(["P-1", "BAD"]);
    const restate = fakeRestate({ failFirst: 1, reject: "BAD" });
    const summary = await enqueueParcels({
      county: COUNTY,
      jobId: JOB,
      seed: "seeds/flow.csv",
      ingressUrl: INGRESS,
      adminUrl: ADMIN,
      parallel: 1,
      fetchImpl: restate.fetchImpl,
    });
    expect(summary.counts).toEqual({ Accepted: 1 });
    expect(summary.failures).toBe(1);
    expect(summary.failureSample[0]).toMatch(/^BAD: HTTP 400/);

    const off = fakeRestate({ vqueues: false });
    await expect(
      enqueueParcels({ county: COUNTY, jobId: JOB, seed: "seeds/flow.csv", ingressUrl: INGRESS, adminUrl: ADMIN, fetchImpl: off.fetchImpl }),
    ).rejects.toThrow(/without VQueues/);
    expect(off.sent).toHaveLength(0);
  });

  it("enqueues permits per source scope once appraisal drains, skipping terminal permit statuses", async () => {
    process.env.PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_DUVAL = "__ALL__";
    process.env.PERMIT_SCOPE_DUVAL_CLICK2GOV = "jaxbeach-click2gov";
    const fingerprint = resolveEligibilityPolicy("duval").fingerprint;
    const job = "full-20261126";
    const ready = async (parcelId: string, city: string) => {
      const dir = paths.parcelDir("duval", job, parcelId);
      await atomicWriteJson(path.join(dir, "ready.json"), { parcel_id: parcelId });
      await atomicWriteJson(path.join(dir, "eligibility.json"), {
        parcel_id: parcelId,
        eligible: true,
        usageType: null,
        policyFingerprint: fingerprint,
        policyMode: "all",
        routing: { parcel_identifier: parcelId, source_identifier: null, situs_address: "1 Ocean Blvd", city, seed: { parcel_id: parcelId, city } },
      });
    };
    await ready("A-1", "JACKSONVILLE");
    await ready("A-2", "JACKSONVILLE");
    await ready("B-1", "JACKSONVILLE BEACH");
    // A-2 already harvested (terminal); B-1 had transient failures (sent again).
    await atomicWriteJson(paths.permitStatus("duval", job, "A-2"), { harvestStatus: "done", transientFailures: 0 });
    await atomicWriteJson(paths.permitStatus("duval", job, "B-1"), { harvestStatus: "failed", transientFailures: 1 });

    const draining = fakeRestate({
      queues: [{ service_name: "Parcel", scope: "duval-appraisal", num_inbox: 3, num_running: 2, num_suspended: 0, num_paused: 0, num_finished: 10 }],
    });
    const options = { county: "duval", jobId: job, ingressUrl: INGRESS, adminUrl: ADMIN };
    await expect(enqueuePermits({ ...options, fetchImpl: draining.fetchImpl })).rejects.toThrow(/still has 5 parcel/);

    const restate = fakeRestate({
      queues: [{ service_name: "Parcel", scope: "duval-appraisal", num_inbox: 0, num_running: 0, num_suspended: 0, num_paused: 0, num_finished: 3 }],
    });
    const summary = await enqueuePermits({ ...options, fetchImpl: restate.fetchImpl });
    expect(summary).toMatchObject({
      eligible: 3,
      sent: 2,
      skipped: 1,
      skippedBy: { "status:done": 1 },
      scopes: { "duval-permits-jaxepics": 1, "jaxbeach-click2gov": 1 },
      counts: { Accepted: 2 },
      failures: 0,
    });
    expect(summary.rules).toEqual([
      { scope: "duval-permits-jaxepics", cap: 2, action: "created" },
      { scope: "jaxbeach-click2gov", cap: 2, action: "created" },
    ]);
    expect(restate.sent.map((call) => [call.scope, call.service, call.handler, call.key]).sort()).toEqual([
      ["duval-permits-jaxepics", "PermitHarvest", "harvestParcel", "duval-full-20261126-permits-A-1"],
      ["jaxbeach-click2gov", "PermitHarvest", "harvestParcel", "duval-full-20261126-permits-B-1"],
    ]);
    await expect(enqueuePermits({ ...options, fetchImpl: draining.fetchImpl, force: true })).resolves.toMatchObject({ appraisalLeft: 5 });
  });

  it("reports queue, files, rate, ETA and the hand-off links", async () => {
    await seed(["P-1", "P-2", "P-3", "P-4"]);
    const restate = fakeRestate({
      queues: [{ service_name: "Parcel", scope: "testcounty-appraisal", num_inbox: 100, num_running: 6, num_suspended: 0, num_paused: 0, num_finished: 50 }],
    });
    await enqueueParcels({ county: COUNTY, jobId: JOB, seed: "seeds/flow.csv", ingressUrl: INGRESS, adminUrl: ADMIN, fetchImpl: restate.fetchImpl });
    await atomicWriteJson(path.join(paths.parcelDir(COUNTY, JOB, "P-1"), "ready.json"), { parcel_id: "P-1" });
    await atomicWriteJson(path.join(paths.parcelDir(COUNTY, JOB, "P-2"), "ready.json"), { parcel_id: "P-2" });
    await atomicWriteJson(path.join(paths.parcelDir(COUNTY, JOB, "P-3"), "dead.json"), { parcel_id: "P-3" });
    const nowMs = Date.now() + 1000;
    const status = await collectRunStatus({
      county: COUNTY,
      jobId: JOB,
      adminUrl: "http://localhost:19070",
      fetchImpl: async (input, init) => restate.fetchImpl(input.replace("http://localhost:19070", ADMIN), init),
      minutes: 10,
      nowMs,
      sshUser: "miner",
      sshHost: "vm.example",
    });
    expect(status.appraisal).toMatchObject({ scope: "testcounty-appraisal", parcelsLeft: 106, parcelsLeftSource: "sys_vqueue_meta" });
    expect(status.files).toMatchObject({ seedRows: 4, ready: 2, dead: 1 });
    expect(status.window).toEqual({ minutes: 10, ready: 2, dead: 1 });
    expect(status.rate.parcelsPerHour).toBe(18);
    expect(status.stuck).toEqual({ "Parcel:backing-off": 2 });
    expect(status.links).toEqual({
      restateUi: "http://127.0.0.1:19070/ui",
      sshTunnel: "ssh -N -L 19070:127.0.0.1:19070 miner@vm.example",
      parcelsLeftSql: expect.stringContaining("FROM sys_vqueue_meta WHERE service_name = 'Parcel' AND scope = 'testcounty-appraisal'"),
      consolePipeline: CONSOLE_PIPELINE_URL,
    });
    const text = formatRunStatus(status);
    for (const needle of [
      "Restate UI:        http://127.0.0.1:19070/ui",
      "ssh -N -L 19070:127.0.0.1:19070 miner@vm.example",
      "parcels_left",
      CONSOLE_PIPELINE_URL,
      "queued 100, running 6",
      "Parcels left: 106",
    ]) {
      expect(text).toContain(needle);
    }

    const down = await collectRunStatus({
      county: COUNTY,
      jobId: JOB,
      adminUrl: ADMIN,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      nowMs,
    });
    expect(down.errors[0]).toContain("ECONNREFUSED");
    // Without Restate the seed record still gives parcels left, and the links still print.
    expect(down.appraisal).toMatchObject({ parcelsLeft: 1, parcelsLeftSource: "seed rows - ready - dead" });
    expect(formatRunStatus(down)).toContain("Restate UI:        http://127.0.0.1:9070/ui");
  });
});

describe("flow control: policy math", () => {
  it("names scopes and caps reversibly and guards the cap ceiling", () => {
    expect(appraisalScope("palm-beach")).toBe("palm-beach-appraisal");
    expect(permitScope("palm-beach", "accela")).toBe("palm-beach-permits-accela");
    expect(permitScope("palm-beach", null)).toBe("palm-beach-permits-unrouted");
    expect(parcelIdempotencyKey("cobb", "full-20261126", "19003800050")).toBe("cobb-full-20261126-19003800050");
    expect(parcelIdempotencyKey("cobb", "full-20261126", "a/b")).toMatch(/^cobb-full-20261126-a_b-[0-9a-f]{12}$/);
    const env = { SCOPE_CAP_QPUBLIC: "12", SCOPE_CAP_PALM_BEACH_APPRAISAL: "6", OTHER: "1" };
    expect(configuredScopeCaps(env)).toEqual([
      { scope: "palm-beach-appraisal", cap: 6 },
      { scope: "qpublic", cap: 12 },
    ]);
    expect(scopeCap("qpublic", 6, env)).toBe(12);
    expect(scopeCap("unknown", 6, env)).toBe(6);
    expect(() => configuredScopeCaps({ SCOPE_CAP_QPUBLIC: "lots" })).toThrow(/positive integer/);
    expect(() => checkCap(19)).toThrow(/above 18/);
    expect(() => checkCap(19, true)).not.toThrow();
    expect(parseLevels(undefined)).toEqual([6, 12, 18]);
    expect(() => parseLevels("6,12,24")).toThrow(/above 18/);
    expect(() => parseLevels("12,6")).toThrow(/increasing/);
  });

  it("judges samples by the measured thresholds", () => {
    const base = { completed: 1300, receipts: 1300, nonCaptured: 4, multiAttempt: 4, challenges: 0, backingOff: 0, paused: 0 };
    expect(judgeSample(base).verdict).toBe("clean");
    expect(judgeSample({ ...base, nonCaptured: 13 })).toMatchObject({ verdict: "unclean", nonCapturedPct: 1 });
    expect(judgeSample({ ...base, multiAttempt: 65 }).verdict).toBe("unclean");
    expect(judgeSample({ ...base, challenges: 1 }).verdict).toBe("unclean");
    expect(judgeSample({ ...base, paused: 1 }).verdict).toBe("unclean");
    // No receipts: dead markers are non-captured, backing-off invocations multi-attempt.
    expect(judgeSample({ ...base, receipts: 0, nonCaptured: 2, backingOff: 70 }).verdict).toBe("unclean");
    expect(judgeSample({ ...base, receipts: 0, nonCaptured: 2, backingOff: 10 }).verdict).toBe("clean");
    expect(judgeSample({ ...base, completed: 0, receipts: 0 }).verdict).toBe("idle");
  });

  it("ramps 6 -> 12 -> 18 on two clean samples, steps down and holds on degradation", () => {
    let state = { cap: 6, cleanStreak: 0, hold: false };
    const trace: Array<string | null> = [];
    for (const verdict of ["clean", "idle", "clean", "clean", "clean", "clean", "clean"] as const) {
      const next = rampStep(state, verdict);
      trace.push(next.action);
      state = { cap: next.cap, cleanStreak: next.cleanStreak, hold: next.hold };
    }
    expect(trace).toEqual([null, null, "raise 6->12", null, "raise 12->18", null, null]);
    expect(state.cap).toBe(18);
    const down = rampStep(state, "unclean");
    expect(down).toMatchObject({ cap: 12, hold: true, action: "step-down 18->12, hold" });
    const held = rampStep(rampStep(down, "clean"), "clean");
    expect(held.cap).toBe(12);
    expect(rampStep({ cap: 6, cleanStreak: 0, hold: false }, "unclean")).toMatchObject({ cap: 6, action: "degraded at 6, hold" });
    expect(rampStep({ cap: 9, cleanStreak: 0, hold: false }, "unclean").cap).toBe(6);
  });

  it("computes rate and ETA", () => {
    expect(rateAndEta({ completedInWindow: 1300, windowMinutes: 3, left: 26_000, nowMs: 0 })).toEqual({
      perHour: 26_000,
      etaHours: 1,
      etaAt: "1970-01-01T01:00:00.000Z",
    });
    expect(rateAndEta({ completedInWindow: 0, windowMinutes: 15, left: 10 })).toEqual({ perHour: 0, etaHours: null, etaAt: null });
    expect(rateAndEta({ completedInWindow: 5, windowMinutes: 15, left: 0 })).toMatchObject({ etaHours: 0 });
  });

  it("reads Restate durations and permit terminality", () => {
    expect(parseDurationMs("14d")).toBe(14 * 86_400_000);
    expect(parseDurationMs("1day 12h")).toBe(36 * 3_600_000);
    expect(parseDurationMs("PT24H")).toBe(86_400_000);
    expect(parseDurationMs("P14D")).toBe(14 * 86_400_000);
    expect(parseDurationMs(null)).toBeNull();
    expect(parseDurationMs("soon")).toBeNull();
    expect(permitStatusIsTerminal(null)).toBe(false);
    expect(permitStatusIsTerminal({ harvestStatus: "done", transientFailures: 0 } as never)).toBe(true);
    expect(permitStatusIsTerminal({ harvestStatus: "failed", transientFailures: 2 } as never)).toBe(false);
  });

  it("builds the hand-off links from the admin URL", () => {
    expect(handoffLinks({ adminUrl: "http://localhost:9070", scope: "qpublic", sshUser: "u", sshHost: "h" })).toMatchObject({
      restateUi: "http://127.0.0.1:9070/ui",
      sshTunnel: "ssh -N -L 9070:127.0.0.1:9070 u@h",
    });
  });
});
