---
name: use-oracle
description: "Operating guide for the Oracle public-data ingestion agent: install and drive the elephant-xyz/skills (onboard-county + stage skills) against the oracle-node pipeline to discover, ingest, validate, and refresh county property/permit plus Sunbiz/BBB data into the Neon query DB. Covers the oracle-node checkout layout, sibling repos, AWS_PROFILE/AWS_REGION setup, the stage-skill map, and the milestone scope boundary (Lee County, four sources, query DB; IPFS/indexing/MCP/NEO out). Triggers on: oracle, onboard county, ingest county data, refresh Lee County, appraisal/permit/Sunbiz/BBB ingestion, oracle-node, county-discovery."
---

# Use Oracle

Oracle is the public-data ingestion agent. It does NOT contain its own ingestion code — it
**drives the existing `elephant-xyz/skills`** (the `onboard-county` orchestrator and its stage
skills) against the `oracle-node` pipeline, and reads results from the Neon query DB. This skill
is the operating contract: where the work happens, how to install the skills, the stage map, and
the milestone scope boundary.

## What Oracle drives

`elephant-xyz/skills` implements the pipeline: appraisal scrape → lexicon transform → permit
harvest → Sunbiz/BBB enrichment → Neon query DB. Lee County, FL is the first full implementation;
the skills generalize it to any county. Oracle is the named entry point that runs them; it never
re-implements a stage.

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

## Stage-skill map

| Skill | Purpose |
|---|---|
| `onboard-county` | Orchestrator: operator intake, then sequences every stage below for a county |
| `bootstrap-oracle-infra` | Verify/bootstrap AWS stacks, buckets, secrets, Neon DB prerequisites |
| `county-discovery` | Research a county: appraiser portal, permit vendor, parcel format, anti-bot posture (no AWS) |
| `county-seed-data` | Produce and stage the parcel seed CSV |
| `county-appraisal-onboarding` | Browser flow, per-county prepare queue, transform-script wiring |
| `validate-county-transform` | Prove transforms extract 100% of available data across variability |
| `county-permit-adapter` | Build the county permit-portal harvester (Accela template + generic path) |
| `county-ingest-run` | Deploy, start the backpressure-aware seed feeder, run end-to-end |
| `monitoring-county-ingestion` | Queue health, S3 artifact counts, Neon counts, ETAs for any county |
| `sunbiz-corporate-ingest` | Florida statewide Sunbiz corporate bulk ingest + lexicon transform |
| `bbb-harvest` | BBB contractor category harvest for reputation/quality enrichment |
| `query-db-loading-matching` | Load artifacts into Neon and cross-match by parcel id / address hash |
| `transform-v2-builder` | Author/repair county transform handler packages for elephant-cli transform v2 |

## How to run

- **Full county (default path):** invoke `onboard-county`. It begins with a one-time operator
  intake (AWS profile/region, seed data, existing assets, sources, additional sources, scope,
  target DB). Answer once; it then runs all stages autonomously, interrupting only for genuine
  blockers. Example prompt:

  > Onboard Lee County, FL with the `onboard-county` skill. Start with a ~25-parcel pilot.

- **Single stage:** invoke a stage skill directly, e.g. `Run county-discovery for Lee County, FL`
  or `Use monitoring-county-ingestion to report Lee County status`.

## Read the query DB

To read ingested data (parcels, permits, Sunbiz companies, BBB, addresses), use the
**`use-elephant-query-db`** skill — the Neon resource is `elephant-query-db`; read credentials
from `DATABASE_URL`; never hardcode or print them.

## Milestone scope (this story)

**In:** Oracle agent + skill packaging; discover Lee County sources; refresh all four source
categories (appraisal/property, permits, Sunbiz, BBB) into the local Neon query DB; validate
completeness against source availability.

**Out (separate story `1215644141347714` — "Oracle Open Data Index and MCP Layer"):** public
IPFS publishing, on-chain / blockchain-style indexing, MCP exposure of Oracle data, NEO rewiring,
and any Elephant.xyz UI. Do not build these here; just do not foreclose them — data lands in S3 +
Neon in a structure that story builds on.

## Rules

- Drive the skills; never improvise ingestion commands a skill does not define.
- Never hardcode or print AWS account ids, secrets, or `DATABASE_URL`.
- Report completeness honestly — name gaps; never claim a refresh not verified against the source.
