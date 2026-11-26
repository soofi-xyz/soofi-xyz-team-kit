#!/usr/bin/env node
/**
 * Ramp a scope's cap on measured health (default levels 6 → 12 → 18).
 *
 *   npm run ramp -- --county <slug> --job <jobId> [--scope <scope>] [--levels 6,12,18] \
 *     [--interval 180] [--benchmarked] [--once] [--admin <url>]
 *
 * Every interval (3 min) it samples what finished since the last sample:
 * ready/dead markers, capture receipts when the county's plug-in writes them
 * (`capture-receipt.json`: outcome, attempts), and Parcel invocations in
 * backing-off or paused. Clean = non-captured < 1 %, multi-attempt < 5 %, no
 * challenge pages, nothing paused. Two clean samples raise the cap one level;
 * one unclean sample steps it down one level and holds there. Never above the
 * last level, and never above 18 without `--benchmarked`. Appends each sample
 * to `data/runs/<county>/<jobId>/ramp.jsonl` and exits when the queue drains.
 * Run it under systemd-run or tmux next to the services process.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  RestateAdmin,
  type RampState,
  appraisalScope,
  enqueueRecordPath,
  judgeSample,
  parcelsLeft,
  parseFlags,
  parseLevels,
  queueMeta,
  rampStep,
  sampleAppraisalFiles,
} from "../services/lib/flow-control.ts";
import { assertCounty, assertJobId, paths, readJsonIfExists } from "../services/lib/storage.ts";

const USAGE =
  "ramp-scope --county <slug> --job <jobId> [--scope <scope>] [--levels 6,12,18] [--interval <s>] [--benchmarked] [--once] [--admin <url>]";

async function main() {
  const flags = parseFlags(process.argv.slice(2), ["benchmarked", "once"]);
  if (!flags.county || !flags.job) throw new Error(USAGE);
  const county = flags.county;
  const jobId = flags.job;
  assertCounty(county);
  assertJobId(jobId);
  const record = await readJsonIfExists<{ scope?: string }>(enqueueRecordPath(county, jobId, "appraisal"));
  const scope = flags.scope ?? record?.scope ?? appraisalScope(county);
  const levels = parseLevels(flags.levels, flags.benchmarked === "true");
  const intervalMs = Math.max(30, Number(flags.interval ?? 180)) * 1000;
  const admin = new RestateAdmin(flags.admin || process.env.RESTATE_ADMIN_URL || "http://localhost:9070");
  const out = path.join(paths.run(county, jobId), "ramp.jsonl");
  await mkdir(path.dirname(out), { recursive: true });

  const rule = await admin.rule(scope);
  if (!rule || rule.concurrency === null) throw new Error(`no rule on scope ${scope}: run npm run enqueue first`);
  let state: RampState = { cap: rule.concurrency, cleanStreak: 0, hold: false };
  let since = Date.now() - intervalMs;
  let first = true;
  for (;;) {
    if (!first) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    first = false;
    const now = Date.now();
    const files = await sampleAppraisalFiles(county, jobId, since);
    since = now;
    const stuck: Record<string, number> = {};
    for (const row of await admin.query(
      "SELECT status, count(*) AS n FROM sys_invocation WHERE target_service_name = 'Parcel' AND status IN ('backing-off', 'paused') GROUP BY status",
    )) {
      stuck[String(row.status)] = Number(row.n ?? 0);
    }
    const [meta] = await queueMeta(admin, "Parcel", scope);
    const live = await admin.rule(scope);
    if (live?.concurrency && live.concurrency !== state.cap) {
      // Someone set the cap by hand: follow it and hold.
      state = { cap: live.concurrency, cleanStreak: 0, hold: true };
    }
    const verdict = judgeSample({
      completed: files.newReady + files.newDead,
      receipts: files.receipts,
      nonCaptured: files.receipts > 0 ? files.nonCaptured : files.newDead,
      multiAttempt: files.multiAttempt,
      challenges: files.challenges,
      backingOff: stuck["backing-off"] ?? 0,
      paused: stuck.paused ?? 0,
    });
    const next = rampStep(state, verdict.verdict, levels);
    if (next.cap !== state.cap) await admin.setRule(scope, next.cap, `Oracle appraisal cap (${scope}), ramp`);
    state = { cap: next.cap, cleanStreak: next.cleanStreak, hold: next.hold };
    const sample = {
      t: new Date(now).toISOString(),
      scope,
      cap: state.cap,
      queued: meta?.inbox ?? null,
      running: meta?.running ?? null,
      finished: meta?.finished ?? null,
      newReady: files.newReady,
      newDead: files.newDead,
      receipts: files.receipts,
      nonCaptured: files.nonCaptured,
      multiAttempt: files.multiAttempt,
      challenges: files.challenges,
      stuck,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      nonCapturedPct: verdict.nonCapturedPct,
      multiPct: verdict.multiPct,
      cleanStreak: state.cleanStreak,
      hold: state.hold,
      action: next.action,
    };
    const line = JSON.stringify(sample);
    await appendFile(out, `${line}\n`);
    process.stdout.write(`${line}\n`);
    if (flags.once === "true" || (meta && parcelsLeft(meta) === 0)) return;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: "oracle_ramp_failed", message: (error as Error).message })}\n`);
  process.exitCode = 1;
});
