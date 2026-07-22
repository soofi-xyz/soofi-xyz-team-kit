---
title: Dataset Catalog, Gateway, and Change Detection
impact: CRITICAL
tags: catalog, dataset, county-discovery, gateway, snapshot, change-detection, rate-limit, revision
---

## Dataset Catalog, Gateway, and Change Detection

Watchog can only produce fresh facts if it can reliably answer three questions on a schedule: **which counties/datasets are published now, what changed since last time, and exactly which data revision backs each number.** This requires a production data contract, not the Cursor MCP.

### The runtime is not Cursor

`donphan` reads data by calling the `elephant` MCP server that this plugin's `mcp.json` starts locally with `npx`. That works inside Cursor. It is **not** a supported server-to-server interface, and the bundled IPNS county map is a developer convenience that must not be hard-coded into a production service. A scheduled AWS runtime needs its own read path.

### Required upstream contract (Phase 1 gate)

Before building live scans, confirm both exist. If either is missing, STOP and give the human this exact ask for the Elephant data owner:

1. A production, server-to-server, **read-only** interface (documented HTTPS API, remote MCP endpoint, or approved SDK) with DEV and PROD base URLs, authentication method, and read-only credentials.
2. A **versioned dataset catalog** that lists every currently published county and lets the caller detect newly published ones. Each entry must include:
   - `countyKey` (for example `lee`, `palm-beach`) and display name + state
   - data endpoint / CID / IPNS reference
   - per-source coverage (`appraisal`, `permits`, `sunbiz`, `bbb`) with `ingestedCount`, `expectedCount`, `completionPercent`
   - `propertyCount`
   - source `firstLoadedAt` / `lastLoadedAt`
   - an **immutable `datasetRevision`** id that changes whenever the underlying data changes
3. Supported read-only **aggregate query** operations (the current example: number of properties in Lee County).
4. **Rate limits**: requests per second/minute, max concurrency, query timeout/size, and required behavior for HTTP 429/5xx.
5. A **DEV/sandbox** endpoint or fixture dataset for testing without full-volume production reads.

Prefer Oracle emitting a `DatasetPublished` event (county published/refreshed) as the primary trigger, with the recurring scan as reconciliation. A new county is eligible only after its query data **and** coverage report are published (see `use-oracle` coverage publish contract).

### ElephantDataGateway (read-only)

Implement a single typed gateway that is the only path to Elephant data. It MUST:

- **Enumerate counties from the catalog**, never from a hard-coded list or the plugin `mcp.json`.
- Snapshot per county: `propertyCount`, per-source coverage, `lastLoadedAt`, and the immutable `datasetRevision`.
- Run only **read-only aggregate queries** equivalent to Donphan's verified `queryProperties` / `getOracleDatasetInfo` contract (SELECT/CTE only; single statement; row caps). The model never issues arbitrary SQL.
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
