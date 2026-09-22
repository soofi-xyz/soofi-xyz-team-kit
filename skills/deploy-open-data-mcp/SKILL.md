---
name: deploy-open-data-mcp
description: "Run or deploy Elephant MCP 2.0 against the global Atlas IPNS, synchronizing verified Atlas tables into local SQLite or hosted Postgres/Neon before normalized tools serve data."
metadata: {"author":"elephant-xyz"}
---

# Deploy Elephant MCP 2.0

Elephant MCP resolves the global Atlas index, verifies archive and table CIDs, and
synchronizes normalized Atlas tables into SQL. Tool handlers query that accepted SQL
snapshot; they never query remote Parquet during a request.

The Query DB used by ingestion is internal and unrelated to MCP serving. Do not point MCP
at it or expose it as a public source.

## Configuration

Use:

| Variable | Purpose |
|---|---|
| `ATLAS_IPNS` | Global `elephant-atlas` IPNS name |
| `ATLAS_GATEWAYS` | Comma-separated gateway origins in retry order |
| `DATABASE_URL` | MCP Atlas SQLite or Postgres/Neon database |
| `MCP_HTTP_AUTH_TOKEN` | Optional bearer token for hosted MCP routes |
| embedding credentials | Optional; only for verified-script search |

Default Atlas IPNS:

```text
k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
```

Default gateways:

```text
https://ipfs.filebase.io
https://ipfs.io
https://dweb.link
https://w3s.link
```

Do not configure county maps, catalog URLs, specialized dataset pointers, or per-county
publication variables.

## Local stdio with SQLite

Use Node 22.18+ and MCP 2.0:

```bash
npx -y --package=github:elephant-xyz/elephant-mcp#main mcp
```

The stdio server starts one Atlas sync before serving Atlas-backed calls. Use a `file:`
`DATABASE_URL` under the operator's home directory. The plugin launcher expands its
portable home placeholder before starting MCP.

Run an explicit sync when validating a new Atlas publication:

```bash
npx -y --package=github:elephant-xyz/elephant-mcp#main mcp sync
```

Sync must:

1. resolve global Atlas IPNS through the configured gateways;
2. hash and verify the accepted index;
3. verify county indexes, table indexes, and UnixFS parts;
4. load changed data groups transactionally;
5. apply replacements and withdrawals atomically;
6. report the index CID and per-group counts.

An unchanged index performs no writes.

## Hosted HTTP with Postgres/Neon

Use a direct writer URL for the separate sync job:

```bash
DATABASE_URL=<direct-writer-url> \
  npx -y --package=github:elephant-xyz/elephant-mcp#main mcp sync
```

Run the HTTP server with a read-only database credential:

```bash
npx -y --package=github:elephant-xyz/elephant-mcp#main mcp-http
```

Expose `POST /mcp` and `GET /health`. Protect `/mcp` with
`MCP_HTTP_AUTH_TOKEN`. Do not run IPNS resolution or DuckDB ETL inside an HTTP request.
Schedule `mcp sync` separately after Atlas publication and as bounded reconciliation.

## Retained MCP 2.0 tools

Atlas SQL:

- `listPublishedCounties`
- `listOracleProperties`
- `getOracleProperty`
- `getOracleDatasetInfo`
- `getPropertyQuerySchema`
- `queryProperties`
- `findPropertiesInArea`
- `sumPropertyValueInArea`

Lexicon and verified scripts:

- `listClassesByDataGroup`
- `listPropertiesByClassName`
- `getPropertySchema`
- `getVerifiedScriptExamples`

Atlas tools require explicit `county` and `dataGroup`. Table queries and geo tools also
require explicit `table`. They return Atlas index, archive, tables, and schema
provenance.

## Verification

After an Atlas merge:

1. Resolve `ATLAS_IPNS` through at least the first configured gateway.
2. Run `mcp sync` and record the accepted index CID.
3. Call `listPublishedCounties`; confirm the county and data groups.
4. Call `getOracleDatasetInfo` with explicit scope; confirm archive, tables, schema, and
   index CIDs.
5. Call `getPropertyQuerySchema` without `table`, choose a returned normalized table,
   then describe it with `table`.
6. Run one read-only `queryProperties` call over logical relation `properties`.
7. For local SQLite, restart and confirm the accepted snapshot remains queryable.
8. For hosted Postgres/Neon, confirm the HTTP process cannot write and does not perform
   network synchronization during requests.

Do not claim a new county is served from a successful upload or Atlas PR alone. Require
global IPNS, sync, and scoped tool evidence.
