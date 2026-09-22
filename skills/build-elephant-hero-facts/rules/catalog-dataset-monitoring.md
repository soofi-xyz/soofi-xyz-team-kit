---
title: Atlas Dataset Gateway and Change Detection
impact: CRITICAL
tags: atlas, dataset, county-discovery, gateway, snapshot, change-detection, revision
---

## Atlas dataset gateway and change detection

Use a Watchog-owned Elephant MCP 2.0 HTTP deployment backed by hosted Postgres/Neon. Run
Atlas synchronization as a separate writer job. Run the HTTP process with a read-only
credential and endpoint authentication.

Configure only global Atlas inputs (`ATLAS_IPNS`, `ATLAS_GATEWAYS`, `DATABASE_URL`) plus
HTTP auth and optional embedding credentials. Never restore county maps, specialized
dataset pointers, or direct Query DB access.

## Required contract

1. Pin an Elephant MCP 2.0 source version and Node 22.18+.
2. Run `mcp sync`; record the accepted global Atlas `indexCid`.
3. Call `listPublishedCounties`; enumerate counties and groups from the synchronized
   snapshot.
4. For each eligible group, call `getOracleDatasetInfo` with explicit `county` and
   `dataGroup`.
5. Discover normalized tables with `getPropertyQuerySchema`.
6. Run deterministic, read-only `queryProperties` aggregates against a selected table.
7. Record index, archive, tables, and schema CIDs with every calculation.
8. Use a DEV fixture or isolated Atlas database for tests.

The immutable dataset revision is the Atlas `indexCid` plus the selected group's
`archiveCid`, `tablesCid`, and `schemaCid`. Do not synthesize a revision from timestamps or
mutable pointers.

## ElephantDataGateway

Implement one typed, read-only gateway. It must:

- enumerate from `listPublishedCounties`, never a hard-coded county list;
- require explicit county/data-group/table scope;
- cache the accepted Atlas revision for one run;
- record recipe, SQL, parameters, canonical result, result hash, read time, and source
  CIDs;
- allow only one bounded `SELECT FROM properties` per recipe;
- reject CTEs, JOINs, mutations, files, extensions, and model-authored SQL;
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
const snapshot = await gateway.listPublishedCounties();
for (const county of snapshot.counties) {
  for (const dataGroup of Object.keys(county.groups)) {
    const revision = await gateway.datasetInfo(county.county, dataGroup);
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
