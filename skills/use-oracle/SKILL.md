---
name: use-oracle
description: "Operating guide for the Oracle public-data ingestion agent. Use when installing and driving the elephant-xyz ingestion skills to discover, ingest, validate, refresh, and publish a county's property, permit, corporate-registry, and contractor-reputation data plus its coverage snapshot. Enforces fail-closed readiness and honest completeness."
---

# Use Oracle

Oracle is the public-data ingestion agent. It does NOT contain its own ingestion code — it
**drives the existing `elephant-xyz/skills`** (`onboard-county` and its stage skills) against
**one chosen stack**, and reads results from the query DB. This skill is the operating
contract: stack selection, catalog path, readiness gate, stage map, and publish/coverage
rules.

## Always read

1. [`reference/durable-orchestration.md`](./reference/durable-orchestration.md) — core
   principles, adapter vs inventory status, CAPTCHA/login as access states, required status
   report, human-required actions, durable learning loop
2. [`reference/readiness-and-completeness.md`](./reference/readiness-and-completeness.md) —
   YAML catalog fields, parcel/permit/destination gates, reconciliation equations,
   completeness evidence, publication fail-closed, dated regression examples
3. [`../county-readiness-preflight/SKILL.md`](../county-readiness-preflight/SKILL.md) — the
   deterministic validator. `onboard-county` must run it before seed, pilot, or full ingest.

## Choose the stack first

Identify **exactly one** runtime from the current checkout **before** loading any stage
procedure. Do not warn-and-continue.

| Marker in the checkout | Stack | Load these procedures |
|---|---|---|
| `elephant-pipeline` (`docker-compose`, Restate, `docs/`) | **local** | `elephant-xyz/skills` `main`: Restate + Postgres. `bootstrap-oracle-infra` is local Docker. Filebase credentials only when publishing is in scope. |
| `oracle-node` (AWS/SQS, CDK) | **aws** | AWS profile/region, SQS seed feeder. Do not run Restate handlers. |

`elephant-xyz/skills` `main` targets **elephant-pipeline**. Use oracle-node procedures only
when the checkout **is** oracle-node.

If both markers are present, or neither, **STOP** and ask which stack this run uses. Never
run Restate procedures against an AWS repo, or AWS procedures against the local stack.

## What Oracle drives

`elephant-xyz/skills` implements the pipeline: appraisal scrape → lexicon transform → permit
harvest → Sunbiz/BBB enrichment → query DB → public Filebase/IPFS publish surfaces. Lee
County, FL is the first full implementation. Oracle is the named entry point that runs them;
it never re-implements a stage.

## Prerequisites

- Work happens in a checkout of the **chosen stack** (`elephant-pipeline` or `oracle-node`)
  with sibling repos next to it: `elephant-query-db`, `Counties-trasform-scripts`, and
  `lexicon` (optional).
- **Local stack:** Docker, Node 22+, `restate` CLI, `gh` authenticated. No cloud account
  for ingestion.
- **AWS stack:** `AWS_PROFILE` / `AWS_REGION` for the existing `elephant-oracle-node`
  account. Skills never hardcode accounts. STOP before any live AWS run if access is
  missing — discovery still does not need AWS.
- For local portal probing, a **US egress IP**.
- Install skills from the chosen checkout:

```bash
npx skills add elephant-xyz/skills --all -y
```

## Source catalog

The machine-readable county source catalog is **`elephant-pipeline/docs/<county>-sources.yaml`**.
`county-discovery` already writes it. Do **not** invent
`Counties-trasform-scripts/<county>/sources/sources.json`.

Human findings stay in `elephant-pipeline/docs/<county>-county-findings.md` and are PR'd to
`Counties-trasform-scripts/<county>/docs/` as discovery already requires.

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
| `county-permit-adapter` | Build the county permit-portal harvester (Accela template + generic path) |
| `county-ingest-run` | Deploy/start the backpressure-aware seed feeder — only after readiness PASS |
| `monitoring-county-ingestion` | Queue/invocation health, artifact counts, DB counts, ETAs |
| `sunbiz-corporate-ingest` | Florida statewide Sunbiz corporate bulk ingest + lexicon transform |
| `bbb-harvest` | BBB contractor category harvest for reputation/quality enrichment |
| `query-db-loading-matching` | Load artifacts into the query DB and cross-match by parcel id / address hash |
| `transform-v2-builder` | Author/repair county transform handler packages for elephant-cli transform v2 |

