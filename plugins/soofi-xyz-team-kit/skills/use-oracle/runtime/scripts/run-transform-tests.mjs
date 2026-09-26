#!/usr/bin/env node
/**
 * Runs every vendored county transform test under Node's built-in test
 * runner, matching `counties/<name>/transforms/<file>.test.js` for every
 * county directory.
 *
 * These files are copied verbatim from the canonical
 * `Counties-trasform-scripts` repo as provenance for the mapping/extractor
 * scripts they cover (see the Task 3 report) and use `node:test`, not
 * Vitest, so they can't live under the `tests` directory (Vitest's own
 * `include` pattern in `vitest.config.mjs` only covers `.test.mjs` files
 * there) without renaming or moving the vendored files, which the brief
 * forbids.
 *
 * Resolves the glob from this script's own location via `import.meta.url`,
 * never `process.cwd()` (Global Constraint), and is deliberately a no-op
 * (exit 0) when no county ships any transform test at all — e.g. Pinellas,
 * which currently has none — rather than relying on shell glob expansion.
 * A raw npm script string like `node --test counties/x/transforms/x.test.js`
 * (with a literal `*` wildcard) is shell-dependent: zsh errors on an
 * unmatched glob by default, while sh/bash instead pass the literal
 * unexpanded pattern through to `node --test`, which also fails (`node
 * --test` treats a path argument as a file to load directly; it does not
 * recursively search an arbitrary directory the way it does when invoked
 * with no path arguments at all). Using `node:fs`'s `globSync` here makes
 * the behavior identical, and safely empty-tolerant, regardless of the
 * invoking shell.
 *
 * @module scripts/run-transform-tests
 */

import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNTIME_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TRANSFORM_TEST_GLOB = "counties" + "/*/transforms/" + "*.test.js";

const files = globSync(TRANSFORM_TEST_GLOB, { cwd: RUNTIME_ROOT }).sort();

if (files.length === 0) {
  console.log(`run-transform-tests: no files matched ${TRANSFORM_TEST_GLOB}; nothing to run.`);
  process.exit(0);
}

console.log(`run-transform-tests: running ${files.length} vendored transform test file(s) with node --test`);
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: RUNTIME_ROOT,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
