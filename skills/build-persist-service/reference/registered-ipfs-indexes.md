# Registered IPFS indexes

Persist can follow index documents published on IPFS (today Elephant's Atlas,
format `atlas-index-v1`), copy the Parquet data they name into an install-owned
S3 bucket after checking every byte against its CID, and later answer read-only
queries over that copy through MCP. It ships in three Persist PRs:

| Part | Persist PR | State on 2026-11-11 |
| --- | --- | --- |
| Install setting, registration in the MCP configuration, pure Atlas reader and CID checks | #458 | Merged to `main` |
| Scheduled sync into the index bucket | #461 (`feat/registered-ipfs-index-sync`) | Open |
| DuckDB query Lambda and MCP tools `list_indexes`, `describe_index`, `query_index` | PR 3 | In progress |

This is implementation guidance, not evidence of deployed support. Check the
target revision before claiming any part exists. The full rules live in the
Persist repository at `docs/agents/registered-ipfs-indexes.md`; read that file
before changing this area and add new rules there, then summarise them here.

## Terminology

Always write **registered IPFS index**. "Index" alone already means a derived
index (`docs/agents/derived-indexes.md`), and Persist also has vector chunk
indexes. Never shorten it in code, logs, docs or messages.

## Off by default: one install parameter

- `PersistStack` declares one CloudFormation parameter,
  `PersistRegisteredIpfsIndexBucketName` (`lib/persist-install-parameters.ts`):
  an S3 bucket name, or empty (the default). Naming a bucket turns the feature
  on. Keep it one parameter; a flag beside a bucket name could be on without a
  bucket.
- The condition `PersistRegisteredIpfsIndexesEnabled` is true exactly when the
  parameter is not empty.
- `registeredIpfsIndexesInstall` (`lambda/config/registered-ipfs-indexes.ts`)
  is the only answer to "is it on, and which bucket": `Off`, or `On` with
  `indexBucket`. Every handler of the feature asks it.
- Give a handler the bucket the way `registeredIpfsIndexesEnvironment` gives it
  to the REST handler: `REGISTERED_IPFS_INDEX_BUCKET` through
  `Fn::If(PersistRegisteredIpfsIndexesEnabled, <bucket>, AWS::NoValue)`.
- Build every new resource inside `underCondition(scope,
  install.registeredIpfsIndexes, () => ...)`
  (`lib/neptune-install-parameters.ts`). It puts every CloudFormation resource
  and output the callback adds, anywhere in the stack (a Lambda permission, a
  log group), under the condition. An install with the feature off then deploys
  no new resource, environment variable or grant. A CDK test asserts that every
  added resource carries the condition; keep it passing.
- `bin/app.ts` (SOC direct deploys) declares no install parameters, so the
  feature is always off there. Marketplace review installs pass no parameters
  and are off too.

## Registration rules

Registrations live in the MCP configuration's `indexes`
(`lambda/schemas/mcp-configuration.ts`), applied by
`PUT /persist/mcp/configuration`. Each is `name` (a lowercase letter, then up
to 47 lowercase letters, digits or underscores), `format` (`atlas-index-v1`)
and `index_uri`, the `s3://<bucket>/<key>` of the install's copy of the
publisher's `index.json`.

| Request | Answer |
| --- | --- |
| More than 10 registrations, or an `index_uri` that is not `s3://<bucket>/<key>` with a key of at most 1,024 bytes of S3's safe characters in segments that are not empty, `.` or `..` | `400` on any install (schema) |
| A well-formed registration while the feature is off | `501 RegisteredIpfsIndexesNotEnabledError` (`registrationIssues`) |
| A repeated `name`, or an `index_uri` outside the install's index bucket | `400` listing every issue (`registrationIssues`) |

- `501`, not `400`: no change to the request helps until the install names its
  index bucket.
- Never give `indexes` a default. The configuration's version is the sha256 of
  the stored document, so the field must stay absent while nothing is
  registered (an empty list is stored as absent). A default would change the
  version of every existing configuration on its next save.
- Turning the feature off does not delete stored registrations. `GET` still
  returns them and the next `PUT` must omit `indexes`. Anything that acts on a
  registration calls `registeredIpfsIndexesInstall` first and checks the
  registration against today's index bucket again, because the bucket can
  change between deploys.

## Untrusted gateways and CID checks

- Treat every IPFS gateway as untrusted. Use a table list only as
  `readAtlasTableList` returns it, and a Parquet part only after
  `verifyUnixFsFile` succeeds against its declared CID and byte count.
  `readAtlasIndex(...).cid` is the CID of the index's exact bytes.
- The readers return a failure for any bytes and never throw; failure messages
  are cut to 500 characters so they cannot carry the rejected document.
  `verifyUnixFsFile` stops reading once a stream passes its declared size.
- The index is the one document parsed before any CID check, so the caller
  that fetches it caps its size.
- Validation follows Elephant's own client (`@elephant-xyz/mcp`). Persist is
  stricter in two places: canonical lowercase base32 CIDv1 text and
  `{"/": <cid>}` links only in table lists, and a `published_at` offset that
  names a real instant. Mirror a change in Elephant's client instead of
  loosening a rule.
