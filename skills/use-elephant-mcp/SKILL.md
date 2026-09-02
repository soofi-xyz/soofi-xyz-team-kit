---
name: use-elephant-mcp
description: "Operating guide for exploring Elephant data through the @elephant-xyz/mcp server in Cursor: Oracle open-data properties and Overture business places, including appraisal, permits, Sunbiz, BBB, categories, geo filters, lexicon schemas, and verified transforms. Use for county property questions, business-category counts/groups, restaurants, nail salons, contractors, address mismatches, or schema fields — via MCP tools only. Not for direct Neon/IPFS access or county ingestion. Triggers on: elephant mcp, explore oracle data, donphan, overture places, business category, restaurants, nail salons, contractors, BBB, Sunbiz, fort myers, address mismatch, commercial property, property schema."
---

# Use Elephant MCP

This skill governs how to **explore Elephant data through the MCP server** published as
[`@elephant-xyz/mcp`](https://github.com/elephant-xyz/elephant-mcp). The agent reads Oracle
open-data (IPFS), geo indexes, and lexicon schemas by calling MCP tools — never by shelling
out to IPFS, AWS, or ad-hoc HTTP.

Do **not** use this skill for:

- **Neon SQL** over ingested rows → [`use-elephant-query-db`](../../use-elephant-query-db/SKILL.md)
- **County ingestion / refresh** → [`use-oracle`](../../use-oracle/SKILL.md)

## Fast path (default for simple questions)

For **how many / sum / filter** questions on known columns, skip the reference tree and
coverage/schema pre-calls:

1. Discover **only** the tool you need (`GetDynamicTools` with `toolName` set — never re-list
   the full elephant namespace in the same turn).
2. Call `queryProperties` with one read-only `SELECT`/`WITH…SELECT` over `properties`
   (`COUNT`/`SUM` aggregates return one row; row cap does not matter for aggregates).
3. Answer. Do **not** call `getOracleDatasetInfo` or `getPropertyQuerySchema` first.

**Stable property columns** (safe without schema lookup): `address_city`, `address_state`,
`address_zip`, `owners_text`, `avm_value`, `parcel_identifier`, `property_id`, `latitude`,
`longitude`. Use `ILIKE` / `UPPER(TRIM(...))` for city/owner text. Unqualified “Fort Myers”
→ `FORT MYERS` only (not North Fort Myers / Fort Myers Beach unless asked).

**MCP gate (lightweight):** a successful `queryProperties`, `queryPlaces`, or
`getOracleDatasetInfo` proves the server is up. STOP only on connection / missing-tool errors
and point to [`reference/mcp-setup.md`](./reference/mcp-setup.md). Do not require a separate
coverage call before every answer.

### Latency

- Prefer single-tool discovery; never loop full-namespace `GetDynamicTools`.
- On MCP `-32001` or IPFS HTTP 429: retry **once**, then report.
- Prefer narrow filters over county-wide scans on huge counties.

## When you need the full playbook

Read these for places first-touch, unknown columns, geo without bbox, lexicon, or setup:

1. [`reference/mcp-setup.md`](./reference/mcp-setup.md) — Cursor MCP install, env vars
2. [`reference/tools-and-workflows.md`](./reference/tools-and-workflows.md) — tool catalog and decision tree
3. [`reference/exploration-patterns.md`](./reference/exploration-patterns.md) — worked patterns
4. [`reference/consolidated-property-shape.md`](./reference/consolidated-property-shape.md) — JSON paths

## Prerequisites

- **Node.js 22.18+**
- **Elephant MCP** via this plugin's bundled `mcp.json` (server name **`elephant`**), installing
  **`main`** from `github:elephant-xyz/elephant-mcp#main` until npm publishes a build with
  `queryProperties` and current Oracle open-data/geo tools. Reload Cursor after installing/updating
  the kit; confirm **`elephant`** is enabled under MCP settings.
- **Optional env** (for teammates, not hard-coded in skill text):
  - `OPENAI_API_KEY` in the shell for `getVerifiedScriptExamples`, or AWS creds for Bedrock
  - Geo index and open-data IPNS are preconfigured in the plugin `mcp.json`
- **Default dataset:** Lee County, FL (reference). Confirm if the user names another county.

When calling tools in Cursor, use `CallMcpTool` / `CallDynamicTool` with server **`elephant`**
(or namespace `plugin-soofi-xyz-team-kit-local-elephant`) and the exact tool name.

## Exploration playbook (slow path)

For **property attribute / aggregate / count / filter** on **stable columns**, use the **fast
path** above. Use the steps below for places, unknown columns, geo, coverage, or consolidated
JSON.

0. **Business places / categories** — `getPlaceQuerySchema` for the county → `queryPlaces`.
   Use `mode: "count"` for counts, `"rows"` for lists, and `"groupByPrimaryCategory"` for
   grouped primary categories. Use exact `taxonomyPrimary` for a single primary label and
   `taxonomyHierarchyMember` for roll-ups (for example, `restaurant` anywhere in the
   `/`-delimited hierarchy). Do not count taxonomy alternates. For business/co-location counts
   and lists, default `hostedService` to `"exclude"` and disclose that advisory hosted
   ATMs/kiosks/services were excluded; use `"include"` when the user requests every source row.
   Report Overture release/licence provenance and honest `completionPercent: null` because no
   authoritative all-business denominator exists. Never read the places IPFS URL or Neon
   directly; the MCP resolves the catalog-authorized parquet.
1. **Unknown property columns / material / acreage** — `getPropertyQuerySchema` first, then
   `queryProperties` with ONE read-only `SELECT`/`WITH…SELECT` over the `properties` view.
   Single statement, SELECT/CTE only; row cap auto-applies to row lists (default 100, max
   1000). This runs SQL over the **OPEN IPFS parquet via MCP (NOT Neon)** — do **not** hand
   these off to `use-elephant-query-db`. `county` defaults to `lee` and must match the MCP's
   `PROPERTY_QUERY_TABLE_MAP`. Coverage varies by county: Lee has no acreage/material (NULL);
   HOA (`hoa_flag`) is NULL everywhere — say "not available for this county" rather than
   inventing.
2. **Dataset context** — `getOracleDatasetInfo` → county, `propertyCount`, freshness (optional;
   not required before every aggregate)
3. **Geo-scoped questions** — `findPropertiesInArea` (bbox or polygon) → parcel/property IDs in
   area → `getOracleProperty` on candidates
4. **County-wide discovery** — `listOracleProperties` with pagination (`limit` max 500,
   increase `offset`) → selective `getOracleProperty`
5. **Value aggregates in area** — `sumPropertyValueInArea` when the question is AVM sum/count
   in a bbox/polygon
6. **Contractor / business quality** — `getOracleProperty` → inspect BBB blocks and Sunbiz
   registrations (see consolidated-property-shape)
7. **Address mismatches** — compare appraisal, permit, and Sunbiz address fields in consolidated
   JSON; cite field paths and normalized keys when present
8. **Missing permits** — `getPropertyPermits` (may enqueue async harvest; poll after ~90s)
9. **Schema semantics** — `listClassesByDataGroup`, `listPropertiesByClassName`,
   `getPropertySchema` when the user asks what a field means or which class owns it
10. **Transform / mapping help** — `getVerifiedScriptExamples` (requires embedding credentials)

## Non-negotiables

- **MCP tools only** for Elephant data reads in this workflow.
- Never access places parquet/index/NOTICE through direct IPFS/HTTP or query Neon from Donphan.
- Never hard-code or print API keys, AWS secrets, or IPFS credentials.
- Never claim a **full-count** answer without stating geo/city scope and filter rules.
- Open-data attribute/aggregate/filter SQL runs here via `queryProperties` (open IPFS parquet,
  not Neon) — only hand off to `use-elephant-query-db` for Neon-only rows/joins not in the parquet.
- Overture places rows/counts/groups run through structured `queryPlaces`, not `queryProperties`.
- Hand off to `use-oracle` when the user wants to ingest or refresh source data.

## Expected output

For simple aggregates: lead with the number, then county + filters (+ valuation field).

For deeper exploration, also return:

- Restated question and inferred filters (geo, business type, quality threshold)
- Key MCP tools and parameters when relevant (bbox, offset/limit, parcel IDs sampled)
- Coverage limits (e.g. "inspected 120 of ~45k properties in Fort Myers bbox")
- Gaps or blockers with exact fix (MCP not connected, missing `ORACLE_GEO_INDEX_IPNS`, etc.)
