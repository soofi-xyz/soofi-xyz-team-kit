/**
 * Restate flow control (VQueues) for the Oracle fan-out: one invocation per
 * parcel, sent one-way through the scoped ingress
 * (`POST /restate/scope/<scope>/send/<Service>/<handler>`), queued by Restate
 * and capped per scope by the rule book (`PUT /limits/rules`).
 *
 * A scope names one source site, so every invocation that hits that site
 * draws from one concurrency budget. Scope names here are lowercase letters,
 * digits and `-` (Restate allows `[A-Za-z0-9_.-]{1,36}`), so a scope maps to
 * the env name `SCOPE_CAP_<SCOPE>` and back without loss.
 *
 * Measured on Cobb / qPublic (2026-11-26): about 8,900 parcels/h at cap 6,
 * 18,700/h at 12 and 26,300/h at 18, against 10.8–12.6k/h for the chunked
 * feeder at 18. Without the batch barrier each worker hits the site about 3x
 * as often, so ramp 6 → 12 → 18 on clean samples and never go above 18
 * without a measured benchmark.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { countyOnlyEnv, envPart } from "./config.ts";
import { paths, safeKeyPart } from "./storage.ts";

export const SCOPE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,34}[a-z0-9])?$/;
/** Starting cap for an appraisal scope without `SCOPE_CAP_<SCOPE>`. */
export const DEFAULT_SCOPE_CAP = 6;
/** Starting cap for a permit scope (the in-process permit gate default is 2). */
export const DEFAULT_PERMIT_SCOPE_CAP = 2;
/** Highest measured-safe cap; going above needs a benchmark (`--benchmarked`). */
export const MAX_UNBENCHMARKED_CAP = 18;
export const RAMP_LEVELS = Object.freeze([6, 12, 18]);
/** Idempotency retention for Parcel and PermitHarvest (default would be 24 h). */
export const IDEMPOTENCY_RETENTION = "14d";
export const IDEMPOTENCY_RETENTION_MS = 14 * 24 * 60 * 60_000;
export const FLOW_CONTROLLED_SERVICES = Object.freeze(["Parcel", "PermitHarvest"]);
export const CONSOLE_PIPELINE_URL =
  "https://soofi-safavi.account.prismteam.ai/console/app/?app=meet-backfill-progress&tab.data-mining-tabs=data-mining-pipeline-table#/data-mining";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function assertScope(scope: unknown): asserts scope is string {
  if (typeof scope !== "string" || !SCOPE_PATTERN.test(scope)) {
    throw new Error(`scope must match ${SCOPE_PATTERN} (lowercase letters, digits, '-', at most 36)`);
  }
}

function toScope(value: string): string {
  const scope = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36)
    .replace(/-$/, "");
  assertScope(scope);
  return scope;
}

/**
 * Scope of a county's appraisal source: `APPRAISAL_SCOPE_<COUNTY>`, else
 * `<county>-appraisal`. Give counties that share one site (several qPublic
 * counties, for example) the same scope so they share one cap.
 */
export function appraisalScope(county: string): string {
  const configured = countyOnlyEnv("APPRAISAL_SCOPE", county);
  if (configured) {
    assertScope(configured);
    return configured;
  }
  return toScope(`${county}-appraisal`);
}

/**
 * Scope of a permit source: `PERMIT_SCOPE_<COUNTY>_<ADAPTER>`, else
 * `<county>-permits-<adapter>` (`unrouted` when no adapter matches).
 */
export function permitScope(county: string, adapterKey: string | null | undefined): string {
  const adapter = adapterKey || "unrouted";
  const configured = countyOnlyEnv("PERMIT_SCOPE", `${county}-${adapter}`);
  if (configured) {
    assertScope(configured);
    return configured;
  }
  return toScope(`${county}-permits-${adapter}`);
}

export function scopeCapEnvName(scope: string): string {
  return `SCOPE_CAP_${envPart(scope)}`;
}

