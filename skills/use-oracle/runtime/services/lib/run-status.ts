/**
 * `npm run status`: one report of a county run on the enqueue path — the
 * Restate queue per scope, file counts, rate over the last N minutes, ETA and
 * the links every hand-off gives the person (Restate UI, SSH tunnel,
 * parcels-left query, Console Pipeline tab).
 */
import {
  type FetchLike,
  type QueueMeta,
  RestateAdmin,
  appraisalScope,
  enqueueRecordPath,
  handoffLinks,
  parcelsLeft,
  queueMeta,
  rateAndEta,
  sampleAppraisalFiles,
  sqlString,
} from "./flow-control.ts";
import { assertCounty, assertJobId, readJsonIfExists } from "./storage.ts";

type EnqueueRecord = { scope?: string; seed?: string; seedRows?: number; lastRunAt?: string; sent?: number; skipped?: number };
type PermitRecord = { scopes?: Record<string, number>; lastRunAt?: string; eligible?: number };

export type RunStatus = Awaited<ReturnType<typeof collectRunStatus>>;

export async function collectRunStatus(options: {
  county: string;
  jobId: string;
  adminUrl: string;
  scope?: string;
  minutes?: number;
  fetchImpl?: FetchLike;
  nowMs?: number;
  sshUser?: string;
  sshHost?: string;
}) {
  assertCounty(options.county);
  assertJobId(options.jobId);
  const { county, jobId } = options;
  const minutes = options.minutes && options.minutes > 0 ? options.minutes : 15;
  const nowMs = options.nowMs ?? Date.now();
  const record = await readJsonIfExists<EnqueueRecord>(enqueueRecordPath(county, jobId, "appraisal"));
  const permitRecord = await readJsonIfExists<PermitRecord>(enqueueRecordPath(county, jobId, "permits"));
  const scope = options.scope ?? record?.scope ?? appraisalScope(county);
  const admin = new RestateAdmin(options.adminUrl, options.fetchImpl);

  const errors: string[] = [];
  let restateVersion: string | null = null;
  let vqueues: boolean | null = null;
  let appraisal: QueueMeta | null = null;
  let permits: QueueMeta[] = [];
  let limits: Array<Record<string, unknown>> = [];
  let stuck: Record<string, number> = {};
  try {
    const version = await admin.version();
    restateVersion = version.version ?? null;
    vqueues = Boolean(version.features?.vqueues);
    appraisal = (await queueMeta(admin, "Parcel", scope))[0] ?? null;
    const permitScopes = Object.keys(permitRecord?.scopes ?? {});
    permits = permitScopes.length
      ? (await queueMeta(admin, "PermitHarvest")).filter((meta) => permitScopes.includes(meta.scope))
      : [];
    const scopes = [scope, ...permitScopes].map(sqlString).join(", ");
    limits = await admin.query(
      `SELECT scope, usage, concurrency_limit, available, num_waiters FROM sys_user_limits WHERE level = 'Scope' AND scope IN (${scopes})`,
    );
    for (const row of await admin.query(
      "SELECT target_service_name AS service, status, count(*) AS n FROM sys_invocation " +
        "WHERE target_service_name IN ('Parcel', 'PermitHarvest') AND status IN ('backing-off', 'paused') " +
        "GROUP BY target_service_name, status",
    )) {
      stuck[`${row.service}:${row.status}`] = Number(row.n ?? 0);
    }
  } catch (error) {
    errors.push(`restate: ${(error as Error).message}`);
  }

  const files = await sampleAppraisalFiles(county, jobId, nowMs - minutes * 60_000);
  const seedRows = record?.seedRows ?? null;
  const left = appraisal
    ? parcelsLeft(appraisal)
    : seedRows !== null
      ? Math.max(0, seedRows - files.ready - files.dead)
      : null;
  const completedInWindow = files.newReady + files.newDead;
  const rate = rateAndEta({ completedInWindow, windowMinutes: minutes, left: left ?? 0, nowMs });
  return {
    event: "oracle_run_status",
    at: new Date(nowMs).toISOString(),
    county,
    jobId,
    restate: { version: restateVersion, vqueues },
    appraisal: {
      scope,
      queue: appraisal && {
        queued: appraisal.inbox,
        running: appraisal.running,
        suspended: appraisal.suspended,
        paused: appraisal.paused,
        finished: appraisal.finished,
      },
      parcelsLeft: left,
      parcelsLeftSource: appraisal ? "sys_vqueue_meta" : seedRows !== null ? "seed rows - ready - dead" : null,
      enqueued: record ? { lastRunAt: record.lastRunAt ?? null, sent: record.sent ?? null, skipped: record.skipped ?? null } : null,
    },
    permits: permits.map((meta) => ({
      scope: meta.scope,
      queued: meta.inbox,
      running: meta.running,
      suspended: meta.suspended,
      paused: meta.paused,
      finished: meta.finished,
      left: parcelsLeft(meta),
    })),
    caps: limits,
    stuck,
    files: { seedRows, parcelDirs: files.dirs, ready: files.ready, dead: files.dead },
    window: { minutes, ready: files.newReady, dead: files.newDead },
    rate: { parcelsPerHour: rate.perHour, etaHours: rate.etaHours, etaAt: rate.etaAt },
    links: handoffLinks({ adminUrl: options.adminUrl, scope, sshUser: options.sshUser, sshHost: options.sshHost }),
    errors,
  };
}

