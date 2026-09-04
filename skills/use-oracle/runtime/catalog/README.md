# Published county catalog

`published-counties.json` is this kit's bundled, canonical enumeration of Oracle county
datasets. It is a self-contained copy — this runtime never reads or fetches from a sibling
`oracle-node` checkout at run time. Add or update an entry only after its public query-table
and coverage URLs have been read back successfully.

Update it with:

```bash
npm run catalog:update --prefix skills/use-oracle/runtime -- \
  --county-key "lee" \
  --county-name "Lee" \
  --state-code "FL" \
  --county-fips "12071" \
  --query-table-url "https://..." \
  --dataset-coverage-url "https://..." \
  --updated-at "2026-07-24T00:00:00.000Z"
```

The updater reads back the public query table and coverage artifacts, verifies the coverage
county identity, validates URLs and timestamps, rejects duplicate keys/FIPS codes, and sorts
entries deterministically. Coverage is mandatory; `permitQueryTableUrl` and `placesTableUrl`
may be `null`.

Consumers should use Elephant MCP `listPublishedCounties` instead of coupling directly to
this repository path. Until elephant-mcp’s default URL is retargeted, only clients that set
`PUBLISHED_COUNTY_CATALOG_URL` (this kit’s `mcp.json`) read this file; see
[`docs/elephant-source-repos.md`](../../../../../docs/elephant-source-repos.md).

## `mcp-overlays.json` — counties outside the catalog

Some counties are published to the Elephant MCP property/permit query-table maps without (yet)
meeting the bar for the canonical catalog above — currently only **`santa-clara`**. These live
in `mcp-overlays.json`, a small, separate file with just the fields the MCP env maps need
(`queryTableUrl`, `permitQueryTableUrl`, `datasetCoverageUrl`, any of which may be `null`).
Overlay counties are **not** returned by `listPublishedCounties` and do not count toward
`DATASET_COVERAGE_MAP` unless they also carry a `datasetCoverageUrl`.

Do not add a county to `mcp-overlays.json` if it already qualifies for the full catalog above —
promote it into `published-counties.json` instead (`npm run catalog:update`).

## Regenerating the root `mcp.json` env maps

`scripts/catalog/sync-mcp-json.mjs` merges `published-counties.json` and `mcp-overlays.json`
into `PROPERTY_QUERY_TABLE_MAP`, `PERMIT_QUERY_TABLE_MAP`, and `DATASET_COVERAGE_MAP`, then
writes them directly into the repo-root `mcp.json`'s `mcpServers.elephant.env`, alongside a
`PUBLISHED_COUNTY_CATALOG_URL` pointing at this file's raw GitHub URL. It preserves every other
env key (`ORACLE_OPEN_DATA_*`, `ORACLE_GEO_INDEX_IPNS`) and the bash/npx MCP launcher untouched.

```bash
npm run catalog:sync-mcp-json --prefix skills/use-oracle/runtime
```

Run it again after any catalog or overlay change — a clean run twice in a row produces no
further diff to `mcp.json`.
