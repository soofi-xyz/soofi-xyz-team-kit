---
name: build-persist-service
description: "Build or maintain Persist graph ingestion, queries, a current-only lexicon catalog, real-time metrics and their API-managed catalog, indexes, triggers, lexicon-governed vector search through GraphQL and the read-only Persist MCP server. Use Conkeldurr; use Uxie for particular configurations."
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

## Current-only lexicon catalog

For base lexicons, extensions and vertex/edge definition updates, load
[the catalog contract](reference/lexicon-catalog.md). Build feature `lexicon-catalog`
as native property-graph metadata containing only the current accepted definitions.
Reconcile complete snapshots by stable identity and content hash, including
deletions, and commit the diff plus revision atomically with an expected-revision
check. Keep versions out of IDs and retain history in Model artifacts, not graph
vertices. Preserve business facts, extension scope and Deploy installation
ownership. Deliver the HTTP preview/reconciliation/status surface and Gremlin
read-back needed by Uxie; verify actual support before claiming availability.

## Real-time metrics and the metrics catalog

For metric cells, backfill, activation or catalog acceptance, load [the metrics
reference](reference/metrics-catalog.md) and build feature `metrics`. Accept the
catalog (v3 catalog plus v2 base) through `PUT /persist/metrics/catalog` on the
shared configuration-source pattern: API pointer first, Model/Lexicon SSM only
for a definitively missing pointer, 409 while that boundary resolves, and the
real loader compiled for DEV and PROD before any write. Keep one writer per cell,
visibility through the activation pointer only, and backfill as notices into the
same lanes. Route definition and catalog-schema changes to Model's agents.

Meeting and person scopes use the same engine as debts. For the four
meeting-report capabilities (business time off the scope path, three-hop paths,
two edges to the same vertex, Person-or-Email unions), follow the reference's
capability sections: generic opt-in shapes, read-plan routing in `routingPlan`
and `MetricStreamScopeResolver`, TinkerGraph positive, negative and update-path
fixtures, unchanged debt and payment plans, and one merge that ships to
Marketplace and SOC.

## MCP server

For MCP tools at `/persist/mcp`, load [the MCP server contract](reference/mcp-server.md)
and build pieces `mcp-endpoint`, `mcp-graph-query`, `mcp-search`,
`mcp-configuration` and `mcp-metrics`, each with its own checkpoint. Serve it as a
stateless Streamable HTTP Lambda on the keyed shared REST API, calling services in
process. Enforce read-only in layers (no write imports or permissions, Neptune
reader, Gremlin step allowlist, GraphQL mutation refusal) and keep the key out of
arguments, results and logs. Derive tool schemas from the route schemas with a
contract test. Report owns its own server; do not build one across products.

## Marketplace image access

For Fargate images or the Marketplace bundle, load [the Marketplace image access
contract](../guide-product-work/reference/marketplace-image-access.md). The bundle
runs digest-pinned images from `marketplace/persist`, and `Custom::MarketplaceImageAccess`
in `NeptuneStack` grants the installing account pull access while the stack exists.
Make every image-running stack depend on `NeptuneStack`. Update images by copying
them into `marketplace/persist`, then changing `marketplace/container-images.json`.
Never edit the registry policy or add pull grants by hand.

## Verification and handoff

Derive the scoped feature plan from the shared workflow and product capability
map. Require a user-run configuration and AWS inspection after every piece. Return the
implementation changes, verification results, human observations, current stage
and any remaining runtime or integration gaps.