function n(value: number | null | undefined): string {
  return value === null || value === undefined ? "?" : value.toLocaleString("en-US");
}

/** The status as text for the person; every line of the hand-off block is always printed. */
export function formatRunStatus(status: RunStatus): string {
  const lines: string[] = [];
  const q = status.appraisal.queue;
  lines.push(`Oracle run ${status.county} / ${status.jobId} at ${status.at}`);
  lines.push(
    `Restate ${status.restate.version ?? "unreachable"}${status.restate.vqueues === false ? " (VQueues OFF: chunk mode only)" : ""}`,
  );
  lines.push(
    q
      ? `Appraisal queue (Parcel, scope ${status.appraisal.scope}): queued ${n(q.queued)}, running ${n(q.running)}, suspended ${n(q.suspended)}, paused ${n(q.paused)}, finished ${n(q.finished)}`
      : `Appraisal queue (Parcel, scope ${status.appraisal.scope}): no queue in Restate`,
  );
  for (const permit of status.permits) {
    lines.push(
      `Permit queue (PermitHarvest, scope ${permit.scope}): queued ${n(permit.queued)}, running ${n(permit.running)}, paused ${n(permit.paused)}, finished ${n(permit.finished)}`,
    );
  }
  for (const cap of status.caps) {
    lines.push(`Cap ${cap.scope}: ${cap.usage}/${cap.concurrency_limit} in use, ${cap.num_waiters} waiting`);
  }
  const stuck = Object.entries(status.stuck).filter(([, count]) => count > 0);
  if (stuck.length) lines.push(`Stuck: ${stuck.map(([key, count]) => `${key} ${count}`).join(", ")}`);
  lines.push(
    `Files: seed rows ${n(status.files.seedRows)}, ready ${n(status.files.ready)}, dead ${n(status.files.dead)}, parcel dirs ${n(status.files.parcelDirs)}`,
  );
  lines.push(
    `Last ${status.window.minutes} min: ${n(status.window.ready)} ready + ${n(status.window.dead)} dead = ${n(status.rate.parcelsPerHour)}/h`,
  );
  lines.push(
    `Parcels left: ${n(status.appraisal.parcelsLeft)}${status.appraisal.parcelsLeftSource ? ` (${status.appraisal.parcelsLeftSource})` : ""}; ETA ${
      status.rate.etaHours === null ? "unknown (no completions in the window)" : `${status.rate.etaHours} h${status.rate.etaAt ? ` (${status.rate.etaAt})` : ""}`
    }`,
  );
  lines.push("");
  lines.push(`Restate UI:        ${status.links.restateUi}`);
  lines.push(`From your machine: ${status.links.sshTunnel}   then open ${status.links.restateUi}`);
  lines.push(`Parcels left SQL:  ${status.links.parcelsLeftSql}`);
  lines.push(`Console Pipeline:  ${status.links.consolePipeline}  (shared view, refreshed hourly)`);
  for (const error of status.errors) lines.push(`error: ${error}`);
  return lines.join("\n");
}
