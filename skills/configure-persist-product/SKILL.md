---
name: configure-persist-product
description: "Configure and test a particular ingestion, query, governed index or trigger on an existing Persist deployment. Use Uxie; hand service implementation changes to Conkeldurr."
---

Use [the Persist capability map](../guide-product-work/reference/iterations/persist.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure Persist

Use `uxie`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Read [current scope](../build-persist-service/reference/current-scope.md), then
the relevant ingest/query/index/trigger sections of the existing implementation
PRD. Verify the target revision before treating a reference as deployed behavior.

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
