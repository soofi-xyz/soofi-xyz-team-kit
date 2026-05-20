---
title: Build RAG Systems Sections
impact: HIGH
tags: [rag, sections, navigation]
---

# Build RAG Systems Sections

Use these files as progressive disclosure. Read only the sections needed for the current decision.

| Section | File | Read When |
| --- | --- | --- |
| Use-case taxonomy | `architecture-rag-use-case-taxonomy.md` | The user asks for RAG, embeddings, semantic retrieval, classification, mapping, or prior-decision reuse. |
| AWS/local architecture | `architecture-aws-local-emulation.md` | Defining AWS production services and local emulation adapters. |
| Corpus contract | `implementation-corpus-and-metadata-contract.md` | Defining documents, chunks, examples, mappings, decisions, provenance, or tenant metadata. |
| Retrieval policy | `implementation-retrieval-and-confidence-policy.md` | Designing top-k, filters, hybrid search, thresholds, reranking, or fallback. |
| Review loop | `implementation-human-review-and-learning-loop.md` | Any retrieved result may be auto-applied or routed to manual review. |
| Evaluation | `delivery-evaluation-and-operations.md` | Preparing production rollout, accuracy measurement, drift checks, or cost/latency controls. |
