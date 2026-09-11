---
name: use-oracle
description: "Operating guide for the Oracle public-data ingestion agent. Use when driving bundled ingestion skills under skills/ and the bundled runtime at skills/use-oracle/runtime/ to discover, ingest, validate, refresh, and publish a county's property, permit, corporate-registry, and contractor-reputation data plus its coverage snapshot. Enforces fail-closed readiness and honest completeness."
---

# Use Oracle

Oracle is the public-data ingestion agent. It does NOT contain its own ingestion code — it
**drives the bundled stage skills** under `skills/` (`onboard-county` and its stage skills)
against **one chosen runtime** at `skills/use-oracle/runtime/`, and reads results from the
query DB. This skill is the operating contract: stack selection, catalog path, readiness gate,
stage map, and publish/coverage rules.

## Always read

1. [`reference/durable-orchestration.md`](./reference/durable-orchestration.md) — core
   principles, adapter vs inventory status, CAPTCHA/login as access states, required status
   report, human-required actions, durable learning loop
2. [`reference/continuous-ingestion.md`](./reference/continuous-ingestion.md) — autonomous
   stage advancement, durable handoffs, worker leases/recovery, runtime provenance,
   end-to-end completion, and immutable republish on snapshot drift
3. [`reference/continuous-safe-optimization.md`](./reference/continuous-safe-optimization.md) —
   measured bottlenecks, bounded experiments, automatic rollback, and load/publication batching
4. [`reference/readiness-and-completeness.md`](./reference/readiness-and-completeness.md) —
   YAML catalog fields, jump-of-ingest rules, parcel/permit/destination gates,
   reconciliation, completeness, publication fail-closed
5. [`reference/failure-modes.md`](./reference/failure-modes.md) — ingest and enrichment
   traps (caps, sessions, BBB page vs advertised totals, AWS-remote browser vs operator
   laptop, secrets inject only at process start, S3 staging ≠ Filebase)
6. [`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md) —
   per-source capability/coverage matrix, field evidence states, decision gates, bounded
   detail repair, permit-to-company/license resolution, supported edge vocabulary, gap
   ledger, and acceptance rules for permit-backed conclusions
7. [`reference/roof-age-and-identity-reingest.md`](./reference/roof-age-and-identity-reingest.md) —
   the operator's county re-ingest checklist, roof-age estimator, identity-edge backfill,
   index gate, and product-query rerun.
8. [`reference/request-routing.md`](./reference/request-routing.md) — name **who** receives
   a records or API request; catalog `records_request` fields
9. [`reference/source-provenance.md`](./reference/source-provenance.md) — upstream SHAs and
   bundled skill import provenance
10. [`reference/self-contained-ingestion.md`](./reference/self-contained-ingestion.md) —
   install, offline replay, bounded live pilot, publish dry-run, approval-gated publish,
   catalog update, MCP smoke, and the clean-room verification gate. The team-facing test
   evidence template for changes to the bundled runtime.
11. [`reference/coverage-only-publication.md`](./reference/coverage-only-publication.md) —
   adapter-independent repair/refresh of a county's coverage snapshot without touching
   its property query table, including cryptographic approval and immutable readback.
12. [`../county-readiness-preflight/SKILL.md`](../county-readiness-preflight/SKILL.md) — the
   deterministic validator. `onboard-county` must run it before seed, pilot, or full ingest.

## Choose the stack first

Identify **exactly one** runtime from `skills/use-oracle/runtime/` **before** loading any
stage procedure. Do not warn-and-continue.

| Marker in the runtime | Stack | Load these procedures |
|---|---|---|
| `docker-compose.yml`, Restate services, `docs/` | **local** | Bundled `skills/` stage skills. `bootstrap-oracle-infra` is local Docker + Restate. Status: `monitoring-county-ingestion`. |
| AWS/SQS, CDK, `catalog/published-counties.json` | **aws** | AWS profile/region, SQS seed feeder. Do not run Restate handlers. Status: `monitoring-oracle-ingestion`. |

The bundled runtime targets **local Restate + Postgres** by default. Use AWS procedures only
when the runtime checkout contains oracle-node AWS markers.

If both markers are present, or neither, **STOP** and ask which stack this run uses. Never
run Restate procedures against an AWS runtime, or AWS procedures against the local stack.

The selected ingestion stack does not determine where BBB browser automation runs. Run
BBB public-site browser work on approved **AWS-managed remote compute** with US egress,
never in a browser on the operator's machine. Do not require a VM specifically; use the
approved AWS job/container/compute path supplied by `bbb-harvest`.

## What Oracle drives

Bundled stage skills under `skills/` implement **one** ordered pipeline. Drive it in this
order for every county; there is no alternate order and no parallel permit path:

1. **Parcel backbone** — appraisal/property capture plus lexicon transform. This produces
   the seed CSV and property records that everything else hangs off.
2. **Identity baseline, pre-populated first** — after the parcel/appraisal backbone,
   run the official corporate registry, then the official contractor-licensing authority.
   In Florida run Sunbiz (`sunbiz-corporate-ingest`) then `dbpr-license-ingest` for
   fail-closed adequate official **DBPR**
   (licenses, qualifier/person relationships, qualified-business relationships, status,
   effective dates). If DBPR is inadequate, acquire it next. Sunbiz is the corporate
   registry only; it does not issue contractor licenses.
3. **Permit harvest, second** — `county-permit-adapter` then `county-ingest-run`. Permits
   are a loose set that frequently omits license numbers, which is exactly why the identity
   baseline must already be loaded.
4. **Permit evidence preflight + identity resolver** —
   [`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md).
   A license number on the permit is deterministic. When the license is omitted, match
   company name + the licensed individual's (qualifier's) name against the pre-populated
   identity records, accept only a unique candidate, and require DBPR qualification
   effective on the permit attribution date.