function parseCap(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

/** Starting cap for a scope: `SCOPE_CAP_<SCOPE>`, else the fallback. */
export function scopeCap(scope: string, fallback = DEFAULT_SCOPE_CAP, env = process.env): number {
  return parseCap(env[scopeCapEnvName(scope)]) ?? fallback;
}

/** Every `SCOPE_CAP_<SCOPE>` in the environment, as `{scope, cap}`. */
export function configuredScopeCaps(env: NodeJS.ProcessEnv = process.env): Array<{ scope: string; cap: number }> {
  const caps: Array<{ scope: string; cap: number }> = [];
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith("SCOPE_CAP_")) continue;
    const cap = parseCap(raw);
    const scope = name.slice("SCOPE_CAP_".length).toLowerCase().replace(/_/g, "-");
    if (cap === null || !SCOPE_PATTERN.test(scope)) {
      throw new Error(`${name} must name a scope [a-z0-9-] and hold a positive integer`);
    }
    caps.push({ scope, cap });
  }
  return caps.sort((left, right) => left.scope.localeCompare(right.scope));
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/** Restate's humantime durations (`14d`, `1day 2h`, `PT24H`) in ms; null when unreadable. */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (iso) {
    const [, d, h, m, sec] = iso;
    return Number(d ?? 0) * 86_400_000 + Number(h ?? 0) * 3_600_000 + Number(m ?? 0) * 60_000 + Number(sec ?? 0) * 1000;
  }
  let total = 0;
  let matched = false;
  for (const part of value.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const unit = DURATION_UNITS[part[2]!.toLowerCase()];
    if (unit === undefined) return null;
    total += Number(part[1]) * unit;
    matched = true;
  }
  return matched ? total : null;
}

/** Refuse a cap above the measured ceiling unless a benchmark backs it. */
export function checkCap(cap: number, benchmarked = false): void {
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`cap must be a positive integer, got ${cap}`);
  if (cap > MAX_UNBENCHMARKED_CAP && !benchmarked) {
    throw new Error(
      `cap ${cap} is above ${MAX_UNBENCHMARKED_CAP}: measure it first (source-access benchmark) and pass --benchmarked`,
    );
  }
}

/** Idempotency key of a parcel's appraisal invocation. */
export function parcelIdempotencyKey(county: string, jobId: string, parcelId: string): string {
  return `${county}-${jobId}-${safeKeyPart(parcelId)}`;
}

/** Idempotency key of a parcel's permit invocation. */
export function permitIdempotencyKey(county: string, jobId: string, parcelId: string): string {
  return `${county}-${jobId}-permits-${safeKeyPart(parcelId)}`;
}

export function scopedSendUrl(ingressUrl: string, scope: string, service: string, handler: string): string {
  assertScope(scope);
  return `${ingressUrl.replace(/\/$/, "")}/restate/scope/${scope}/send/${service}/${handler}`;
}

const TRANSIENT = new Set([408, 425, 429]);

/**
 * One-way scoped send with an idempotency key. Returns Restate's status
 * (`Accepted` for a new invocation, `PreviouslyAccepted` for a known key).
 * Retries only transient answers (408, 425, 429, 5xx, network errors).
 */
