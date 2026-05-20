---
title: Provider Agnostic Stack Selection
impact: CRITICAL
tags: [rag, providers, vector-store, architecture]
---

# Provider Agnostic Stack Selection

Choose a stack after the corpus, retrieval policy, scale, governance, and runtime constraints are clear.

## Selection Inputs

Capture:

- runtime location: local, AWS, Azure, GCP, Vercel, existing app, or hybrid
- data sensitivity and residency
- expected corpus size and query volume
- latency and cost ceilings
- metadata filtering needs
- full-text, lexical, and hybrid search needs
- existing databases or search services
- operational ownership

## Portable Architecture Layers

Design every stack with these layers:

1. corpus store for source records, chunks, examples, or decisions
2. metadata/provenance store for filters and audit
3. embedding model and batch pipeline
4. vector or hybrid search index
5. retrieval service with confidence policy
6. review/correction path
7. evaluation and observability

## Stack Options

### Local Or Developer Mode

Use for prototypes, tests, and small private corpora.

Good defaults:

- SQLite plus `sqlite-vec` or `sqlite-vss`
- LanceDB
- Chroma
- Qdrant local
- local files or SQLite for metadata

Avoid local-only storage when production needs multi-user concurrency, audit retention, or tenant isolation.

### AWS

Use when the system already lives on AWS or needs AWS governance.

Options:

- Bedrock embeddings plus OpenSearch Serverless or OpenSearch Service
- Aurora PostgreSQL or RDS PostgreSQL with pgvector
- S3 for source artifacts, DynamoDB for review/correction metadata
- Step Functions, Glue, or Lambda for ingestion and refresh

Prefer pgvector when data already lives in Postgres and scale is moderate. Prefer OpenSearch when hybrid lexical/vector search, filtering, and larger retrieval workloads matter.

### Azure

Use when the tenant or app is Azure-first.

Options:

- Azure OpenAI embeddings
- Azure AI Search with vector and hybrid search
- Blob Storage for source artifacts
- Cosmos DB or SQL Database for metadata and review records

Prefer Azure AI Search when hybrid retrieval and enterprise search controls matter.

### GCP

Use when the system is GCP-first.

Options:

- Vertex AI embeddings
- Vertex AI Vector Search
- AlloyDB or Cloud SQL with pgvector
- BigQuery vector search for analytical corpora
- Cloud Storage for source artifacts

Prefer BigQuery vector search when retrieval is mostly analytical and the corpus already lives in BigQuery.

### SaaS Vector Stores

Use when managed operations, fast setup, or framework integration matters.

Options:

- Pinecone
- Weaviate Cloud
- Qdrant Cloud
- Upstash Vector
- Supabase pgvector

Verify data residency, tenant isolation, metadata filtering, backup/export, and cost behavior before recommending.

### Existing Relational Database

Use when the app already owns a relational database and RAG scale is moderate.

Default to Postgres plus pgvector when possible. Keep full source records and review decisions in normal relational tables, and store embeddings as indexed columns or sibling tables.

## Output Requirement

Always return:

- provider-neutral architecture
- recommended stack
- one fallback stack
- why the chosen stack fits the constraints
- what would make the recommendation change
