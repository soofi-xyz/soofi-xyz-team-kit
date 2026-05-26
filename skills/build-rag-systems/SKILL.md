---
name: build-rag-systems
description: "Build reusable AWS RAG systems with OpenSearch retrieval, Bedrock embeddings, SAM local Lambda emulation, Docker OpenSearch replay, historical ingestion, and webhook refresh. Use when working with cloud RAG, embeddings, OpenSearch retrieval, moving a local SQLite/libSQL RAG POC to AWS, knowledge bases, schema/header mapping, confidence thresholds, AWS production RAG, or local emulation."
---

# Build RAG Systems

Use this skill to build retrieval-augmented systems as reusable agents or reusable agent capabilities. Production uses the approved AWS stack, and every implementation must include SAM local Lambda emulation plus Docker OpenSearch replay for fast local confidence.

RAG here includes classic document grounding, but also operational retrieval: reusing prior mappings, classifications, schemas, decisions, reviewer corrections, and examples at runtime.

## Workflow

Follow these phases in order. Do not present technology menus.

### Phase 1 - Classify The Use Case

Identify what retrieval is supposed to do:

- answer questions or ground generated text
- retrieve prior decisions, mappings, schemas, or examples
- classify documents or records
- map inconsistent CSV, Excel, JSON, or API fields
- route, enrich, validate, or self-heal a runtime workflow

Read `rules/architecture-rag-use-case-taxonomy.md`.

### Phase 2 - Define The Reusable Agent Contract

Define the contract before implementation:

- agent name or hosting agent
- trigger or tool entrypoint
- request schema
- response schema
- retrieval action: answer, classify, map, route, enrich, validate, or automate
- review and correction action, when needed

Load `../build-ai-agents/` for implementation.

### Phase 3 - Define Corpus And Metadata

Define the durable records:

- source object, chunk, or example shape
- canonical IDs, tenant/account scope, version, and ownership
- metadata filters and provenance
- reviewer, confidence, prompt/model, and decision history
- retention, PII, and audit controls

Read `rules/implementation-corpus-and-metadata-contract.md`.

### Phase 4 - Implement Retrieval Interfaces

Define pure interfaces before adapters:

- `CorpusStore`
- `EmbeddingService`
- `RetrievalIndex`
- `ReviewStore`
- `TraceSink`

The retrieval logic must include normalization, exact aliases, string similarity, Bedrock embeddings, OpenSearch vector or hybrid search, metadata filters, reranking, thresholds, top-k, and fallback.

Read `rules/implementation-retrieval-and-confidence-policy.md`.

### Phase 5 - Implement SAM Local And Docker OpenSearch Replay First

Create the local path before AWS adapters:

- `fixtures/rag/corpus/*.jsonl` for source and corpus records
- `fixtures/rag/queries/*.json` for input queries and expected decisions
- filesystem fixture loader for S3 contracts
- JSONL-backed metadata and review adapter for DynamoDB contracts
- Docker OpenSearch seeded from `fixtures/rag/corpus/*.jsonl`
- seed script that creates local OpenSearch indexes and fixture documents
- SAM local invoke path from the synthesized CDK template
- local invoke script that runs the same Lambda handler or tool entrypoint as AWS

Run this sequence before AWS replay:

```bash
npx cdk synth
docker compose up opensearch
<seed-local-opensearch-command>
sam local invoke -t cdk.out/<Stack>.template.json <FunctionLogicalId> -e fixtures/rag/queries/<case>.json
```

Compare retrieved IDs, threshold bands, and final decisions. SAM local and Docker OpenSearch provide fast confidence for handler, event, and retrieval behavior; they do not prove IAM, quotas, or managed AWS service behavior.

### Phase 6 - Add Review And Learning Loops

For runtime decisions, define what happens below confidence threshold.

- auto-accept only when calibrated
- route ambiguous matches to human review
- persist reviewed corrections as future retrieval evidence
- keep audit logs and rollback paths

Read `rules/implementation-human-review-and-learning-loop.md`.

### Phase 7 - Implement AWS Production Adapters

Use the approved stack:

