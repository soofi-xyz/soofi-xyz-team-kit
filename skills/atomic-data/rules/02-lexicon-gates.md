---
title: Lexicon and metrics-skill gates
impact: CRITICAL
tags: lexicon, cloudwatch-metrics, metrics-skill
---

## Hard gates

Treat these as **blocking** before pipeline or dashboard wiring:

2. [`metrics-skill`](../../metrics-skill/) — Follow its lexicon phase: comparison tables, user confirmation, no downstream design until confirmed.

## What to confirm before implementation

- Metric **exists** in lexicon **or** is **defined** with: name, description, **grain** (for example agent-day vs tenant-day), **source** (fact table vs vendor API), **unit**.
- CloudWatch registration path: entries in **`cloudwatch-metrics.json`** where the platform publishes CW metrics.
- Lexicon contract tests pass in the lexicon repo for any schema change.

## Anti-patterns

- Implementing `metrics_mapper` or dashboard widgets **before** lexicon alignment.
- Using vendor display names as canonical names without an explicit mapping table.

## Examples

- Correct: Inspect `cloudwatch-metrics.json`, confirm a new metric name with the user, open a lexicon PR, then add emission in the pipeline.

- Correct (derived agent-daily): Lock **business definitions** (e.g. productive = in_call + wrap + ready) in ops docs, add canonical types such as `productive_time_seconds` / `productive_pct` if not reused, then emit or compute in Athena.

- Incorrect: Add `Metrics.addMetric('vendorInbound', 1)` in Lambda, then ask the lexicon team to “register it later.”
