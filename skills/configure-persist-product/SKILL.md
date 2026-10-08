---
name: configure-persist-product
description: "Configure and test ingestion, queries, governed indexes, triggers or GraphQL vector search on an existing Persist deployment, including making a vertex or edge field searchable end to end. Use Uxie; hand service implementation changes to Conkeldurr."
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

Return configuration/version changes, observed results, learning stage,
cleanup, limitations and any builder handoff. Do not claim live verification
when only local fixtures were exercised.

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