- File CIDs reproduce Kubo `add --cid-version=1 --raw-leaves` (262,144-byte
  chunks, 174 links per node, raw leaves, sha2-256). Do not add
  `ipfs-unixfs-importer` or `ipfs-only-hash`; extra packages are a risk under
  the minimum-release-age policy.

## Module boundary

`lambda/registered-ipfs-indexes/` (`atlasIndex.ts`, `contentIdentifiers.ts`,
`cache.ts`, `registration.ts`) is pure: no AWS SDK, HTTP client or MCP import,
and it runs without the network. Fetching, storage, schedules and tools live in
their own handlers (`lambda/registered-ipfs-index-sync/` for the sync) and call
into it. Fixtures under `test/fixtures/registered-ipfs-indexes/` are real Atlas
bytes named by their CIDs and excluded from Prettier.

## Sync (#461)

`lib/registered-ipfs-index-sync.ts` builds, under the condition, a Node 24
ARM64 Lambda outside the VPC (15-minute timeout, 1,024 MB, 4,096 MB ephemeral
storage), an EventBridge rule at `rate(15 minutes)` with no retries, and its log
group.

- Set `reservedConcurrentExecutions: 1`. Two runs at once could activate
  versions out of order.
- IAM: `s3:GetObject` on the whole index bucket (index files may be anywhere in
  it), `s3:ListBucket` only for prefix `persist-registered-ipfs-indexes/*` and
  `s3:PutObject` only under that prefix. No delete. A CDK test asserts this.
- Before reading anything, check the registration against
  `registeredIpfsIndexesInstall` again. A registration outside today's index
  bucket, or whose index file is inside the cache prefix, is `Skipped` with no
  read or write.

### Cache layout (`lambda/registered-ipfs-indexes/cache.ts`)

Under `persist-registered-ipfs-indexes/<name>/` in the index bucket:

| Key | Contents |
| --- | --- |
| `parts/<cid>.parquet` | One verified Parquet part per CID, shared by every version that lists it |
| `versions/<index cid>.json` | The version manifest: each scope's tables and their part keys |
| `active.json` | `{ name, index_cid, version_key, activated_at }`: the version queries read |

Persist writes nothing else in the bucket.

### Write order

1. Read the index file from S3 (capped at 16 MiB) and compute its CID. When it
   equals `active.json`'s `index_cid`, stop: `Unchanged`, nothing written.
2. Fetch every scope's table list as a raw block (capped at 4 MiB), checked
   against its CID inside the gateway attempt so a lying gateway moves on to
   the next.
3. List cached parts. A cached part counts only when its size is the declared
   byte count. Fetch each missing part to local disk, verify it, then upload
   it in one request. Write part keys only from `fetchPart`.
4. Only when every part is in, write `versions/<index cid>.json`, then
   `active.json` last: `Activated`.
5. A part that fails or is cut off by the run's deadline (Lambda time left
   minus 60 s) leaves no object. Verified parts stay; the next run fetches only
   what is missing: `Incomplete`. A large county finishes over several runs.
6. An index or table list that cannot be read or verified gives `Failed`, with
   the active version unchanged.

Each run logs one `Registered IPFS index sync` line per registration with
`outcome` (`Activated`, `Unchanged`, `Incomplete`, `Failed`, `Skipped`) and
its fields. Older versions and parts no version lists are not removed yet.

### Gateways (`lambda/registered-ipfs-index-sync/gateways.ts`)

- Elephant's defaults in order: `ipfs.filebase.io`, `ipfs.io`, `dweb.link`,
  `w3s.link`.
- A 429 retries the same gateway after `Retry-After` or a doubling wait
  (capped at 30 s, 3 retries); any other failure moves to the next gateway.
- A response must arrive within 30 s and a body may not pause for more than
  30 s.
- Read bodies with `Stream.fromReadableStream`, never an async iterator.
  Cancelling the reader releases a read stuck on a stalled body; the
  iterator's `return()` waits for it forever.

### Tests

Sync tests that depend on retries, stalls or the deadline use `it.live` so
they run on the real clock rather than the test clock. Cover: parts copied
once and activated last, nothing written when unchanged, a lying gateway, a
part that cannot be verified, a wrong-size cached part, 429 retry and
fall-through, a stalled download, the deadline, and an oversized index.

## Query (PR 3, in progress)

Do not build from details beyond these until PR 3 lands; read it first.

- A DuckDB query Lambda behind MCP tools `list_indexes`, `describe_index` and
  `query_index`.
- One read-only `SELECT` per call, reading only the active copy
  (`active.json`'s version).
- Every result carries the source CIDs it was read from.
- Three safety layers: DuckDB lockdown settings, an engine check that the
  statement is a single `SELECT`, and an IAM role limited to the cache prefix.

## Image re-pin after any `lambda/` change

The `Container images` workflow builds Fargate images for pull requests that
touch `lambda/**`, `package.json`, `pnpm-lock.yaml` and a few other inputs,
then checks that `marketplace/container-images.json` pins them. CI has no
deploy key for this repository, so it cannot commit the pins. When the check
fails with "Pins are stale", take the run id from its summary and run:

```bash
just marketplace-pin-images <run id>
git add marketplace/container-images.json
git commit -m "chore(marketplace): re-pin container images for <change>"
```

Push that commit to the same branch. The check then passes because the image
tags do not change.
