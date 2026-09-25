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
ATLAS_GATEWAYS=https://ipfs.filebase.io,https://trustless-gateway.link
```

ipfs.io, dweb.link and w3s.link are not usable: they refuse plain requests and only
redirect trustless ones to `trustless-gateway.link`.

The local server stores its snapshot in a default file under the operator's home
directory; do not set a database URL for local use. Do not configure county maps, catalog
URLs, specialized dataset pointers, or per-county publication variables.

## Ask for the user's IPFS gateway

Before starting or configuring the server, ask the user once:

> Do you have your own IPFS gateway to use for Elephant data (for example a dedicated
> Filebase gateway)? If so, give its origin, like `https://<name>.<provider-domain>`.

- Treat the answer as private. Put it only in the user's own MCP client config or shell
  environment. Never write it into a repository file, commit message, pull request, issue,
  or log you share.
- If the user has none, keep the public defaults above and skip to the next section.
- Otherwise run the smoke test below, and use the gateway only if every check passes.

Smoke test, with `GW` set to the user's origin (no trailing slash):

```bash
IPNS=k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
# 1. Resolves the Atlas index: 200 and an index with "version": 1
curl -sf -m 60 -H 'Accept: application/vnd.ipld.raw' "$GW/ipns/$IPNS?format=raw" -o index.json \
  && python3 -c 'import json;i=json.load(open("index.json"));assert i["version"]==1;print(len(i["counties"]),"counties")'
# 2. Serves a published archive as a trustless CAR (skip when the index lists no county)
CID=$(python3 -c 'import json;c=json.load(open("index.json"))["counties"];print(next(iter(c[0]["groups"].values()))["cid"] if c else "")')
[ -z "$CID" ] || curl -sf -m 120 "$GW/ipfs/$CID?format=car" -o archive.car && ls -l archive.car
# 3. Retrieves content it does not host: a lexicon schema by CID, bytes hashed against the CID
S=$(curl -sf -m 30 https://lexicon.elephant.xyz/api/manifest | python3 -c 'import json,sys;print(next(iter(json.load(sys.stdin).values()))["ipfsCid"])')
curl -sf -m 60 -H 'Accept: application/vnd.ipld.raw' "$GW/ipfs/$S?format=raw" -o schema.bin \
  && python3 -c 'import hashlib,base64,sys;d=hashlib.sha256(open("schema.bin","rb").read()).digest();c="b"+base64.b32encode(bytes([1,0x55,0x12,0x20])+d).decode().lower().rstrip("=");assert c==sys.argv[1],c;print("schema verified")' "$S"
# 4. No rate limiting: ten requests in a row, all 200
for i in $(seq 10); do curl -s -o /dev/null -w '%{http_code} ' -m 30 "$GW/ipfs/$S?format=raw"; done; echo
```

Interpret the results for the user:

- **All pass.** Configure `ATLAS_GATEWAYS=$GW,https://ipfs.filebase.io,https://trustless-gateway.link`
  so the user's gateway is tried first and the public ones remain as fallback.
- **Check 3 returns `404 CONTENT_NOT_HOSTED`.** The gateway is in private mode and serves
  only content pinned in its own account. It cannot fetch Atlas data it does not host;
  tell the user to switch it to public mode or keep the defaults.
- **A 504 on the first try of check 3** is a cold network lookup. Retry once before failing.
- **Any other failure.** Report the failing check and its HTTP status, and keep the defaults.

Pass the same origin to the Elephant CLI with `--ipfs-gateway "$GW"` (or
`ELEPHANT_IPFS_GATEWAYS`) so lexicon schemas come from it too.

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
