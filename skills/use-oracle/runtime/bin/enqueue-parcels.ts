#!/usr/bin/env node
/**
 * Default full-run fan-out: one scoped `Parcel.process` per seed row, queued
 * and capped by Restate (VQueues). See services/lib/enqueue.ts.
 *
 *   npm run enqueue -- --county <slug> --job full-<YYYYMMDD> --seed seeds/<county>.csv \
 *     [--scope <scope>] [--cap <n>] [--benchmarked] [--parallel 16] \
 *     [--ingress http://localhost:8080] [--admin http://localhost:9070]
 *
 * Creates the scope rule at `SCOPE_CAP_<SCOPE>` (default 6) when none exists
 * and keeps an existing one (the ramp may have raised it); `--cap` sets it.
 * Safe to re-run: finished parcels are skipped, known keys answer
 * `PreviouslyAccepted`. Prints one JSON summary line; exit 1 on send failures.
 */
import { enqueueParcels } from "../services/lib/enqueue.ts";
import { parseFlags } from "../services/lib/flow-control.ts";

const USAGE =
  "enqueue-parcels --county <slug> --job <jobId> --seed <DATA_DIR-relative csv> [--scope <scope>] [--cap <n>] [--benchmarked] [--parallel <n>] [--ingress <url>] [--admin <url>]";

try {
  const flags = parseFlags(process.argv.slice(2), ["benchmarked"]);
  if (!flags.county || !flags.job || !flags.seed) throw new Error(USAGE);
  const summary = await enqueueParcels({
    county: flags.county,
    jobId: flags.job,
    seed: flags.seed,
    scope: flags.scope,
    cap: flags.cap === undefined ? undefined : Number(flags.cap),
    benchmarked: flags.benchmarked === "true",
    parallel: flags.parallel === undefined ? undefined : Number(flags.parallel),
    ingressUrl: flags.ingress || process.env.RESTATE_INGRESS_URL || "http://localhost:8080",
    adminUrl: flags.admin || process.env.RESTATE_ADMIN_URL || "http://localhost:9070",
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  for (const warning of summary.warnings) process.stderr.write(`warning: ${warning}\n`);
  if (summary.failures) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: "oracle_enqueue_parcels_failed", message: (error as Error).message })}\n`);
  process.exitCode = 1;
}
