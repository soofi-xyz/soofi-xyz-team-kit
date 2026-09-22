# MCP 2.0 tools and workflows

## Scope arguments

Every Atlas tool except `listAtlasCounties` requires:

- `state` — two-letter state code (for example `FL`)
- `county` — county slug as listed in the Atlas index
- `dataGroup` — data-group name as listed for that county

## Atlas tools

### `listAtlasCounties`

Inputs: none. Returns the accepted index CID, `generated_from`, `synced_at`, and the
counties with their data groups and per-group CIDs. Use it as the only discovery surface.

### `getAtlasDatasetInfo`

Inputs: scope. Returns the synchronized tables for the scope with row counts and the
publication provenance (`source`).

### `getAtlasSchema`

Inputs: scope, optional `table`. Without `table`, returns the table catalog for the scope.
With `table`, returns that table's columns. Call it before every query.

### `queryAtlas`

Inputs: scope, `sql`, optional `limit` (default and maximum 1000).

- Exactly one read-only `SELECT` or `WITH` statement.
- JOINs and CTEs are allowed.
- Every content table is filtered to the scope server-side; do not add scope predicates.
- Control tables, catalogs, multiple statements, mutations, file access, extension
  operations, and functions outside the allow-list are rejected.

Example:

```sql
SELECT p.cid AS property_cid, p.parcel_identifier
FROM property p
WHERE p.parcel_identifier = '1605480000'
```

### `listAtlasProperties`

Inputs: scope, optional `limit` and `offset`. Returns property CIDs for the scope with a
total count.

### `getAtlasProperty`

Inputs: scope, `propertyCid`. Assembles one property by walking its relationships from
the `property` row outward; shared entities reachable through relationships (addresses,
companies, people, geometry, tax, …) are included. Do not pass a folio or parcel id.

## Lexicon tools

- `listClassesByDataGroup` — input `groupName`
- `listPropertiesByClassName` — input `className`
- `getPropertySchema` — inputs `className`, `propertyName`
- `getVerifiedScriptExamples` — inputs `query`, optional `topK`

## Response provenance

Every Atlas response carries:

```jsonc
{
  "source": {
    "state": "FL",
    "county": "duval",
    "dataGroup": "county",
    "archiveCid": "...",
    "tablesCid": "...",
    "schemaCid": "...",
    "indexCid": "...",
    "syncedAt": "..."
  }
}
```

Report these CIDs with every answer; they identify the accepted publication revision.

## Synchronized table layout

`npx -y @elephant-xyz/mcp@2 sync` loads each published data group into:

- one table per lexicon class, named as in the archive (`property`, `address`,
  `geometry`, `tax`, `company`, …), keyed by `(state, county, data_group, cid)`;
- one table per relationship, named as in the archive (`property_has_address`,
  `address_has_geometry`, `property_has_tax`, …), keyed by
  `(state, county, data_group, relationship_cid)`, with the two endpoint CID columns
  (the examples here call them `from_cid`/`to_cid`; confirm with `getAtlasSchema`);
- `properties`, keyed by `(state, county, data_group, property_cid)`, with one column per
  data-group schema CID recording which group roots the property participates in.

Discover the exact table and column names with `getAtlasSchema`; do not assume a fixed
set. Relationship tables are how you join classes; verify their endpoint column names
before writing a JOIN.

## Removed tools

MCP 2.0 removed all HOA, permit, places, dataset-plan, and area/geo tools. Permit, HOA,
and places data are ordinary classes and relationships in their data groups — query them
with `queryAtlas`. Area questions are the bbox JOIN below.

## Area query recipe

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

For totals: `SELECT count(DISTINCT p.cid), sum(t.property_market_value_amount)` over the
same joins. Point-in-bbox filtering uses the geometry point; state the bbox and the row
limit in the answer.

## Decision workflow

```text
question
├─ discover states/counties/groups
│  └─ listAtlasCounties
├─ dataset provenance/tables
│  └─ getAtlasDatasetInfo
├─ count/filter/aggregate, joins across classes
│  └─ getAtlasSchema → queryAtlas
├─ find a property by folio or another field
│  └─ getAtlasSchema → queryAtlas on property → getAtlasProperty
├─ page property CIDs
│  └─ listAtlasProperties
├─ area/value question
│  └─ getAtlasSchema → queryAtlas bbox JOIN
├─ field semantics
│  └─ lexicon tools
└─ transform example
   └─ getVerifiedScriptExamples
```

## Error handling

- Treat unpublished scope, missing table, and missing column as different errors.
- On sync failure, report the accepted index state and gateway error; do not fall back
  to direct IPFS or the ingestion query DB.
- On row-cap truncation, narrow the query or paginate by deterministic fields.
- Treat empty rows as empty only within the exact scope and filter used.