5. **Stamp supported company edges** — write the Query-DB company UUID
   `companies.company_id` to `permit_contacts.company_id`, and to
   `property_improvements.contractor_company_id` only when every contractor-role contact on
   the permit resolves to the same company, so later queries traverse IDs instead of regex.
6. **Query DB → public Filebase/IPFS publish surfaces.**

BBB and Overture places are reputation/context enrichment that runs after the above. They
are never license, qualifier, or corporate-identity evidence, and permit harvest followed by
Sunbiz enrichment is not a valid path.

On every county ingest or re-ingest, run `dbpr-license-ingest` and apply its
**fail-closed DBPR adequacy gate**, then
acquire if needed. A DBPR snapshot is adequate only if it is official, loaded,
reconciled, dated, and includes licenses, qualifier/person relationships,
qualified-business relationships, status, and effective dates covering the ingest window.
Missing, stale, unreconciled, empty, BBB-only, or name-only contractor lists are **not**
adequate. If inadequate: do not skip, do not wait forever, and do not harvest permits.
Acquire the official Florida DBPR snapshot next from official public records/downloads
at conservative rate; write a private snapshot with provenance/digests; load whatever
supported tables exist; record remaining schema gaps without inventing SID or
license-entity fields. Permits wait until the
snapshot is adequate or the operator explicitly aborts. If adequate: do not re-harvest
DBPR unless freshness is stale versus the as-of rule; proceed to permit harvest second.
Sunbiz remains first among identity sources, but DBPR is not optional.

The sequence and gates are county-neutral. For a non-Florida county, replace Sunbiz and
DBPR with the official corporate registry and contractor-licensing authority named in
the county profile; preserve the same adequacy and temporal-evidence requirements.
Oracle is the named entry point that runs these stages; it never re-implements a stage.

## Prerequisites

- Work happens in the bundled runtime at **`skills/use-oracle/runtime/`** with sibling repos
  next to it when transforms or query-db tooling are needed: `Counties-trasform-scripts`, and
  `lexicon` (optional). Query DB schema is bundled in `use-elephant-query-db`.
- **Local stack:** Docker, Node 22+, `restate` CLI, `gh` authenticated. No cloud account
  for ingestion.
