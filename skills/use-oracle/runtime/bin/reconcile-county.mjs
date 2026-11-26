#!/usr/bin/env node
/**
 * Reconcile one county run from the CountyLedger (Restate) plus the artifact
 * files, check every completion gate, and write
 * `data/runs/<county>/<jobId>/manifest.json`.
 *
 *   node bin/reconcile-county.mjs --county <slug> --job <jobId>
 *     [--restate http://localhost:9070] [--ingress http://localhost:8080]
 *     [--seed <DATA_DIR-relative csv>] [--strict] [--assemble <group>] [--no-rehash]
 *
 * Without --seed the seed path comes from the CountyIngest state of
 * `<county>-<jobId>` (admin SQL, then the ingress status handler), falling
 * back to seeds/<county>.csv.
 *
 * The ledger is read through the Restate admin SQL query API (`--restate`),
 * falling back to `CountyLedger/<county>-<jobId>/summary` + `list` through the
 * ingress (`--ingress`, default RESTATE_INGRESS_URL or :8080). `--strict`
 * exits non-zero when a gate fails; `--assemble <group>` stages
 * `data/groups/<county>/<jobId>/<group>/` from verified ready parcels only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLedger, readEnqueueSeedPath, readIngestSeedPath, reconcileCounty } from "../services/lib/reconcile.ts";
import { assertCounty, assertJobId, assertPublishableGroup } from "../services/lib/storage.ts";

const USAGE =
  "reconcile-county --county <slug> --job <jobId> [--restate <admin-url>] [--ingress <ingress-url>] [--seed <DATA_DIR-relative csv>] [--strict] [--assemble <group>] [--no-rehash]";

export function parseReconcileArguments(argv, env = process.env) {
  const options = {
    county: null,
    jobId: null,
    adminUrl: env.RESTATE_ADMIN_URL || "http://localhost:9070",
    ingressUrl: env.RESTATE_INGRESS_URL || "http://localhost:8080",
    seedPath: undefined,
    strict: false,
    assemble: null,
    rehash: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const takeValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${USAGE}`);
      index += 1;
      return value;
    };
    if (flag === "--county") options.county = takeValue();
    else if (flag === "--job") options.jobId = takeValue();
    else if (flag === "--restate") options.adminUrl = takeValue();
    else if (flag === "--ingress") options.ingressUrl = takeValue();
    else if (flag === "--seed") options.seedPath = takeValue();
    else if (flag === "--assemble") options.assemble = takeValue();
    else if (flag === "--strict") options.strict = true;
    else if (flag === "--no-rehash") options.rehash = false;
    else if (flag === "--help" || flag === "-h") throw new Error(USAGE);
    else throw new Error(`Unknown option ${flag}\n${USAGE}`);
  }
  if (!options.county || !options.jobId) throw new Error(USAGE);
  assertCounty(options.county);
  assertJobId(options.jobId);
  if (options.assemble) assertPublishableGroup(options.assemble);
  return options;
}

async function main() {
  const options = parseReconcileArguments(process.argv.slice(2));
  const ledger = await loadLedger({
    adminUrl: options.adminUrl,
    ingressUrl: options.ingressUrl,
    key: `${options.county}-${options.jobId}`,
  });
  // Without --seed, use the seed the run itself was started with: the
  // CountyIngest state (chunk mode), else the enqueue record (enqueue path).
  const fromRun = options.seedPath
    ? null
    : ((await readIngestSeedPath({
        adminUrl: options.adminUrl,
        ingressUrl: options.ingressUrl,
        key: `${options.county}-${options.jobId}`,
      })) ?? (await readEnqueueSeedPath(options.county, options.jobId)));
  const { manifest, manifestPath, exitCode } = await reconcileCounty({
    county: options.county,
    jobId: options.jobId,
    ledger,
    seedPath: options.seedPath ?? fromRun?.path,
    seedSource: options.seedPath ? "argument" : (fromRun?.source ?? "default"),
    strict: options.strict,
    assemble: options.assemble,
    rehash: options.rehash,
  });
  process.stdout.write(
    `${JSON.stringify({
      event: "reconcile_county",
      county: manifest.county,
      jobId: manifest.jobId,
      ledgerSource: manifest.ledger.source,
      seed: { path: manifest.seed.path, source: manifest.seed.source, rows: manifest.seed.rows },
      counts: manifest.counts,
      gates: manifest.gates,
      failedGates: manifest.failedGates,
      assembly: manifest.groups.assembly,
      manifest: manifestPath,
    })}\n`,
  );
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "reconcile_county_failed", message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  });
}
