/**
 * Enqueue path (the default full-run fan-out): one scoped, idempotent,
 * one-way invocation per parcel. Restate's VQueues hold the backlog and the
 * scope rule caps how many run at once, so there is no feeder workflow and
 * no batch barrier.
 *
 * Appraisal: `Parcel.process` per seed row, scope = the county's appraisal
 * source, key `<county>-<jobId>-<parcel_id>`. Parcels whose directory already
 * has `ready.json` or `dead.json` are skipped, so a re-run after the 14-day
 * idempotency retention still never repeats finished work.
 *
 * Permits: `PermitHarvest.harvestParcel` per eligible ready parcel, scope =
 * the parcel's permit source (vendor adapter), key
 * `<county>-<jobId>-permits-<parcel_id>`, started once the appraisal queue
 * has drained.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { countyEnv, envPart } from "./config.ts";
import {
  DEFAULT_PERMIT_SCOPE_CAP,
  type FetchLike,
  RestateAdmin,
  appraisalScope,
  assertScope,
  assertVqueues,
  enqueueRecordPath,
  ensureScopeRule,
  forEachParallel,
  parcelIdempotencyKey,
  parcelsLeft,
  permitIdempotencyKey,
  permitScope,
  queueMeta,
  scopeCap,
  scopedSendUrl,
  sendScoped,
} from "./flow-control.ts";
import { type Eligibility, FILES } from "./parcel-steps.ts";
import {
  type PermitParcelStatus,
  buildEligibleIndex,
  permitProfileFor,
  resolvePermitRoute,
} from "./permit-steps.ts";
import { readSeedRange, scanSeed, type SeedRow } from "./seed.ts";
import {
  assertCounty,
  assertJobId,
  atomicWriteJson,
  dataPath,
  paths,
  readJsonIfExists,
  resolveUnderData,
} from "./storage.ts";

/** Terminal markers: a parcel with either one is finished and is not enqueued again. */
export const TERMINAL_MARKERS = [FILES.ready, FILES.dead] as const;

export function terminalMarker(county: string, jobId: string, parcelId: string): string | null {
  const dir = paths.parcelDir(county, jobId, parcelId);
  for (const marker of TERMINAL_MARKERS) {
    if (existsSync(path.join(dir, marker))) return marker;
  }
  return null;
}

/** Seed row → Parcel.process payload; canonical fields cannot be overridden by CSV columns. */
export function parcelPayload(row: SeedRow, county: string, jobId: string) {
  const { parcel_id, source_identifier, situs_address, ...rest } = row;
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "string" && key !== "county" && key !== "jobId") extra[key] = value;
  }
  return { county, jobId, parcel_id, source_identifier, situs_address, extra };
}

/** The in-process capture cap (`CONCURRENCY_PREPARE_<COUNTY>`, else `CONCURRENCY_PREPARE`, else 4). */
export function inProcessPrepareCap(county: string): number {
  const value = Number(countyEnv("CONCURRENCY_PREPARE", county));
  return Number.isInteger(value) && value >= 1 ? value : 4;
}

/** The in-process permit gate for an adapter (`CONCURRENCY_PERMIT_<ADAPTER>`, else 2). */
export function inProcessPermitCap(adapter: string): number {
  const value = Number(process.env[`CONCURRENCY_PERMIT_${envPart(adapter)}`]);
  return Number.isInteger(value) && value >= 1 ? value : 2;
}

type Common = {
  county: string;
  jobId: string;
  ingressUrl: string;
  adminUrl: string;
  parallel?: number;
  /** Set the scope cap to this value even when a rule exists. */
  cap?: number;
  benchmarked?: boolean;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  now?: () => Date;
};

export type EnqueueParcelsOptions = Common & {
  /** DATA_DIR-relative seed CSV. */
  seed: string;
  scope?: string;
};

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function writeRecord(file: string, summary: Record<string, unknown>, now: Date) {
  const previous = await readJsonIfExists<{ firstRunAt?: string }>(file);
  await atomicWriteJson(file, { ...summary, firstRunAt: previous?.firstRunAt ?? now.toISOString(), lastRunAt: now.toISOString() });
}

