# Persist scope reconciliation

Use Conkeldurr for the Persist implementation and Uxie for configuration. This
reconciliation records the supplied 2026-09-30 product comparison; it is not a
fresh inspection of a deployed service. Verify the target revision and tests
before deciding whether a difference is a documentation error or missing code.

Persist has two repositories with the same engine code (`lib/`, `lambda/`):

- `prismteam-ai/persist` is the base product. Its CDK app is `marketplace/app.ts`
  and its CI publishes the `persist` component to Prism Marketplace.
- `Spring-Oaks-Capital-LLC/persist` is the SOC DEV/PROD deployment (`bin/app.ts`,
  SOC sizing, legacy SSM lexicon, SOC integrations).

Make base-product changes in `prismteam-ai/persist`; make an engine change in both
repositories until one consumes the other. Leave SOC-only wiring in the SOC
repository.

Treat Persist as the single-company, IAM SigV4 graph service. Preserve its
deterministic IDs, idempotent ingestion, vertex references, staged bulk loading,
read-only Gremlin queries, governed model artifacts and stream-driven indexes.
Do not restore historical API-key tenant prefixes, collection CRUD, SPARQL
updates, runtime index/trigger CRUD or webhook trigger delivery by default.

Check these reported differences explicitly when the task touches them:

- Gremlin `/explain` is reported as implemented but underrepresented in the
  older instructions. The shadow-only payment-metric materializer was removed;
  metrics are real-time `metric_cell`s (see the 2026-10-21 section below).
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

## Requested current-only lexicon catalog (2026-10-14)

Load [the catalog contract](lexicon-catalog.md) for lexicon/extension creation,
updates and current vertex/edge definition lookup. Maintain only the current
accepted catalog as native Neptune property-graph metadata. Reconcile stable
identities and definition hashes with an added/changed/removed diff; atomically
commit the graph changes and applied revision with optimistic concurrency.
Store no RDF/OWL semantics, historical version vertices or `latest` relationships.

Keep Model authoritative for definitions and history and Deploy responsible for
managed Model release installation. Attach graph reconciliation to Persist's
verified base/extension acceptance path; preserve existing HTTP preconditions and
business-fact ingestion. Uxie previews, configures and verifies supported behavior;
Conkeldurr builds missing APIs/runtime. This requested scope extends artifact-only
lexicon consumption in the older PRD; it does not prove deployed support or
authorize changes to services or API documentation during a kit update.

## Real-time metrics and the API-managed metrics catalog (2026-10-21)

Load [the metrics reference](metrics-catalog.md) for metric cells, backfill,
activation or catalog changes. Persist projects every payment metric into
`metric_cell` vertices from the Neptune stream through per-debt and GLOBAL FIFO
lanes, and makes definitions visible only through the activation pointer. The
catalog (v3 catalog plus its v2 base) is read from Persist's API-managed pointer
(`PUT /persist/metrics/catalog`, Persist PR #347) first, and from the
Model/Lexicon-published SSM boundary only while no pointer exists. Model stays
authoritative for definitions; Persist validates, installs and projects them.
Verify the target revision before claiming the API exists.
