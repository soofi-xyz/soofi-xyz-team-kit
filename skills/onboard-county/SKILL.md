---
name: onboard-county
description: "Orchestrate end-to-end onboarding of a new US county into the elephant durable-workflow ingestion pipeline - starting with a mandatory operator intake (local stack, seed data, sources, scope), then sequencing discovery, source feasibility, seed data, appraisal, transform validation, permit adapter, run, and enrichment stages. Use when asked to onboard, ingest, or \"do the same as Lee County\" for a new county, or when unsure which county skill applies."
metadata: {"author":"elephant-xyz"}
---
# Onboard County

End-to-end recipe for replicating the Lee County, FL ingestion for any county. Each stage
has a dedicated skill — read the stage skill before executing that stage. Work happens in
the bundled runtime at `skills/use-oracle/runtime` with sibling repos `elephant-query-db`,
`Counties-trasform-scripts`, and `lexicon`. Whenever a stage requires writing or
modifying services, `durable-workflow-builder` is the reference for patterns.

## Intake — REQUIRED before doing anything

Do NOT run commands, scrape, or modify files until the operator has answered the intake
questions and confirmed the plan. Ask (in one batch, multiple-choice where the tooling
supports it):

1. **Local stack** — is the stack up (Restate + Postgres, services registered)?
   If unsure, `bootstrap-oracle-infra` verifies and bootstraps it.
2. **County + state** — which county, and what county key (e.g. `lee`, `palm-beach`)?
   The canonical county slug is lowercase-hyphenated everywhere (workflow keys, artifact
   paths, IPNS labels); underscore variants exist ONLY inside DB keys like
   `source_system` (`<county>_appraiser`, underscores) and env-var names (uppercase
   underscores) — see the slug-mismatch trap in `county-query-table-publish`.
3. **Seed data** — do you already have a parcel list / seed CSV (local file or staged
   at `data/seeds/<county>.csv`)? If not, do you know the county's bulk parcel-roll source,
   or should I research one?
4. **Sources & Compute Execution Mode** — which appraiser portal and permit vendor, or should discovery determine
   them? Any sources to explicitly avoid? Sunbiz corporate enrichment (FL) and BBB
   contractor enrichment: yes/no? Other candidates (tax collector, recorder, GIS, code
   enforcement) are added scope with their own harvest/transform plan; operator interest
   only puts a source into discovery — bulk acquisition still requires the feasibility
   check below.
   - **Compute Strategy (Local vs Cloud)**: For long-running deep scraping (e.g. Accela deep detail, 100k+ pages),
     does the operator prefer:
     - **Option A: Local Warm Worker Pool** (Zero AWS compute cost, single-IP rate-limited, persistent Node child processes).
     - **Option B: Distributed AWS Lambda Harvester** (Multi-IP egress bypassing single-IP throttling, high throughput, automated cost tracking with `--maxCost` budget caps, self-healing in-flight retry buffer, and end-of-stream dead-letter sweeps).
     
     *Interactive AWS Credential Setup & Verification (When Option B is selected)*:
     1. **Probe Active Identity**: Run `aws sts get-caller-identity` to check for active credentials.
        - If active: Print `Account ID`, `ARN`, and active `AWS_REGION` and ask operator to confirm.
        - If unauthenticated: Provide a frictionless 3-option setup walkthrough:
          - *Method 1 (CLI / SSO)*: `aws configure` or `aws sso login --profile <name>`
          - *Method 2 (Named Profile)*: `export AWS_PROFILE=<name>`
          - *Method 3 (Env vars / .env)*: `export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1`
     2. **Pre-flight Check**: Verify Lambda invoke and S3 read/write permissions for the target deployment.
     3. **Zero-Blocker Fallback**: If the operator chooses not to configure AWS, automatically fall back to **Option A (Local Warm Worker Pool)**.
5. **Scope & Publishing Pathway** — pilot (~25 parcels) then full county, or pilot only? Commercial-first
   prioritization?
   - **Publishing Pathway**:
     - **Option 1: Direct DuckDB / Parquet Consolidation** (Recommended for fast publishing: in-process DuckDB/Parquet export with in-memory multi-source joins in ~15 mins, zero PostgreSQL bulk load overhead).
     - **Option 2: PostgreSQL Warehouse Load** (Loads into Neon/Postgres relational tables using UNLOGGED staging tables and predicate pushdown in ~1-2 hours).
