---
name: use-oracle
description: "Operating guide for the Oracle public-data mining agent. Use when driving the bundled stage skills and the Elephant CLI to capture, transform, validate, pack, and publish a county's property, permit, corporate-registry, and contractor data as lexicon records, one archive per data group, register each in the county registry, or to re-mine a supplied list of properties."
---

# Use Oracle

Oracle does not contain its own mining code. It **drives the bundled stage skills** under
`skills/` for capture and transform, the **Elephant CLI** for validation, hashing,
archive packing, and upload, and a pull request against **Atlas** for registration. This
skill is the operating contract: what a finished county looks like, the stack choice, the
pipeline, the CLI requirements, and the rules.

## What a finished county is

1. Every property, in every data group's output, is a directory of lexicon JSON: entity
   records with `source_http_request` and `request_identifier`, relationship records that
   link them, that group's data-group root, and the seed data-group root. Seed is the
   property's identity and rides inside every group; it is never a group of its own.
2. `elephant-cli validate` over each group's directory reports no data rows.
3. `elephant-cli hash --output-car` produced **one archive per data group**
   (`<county>-<group>.car`) whose single root is the county index, plus the hash CSV
   mapping every property to its data-group roots.
4. `elephant-cli validate <county>-<group>.car` passed all six checks for every group.
5. `elephant-cli export-tables <county>-<group>.car` wrote each group's per-class tables
   directory and its `tables.car`, whose single root is the `CountyTables` index. Only
   this command produces those tables; never hand-build them.
6. `elephant-cli upload <county>-<group>.car` read the root back from the gateway, and
   `elephant-cli upload <tables-dir>` read the tables root back the same way, per group.
7. The run evidence lists, per group, the archive root, block count, schema CID, tables
   root, table and part counts, plus the CLI commit, manifest URL, and node.
8. When the existing publication is in scope, the query-table, coverage, IPNS, and MCP
   publication ran exactly as its skills describe. It is a separate path.
9. Every group's page entry is merged in Atlas: `counties/<STATE>/<county>.json` holds
   `cid`, `schema`, and `tables` for the group, the PR's `validate` check passed, and a
   code owner merged it.

## Always read

1. [`reference/car-publication.md`](./reference/car-publication.md) — the per-group
   command sequence, archive layout, the provider facts the design depends on, the Atlas
   page and pull-request flow, CLI requirements, evidence to keep, property-list runs
2. [`reference/readiness-and-completeness.md`](./reference/readiness-and-completeness.md) —
   catalog fields, jump-of-ingest rules, parcel and permit gates, completeness
3. [`reference/failure-modes.md`](./reference/failure-modes.md) — capture and enrichment
   traps: caps, sessions, BBB counts, remote browser, secrets at process start
