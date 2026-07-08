---
name: use-oracle
description: "Operating guide for the Oracle public-data ingestion agent: install and drive the elephant-xyz/skills (onboard-county + stage skills) against the oracle-node pipeline to discover, ingest, validate, refresh, and publish county property/permit plus Sunbiz/BBB data into the Neon query DB, then index via county-query-table-publish. Covers the oracle-node checkout layout, sibling repos, AWS_PROFILE/AWS_REGION setup, the stage-skill map, and milestone scope. Triggers on: oracle, onboard county, ingest county data, refresh Lee County, Miami-Dade, appraisal/permit/Sunbiz/BBB ingestion, oracle-node, county-discovery, query-table publish."
---

# Use Oracle

Oracle is the public-data ingestion agent. It does NOT contain its own ingestion code — it
**drives the existing `elephant-xyz/skills`** (the `onboard-county` orchestrator and its stage
skills) against the `oracle-node` pipeline, and reads results from the Neon query DB. This skill
is the operating contract: where the work happens, how to install the skills, the stage map, and
the milestone scope boundary.

## What Oracle drives

`elephant-xyz/skills` implements the pipeline: appraisal scrape → lexicon transform → permit
harvest → Sunbiz/BBB enrichment → Neon query DB → open-data publish → query-table index.
**Lee County, FL** is the first full reference; **Miami-Dade County, FL** is the second full
county. Oracle is the named entry point that runs the skills; it never re-implements a stage.
Point-in-time counts live in each county's `oracle-node/docs/<county>-county-findings.md`, not
here — always reconcile counts live against the source at run time.

## Prerequisites

- Work happens in a checkout of **`oracle-node`** with sibling repos next to it:
  `elephant-query-db`, `Counties-trasform-scripts`, and `lexicon` (optional). The skills assume
  this layout.
- **AWS**: an `AWS_PROFILE` with access to the target account (the existing `elephant-oracle-node`
  stack, or permission to deploy one) and `AWS_REGION` set. Skills never hardcode accounts.
- `gh` authenticated, Node 22+, and — for local portal probing — a **US egress IP** (many county
  portals geo-block; use a VPN/proxy if outside the US).
- If AWS access has not been granted yet, you can still run **`county-discovery`** and dry
  planning (no AWS). STOP before any deploy/ingest run and report that AWS access is required.

## Install the skills

Run from the `oracle-node` checkout (skills land in `./.agents/skills/` and are picked up by
Cursor, Claude Code, Codex, Amp):

```bash
npx skills add elephant-xyz/skills --all -y
```

(or `--skill onboard-county` for just the orchestrator.)

County-specific findings docs live in `oracle-node/docs/` — e.g. `lee-county-findings.md`,
`palm-beach-county-findings.md`, `miami-dade-county-findings.md` + matching `*-sources.yaml`.

## Stage-skill map

| Skill | Purpose |
|---|---|
| `onboard-county` | Orchestrator: operator intake, then sequences every stage below for a county |
| `bootstrap-oracle-infra` | Verify/bootstrap AWS stacks, buckets, secrets, Neon DB prerequisites |
| `county-discovery` | Research a county: appraiser portal, permit vendor, parcel format, anti-bot posture (no AWS) |
| `county-seed-data` | Produce and stage the parcel seed CSV |
| `county-appraisal-onboarding` | Browser flow or plain-HTTP fetcher, per-county prepare queue, transform-script wiring |
| `validate-county-transform` | Prove transforms extract 100% of available data across variability |
| `county-permit-adapter` | Build the county permit-portal harvester (Accela template + generic path) |
| `county-ingest-run` | Deploy, start the backpressure-aware seed feeder, run end-to-end |
| `monitoring-county-ingestion` | Queue health, S3 artifact counts, Neon counts, ETAs for any county |
| `sunbiz-corporate-ingest` | Florida statewide Sunbiz corporate bulk ingest + lexicon transform |
| `bbb-harvest` | BBB contractor category harvest for reputation/quality enrichment |
| `query-db-loading-matching` | Load artifacts into Neon and cross-match by parcel id / address hash |
| `county-open-data-publish` | Property consolidation export → Filebase IPFS/IPNS (`getOracleProperty`) |
| `county-query-table-publish` | Flat query-table Parquet → IPFS/IPNS → `PROPERTY_QUERY_TABLE_MAP` (donphan SQL) |
| `deploy-open-data-mcp` | Deploy / verify the `elephant` MCP server |
| `transform-v2-builder` | Author/repair county transform handler packages for elephant-cli transform v2 |

## How to run

- **Full county (default path):** invoke `onboard-county`. It begins with a one-time operator
  intake (AWS profile/region, seed data, existing assets, sources, additional sources, scope,
  target DB). Answer once; it then runs all stages autonomously, interrupting only for genuine
  blockers. Examples:

  > Onboard Lee County, FL with the `onboard-county` skill. Start with a ~25-parcel pilot.

  > Onboard Miami-Dade County, FL. Appraisal is loaded; run query-table publish + MCP smoke.

- **Single stage:** invoke a stage skill directly, e.g. `Run county-discovery for Lee County, FL`
  or `Use monitoring-county-ingestion to report Miami-Dade status`.

## Read the query DB

To read ingested data (parcels, permits, Sunbiz companies, BBB, addresses), use the
**`use-elephant-query-db`** skill — the Neon resource is `elephant-query-db`; read credentials
from `DATABASE_URL`; never hardcode or print them.

## Milestone scope

**In:** Discover county sources; refresh all four source categories (appraisal/property, permits,
Sunbiz, BBB) into the Neon query DB; validate completeness against source availability; publish
the query-table Parquet to IPFS and wire it into the bundled `elephant` MCP so **donphan** can
SQL-query the county (`county-query-table-publish`).

**Human-run:** uploading PII to public IPFS (query table + open-data consolidation) — the agent
prepares, validates, and `--dry-run`s; a human runs the actual Filebase upload.

**Separate stories:** NEO UI rewiring beyond query-table CIDs; on-chain indexing beyond IPFS.

## Rules

- Drive the skills; never improvise ingestion commands a skill does not define.
- Never hardcode or print AWS account ids, secrets, or `DATABASE_URL`.
- Report completeness honestly — name gaps; never claim a refresh not verified against the source.
- Validate BY FOLIO (`request_identifier`), never normalized `parcel_identifier` alone.
- County slug for MCP maps: lowercase hyphen (`miami-dade`, `palm-beach`, `lee`).
