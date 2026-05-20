---
title: AWS Production And Local Emulation Architecture
impact: CRITICAL
tags: [rag, aws, local-emulation, vector-store, architecture]
---

# AWS Production And Local Emulation Architecture

Design the RAG capability as a reusable agent or reusable agent capability with two modes: AWS production and local emulation. Local mode must mirror production contracts and retrieval behavior; it is not a separate target architecture.

## Selection Inputs

Capture:

- agent boundary: standalone agent, embedded capability, or reusable tool/library behind an agent
- AWS production account, region, and environment
- data sensitivity and residency
- expected corpus size and query volume
- latency and cost ceilings
- metadata filtering needs
- full-text, lexical, and hybrid search needs
- existing AWS databases, object stores, queues, and search services
- operational ownership

## Required Architecture Layers

Design both AWS and local modes with these layers:

1. agent invocation contract
2. corpus store for source records, chunks, examples, or decisions
3. metadata/provenance store for filters and audit
4. embedding model and batch pipeline
5. vector or hybrid search index
6. retrieval service with confidence policy
7. review/correction path
8. evaluation and observability

## AWS Production Baseline

Use AWS production services that fit the corpus and retrieval policy:

- Lambda-compatible agent runtime using the repository's agent pattern
- Bedrock for model and embedding access when applicable
- S3 for source artifacts, corpora, exports, and evidence bundles
- DynamoDB for operational metadata, review state, idempotency, and correction records
- Aurora PostgreSQL or RDS PostgreSQL with pgvector when relational ownership and moderate-scale vector search fit
- OpenSearch Serverless or OpenSearch Service when hybrid lexical/vector search, filtering, and larger retrieval workloads matter
- SQS, EventBridge, or Step Functions for ingestion, refresh, re-embedding, and review workflows
- CloudWatch metrics/logs and LangSmith-style tracing for retrieval and AI turns
- IAM boundaries that separate read, write, review, and administration paths

Prefer existing AWS services when they already satisfy the contract. Do not create a parallel vector stack only because RAG is new.

## Local Emulation Baseline

Local mode exists for development, tests, fixture replay, and operator confidence.

It must provide:

- the same TypeScript/Python interfaces as AWS adapters
- the same request and response schemas
- the same corpus and metadata serialization
- the same normalization, retrieval, scoring, threshold, and fallback logic
- redacted local fixtures that represent production records
- local object-store substitute or filesystem fixture loader for S3 contracts
- local metadata store such as SQLite, JSONL, or in-memory adapters only behind the production interface
- local vector/index substitute such as pgvector, SQLite vector extension, LanceDB, Chroma, or Qdrant local only behind the production retrieval interface
- local invoke scripts that exercise the same agent turn or retrieval handler

Mock AWS services only behind interfaces. Do not let mocks change business behavior.

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

Other clouds, SaaS vector databases, and third-party systems may appear as source systems, migration inputs, or caller constraints. Do not present them as equal production targets for this skill unless the human explicitly overrides the AWS mandate.

## Output Requirement

Always return:

- reusable agent boundary
- AWS production stack
- local emulation stack
- adapter interfaces shared by both modes
- why the chosen stack fits the constraints
- what would make the recommendation change