4. [`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md) —
   per-source capability matrix, field evidence states, permit-to-company resolution
5. [`reference/request-routing.md`](./reference/request-routing.md) — who receives a
   records or API request; catalog `records_request` fields
6. [`reference/hoa-property-management.md`](./reference/hoa-property-management.md) —
   HOA and property-management lookup rules
7. [`reference/self-contained-ingestion.md`](./reference/self-contained-ingestion.md) —
   runtime install, offline replay, bounded pilot, clean-room gate
8. [`../county-readiness-preflight/SKILL.md`](../county-readiness-preflight/SKILL.md) —
   the deterministic validator; run it before seed, pilot, or full ingest
9. [`reference/durable-orchestration.md`](./reference/durable-orchestration.md) — core
   principles, adapter vs inventory status, required status report, human-required actions
10. [`reference/continuous-ingestion.md`](./reference/continuous-ingestion.md) —
   autonomous stage advancement, durable handoffs, worker recovery, immutable republish
11. [`reference/continuous-safe-optimization.md`](./reference/continuous-safe-optimization.md) —
   measured bottlenecks, bounded experiments, automatic rollback
12. [`reference/roof-age-and-identity-reingest.md`](./reference/roof-age-and-identity-reingest.md) —
   county re-ingest checklist, roof-age estimator, identity-edge backfill
13. [`reference/coverage-only-publication.md`](./reference/coverage-only-publication.md) —
   repair of a county's coverage pointer without touching its query table

References 9 through 13 describe the capture runtime, the query-DB working store, and the
existing query-table, coverage, and IPNS publication. That publication keeps running as
written; `car-publication.md` is the separate archive and Atlas path.

## Choose the stack first

Identify **exactly one** capture runtime from `skills/use-oracle/runtime/` before loading
any stage procedure. Do not warn-and-continue.

| Marker in the runtime | Stack | Load these procedures |
|---|---|---|
| `docker-compose.yml`, Restate services, `docs/` | **local** | Bundled `skills/` stage skills; `bootstrap-oracle-infra` is local Docker + Restate. Status: `monitoring-county-ingestion`. |
| AWS/SQS, CDK, `catalog/published-counties.json` | **aws** | AWS profile and region, SQS seed feeder. Do not run Restate handlers. Status: `monitoring-oracle-ingestion`. |

If both markers are present, or neither, **STOP** and ask. Never run Restate procedures
against an AWS runtime, or AWS procedures against the local stack. The stack governs
capture and transform only; publication is the same CLI sequence on either stack.

BBB browser work runs on approved AWS-managed remote compute with US egress, never in a
browser on the operator's machine, whichever stack captures the county.

## The pipeline

Drive it in this order for every county. There is no alternate order.

1. **Intake and readiness** — `onboard-county` intake once; `county-discovery` writes
   `skills/use-oracle/runtime/docs/<county>-sources.yaml`; then
   `python3 skills/use-oracle/scripts/validate-county-readiness.py <that yaml>`.
   Non-zero exit stops seed, pilot, and full ingest. It does not stop enumeration,
   adapter fixtures, access requests, or publication readiness.
2. **Parcel backbone** — `county-seed-data` (only after PASS), `county-appraisal-onboarding`,
   `build-county-transform`. Capture with `elephant-cli prepare`;
   transform with `elephant-cli transform`. Scripts mode does not write the seed
   data-group root; produce it with seed mode from the county `seed.csv` and merge it into
   each property directory before validation. Without the seed root, `hash` cannot
   determine the property CID.
3. **Identity baseline, before permits, every time** — official corporate registry, then
   official licensing authority with its fail-closed adequacy gate. In Florida:
   `sunbiz-corporate-ingest`, then `dbpr-license-ingest`. A snapshot is adequate only if
   it is official, loaded, reconciled, dated, and covers the ingest window.
4. **Permits, second** — `county-permit-adapter` then `county-ingest-run`; then
   `reference/permit-evidence-preflight.md`. A permit contact resolves to an existing
   company record deterministically by license number, or by unique company plus
   licensed qualifier effective on the attribution date. Ambiguous stays unresolved.
5. **Reputation and places** — `bbb-harvest`, `overture-places-ingest`. Enrichment only;
   never license, qualifier, or identity evidence.
Steps 6 through 11 run **once per data group** (`county`, `property_improvement`, `hoa`,
`corporate_registry`, `places`, whichever the county produced) over that group's output
directory, where every property carries the group's root and the seed root.

6. **Validate the group** — `elephant-cli validate <group-dir> --output-csv <errors.csv>`.
   Fix transforms and re-run until no data rows remain. Never suppress a lexicon error to
   reach publication.
7. **Hash and pack** — `elephant-cli hash <group-dir> --output-zip <hashed-dir>
   --output-csv <hash.csv> --output-car <county>-<group>.car`. Record the root CID, block
   count, and the group's schema CID (`dataGroupCid` in the hash CSV).
8. **Validate the archive** — `elephant-cli validate <county>-<group>.car --output-csv
   <car-errors.csv>`. Integrity, root, index, graph, lexicon, orphans: all zero.
9. **Export the tables** — `elephant-cli export-tables <county>-<group>.car --output
   <tables-dir> --output-json <tables-export.json>`. Record the printed table count, part
   count, and tables root. This is the only source of per-class tables.
10. **Upload the archive** — `elephant-cli upload <county>-<group>.car --output-json
    <summary.json>`; local kubo by default, hosted node with `--api` and a token. Success
    means the gateway served the root with matching bytes.
11. **Upload the tables** — `elephant-cli upload <tables-dir> --output-json
    <tables-summary.json>` to the same node with the same options. Success means every
    part's CID matched the index and the gateway served the tables root.
12. **Register in Atlas** — write or update `counties/<STATE>/<county>.json` by hand with
    `cid`, `schema`, and `tables` per group (no generator exists yet), open the PR on
    branch `publish/<state>-<county>` with `gh pr create`, wait for the `validate` check,
    and ask a code owner to merge. A reverted merge means the archive was not served:
    re-upload and open a new PR. Exact flow in `car-publication.md`.
13. **Existing publication, when in scope** — `county-query-table-publish`,
    `county-open-data-publish`, coverage, and `deploy-open-data-mcp` exactly as their
    skills describe: the `Publish` object dry-runs until a human approves, per-county
    IPNS labels, catalog-driven MCP maps, Donphan smoke. A separate path; unchanged.
14. **Report** with the status report in `agents/oracle.md`.

The query DB (`query-db-loading-matching`, `use-elephant-query-db`) remains the working
store for reconciliation, identity edges, product queries, and the existing query-table
and coverage exports. The archive is never exported from it.

## Property-list runs

When the input is a list of properties rather than a county (for example a partner's
set spanning many counties): split the list by county, build one `seed.csv` per county
with only those rows, run steps 2 through 12 per county, and return one archive root,
schema CID, and tables root per group plus the Atlas PR per county. Never merge counties
into one archive.

## Re-mining legacy data

Records mined before the lexicon format lack provenance and cannot be converted. Re-mine
them: capture and transform again, then the same validate, hash, validate, export, upload,
register sequence per group. A delta refresh is for stale records, not for a format change.

## CLI requirements

- Install the Elephant CLI from GitHub `main`, not from npm:
  `npm i github:elephant-xyz/elephant-cli#main` (or `npx --package=github:elephant-xyz/elephant-cli#main elephant-cli`).
  The npm release workflow is currently failing, so `@elephant-xyz/cli@latest` lacks
  batch input, `--output-car`, CAR upload, CAR validation, and `export-tables`. Record the installed
  commit (`npm ls @elephant-xyz/cli` shows it) in the run evidence.
- The CLI must reach the lexicon manifest at `https://lexicon.elephant.xyz/api/manifest`
  and fetch schemas through a gateway that serves them. Defaults are Filebase's public
  gateway, then Pinata's, then the public gateways; override with
  `ELEPHANT_SCHEMA_MANIFEST_URL` and `ELEPHANT_IPFS_GATEWAYS`. A run that could not load
  the manifest has validated nothing.
- Publication environment: `IPFS_API`, `IPFS_API_TOKEN`, `ELEPHANT_CAR_GATEWAY`, or the
  three `FILEBASE_*` variables. Tokens are never printed or written into the catalog.
- `gh` authenticated with write access to `elephant-xyz/atlas` for the registration PR.
- For local portal probing, a US egress IP (`curl -s ipinfo.io/country`).

## Stage-skill map

| Skill | Purpose |
|---|---|
| `onboard-county` | Orchestrator: intake, then every stage below for a county |
| `bootstrap-oracle-infra` | Verify or bootstrap the chosen capture stack |
| `county-discovery` | Research a county; write `docs/<county>-sources.yaml` |
| `county-readiness-preflight` | **Hard gate.** Run the validator; STOP on BLOCKED |
| `county-seed-data` | Produce and stage the parcel seed CSV, only after readiness PASS |
| `county-appraisal-onboarding` | Browser flow, per-county prepare queue, transform wiring |
| `build-county-transform` | Author or repair a county transform, prove lexicon validity and coverage, open the transform PR |
| `sunbiz-corporate-ingest` | **Identity baseline, before permits.** Official corporate registry |
| `dbpr-license-ingest` | **Identity baseline, before permits.** Official licensing authority with adequacy gate |
| `county-permit-adapter` | Build the county permit-portal harvester, after the identity baseline |
| `county-ingest-run` | Backpressure-aware seed feeder, after readiness PASS |
| `monitoring-county-ingestion` | **Local stack:** queue and invocation health, counts, ETAs |
| `monitoring-oracle-ingestion` | **AWS stack:** SQS, Lambda, S3 counts, ETAs |
| `bbb-harvest` | Contractor reputation enrichment only |
| `overture-places-ingest` | Places taxonomy and boundary enrichment |
| `query-db-loading-matching` | Load artifacts into the working store; cross-match by parcel and address |
| `use-elephant-query-db` | Read the working store |
| `durable-workflow-builder` | Author capture workflows and handlers |
| `county-open-data-publish` | Existing publication: consolidated property JSON to Filebase/IPFS behind the county's IPNS name |
| `county-query-table-publish` | Existing publication: query-table Parquet export, validation gate, IPNS, MCP wiring |
| `deploy-open-data-mcp` | Existing publication: self-host the open-data MCP server |
| `use-elephant-mcp` | Read published counties through the MCP |

## Rules

- Choose one stack before loading procedures.
- Drive the skills and the CLI; never improvise mining commands they do not define.
- Never hardcode or print account ids, tokens, secrets, or `DATABASE_URL`.
- Never skip `validate-county-readiness.py` before seed, pilot, or full ingest.
- Identity baseline first, permits second, every time.
- Validate before hash, hash before publish, read back before reporting success.
- One archive per county per data group; the seed root rides inside every archive and is
  never a group of its own. Every archive block comes from `elephant-cli hash`; the
  archive is never exported from the query DB. Every per-class table comes from
  `elephant-cli export-tables`; never hand-build one. An Atlas group entry holds exactly
  three CIDs. The existing query-table and coverage exports continue unchanged.
- Data-record CIDs are dag-json, schema CIDs are raw; compare digests, not strings.
- Never solve, bypass, OCR, or evade CAPTCHA. Preserve valid unmatched records.
- Runtime secrets apply at process start; restart a job after adding keys.
- Report completeness honestly. A pilot that passed does not make a county complete.
- Every status response uses the required status report in `agents/oracle.md`.

## Milestone scope

**In:** discover and capture county sources; transform to lexicon; identity baseline
then permits; validate; pack one archive per county per data group; upload it to a local
or hosted IPFS node with root readback; export the per-class tables from each archive with
the CLI and upload them with tables-root readback; register every group on the county's
Atlas page through a merged pull request; property-list re-mining; re-mining of legacy
data; the existing query-table, coverage, IPNS, and MCP publication, unchanged.

**Out:** replacing the existing query-table, coverage, IPNS, and MCP publication,
on-chain submission, and Elephant.xyz UI changes.
