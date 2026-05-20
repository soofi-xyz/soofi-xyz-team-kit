---
name: build-rag-systems
description: "Build reusable AWS RAG agents with local fixture emulation for knowledge retrieval, prior-decision reuse, semantic mapping, classification, and self-healing runtime workflows. Use when working with RAG, embeddings, OpenSearch retrieval, Bedrock embeddings, knowledge bases, schema/header mapping, confidence thresholds, AWS production RAG, or local emulation."
---

# Build RAG Systems

Use this skill to build retrieval-augmented systems as reusable agents or reusable agent capabilities. Production uses the approved AWS stack, and every implementation must include local fixture emulation that mirrors the AWS contracts and behavior.

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

### Phase 5 - Implement Local Fixture Emulation First

Create the local path before AWS adapters:

- `fixtures/rag/corpus/*.jsonl` for source and corpus records
- `fixtures/rag/queries/*.json` for input queries and expected decisions
- filesystem fixture loader for S3 contracts
- JSONL-backed metadata and review adapter for DynamoDB contracts
- deterministic retrieval adapter over fixture records for OpenSearch contracts
- local invoke script that runs the same handler or tool entrypoint as AWS

Run golden fixture replay before adding AWS adapters.

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

### Phase 8 - Replay, Roll Out, And Operate

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
- local fixture emulation flow
- human-review and learning loop, when relevant
- evaluation and operations plan
- implementation checklist

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| RAG use-case taxonomy | `rules/architecture-rag-use-case-taxonomy.md` | CRITICAL |
| AWS production and local emulation | `rules/architecture-aws-local-emulation.md` | CRITICAL |
| Corpus and metadata contract | `rules/implementation-corpus-and-metadata-contract.md` | CRITICAL |
| Retrieval and confidence policy | `rules/implementation-retrieval-and-confidence-policy.md` | CRITICAL |
| Human review and learning loop | `rules/implementation-human-review-and-learning-loop.md` | HIGH |
| Evaluation and operations | `rules/delivery-evaluation-and-operations.md` | HIGH |
