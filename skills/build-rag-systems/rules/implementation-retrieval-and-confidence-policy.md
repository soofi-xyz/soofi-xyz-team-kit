---
title: Retrieval And Confidence Policy
impact: CRITICAL
tags: [rag, retrieval, confidence, hybrid-search]
---

# Retrieval And Confidence Policy

Design retrieval as a scored decision pipeline. Do not treat the top vector hit as automatically correct.

AWS production and local emulation must run the same normalization, retrieval, scoring, threshold, reranking, and fallback logic. AWS uses OpenSearch for vector or hybrid retrieval. Local mode uses OpenSearch running in Docker, seeded from `fixtures/rag/corpus/*.jsonl`, through the same `RetrievalIndex` interface.

## Retrieval Pipeline

Use this default order:

1. normalize the incoming query or object
2. apply tenant, source, status, and version filters
3. check exact aliases or deterministic matches
4. compute lexical or string-similarity candidates when labels are short
5. run vector or hybrid search
6. rerank candidates when needed
7. combine scores into a confidence result
8. apply threshold policy

The pipeline order and OpenSearch query-building code must be identical in local and AWS modes. Only endpoint and auth configuration may differ. Local replay compares retrieved record IDs, threshold bands, and final decisions. It does not compare raw vector scores.

## Hybrid Retrieval

Prefer hybrid retrieval for short labels, schemas, and operational records.

Useful signals:

- exact match
- normalized match
- token overlap
- edit distance
- acronym expansion
- whole-schema similarity
- vector similarity
- metadata match
- recency or reviewed status

For header mapping, a strong match may require both header similarity and schema-context similarity.

## Confidence Bands

Define confidence bands explicitly:

- auto-accept: calibrated high confidence and no policy conflict
- review: plausible but uncertain result
- reject or fallback: below threshold, conflicting candidates, or missing required metadata

Example bands:

- `>= 0.90`: auto-accept only after evaluation proves precision is high
- `0.70 - 0.89`: suggest with explanation or route to review
- `< 0.70`: no mapping; use fallback path

Do not copy these values blindly. Calibrate thresholds against golden examples.

## Fallback Paths

Apply fallback by risk:

- deterministic rules for stable structured cases
- LLM classification or mapping with cited retrieved examples
- human review for regulated, financial, or irreversible decisions
- reject and quarantine when safe automation is impossible

Fallback selection must not depend on the execution mode. A local fixture that falls into review must also fall into review in AWS unless the corpus contents intentionally differ.

## Production And Local Adapters

Use these adapters:

- AWS production retrieval: OpenSearch Serverless or OpenSearch Service.
- Local retrieval: Docker OpenSearch seeded from `fixtures/rag/corpus/*.jsonl`.
- AWS metadata/review state: DynamoDB.
- Local metadata/review state: JSONL fixture adapter.

Do not add alternate local vector stores. Local replay exists to verify Lambda/event handling and OpenSearch retrieval behavior before AWS replay.

## Prompt Context

When retrieved evidence is passed to an LLM:

- include source, score, and status
- include only the evidence needed for the decision
- preserve citations or record IDs
- instruct the model not to invent beyond retrieved evidence
- block prompt-unsafe or restricted records

When retrieved evidence feeds deterministic code, keep it structured and avoid turning it into prose first.

## Anti-Patterns

- vector-only matching for short field names
- using top-1 search without filters
- applying a result because the LLM says it looks right
- storing only embeddings without source records
- ignoring conflicting candidates
- mixing reviewed and unreviewed examples without status filters
