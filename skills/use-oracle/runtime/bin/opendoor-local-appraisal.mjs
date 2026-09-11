#!/usr/bin/env node
// @ts-check

import {
  buildLocalRequest,
  runLocalIngest,
} from "../src/local/opendoor-local.mjs";

/**
 * @param {readonly string[]} argv
 * @returns {Record<string, string>}
 */
function parseFlags(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value, received ${flag ?? "end"}`);
    }
    flags[flag.slice(2)] = value;
  }
  return flags;
}

/**
 * @param {Record<string, string>} flags
 * @param {string} name
 */
function required(flags, name) {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!["plan", "run"].includes(command ?? "")) {
    throw new Error(
      "Usage: opendoor-local-appraisal <plan|run> --county lake|clay|volusia --seed file --run-id id --mode smoke|full [--output directory] [--chromium executable] [--headless true|false] [--user-data-dir directory]",
    );
  }
  const flags = parseFlags(argv);
  const common = {
    county: required(flags, "county"),
    seedPath: required(flags, "seed"),
    runId: required(flags, "run-id"),
    mode: required(flags, "mode"),
    headless: flags.headless === undefined ? true : flags.headless !== "false",
    userDataDir: flags["user-data-dir"],
  };
  if (command === "plan") {
    const plan = await buildLocalRequest(common);
    process.stdout.write(
      `${JSON.stringify(
        {
          event: "opendoor_local_plan",
          requestSha256: plan.requestSha256,
          request: plan.request,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const handoff = await runLocalIngest({
    ...common,
    outputDir: required(flags, "output"),
    chromiumPath: flags.chromium,
  });
  process.stdout.write(
    `${JSON.stringify({ event: "opendoor_local_handoff", handoff }, null, 2)}\n`,
  );
  if (handoff.failedRows > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
