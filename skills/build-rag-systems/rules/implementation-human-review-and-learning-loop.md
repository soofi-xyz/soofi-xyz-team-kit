---
title: Human Review And Learning Loop
impact: HIGH
tags: [rag, human-review, self-healing, feedback-loop]
---

# Human Review And Learning Loop

Use a review loop whenever retrieval output can change runtime behavior, user data, financial outcomes, compliance posture, or downstream automation.

## Decision States

Use explicit states:

- `auto_accepted`
- `suggested`
- `needs_review`
- `rejected`
- `human_accepted`
- `human_corrected`
- `deprecated`

Do not overwrite history. Append new decisions or versions.

## Review Queue

A review item should include:

- input object or redacted sample
- normalized input
- top candidates and scores
- proposed output
- missing or conflicting evidence
- recommended action
- reviewer controls: accept, correct, reject, defer

For header mapping, show the original header, normalized header, neighboring headers, source partner, candidate canonical field, and prior examples that support the suggestion.

## Learning From Corrections

When a reviewer accepts or corrects a result:

1. store the reviewed decision
2. mark it as approved retrieval evidence
3. update alias tables or deterministic rules when the correction is stable
4. schedule re-embedding if the text representation changed
5. record reviewer, timestamp, reason, and version

Do not let unreviewed LLM outputs become approved retrieval evidence automatically.

## Self-Healing Controls

Only enable self-healing after:

- golden-set precision is acceptable
- review rates are stable
- rollback exists
- owners can inspect learned records
- drift metrics are monitored

Self-healing should usually promote reviewed corrections, not speculative model guesses.

## Audit Requirements

Preserve:

- original input
- normalized input
- retrieved candidates
- scores and thresholds
- final decision
- actor: system, model, or reviewer
- model and embedding versions
- decision timestamp

Use immutable logs or append-only tables for high-risk workflows.