- **AWS stack:** `AWS_PROFILE` / `AWS_REGION` for the existing `elephant-oracle-node`
  account. Skills never hardcode accounts. STOP before any live AWS run if access is
  missing — discovery still does not need AWS.
- **BBB public-site harvest:** an approved AWS remote execution path with US egress and
  secrets injected at process start. This applies even when the chosen ingestion stack is
  local.
- **Publication:** verify Filebase credential availability, target bucket, and IPNS
  ownership at intake whenever publication is in scope. Request missing secret injection
  immediately; never wait until the publish stage or copy secret values into the catalog.
- For local portal probing, a **US egress IP**.
- Stage skills are bundled in this plugin under `skills/<skill-name>/SKILL.md`. Do **not**
  install skills from external registries.

## Source catalog

The machine-readable county source catalog is
**`skills/use-oracle/runtime/docs/<county>-sources.yaml`**.
`county-discovery` already writes it. Do **not** invent
`Counties-trasform-scripts/<county>/sources/sources.json`.

Human findings stay in `skills/use-oracle/runtime/docs/<county>-county-findings.md` and are
PR'd to `Counties-trasform-scripts/<county>/docs/` as discovery already requires.

## Stage-skill map

| Skill | Purpose |
|---|---|
| `onboard-county` | Orchestrator: operator intake, then sequences every stage below for a county |
| `bootstrap-oracle-infra` | Verify/bootstrap the chosen stack (local Restate/Postgres, or AWS) |
| `county-discovery` | Research a county; write `docs/<county>-sources.yaml` |
| `county-readiness-preflight` | **Hard gate.** Run the validator; STOP on BLOCKED |
| `county-seed-data` | Produce and stage the parcel seed CSV — only after readiness PASS |
| `county-appraisal-onboarding` | Browser flow, per-county prepare queue, transform-script wiring |
| `validate-county-transform` | Prove transforms extract 100% of available data across variability |
| `sunbiz-corporate-ingest` | **Identity baseline, before permits.** Official Florida corporate registry: legal entities and `document_number`. Not a licensing source |
| `dbpr-license-ingest` | **Identity baseline, before permits.** Official Florida DBPR adequacy gate and acquisition: licenses, qualifiers/persons, qualified-business relationships, status, and effective dates; load supported structures and record unsupported schema without inventing entities |
| `county-permit-adapter` | Build the county permit-portal harvester (Accela template + generic path) — only after the identity baseline is loaded and reconciled |
| `county-ingest-run` | Deploy/start the backpressure-aware seed feeder — only after readiness PASS and, for permits, after the identity baseline |
| `monitoring-county-ingestion` | **Local stack:** queue/invocation health, artifact counts, DB counts, ETAs |
| `monitoring-oracle-ingestion` | **AWS stack:** SQS/Lambda health, S3 artifact counts, ETAs |
| `bbb-harvest` | BBB contractor category harvest for reputation/quality enrichment only — after permits, never license or qualifier evidence |
| `query-db-loading-matching` | Load artifacts into the query DB and cross-match by parcel id / address hash |
| `transform-v2-builder` | Author/repair county transform handler packages for elephant-cli transform v2 |
| `overture-places-ingest` | Overture Maps places taxonomy, boundary, and publication gates |
| `county-open-data-publish` | Consolidated property JSON to Filebase/IPFS with IPNS |
| `county-query-table-publish` | Columnar query-table Parquet export and MCP wiring |
| `deploy-open-data-mcp` | Self-host the Elephant open-data MCP server |
| `durable-workflow-builder` | Author Restate pipeline workflows and handlers |

## Start independent work immediately

After intake, create and start the county work queue automatically. Do not wait for one
track to finish before beginning another, and do not ask for confirmation for reversible
discovery or scaffolding:

1. **Enumerate the full source graph:** assessed/GIS sources, every permit jurisdiction,
   delegated authority, predecessor system, Sunbiz boundary, and BBB category scope. Start
   bulk/list/API discovery and custodian-route research immediately.
2. **Determine adapter work:** fingerprint each portal/vendor, map it to an existing
   reusable adapter, and start missing adapter scaffolds, fixtures, and bounded tests as
   soon as the vendor is known. Open the permit capability/coverage matrix and run the
   permit evidence preflight before using sampled fields for decisions. Do not wait for
   parcel ingestion to finish.
