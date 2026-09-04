---
name: deploy-open-data-mcp
description: "Deploy your own Elephant open-data MCP server so any agent can query the published county property data (and request on-demand permits) — as a plain Node server, or on Vercel/Cloudflare. The MCP is stateless and reads the public IPNS/IPFS open data, so every consumer runs their own copy pointing at the same data — no shared backend. Use when someone wants to consume the Oracle open data via MCP, self-host the MCP, or wire the permit tool to the pipeline."
metadata: {"author":"elephant-xyz"}
---
# Deploy the Open-Data MCP

The Elephant open-data MCP (`elephant-xyz/elephant-mcp`) exposes the published county
property data as MCP tools. It is **stateless** — one fresh MCP server + transport per
request — and reads the data straight from **public IPFS via an IPNS pointer**. There is no
private database and no shared backend: **anyone who wants the data deploys their own MCP**
pointing at the same public IPNS name — the team's hosted MCP is just one such deployment. This is the open-data model — see
`county-open-data-publish` for how the data + IPNS name are produced.

Tools it serves (open-data path): `listOracleProperties`, `getOracleProperty` (read the
sharded index → shard → per-property JSON), and `getPropertyPermits` (permit data; the
on-demand harvest variant works only for a co-located deployment — see below).

## 1. Build and run (plain Node — primary)

```bash
git clone https://github.com/elephant-xyz/elephant-mcp && cd elephant-mcp && npm install
npm run build && npm run start:http     # or npm run dev:http while iterating
```

Runs a standalone Node HTTP server (`MCP_HTTP_STANDALONE`, `PORT`). The MCP endpoint is
**`POST /mcp`** → `http://<host>:<PORT>/mcp`.

The build is a [Nitro](https://nitro.build) preset; the MCP runs unchanged on other
targets because it holds no per-session state. Secondary options if you want a hosted
copy: **Vercel** (`npm run build:vercel` — includes the `patch-nitro-noble.mjs` post-build
fix — then `vercel deploy`) and **Cloudflare Pages**
(`npx nitropack build --preset cloudflare-pages` → `npx wrangler pages deploy
.output/public`). Endpoint on both: `https://<deploy>/mcp`.

## 2. Configure env

| Variable | Required? | Purpose |
|---|---|---|
| `ORACLE_OPEN_DATA_IPNS` | **Yes (recommended)** | The published IPNS name (`k51q…`) for the county. The MCP resolves it live → always serves the latest index, no redeploy on re-publish. Get it from `county-open-data-publish` (Filebase `GET /v1/names/<label>` → `network_key`). |
| `ORACLE_OPEN_DATA_IPNS_MAP` | Multi-county | JSON map of county → IPNS name (e.g. `{"lee":"k51…","palm-beach":"k51…"}`) for deploys serving more than one county; clients pass `county` to select. See `county-open-data-publish` / `onboard-county` for the multi-county wiring. |
| `ORACLE_OPEN_DATA_DEFAULT_COUNTY` | Multi-county | Fallback county key used when a request doesn't specify one (must be a key of `ORACLE_OPEN_DATA_IPNS_MAP`). |
| `ORACLE_OPEN_DATA_INDEX_CID` | Optional | Pin a fixed sharded-index CID instead of IPNS (you must redeploy to update). Leave UNSET when using IPNS so IPNS is the single source of truth. |
| `ORACLE_OPEN_DATA_MANIFEST_CID` | Optional | Legacy flat-manifest CID (back-compat). Prefer the sharded index. |
| `PIPELINE_INGRESS_URL` | Co-located permits only | Base URL of the pipeline's Restate ingress (e.g. `http://localhost:8080`); the tool derives both `/restate/send/PermitHarvest/harvestParcel` (the harvest) and `/restate/send/Loader/<county>/load` (the merge) from it. **Only works when the MCP is co-located with the pipeline** (same machine/network) — there is no secure bridge from a remote deployment to a local ingress, so remote per-consumer deploys leave this unset. Use the async `/restate/send/…` form, not `/restate/call/…` — a full per-parcel harvest is multi-minute and a synchronous call would time out client-side (idempotency keys work on send too). `getPropertyPermits` sends with an idempotency key (repeat requests for the same parcel don't re-harvest), then polls `PERMIT_DATA_DIR` for results. |
| `PERMIT_HARVEST_JOB_ID` | Co-located permits only | Job id for MCP-initiated harvests. **It must embed a freshness epoch** (e.g. `mcp-ondemand-<yyyy-ww>`, weekly rotation — configure the rotation to match the acceptable staleness window): a permanent standing id creates a permanent idempotency key + status path, so once artifacts exist, `skipExisting` suppresses future harvests even after permits change, and polling can read an old status file. `PermitHarvest.harvestParcel` needs `{county, jobId, parcel_id}`; the tool sends `{county, jobId: $PERMIT_HARVEST_JOB_ID, parcel_id}` with idempotency key `<county>/<jobId>/<parcel_id>`, then polls the CURRENT epoch's status artifact only: `PERMIT_DATA_DIR/<county>/<jobId>/status/<folio>.json`. Status JSON schema: `{parcel_id, completedAt, permitCount, failures: []}` (written atomically by the harvester). |
| `PERMIT_DATA_DIR` | Co-located permits only | Filesystem path to the pipeline's `data/artifacts/permits/` dir; the tool reads harvest results from there when the MCP runs co-located with the pipeline. Remote per-consumer deploys leave this unset and serve the **published IPFS permit data only — no on-demand harvesting** (no direct pipeline storage access). |
| `PERMIT_CACHE_MANIFEST_CID` | Optional | IPFS manifest of already-harvested permits (served from cache before invoking the harvester). |
| `OPENAI_API_KEY` | Embeddings only | Required for `getVerifiedScriptExamples` (no fallback provider — the feature is off without it). |
| `PORT` / `MCP_HTTP_STANDALONE` | node-server only | Standalone Node HTTP server settings. |