6. **Live Telemetry & Dashboard** — Start the out-of-process 9-stage lifecycle dashboard (`node scripts/<county>/serve-dashboard.mjs --port=3888`) for real-time rolling-window throughput and ETA tracking without CPU overhead.
7. **US egress** — running from outside the US? County portals geo-block; a US VPN/proxy
   is required before any local scraping.
8. **Database** — local Postgres from the stack (default), or a different
   `DATABASE_URL`?
9. **Existing assets** — prior transform scripts, browser flows, or findings docs for
   this county? (Check `Counties-trasform-scripts` and the `skills/use-oracle/runtime`
   `transforms/`/`flows/`/`docs/` dirs, then confirm findings with the operator before
   redoing work.)
10. **Publish/serve scope** — is public publishing in scope for this county? If yes: do
   Filebase credentials exist, and do the two per-county bucket/IPNS labels exist or need
   creating (`county-open-data-publish` / `county-query-table-publish`)? Where will the
   MCP be deployed (`deploy-open-data-mcp`)?

Restate the answers as a short written plan (stages, county key, job-id prefix, sources),
then execute it end-to-end autonomously. Do NOT pause for per-stage approvals or
"shall I proceed?" check-ins — the intake answers ARE the approval. Interrupt the run
only when there is a genuine question: missing information the intake didn't cover, an
ambiguous decision with real trade-offs, or a blocker you cannot resolve (credentials,
network, repeated failures). A source whose full-download estimate exceeds 48 hours is a
genuine question: ask whether to download it anyway, ingest it into the query DB only, or
retrieve it at runtime from the owning app — and if runtime retrieval, which app owns the
lookup and what API, cache, latency, and failure behavior it needs. Report progress as
you go; batch questions when possible.

## Target outcome

The county runs locally under the durable workflow stack: every parcel's appraisal data
scraped and transformed to lexicon, commercial/industrial parcels enriched with permit
history, all loaded into Postgres and joinable with Sunbiz/BBB enrichment — findings and
scripts PR'd to `Counties-trasform-scripts`, and the reconciled data published to IPFS
behind the county's IPNS name and served via the open-data MCP when publishing is in
scope (per the intake's publish-scope answer).

## Stage checklist

Track progress in the county's findings doc (PR'd to `Counties-trasform-scripts`).

1. **Infra** — `bootstrap-oracle-infra`: verify Docker stack, data directories, DB
   migrations, service registration. Bootstrap anything missing before county work starts.
2. **Discovery** — `county-discovery`: appraiser portal, permit vendor, parcel id
   formats, usage-type vocabulary, bulk sources, anti-bot posture, source performance,
   safe concurrency, bulk-ingest vs runtime-retrieval recommendations. Output: findings
   doc + sample captures.
3. **Seed** — `county-seed-data`: parcel roll → `data/seeds/<county>.csv`.
4. **Appraisal** — `county-appraisal-onboarding`: browser flow, `Parcel.process` wiring,
   transform scripts (reuse from Counties-trasform-scripts when present), eligibility
   usage-type mapping. Single-parcel smoke test through the workflow. Service changes:
   see `durable-workflow-builder`.
5. **Transform validation** — `validate-county-transform`: 10-20 diverse parcels; prove
   100% field coverage vs raw captures; log lexicon gaps. Gate: do not scale before this
   passes. (Authoring new handlers: `transform-v2-builder`.)
6. **Permit adapter** — `county-permit-adapter`: per-vendor module in `PermitHarvest`,
   local tests, single-parcel smoke test. Service changes: see
   `durable-workflow-builder`.
7. **Pilot run** — `county-ingest-run` §pilot: ~25 parcels end-to-end, verify every
   artifact class plus DB rows, including residential-skip and permit-less paths. Apply
   the 48-hour feasibility gate before committing to full acquisition.
8. **Full run & Warm Worker Pool** — `county-ingest-run`: start the `CountyIngest` feeder or
   streamed `TransformPool` worker pool (pre-compiles Node VM, Cheerio, and transforms to
   avoid subprocess spawning overhead; stream parcel seed rows with async generators to prevent
   heap memory exhaustion). Monitor continuously with the 9-stage lifecycle dashboard (`monitoring-county-ingestion`).
9. **Permit Deep Enrichment & Municipal Adapters** — `county-permit-adapter`: classify trades (roofing,
   HVAC, solar, pool, plumbing), route municipal portals (Accela, Click2Gov, MaintStar), and run
   either local warm workers or AWS Lambda distributed scraping with self-healing retry buffers.
