---
title: Dataset Catalog, Gateway, and Change Detection
impact: CRITICAL
tags: catalog, dataset, county-discovery, gateway, snapshot, change-detection, rate-limit, revision
---

## Dataset Catalog, Gateway, and Change Detection

Watchog can only produce fresh facts if it can reliably answer three questions on a schedule: **which counties/datasets are published now, what changed since last time, and exactly which data revision backs each number.** This requires a production data contract, not the Cursor MCP.

### Reuse Donphan's data path, not the Cursor agent

`donphan` reads data by calling the `elephant` MCP. This plugin's `mcp.json` starts that MCP locally with `npx` for Cursor, but a **production, Vercel-hosted Elephant MCP also exists** (the bundled config "matches prod Vercel MCP"). The scheduled service calls that **same hosted MCP** with the **same verified queries**, so Watchog's facts stay consistent with the currently live, Donphan-authored facts and keep Donphan's geographic tools (`findPropertiesInArea`, `sumPropertyValueInArea`) that the Neon query DB lacks. Do not depend on the local developer `mcp.json`, and do not hard-code the bundled IPNS county map. A human may also use Donphan interactively in Cursor to propose candidate facts; Watchog verifies and publishes them through the same gates.

### Required upstream contract (Phase 1 gate)

Before building live scans, confirm access to the hosted MCP and a way to enumerate counties. If either is missing, STOP and give the human this exact ask for the Elephant data owner:

1. The production, **server-to-server** Elephant MCP endpoint (the hosted MCP Donphan's live facts already come from), with its transport/URL, authentication method, and read-only credentials for DEV and PROD.
2. A way to **enumerate every published county** and detect newly published ones. If the MCP has no list-counties tool, derive the set from the Oracle coverage feed (`oracle-dataset-coverage-<county>`) plus per-county `getOracleDatasetInfo`. Each county entry must yield:
   - `countyKey` (for example `lee`, `palm-beach`) and display name + state
   - per-source coverage (`appraisal`, `permits`, `sunbiz`, `bbb`) with `ingestedCount`, `expectedCount`, `completionPercent`
   - `propertyCount`
   - source `firstLoadedAt` / `lastLoadedAt`
   - an **immutable `datasetRevision`** id that changes whenever the underlying data changes (derive from the coverage revision / IPNS pointer if the MCP does not return one)
3. Supported read-only **aggregate query** operations (the current example: number of properties in Lee County) — the same `queryProperties` / geo tools Donphan uses.
4. **Rate limits**: requests per second/minute, max concurrency, query timeout/size, and required behavior for HTTP 429/5xx.
5. A **DEV/sandbox** endpoint or fixture dataset for testing without full-volume production reads.

Prefer Oracle emitting a `DatasetPublished` event (county published/refreshed) as the primary trigger, with the recurring scan as reconciliation. A new county is eligible only after its query data **and** coverage report are published (see `use-oracle` coverage publish contract). Neon (`use-elephant-query-db`) is an optional fallback only for data the MCP does not expose.

### ElephantDataGateway (read-only, wraps the hosted MCP)

Implement a single typed gateway that is the only path to Elephant data. It MUST:

- **Enumerate counties from the coverage feed / MCP**, never from a hard-coded list or the plugin `mcp.json`.
- Snapshot per county: `propertyCount`, per-source coverage, `lastLoadedAt`, and the immutable `datasetRevision`.
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