**Minimum to serve property data:** just `ORACLE_OPEN_DATA_IPNS`. On-demand permit
harvesting is a **co-located-only** add-on: the tool needs the running pipeline's Restate
ingress plus read access to the pipeline's permits dir (`PERMIT_DATA_DIR`) — it no longer
enqueues to any queue. Remote/hosted deployments serve the published IPFS permit data
only. Note that `PermitHarvest.harvestParcel` only writes artifacts and the status
file — it never touches the DB, so on its own the query DB and published data stay
stale. After the status-artifact poll reports success, the MCP submits the merge
itself:

```bash
curl "$PIPELINE_INGRESS_URL"/restate/send/Loader/<county>/load \
  --json '{"jobId":"<PERMIT_HARVEST_JOB_ID>","tracks":["permits"],"step":"incremental"}'
```

so the harvest reaches Postgres. Publish signaling stays owned by `Loader`, which
calls `Publish.requestPublish()` after the merge — refreshed permit data then reaches
the published IPFS dataset on the next publish tick.

## 3. Point a client at it

- **HTTP (your deploy):** configure the MCP client with a streamable-HTTP server URL of
  `http(s)://<your-deploy>/mcp`.
- **stdio (no deploy, local):** the published package runs over stdio —
  `npx -y @elephant-xyz/mcp@latest` (the README has one-click Cursor/VS Code install links).
  Set the same `ORACLE_OPEN_DATA_IPNS` in the client's MCP env block.

## 4. Verify

```text
listOracleProperties { "limit": 2 }   # returns real properties; total == published count
getOracleProperty { "parcelId": "<a known parcel>" }   # full consolidated record
```

- IPNS proof: with `ORACLE_OPEN_DATA_IPNS` set and no fixed index-CID env, data still loads
  → it is resolving via IPNS, so a re-publish flips it with no redeploy (after the manifest
  cache TTL).
- If `listOracleProperties` is empty: confirm `ORACLE_OPEN_DATA_IPNS` is the current
  `network_key` and that `GET /v1/names/<label>` points at a live index CID.

## Related skills

- `county-open-data-publish` — produces the data + the IPNS name this MCP reads.
- `query-db-loading-matching` — loads the data that gets published.
