# Configure registered IPFS indexes

Use this runbook to turn on registered IPFS indexes for an install, register
an index, and check the copy Persist makes of it. Always say "registered IPFS
index"; "index" alone means a derived index.

A registered IPFS index is an index document published on IPFS (today
Elephant's Atlas, format `atlas-index-v1`). Every 15 minutes Persist reads the
install's copy of its `index.json` and, when it changed, copies the Parquet
files it names from public IPFS gateways into the install's index bucket,
checking each against its CID. REST routes under
`/persist/registered-ipfs-indexes` and the MCP tools `list_indexes`,
`describe_index` and `query_index` answer read-only SQL over that checked copy
with DuckDB, and name the CIDs every answer came from.

Confirm the target revision first. Registration (Persist #458) is on `main`;
the sync (Persist #461) and the query routes and tools (Persist #463) are open
pull requests on 2026-11-11. Without the sync, registrations are stored but
nothing is copied; without the query part, nothing reads the copy. Send a missing piece to `conkeldurr`.
Builder detail: [the builder reference](../../build-persist-service/reference/registered-ipfs-indexes.md).

## 1. Prepare the index bucket

- Use an S3 bucket the install's AWS account owns, in the install's region.
  Persist does not create it.
- Put the install's copy of the publisher's `index.json` in it, at a key of
  S3's safe characters (letters, digits, `! - _ . * ' ( )`, `/` between
  segments), for example `atlas/index.json`. Persist reads this object; it
  does not fetch `index.json` from IPFS. Never put it under
  `persist-registered-ipfs-indexes/`, which Persist owns; the `PUT` refuses
  such an `index_uri` with `400`.
- If the bucket uses a customer-managed KMS key, the key policy must let the
  sync function's role use that key (decrypt to read the index file, encrypt
  to write the copy), and the query function's role decrypt the copy. SSE-S3 needs nothing extra.
- Persist can read any object in the bucket and can list and write only under
  `persist-registered-ipfs-indexes/`. It never deletes.

## 2. Turn the feature on

The feature is off unless the install parameter
`PersistRegisteredIpfsIndexBucketName` names the bucket. Set it through the
Deploy run or Puller subscription `configuration` (work with Skarmory):

```json
{ "PersistRegisteredIpfsIndexBucketName": "acme-ipfs-indexes" }
```

- The value must be an S3 bucket name or empty; CloudFormation refuses
  anything else.
- Once set, it persists: a later deploy that passes no value keeps it.
- A SOC direct deploy (`bin/app.ts`) has no such setting and is always off;
  hand that to Conkeldurr. Marketplace review installs pass no parameters, so
  they are off too.
- Turning it on adds the sync function, its schedule, role and log group, and
  gives the REST handler the bucket. Nothing else changes.

## 3. Register the index

Registrations live in `indexes` of the MCP configuration. `PUT` replaces the
whole document, so read it first and keep its tools, limits and saved queries.
Ask before the `PUT`; work DEV first.

```bash
curl -sS -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/persist/mcp/configuration" > mcp-config.json
VERSION=$(jq -r .version mcp-config.json)

jq '.configuration + {indexes: [
  { "name": "elephant_atlas", "format": "atlas-index-v1",
    "index_uri": "s3://acme-ipfs-indexes/atlas/index.json" }
]}' mcp-config.json > mcp-config-next.json

curl -sS -X PUT -H "x-api-key: $PRISM_API_KEY" -H 'content-type: application/json' \
  -H "If-Match: \"$VERSION\"" --data @mcp-config-next.json \
  "https://$PRISM_DOMAIN/persist/mcp/configuration"
```

Leave out `If-Match` when `GET` answers `source: default` with no version.

| Rule | Refusal |
| --- | --- |
| `name`: a lowercase letter, then up to 47 lowercase letters, digits or `_`; unique | `400` for a repeat |
| `format`: `atlas-index-v1` | `400` |
| `index_uri`: `s3://<bucket>/<key>`, key at most 1,024 bytes, no empty, `.` or `..` segment, no trailing `/` | `400` |
| `index_uri` not under `persist-registered-ipfs-indexes/` | `400` |
| At most 10 registrations | `400` |
| `index_uri` in the install's index bucket | `400` naming the bucket |
| Feature off | `501 RegisteredIpfsIndexesNotEnabledError` |

The `PUT` does not check that the index file exists; the sync does. Never send
`"indexes": []`; omit the field when nothing is registered.

## 4. What to expect

- The sync runs every 15 minutes, one run at a time.
- An unchanged `index.json` costs one read and writes nothing.
- A changed one is copied part by part from public gateways
  (`ipfs.filebase.io`, `ipfs.io`, `dweb.link`, `w3s.link`). Each run stops one
  minute before its 15-minute limit; verified parts stay and the next run
  fetches only what is missing. The first copy of a large index can take
  several runs.
- A new version becomes active only when every part is in. Until then the
  previous version stays active.

## 5. Verify

Have the person inspect, with their own AWS access, the index bucket under
`persist-registered-ipfs-indexes/<name>/`:

- `active.json`: `name`, `index_cid`, `version_key`, `activated_at`. It is
  written last.
- `versions/<index cid>.json`: the manifest named in `version_key`, with each
  scope (state, county, data group, FIPS, CIDs, `published_at`) and its tables
  and part keys.
- `parts/<cid>.parquet`: one object per part CID.

And the sync function's logs (the function in the Persist stack under
`RegisteredIpfsIndexSync`): one `Registered IPFS index sync` line per
registration per run, with `outcome` and `name`.

