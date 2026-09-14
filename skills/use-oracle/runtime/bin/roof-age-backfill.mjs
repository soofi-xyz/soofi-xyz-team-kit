#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRoofAgeBackfill } from "../src/roof-age/backfill.mjs";
import { createPostgresRoofAgeStore } from "../src/roof-age/postgres-store.mjs";
import { atomicWriteJson } from "../src/permits/storage.mjs";

function usage() {
  return [
    "Audit or backfill canonical roof age in the query database.",
    "Dry-run is the default; --apply is required for writes.",
    "",
    "roof-age-backfill --state FL --as-of-date YYYY-MM-DD --database-url-env DATABASE_URL",
    "  [--county Broward] [--source-system broward_appraiser]",
    "  [--limit 25] [--offset 0] [--coverage-state unknown]",
    "  [--coverage-caveats history_unknown,predecessor_gap]",
    "  [--report <checkpoint.json>] [--apply]",
  ].join("\n");
}

export function parseRoofAgeBackfillArguments(argv) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") {
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag ?? "argument"}`);
    }
    if (
      ![
        "--state",
        "--county",
        "--source-system",
        "--as-of-date",
        "--database-url-env",
        "--limit",
        "--offset",
        "--coverage-state",
        "--coverage-caveats",
        "--report",
      ].includes(flag)
    ) {
      throw new Error(`Unknown option ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  const required = ["--state", "--as-of-date", "--database-url-env"];
  if (required.some((flag) => !values.get(flag))) {
    throw new Error(usage());
  }
  return {
    apply,
    state: values.get("--state").toUpperCase(),
    county: values.get("--county") ?? null,
    sourceSystem: values.get("--source-system") ?? null,
    asOfDate: values.get("--as-of-date"),
    databaseUrlEnvironment: values.get("--database-url-env"),
    limit: Number(values.get("--limit") ?? "1000"),
    offset: Number(values.get("--offset") ?? "0"),
    reportPath: values.get("--report") ?? null,
    historicalCoverage: {
      state: values.get("--coverage-state") ?? "unknown",
      caveats: (values.get("--coverage-caveats") ?? "history_unknown")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
  };
}

async function main() {
  const options = parseRoofAgeBackfillArguments(process.argv.slice(2));
  const connectionString =
    process.env[options.databaseUrlEnvironment]?.trim() ?? "";
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      `Database URL environment variable ${options.databaseUrlEnvironment} is missing or is not PostgreSQL`,
    );
  }
  const imported = await import("pg");
  const Client = imported.default?.Client ?? imported.Client;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runRoofAgeBackfill({
      store: createPostgresRoofAgeStore(client),
      ...options,
    });
    if (options.reportPath) {
      await atomicWriteJson(options.reportPath, report);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "roof_age_backfill_failed",
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
