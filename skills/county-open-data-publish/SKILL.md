---
name: county-open-data-publish
description: "Publish county property data from the query DB to IPFS as open data — one JSON file per property + a sharded index, uploaded to Filebase (S3-compatible IPFS), with a stable IPNS name re-pointed on every publish so downstream MCP/NEO never change. Use when exporting consolidated property JSON, uploading to Filebase, managing the IPNS pointer, or wiring an MCP server to read the published index."
metadata: {"author":"elephant-xyz"}
---
# County Open-Data Publish (IPFS)

Publishes the county property dataset from the `elephant-query-db` DB to **public IPFS
via Filebase**, as the open-data layer that the MCP server (and NEO) read. This is the
publish step that follows `query-db-loading-matching`.

The model: **1 JSON file per property** + a **sharded index** (`shards/shard-NNNN.json`
+ a small `index.json`) + a flat `manifest.json` for back-compat. Each consolidated JSON
is CID-addressed; the index lists every property CID. A stable **IPNS name** resolves to
the latest index CID, so every consumer auto-gets new data on each re-publish with **zero
re-config**.

> **Lee County, FL** is the reference implementation. IPNS label `oracle-open-data-lee`,
> IPNS name `k51qzi5uqu5dlzgslzedrnk4whtd7ip69l0pmd3zxelz8hwjorbeyy0pyyeu4m`.

## ⚠️ PII / human-in-the-loop — the durable approve gate

Bulk PII → public IPFS is **human-gated**. The county's `Publish` virtual object dry-runs
(export + validate, no upload, no IPNS write) until a human calls:

```bash
curl localhost:8080/restate/call/Publish/<county>/approve --json '{}'
```

Approval is durable state on the object — set once per county, survives restarts. An
agent prepares and verifies everything up to the gate; **only a human approves**.

## How it runs — the `Publish` virtual object

Export + upload run as handlers on the county's **`Publish` virtual object**
(`services/publish.ts` in `skills/use-oracle/runtime`; see `durable-workflow-builder` patterns
8–10). Author `services/publish.ts` per `durable-workflow-builder` patterns 9–10 first —
these handlers are the contract you build, not a prebuilt service. `requestPublish()` (called by the `Loader` after a load validates, or by hand)
marks the county pending — and **arms the first `tick()` when none is scheduled**
(persist a `tickScheduled` flag; each tick re-arms exactly one successor), so a fresh
county never sits pending forever; the self-scheduling `tick()` runs export → validate →
upload → IPNS re-point as `ctx.run` steps.

State-machine precision (matches `durable-workflow-builder` pattern 10): an unapproved
`tick()` dry-runs and LEAVES `pending=true`; `approve()` arms an immediate tick when
pending; `pending` clears only after a successful APPROVED publication. Throttle the
wait: an unapproved tick dry-runs ONCE per content watermark (persist
`lastDryRunWatermark`) and stops re-arming until `approve()` or a newer
`requestPublish()` — never rebuild the multi-GB export every tick while waiting for
approval.

- **Singleton per county is structural** — the virtual object is single-writer, so a
  second publish request queues; no execution-listing or "is one already running?" checks.
- **No platform hard cap once `Publish`'s inactivity/abort timeouts are raised** — the
  export/upload steps exceed Restate's 10-min default abort timeout, which would
  abort-and-retry them mid-step; raise the timeouts per `durable-workflow-builder`
  authoring rule 3, then a multi-hour export/upload is fine. If the services process dies
  mid-step, restart it and the invocation resumes.
  ⚠️ Laptop sleep still stalls the current step: for multi-hour uploads run
  `caffeinate -i -s` or run the services process detached on a machine that stays up.
- Export output stages to **`data/artifacts/publish/<county>/`** (under `DATA_DIR` in the
  `skills/use-oracle/runtime` checkout), then uploads to the county's Filebase bucket.

## Sizing (real numbers, Lee 512k)

- Consolidated JSON ≈ **22 KB each** → ~**11 GB** for 512k properties (NOT ~80 GB — an
  early over-estimate).
- `--shard-size 10000` → ~52 shards for 512k.
- Upload: **~310 objects/sec at `--concurrency 64`** → ~25–30 min for 512k.
- Export: with the local Postgres, minutes-to-an-hour class; a remote DB adds every
  round-trip's latency.

## Step 1 — Export

