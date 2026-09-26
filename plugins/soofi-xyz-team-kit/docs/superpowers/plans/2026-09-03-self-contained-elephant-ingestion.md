# Self-contained Elephant ingestion implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.
> Every task uses test-first changes, ends in a commit, and requires an
> independent review before the next task.

**Goal:** A fresh `soofi-xyz-team-kit` checkout contains every Elephant
county-ingestion skill plus an executable, tested local ingestion path that
does not clone `oracle-node`, `elephant-xyz/skills`,
`Counties-trasform-scripts`, or `elephant-query-db`.

**Architecture:** `skills/use-oracle/runtime/` is the single cross-platform
runtime package because Cursor and Copilot ship the repository while Codex
ships the declared `skills/` tree. Pinellas supplies the complete local
seed/capture/transform/export/Filebase-dry-run vertical slice; Duval supplies
the second county adapter and stronger reconciliation. Git stores code, small
fixtures, and the catalog of Filebase URLs; generated county artifacts remain
under ignored runtime directories.

**Tech stack:** Node.js 22.18+, npm lockfile, Vitest, Cheerio,
`@dsnp/parquetjs`, AdmZip, Filebase S3/IPFS/IPNS, shell and Python plugin
validation.

## Global constraints

- All work stays on `feature/add-elephant-runtime-wrappers`, the branch for
  PR #140, rebased on `origin/main` at `f3dd728`.
- This is one PR. Do not create another branch or PR.
- Runtime source lives under `skills/use-oracle/runtime/`; do not add a
  top-level runtime or a duplicate under `plugins/`.
- `plugins/soofi-xyz-team-kit/skills` remains the existing symlink to
  canonical `skills/`.
- Never commit `.env*`, credentials, `node_modules/`, `downloads/`, generated
  Parquet/ZIP/HTML captures, or source-repository Git history.
- Filebase/IPFS/IPNS remains the publication store. Git contains only code,
  deterministic test fixtures, and URL metadata.
- Live portal fetch and live Filebase publication require explicit flags.
  CI is offline and credential-free.
- Live Filebase publication is human-approval-gated and is not executed while
  implementing this PR.
- Bundle all 19 ingestion-stage/monitoring skills. Do not run
  `npx skills add elephant-xyz/skills`.
- Preserve source provenance:
  `oracle-node@ff68b0b6812598d07e0f4aaa322ddbfe230f20b9`,
  `Counties-trasform-scripts@39300ce69bcd8920176cb3cf902b49725ad09e38`,
  `elephant-query-db@083414442c57061b5e07359a9ebda30d14d7bc14`,
  and `elephant-mcp@a736c9fc510d32c50ec3419a609fc03421d8fc06`.
- Catalog baseline includes Broward from `oracle-node/main`, promotes verified
  Seminole (FIPS `12117`), excludes reverted Pasco, and keeps Santa Clara as
  the only map overlay until coverage exists.
- The pre-IPNS catalog URL is exactly
  `https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/main/skills/use-oracle/runtime/catalog/published-counties.json`.
- Agent edits must be regenerated with both agent sync scripts.
- Every `skills/*/SKILL.md` has matching kebab-case `name`, nonempty
  `description`, and no more than 500 lines.
- Do not claim a gate passes without a fresh command and successful output.

---

### Task 1: Vendor and normalize the Elephant skills

**Files**

- Create: `skills/{bbb-harvest,bootstrap-oracle-infra,county-appraisal-onboarding,county-discovery,county-ingest-run,county-open-data-publish,county-permit-adapter,county-query-table-publish,county-seed-data,deploy-open-data-mcp,durable-workflow-builder,monitoring-county-ingestion,onboard-county,overture-places-ingest,query-db-loading-matching,sunbiz-corporate-ingest,transform-v2-builder,validate-county-transform}/`
- Create: `skills/monitoring-oracle-ingestion/`
- Create: `skills/durable-workflow-builder/reference/pattern-library.md`
- Modify: `skills/use-oracle/SKILL.md`
- Modify: `skills/use-oracle/reference/{durable-orchestration,readiness-and-completeness}.md`
- Modify: `skills/county-readiness-preflight/SKILL.md`
- Modify: `agents/oracle.md`
- Modify: `README.md`
- Refresh: `skills/use-elephant-query-db/reference/query-db-schema/schema/{appraisal,index,sunbiz}.ts`
- Create: `skills/use-elephant-query-db/reference/query-db-schema/schema/places.ts`
- Create: `skills/use-oracle/reference/source-provenance.md`
- Regenerate: `agents-copilot/oracle.agent.md`, `.codex/agents/oracle.toml`

