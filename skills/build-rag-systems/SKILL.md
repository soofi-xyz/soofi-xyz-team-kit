---
name: build-rag-systems
description: "Design and implement system-agnostic RAG systems for knowledge retrieval, prior-decision reuse, semantic mapping, classification, and self-healing runtime workflows. Use when working with RAG, embeddings, vector search, retrieval architecture, knowledge bases, schema/header mapping, confidence thresholds, or local/AWS/Azure/GCP/SaaS provider selection."
---

# Build RAG Systems

Use this skill to design retrieval-augmented systems as portable architecture patterns first and provider implementations second.

RAG here includes classic document grounding, but also operational retrieval: reusing prior mappings, classifications, schemas, decisions, reviewer corrections, and examples at runtime.

## Workflow

Follow these phases in order. Do not choose a vendor before Phase 5.

### Phase 1 - Classify The Use Case

Identify what retrieval is supposed to do:

- answer questions or ground generated text
- retrieve prior decisions, mappings, schemas, or examples
- classify documents or records
- map inconsistent CSV, Excel, JSON, or API fields
- route, enrich, validate, or self-heal a runtime workflow

Read `rules/architecture-rag-use-case-taxonomy.md`.

### Phase 2 - Define Corpus And Metadata

Define the durable records before designing embeddings:

- source object, chunk, or example shape
- canonical IDs, tenant/account scope, version, and ownership
- metadata filters and provenance
- reviewer, confidence, prompt/model, and decision history
- retention, PII, and audit controls

Read `rules/implementation-corpus-and-metadata-contract.md`.

### Phase 3 - Design Retrieval And Confidence

Choose the retrieval strategy:

- normalization and canonicalization
- exact aliases and string similarity
- embeddings and vector search
- metadata filters and hybrid search
- reranking, thresholds, top-k, and fallback

Read `rules/implementation-retrieval-and-confidence-policy.md`.

### Phase 4 - Add Review And Learning Loops

For runtime decisions, define what happens below confidence threshold.

- auto-accept only when calibrated
- route ambiguous matches to human review
- persist reviewed corrections as future retrieval evidence
- keep audit logs and rollback paths

Read `rules/implementation-human-review-and-learning-loop.md`.

### Phase 5 - Select Provider Stack

Recommend provider-neutral architecture first, then map it to concrete options:

- local/dev
- AWS
- Azure
- GCP
- SaaS vector databases
- existing relational databases with vector extensions

Read `rules/architecture-provider-agnostic-stack-selection.md`.

### Phase 6 - Evaluate And Operate

Define verification before production automation:

- golden sets and expected matches
- precision, recall, acceptance rate, and review rate
- confidence calibration and drift checks
- cost, latency, observability, and rollback

Read `rules/delivery-evaluation-and-operations.md`.

## Required Questions

Ask only what changes the design:

- What is being retrieved: documents, chunks, examples, schemas, mappings, decisions, or records?
- What does the runtime do with retrieved evidence: answer, classify, map, route, enrich, validate, or automate?
- Where must it run: local, AWS, Azure, GCP, Vercel, SaaS, existing database, or hybrid?
- Does the corpus contain PII, regulated data, tenant-scoped data, or data that cannot enter an LLM prompt?
- What latency, cost, scale, and freshness limits apply?
- Is human review required for low-confidence matches?
- Do golden examples or reviewed historical decisions already exist?

## Non-Negotiables

1. Design the portable data and retrieval contract before choosing technology.
2. Do not treat all RAG as document Q&A.
3. Do not use embeddings alone when exact aliases, schema metadata, or deterministic rules are available.
4. Do not auto-apply retrieval results without calibrated thresholds and a fallback path.
5. Do not create a new vector stack when an existing database or search service fits the constraints.
6. Do not send sensitive retrieved evidence to an LLM without explicit governance.

## Output Contract

Return:

- use-case classification
- corpus and metadata contract
- retrieval pipeline and confidence policy
- provider-neutral architecture
- provider-specific stack recommendation and trade-offs
- human-review and learning loop, when relevant
- evaluation and operations plan
- implementation checklist

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| RAG use-case taxonomy | `rules/architecture-rag-use-case-taxonomy.md` | CRITICAL |
| Provider-agnostic stack selection | `rules/architecture-provider-agnostic-stack-selection.md` | CRITICAL |
| Corpus and metadata contract | `rules/implementation-corpus-and-metadata-contract.md` | CRITICAL |
| Retrieval and confidence policy | `rules/implementation-retrieval-and-confidence-policy.md` | CRITICAL |
| Human review and learning loop | `rules/implementation-human-review-and-learning-loop.md` | HIGH |
| Evaluation and operations | `rules/delivery-evaluation-and-operations.md` | HIGH |
