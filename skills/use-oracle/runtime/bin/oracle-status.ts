#!/usr/bin/env node
/**
 * Status of a county run on the enqueue path (see services/lib/run-status.ts).
 *
 *   npm run status -- --county <slug> --job <jobId> [--scope <scope>] [--minutes 15] [--json] \
 *     [--admin http://localhost:9070] [--ssh-user <user>] [--ssh-host <host>]
 *
 * Prints the queue per scope (sys_vqueue_meta), caps in use, file counts,
 * the rate over the last N minutes, the ETA, and the hand-off links: Restate
 * UI, the SSH tunnel to open it from another machine, the parcels-left query
 * and the Console Pipeline tab.
 */
import { parseFlags } from "../services/lib/flow-control.ts";
import { collectRunStatus, formatRunStatus } from "../services/lib/run-status.ts";

const USAGE =
  "oracle-status --county <slug> --job <jobId> [--scope <scope>] [--minutes <n>] [--json] [--admin <url>] [--ssh-user <user>] [--ssh-host <host>]";

try {
  const flags = parseFlags(process.argv.slice(2), ["json"]);
  if (!flags.county || !flags.job) throw new Error(USAGE);
  const status = await collectRunStatus({
    county: flags.county,
    jobId: flags.job,
    scope: flags.scope,
    minutes: flags.minutes === undefined ? undefined : Number(flags.minutes),
    adminUrl: flags.admin || process.env.RESTATE_ADMIN_URL || "http://localhost:9070",
    sshUser: flags["ssh-user"],
    sshHost: flags["ssh-host"],
  });
  process.stdout.write(flags.json === "true" ? `${JSON.stringify(status)}\n` : `${formatRunStatus(status)}\n`);
  if (status.errors.length) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: "oracle_run_status_failed", message: (error as Error).message })}\n`);
  process.exitCode = 1;
}
