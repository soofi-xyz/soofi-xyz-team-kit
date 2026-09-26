---
title: Repos and atomic vs rollup layers
impact: HIGH
tags: atomic-data, parquet, s3, etl, metrics-pipeline, vendor
---

## Repos

| Repo | Role |
| --- | --- |
| Metrics pipeline | Lambdas, Step Functions, Glue, pollers for vendor APIs, `metrics_mapper`, CloudWatch emission, tests, `docs/metrics-inventory.md`. **LiveVox:** `livevox-metrics-pipeline` also ships `docs/agent-metrics-atomic-integration.md` for join keys and definitions. |
| ETL | System of record for landed sources and recordings. Prefer **reading from object storage** in the metrics pipeline instead of re-pulling source systems when a landed dataset exists. |
| Lexicon | Canonical metric names and definitions. **`cloudwatch-metrics.json`** and **`lexicon.json`** — contract checks must pass before dependent merges. Add derived agent-daily types (e.g. `productive_time_seconds`) when product definitions are locked. |
| Dashboard | Business widgets; may import specs from the metrics pipeline (`dashboard/socapital-dashboard-widgets.json` in pipeline repo for core business charts). |

## Two conceptual layers

1. **Atomic / fact-backed** — Metrics you can recompute or explain from stored facts (for example one row per call or event). Joins allowed (for example quality or compliance notes to call facts for disposition-based metrics).
2. **Vendor daily rollup** — Pre-aggregated API results for a date window (agent summaries, service efficiency). Store as **Hive-partitioned Parquet** under `derived/<vendor>/...`, not as raw HTTP JSON dumps for analytics.

## Principles

- Preserve **both** layers when both matter: vendor Parquet for UI parity and rollups; facts for **auditability**.
- Keep lineage **explicit** in the lexicon: prefer dedicated agent-daily entries over overloading unrelated service-only metrics when grain differs.
- Update **README**, **metrics inventory**, and operator runbooks when direction rules or storage model change.
