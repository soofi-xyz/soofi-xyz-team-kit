---
title: Reconciliation and direction classification
impact: HIGH
tags: reconciliation, inbound, outbound, rules, call_fact, vendor-rollup
---

## Reconciliation

- The same KPI may appear on **atomic facts** and **vendor rollups**. When definitions align, values MUST match within an agreed **tolerance**.
- When structures are unsafe (for example naive sums over nested rows), compare **trusted total fields** from summary payloads instead of summing nested rows incorrectly.

## One lineage per metric

For each canonical metric, document:

- **Source** — fact table vs vendor API vs derived.
- **Field(s)** and **unit**.
- **Grain** — for example agent-day, tenant-day, service-day.

Avoid ambiguous or mixed lineage (atomic and rollup munged without documentation).

## Inbound / outbound classification

- **Tenant-wide** daily counts should use the **full landed call dataset** for the date unless the metric explicitly requires service scoping (do not filter by `serviceId` in batch unless the metric definition says so).
- Use **configurable rule sets** as **MatchRule-style** JSON: **`{"field":"<csv-column>","values":[...]}`**. In **livevox-metrics-pipeline** these are **`LIVEVOX_INBOUND_RULES_JSON`** and **`LIVEVOX_OUTBOUND_RULES_JSON`** (with **`LIVEVOX_ENABLE_RULE_DERIVED_METRICS`**).
- Centralize classification in a **call-detail / CSV aggregation module** (e.g. `livevox_call_details.py`); keep **mapper** wiring explicit — **`inbound_calls`** and **`outbound_calls`** must appear in the business **`metrics_mapper`** map when emitted to CloudWatch and `business_metrics` Parquet.
- If a rule is **unset**, omit that metric for the day (do not publish null series).

## Operating rules

- Treat vendor-specific terms as **non-interchangeable** until mappings are explicit.
- Favor **auditability and explainability** over convenience when definitions conflict; document conflicts explicitly.
