---
title: Local POC To OpenSearch Migration
impact: HIGH
tags: [rag, opensearch, sqlite, libsql, migration]
---

# Local POC To OpenSearch Migration

Use this rule when a local SQLite/libSQL RAG CLI POC is ready to move to AWS. The goal is to transfer the corpus and index model, not to train or move an ML model.

## Readiness Gate

Proceed only after:

- the local CLI has known-good `inspect`, `query`, and, if relevant, `paths` outputs
- source, chunk, link, metadata, and embedding contracts are documented
- golden queries and expected retrieved records exist
- data sensitivity, retention, tenant boundaries, and LLM prompt boundaries are explicit
- the user confirms they are ready to move from local POC to AWS

## Migration Contract

Export the local model to JSONL:

```text
rag_sources -> sources.jsonl
rag_chunks  -> chunks.jsonl
rag_links   -> links.jsonl
```

Validate every exported record with TypeScript/Zod schemas. Preserve deterministic IDs, source hashes, embedding model IDs, embedding dimensions, and embedding versions.

## OpenSearch Index Model

Prefer a denormalized `rag_chunks` index for retrieval:

- `chunk_id` as the stable document ID
- `source_id`, `source_uri`, `source_type`, `title`, and `source_hash`
- `chunk_index`, `chunk_role`, and `text_for_context`
- `embedding_model`, `embedding_dimension`, and vector field
- metadata fields needed for filters, using keyword/date/number mappings where possible
- link summary fields only when needed for retrieval expansion

Keep durable source records, link records, ingestion state, and idempotency keys outside OpenSearch in the approved metadata store. Use S3 for raw exports, transformed JSONL, failed records, and replay fixtures.

## Migration Steps

1. Export local records to JSONL.
2. Validate JSONL against the production corpus schema.
3. Confirm embedding dimensions match the target OpenSearch vector mapping.
4. Create or update OpenSearch indexes through CDK-managed infrastructure.
5. Bulk load chunks using deterministic document IDs.
6. Persist source and link metadata to the production metadata store.
7. Replay local golden queries against OpenSearch.

Never silently re-embed historical data with a different model. If the embedding model changes, create a new embedding version, re-index into a versioned index or alias, and compare retrieval quality before switching reads.
