---
title: Dataset Catalog, Gateway, and Change Detection
impact: CRITICAL
tags: catalog, dataset, county-discovery, gateway, snapshot, change-detection, rate-limit, revision
---

## Dataset Catalog, Gateway, and Change Detection

Watchog can only produce fresh facts if it can reliably answer three questions on a schedule: **which counties/datasets are published now, what changed since last time, and exactly which data revision backs each number.** This requires a production data contract, not the Cursor MCP.

### Reuse Donphan's data path, not the Cursor agent

`donphan` reads data by calling the `elephant` MCP locally. Upstream explicitly documents **no central hosted endpoint**; every interactive consumer runs the server locally. The project does, however, ship a stateless Streamable HTTP transport (`mcp-http`) plus Nitro/Vercel build support (`build:vercel`, `/mcp`, `/health`). Deploy that transport for Watchog from a pinned `main` commit (until the npm release contains current query-table tools), configure the same public query-table and coverage maps, and protect the Watchog-owned endpoint from arbitrary callers. This preserves the same verified queries and geographic tools (`findPropertiesInArea`, `sumPropertyValueInArea`) used for the currently live, Donphan-authored facts. A human may also use Donphan interactively to propose candidates; Watchog verifies and publishes them through the same gates.

### Required upstream contract (Phase 1 gate)

Before building live scans, deploy the MCP HTTP transport and verify the catalog contract:

1. Deploy `elephant-mcp`'s stateless HTTP server to Vercel and verify `/health` and `/mcp`. Pin the source commit, use Node.js 22.18+, and configure `PROPERTY_QUERY_TABLE_MAP` plus coverage/permit maps. Public data reads require no Elephant credential; add Watchog-owned endpoint protection.
2. Call `listPublishedCounties`. It is backed by Oracle's authoritative `oracle-node/catalog/published-counties.json` and returns `countyKey`, stable five-digit `countyFips`, display name, state, public query/coverage URLs, timestamps, and a `catalogRevision`. Never substitute the MCP deployment's environment maps as the county list. Only counties with both query-table and coverage artifacts qualify as published.
3. For each returned county, call `getOracleDatasetInfo(county)` to obtain `propertyCount`, per-source coverage (`ingestedCount`, `expectedCount`, `completionPercent`), and source `firstLoadedAt` / `lastLoadedAt`.
4. Derive an **immutable `datasetRevision`** that changes whenever the underlying data changes (derive it from the coverage revision / IPNS pointer or the change-bearing coverage fields when no immutable CID is returned).
5. Use supported read-only **aggregate query** operations (the current example: number of properties in Lee County) — the same `queryProperties` / geo tools Donphan uses.
6. Enforce measured rate limits: concurrency `1`, query timeouts, retry-after-aware handling for HTTP 429/5xx, and per-run caching.
7. Use a **DEV/sandbox** endpoint or fixture dataset for testing without full-volume production reads.

Prefer Oracle emitting a `DatasetPublished` event (county published/refreshed) as the primary trigger, with the recurring scan as reconciliation. A new county is eligible only after its query data **and** coverage report are published (see `use-oracle` coverage publish contract). Neon (`use-elephant-query-db`) is an optional fallback only for data the MCP does not expose.

### ElephantDataGateway (read-only, wraps Watchog's HTTP MCP)

Implement a single typed gateway that is the only path to Elephant data. It MUST:

- **Enumerate counties from the coverage feed / MCP**, never from a hard-coded list or the plugin `mcp.json`.
- Snapshot per county: `propertyCount`, per-source coverage, `lastLoadedAt`, and the immutable `datasetRevision`. **Deriving the revision (confirmed by probing):** `getOracleDatasetInfo` returns a stable `ipnsName` pointer (not a per-version hash) and `cid` may be null, so compute `datasetRevision` from the change-bearing fields — the per-source `lastLoadedAt` values plus `ingestedCount`/`completionPercent` (for example a hash of `{source, lastLoadedAt, ingestedCount}` across sources). This changes exactly when the data changes.
- Call only the **same read-only MCP tools/queries Donphan uses** — `getOracleDatasetInfo`, `queryProperties` (SELECT/CTE only; single statement; row caps), and the geo tools. The model never issues arbitrary SQL.
- For every calculation, record `{ recipeId, countyKey, queryText, parameters, canonicalResult, resultHash, dataReadAt, datasetRevision }`.
- Apply **bounded concurrency, jitter, and retry with backoff.** Concurrent Filebase metadata reads have already returned HTTP 429 — treat 429/5xx as a throttle signal, back off, and surface a non-fact outcome rather than hammering the endpoint.
- Never print or log credentials, tokens, or raw CIDs beyond what is needed for provenance.

### Snapshot and change detection

- Persist the latest snapshot per county in DynamoDB keyed by `countyKey`, storing `datasetRevision` and coverage.
- On each run, diff the new snapshot against the stored one and classify:
  - **new county** — `countyKey` not seen before
  - **refreshed source** — `datasetRevision` changed or a source `completionPercent` increased
  - **coverage change** — a source moved between partial and complete
- Only changes that satisfy a recipe's required coverage advance to candidate generation. Unchanged datasets emit `DatasetChecked` metrics and stop.
- Write snapshots idempotently (conditional write on `datasetRevision`) so a duplicate run cannot double-process the same revision.

### ✅ Correct

```typescript
// Discover counties dynamically; pin the revision used for every read.
const counties = await catalog.listPublishedCounties(); // from the versioned catalog
for (const c of counties) {
  const snap = await gateway.snapshot(c.countyKey); // { datasetRevision, coverage, propertyCount, lastLoadedAt }
  const prev = await snapshots.get(c.countyKey);
  const change = classifyChange(prev, snap);
  if (change) await snapshots.putIfRevisionChanged(c.countyKey, snap); // conditional write
}
```

### ❌ Incorrect

```typescript
// Hard-coding counties from the developer mcp.json and reading without a pinned revision.
const counties = ['lee', 'palm-beach', 'miami-dade', 'orange']; // stale, unmanaged
const count = await fetch(ipnsUrlFromMcpJson); // no revision, no rate limiting, not production-safe
```

### References

- `skills/use-elephant-mcp/SKILL.md` — the verified read contract to mirror
- `skills/use-oracle/SKILL.md` — coverage publish contract and `dataset-coverage.json`
- `skills/build-batch-workflows/rules/principle-throttling.md` — throttling architecture
