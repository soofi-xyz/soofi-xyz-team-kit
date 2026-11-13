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

Confirm the target revision first: the install must run a Persist release
with registration (#458), the sync (#461), the query routes and tools (#463)
and the query bounds (#469). All four were released on 2026-11-12, and the
feature has been live in soofi-safavi since then. An install on an older
bundle needs a Persist upgrade first; send a missing piece to `conkeldurr`.
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
- Prefer a dedicated bucket over an install-owned configuration bucket: the
  sync role reads every object in the index bucket. soofi-safavi uses
  `persist-ipfs-indexes-<account>-<region>`, created outside any stack with
  SSE-S3, versioning on and all four public-access blocks on, tagged
  `owner=persist-registered-ipfs-indexes`.
- Upload the publisher's `index.json` byte for byte, after checking its CID.
  For Atlas, take the file from the newest `Publish index.json <cid>` commit
  on `elephant-xyz/atlas` `main` (`git show <commit>:index.json`); an index
  under 256 KiB is one raw block, so its CIDv1 is `raw` + sha2-256 of the
  bytes. Stop if it differs from the CID in the commit message.

```bash
aws s3api put-object --bucket <bucket> --key elephant-atlas/index.json \
  --body index.json --content-type application/json --metadata ipfs-cid=<cid>
aws s3api get-object --bucket <bucket> --key elephant-atlas/index.json check.json && cmp index.json check.json
```

- Creating the bucket and uploading are AWS changes in the install's account:
  ask first, and use the person's own AWS access.

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
- Turning it on adds the sync function, its schedule, role and log group, the
  query function (reserved concurrency 4), its role and log group, and the
  invoke grants for the REST and MCP functions. Nothing else changes.

On a Puller subscription:

- `PATCH` replaces the whole `configuration` map. Read the subscription
  first and send every existing key with the new one, with `expected_version`
  set to the version you read.
- Add the key only once the newest VALID Persist bundle declares it: Deploy
  fails the install for a configuration key the template does not declare.
- A subscription on `update_policy: PAUSED` installs nothing. Setting it to
  `AUTO` in the same `PATCH` installs the newest VALID bundle, which carries
  every release published since the pause, not only this feature. Ask who
  paused it and why before resuming, and say so to the person.
- Start the install at once with
  `POST /deploy/puller/reconciles {"product_id","component_id":"persist"}`,
  then follow `GET /deploy/puller/installs/<product>/persist?limit=1` until
  the attempt is `SUCCEEDED` (about 10 minutes in soofi-safavi).
- Check the result read-only: the `PersistStack` parameter
  `PersistRegisteredIpfsIndexBucketName` equals the bucket, the stack lists
  the `RegisteredIpfsIndexSync*` and `RegisteredIpfsIndexQuery*` resources,
  and `GET /persist/registered-ipfs-indexes` answers `200 {"indexes": []}`.

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

The `PUT` answer carries the new `version` and `changed`, not the
configuration. `GET` again and confirm the live configuration equals what you
sent: `indexes` added, `saved_queries` count and every other field unchanged.

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
- Public gateways rate-limit. In soofi-safavi the first copy of Atlas (382
  parts) verified 381 parts in one 8.5-minute run; the last answered HTTP 429
  on all four gateways and arrived with the next scheduled run, which reported
  `Activated`. One or two `Incomplete` runs are normal.
- To avoid waiting 15 minutes for the first run, the person (or you, with
  their approval and AWS access) can invoke the sync function once:
  `aws lambda invoke --function-name <RegisteredIpfsIndexSyncFunction> --cli-read-timeout 960 out.json`.
  Its answer is the same `outcomes` the log shows. Reserved concurrency is 1,
  so it is throttled while a scheduled run is in progress.
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
| `400` (`QueryRefusedError`, "The rows would take more than … bytes of JSON") | The rows passed the 4 MiB answer limit. | Select fewer columns or rows, or aggregate. |
| `400` ("… that name is reserved") | A selected column is named `registered_ipfs_index_query`. | Rename the column. |
| `422` | DuckDB failed on the query or it ran longer than 20 s. | Filter or aggregate more. The message quotes the wrapped SQL; the part after `FROM (` is the caller's. |
| `501` | The feature is off on this install. | Step 2. |
| `503` "Every registered IPFS index query slot is in use" | 4 queries are already running. | Retry shortly. |
| `502` / `503` | The copy could not be read, or the query function failed, timed out or was unreachable. | Repeat once; send a persistent one to Conkeldurr with the request id. |

### Querying Elephant's Atlas

- Scopes are `STATE/county/data_group`. Property data is in
  `<ST>/<county>/county`; **permits are the `property_improvement` table in
  the separate `<ST>/<county>/property_improvement` scope** (Travis County: 1.99
  million permits on 237,540 properties); some counties also have
  `property_management`.
- Entities carry `cid` and `property_cid`; relationship tables
  (`property_has_address`, `property_has_sales_history`, …) join through
  `from_cid` and `to_cid`. Take column names from `describe_index` with
  `table`; do not guess.
- Dates are `VARCHAR` (`2011-04-07`): use `left(date, 4)` or
  `try_cast(date AS DATE)`, not `year(date)`.
- Some sources do not publish every field. Texas does not disclose sale
  prices, so Travis `purchase_price_amount` is empty; say so rather than
  reporting a null median as a finding.
- `source_http_request` on each record is the exact request to the county's
  source (for Travis permits, Austin's open-data portal); cite it with the
  part CIDs when a person asks where a figure came from.
- Expect 1 to 2 s per query once parts are local (see the builder reference's
  live evidence).

## 7. Keep the copy current

Persist reads the install's copy of `index.json`, not IPFS, so the copy goes
stale when the publisher publishes again. For Elephant's Atlas, the publish
workflow of `elephant-xyz/atlas` has an `index-s3` job (atlas #123) that, after
each publish, checks the new `index.json` against its CID and uploads it to
S3. It runs only when the repository variable `ATLAS_INDEX_S3_URI` is set.

1. In the install's account, create a role GitHub Actions can assume through
   the account's `token.actions.githubusercontent.com` OIDC provider:
   - trust: `aud` = `sts.amazonaws.com` and `sub` =
     `repo:elephant-xyz/atlas:ref:refs/heads/main` (the job runs on pushes to
     `main` and manual runs from it; it uses no GitHub environment);
   - permissions: only `s3:PutObject` on the one object, for example
     `arn:aws:s3:::<bucket>/elephant-atlas/index.json`.

   soofi-safavi's is `atlas-index-s3-upload`. Creating an IAM role is an
   identity change: ask first, and expect the person to run it.
2. On `elephant-xyz/atlas` (repository admin needed), set the variables
   `ATLAS_INDEX_S3_URI` (`s3://<bucket>/elephant-atlas/index.json`),
   `ATLAS_INDEX_S3_ROLE_ARN` and `ATLAS_INDEX_S3_REGION`. Set the region: the
   job defaults to `us-east-1`.
3. After the next Atlas publish, check that the `index-s3` job succeeded and
   that the sync's next run logs `Activated` with the new `indexCid`.

One Atlas repository serves one install this way; a second install needs its
own copy step.

## 8. Turn it off

Empty the parameter through the same Deploy `configuration`
(`{ "PersistRegisteredIpfsIndexBucketName": "" }`). The sync function and its
schedule and the query function are removed; the query routes answer `501`
and the MCP tools disappear. Stored registrations stay: `GET` still returns them, and
the next `PUT` must omit `indexes` or it gets `501`. The copy in the bucket is
not deleted; removing it is the bucket owner's decision. On a Puller
subscription the `PATCH` still sends every other key. Unset the Atlas
variables too (or the publish keeps uploading to a bucket nobody reads).

## Return

Return the bucket and parameter value, the Atlas copy step (role and variables), the registrations and configuration
version before and after, each registration's latest `outcome`, `active.json`
contents and the part count, one query answer with its `source`, and any
builder handoff.
