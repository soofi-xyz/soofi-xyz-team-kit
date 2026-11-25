#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRoofAgeBackfill } from "../src/roof-age/backfill.mjs";
import { createJsonlRoofAgeStore } from "../src/roof-age/jsonl-store.mjs";
import { atomicWriteJson } from "../src/permits/storage.mjs";

function usage() {
  return [
    "Audit or backfill canonical roof age over roof-age record files.",
    "Reads one record per line from --input (JSONL) and, with --apply, writes",
    "the reconciled records to a NEW --output JSONL file. Dry-run is the default.",
    "",
    "roof-age-backfill --state FL --as-of-date YYYY-MM-DD --input <records.jsonl>",
    "  [--output <records.roof-age.jsonl>] [--county Broward]",
    "  [--source-system broward_appraiser] [--limit 25] [--offset 0]",
    "  [--coverage-state unknown] [--coverage-caveats history_unknown,predecessor_gap]",
    "  [--report <checkpoint.json>] [--apply]",
  ].join("\n");
}

const VALUE_FLAGS = Object.freeze([
  "--state",
  "--county",
  "--source-system",
  "--as-of-date",
  "--input",
  "--output",
  "--limit",
  "--offset",
  "--coverage-state",
  "--coverage-caveats",
  "--report",
]);

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
    if (!VALUE_FLAGS.includes(flag)) {
      throw new Error(`Unknown option ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  const required = ["--state", "--as-of-date", "--input"];
  if (required.some((flag) => !values.get(flag))) {
    throw new Error(usage());
  }
  if (apply && !values.get("--output")) {
    throw new Error("--apply requires --output <new JSONL file>");
  }
  const inputPath = values.get("--input");
  return {
    apply,
    state: values.get("--state").toUpperCase(),
    county: values.get("--county") ?? null,
    sourceSystem: values.get("--source-system") ?? null,
    asOfDate: values.get("--as-of-date"),
    inputPath,
    outputPath:
      values.get("--output") ??
      inputPath.replace(/(\.jsonl)?$/, ".roof-age-dry-run.jsonl"),
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
  const report = await runRoofAgeBackfill({
    store: createJsonlRoofAgeStore({
      inputPath: options.inputPath,
      outputPath: options.outputPath,
    }),
    ...options,
  });
  const output = {
    ...report,
    input: options.inputPath,
    output: options.apply ? options.outputPath : null,
  };
  if (options.reportPath) {
    await atomicWriteJson(options.reportPath, output);
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
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
