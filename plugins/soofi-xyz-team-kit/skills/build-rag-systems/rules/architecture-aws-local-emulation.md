---
title: AWS Production And Local Emulation Architecture
impact: CRITICAL
tags: [rag, aws, local-emulation, vector-store, architecture]
---

# AWS Production And Local Emulation Architecture

Build the RAG capability as a reusable agent or reusable agent capability with two modes: AWS production and local emulation. Local mode uses SAM CLI for Lambda runtime emulation and OpenSearch in Docker for retrieval emulation. Local emulation gives fast confidence, but AWS replay remains the correctness gate for IAM, quotas, and managed-service behavior.

## Selection Inputs

Capture only what is needed to instantiate the approved flow:

- agent boundary: standalone agent, embedded capability, or reusable tool/library behind an agent
- AWS production account, region, and environment
- data sensitivity and residency
- expected corpus size and query volume
- latency and cost ceilings
- metadata filtering needs
- full-text, lexical, and hybrid search needs
- operational ownership

## Required Architecture Layers

Build both AWS and local modes with these layers:

1. agent invocation contract
2. corpus store for source records, chunks, examples, or decisions
3. metadata/provenance store for filters and audit
4. embedding model and batch pipeline
5. vector or hybrid search index
6. retrieval service with confidence policy
7. review/correction path
8. evaluation and observability

## AWS Production Baseline

Use this production stack:

- Lambda-compatible agent runtime using the repository's agent pattern
- Bedrock for model and embedding access
- S3 for source artifacts, corpora, exports, and evidence bundles
- DynamoDB for operational metadata, review state, idempotency, and correction records
- OpenSearch Serverless or OpenSearch Service for vector and hybrid retrieval
- SQS, EventBridge, or Step Functions only when async ingestion, refresh, re-embedding, or review workflows require them
- CloudWatch metrics/logs and LangSmith-style tracing for retrieval and AI turns
- IAM boundaries that separate read, write, review, and administration paths

Do not add alternate vector databases or relational-vector stores to the production path.

## Local Emulation Baseline

Local mode exists for development, tests, fixture replay, and operator confidence.

It must provide:

- the same request and response schemas
- the same corpus and metadata serialization
- the same normalization, retrieval, scoring, threshold, and fallback logic
- `fixtures/rag/corpus/*.jsonl` for source, chunk, mapping, decision, and review records
- `fixtures/rag/queries/*.json` for local replay inputs and expected final decisions
- filesystem fixture loader for S3 object contracts
- JSONL-backed metadata and review adapter for DynamoDB contracts
- Docker OpenSearch for local vector and hybrid retrieval
- local OpenSearch index mappings that match the production query shape as closely as practical
- seed script that creates local OpenSearch indexes and loads fixture documents from `fixtures/rag/corpus/*.jsonl`
- SAM local invocation from the synthesized CDK template
- local invoke scripts that exercise the same Lambda handler or tool entrypoint as AWS

Use this local sequence:

```bash
npx cdk synth
docker compose up opensearch
<seed-local-opensearch-command>
sam local invoke -t cdk.out/<Stack>.template.json <FunctionLogicalId> -e fixtures/rag/queries/<case>.json
```

Mock AWS services only behind interfaces. Do not let mocks change business behavior. Local replay compares retrieved IDs, threshold bands, and final decisions, not raw vector scores.

## Adapter Contract

Separate pure retrieval logic from infrastructure adapters:

- `CorpusStore`
- `EmbeddingService`
- `RetrievalIndex`
- `ReviewStore`
- `TraceSink`
- `Clock` and ID generation when deterministic tests need them

AWS and local adapters must implement the same interfaces. The OpenSearch query-building code must be shared between local and AWS modes; only endpoint/auth configuration changes. Unit tests run against local adapters, SAM local exercises the Lambda boundary, and AWS replay validates managed-service behavior.

## External Systems

External systems can be source data or callers. They are not target architectures for this skill.

## Output Requirement

Always return:

- reusable agent boundary
- AWS production stack
- SAM local and Docker OpenSearch replay flow
- adapter interfaces shared by both modes
- verification path from local replay to AWS replay