**Interfaces**

- Canonical skill lookup: `skills/<skill-name>/SKILL.md`.
- Runtime-specific monitoring route:
  `monitoring-county-ingestion` for local execution and
  `monitoring-oracle-ingestion` for legacy AWS execution.
- All ingestion commands referenced by bundled skills resolve beneath
  `skills/use-oracle/runtime/`; external source checkout installation is
  forbidden.

- [ ] Copy the 18 canonical stage skill trees from
  `oracle-node/agent/skills/` and the monitoring skill tree from
  `oracle-node/.agents/skills/monitoring-oracle-ingestion/`. Include the four
  monitoring scripts and two Overture assets: exactly 25 source files before
  normalization.
- [ ] Add matching `name:` frontmatter to the 18 stage skills.
- [ ] Move `durable-workflow-builder`'s pattern library into its reference
  file so `SKILL.md` is at most 500 lines and links to that reference.
- [ ] Rewrite skill-install and sibling-repository instructions to use
  bundled `skills/` and `skills/use-oracle/runtime/`.
- [ ] Route Oracle monitoring by runtime and remove
  `npx skills add elephant-xyz/skills`.
- [ ] Refresh the four query-db schema files from the pinned source.
- [ ] Document source SHAs and retained author metadata.
- [ ] Add the 19 skills to the README and regenerate agent mirrors.
- [ ] Run:

  ```bash
  scripts/sync-copilot-agents.sh sync
  scripts/sync-codex-agents.sh sync
  scripts/validate-plugin.sh
  ```

  Expected: 36 agents synced, readiness self-test passed, plugin content
  valid, and 71 total skills.
- [ ] Commit as `feat: bundle Elephant ingestion skills`.

---

### Task 2: Build the packaged Pinellas replay runtime

**Files**

- Create: `skills/use-oracle/runtime/package.json`
- Create: `skills/use-oracle/runtime/package-lock.json`
- Create: `skills/use-oracle/runtime/.gitignore`
- Create: `skills/use-oracle/runtime/bin/elephant-county.mjs`
- Create: `skills/use-oracle/runtime/src/core/{csv,run-state,transform-runner,query-table,filebase,replay}.mjs`
- Create: `skills/use-oracle/runtime/src/counties/pinellas/{adapter,seed,query-table}.mjs`
- Create: `skills/use-oracle/runtime/counties/pinellas/transforms/*.js`
- Create: `skills/use-oracle/runtime/counties/pinellas/flow.json`
- Create: `skills/use-oracle/runtime/fixtures/pinellas-replay/{seed.csv,gis-feature.json,expected-row.json}`
- Create: `skills/use-oracle/runtime/fixtures/pinellas-replay/html/162805389030000430.html`
- Create: `skills/use-oracle/runtime/tests/{seed,ingest,query-table,filebase,replay-pipeline}.test.mjs`
- Create: `.gitignore`

**Interfaces**

```text
elephant-county ingest --county <key> --seed <csv> --html-dir <dir>
  --skip-validate --output <run-dir>
elephant-county export --county <key> --seed <csv> --run <run-dir>
  --output <publish-dir>
elephant-county publish --county <key> --input <publish-dir> --dry-run
elephant-county replay --county <key> --fixture <dir> --output <dir>
```

```javascript
buildSeed(adapter, options)
captureAndTransform(adapter, options)
validateRun(adapter, manifest)
buildPublicationArtifacts(adapter, run)
publishFilebase(artifacts, config)
```

- Live fetch is rejected unless `--live-fetch` is explicit.
- Live publish is rejected unless an approval manifest is supplied.
- Dry-run never contacts Filebase and reports the intended bucket/IPNS labels.

- [ ] Write CLI parsing tests that reject implicit network and publication.
- [ ] Port only reusable Pinellas CSV, seed, transform-isolation, row-mapping,
  coverage, ZIP-reading, and credential-presence tests.
- [ ] Copy the five production Pinellas transform scripts and flow definition;
  exclude backups and `node_modules`.
- [ ] Author a deterministic one-parcel replay fixture for STRAP
  `162805389030000430` using the production selector contract.
- [ ] Implement core modules and the Pinellas adapter until focused unit tests
  pass.