3. **Prove execution and destinations:** verify the chosen ingestion stack, the AWS remote
   BBB execution path, Neon destination identity, Filebase credential availability,
   publication bucket, and IPNS ownership. If access is missing, request it immediately
   while the other tracks continue.
4. **Open blocker routes:** for CAPTCHA, login, prohibited automation, custodian-only
   access, or unavailable exports, classify the state and prepare the named API or records
   request from `reference/request-routing.md` immediately.
5. **Pre-populate the identity registries:** run `sunbiz-corporate-ingest` for Florida,
   then `dbpr-license-ingest`. If DBPR is inadequate, acquire the official snapshot next
   and finish that stage before permit harvest. Schema gaps (no SID, no license-entity
   table) are recorded after loading supported tables; they do not authorize skipping
   acquisition or harvesting permits first.

The readiness gate blocks seed, pilots, adapter scale-out, and full ingestion. It does not
block source enumeration, bounded probes, adapter implementation/fixtures, access setup,
records-request preparation, or publication-readiness checks.

Start or reuse the durable coordinator defined in
[`reference/continuous-ingestion.md`](./reference/continuous-ingestion.md). A successful
stage or status message must enqueue the next eligible stage; do not pause for operator
confirmation. Persist all stage transitions and cross-environment handoffs in the run
manifest.

## Mandatory operating sequence

Follow this sequence for **every** county, including the first ingest. The preflight
encodes failure modes learned from prior counties (GIS vs tax-roll, fragmented permit
jurisdictions, county one-stop portals). Do not treat those counties as special cases —
apply the same gates at the jump of any new ingest. Do not stage a full seed, run a pilot,
or begin bulk traversal before the validator passes. Begin enumeration, adapter
determination and implementation, access remediation, and publication readiness during
bounded discovery; never implement against an assumed source.

| Step | Action | Existing skill / artifact |
|---|---|---|
| 1 | Operator intake + launch the independent startup work queue | `onboard-county` intake |
| 2 | Review prior findings, transforms, adapters, manifests, and checkpoints | `skills/use-oracle/runtime/docs/` plus `Counties-trasform-scripts/<county>/` |
| 3 | Bounded source discovery + full jurisdiction/source enumeration | `county-discovery` |
| 4 | Build the catalog and per-source permit capability/coverage matrix; prove the identity-registry routes, adapters, schema, and freshness; start required adapter fixtures/scaffolds; prove Neon, AWS BBB execution, and Filebase readiness | `docs/<county>-sources.yaml`, `reference/permit-evidence-preflight.md`, `sunbiz-corporate-ingest` when applicable, `county-permit-adapter`, `bootstrap-oracle-infra` |
| 5–6 | County Readiness Preflight + exceptions | `county-readiness-preflight` validator; **STOP** before seed, pilots, or scale-out if any gate is `BLOCKED` |
| 7 | Complete the seed/appraisal backbone and transform validation | `county-seed-data`, `county-appraisal-onboarding`, `validate-county-transform` |
| 8 | **Pre-populate the identity baseline.** Official corporate registry first, then official licensing-authority adequacy-or-acquire. In Florida use Sunbiz then DBPR. Permit harvest waits until licensing data is adequate or the operator aborts | `sunbiz-corporate-ingest`, `dbpr-license-ingest`, or official state equivalents |
| 9 | Complete permit adapters; **harvest permits with detail/contacts second**; run permit evidence preflight and the versioned identity resolver | `county-permit-adapter`, `county-ingest-run`, `reference/permit-evidence-preflight.md` |
| 10 | Backfill supported company edges, verify company-FK indexes, reconcile, and rerun the product query; then reputation/context enrichment | `query-db-loading-matching`, `reference/roof-age-and-identity-reingest.md`, `bbb-harvest`, `overture-places-ingest` |
| 11–12 | Privacy derivatives + publish | `county-query-table-publish`, `county-open-data-publish` |
| 13 | Verify through Donphan | MCP smoke after publish (`listPublishedCounties`, `getOracleDatasetInfo`) |
| 14 | Freeze evidence and determine completeness | coverage JSON + catalog; completeness only if all eight evidence gates pass |