| `outcome` | Meaning | Next step |
| --- | --- | --- |
| `Activated` | Every part verified; `active.json` now points at `indexCid`. `partsFetched`, `parts`, `previousIndexCid` given. | Compare `index_cid` in `active.json` with the log. |
| `Unchanged` | The index file is the active version. Nothing written. | None. |
| `Incomplete` | Some parts still missing (`partsMissing`); up to 10 `failures`. Fetched parts are kept; the active version is unchanged. | Wait for the next runs. If `partsMissing` stops falling, check `failures`: CID mismatches, 429s or stalls on every gateway mean the content is not reachable on public gateways; ask the publisher to pin it. |
| `Failed` | The index file or a table list could not be read or verified. Nothing activated. | `does not exist`: fix the key or upload the file. Access denied or KMS errors: fix the bucket or key policy. A parse or CID message: the file is not a valid `atlas-index-v1` index; get a correct copy from the publisher. A gateway message on a table list: as for `Incomplete`. |
| `Skipped` | Not synced; nothing read or written. `reason` says why. | Outside the index bucket: the parameter changed after registration; re-register in the new bucket or restore it. Inside the cache prefix (only a registration stored before Persist #463, which now refuses it): move the index file and re-register. |

A run that fails as a whole (for example, the MCP configuration cannot be
read) logs `RegisteredIpfsIndexSyncError`; send it to Conkeldurr with the log.

## 6. Query the copy

Once a registration is `Activated`, read it through the API (or the matching
MCP tools). Ask before running anything heavy; a query reads only the active
version.

```bash
# Registrations and the active version of each (active is null until the first copy is checked)
curl -sS -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/persist/registered-ipfs-indexes"

# Scopes (STATE/county/data_group) with their tables, rows and bytes
curl -sS -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/persist/registered-ipfs-indexes/elephant_atlas"

# One table's columns, optionally in one scope
curl -sS -H "x-api-key: $PRISM_API_KEY" \
  "https://$PRISM_DOMAIN/persist/registered-ipfs-indexes/elephant_atlas?scope=FL/baker/county&table=address"

# One read-only SELECT; every table has the column atlas_scope
curl -sS -X POST -H "x-api-key: $PRISM_API_KEY" -H 'content-type: application/json' \
  -d '{"sql":"SELECT atlas_scope, count(*) AS n FROM address GROUP BY ALL ORDER BY 1","scopes":["FL/baker/county"],"max_rows":100}' \
  "https://$PRISM_DOMAIN/persist/registered-ipfs-indexes/elephant_atlas/query"
```

`address` and `FL/baker/county` are examples; take real table and scope names
from the describe answers.

- `sql` is one `SELECT` of at most 20,000 characters over the index's tables
  by name. CTEs, joins and aggregates work; other statements, table functions
  and other names are refused. `scopes` (at most 50) limits what is read; all
  scopes when omitted. `max_rows` is 1 to 1,000 (1,000 by default);
  `truncated: true` means more rows were there.
- The answer is `{ ok: true, data: { columns, rows, truncated, source } }`.
  Read `source` as the citation: `index_cid` is the index version the rows came
  from (match it with `active.json`), `generated_from` and `activated_at` date
  it, and each entry of `source.scopes` gives that scope's `archive_cid`,
  `schema_cid`, `table_list_cid`, `published_at` and, per table read, the
  Parquet `part_cids`. Quote these with any figure you report.
- A first query on a large scope downloads its Parquet parts into the query
  function and can take most of the 28 s the API waits, or exceed it (`503`).
  Repeat it: the download carries on and the next request on that instance
  reads locally. Name fewer scopes to keep it small.

| Status | Meaning | Next step |
| --- | --- | --- |
| `404` | No registration has that name. | Check `GET /persist/registered-ipfs-indexes`. |
| `409` | Registered, but no version has been copied and checked yet. | Wait for the sync; check its `outcome` (step 5). |
| `400` | The request is malformed, the SQL was refused, a scope or table is unknown, or the tables read exceed 6 GiB. | Fix the SQL, or name fewer scopes. |
| `422` | DuckDB failed on the query or it ran longer than 20 s. | Filter or aggregate more. |
| `501` | The feature is off on this install. | Step 2. |
| `502` / `503` | The copy could not be read, or the query function failed, timed out or was unreachable. | Repeat once; send a persistent one to Conkeldurr with the request id. |

## 7. Turn it off

Empty the parameter through the same Deploy `configuration`
(`{ "PersistRegisteredIpfsIndexBucketName": "" }`). The sync function and its
schedule and the query function are removed; the query routes answer `501`
and the MCP tools disappear. Stored registrations stay: `GET` still returns them, and
the next `PUT` must omit `indexes` or it gets `501`. The copy in the bucket is
not deleted; removing it is the bucket owner's decision.

## Return

Return the bucket and parameter value, the registrations and configuration
version before and after, each registration's latest `outcome`, `active.json`
contents and the part count, one query answer with its `source`, and any
builder handoff.