- [ ] Implement the replay test to invoke the public CLI and assert:
  transformed ZIP magic, required JSON artifacts, one Parquet row, matching
  one-row coverage, Pinellas source identity, and a credential-free Filebase
  dry-run.
- [ ] Install and test:

  ```bash
  npm ci --prefix skills/use-oracle/runtime
  npm test --prefix skills/use-oracle/runtime
  ```

  Expected: all runtime unit and one-parcel replay tests pass with no portal
  or Filebase network requests.
- [ ] Commit as `feat: add packaged Pinellas ingestion runtime`.

---

### Task 3: Add the Duval adapter and reconciliation

**Files**

- Create: `skills/use-oracle/runtime/src/counties/duval/{adapter,seed,validate,query-table}.mjs`
- Create: `skills/use-oracle/runtime/counties/duval/transforms/*.js`
- Create: `skills/use-oracle/runtime/counties/duval/static-parts.csv`
- Create: `skills/use-oracle/runtime/tests/{duval-seed,duval-ingest,duval-validate,duval-query-table}.test.mjs`
- Modify: `skills/use-oracle/runtime/bin/elephant-county.mjs`
- Modify: `skills/use-oracle/runtime/package.json`

**Interfaces**

- The Task 2 CLI accepts `--county duval`.
- Duval full-seed construction may declare `duckdb` and `unzip` requirements,
  but fixture/replay tests do not download extensions or invoke portals.
- Manifest reconciliation requires:
  `seed = success + permanent_failure + retryable_failure`, unique parcel IDs,
  and query-table row count equal to successful complete parcels.

- [ ] Port the Duval lib, pilot, validation, and query-table behaviors into
  adapter modules with explicit paths rather than `process.cwd()` or sibling
  checkout assumptions.
- [ ] Copy the five tracked Duval transform scripts, their three focused
  transform tests, package metadata as provenance only where needed, and
  static-parts CSV.
- [ ] Port the seed normalization, failure classification, retry ledger,
  transformed county, query-table uniqueness, and reconciliation tests.
- [ ] Add a small synthetic Duval adapter fixture or unit-level artifacts; do
  not commit the 404k-row seed, downloads, real HTML, or Parquet shards.
- [ ] Run:

  ```bash
  npm test --prefix skills/use-oracle/runtime
  ```

  Expected: Pinellas replay remains green and all Duval adapter/reconciliation
  tests pass offline.
- [ ] Commit as `feat: add Duval ingestion adapter`.

---

### Task 4: Move the catalog and synchronize MCP maps

**Files**

- Create: `skills/use-oracle/runtime/catalog/{published-counties,mcp-overlays}.json`
- Create: `skills/use-oracle/runtime/catalog/README.md`
- Create: `skills/use-oracle/runtime/scripts/catalog/{update-published-county-catalog,print-mcp-env-maps,merge-mcp-env-maps,sync-mcp-json}.mjs`
- Create: `skills/use-oracle/runtime/tests/catalog/{published-county-catalog,print-mcp-env-maps,mcp-json-parity,no-oracle-node-runtime}.test.mjs`
- Modify: `skills/use-oracle/runtime/package.json`
- Modify: `mcp.json`
- Modify: `skills/use-elephant-mcp/reference/mcp-setup.md`
- Modify: `skills/use-oracle/reference/readiness-and-completeness.md`
- Modify: `agents/{oracle,watchog}.md`
- Modify: `skills/build-elephant-hero-facts/{SKILL.md,rules/catalog-dataset-monitoring.md}`
- Regenerate all modified agent mirrors.

**Interfaces**

- Catalog contains exactly:
  `broward`, `chester`, `hillsborough`, `lee`, `miami-dade`,
  `montgomery`, `orange`, `palm-beach`, `pinellas`, `polk`,
  `rock-island`, `seminole`.
- Overlay contains only `santa-clara`.
- `catalog:sync-mcp-json` updates property, permit, and coverage maps while
  preserving open-data/geo env keys and the MCP launcher.

- [ ] Seed the catalog from pinned `oracle-node/main`, add verified Seminole,
  and add the Santa Clara overlay.
- [ ] Port updater and printer tests, then implement overlay merge and
  deterministic root `mcp.json` synchronization.
- [ ] Assert 13 property-map keys, 12 coverage-map keys, and four permit-map
  keys (`broward`, `montgomery`, `rock-island`, `santa-clara`).
