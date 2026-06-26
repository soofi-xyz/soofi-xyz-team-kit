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
├─ "What fields exist on class X?" / schema semantics
│   └─ listClassesByDataGroup → listPropertiesByClassName → getPropertySchema
├─ "How do I map source Y to Elephant?"
│   └─ getVerifiedScriptExamples (+ schema tools as needed)
├─ "In [city/area] …" (geo scoped)
│   └─ getOracleDatasetInfo
│   └─ findPropertiesInArea (bbox/polygon)
│   └─ getOracleProperty on hits (filter in reasoning)
├─ "Total value in [area]"
│   └─ sumPropertyValueInArea
├─ "List/count properties with [business/contractor trait]" (county-wide or geo)
│   └─ getOracleDatasetInfo
│   └─ findPropertiesInArea OR listOracleProperties (paginate)
│   └─ getOracleProperty on candidates → filter BBB/Sunbiz/permit fields
├─ "Address mismatch …"
│   └─ same fetch path → compare address fields (see consolidated-property-shape)
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
