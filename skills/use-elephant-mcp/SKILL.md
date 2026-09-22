---
name: use-elephant-mcp
description: "Explore published county property data through the Elephant MCP: scoped counts and filters, property lookups, area questions, and lexicon schema definitions. Use when answering questions about published Atlas county records. Not for ingestion."
---

# Use Elephant MCP

Call only MCP tools on server `elephant`. The server serves a local snapshot synchronized
from the global Atlas index; request handlers never fetch remote archives. The ingestion
query DB is internal: never query it, expose it, or treat it as the MCP or publication
source.

## Read first

1. [`reference/mcp-setup.md`](./reference/mcp-setup.md) — bundled server, cutover status, sync
2. [`reference/tools-and-workflows.md`](./reference/tools-and-workflows.md) — tool contract and table layout
3. [`reference/exploration-patterns.md`](./reference/exploration-patterns.md) — recipes

## Mandatory gate

1. Confirm MCP server `elephant` is connected.
2. Call `listAtlasCounties`. If the tool is absent, the bundled server has not been cut
   over to MCP 2.0 yet — report that and stop (see `mcp-setup.md`).
3. Resolve the requested `state` (two-letter code), `county`, and `dataGroup` from the
   index. Ask only when the scope cannot be inferred safely.
4. Call `getAtlasDatasetInfo` for that exact scope.
5. Stop on a connection, sync, or unpublished-scope error. Use the setup reference; do
   not bypass MCP with direct IPFS, HTTP, shell, or database access.

Every Atlas tool except `listAtlasCounties` takes `state`, `county`, and `dataGroup`.
There is no default-county workflow.

## Exploration playbook

### Discover tables

Call `getAtlasSchema` without `table` to list the tables synchronized for the scope
(one per lexicon class and relationship, plus `properties`). Call it again with `table`
to get exact columns.

### Query

Call `queryAtlas` with `sql` and `limit` (max 1000). Send exactly one read-only
`SELECT` or `WITH` statement. JOINs and CTEs are allowed; every content table is
scope-filtered server-side, so never add `state`/`county`/`data_group` predicates by
hand. Control tables, catalogs, and non-allow-listed functions are rejected. Use only
columns returned by `getAtlasSchema`.

### List and assemble properties

- `listAtlasProperties` (`limit`, `offset`) pages property CIDs for the scope.
- `getAtlasProperty` (`propertyCid`) assembles one property by walking its
  relationships; shared entities (addresses, companies, people) are included.
- Do not pass a folio or parcel identifier to `getAtlasProperty`. Both `property` and
  `parcel` carry `parcel_identifier`; look the folio up first with
  `SELECT property_cid FROM property WHERE parcel_identifier = '<folio>'` (one table, no
  join; `parcel` gives the same answer), then pass that `property_cid`.

### Area and value questions

There are no geo tools. Write the bbox JOIN in `queryAtlas`:

```sql
SELECT p.cid AS property_cid, g.latitude, g.longitude, t.property_market_value_amount
FROM property p
JOIN property_has_address pha ON pha.from_cid = p.cid
JOIN address_has_geometry ahg ON ahg.from_cid = pha.to_cid
JOIN geometry g ON g.cid = ahg.to_cid
LEFT JOIN property_has_tax pht ON pht.from_cid = p.cid
LEFT JOIN tax t ON t.cid = pht.to_cid
WHERE g.latitude BETWEEN :south AND :north
  AND g.longitude BETWEEN :west AND :east
```

Relationship tables always carry `relationship_cid, from_cid, to_cid, property_cid,
data_group_cid`; `geometry.latitude`/`geometry.longitude` are DOUBLE. Wrap in
`SELECT count(*), sum(...)` for aggregates.

### Schema semantics

Use `listClassesByDataGroup`, `listPropertiesByClassName`, and `getPropertySchema`.
Use `getVerifiedScriptExamples` only when embedding credentials are configured.

## Tool surface

Atlas: `listAtlasCounties`, `getAtlasDatasetInfo`, `getAtlasSchema`, `queryAtlas`,
`listAtlasProperties`, `getAtlasProperty`.

Lexicon: `listClassesByDataGroup`, `listPropertiesByClassName`, `getPropertySchema`,
`getVerifiedScriptExamples`.

Removed in 2.0 — do not call: HOA, permit, places, dataset-plan, area/geo, catalog,
and legacy open-data tools.

## Evidence and limits

- Report the exact state/county/data-group scope and the tables used.
- Report tools in call order and significant parameters.
- Every response carries `source` = `{ state, county, dataGroup, archiveCid, tablesCid,
  schemaCid, indexCid, syncedAt }`. Report those CIDs with every answer.
- State row limits, filters, and whether an answer is exhaustive.
- Treat absent groups, tables, columns, and rows distinctly.
- Do not infer county completeness from one data group or table.
- Do not infer legal identity from names, addresses, or enrichment alone.
- Hand ingestion or refresh requests to `use-oracle`.

## Expected output

Return the restated question, explicit scope, tools called, result, methodology, the
`source` CIDs, row/sample limits, missing data, and the exact sync or publication fix
for any blocker.
