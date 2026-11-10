---
name: configure-persist-product
description: "Configure and test the current lexicon catalog, ingestion, queries, the metrics catalog with metric backfill and activation, governed indexes, triggers, GraphQL vector search or the Persist MCP server on an existing Persist deployment. Use Uxie to sync/query current definitions, install metric definitions, make a field searchable or configure MCP tools; hand engine changes to Conkeldurr."
---

Use [the Persist capability map](../guide-product-work/reference/iterations/persist.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure Persist

Use `uxie`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Read [current scope](../build-persist-service/reference/current-scope.md), then
the relevant ingest/query/index/trigger sections of the existing implementation
PRD. Verify the target revision before treating a reference as deployed behavior.
Make every request as in [Call the Persist API](#call-the-persist-api): the
shared domain plus the shared `x-api-key`, never SigV4.

For vector search, read [the separate vector-search
piece](../build-persist-service/reference/vector-search.md). Verify that the
deployment supports its GraphQL search source and root discovery contract before
configuring it. Consume approved Model-owned field eligibility and an evaluated,
pinned embedding profile; keep vector work under its own `vector-search`
checkpoint. Route missing implementation to Conkeldurr and changes to the
Lexicon `embeddings` contract itself to Dialga. Do not add vector syntax to
Gremlin. To make a field searchable, follow [Make a field
searchable](#make-a-field-searchable).

1. Establish the authorized dataset, existing model, IDs, relationships and
   expected queries. Confirm the shared domain with the person and check that
   the target revision serves the routes you need.
2. Explain one record's path through validation, ingest, persistence and read-back.
   Prepare a small fixture and independently specified expected results.
3. Author supported configuration and governed artifacts. Use the discovered
   publication procedure for indexes and triggers; do not assume runtime CRUD
   endpoints. Reuse approved model definitions and stable IDs.
4. Have the person invoke/inspect the example and describe the outcome. Retain
   request IDs, query results and observations without secrets or sensitive data.
5. Test invalid graph edges, duplicate ingestion/replay, expected query output
   and affected index/trigger behavior. Verify asynchronous completion separately
   from request acceptance. Record any side effects and sample cleanup.
6. Hand missing capabilities or defects to `conkeldurr`. Do not broaden the data
   scope, edit the engine or provision another Persist instance to make tests pass.

When an install fails at `Custom::MarketplaceImageAccess`, or async Gremlin fails
with `GremlinAsyncWorkerImagePullFailed`, follow [the Marketplace image access
contract](../guide-product-work/reference/marketplace-image-access.md). Access is
granted by the install itself. For a `403`, the account must be listed in
Marketplace's configuration (hand it to Regigigas). Never edit the registry policy.

Return configuration/version changes, observed results, learning stage,
cleanup, limitations and any builder handoff. Do not claim live verification
when only local fixtures were exercised.

## Call the Persist API

Call every Persist route at `https://<shared domain>/persist/...` with the
environment's shared key in `x-api-key`. This is the only way to reach Persist
when configuring it. Do not use SigV4, `awscurl`, an `execute-api` URL, the
`persist-api-url` parameter or `ApiUrl` output, or the cross-account invoke role.

- Get the shared domain from the person or their environment as
  `PRISM_DOMAIN` (for example `soofi-safavi.account.prismteam.ai`). Do not read
  it from SSM, stack outputs or any other AWS source.
- The person exports the key in their own terminal as `PRISM_API_KEY`. Never
  read it from AWS, print it or ask for it in chat; refer to it only as
  `$PRISM_API_KEY`, as in [the MCP client setup](reference/mcp-client-setup.md#key).
- This API serves the REST routes (`/persist/ingest`, `/persist/gremlin`,
  `/persist/lexicon...`, `/persist/metrics/catalog`, `/persist/process-triggers...`
  and the rest), `POST /persist/graphql`, `GET /persist/graphql/schema`,
  `/persist/mcp` and `/persist/mcp/configuration`. It alone serves
  `POST /persist/csv-loads` and `GET /persist/csv-loads/{loadId}`.
- Configuration writes are accepted with the key; ask before each one.
- GraphQL treats a key caller as the `shared-api-key` principal and withholds
  every PII-restricted field (`ssn_last_four`, `full_ssn`). A `null` there is
  the policy, not missing data.
- `403 {"ok":false,"error":{"type":"Forbidden","message":"A valid x-api-key header is required."}}`
  means the key is missing or wrong: have the person check their own
  environment. `404` means the route is unknown or the revision lacks it.
- Marketplace installs always have this API. A SOC CDK deploy has it only when
  deployed with `--context sharedApiDomainName=<fqdn>`. If the target has no
  `persist` mapping on the shared domain, hand that to Conkeldurr; do not fall
  back to SigV4.

```bash
# The person sets the key in their own profile: export PRISM_API_KEY='<shared x-api-key>'
# and the shared domain they gave you: export PRISM_DOMAIN='soofi-safavi.account.prismteam.ai'

curl -sS -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/persist/metrics/catalog"

curl -sS -X POST -H "x-api-key: $PRISM_API_KEY" -H 'content-type: application/json' \
  -d '{"gremlin":"g.V().limit(1).count()"}' "https://$PRISM_DOMAIN/persist/gremlin"
```

### Load Neptune CSV

`POST /persist/csv-loads` starts the Neptune CSV workflow and returns 202 with
its `load_id`. It takes the workflow input (`vertices_s3_uri` and
`edges_s3_uri`; a shared `s3_uri` prefix needs the `persist-spark` job, so
Marketplace installs refuse it with 400) and optional `load_id` (`[A-Za-z0-9_-]{1,80}`). A
retry with the same `load_id` and input returns the same run; different input
returns 409. `GET /persist/csv-loads/{loadId}` returns `RUNNING`, `SUCCEEDED`,
`FAILED`, `TIMED_OUT` and so on. `callback.task_token` is for Step Functions
callers and cannot be combined with `load_id`.

```bash
curl -sS -X POST -H "x-api-key: $PRISM_API_KEY" -H 'content-type: application/json' \
  -d '{"load_id":"fixture-001","vertices_s3_uri":"s3://<bucket>/run/vertices/","edges_s3_uri":"s3://<bucket>/run/edges/"}' \
  "https://$PRISM_DOMAIN/persist/csv-loads"
curl -sS -H "x-api-key: $PRISM_API_KEY" "https://$PRISM_DOMAIN/persist/csv-loads/fixture-001"
```

## Sync or query the current lexicon catalog

For “sync this lexicon”, “refresh this extension” or current vertex/edge schema
lookup, follow [Configure with Uxie](../build-persist-service/reference/lexicon-catalog.md#configure-with-uxie).
Discover supported APIs and resolve the approved source, target and scope from
context. Present a digest-bound diff preview, coordinate managed release
installation with Skarmory, and reconcile an already accepted source only through
a supported Persist operation. Apply within the user's existing authorization.
Give a copyable read-only Gremlin query and compare its result with the applied
source digest. Verify a no-op repeat and scoped removal without changing facts.
Report absent preview/reconciliation support as a Conkeldurr gap; never simulate
it with direct graph writes or invent endpoint names. Keep only current metadata
in the graph; do not introduce historical versions, `latest` links or RDF/OWL.

## Install metric definitions, backfill and activate

For “install these metrics”, “backfill this metric” or “activate the new
metrics”, follow [Configure with Uxie](../build-persist-service/reference/metrics-catalog.md#configure-with-uxie).
Confirm `PUT /persist/metrics/catalog` exists in the target revision; without it,
report the catalog as Model/Lexicon-published and hand the gap to Conkeldurr.

1. Install only an approved Model catalog release; send definition authoring to
   Jirachi. Read `GET /persist/metrics/catalog` and stop at `source: legacy-ssm`
   until the Model owners retire that boundary.
2. `PUT` `{ catalog, base }` with `If-Match` on the version read. Treat a 400 as
   the compile report and fix the catalog through Model, never by editing it here.
   Deliver the catalog through the configuration bundle repository (see
   [Configurer delivery](../guide-product-work/SKILL.md#configurer-delivery)).
   No Deploy adapter or Build bundle kind accepts a metrics catalog yet, so
   this `PUT` is a test-only exception; record the gap for Corviknight (Deploy
   adapter) and Tinkaton (bundle kind) and tell the person.
3. After the five-minute catalog cache, confirm activation `STATUS` is in sync.
4. Backfill quarter-sized `RANGE` windows newest first, planning each before its
   confirmed run, one confirmed run at a time.
5. `ACTIVATE` only when `STATUS.gates` pass, plan first, and record the rollback
   generation. Ask before every write; work DEV first.
6. For MEETING and PERSON definitions, follow [Backfill and verify meeting and
   person scopes](../build-persist-service/reference/metrics-catalog.md#backfill-and-verify-meeting-and-person-scopes):
   one scope at a time, then compare cells with direct graph counts using a
   read-only check script.

## Check per-user access

Persist can scope a signed-in person to the records connected to them. It is
[requested build scope](../build-persist-service/reference/user-scoped-access.md);
confirm the target supports it before testing, and send a gap to `conkeldurr`.

- The shared key is the environment. It reads everything and cannot show what a
  person sees. Check per-user access with two test users signed in through
  Access, each calling `POST /persist/graphql` with their own session.
- Have `doublade` connect one test user to an anchor record through the Access
  API. Never ingest user records or access edges yourself.
- Compare both users on a list, a lookup by identifier, a count and a search.
  Expect the connected user's records for the first and nothing, with a lookup
  answering not found, for the second.
- Confirm a signed-in non-administrator is refused on `/persist/gremlin`,
  `/persist/ingest` and `/persist/mcp`, and that your shared-key calls still work.
- Have `doublade` revoke the connection and repeat the read.

## Configure the MCP server

For “connect Cursor to Persist”, “turn off this tool”, “lower the row limit” or
“add a saved query”, read [the MCP server contract](../build-persist-service/reference/mcp-server.md).
Confirm `/persist/mcp` and `GET /persist/mcp/configuration` exist in the target
revision; otherwise hand the gap to Conkeldurr.

1. Connect clients with [the client setup](reference/mcp-client-setup.md). The key
   stays in the person's environment and the client header; never in chat,
   arguments or results.
2. Read the configuration and its version. `PUT` enabled tools, limits (rows,
   timeout, search results, reader target) and saved queries with `If-Match`.
   Saved queries are read-only parameterised Gremlin; a `400` names the refused step.
3. After the cache window, confirm `tools/list` reflects the change and a saved
   query appears as `query_<name>`, without a redeploy.
4. Verify against direct queries: meeting count, mixed epoch-ms/ISO `started_at`
   range, a cited `search` result and a refused write. Ask before every `PUT`;
   work DEV first.

## Make a field searchable

When asked to make a vertex or edge property searchable through GraphQL
`search`, follow [the searchable-fields runbook](reference/searchable-fields.md)
and its rules in order. Confirm first that the capability is merged and
deployed in the target account.

1. [Decide the field and its PII status](rules/search-field-decision.md).
2. [Declare the embedding in a Lexicon PR](rules/search-lexicon-declaration.md),
   reviewed by the Model owners.
3. [Allowlist the S3 location](rules/search-blob-allowlist.md) for `blob_text`.
4. [Build a generation](rules/search-backfill.md).
5. [Promote, roll back and retire](rules/search-generation-control.md).
6. [Verify search and recall](rules/search-verify.md).
7. [Operate safely](rules/search-operations.md): shared DEV, deletion
   behavior, alarms, data handling and PROD approval.

Route new chunking strategies, content types, embedding models or profiles to
Conkeldurr.
