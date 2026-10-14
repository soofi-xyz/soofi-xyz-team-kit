# Persist vector-search piece

Use feature ID `vector-search` for embeddings, vector indexing and semantic/hybrid
search composed through GraphQL. Keep this work in a separate piece from ordinary
graph queries, derived indexes and triggers, with its own user-run configuration
and AWS acceptance checkpoint. Follow [current scope](current-scope.md) and
[the shared workflow](../../guide-product-work/SKILL.md). Treat this document as
requested implementation guidance, not evidence that a deployment supports it.

## Ownership and inputs

- Consume a versioned Model/Lexicon declaration of which vertex and edge
  properties are eligible for embedding. Route declaration/schema changes to
  Dialga and particular Model configurations to Jirachi. Do not infer eligibility
  from property names, values or caller-supplied flags.
- Require the declaration to identify the owner type, property and supported
  content interpretation, including language/chunking policy where needed.
  Validate supported types, multi-value handling and blob-content eligibility.
  Reject unknown properties or unsupported content rather than embedding it.
- Keep physical OpenSearch locations, model/provider configuration and GraphQL
  source routing in Persist-owned versioned artifacts. Do not place deployment
  topology in the shared ontology. Use Uxie to configure supported deployments.
- Discover the target repository/revision, verified AWS account/region, canonical
  lexicon, GraphQL runtime, resolution-map/source ports, OpenSearch collection
  type/version and current FTS behavior before implementation. Preserve
  deterministic graph IDs and Neptune as the authority for graph facts.

## Select the embedding profile

Research currently available embedding models at implementation time using
primary provider documentation and relevant retrieval benchmarks. Select the
best retrieval quality for representative eligible fields, languages and queries
within the deployment's latency/cost requirements. Compare lexical-only,
vector-only and hybrid retrieval with independently judged relevant results;
measure Recall@k, nDCG@k, latency and embedding/index cost. Do not equate a release
date, vendor leaderboard or general similarity score with best corpus retrieval.

Use Cohere `embed-v5.0-pro` and Voyage `voyage-4-large` as research candidates
verified on 2026-10-05, not permanent winners. Recheck release status, access and
deployment availability before selecting a provider. Pin the evaluated model,
provider, output dimensions/representation, metric and preprocessing/chunking
version in an embedding profile; record the evaluation and selection date.
Use the provider's document/query input modes and compatible embedding spaces.
Do not mix arbitrary model versions or dimensions in one searchable generation.

## Preserve complete text and maintain derived vectors

- Index every eligible property's complete text in FTS-compatible form and store
  its numeric embeddings separately. Preserve Neptune's entity document shape
  (`entity_id`, `entity_type`, `document_type`, `predicates.<property>.value`) for
  existing FTS reads. Keep existing indexing of unmarked properties compatible;
  exclude those properties from embeddings.
- Embed a short property value whole. For longer values, use deterministic,
  content-aware chunks with complete coverage and offsets; retain the complete
  FTS text. Do not summarize, silently truncate or embed the serialized FTS JSON.
  Add only lexicon-approved semantic context to the embedding input.
- For an explicitly eligible blob, read its authorized source content, not the
  persisted S3 URI string. Preserve that URI in the canonical graph and existing
  FTS contract; index the extracted text in the search projection. Version any
  extraction policy and surface unsupported/failed extraction.
- Store entity kind/ID, owner label, property, value/chunk identity, offsets,
  content hash, lexicon/profile version and index generation with each vector.
  Aggregate chunk matches to distinct vertex/edge hits; avoid favoring entities
  merely because they contain more chunks.
- Verify collection support for vector mappings, filters, updates/deletes,
  stable document identity and ranking before choosing a layout. Add vectors to
  compatible entity documents or use a companion text/vector chunk index when
  necessary. Preserve the direct index target required by existing Neptune FTS;
  do not assume the current `SEARCH` collection can accept dense vectors.
- Build from committed graph changes and a watermark-based backfill. Batch and
  cache embeddings by content hash plus profile, make writes/replays idempotent,
  retry bounded failures and advance checkpoints only after required writes
  succeed. Keep vector processing state independent where necessary so provider
  failure does not block existing FTS replication.
- Reconcile deletions, obsolete chunks and eligibility removals, including a
  lexicon change without a graph event. Prevent delayed jobs from restoring
  stale content. Expose queue/backfill status, embedding failures and search lag.
  Verify supported HTTP submission, status and result retrieval for asynchronous
  rebuild work; a workflow execution alone is not API acceptance evidence.