- Lambda-compatible agent runtime
- Bedrock for models and embeddings
- S3 for source artifacts, corpora, exports, and evidence bundles
- DynamoDB for metadata, review state, idempotency, and correction records
- OpenSearch Serverless or OpenSearch Service for vector or hybrid retrieval
- SQS, EventBridge, or Step Functions only for async ingestion, refresh, or review workflows
- CloudWatch metrics/logs and LangSmith-style traces
- IAM boundaries

Read `rules/architecture-aws-local-emulation.md`.

### Phase 8 - Migrate Local POC Data When Present

If the project started with `../build-local-rag-pocs/`, treat the local SQLite/libSQL model as the first production corpus model:

- export `rag_sources`, `rag_chunks`, and `rag_links` to JSONL
- validate exported records with TypeScript/Zod schemas
- map chunks into OpenSearch documents with stable IDs, vector dimensions, metadata filters, and embedding version fields
- preserve source/link/idempotency state outside OpenSearch
- replay the POC's golden queries against OpenSearch before switching reads

Read `rules/implementation-local-poc-to-opensearch-migration.md`.

### Phase 9 - Load Historical Data And Add Source Refresh

After the production model is defined:

- use `../build-batch-workflows/` for historical backfill strategy, cost gates, throttling, idempotency, failed-record handling, metrics, and replay
- add source-specific webhooks after historical backfill
- use EventBridge Scheduler plus incremental polling when webhooks do not exist
- verify create, update, delete, duplicate, retry, and bad-signature cases with fixtures

Read `rules/implementation-historical-and-webhook-ingestion.md`.

### Phase 10 - Replay, Roll Out, And Operate

Run verification in this order:

1. local golden fixture replay
2. AWS replay against the same contracts
3. shadow mode
4. suggest-only mode
5. limited auto-accept canary
6. full automation with monitoring

Read `rules/delivery-evaluation-and-operations.md`.

## Required Questions

Ask only what changes the design:

- What is the reusable agent boundary and entrypoint?
- What is being retrieved: documents, chunks, examples, schemas, mappings, decisions, or records?
- What does the runtime do with retrieved evidence: answer, classify, map, route, enrich, validate, or automate?
- Which AWS account/environment is production?
- Does the corpus contain PII, regulated data, tenant-scoped data, or data that cannot enter an LLM prompt?
- What latency, cost, scale, and freshness limits apply?
- Is human review required for low-confidence matches?
- Do golden examples or reviewed historical decisions already exist?

## Non-Negotiables

1. Package RAG implementations as reusable agents or reusable agent capabilities.
2. Do not treat all RAG as document Q&A.
3. Do not use embeddings alone when exact aliases, schema metadata, or deterministic rules are available.
4. Do not auto-apply retrieval results without calibrated thresholds and a fallback path.
5. Local emulation must mirror AWS production contracts and behavior; it must not become a parallel architecture.
6. Use OpenSearch for production vector or hybrid retrieval.
7. Do not send sensitive retrieved evidence to an LLM without explicit governance.

## Output Contract

Return:

- use-case classification
- reusable agent boundary
- corpus and metadata contract
- retrieval pipeline and confidence policy
- approved AWS production stack
- SAM local and Docker OpenSearch replay flow
- human-review and learning loop, when relevant
- evaluation and operations plan
- implementation checklist
- local POC migration plan, when relevant
- historical backfill and webhook/polling ingestion plan, when relevant

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| RAG use-case taxonomy | `rules/architecture-rag-use-case-taxonomy.md` | CRITICAL |
| AWS production and local emulation | `rules/architecture-aws-local-emulation.md` | CRITICAL |
| Corpus and metadata contract | `rules/implementation-corpus-and-metadata-contract.md` | CRITICAL |
| Retrieval and confidence policy | `rules/implementation-retrieval-and-confidence-policy.md` | CRITICAL |
| Local POC to OpenSearch migration | `rules/implementation-local-poc-to-opensearch-migration.md` | HIGH |
| Historical and webhook ingestion | `rules/implementation-historical-and-webhook-ingestion.md` | HIGH |
| Human review and learning loop | `rules/implementation-human-review-and-learning-loop.md` | HIGH |
| Evaluation and operations | `rules/delivery-evaluation-and-operations.md` | HIGH |
