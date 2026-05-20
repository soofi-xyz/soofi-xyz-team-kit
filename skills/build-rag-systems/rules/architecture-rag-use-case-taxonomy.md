---
title: RAG Use Case Taxonomy
impact: CRITICAL
tags: [rag, taxonomy, architecture]
---

# RAG Use Case Taxonomy

Classify the use case before selecting infrastructure. Different RAG shapes need different corpus models, confidence policies, and evaluation.

## Knowledge RAG

Use for document Q&A, writing assistance, research, and grounded generation.

Typical corpus:

- documents
- chunks
- title/source/author metadata
- citations or source URLs

Runtime pattern:

1. embed query
2. retrieve relevant passages
3. inject passages into model context
4. cite or summarize retrieved evidence

## Operational Retrieval

Use when retrieval supports a runtime decision, not just a generated answer.

Typical corpus:

- prior classifications
- accepted mappings
- schema variants
- reviewer corrections
- workflow decisions

Runtime pattern:

1. normalize incoming object
2. retrieve similar prior examples
3. score candidates
4. auto-apply high-confidence results
5. route uncertain results to review
6. persist reviewed correction as new evidence

## Schema Or Header Mapping

Use for inconsistent CSV, Excel, JSON, or vendor API fields.

Example: map `social_security_number`, `socialsecuritynumber` and `ssn` to a canonical internal field when evidence supports that mapping.

Do not rely on embeddings alone. Combine:

- canonicalization and token normalization
- exact aliases
- string similarity
- partner/file-type metadata
- vector retrieval over prior reviewed mappings
- confidence thresholds and manual review

## Classification RAG

Use when nearest prior examples help classify documents, records, or events.

Generic classification retrieval flow:

1. embed current document or slice
2. search prior classified examples
3. reuse metadata when confidence is calibrated
4. fall back to LLM, rules, or human review when confidence is low
5. index final classification for future runs

## Routing, Enrichment, And Validation

Use when retrieval selects a rule, template, processing lane, enrichment source, or validation policy.

Return retrieved evidence as structured inputs to deterministic code whenever possible. Do not hide routing logic inside a prompt if a stable contract can express it.

## Self-Healing Workflows

Use only after evaluation proves thresholds are safe. Self-healing means reviewed or corrected outcomes update future retrieval evidence automatically or semi-automatically.

Require:

- review status
- reviewer identity or process owner
- versioned correction
- rollback path
- drift monitoring
