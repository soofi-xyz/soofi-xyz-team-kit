---
title: Evaluation And Operations
impact: HIGH
tags: [rag, evaluation, observability, operations]
---

# Evaluation And Operations

Define evaluation before relying on retrieval in production.

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

1. offline eval
2. shadow mode
3. suggest-only mode
4. limited auto-accept canary
5. full automation with monitoring

Keep a disable flag for retrieval-backed automation. Preserve deterministic fallback or manual review.

## Drift Checks

Monitor:

- new headers or schemas not seen before
- source-specific correction spikes
- score distribution shifts
- embedding model changes
- corpus growth or stale records
- metadata filter misses

Schedule re-evaluation after embedding model, chunking, normalization, or threshold changes.
