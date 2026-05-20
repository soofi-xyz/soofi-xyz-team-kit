---
title: AWS Production And Local Emulation Architecture
impact: CRITICAL
tags: [rag, aws, local-emulation, vector-store, architecture]
---

# AWS Production And Local Emulation Architecture

Build the RAG capability as a reusable agent or reusable agent capability with two modes: AWS production and local fixture emulation. Local mode must mirror production contracts and retrieval behavior; it is not a separate target architecture.

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
- deterministic retrieval adapter over fixture records for OpenSearch contracts
- local invoke scripts that exercise the same agent turn or retrieval handler

Mock AWS services only behind interfaces. Do not let mocks change business behavior. Local replay compares retrieved IDs and final decisions, not raw vector scores.

## Adapter Contract

Separate pure retrieval logic from infrastructure adapters:

- `CorpusStore`
- `EmbeddingService`
- `RetrievalIndex`
- `ReviewStore`
- `TraceSink`
- `Clock` and ID generation when deterministic tests need them

AWS and local adapters must implement the same interfaces. Unit tests should run against local adapters; integration or smoke tests should run against AWS adapters.

## External Systems

External systems can be source data or callers. They are not target architectures for this skill.

## Output Requirement

Always return:

- reusable agent boundary
- AWS production stack
- local fixture emulation flow
- adapter interfaces shared by both modes
- verification path from local replay to AWS replay
