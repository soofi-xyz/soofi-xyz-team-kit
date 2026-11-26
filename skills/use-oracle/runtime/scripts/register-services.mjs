#!/usr/bin/env node
/**
 * Register the services process (services/app.ts) with Restate through the
 * admin API, then confirm every Oracle service is visible. Equivalent to
 * `restate deployments register <url>` without needing the restate CLI.
 *
 *   node scripts/register-services.mjs [--admin http://localhost:9070]
 *     [--uri http://host.docker.internal:9080] [--force]
 *
 * Use `http://host.docker.internal:9080` when Restate runs in Docker (compose
 * adds the host-gateway entry), or `http://localhost:9080` when Restate runs
 * on the host or with host networking.
 *
 * Then, for the enqueue path (VQueues flow control):
 * - checks that Parcel and PermitHarvest keep idempotency keys for 14 days
 *   (set in their service options; re-discovery overwrites admin-set values,
 *   so this PATCHes only a deployment that still carries the old default);
 * - creates a rule for every `SCOPE_CAP_<SCOPE>` in the environment whose
 *   scope has no rule yet. An existing rule is never changed here, so a
 *   re-register during a run does not undo the ramp (`npm run scope-cap`).
 */
import {
  FLOW_CONTROLLED_SERVICES,
  IDEMPOTENCY_RETENTION,
  IDEMPOTENCY_RETENTION_MS,
  RestateAdmin,
  configuredScopeCaps,
  ensureScopeRule,
  parseDurationMs,
} from "../services/lib/flow-control.ts";

export const ORACLE_SERVICES = Object.freeze([
  "CountyIngest",
  "IngestChunk",
  "Parcel",
  "CountyLedger",
  "PermitFeed",
  "PermitHarvest",
  "PublishGroup",
]);

function parse(argv, env) {
  const options = {
    admin: env.RESTATE_ADMIN_URL || "http://localhost:9070",
    uri: env.SERVICES_URL || "http://host.docker.internal:9080",
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--force") options.force = true;
    else if (flag === "--admin") options.admin = argv[++index];
    else if (flag === "--uri") options.uri = argv[++index];
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2), process.env);
  const admin = options.admin.replace(/\/$/, "");
  const response = await fetch(`${admin}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: options.uri, force: options.force }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`register failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  const listed = await (await fetch(`${admin}/services`)).json();
  const names = new Set((listed.services ?? []).map((service) => service.name));
  const missing = ORACLE_SERVICES.filter((name) => !names.has(name));
  process.stdout.write(
    `${JSON.stringify({
      event: "oracle_services_registered",
      uri: options.uri,
      deployment: JSON.parse(text).id ?? null,
      services: ORACLE_SERVICES.filter((name) => names.has(name)),
      missing,
    })}\n`,
  );
  if (missing.length) process.exitCode = 1;

  const restate = new RestateAdmin(admin);
  const retention = [];
  for (const name of FLOW_CONTROLLED_SERVICES.filter((service) => names.has(service))) {
    let current = (await restate.service(name)).idempotency_retention ?? null;
    let action = "kept";
    if ((parseDurationMs(current) ?? 0) < IDEMPOTENCY_RETENTION_MS) {
      await restate.patchService(name, { idempotency_retention: IDEMPOTENCY_RETENTION });
      current = (await restate.service(name)).idempotency_retention ?? null;
      action = "patched";
    }
    retention.push({ service: name, idempotency_retention: current, action });
  }
  const version = await restate.version();
  const rules = [];
  if (version.features?.vqueues) {
    for (const { scope, cap } of configuredScopeCaps(process.env)) {
      rules.push(await ensureScopeRule(restate, scope, cap, { description: `Oracle source cap (${scope})` }));
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "oracle_flow_control",
      restate: version.version ?? null,
      vqueues: Boolean(version.features?.vqueues),
      retention,
      rules,
      ...(version.features?.vqueues ? {} : { note: "VQueues off: enqueue path unavailable, CountyIngest chunk mode only" }),
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: "oracle_services_register_failed", message: error.message })}\n`);
  process.exitCode = 1;
});