## Mandatory operating sequence

Follow this sequence for every county. Do not stage a full seed, implement against an
assumed source, or begin bulk traversal before readiness **passes the validator**. Bounded
discovery probes are permitted before readiness validation.

| Step | Action | Existing skill / artifact |
|---|---|---|
| 1 | Operator intake | `onboard-county` intake |
| 2 | Review prior findings, transforms, adapters, manifests, and checkpoints | `elephant-pipeline/docs/` plus `Counties-trasform-scripts/<county>/` |
| 3 | Bounded source discovery | `county-discovery` |
| 4 | Build the machine-readable county source catalog | `elephant-pipeline/docs/<county>-sources.yaml` |
| 5–6 | County Readiness Preflight + exceptions | `county-readiness-preflight` validator; **STOP** before seed/adapters if any gate is `BLOCKED` |
| 7–8 | Adapters + pilots | `county-permit-adapter`, `county-appraisal-onboarding`, `validate-county-transform` |
| 9–10 | Checkpointed ingest + load | `county-ingest-run`, `query-db-loading-matching` |
| 11–12 | Privacy derivatives + publish | `county-query-table-publish`, `county-open-data-publish` |
| 13 | Verify through Donphan | MCP smoke after publish (`listPublishedCounties`, `getOracleDatasetInfo`) |
| 14 | Freeze evidence and determine completeness | coverage JSON + catalog; completeness only if all eight evidence gates pass |

**Hard gate (also when the user invokes `onboard-county` directly, not only `/oracle`):**

```bash
python3 skills/use-oracle/scripts/validate-county-readiness.py \
  elephant-pipeline/docs/<county>-sources.yaml
```

Non-zero exit = STOP. Do not call `county-seed-data`, do not start a pilot, and do not
start a full `county-ingest-run`. A passing report (`overall: PASS`, `seed_allowed: true`)
is required before pilot or full ingestion.

Unreadiness, CAPTCHA, login, and custodian-only access are genuine blockers. When one
source is blocked, continue every independent safe workstream.

## How to run

- **Full county:** invoke `onboard-county`. Answer intake once. Drive discovery and update
  `docs/<county>-sources.yaml`. **Run the validator.** Only after PASS continue seed →
  adapters → pilot → full run. Example:

  > Onboard Lee County, FL with the `onboard-county` skill. Start with a ~25-parcel pilot.

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

1. Load county data through the normal source tracks: appraisal, permits, Sunbiz, BBB.
2. Keep `oracle_dataset_coverage` updated per `(county, source)`.
3. After each load/index refresh window, run the query-table and coverage publish path.
4. Public consumers use IPFS/IPNS only. Donphan reads coverage through MCP
   `getOracleDatasetInfo`. Never point users at AWS S3.
5. Wire MCP from the **canonical published-county catalog**, not from a hardcoded county
   list in this skill:
   - call MCP `listPublishedCounties`; or
   - read `oracle-node/catalog/published-counties.json`;
   - regenerate `PROPERTY_QUERY_TABLE_MAP` / `DATASET_COVERAGE_MAP` from that catalog
     (`node scripts/print-mcp-env-maps.mjs` in an `oracle-node` checkout).

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
permits, Sunbiz, BBB into the query DB; validate completeness; publish the query table and
coverage; wire MCP so Donphan can query the county and qualify answers by coverage.

**Out:** NEO rewiring, on-chain indexing beyond the query table, and Elephant.xyz UI
changes.

## Rules

- Choose one stack before loading procedures.
- Drive the skills; never improvise ingestion commands a skill does not define.
- Never hardcode or print AWS account ids, secrets, or `DATABASE_URL`.
- Never skip `validate-county-readiness.py` before seed, pilot, or full ingest.
- Report completeness honestly. Never call a jurisdiction complete because a pilot succeeded.
- Never solve, bypass, OCR, or evade CAPTCHA.
- Preserve valid unmatched records.
- Keep enrichment (Sunbiz, BBB, places) separate from core permit completeness.
- Every status response must use the required status report in
  [`reference/durable-orchestration.md`](./reference/durable-orchestration.md).
