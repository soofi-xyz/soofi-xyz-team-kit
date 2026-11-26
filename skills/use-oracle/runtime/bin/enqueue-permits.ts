#!/usr/bin/env node
/**
 * Permit pass on the enqueue path: one scoped `PermitHarvest.harvestParcel`
 * per eligible ready parcel, scope per permit source (vendor adapter). Refuses
 * to start while the county's appraisal queue still has work (`--force`
 * overrides). See services/lib/enqueue.ts.
 *
 *   npm run enqueue:permits -- --county <slug> --job <jobId> [--cap <n>] [--benchmarked] \
 *     [--appraisal-scope <scope>] [--force] [--parallel 16] [--ingress <url>] [--admin <url>]
 *
 * Creates each permit scope rule at `SCOPE_CAP_<SCOPE>` (default 2) when none
 * exists. Parcels with a terminal permit status are skipped.
 */
import { enqueuePermits } from "../services/lib/enqueue.ts";
import { parseFlags } from "../services/lib/flow-control.ts";

const USAGE =
  "enqueue-permits --county <slug> --job <jobId> [--cap <n>] [--benchmarked] [--appraisal-scope <scope>] [--force] [--parallel <n>] [--ingress <url>] [--admin <url>]";

try {
  const flags = parseFlags(process.argv.slice(2), ["benchmarked", "force"]);
  if (!flags.county || !flags.job) throw new Error(USAGE);
  const summary = await enqueuePermits({
    county: flags.county,
    jobId: flags.job,
    cap: flags.cap === undefined ? undefined : Number(flags.cap),
    benchmarked: flags.benchmarked === "true",
    force: flags.force === "true",
    appraisalScope: flags["appraisal-scope"],
    parallel: flags.parallel === undefined ? undefined : Number(flags.parallel),
    ingressUrl: flags.ingress || process.env.RESTATE_INGRESS_URL || "http://localhost:8080",
    adminUrl: flags.admin || process.env.RESTATE_ADMIN_URL || "http://localhost:9070",
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  for (const warning of summary.warnings) process.stderr.write(`warning: ${warning}\n`);
  if (summary.failures) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: "oracle_enqueue_permits_failed", message: (error as Error).message })}\n`);
  process.exitCode = 1;
}