**Hard gate (also when the user invokes `onboard-county` directly, not only `/oracle`):**

```bash
python3 skills/use-oracle/scripts/validate-county-readiness.py \
  skills/use-oracle/runtime/docs/<county>-sources.yaml
```

Non-zero exit = STOP. Do not call `county-seed-data`, do not start a pilot, and do not
start a full `county-ingest-run`. A passing report (`overall: PASS`, `seed_allowed: true`)
is required before pilot or full ingestion.

After readiness passes, run
[`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md)
for every permit source used by a pilot, repair, analysis, or publication. An unresolved
field does not justify a guess: retain it as unknown/unavailable/quarantined and make only
the affected downstream conclusion ineligible.

Unreadiness, CAPTCHA, login, and custodian-only access are genuine blockers. When one
source is blocked, continue every independent safe workstream. Name the records
recipient from [`reference/request-routing.md`](./reference/request-routing.md) — never
say “request a bulk export” without an office, portal, and system scope.

The validator's `next_automated_actions` are mandatory continuation work, not suggestions.
Drive them while blocker owners handle `required_blocker_actions`.

## How to run

- **Full county:** invoke `onboard-county`. Answer intake once. Drive discovery and update
  `docs/<county>-sources.yaml` while the independent startup tracks run. **Run the
  validator.** Only after PASS continue seed/appraisal backbone → official corporate
  registry → official licensing-authority adequacy-or-acquire → permit detail/contact
  harvest → preflight →
  versioned resolver/company-edge backfill → index verification → query-DB load and
  product-query rerun → BBB/places enrichment → publish. Example:

  > Re-ingest `<county>, <state>` with the `onboard-county` skill. Start with a
  > ~25-parcel pilot and follow `reference/roof-age-and-identity-reingest.md`.

- **Single stage:** invoke a stage skill directly. `county-seed-data` and
  `county-ingest-run` still require a passing readiness report first.

- **Prefer bulk and list sources during discovery.** After a seed CSV exists, that seed
  remains the input of record for refresh and repair.

## Read the query DB

Use **`use-elephant-query-db`**. Never hardcode or print `DATABASE_URL`. Prove the
destination through `bootstrap-oracle-infra` and `query-db-loading-matching` before any
write. Do not open writer connections from this plugin.

## Coverage publish contract

Every county onboarding must publish coverage as a public IPFS/IPNS contract, not as an
AWS URL:

1. At intake, verify the Filebase credential is available to the eventual publish runtime,
   the target bucket is correct, and IPNS ownership is proven. Request missing access now.
2. Load county data in the mandatory order: appraisal, identity baseline (official
   corporate registry, then adequate official licensing authority), permits, then
   BBB enrichment.
3. Keep `oracle_dataset_coverage` updated per `(county, source)`.
4. After each load/index refresh window, run the query-table and coverage publish path.
   For an already-published county whose coverage pointer alone needs repair, use the
   coverage-only path in
   [`reference/coverage-only-publication.md`](./reference/coverage-only-publication.md);
   it cannot accept or mutate query-table artifacts or labels.
5. Public consumers use IPFS/IPNS only. Donphan reads coverage through MCP
   `getOracleDatasetInfo`. Never point users at AWS S3.
6. Wire MCP from the **canonical published-county catalog**, not from a hardcoded county
   list in this skill:
   - call MCP `listPublishedCounties`; or
   - read `skills/use-oracle/runtime/catalog/published-counties.json`;
   - regenerate `PROPERTY_QUERY_TABLE_MAP` / `DATASET_COVERAGE_MAP` from that catalog
     (`npm run catalog:sync-mcp-json --prefix skills/use-oracle/runtime`, or equivalently
     `npm run catalog:mcp-maps --prefix skills/use-oracle/runtime` to print the maps
     without writing `mcp.json`).

Availability must be typed from the catalog (`publicationScope.level` and readiness
`unsupported` / `supported_partial` / `supported_full`). Never represent unsupported
access as zero records.

**PII publish is human-approved, then automated.** The `Publish` virtual object dry-runs
until a human POSTs the approve handler (`Publish/<county>/approve`). After approval, the
object's `tick` performs the Filebase/IPFS upload. The agent prepares, validates, and may
`--dry-run`. Do not treat publish as a manual human upload, and do not upload without the
durable approval.

## Milestone scope (this story)

**In:** Oracle agent + skill packaging; discover county sources; refresh appraisal/property,
then the identity baseline (Sunbiz legal entities plus the official DBPR licensing
snapshot), then permits, then BBB enrichment into the query DB; resolve permit contractor
identity and stamp supported company edges; validate completeness; publish the query table
and coverage; wire MCP so Donphan can query the county and qualify answers by coverage.

**Out:** NEO rewiring, on-chain indexing beyond the query table, and Elephant.xyz UI
changes.

## Rules

- Choose one stack before loading procedures.
- Drive the skills; never improvise ingestion commands a skill does not define.
- Never hardcode or print AWS account ids, secrets, or `DATABASE_URL`.
- Never skip `validate-county-readiness.py` before seed, pilot, or full ingest.
- Run the permit evidence preflight before every permit-backed decision or publication.
  Preserve indexed vs live evidence, distinguish confirmed empty from unavailable, and
  drive only immutable, bounded, source-specific repairs.
- Identity baseline first, permits second, every time. Use the official corporate
  registry first, then fail-closed official licensing-authority adequacy-or-acquire. In
  Florida, use Sunbiz companies/`document_number`, then `dbpr-license-ingest` with DBPR
  adequacy (official, loaded,
  reconciled, dated coverage of licenses, qualifier/person relationships,
  qualified-business relationships, status, and effective dates). If DBPR is inadequate,
  acquire it next; do not treat missing DBPR as a terminal recorded gap or as permission
  to harvest permits. Match a present license number deterministically; otherwise match
  company name + licensed qualifier name against the pre-populated identity records,
  unique candidate only, with DBPR qualification effective on the permit attribution date.
  Stamp `companies.company_id` onto `permit_contacts.company_id` and, only on unanimous
  contractor contacts, `property_improvements.contractor_company_id`. Never write an
  inferred license into raw `permit_contacts.license_number`, and never invent a generic
  SID. Report missing canonical license entities, license edges, or resolver provenance as
  schema gaps after loading supported tables — not as a reason to skip DBPR acquisition.
- Run until the requested scope reaches a terminal state in `continuous-ingestion.md`.
  Automatically advance successful stages, supervise durable workers, consume exact handoff
  manifests, and recover compatible stale work within its retry budget.
- Record repository/runtime/configuration/schema provenance before remote dispatch. Never
  silently run a different branch, dirty tree, stale skill copy, or mismatched checkpoint.
- Report completeness honestly. Never call a jurisdiction complete because a pilot succeeded.
- Never solve, bypass, OCR, or evade CAPTCHA.
- Preserve valid unmatched records.
- Keep reputation/context enrichment (BBB, places) separate from core permit completeness.
  The corporate and licensing registries are identity prerequisites, not enrichment.
- Drive `bbb-harvest` as a public-site category harvest unless an approved API token
  exists. Run any required browser on approved AWS-managed remote compute with US egress,
  never on the operator's machine. It is not official API coverage. Do not set
  `expected_count` from an advertised listing total without `listing_page_cap` and
  `cap_acknowledged`.
- Runtime Secrets apply at process start. Start a new AWS job/runner after adding AWS or
  Filebase keys; do not assume a running process received them.
- Mark complete only after capture, load, immutable publish, remote readback, catalog/MCP
  registration, and Donphan smoke tests all pass. If loaded data advances after freeze, mark
  publication stale and queue a replacement immutable snapshot under the continuous safe
  optimization policy; never mutate the published one.
- Every status response must use the required status report in
  [`reference/durable-orchestration.md`](./reference/durable-orchestration.md).