In the **`elephant-query-db`** checkout (DB from `DATABASE_URL`):

```bash
npm run export:property-consolidation -- --county <county> --shard-size 10000 \
  --out-dir "$DATA_DIR/artifacts/publish/<county>"
```

Every stage is county-parameterized — pass the same `--county <county>` slug through
export, upload, and IPNS so nothing falls back to the reference county. The explicit
`--out-dir` enforces the promised staging location (`data/artifacts/publish/<county>/`
under `DATA_DIR`); the Step 2 upload consumes exactly that directory. Confirm the
export script on `elephant-query-db` `main` actually accepts `--county` and `--out-dir`;
if it doesn't yet, add them before running (doc ≠ code).

Produces one `<cid>.json` per property, `shards/shard-NNNN.json`, `index.json`, and
`manifest.json`. CIDs are **pre-computed locally** with `ipfs-only-hash` — its algorithm
matches Filebase's, so nothing needs to be read back from S3 metadata (see Bug C).

> **⚠️ `.env` quote trap (Bug A):** if the env loader doesn't strip surrounding quotes, a
> quoted `DATABASE_URL` parses the host as literally `base`
> (`getaddrinfo ENOTFOUND base`) and the export silently emits nothing. Pass the URL
> inline/unquoted if in doubt.

### ⚠️ Appraisal addresses are free-text only — parse them

The appraisal source populates **only** `addresses.unnormalized_address` (one line:
`"5845 CORPORATION CIRCLE, FORT MYERS, FL 33905"`); the structured
`street_number/street_name/city_name/latitude` columns are **100% null** (verified: 0 of
511,968 Lee rows). An export reading only structured columns emits a **null address for
the entire county** — silently, every row "succeeds". The export must parse
`unnormalized_address` (`"STREET, CITY, STATE ZIP"`) into `street`/`city`/`postalCode`,
structured columns winning when present. **Do NOT parse the state from the text** — the
DB `state_code` is correct-or-null and NEO falls back to `parcel.stateCode`; a parsed
token injects wrong values into the null rows. `latitude/longitude` come from the
`geometries` table, not `addresses`.

### Direct Parquet Export (Alternative Fast Path)

For fast-publishing pipelines, property consolidation can be written directly to a flat Parquet table via `export-<county>-direct-parquet.ts`, bypassing relational JSON chunk generation when downstream consumers query through DuckDB over IPFS/IPNS (`county-query-table-publish`).

## Step 2 — Upload to Filebase

```bash
npm run publish:ipfs-upload
```

Running this directly is a manual **break-glass path** — the normal path is `Publish.tick`
after the durable approval; before running it by hand, confirm the `Publish/<county>`
approved flag in the Restate UI.

This Filebase S3 client (`@aws-sdk/client-s3` pointed at `https://s3.filebase.io`) is the
pipeline's **only remaining S3-protocol dependency** — it talks to Filebase's upload API
for IPFS pinning (an external publishing service), not to storage we run.

Resumable (checkpoint; re-run to continue). **⚠️ Before a CORRECTED re-publish, delete
the stale checkpoint**
(`$DATA_DIR/checkpoints/publish/<county>/<bucket>/filebase-upload-checkpoint.json`): it skips by S3
key, not content, so a leftover checkpoint silently skips every re-upload and the fix
never reaches IPFS. **⚠️ Checkpoints must be scoped per county/bucket** — a checkpoint
shared across county buckets once cross-contaminated a publish: the uploader skipped
files it had uploaded to a DIFFERENT county's bucket, so this county's bucket silently
missed them. Required env (Filebase creds live in `skills/use-oracle/runtime/.env` or a
local secrets file — never in the repo):

| Variable | Value |
|---|---|
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Filebase keys |
| `S3_BUCKET` | `elephant-oracle-open-data-<county>` |
| `S3_ENDPOINT` | `https://s3.filebase.io` |
| `FILEBASE_IPNS_LABEL` | `oracle-open-data-<county>` |

