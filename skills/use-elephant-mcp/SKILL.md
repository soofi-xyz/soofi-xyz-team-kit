---
name: use-elephant-mcp
description: "Operating guide for exploring Elephant data through the @elephant-xyz/mcp server in Cursor: Oracle open-data properties (appraisal, permits, Sunbiz, BBB), geo filters, lexicon schemas, and verified transform examples. Use when asking natural-language questions about Lee County properties, contractors, businesses, address mismatches, or schema fields — via MCP tools only. Not for Neon SQL (use-elephant-query-db) or county ingestion (use-oracle). Triggers on: elephant mcp, explore oracle data, donphan, contractors, BBB, Sunbiz, fort myers, address mismatch, nail salon, commercial property, property schema."
---

# Use Elephant MCP

This skill governs how to **explore Elephant data through the MCP server** published as
[`@elephant-xyz/mcp`](https://github.com/elephant-xyz/elephant-mcp). The agent reads Oracle
open-data (IPFS), geo indexes, and lexicon schemas by calling MCP tools — never by shelling
out to IPFS, AWS, or ad-hoc HTTP.

Do **not** use this skill for:

- **Neon SQL** over ingested rows → [`use-elephant-query-db`](../../use-elephant-query-db/SKILL.md)
- **County ingestion / refresh** → [`use-oracle`](../../use-oracle/SKILL.md)

## Always read first

1. [`reference/mcp-setup.md`](./reference/mcp-setup.md) — Cursor MCP install, env vars, server name discovery
2. [`reference/tools-and-workflows.md`](./reference/tools-and-workflows.md) — tool catalog and decision tree
3. [`reference/exploration-patterns.md`](./reference/exploration-patterns.md) — worked patterns and limitations
4. [`reference/consolidated-property-shape.md`](./reference/consolidated-property-shape.md) — JSON paths for filtering

## Prerequisites

- **Node.js 22.18+**
- **Elephant MCP** via this plugin's bundled `mcp.json` (server name **`elephant`**). Reload
  Cursor after installing/updating the kit; confirm **`elephant`** is enabled under MCP settings.
- **Optional env** (for teammates, not hard-coded in skill text):
  - `OPENAI_API_KEY` in the shell for `getVerifiedScriptExamples`, or AWS creds for Bedrock
  - Geo index and package version are preconfigured in the plugin `mcp.json`
- **Default dataset:** Lee County, FL (reference). Confirm if the user names another county.

## MCP gate (mandatory)

Before exploring data:

1. Confirm MCP server **`elephant`** is connected (MCP panel shows tools enabled).
2. Call `getOracleDatasetInfo` on server **`elephant`**. If tools are missing or the call fails
   with a connection error, **STOP** and point to
   [`reference/mcp-setup.md`](./reference/mcp-setup.md) (reload Cursor, enable `elephant`, manual
   fallback). Do not bypass with shell, IPFS CLI, or direct CID fetches.

When calling tools in Cursor, use `CallMcpTool` with `server`: **`elephant`** and `toolName` set
to the exact registered tool name (e.g. `getOracleDatasetInfo`).

## Exploration playbook

There is **no full-text search** across all properties. Narrow geographically or paginate,
then fetch consolidated JSON and filter in reasoning.

1. **Dataset context** — `getOracleDatasetInfo` → county, `propertyCount`, freshness timestamps
2. **Geo-scoped questions** — `findPropertiesInArea` (bbox or polygon) → parcel/property IDs in
   area → `getOracleProperty` on candidates
3. **County-wide discovery** — `listOracleProperties` with pagination (`limit` max 500,
   increase `offset`) → selective `getOracleProperty`
4. **Value aggregates in area** — `sumPropertyValueInArea` when the question is AVM sum/count
   in a bbox/polygon
5. **Contractor / business quality** — `getOracleProperty` → inspect BBB blocks and Sunbiz
   registrations (see consolidated-property-shape)
6. **Address mismatches** — compare appraisal, permit, and Sunbiz address fields in consolidated
   JSON; cite field paths and normalized keys when present
7. **Missing permits** — `getPropertyPermits` (may enqueue async harvest; poll after ~90s)
8. **Schema semantics** — `listClassesByDataGroup`, `listPropertiesByClassName`,
   `getPropertySchema` when the user asks what a field means or which class owns it
9. **Transform / mapping help** — `getVerifiedScriptExamples` (requires embedding credentials)

## Non-negotiables

- **MCP tools only** for Elephant data reads in this workflow.
- Never hard-code or print API keys, AWS secrets, or IPFS credentials.
- Never claim a **full-count** answer without stating geo scope, pagination limits, and how many
  records were actually inspected.
- Report **methodology**: tools called, area/bbox used, sample size, filter rules applied.
- Hand off to `use-elephant-query-db` when the user needs SQL joins at scale over Neon.
- Hand off to `use-oracle` when the user wants to ingest or refresh source data.

## Expected output

When answering exploration questions, return:

- Restated question and inferred filters (geo, business type, quality threshold)
- MCP tools called (in order) and key parameters (bbox, offset/limit, parcel IDs sampled)
- Answer with counts or list (parcel ID, address snippet, evidence field)
- Coverage limits (e.g. "inspected 120 of ~45k properties in Fort Myers bbox")
- Gaps or blockers with exact fix (MCP not connected, missing `ORACLE_GEO_INDEX_IPNS`, etc.)
