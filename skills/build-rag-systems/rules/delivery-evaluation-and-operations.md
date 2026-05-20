---
title: Evaluation And Operations
impact: HIGH
tags: [rag, evaluation, observability, operations]
---

# Evaluation And Operations

Define evaluation before relying on retrieval in production.

Run local emulation first, then AWS production smoke tests against the same contracts. Do not promote a RAG agent when local and AWS behavior diverge without an explicit documented reason.

## Golden Sets

Create representative fixtures:

- queries or incoming objects
- expected retrieved records
- expected final decision
- acceptable alternatives
- rejection cases
- ambiguous cases
- tenant and metadata boundary cases

For header mapping, include common aliases, misspellings, acronyms, partner-specific labels, misleading near-matches, and low-confidence unknowns.

## Metrics

Track:

- top-k recall
- precision at accepted threshold
- false accept rate
- false reject rate
- review rate
- correction rate
- no-match rate
- latency
- embedding and search cost
- corpus freshness
- drift by source, partner, or tenant

For runtime automation, false accepts are usually more expensive than review volume. Optimize thresholds accordingly.

## Calibration

Calibrate thresholds by replaying historical examples.

Report:

- score distribution by correct and incorrect matches
- threshold candidates
- expected auto-accept rate
- expected manual-review rate
- known failure modes

Do not promote thresholds from a tiny sample without labeling them experimental.

## Observability

Log structured retrieval traces without leaking sensitive text:

- query ID or input hash
- filters applied
- candidate IDs
- scores
- selected threshold band
- final action
- model and embedding versions
- latency and cost

Store sensitive evidence in encrypted stores and log pointers instead of raw content.

## Rollout

Use staged rollout:

1. local fixture replay
2. offline eval
3. AWS smoke test against a small corpus
4. shadow mode
5. suggest-only mode
6. limited auto-accept canary
7. full automation with monitoring

Keep a disable flag for retrieval-backed automation. Preserve deterministic fallback or manual review.

## Local Emulation Verification

Before AWS deployment, verify locally:

- fixture ingestion uses the production corpus schema
- local embeddings or fixture vectors exercise the same embedding interface
- retrieval returns expected top-k records
- thresholds produce expected accept/review/reject decisions
- review corrections persist through the same interface
- agent/tool invocation uses the same request and response contracts

After AWS deployment, replay a small equivalent golden set and compare decisions, not raw vector scores.

## Drift Checks

Monitor:

- new headers or schemas not seen before
- source-specific correction spikes
- score distribution shifts
- embedding model changes
- corpus growth or stale records
- metadata filter misses

Schedule re-evaluation after embedding model, chunking, normalization, or threshold changes.