export async function enqueueParcels(options: EnqueueParcelsOptions) {
  const { county, jobId } = options;
  assertCounty(county);
  assertJobId(jobId);
  if (!options.seed) throw new Error("--seed is required (DATA_DIR-relative, e.g. seeds/<county>.csv)");
  const scope = options.scope ?? appraisalScope(county);
  assertScope(scope);
  const parallel = Math.max(1, Math.min(256, Math.trunc(options.parallel ?? 16) || 16));
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const started = Date.now();

  const admin = new RestateAdmin(options.adminUrl, fetchImpl);
  const restateVersion = await assertVqueues(admin);
  const rule = await ensureScopeRule(admin, scope, options.cap ?? scopeCap(scope), {
    force: options.cap !== undefined,
    benchmarked: options.benchmarked,
    description: `Oracle appraisal cap (${scope})`,
  });

  const seedPath = resolveUnderData(options.seed);
  const index = await scanSeed(seedPath, 10_000);
  const url = scopedSendUrl(options.ingressUrl, scope, "Parcel", "process");
  const counts: Record<string, number> = {};
  const skippedBy: Record<string, number> = {};
  const failures: string[] = [];
  let sent = 0;
  let seen = 0;
  let invalid = 0;

  for (const chunk of index.chunks) {
    const rows = await readSeedRange(seedPath, index.headerText, chunk.start, chunk.end);
    await forEachParallel(rows, parallel, async (row) => {
      seen += 1;
      if (typeof row.parcel_id !== "string" || !row.parcel_id.trim()) {
        invalid += 1;
        return;
      }
      const marker = terminalMarker(county, jobId, row.parcel_id);
      if (marker) {
        bump(skippedBy, marker);
        return;
      }
      try {
        const status = await sendScoped(url, parcelIdempotencyKey(county, jobId, row.parcel_id), parcelPayload(row, county, jobId), {
          fetchImpl,
        });
        bump(counts, status);
      } catch (error) {
        failures.push(`${row.parcel_id}: ${(error as Error).message}`);
      }
      sent += 1;
    });
    log(`seen ${seen}/${index.rows} sent ${sent} skipped ${seen - sent - invalid}`);
  }

  const warnings: string[] = [];
  const prepareCap = inProcessPrepareCap(county);
  if (prepareCap <= rule.cap) {
    warnings.push(
      `in-process capture cap ${prepareCap} is not above the scope cap ${rule.cap}: set CONCURRENCY_PREPARE_${envPart(county)} above the top ramp level (e.g. 24) and restart the services process so Restate's cap binds`,
    );
  }
  const summary = {
    event: "oracle_enqueue_parcels",
    county,
    jobId,
    service: "Parcel",
    scope,
    rule,
    restateVersion,
    seed: options.seed,
    seedSha256: index.sha256,
    seedRows: index.rows,
    sent,
    skipped: Object.values(skippedBy).reduce((sum, count) => sum + count, 0),
    skippedBy,
    invalid,
    counts,
    failures: failures.length,
    failureSample: failures.slice(0, 20),
    warnings,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  await writeRecord(enqueueRecordPath(county, jobId, "appraisal"), summary, now());
  return summary;
}

export type EnqueuePermitsOptions = Common & {
  /** Start even though the appraisal queue still has work. */
  force?: boolean;
  /** Appraisal scope to wait on (defaults to the county's). */
  appraisalScope?: string;
};

/** A permit status is terminal unless it recorded transient failures (those are retried). */
export function permitStatusIsTerminal(status: PermitParcelStatus | null): boolean {
  return Boolean(status) && (status!.transientFailures ?? 0) === 0;
}

export async function enqueuePermits(options: EnqueuePermitsOptions) {
  const { county, jobId } = options;
  assertCounty(county);
  assertJobId(jobId);
  const parallel = Math.max(1, Math.min(256, Math.trunc(options.parallel ?? 16) || 16));
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const started = Date.now();

  const admin = new RestateAdmin(options.adminUrl, fetchImpl);
  const restateVersion = await assertVqueues(admin);
  const waitScope = options.appraisalScope ?? appraisalScope(county);
  const [appraisal] = await queueMeta(admin, "Parcel", waitScope);
  const appraisalLeft = appraisal ? parcelsLeft(appraisal) : 0;
  if (appraisalLeft > 0 && !options.force) {
    throw new Error(
      `appraisal queue ${waitScope} still has ${appraisalLeft} parcel(s); start permits after it drains (or pass --force)`,
    );
  }
  const profile = permitProfileFor(county);
  if (!profile) throw new Error(`no permit profile for ${county} (county-permit-adapter)`);

  const index = await buildEligibleIndex(county, jobId, "enqueue", 10_000);
  const byScope = new Map<string, { adapter: string; parcelIds: string[] }>();
  const skippedBy: Record<string, number> = {};
  const routeFailures: string[] = [];
  for (const chunk of index.chunks) {
    const parcelIds = JSON.parse(await readFile(dataPath(chunk.path), "utf8")) as string[];
    await forEachParallel(parcelIds, parallel, async (parcelId) => {
      const status = await readJsonIfExists<PermitParcelStatus>(paths.permitStatus(county, jobId, parcelId));
      if (permitStatusIsTerminal(status)) {
        bump(skippedBy, `status:${status!.harvestStatus}`);
        return;
      }
      try {
        const eligibility = await readJsonIfExists<Eligibility>(
          path.join(paths.parcelDir(county, jobId, parcelId), FILES.eligibility),
        );
        if (!eligibility) throw new Error("eligibility.json disappeared");
        const route = await resolvePermitRoute(county, profile, eligibility, parcelId);
        const scope = permitScope(county, route.adapterKey);
        const entry = byScope.get(scope) ?? { adapter: route.adapterKey ?? "unrouted", parcelIds: [] };
        entry.parcelIds.push(parcelId);
        byScope.set(scope, entry);
      } catch (error) {
        routeFailures.push(`${parcelId}: ${(error as Error).message}`);
      }
    });
  }

  const rules = [];
  const warnings: string[] = [];
  for (const [scope, entry] of [...byScope.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const rule = await ensureScopeRule(admin, scope, options.cap ?? scopeCap(scope, DEFAULT_PERMIT_SCOPE_CAP), {
      force: options.cap !== undefined,
      benchmarked: options.benchmarked,
      description: `Oracle permit cap (${scope})`,
    });
    rules.push(rule);
    const gateCap = inProcessPermitCap(entry.adapter);
    if (gateCap < rule.cap) {
      warnings.push(
        `in-process permit gate ${gateCap} is below the scope cap ${rule.cap} for ${scope}: set CONCURRENCY_PERMIT_${envPart(entry.adapter)} to at least ${rule.cap} and restart the services process`,
      );
    }
  }

  const counts: Record<string, number> = {};
  const failures: string[] = [];
  const perScope: Record<string, number> = {};
  let sent = 0;
  for (const [scope, { parcelIds }] of byScope) {
    const url = scopedSendUrl(options.ingressUrl, scope, "PermitHarvest", "harvestParcel");
    await forEachParallel(parcelIds, parallel, async (parcelId) => {
      try {
        const status = await sendScoped(url, permitIdempotencyKey(county, jobId, parcelId), { county, jobId, parcel_id: parcelId }, { fetchImpl });
        bump(counts, status);
      } catch (error) {
        failures.push(`${parcelId}: ${(error as Error).message}`);
      }
      sent += 1;
    });
    perScope[scope] = parcelIds.length;
    log(`scope ${scope}: sent ${parcelIds.length}`);
  }

  const summary = {
    event: "oracle_enqueue_permits",
    county,
    jobId,
    service: "PermitHarvest",
    appraisalScope: waitScope,
    appraisalLeft,
    restateVersion,
    eligible: index.eligible,
    scanned: index.scanned,
    malformedEligibility: index.malformed.length,
    scopes: perScope,
    rules,
    sent,
    skipped: Object.values(skippedBy).reduce((sum, count) => sum + count, 0),
    skippedBy,
    routeFailures: routeFailures.length,
    counts,
    failures: failures.length + routeFailures.length,
    failureSample: [...routeFailures, ...failures].slice(0, 20),
    warnings,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  await writeRecord(enqueueRecordPath(county, jobId, "permits"), summary, now());
  return summary;
}
