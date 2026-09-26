---
title: Parquet storage and batch workflows
impact: HIGH
tags: parquet, s3, glue, step-functions, build-batch-workflows, cloudwatch
---

## Parquet-first outputs

- Pipeline-owned datasets under **`derived/<vendor>/`** MUST be **Snappy Parquet** with **`metric_date=`** (or equivalent) partitions for analytics.
- If a dataset is **landed** for analytics, keep it **Parquet-only** — do not maintain a parallel JSON artifact for the same analytics path.

## Batch workflow alignment

Use [`build-batch-workflows`](../../build-batch-workflows/):

- Validate inputs and external responses per that skill.
- Include a **cost prediction / approval gate** when the workflow can exceed agreed spend.
- Enforce **idempotency** and **throttling** for vendor APIs and bulk writes.
- Emit **business metrics** from worker units (Lambda / Glue tasks) with per-unit visibility, consistent with engineering observability rules.

## Metrics pipeline responsibilities

**Must do**

- Read from **object storage** when landed data exists instead of hitting raw APIs unnecessarily.
- Emit **Parquet** datasets and **CloudWatch** metrics that are registered in the lexicon.
- Update **metrics inventory**, **dashboard contract**, **dashboard JSON widgets** (when business metrics change), and **tests** when behavior changes.
- Keep **business metric keys** in one place (e.g. `BUSINESS_METRIC_KEYS` + `map_daily_metrics_to_business_metrics`) so optional fact-derived metrics (direction, RPC) publish consistently.

**Must not**

- Store analytics-path data as **raw JSON** when Parquet is the standard for that lane (Reporting API snapshots land as **partitioned Parquet**, e.g. `derived/livevox/agent_summary_metrics/`, `business_metrics/`).
- Publish CloudWatch metrics that are not covered by the lexicon registration story (see `metrics-skill` and lexicon repo).

## Example layout (LiveVox)

- Tall business facts: `derived/livevox/business_metrics/metric_date=YYYY-MM-DD/part-000.parquet`
- Vendor API lanes: `agent_summary_metrics/`, `service_efficiency_metrics/`, etc., same partition convention
- Optional Athena examples: `sql/athena/011_atomic_integration_example_views.sql`
