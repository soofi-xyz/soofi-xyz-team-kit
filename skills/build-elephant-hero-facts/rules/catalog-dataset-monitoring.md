---
title: Atlas Dataset Gateway and Change Detection
impact: CRITICAL
tags: atlas, dataset, county-discovery, gateway, snapshot, change-detection, revision
---

## Atlas dataset gateway and change detection

Use a Watchog-owned Elephant MCP 2.0 HTTP deployment (`deploy-open-data-mcp`). Run
`npx -y @elephant-xyz/mcp@2 sync` as a separate scheduled job. Run the HTTP process with
endpoint authentication; it never resolves the index or loads archives per request.

Configure only global Atlas inputs (`ATLAS_IPNS`, `ATLAS_GATEWAYS`) plus HTTP auth and
optional embedding credentials. Never restore county maps, specialized dataset pointers,
or direct Query DB access.

## Required contract

1. Pin an Elephant MCP 2.0 source version and Node 22.18+.
2. Run `mcp sync`; record the accepted global Atlas `indexCid`.
3. Call `listAtlasCounties`; enumerate states, counties, and groups from the
   synchronized snapshot.
4. For each eligible group, call `getAtlasDatasetInfo` with explicit `state`, `county`,
   and `dataGroup`.
5. Discover tables and columns with `getAtlasSchema`.
6. Run deterministic, read-only `queryAtlas` aggregates (one SELECT/WITH; JOINs through
   relationship tables allowed; `limit` ≤ 1000).
7. Record the `source` tuple (index, archive, tables, schema CIDs, `syncedAt`) with
   every calculation.
8. Use a DEV fixture or isolated Atlas database for tests.

The immutable dataset revision is the Atlas `indexCid` plus the selected group's
`archiveCid`, `tablesCid`, and `schemaCid`. Do not synthesize a revision from timestamps or
mutable pointers.

## ElephantDataGateway

Implement one typed, read-only gateway. It must:

- enumerate from `listAtlasCounties`, never a hard-coded county list;
- require explicit state/county/data-group scope and name the tables each recipe reads;
- cache the accepted Atlas revision for one run;
- record recipe, SQL, parameters, canonical result, result hash, read time, and source
  CIDs;
- allow only one bounded, recipe-owned `SELECT`/`WITH` per recipe;
- reject mutations, control tables, non-allow-listed functions, and model-authored SQL;
- use bounded concurrency, deadlines, and retry-after-aware backoff;
- return a non-fact outcome on sync or data errors.

## Snapshot and change detection

Persist the last accepted group revision in DynamoDB. Classify:

- new county;
- new data group;
- replaced archive/tables/schema;
- withdrawn data group;
- unchanged Atlas index.

Use conditional writes on the revision tuple so duplicate scheduled runs cannot
double-process it. Only groups satisfying a recipe's source and table requirements advance.

### Correct

```typescript
const snapshot = await gateway.listAtlasCounties();
for (const county of snapshot.counties) {
  for (const dataGroup of Object.keys(county.groups)) {
    const revision = await gateway.datasetInfo(county.state, county.county, dataGroup);
    await snapshots.putIfChanged(revision);
  }
}
```

### Incorrect

```typescript
const counties = ["lee", "palm-beach"];
const count = await queryInternalWarehouse(counties[0]);
```

The Query DB is internal ingestion state and must never back Watchog facts.
