---
title: Evaluation And Operations
impact: HIGH
tags: [rag, evaluation, observability, operations]
---

# Evaluation And Operations

Run the required replay path before relying on retrieval in production.

The path is fixed: local fixture replay, AWS replay against the same contracts, shadow mode, suggest-only mode, limited auto-accept canary, then monitored automation. Do not skip ahead.

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

Use this rollout:

1. local fixture replay
2. AWS replay against a small corpus
3. shadow mode
4. suggest-only mode
5. limited auto-accept canary
6. full automation with monitoring

Keep a disable flag for retrieval-backed automation. Preserve deterministic fallback or manual review.

## Local Fixture Replay

Before AWS deployment, run local replay against `fixtures/rag/queries/*.json` and `fixtures/rag/corpus/*.jsonl`.

Verify:

- fixture ingestion uses the production corpus schema
- deterministic retrieval returns expected record IDs
- thresholds produce expected accept/review/reject decisions
- review corrections persist through the JSONL adapter
- agent/tool invocation uses the same request and response contracts

## AWS Replay

After AWS deployment, replay the same golden cases through AWS adapters:

- Bedrock embedding calls use the production embedding service
- S3 source artifacts resolve through production object contracts
- DynamoDB metadata and review writes use the production table contract
- OpenSearch retrieval returns acceptable record IDs
- final decisions match local expectations or produce a documented mismatch

Compare retrieved IDs, threshold bands, and final decisions. Do not compare raw vector scores.

## Drift Checks

Monitor:

- new headers or schemas not seen before
- source-specific correction spikes
- score distribution shifts
- embedding model changes
- corpus growth or stale records
- metadata filter misses

Schedule re-evaluation after embedding model, chunking, normalization, or threshold changes.
