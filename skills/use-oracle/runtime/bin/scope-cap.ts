#!/usr/bin/env node
/**
 * Read or set a scope's concurrency cap (Restate rule book).
 *
 *   npm run scope-cap -- --scope <scope>                 # rule + live usage
 *   npm run scope-cap -- --scope <scope> --cap 12        # upsert the rule
 *   npm run scope-cap -- --scope <scope> --cap 24 --benchmarked
 *
 * `GET /limits/rules` answers 405, so the rule is read from `sys_rules` and
 * usage from `sys_user_limits`. A cap above 18 needs a measured benchmark.
 */
import { RestateAdmin, assertScope, checkCap, parseFlags, sqlString } from "../services/lib/flow-control.ts";

try {
  const flags = parseFlags(process.argv.slice(2), ["benchmarked"]);
  assertScope(flags.scope);
  const admin = new RestateAdmin(flags.admin || process.env.RESTATE_ADMIN_URL || "http://localhost:9070");
  let action: string | null = null;
  if (flags.cap !== undefined) {
    const cap = Number(flags.cap);
    checkCap(cap, flags.benchmarked === "true");
    await admin.setRule(flags.scope, cap, flags.description || `Oracle source cap (${flags.scope})`);
    action = `set ${cap}`;
  }
  const rule = await admin.rule(flags.scope);
  const usage = await admin.query(
    `SELECT scope, usage, concurrency_limit, available, num_waiters FROM sys_user_limits WHERE scope = ${sqlString(flags.scope)} AND level = 'Scope'`,
  );
  process.stdout.write(`${JSON.stringify({ event: "oracle_scope_cap", scope: flags.scope, action, rule, usage: usage[0] ?? null })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: "oracle_scope_cap_failed", message: (error as Error).message })}\n`);
  process.exitCode = 1;
}