10. **Multi-Source Enrichment** — `sunbiz-corporate-ingest` (FL counties), `bbb-harvest` (multi-trade:
   Roofing, HVAC, Solar), and `overture-places-ingest` (Census TIGER spatial boundary clipping).
11. **Consolidation & Reconcile** — Choose Pathway:
    - **Fast Direct Parquet Export** (`export-<county>-direct-parquet.ts`): build in-memory permit/BBB/Sunbiz
      indexes and write validated Parquet directly in ~15 mins.
    - **Postgres Bulk Loader** (`run-<county>-appraisal-bulk-load.ts`): unlogged staging tables, post-COPY
      indexing, and CTE predicate pushdown.

Stages 12–14 are conditional — run them only **when publishing is in scope** (the
intake's publish-scope answer). When publishing is excluded, the run completes here,
after query-DB reconciliation and the artifact/code handoff.

12. **Publish open data** *(when publishing is in scope)* — `county-open-data-publish`: export the reconciled county →
    1-file-per-property + sharded index → the county's OWN Filebase bucket → re-point its
    IPNS name. PII publish is gated: the loop dry-runs until a human POSTs the approve
    handler on the county's `Publish` object
    (`curl localhost:8080/restate/call/Publish/<county>/approve --json '{}'`).
    Verify published index CID == export index CID and correct `propertyCount` before
    declaring done.
13. **Index & publish query table** *(when publishing is in scope)* — `county-query-table-publish`: export the flat
    per-property query-table Parquet, pass the validation GATE (parquet rows == distinct
    folio, 0 dup/null folios), publish to the county's OWN IPNS (configure `SET unsafe_disable_etag_checks = true;`
    for DuckDB HTTPFS range read compatibility), wire the MCP's `PROPERTY_QUERY_TABLE_MAP`.
14. **Serve via MCP → NEO** *(when publishing is in scope)* — `deploy-open-data-mcp`: add the county's IPNS name to the
    MCP's `ORACLE_OPEN_DATA_IPNS_MAP`, restart the local MCP (or redeploy the hosted
    MCP) after changing environment variables, confirm NEO renders the county.

## Persist artifacts — commit + PR, nothing lives only on disk

Everything county- or data-source-specific that you create — findings docs, sample
captures inventory, transform scripts, harvest scripts, flow JSON, mapping notes — must
be committed and pushed as you go, not at the end:

- **Transform scripts, county scripts, findings/docs** → branch + PR against
  `github.com/elephant-xyz/Counties-trasform-scripts`, under the county folder
  (`<county>/scripts/`, `<county>/docs/`). Source-specific work not tied to one county
  (Sunbiz, BBB) goes in a source-named folder there too.
- **Pipeline services** (feeder, permit adapters, publish wiring) live in your
  `skills/use-oracle/runtime` checkout; keep them under version control there.

Open the PR with `gh pr create` as soon as a stage's artifacts are complete — one PR per
stage or logical unit is fine. Never commit scraped data, secrets, or large captures;
samples go in the PR only if small (<1 MB), otherwise document their `data/artifacts/…`
path.
Record each PR URL in the findings doc.

## Ground rules (learned from the Lee run)

- Extract as much data as possible — raw HTML always captured; unmapped fields preserved
  in `source_payload`; lexicon gaps logged, never dropped.
- Input of record is the seed CSV; never re-derive work from the query DB.
- Everything idempotent: deterministic artifact keys, skip-existing checks, journaled
  feeder offset, `ON CONFLICT` merges. Resume = resume the invocation.
- Never dump a whole county at once: the `CountyIngest` feeder keeps a bounded sliding
  window of parcels in flight.
- Be gentle with county portals: low permit concurrency (start at 2; Accela degrades
  above ~4), stepwise ramp-up with burn-in, back off on timeouts.
- Before acquiring any source at full scale, benchmark representative records and
  estimate total elapsed time. Above 48 hours: pause for the operator decision —
  download / ingest-only / runtime retrieval from the owning app.
- Pilot before full: never start the full feeder until the pilot's artifacts and DB rows
  verify clean.
- Geo-blocking: when any source returns blocked/403/blank pages, check
  `curl -s ipinfo.io/country` first; if not `US`, get a US VPN/proxy before debugging
  anything else.
- Prioritize commercial properties when asked: sort the seed CSV; the eligibility branch
  already limits permit harvest to commercial/industrial usage types.