**Per-county env convention (what the `Publish` object reads).** One services process
serves multiple counties and two datasets (this consolidation export and the query
table), so the bucket is configured per county per dataset:
**`FILEBASE_OPEN_DATA_BUCKET_<COUNTY>`** (this skill; `county-query-table-publish` uses
`FILEBASE_QUERY_TABLE_BUCKET_<COUNTY>`), with shared `FILEBASE_ACCESS_KEY` /
`FILEBASE_SECRET_KEY` (or `..._<COUNTY>` variants when a county's credentials differ).
`<COUNTY>` is the envPart normalization — slug uppercased, non-alphanumeric runs → `_`
(`palm-beach` → `PALM_BEACH`). The `Publish` object resolves these from its own key
(`ctx.key` = the county slug) per dataset and **rejects missing/mismatched config with a
`TerminalError`** — never a generic `S3_BUCKET` fallback. IPNS labels stay derived
(`oracle-open-data-<county>`), not configured. The generic `S3_*` names in the table are
what the upload script consumes; the object maps the per-county vars onto them.

> **⚠️ Each county needs its OWN Filebase bucket + IPNS label.** The upload writes FIXED
> keys (`index.json` / `manifest.json` / `shards/shard-*.json`), so reusing a bucket
> clobbers the other county and can unpin its CIDs.
>
> **⚠️ A bucket that ever held a SAMPLE run republishes a STALE index.** The old small
> `index.json` is still at the fixed key and a leftover checkpoint skips re-writing it —
> IPNS gets re-pointed at the OLD sample index even though the per-property files
> uploaded fine. Delete the checkpoint AND confirm the published `index.json` CID equals
> the freshly-exported one, resolving to the FULL `propertyCount`.

The uploader auto-derives the IPNS auth from the S3 keys and upserts the IPNS name at the
end — no separate token needed.

> **⚠️ Very long uploads from distant networks have failed with `EADDRNOTAVAIL` and
> SILENT partial output that looks like success** — always reconcile the uploaded-object
> count against the export manifest before re-pointing IPNS.

## Step 3 — IPNS (the always-latest pointer)

The **same name** is re-pointed at the new index CID on every publish → MCP/NEO never
change. Use the **Filebase Platform API** at **`https://api.filebase.io/v1/names`**
(NOT `/v1/ipns` — that path does not exist; see Bug D).

- **Auth** = `Authorization: Bearer base64(S3_ACCESS_KEY_ID:S3_SECRET_ACCESS_KEY)` —
  derived from the S3 keys; there is **NO separate API token**.
- `GET /v1/names` list · `POST /v1/names` `{"label","cid"}` create ·
  `PUT /v1/names/{label}` `{"cid"}` re-point (the re-publish op).
- The response field **`network_key`** is the resolvable `k51…` IPNS name.

Manual re-point — a **break-glass path** only: the normal path is `Publish.tick` after the
durable approval; before mutating IPNS by hand, confirm the `Publish/<county>` approved
flag in the Restate UI:

```bash
AUTH=$(printf '%s:%s' "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" | base64)
curl -X PUT "https://api.filebase.io/v1/names/oracle-open-data-<county>" \
  -H "Authorization: Bearer $AUTH" -H "Content-Type: application/json" \
  -d '{"cid":"<new index cid>"}'
```

## Step 4 — MCP reads IPNS

The MCP resolves the IPNS name → fetches the index (auto-detects sharded `index.json` vs
flat `manifest.json`).

**IPNS resolution must be header-based.** Public gateways **dropped the Kubo RPC**
`/api/v0/name/resolve` endpoint. Resolve via a HEAD request and read the
**`x-ipfs-roots`** response header, against `https://<name>.ipns.dweb.link/` or
`https://ipfs.filebase.io/ipns/<name>`.

MCP env: `ORACLE_OPEN_DATA_IPNS=<name>` (leave any fixed index-CID env unset so IPNS is
the single source of truth). **Multi-county:** `ORACLE_OPEN_DATA_IPNS_MAP` (JSON
`{"lee":"k51…","palm-beach":"k51…"}`) + `ORACLE_OPEN_DATA_DEFAULT_COUNTY`; NEO must pass
`county` and point `ORACLE_MCP_URL` at the STABLE MCP alias, not a pinned deployment URL.

> **⚠️ Vercel "sensitive + empty" env trap (MCP app).** (1) A **Sensitive** env var can't
> be read back and, if ever saved blank, silently serves empty — the MCP resolves NO
> county. Set `ORACLE_OPEN_DATA_IPNS_MAP` as a **PLAIN** var and verify with
> `GET /v9/projects/<id>/env?decrypt=true`. (2) Env binds only to **NEW deployments** —
> after any env change you MUST **REDEPLOY**, then re-verify through the live MCP.

## The geo / value index is a SEPARATE publish (parameterize by county first)

NEO's map/search also consumes a **geo + value index** (bounding-box / value-range),
produced by its own export + upload with its own IPNS/CID wiring. Two traps:

- **It is easy to forget** — publishing only the consolidation index leaves NEO's map
  layer empty even though property lookups work. Treat it as a required second publish
  for any county NEO maps.
- **Its export was once hardcoded to the reference county.** Parameterize it by county
  BEFORE running for a new one — an un-parameterized run fails or emits the reference
  county's geometry under the new county's name. Verify its `propertyCount` matches the
  reconciled folio count, same as the consolidation index.

## Bugs caught + fixed (do not re-hit)

> ⚠️ These fixes have drifted off `elephant-query-db` `main` once already — a later
> publish from `main` re-hit B, C, D live. **Before publishing, confirm the upload/export
> code on `main` actually contains them.** Doc ≠ code.

- **A. `.env` quote-stripping** — see Step 1.
- **B. Double export-dir prefix.** The manifest's `filePath` already includes the
  export-dir prefix, so `join(exportDir, entry.filePath)` doubles it → `ENOENT` on the
  first file. Build paths from the relative key (`properties/<uuid>.json`).
- **C. Per-upload S3 middleware is NOT concurrency-safe.** Capturing the `x-amz-meta-cid`
  header via a fixed-name deserialize middleware on the **shared** S3 client caused
  `Duplicate middleware name` + cross-request contamination at `--concurrency > 1`.
  Either trust the locally pre-computed CID, or attach the middleware to **each
  `PutObjectCommand`'s own stack** (`command.middlewareStack.add`, isolated per call).
  **Never add capture middleware to the shared client.**
- **D. IPNS update `404`.** PUTting `/v1/ipns` with an `_id` key — that path doesn't
  exist. The real API is `/v1/names`, **label-keyed**; symptom: upload succeeds,
  `ipns_update_failed: … 404`, pointer never moves.
- **E. Silent IPNS skip on an unset bearer.** With an empty token the run "succeeds" but
  logs `skipping IPNS update`. The uploader now auto-derives the bearer from the S3 keys;
  still, always confirm the final log shows the IPNS name bumped — never trust "upload
  complete" alone.

## Verification

### Pre-publish reconciliation: source → DB → export (before the gate)

1. **DB ↔ export, full counts.** For each `source_system` child table (`taxes,
   sales_histories, structures, layouts, lots, utilities, ownerships, deeds, files,
   property_valuations, geometries, flood_storm_information`) compare the DB count
   (`WHERE source_system='<county>_appraiser'`) to the aggregate array length across all
   exported JSONs. Exact equality ⇒ lossless AND zero orphaned child rows. Mismatch ⇒
   stop.
2. **Source ↔ DB ↔ export, ~12 random folios.** Each property row carries
   `source_artifact_uri` → the `transformed.zip`. Count data files per class in the zip
   (`tax_N.json`, `sales_N.json`, …; owners are `person_N.json` **or** `company_N.json` —
   count both; `relationship_*`/`fact_sheet`/`property_seed` are links, exclude) and
   assert zip count == DB rows == export array length.
3. **Parent identity:** distinct folios in `parcels` == source count (BY FOLIO — see
   `query-db-loading-matching`).

### Post-publish

- `GET /v1/names` shows the label at the expected index CID — and that CID **equals the
  freshly-exported `index.json`'s CID** (`ipfs-only-hash` locally and compare). Differ ⇒
  stale index (bucket-reuse / leftover-checkpoint symptom) — not done.
- HEAD `https://<ipns-name>.ipns.dweb.link/` → `x-ipfs-roots` == index CID; resolved
  index `propertyCount` == the reconciled folio count (NOT a sample count).
- Through the MCP: `listOracleProperties {limit:2}` returns real data, `total` == the
  published count.
- **Re-publish proof:** set a bogus fixed index-CID env on the MCP and confirm data still
  loads — proves it flows via IPNS, not a hard-coded CID.

## Related skills

- `query-db-loading-matching` — loads the data this skill publishes; validate the
  distinct-parcel count BY FOLIO before publishing.
- `county-query-table-publish` — the Parquet query-table publish that consumes this
  export's `manifest.json`.
- `durable-workflow-builder` — the virtual-object, approval-gate, and self-scheduling
  patterns the `Publish` object uses.
