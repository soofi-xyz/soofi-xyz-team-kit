# Persist scope reconciliation

Use Conkeldurr for the Persist implementation and Uxie for configuration. This
reconciliation records the supplied 2026-09-30 product comparison; it is not a
fresh inspection of a deployed service. Verify the target revision and tests
before deciding whether a difference is a documentation error or missing code.

Treat Persist as the single-company, IAM SigV4 graph service. Preserve its
deterministic IDs, idempotent ingestion, vertex references, staged bulk loading,
read-only Gremlin queries, governed model artifacts and stream-driven indexes.
Do not restore historical API-key tenant prefixes, collection CRUD, SPARQL
updates, runtime index/trigger CRUD or webhook trigger delivery by default.

Check these reported differences explicitly when the task touches them:

- Gremlin `/explain` and the shadow-only payment-metric materializer are reported
  as implemented but underrepresented in the older instructions.
- Trigger delivery uses EventBridge, SQS/DLQ and occurrence identities. Distinguish
  emitted trigger events from the incoming `GraphFactProduced` ingestion path.
- The graph represents one company; historical per-tenant deployment wording
  does not establish the current tenancy model.
- Verify current CI recipes and Changesets behavior instead of copying the
  historical Staircase release path.
- Verify effective alarms and paging settings for the target environment; do
  not copy one environment's disabled paging into a new product requirement.

Use the detailed PRD for unaffected data invariants and implementation detail.
Where it conflicts with this comparison, inspect the service's current contract
and record the resolution. Never remove working functionality solely because
it was absent from an old instruction file.

## Requested vector-search scope (2026-10-05)

Load [the vector-search piece](vector-search.md) when embeddings or semantic/hybrid
search are requested. Treat it as a separate feature piece with its own acceptance
checkpoint. It adds Model-owned lexicon field eligibility, complete-text FTS plus
embeddings in OpenSearch, and a separate search data source composed with graph
reads in the existing GraphQL resolver layer. Preserve Gremlin/Neptune FTS without
vector extensions or a separate search endpoint.

Use this requested scope for search composition where the older PRD restricts
OpenSearch to Neptune FTS or external sources to existing entity leaf fields.
Root search discovers ranked vertex/edge IDs and needs its own explicit contract;
do not pretend the existing leaf-only adapter already provides it. Verify the
target GraphQL runtime, source ports, collection capabilities and live deployment
before claiming support. This request changes the kit's implementation guidance,
not deployed services or published API documentation.
