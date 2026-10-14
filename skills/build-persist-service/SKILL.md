---
name: build-persist-service
description: "Build or maintain Persist graph ingestion, queries, indexes, triggers and lexicon-governed vector search through GraphQL. Use Conkeldurr; use Uxie for particular configurations."
disable-model-invocation: true
---

Use [the Persist capability map](../guide-product-work/reference/iterations/persist.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Build Persist

Use `conkeldurr` for the reusable product implementation and `uxie` for
configuration on an existing deployment. Follow
[guide-product-work](../guide-product-work/SKILL.md) and
[engineering guidelines](../apply-engineering-guidelines/SKILL.md).

Read [current scope](reference/current-scope.md) before the detailed PRD. Resolve reported differences against the target revision.

For embeddings or semantic/hybrid search, load [the separate vector-search
piece](reference/vector-search.md). Keep its eligibility consumption, model
evaluation, embedding/index maintenance and GraphQL search composition together
under `vector-search`, with its own user-run configuration and AWS checkpoint.
Use a separate GraphQL search data source and resolver composition; preserve
the existing Gremlin/Neptune FTS surface. Route lexicon declaration changes to
Model's assigned agents; keep physical source routing in Persist's resolution map.

Read relevant [implementation details](reference/PRD.md) under that reconciliation. Discover the
target repository, revision and environment. Reuse an existing service when
appropriate; agent availability does not prove deployment or feature support.

Separate historical requirements, current implementation and live evidence.
Where references conflict, inspect the target contract and tests and record the
resolution. Do not silently restore obsolete features or remove working behavior.

Use supporting skills directly for workflow capacity, metrics and model reasoning.
Resolve other products through the catalog. Do not use a general platform owner.
Use Registeel for Marketplace publication; keep deployment prerequisites explicit.

Derive the scoped feature plan from the shared workflow and product capability
map. Require a user-run configuration and AWS inspection after every piece. Return the
implementation changes, verification results, human observations, current stage
and any remaining runtime or integration gaps.
