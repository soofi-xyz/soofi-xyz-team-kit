# MCP 2.0 tools and workflows

## Atlas SQL tools

### `listPublishedCounties`

List counties and data groups in the accepted Atlas SQL snapshot. Inputs: none.

Use this as the authoritative discovery surface. Record `indexCid` and `syncedAt`.

### `getOracleDatasetInfo`

Return synchronized tables and publication provenance.

Required inputs:

- `county`
- `dataGroup`

### `listOracleProperties`

List property CIDs and roots for one scope.

Required inputs:

- `county`
- `dataGroup`

Optional inputs: `limit` up to 500 and `offset`.

### `getOracleProperty`

Reconstruct roots, normalized class rows, and relationship rows for one property.

Required inputs:

- `county`
- `dataGroup`
- exactly one of `propertyCid` or compatibility alias `cid`

Do not pass a folio or parcel identifier.

### `getPropertyQuerySchema`

List synchronized normalized tables or describe one selected table.

Required inputs:

- `county`
- `dataGroup`

Optional input: `table`.

Call once without `table`, then again with the chosen table.

### `queryProperties`

Run one scoped read-only query over a selected normalized table.

Required inputs:

- `county`
- `dataGroup`
- `table`
- `sql`

Optional input: `limit`, maximum 1000.

The selected table appears as logical relation `properties` inside SQL. Require exactly
one `FROM properties`. CTEs, JOINs, mutations, multiple statements, file access, and
extension operations are rejected.

Example:

```sql
SELECT property_cid, parcel_identifier
FROM properties
WHERE parcel_identifier = '1605480000'
```

Use only columns returned for the selected table.

### `findPropertiesInArea`

Return rows inside one bounding box or polygon.

Required inputs:

- `county`
- `dataGroup`
- `table`
- exactly one of `bbox` or `polygon`

Optional column inputs:

- `latitudeColumn`
- `longitudeColumn`
- `parcelColumn`
- `valueColumn`

Verify column names first. The default names may not exist in every normalized class.

### `sumPropertyValueInArea`

Use the same scope and column contract as `findPropertiesInArea`; return count and sum.

## Lexicon tools

- `listClassesByDataGroup` — input `groupName`
- `listPropertiesByClassName` — input `className`
- `getPropertySchema` — inputs `className`, `propertyName`
- `getVerifiedScriptExamples` — inputs `query`, optional `topK`

## Decision workflow

```text
question
├─ discover counties/groups
│  └─ listPublishedCounties
├─ dataset provenance/tables
│  └─ getOracleDatasetInfo
├─ count/filter/aggregate one normalized class or relationship
│  └─ getPropertyQuerySchema → queryProperties
├─ find a property by folio or another field
│  └─ schema → query table for property_cid → getOracleProperty
├─ list property roots
│  └─ listOracleProperties
├─ geo/value area question
│  └─ schema → findPropertiesInArea or sumPropertyValueInArea
├─ field semantics
│  └─ lexicon tools
└─ transform example
   └─ getVerifiedScriptExamples
```

## Error handling

- Treat unpublished county/group, missing table, and missing column as different errors.
- On sync failure, report the accepted index state and gateway error; do not use direct
  IPFS or Query DB fallback.
- On row-cap truncation, narrow the query or paginate by deterministic fields.
- If a relationship requires a JOIN, query each relevant normalized table separately and
  join bounded results in reasoning by CIDs. The SQL tool itself forbids JOINs.
- Treat empty rows as empty only within the exact county/data-group/table/filter scope.