export async function sendScoped(
  url: string,
  key: string,
  body: unknown,
  options: { fetchImpl?: FetchLike; attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = options.attempts ?? 8;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    let transient: string;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) {
        const parsed = (text ? JSON.parse(text) : {}) as { status?: string };
        return parsed.status ?? "unknown";
      }
      if (!TRANSIENT.has(response.status) && response.status < 500) {
        throw Object.assign(new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`), { terminal: true });
      }
      transient = `HTTP ${response.status}`;
    } catch (error) {
      if ((error as { terminal?: boolean }).terminal) throw error;
      transient = (error as Error).message;
    }
    if (attempt >= attempts) throw new Error(`${transient} after ${attempt} attempts`);
    await sleep(Math.min(30_000, 500 * 2 ** attempt));
  }
}

/** Run `task` over `items` with at most `parallel` in flight. */
export async function forEachParallel<T>(
  items: readonly T[],
  parallel: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length || 1)) }, worker));
}

// ---------------------------------------------------------------- admin API

export type Row = Record<string, unknown>;

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class RestateAdmin {
  readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(adminUrl: string, fetchImpl: FetchLike = fetch) {
    this.url = adminUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  private async request(method: string, route: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.url}${route}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async query(sql: string): Promise<Row[]> {
    const result = (await this.request("POST", "/query", { query: sql })) as { rows?: Row[] } | null;
    return result?.rows ?? [];
  }

  async version(): Promise<{ version?: string; features?: Record<string, boolean> }> {
    return (await this.request("GET", "/version")) as { version?: string; features?: Record<string, boolean> };
  }

  /** `GET /limits/rules` answers 405; the rule book is read through SQL. */
  async rule(scope: string): Promise<{ pattern: string; concurrency: number | null; version: number | null; disabled: boolean } | null> {
    const rows = await this.query(
      `SELECT pattern, concurrency, disabled, version FROM sys_rules WHERE pattern = ${sqlString(scope)}`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      pattern: String(row.pattern),
      concurrency: row.concurrency === null || row.concurrency === undefined ? null : Number(row.concurrency),
      version: row.version === null || row.version === undefined ? null : Number(row.version),
      disabled: Boolean(row.disabled),
    };
  }

  /** Upsert one scope rule (other rules are untouched). */
  async setRule(scope: string, cap: number, description: string): Promise<unknown> {
    assertScope(scope);
    return this.request("PUT", "/limits/rules", [{ pattern: scope, limits: { concurrency: cap }, description }]);
  }

  async service(name: string): Promise<Row> {
    return (await this.request("GET", `/services/${encodeURIComponent(name)}`)) as Row;
  }

  async patchService(name: string, body: Row): Promise<Row> {
    return (await this.request("PATCH", `/services/${encodeURIComponent(name)}`, body)) as Row;
  }
}

/**
 * Make sure a scope has a rule before anything is sent to it: without one the
 * scope is unlimited. An existing rule is kept (the ramp may have raised it);
 * pass `force` to set `cap` anyway.
 */
export async function ensureScopeRule(
  admin: RestateAdmin,
  scope: string,
  cap: number,
  options: { force?: boolean; description?: string; benchmarked?: boolean } = {},
): Promise<{ scope: string; cap: number; action: "kept" | "created" | "set" }> {
  const current = await admin.rule(scope);
  if (current && !current.disabled && current.concurrency !== null && !options.force) {
    return { scope, cap: current.concurrency, action: "kept" };
  }
  checkCap(cap, options.benchmarked);
  await admin.setRule(scope, cap, options.description ?? `Oracle source cap (${scope})`);
  return { scope, cap, action: current ? "set" : "created" };
}

/** Fail unless the server runs with VQueues (flow control) on. */
export async function assertVqueues(admin: RestateAdmin): Promise<string> {
  const version = await admin.version();
  if (!version.features?.vqueues) {
    throw new Error(
      `Restate ${version.version ?? "?"} runs without VQueues: start it with RESTATE_EXPERIMENTAL_ENABLE_VQUEUES=true (bootstrap-oracle-infra), or use CountyIngest chunk mode`,
    );
  }
  return version.version ?? "unknown";
}

export type QueueMeta = {
  scope: string;
  service: string;
  inbox: number;
  running: number;
  suspended: number;
  paused: number;
  finished: number;
};

/** `sys_vqueue_meta` per scope for one service (all scopes when none given). */
export async function queueMeta(admin: RestateAdmin, service: string, scope?: string): Promise<QueueMeta[]> {
  const where = [`service_name = ${sqlString(service)}`];
  if (scope) where.push(`scope = ${sqlString(scope)}`);
  const rows = await admin.query(
    `SELECT scope, num_inbox, num_running, num_suspended, num_paused, num_finished FROM sys_vqueue_meta WHERE ${where.join(" AND ")}`,
  );
  const byScope = new Map<string, QueueMeta>();
  for (const row of rows) {
    const key = String(row.scope ?? "");
    const meta = byScope.get(key) ?? { scope: key, service, inbox: 0, running: 0, suspended: 0, paused: 0, finished: 0 };
    meta.inbox += Number(row.num_inbox ?? 0);
    meta.running += Number(row.num_running ?? 0);
    meta.suspended += Number(row.num_suspended ?? 0);
    meta.paused += Number(row.num_paused ?? 0);
    meta.finished += Number(row.num_finished ?? 0);
    byScope.set(key, meta);
  }
  return [...byScope.values()].sort((left, right) => left.scope.localeCompare(right.scope));
}

/** Work not yet finished in a queue (inbox + running + suspended + paused). */
export function parcelsLeft(meta: Pick<QueueMeta, "inbox" | "running" | "suspended" | "paused">): number {
  return meta.inbox + meta.running + meta.suspended + meta.paused;
}

export function parcelsLeftSql(service: string, scope: string): string {
  return (
    "SELECT num_inbox AS queued, num_running AS running, num_suspended AS suspended, " +
    "num_paused AS paused, num_finished AS done, " +
    "num_inbox + num_running + num_suspended + num_paused AS parcels_left " +
    `FROM sys_vqueue_meta WHERE service_name = '${service}' AND scope = '${scope}';`
  );
}

// ---------------------------------------------------------------- run record

export function enqueueRecordPath(county: string, jobId: string, pass: "appraisal" | "permits"): string {
  return path.join(paths.run(county, jobId), pass === "appraisal" ? "enqueue.json" : "enqueue-permits.json");
}

// ---------------------------------------------------------------- hand-off

export function adminPort(adminUrl: string): number {
  try {
    const parsed = new URL(adminUrl);
    return parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 9070;
  }
}

/**
 * What every status report and hand-off gives the person: the Restate UI,
 * the tunnel to open it from another machine, the parcels-left query and the
 * Console Pipeline tab.
 */
export function handoffLinks(options: {
  adminUrl: string;
  service?: string;
  scope: string;
  sshUser?: string;
  sshHost?: string;
}) {
  const port = adminPort(options.adminUrl);
  const user = options.sshUser || process.env.ORACLE_SSH_USER || os.userInfo().username;
  const host = options.sshHost || process.env.ORACLE_SSH_HOST || os.hostname();
  return {
    restateUi: `http://127.0.0.1:${port}/ui`,
    sshTunnel: `ssh -N -L ${port}:127.0.0.1:${port} ${user}@${host}`,
    parcelsLeftSql: parcelsLeftSql(options.service ?? "Parcel", options.scope),
    consolePipeline: CONSOLE_PIPELINE_URL,
  };
}

// ---------------------------------------------------------------- file counts

export type FileSample = {
  dirs: number;
  ready: number;
  dead: number;
  newReady: number;
  newDead: number;
  receipts: number;
  nonCaptured: number;
  multiAttempt: number;
  challenges: number;
};

async function mtimeMs(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Count terminal markers under a job's appraisal directory, and what changed
 * since `sinceMs`. A capture plug-in that writes `capture-receipt.json`
 * (`outcome`, `attempts[]`) also feeds the ramp's health signals.
 */
export async function sampleAppraisalFiles(county: string, jobId: string, sinceMs: number): Promise<FileSample> {
  const jobDir = paths.appraisalJob(county, jobId);
  const sample: FileSample = {
    dirs: 0,
    ready: 0,
    dead: 0,
    newReady: 0,
    newDead: 0,
    receipts: 0,
    nonCaptured: 0,
    multiAttempt: 0,
    challenges: 0,
  };
  let entries: string[];
  try {
    entries = await readdir(jobDir);
  } catch {
    return sample;
  }
  const batch = 256;
  for (let start = 0; start < entries.length; start += batch) {
    await Promise.all(
      entries.slice(start, start + batch).map(async (name) => {
        const dir = path.join(jobDir, name);
        const [ready, dead, receipt] = await Promise.all([
          mtimeMs(path.join(dir, "ready.json")),
          mtimeMs(path.join(dir, "dead.json")),
          mtimeMs(path.join(dir, "capture-receipt.json")),
        ]);
        sample.dirs += 1;
        if (ready !== null) {
          sample.ready += 1;
          if (ready > sinceMs) sample.newReady += 1;
        }
        if (dead !== null) {
          sample.dead += 1;
          if (dead > sinceMs) sample.newDead += 1;
        }
        if (receipt !== null && receipt > sinceMs) {
          try {
            const parsed = JSON.parse(await readFile(path.join(dir, "capture-receipt.json"), "utf8")) as {
              outcome?: string;
              attempts?: unknown[];
            };
            sample.receipts += 1;
            if (parsed.outcome !== "captured") sample.nonCaptured += 1;
            if (parsed.outcome === "challenge") sample.challenges += 1;
            if (Array.isArray(parsed.attempts) && parsed.attempts.length > 1) sample.multiAttempt += 1;
          } catch {
            // a receipt being rewritten; the next sample sees it
          }
        }
      }),
    );
  }
  return sample;
}

// ---------------------------------------------------------------- status math

/** Completions per hour over a window, and the ETA for what is left. */
export function rateAndEta(options: { completedInWindow: number; windowMinutes: number; left: number; nowMs?: number }) {
  const { completedInWindow, windowMinutes, left } = options;
  const perHour = windowMinutes > 0 ? (completedInWindow * 60) / windowMinutes : 0;
  if (left <= 0) return { perHour: Math.round(perHour), etaHours: 0, etaAt: null as string | null };
  if (perHour <= 0) return { perHour: 0, etaHours: null as number | null, etaAt: null as string | null };
  const etaHours = left / perHour;
  const nowMs = options.nowMs ?? Date.now();
  return {
    perHour: Math.round(perHour),
    etaHours: Math.round(etaHours * 10) / 10,
    etaAt: new Date(nowMs + etaHours * 3_600_000).toISOString(),
  };
}

// ---------------------------------------------------------------- ramp policy

export type HealthSample = {
  /** Parcels that reached ready or dead during the sample. */
  completed: number;
  /** Receipts written during the sample (0 when the county writes none). */
  receipts: number;
  nonCaptured: number;
  multiAttempt: number;
  challenges: number;
  /** Parcel invocations in backing-off or paused right now. */
  backingOff: number;
  paused: number;
};

export type Verdict = { verdict: "clean" | "unclean" | "idle"; reasons: string[]; nonCapturedPct: number | null; multiPct: number | null };

/**
 * A sample is clean when non-captured < 1 %, multi-attempt < 5 % and there
 * are no challenge pages and no paused invocations. Receipts are used when
 * the capture plug-in writes them; otherwise dead markers count as
 * non-captured and backing-off invocations as multi-attempt.
 */
export function judgeSample(sample: HealthSample): Verdict {
  const base = sample.receipts > 0 ? sample.receipts : sample.completed;
  if (base === 0) {
    const reasons = sample.paused > 0 ? [`${sample.paused} paused`] : ["no completions"];
    return { verdict: sample.paused > 0 ? "unclean" : "idle", reasons, nonCapturedPct: null, multiPct: null };
  }
  const nonCaptured = sample.nonCaptured;
  const multi = sample.receipts > 0 ? sample.multiAttempt : sample.backingOff;
  const nonCapturedPct = (100 * nonCaptured) / base;
  const multiPct = (100 * multi) / base;
  const reasons: string[] = [];
  if (nonCapturedPct >= 1) reasons.push(`non-captured ${nonCapturedPct.toFixed(2)}% >= 1%`);
  if (multiPct >= 5) reasons.push(`multi-attempt ${multiPct.toFixed(2)}% >= 5%`);
  if (sample.challenges > 0) reasons.push(`${sample.challenges} challenge page(s)`);
  if (sample.paused > 0) reasons.push(`${sample.paused} paused`);
  return {
    verdict: reasons.length ? "unclean" : "clean",
    reasons,
    nonCapturedPct: Math.round(nonCapturedPct * 100) / 100,
    multiPct: Math.round(multiPct * 100) / 100,
  };
}

export type RampState = { cap: number; cleanStreak: number; hold: boolean };

/**
 * Two consecutive clean samples at a level raise the cap one level; an
 * unclean sample steps it down one level and holds (no more raises). An idle
 * sample changes nothing. Never goes above the last level.
 */
export function rampStep(
  state: RampState,
  verdict: Verdict["verdict"],
  levels: readonly number[] = RAMP_LEVELS,
  cleanNeeded = 2,
): RampState & { action: string | null } {
  const index = levels.indexOf(state.cap);
  if (verdict === "unclean") {
    const lower = levels.filter((level) => level < state.cap).at(-1) ?? state.cap;
    return {
      cap: lower,
      cleanStreak: 0,
      hold: true,
      action: lower !== state.cap ? `step-down ${state.cap}->${lower}, hold` : `degraded at ${state.cap}, hold`,
    };
  }
  if (verdict === "idle") return { ...state, action: null };
  const cleanStreak = state.cleanStreak + 1;
  if (!state.hold && cleanStreak >= cleanNeeded && index >= 0 && index < levels.length - 1) {
    const next = levels[index + 1]!;
    return { cap: next, cleanStreak: 0, hold: false, action: `raise ${state.cap}->${next}` };
  }
  return { ...state, cleanStreak, action: null };
}

export function parseLevels(value: string | undefined, benchmarked = false): number[] {
  if (!value) return [...RAMP_LEVELS];
  const levels = value.split(",").map((part) => Number(part.trim()));
  for (const level of levels) checkCap(level, benchmarked);
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index]! <= levels[index - 1]!) throw new Error("--levels must be increasing");
  }
  return levels;
}

/** `--flag value` pairs and bare `--switch` flags. */
export function parseFlags(argv: string[], switches: readonly string[] = []): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) throw new Error(`bad argument: ${flag}`);
    const name = flag.slice(2);
    if (switches.includes(name)) {
      options[name] = "true";
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    options[name] = value;
    index += 1;
  }
  return options;
}