- [ ] Set the exact nested GitHub raw catalog URL in `mcp.json`.
- [ ] Add a test that rejects Pasco, catalogized Santa Clara, overlays for
  Seminole, and any `oracle-node` runtime URL.
- [ ] Rewrite all catalog/map instructions to the bundled runtime path and
  regenerate agent mirrors.
- [ ] Run:

  ```bash
  npm run catalog:sync-mcp-json --prefix skills/use-oracle/runtime
  npm run test:catalog --prefix skills/use-oracle/runtime
  scripts/validate-plugin.sh
  git diff --check
  ```

  Expected: catalog/map parity and plugin validation pass; running sync again
  leaves no diff.
- [ ] Commit as `feat: move county catalog into the team kit`.

---

### Task 5: Enforce clean-room CI and operator runbooks

**Files**

- Create: `skills/use-oracle/scripts/oracle-paths.sh`
- Create: `scripts/check-plugin-clean-room.py`
- Create: `skills/use-oracle/reference/self-contained-ingestion.md`
- Modify: `.github/workflows/validate-plugin.yml`
- Modify: `scripts/validate-plugin.sh`
- Modify: `scripts/local-cursor-plugin.sh`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: the five version-bearing plugin manifest values

**Interfaces**

- `oracle-paths.sh` derives `SOOFI_PLUGIN_ROOT` and
  `SOOFI_ORACLE_RUNTIME` from its own location, never the caller's cwd.
- Clean-room scan rejects tracked secrets, generated runtime directories,
  prohibited source-repository installs, runtime files above the documented
  fixture limit, and broken plugin symlinks.
- CI uses Node `22.18` and runs `npm ci`, all runtime tests, plugin validation,
  mirror checks, and `git diff --check`.

- [ ] Test path resolution from a temporary unrelated working directory.
- [ ] Implement clean-room scanning with explicit allowlists for public
  Filebase/IPNS URLs and migration provenance.
- [ ] Add the Node runtime test steps to `validate-plugin.yml`.
- [ ] Extend plugin validation to require the runtime package/catalog and
  reject tracked `node_modules`, `downloads`, `.env*`, and generated parcel
  artifacts.
- [ ] Document install, offline replay, bounded live pilot, publish dry-run,
  approval-gated publish, catalog update, and MCP smoke commands.
- [ ] Bump all plugin manifests from `0.36.0` to `0.37.0`.
- [ ] Run the clean-room gate from a temporary clone:

  ```bash
  tmp="$(mktemp -d)"
  git clone --no-local . "$tmp/soofi-xyz-team-kit"
  npm ci --prefix "$tmp/soofi-xyz-team-kit/skills/use-oracle/runtime"
  npm test --prefix "$tmp/soofi-xyz-team-kit/skills/use-oracle/runtime"
  "$tmp/soofi-xyz-team-kit/scripts/validate-plugin.sh"
  python3 "$tmp/soofi-xyz-team-kit/scripts/check-plugin-clean-room.py"
  ```

  Expected: all commands exit zero without access to sibling source repos,
  portal network, or credentials.
- [ ] Commit as `test: enforce clean-room Elephant ingestion`.

---

### Task 6: Run non-mutating integration verification

**Files**

- Modify only when a verification uncovers a defect.

- [ ] Run the complete local suites freshly:

  ```bash
  npm ci --prefix skills/use-oracle/runtime
  npm test --prefix skills/use-oracle/runtime
  scripts/validate-plugin.sh
  python3 scripts/check-plugin-clean-room.py
  git diff --check
  ```

- [ ] Run a bounded Pinellas live-capture pilot for one parcel into a temporary
  ignored directory with `--live-fetch`; do not publish.
- [ ] Run `publish --dry-run` against those artifacts with Filebase
  credentials absent from the subprocess environment.
- [ ] Run MCP consumer smoke using the local catalog path and assert 12
  catalog counties, Seminole present, Santa Clara absent from discovery but
  present in property/permit maps.
- [ ] Do not run live Filebase publication. Record the exact approval-gated
  command and expected readback checks in the PR test evidence.
- [ ] Compare the full branch diff against every Global Constraint and resolve
  all review findings.

Expected completion evidence:

- credential-free CI suite passes;
- temporary-clone clean-room suite passes;
- one-parcel live capture/transform/export succeeds or a concrete external
  portal blocker is reported without weakening Gate B;
- Filebase dry-run succeeds without network writes;
- no `oracle-node` catalog runtime dependency remains in bundled config.

