# MCP tools and workflows

All tools are registered in
[`elephant-mcp/src/tools/registry.ts`](https://github.com/elephant-xyz/elephant-mcp/blob/main/src/tools/registry.ts).

## Tool catalog

### Oracle open data

| Tool | Purpose | Key inputs |
|------|---------|------------|
| `getOracleDatasetInfo` | Dataset provenance and freshness | _(none)_ |
| `listOracleProperties` | Paginated slim property list | `county?`, `limit` (default 50, max 500), `offset` |
| `getOracleProperty` | Full consolidated JSON from IPFS | Exactly one of: `parcelIdentifier`, `propertyId`, `cid` |
| `getPropertyPermits` | On-demand permit harvest | `parcelId`, `countyFips?` (default `12071` Lee) |

Slim list entry fields: `propertyId`, `parcelIdentifier`, `cid`, `county`, `fileSizeBytes`.

### Property SQL query (open parquet via DuckDB)

| Tool | Purpose | Key inputs |
|------|---------|------------|
| `getPropertyQuerySchema` | Lists the property query-table's ~37 columns + descriptions — **call FIRST** to learn columns | `county?` (default `lee`) |
| `queryProperties` | Runs ONE read-only `SELECT`/`WITH…SELECT` over the `properties` view (per-county Parquet read from IPFS via DuckDB) and returns rows | `county?` (default `lee`), `sql`, `limit?` |

This is the **PRIMARY path for attribute / aggregate / count / filter questions** — "how
many", by owner, by zip, by city, by value, by acreage, by material. It runs SQL over the
**OPEN IPFS parquet via MCP (NOT Neon)** — do not hand these questions off to
`use-elephant-query-db`.

Constraints on `queryProperties`:

- **Single statement, `SELECT`/CTE only.** Mutations and multi-statement SQL are rejected.
- A **row cap auto-applies** (default 100, max 1000) via `limit`.
- The queried view is always named **`properties`**.
- Use `ILIKE '%…%'` for text matching: owner (`owners_text`), city (`address_city`),
  material (`exterior_wall_material`).
- `county` must match the MCP server's `PROPERTY_QUERY_TABLE_MAP` (default `lee`).

**Data coverage varies by county and changes with each refresh** — never assume or quote a
remembered figure. The bundled MCP serves `lee`, `miami-dade`, `palm-beach`, and `orange`.
Known-stable gaps: `hoa_flag` is NULL in every county (reserved placeholder); Lee has no
acreage/material. Some scalar columns (e.g. `lot_area_sqft`, `livable_floor_area`) may be
partially or fully empty for a given county. Call `getPropertyQuerySchema` or run a live
`SELECT count(col)` to confirm a column is populated, and state "not available for this county"
rather than inventing values.

### Geo (derived index)

| Tool | Purpose | Key inputs |
|------|---------|------------|
| `findPropertiesInArea` | Properties whose centroid is inside area | Exactly one of: `bbox`, `polygon` |
| `sumPropertyValueInArea` | Sum of `current_avm_value` in area | Exactly one of: `bbox`, `polygon` |

`bbox`: `{ minLat, minLng, maxLat, maxLng }`

`polygon`: array of `{ lat, lng }` vertices (≥ 3), closed ring implied.

Requires `ORACLE_GEO_INDEX_IPNS` or `ORACLE_GEO_INDEX_CID` on the MCP server.

### Lexicon / schema

| Tool | Purpose | Key inputs |
|------|---------|------------|
| `listClassesByDataGroup` | Classes in a data group | `groupName` (e.g. `County`) |
| `listPropertiesByClassName` | Property keys on a class | `className` |
| `getPropertySchema` | Full JSON Schema for one property | `className`, `propertyName` |

### Transform examples

| Tool | Purpose | Key inputs |
|------|---------|------------|
| `getVerifiedScriptExamples` | Semantic search over verified mapping scripts | `query`, `topK?` (default 5, max 50) |

Requires embedding provider (OpenAI or Bedrock).

## Decision tree

```
User question
├─ "How many …" / by owner / by zip / by city / by value / by acreage / by material
│   (attribute · aggregate · count · filter) — PRIMARY PATH
│   └─ getPropertyQuerySchema (learn columns)
│   └─ queryProperties (ONE SELECT/CTE over the `properties` view; ILIKE for text)
│       — SQL over the OPEN IPFS parquet via MCP, NOT Neon; do not hand off to query-db
├─ "What fields exist on class X?" / schema semantics
│   └─ listClassesByDataGroup → listPropertiesByClassName → getPropertySchema
├─ "How do I map source Y to Elephant?"
│   └─ getVerifiedScriptExamples (+ schema tools as needed)
├─ "In [city/area] …" (geo scoped, bbox/polygon)
│   └─ getOracleDatasetInfo
│   └─ findPropertiesInArea (bbox/polygon)
│   └─ getOracleProperty on hits (filter in reasoning)
├─ "Total value in [area]" (geo)
│   └─ sumPropertyValueInArea
├─ "Full record for parcel/property X"
│   └─ getOracleProperty
├─ "Address mismatch …"
│   └─ getOracleProperty → compare address fields (see consolidated-property-shape)
└─ "Permits for parcel …" (missing in consolidated JSON)
    └─ getPropertyPermits → poll if status indicates harvest in progress
```

## Pagination strategy

- `listOracleProperties`: use `limit=500` and walk `offset` until you have enough candidates or
  hit a practical cap (state cap in exploration-patterns).
- Prefer **geo narrow first** when the user names a city or neighborhood — fewer
  `getOracleProperty` calls.

## Error handling

- Tool errors return MCP text content with a message — surface verbatim to the user.
- `getPropertyPermits` may return a status indicating harvest in progress; wait ~90s and retry.
- Geo tools fail clearly when geo index env is missing — point to `mcp-setup.md`.