- Upgrade profiles through a separate evaluated index generation, backfill,
  catch-up and controlled promotion. Keep a verified rollback generation and
  ensure each request/cursor uses one compatible profile and generation.

## Compose search in GraphQL

Use the existing read-only GraphQL endpoint and its verified runtime. Add a
separate search data source; keep ranking and search-hit/graph merging in the
GraphQL resolver composition layer. Preserve Gremlin and `Neptune#fts` without
vector syntax, a new Gremlin search selector or a standalone search endpoint.

1. Define a governed root-search contract for lexical, semantic and hybrid modes,
   eligible type/property selection, supported filters, bounded page size and
   opaque cursors. Derive discoverable types and edge wrappers from the lexicon;
   keep physical source selection in the Persist-owned resolution map. Treat
   proposed field names as design examples until verified in the target schema.
2. Extend the resolution-map contract and generic schema/registry support for
   root discovery explicitly. The existing `SourceResolver.batchLoad` resolves
   leaf fields on known parents; it cannot discover ranked entities merely by
   registering another leaf adapter. Introduce a typed root-search capability
   while preserving existing leaf adapters and their contracts. Do not add
   source-specific branching to the GraphQL executor or schema generator.
3. Have the search adapter own OpenSearch transport and return bounded lexical
   and vector candidate hits with entity kind/ID, matched property/chunk and rank
   or score metadata. Use an injected embedding provider for semantic queries.
   Apply authorized scope and requested filters to both retrieval arms before
   selecting candidates; do not rely only on post-hydration filtering.
4. Merge rankings in a testable GraphQL composition service. Collapse chunk hits
   per entity before fusion; use reciprocal rank fusion (or an evaluated score
   normalization strategy), not addition of raw BM25 and vector scores. Document
   the candidate budget and ranking/pagination policy. If FTS syntax is supported
   in lexical mode, define its interpretation in hybrid mode explicitly.
5. Hydrate ranked IDs through the existing batched graph loaders, preserving
   entity kind, score and order. Resolve canonical properties/relationships from
   Neptune; expose search-derived match metadata separately. Keep adapters
   independent: composition coordinates search and graph reads, rather than the
   search adapter calling the graph adapter. Avoid N+1 reads and handle stale or
   deleted hits with bounded refill and explicit freshness behavior.
6. Bind cursors to query/filter identity, ranking policy and index generation;
   verify stable page behavior under the supported consistency model. Surface
   source-specific errors/lag while preserving unrelated GraphQL selections.
   Do not silently return lexical results labelled as successful hybrid search
   after embedding failure. Keep guards, deadlines and read-only IAM explicit;
   add only the required search reads and query-embedding permissions.

## Verify and close this piece

Prepare a marked vertex text field, a marked edge text field, an unmarked field
and a long eligible value. Include an eligible blob only if that contract is
supported. Prove complete FTS coverage and meaning-based retrieval with a query
whose relevant result does not require literal keyword overlap. Exercise lexical,
semantic and hybrid modes and verify graph hydration preserves ranked identity.

Include invalid eligibility, wrong-profile/dimension rejection, provider timeout,
duplicate replay, graph deletion, lexicon eligibility removal, stale-job rejection
and generation rollback. Verify existing Gremlin FTS and GraphQL source isolation,
batching and partial-failure behavior. Do not claim runtime evidence from mocks.

Have the user run the search configuration and a materially different mode or
field selection, then inspect the verified AWS index/backfill state and correlated
GraphQL/source logs. Compare expected hits, graph IDs, versions, lag and errors.
Record this piece's request/execution IDs, observations and acceptance separately
before advancing to another feature. Return profile evaluation, active artifact
versions/generation, migration/rollback evidence and remaining deployment gaps.

## Research references

Recheck these primary sources when selecting or implementing the capability:

- [Neptune's OpenSearch entity document model](https://docs.aws.amazon.com/neptune/latest/userguide/full-text-search-model.html)
- [Neptune FTS query types](https://docs.aws.amazon.com/neptune/latest/userguide/full-text-search-parameters.html)
- [OpenSearch reciprocal rank fusion](https://docs.opensearch.org/latest/search-plugins/search-pipelines/score-ranker-processor/)
- [OpenSearch Serverless neural/hybrid support](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-configure-neural-search.html)
- [Cohere Embed 5 release and retrieval evaluation](https://cohere.com/blog/embed-5)
- [Voyage embedding models](https://docs.voyageai.com/docs/embeddings)
