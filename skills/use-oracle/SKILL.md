---
name: use-oracle
description: "Operating guide for the Oracle public-data mining agent. Use when driving the bundled stage skills and the Elephant CLI to capture, transform, validate, pack, and publish a county's property, permit, corporate-registry, and contractor data as lexicon records in one county archive, or to re-mine a supplied list of properties."
---

# Use Oracle

Oracle does not contain its own mining code. It **drives the bundled stage skills** under
`skills/` for capture and transform, and the **Elephant CLI** for validation, hashing,
archive packing, and publication. This skill is the operating contract: what a finished
county looks like, the stack choice, the pipeline, the CLI requirements, and the rules.

## What a finished county is

1. Every property is a directory of lexicon JSON: entity records with
   `source_http_request` and `request_identifier`, relationship records that link them,
   and one data-group root per data group, including the seed root.
2. `elephant-cli validate` over the county directory reports no data rows.
3. `elephant-cli hash --output-car` produced one archive whose single root is the county
   index, plus the hash CSV mapping every property to its data-group roots.
4. `elephant-cli validate <county>.car` passed all six checks.
5. `elephant-cli upload <county>.car` read the root back from the gateway.
6. The run evidence lists the root CID, block count, CLI commit, manifest URL, and node.

Registry registration, IPNS names, MCP wiring, and per-table Parquet indexes are out of
scope for this milestone. Hand back the root CID; do not improvise those steps.

## Always read

1. [`reference/car-publication.md`](./reference/car-publication.md) — the command
   sequence, archive layout, the provider facts the design depends on, CLI requirements,
   evidence to keep, property-list runs, known limits
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

The older references on durable orchestration, continuous ingestion, safe optimization,
coverage-only publication, and roof-age re-ingest still describe the capture runtime and
the query-DB working store. Their publication sections (Publish objects, approve handlers,
per-county IPNS labels, coverage pointers, MCP maps) are superseded by
`car-publication.md` and must not be followed.

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
   `transform-v2-builder`, `validate-county-transform`. Capture with `elephant-cli prepare`;
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
6. **Validate the county** — `elephant-cli validate <county-dir> --output-csv <errors.csv>`.
   Fix transforms and re-run until no data rows remain. Never suppress a lexicon error to
   reach publication.
7. **Hash and pack** — `elephant-cli hash <county-dir> --output-zip <hashed-dir>
   --output-csv <hash.csv> --output-car <county>.car`. Record the root CID and block count.
8. **Validate the archive** — `elephant-cli validate <county>.car --output-csv <car-errors.csv>`.
   Integrity, root, index, graph, lexicon, orphans: all zero.
9. **Publish** — `elephant-cli upload <county>.car --output-json <summary.json>`; local kubo
   by default, hosted node with `--api` and a token. Success means the gateway served the
   root with matching bytes.
10. **Report** with the status report in `agents/oracle.md`.

The query DB (`query-db-loading-matching`, `use-elephant-query-db`) remains the working
store for reconciliation, identity edges, and product queries. Nothing published is
exported from it.

## Property-list runs

When the input is a list of properties rather than a county (for example a partner's
set spanning many counties): split the list by county, build one `seed.csv` per county
with only those rows, run steps 2 through 9 per county, and return one root CID per
county. Never merge counties into one archive.

## Re-mining legacy data

Records mined before the lexicon format lack provenance and cannot be converted. Re-mine
them: capture and transform again, then the same validate, hash, validate, upload
sequence. A delta refresh is for stale records, not for a format change.

## CLI requirements

- Install the Elephant CLI from a GitHub commit that includes batch input,
  `--output-car`, CAR upload, and CAR validation, and record the commit in the run
  evidence. The npm release workflow is currently failing, so `@elephant-xyz/cli@latest`
  lags.
- The CLI must reach the lexicon manifest at `https://lexicon.elephant.xyz/api/manifest`
  and fetch schemas through a gateway that serves them. Defaults are Filebase's public
  gateway, then Pinata's, then the public gateways; override with
  `ELEPHANT_SCHEMA_MANIFEST_URL` and `ELEPHANT_IPFS_GATEWAYS`. A run that could not load
  the manifest has validated nothing.
- Publication environment: `IPFS_API`, `IPFS_API_TOKEN`, `ELEPHANT_CAR_GATEWAY`, or the
  three `FILEBASE_*` variables. Tokens are never printed or written into the catalog.
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
| `transform-v2-builder` | Author or repair county transform handler packages |
| `validate-county-transform` | Prove transforms extract 100% of available data |
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

`county-open-data-publish`, `county-query-table-publish`, `deploy-open-data-mcp`, and
`use-elephant-mcp` describe the previous publication model. Oracle does not drive them
for publication in this milestone.

## Rules

- Choose one stack before loading procedures.
- Drive the skills and the CLI; never improvise mining commands they do not define.
- Never hardcode or print account ids, tokens, secrets, or `DATABASE_URL`.
- Never skip `validate-county-readiness.py` before seed, pilot, or full ingest.
- Identity baseline first, permits second, every time.
- Validate before hash, hash before publish, read back before reporting success.
- Every published block comes from `elephant-cli hash`; nothing is exported from the
  query DB for publication.
- Data-record CIDs are dag-json, schema CIDs are raw; compare digests, not strings.
- Never solve, bypass, OCR, or evade CAPTCHA. Preserve valid unmatched records.
- Runtime secrets apply at process start; restart a job after adding keys.
- Report completeness honestly. A pilot that passed does not make a county complete.
- Every status response uses the required status report in `agents/oracle.md`.

## Milestone scope

**In:** discover and capture county sources; transform to lexicon; identity baseline
then permits; validate; pack one archive per county run; publish it to a local or
hosted IPFS node with root readback; property-list re-mining; re-mining of legacy data.

**Out:** registry registration, IPNS names, MCP wiring, per-table Parquet indexes,
on-chain submission, and Elephant.xyz UI changes.
