---
title: Corpus And Metadata Contract
impact: CRITICAL
tags: [rag, corpus, metadata, provenance]
---

# Corpus And Metadata Contract

Define the stored evidence before embedding anything. Retrieval quality depends on stable IDs, useful metadata, and reviewable provenance.

AWS production and local emulation must use the same corpus schemas, serialized records, metadata names, and version fields. Local fixtures should be redacted representative records, not a simplified data model.

## Required Corpus Fields

Every retrievable record should have:

- `id`: stable unique ID
- `tenant_id`: stable isolation scope for the record when the system is multi-tenant; use the product's existing boundary name such as `account_id`, `organization_id`, `workspace_id`, `customer_id`, `partner_id`, or `environment_id`, and filter on it for every retrieval
- `corpus_type`: document, chunk, mapping, schema, decision, example, rule, or record
- `source_uri` or source identifier
- `source_hash` for idempotency
- `text_for_embedding`
- `metadata` used for filters
- `created_at` and `updated_at`
- `version` or schema version

## Knowledge Document Records

Store:

- document ID
- chunk ID and chunk index
- chunk total
- title
- source
- author or owner
- document type
- text body or pointer to text body
- embedding model and dimension

Keep large bodies outside vector metadata when the vector store has metadata size limits. Store full text in object storage, Redis, SQL, or another metadata store and keep pointers in the vector index.

## Operational Decision Records

Store:

- input signature
- normalized input
- retrieved candidate IDs and scores
- accepted output
- confidence score
- decision source: automatic, rule, LLM, reviewer, or override
- reviewer and review timestamp for human-reviewed records
- reason or evidence
- model, prompt, embedding model, and retrieval version

## Header Mapping Records

For CSV and Excel header mapping, store:

- partner or source system
- file family or feed type
- original header
- normalized header
- neighboring headers or schema signature
- canonical internal field
- mapping status: accepted, rejected, needs review, deprecated
- confidence and evidence
- reviewed_by and reviewed_at when human-reviewed

Include both single-header evidence and whole-schema evidence. Some headers are ambiguous alone but clear in the context of neighboring columns.

## Metadata Filters

Plan metadata filters up front. Common filters:

- tenant/account
- source system or partner
- file type or document type
- language
- jurisdiction
- active/deprecated status
- version
- reviewed/approved status
- date range

Do not rely on vector similarity to enforce tenant or data-governance boundaries. Use filters or separate indexes.

## Local Fixture Contract

Local fixture records should:

- use the same schema as AWS production records
- include realistic metadata filters and tenant/account scopes
- include positive, negative, ambiguous, and low-confidence examples
- replace sensitive values with deterministic redactions
- preserve source hashes or fixture hashes for idempotent replay

Do not create local-only fields that production cannot populate.

## PII And Governance

Classify sensitive fields before ingestion.

For PII-heavy systems:

- avoid embedding raw identifiers when normalized tokens are enough
- redact or hash identifiers where possible
- keep prompt-unsafe evidence out of LLM context
- encrypt source stores
- preserve audit logs for automated decisions
