---
name: deploy-open-data-mcp
description: "Run or deploy the Elephant MCP server against the published Atlas county index, synchronize it, and verify the served tools after a county publication. Use when setting up, cutting over, or checking the open-data MCP."
metadata: {"author":"elephant-xyz"}
---

# Deploy Elephant MCP 2.0

Elephant MCP 2.0 resolves the global Atlas index, verifies archive and table CIDs, and
synchronizes the published tables into a local snapshot. Tool handlers query that
accepted snapshot; they never fetch remote archives during a request.

The ingestion query DB is internal and unrelated to MCP serving. Do not point MCP at it
or expose it as a public source.

## Configuration

| Variable | Purpose |
|---|---|
| `ATLAS_IPNS` | Global `elephant-atlas` IPNS name |
| `ATLAS_GATEWAYS` | Comma-separated gateway origins in retry order |
| `MCP_HTTP_AUTH_TOKEN` | Optional bearer token for hosted MCP routes |
| embedding credentials | Optional; only for verified-script search |

Defaults:

```text
ATLAS_IPNS=k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
ATLAS_GATEWAYS=https://ipfs.filebase.io,https://ipfs.io,https://dweb.link,https://w3s.link
```

The local server stores its snapshot in a default file under the operator's home
directory; do not set a database URL for local use. Do not configure county maps, catalog
URLs, specialized dataset pointers, or per-county publication variables.

## Plugin cutover

The plugin's `mcp.json` still runs the current server with the legacy per-county maps.
The 2.0 configuration is `docs/mcp-atlas.example.json`
(`npx -y @elephant-xyz/mcp@2 mcp` with the two variables above). Replace `mcp.json`
with it only when both hold:

1. MCP 2.0 is released on npm (`npx -y @elephant-xyz/mcp@2 mcp` starts), and
2. the global Atlas index lists at least one county.

Until then leave `mcp.json` untouched so Donphan does not go dark.

## Local stdio

Node 22.18+:

```bash
npx -y @elephant-xyz/mcp@2 mcp
```

The stdio server runs one sync on startup before serving Atlas-backed calls. Force and
inspect a sync when validating a new publication:

```bash
npx -y @elephant-xyz/mcp@2 sync
```

Sync must:

1. resolve `ATLAS_IPNS` through the configured gateways;
2. hash and verify the accepted index;
3. verify county indexes, table indexes, and archive parts;
4. load changed data groups transactionally into one table per class and relationship
   (named as in the archive) plus `properties`, keyed by
   `(state, county, data_group, cid | relationship_cid | property_cid)`;
5. apply replacements and withdrawals atomically;
6. report the index CID and per-group row counts.

An unchanged index performs no writes.

## Hosted HTTP

Run sync as a scheduled job (after each Atlas merge and as bounded reconciliation), and
serve requests from a separate process configured per the `@elephant-xyz/mcp` README for
its persistent store:

```bash
npx -y @elephant-xyz/mcp@2 sync        # scheduled job
npx -y @elephant-xyz/mcp@2 mcp-http    # request process
```

Expose `POST /mcp` and `GET /health`. Protect `/mcp` with `MCP_HTTP_AUTH_TOKEN`. Do not
resolve the index or load archives inside an HTTP request.

## MCP 2.0 tools

Atlas (all take `state`, `county`, `dataGroup` except the first):

- `listAtlasCounties` — index CID, `generated_from`, `synced_at`, counties with groups and CIDs
- `getAtlasDatasetInfo` — tables with row counts and provenance
- `getAtlasSchema` — table catalog; with `table`, its columns
- `queryAtlas` — `sql`, `limit` ≤ 1000; one read-only SELECT/WITH, JOINs and CTEs allowed,
  content tables scope-filtered, control tables/catalogs/non-allow-listed functions rejected
- `listAtlasProperties` — `limit`, `offset`
- `getAtlasProperty` — `propertyCid`; assembled by walking relationships, shared entities included

Lexicon: `listClassesByDataGroup`, `listPropertiesByClassName`, `getPropertySchema`,
`getVerifiedScriptExamples`.

Removed: all HOA, permit, places, dataset-plan, and area/geo tools. Every response
carries `source` = `{ state, county, dataGroup, archiveCid, tablesCid, schemaCid,
indexCid, syncedAt }`. Full contract: `use-elephant-mcp/reference/tools-and-workflows.md`.

## Verification

After an Atlas merge:

1. Resolve `ATLAS_IPNS` through at least the first configured gateway.
2. Run `sync` and record the accepted index CID.
3. Call `listAtlasCounties`; confirm the state, county, and data groups.
4. Call `getAtlasDatasetInfo` with explicit scope; confirm the `source` CIDs and row counts.
5. Call `getAtlasSchema` without `table`, choose a returned table, then describe it.
6. Run one `queryAtlas` `SELECT count(*) FROM property`.
7. For local stdio, restart and confirm the accepted snapshot remains queryable.
8. For hosted, confirm the request process performs no network synchronization.

Do not claim a new county is served from a successful upload or Atlas PR alone. Require
the global index, sync, and scoped tool evidence.
