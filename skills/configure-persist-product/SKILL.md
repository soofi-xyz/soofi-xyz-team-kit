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
   expected queries. Discover the deployment and verify AWS account/region.
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
3. After the five-minute catalog cache, confirm activation `STATUS` is in sync.
4. Backfill quarter-sized `RANGE` windows newest first, planning each before its
   confirmed run, one confirmed run at a time.
5. `ACTIVATE` only when `STATUS.gates` pass, plan first, and record the rollback
   generation. Ask before every write; work DEV first.

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
