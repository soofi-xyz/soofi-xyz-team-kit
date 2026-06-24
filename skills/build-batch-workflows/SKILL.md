---
name: build-batch-workflows
description: "Guides creation of batch data processing workflows on AWS. Covers input data analysis, choosing Step Functions Distributed Map vs AWS Glue PySpark, testing pipelines, cost controls, throttling, idempotency, metrics, and mandatory PagerDuty alerting on critical failures. Triggers on: batch job, batch workflow, data pipeline, data processing job, ETL pipeline, bulk processing, distributed map, glue job, batch failure alerting, pagerduty, dead-letter queue."
---

# Building Batch Workflows

Step-by-step guide for designing and implementing batch data processing workflows in this ecosystem.

## Workflow: Three-Phase Approach

Follow these phases in order. Do NOT skip ahead — each phase gates the next.

### Phase 1 — Understand the Input Data

Before writing any code, fully understand the data.

1. **Ask the user:**
   - What is the data source? (S3 objects, database export, API response, raw files, pointers/manifests)
   - What is the data format? (JSON, CSV, Parquet, etc.)
   - What is the expected volume? (number of records, total size in GB)
   - Is it a one-time load or recurring?
   - Can you get a sample file or schema definition?
2. **If anything is unclear — STOP and ask.** Do not guess data shape or volume.
3. **Document the input contract** — define a schema (JSON Schema, TypeScript type, or Pydantic model) for the input data.

### Phase 2 — Choose the Processing Strategy

Based on what needs to happen to the data, pick the right tool:

| Workload Type | Tool | When to Use |
| --- | --- | --- |
| Field renames, data movement, simple transforms | **Step Functions Distributed Map** | Moving data between systems, renaming fields, filtering, routing |
| Heavy computation | **AWS Glue (PySpark)** | Joins, aggregations, deduplication, hash computation, diff detection |
| Heavy computation + external delivery | **Glue → Step Functions** | Glue processes data, then Step Functions delivers to external systems (Glue handles internal S3 writes directly) |

Read `rules/strategy-step-functions.md` and `rules/strategy-glue.md` for detailed guidance on each.

### Phase 3 — Set Up Testing Pipeline

1. **Get mock data.** If the user has not provided sample data — **ask for it now.** Do not proceed without data.
2. **Create a test pipeline** that processes a small subset (10–100 records) end-to-end.
3. **Validate outputs** against expected results before scaling up.
4. **Keep the feedback loop tight** — deploy and test should take minutes, not hours.

## Principles (Non-Negotiable)

These rules apply to EVERY batch workflow. Read the corresponding rule files for details and examples.

### 1. Validate Input Data

Every workflow MUST validate input data before processing. Read `rules/principle-input-validation.md`.

### 2. Validate External System Responses

When writing data to any external system, validate the response. Read `rules/principle-response-validation.md`.

### 3. Cost Prediction Gate

Every batch workflow MUST have a **cost prediction step** as its first step. Read `rules/principle-cost-gate.md`.

- **Ask the user:** "What is the cost ceiling (in USD) above which the workflow should pause for manual approval?"

### 4. Emit Business Metrics

Every workflow MUST emit metrics on data processed. Prefer **per-worker-unit metrics** — each Lambda invocation or Glue task emits its own metrics as it processes items. This is preferred over a single metric emitted at the end of the entire workflow execution, because it gives real-time visibility into progress and failures. Follow the `apply-engineering-guidelines` skill's `observability-metrics` rule — see [observability-metrics.md](../../apply-engineering-guidelines/rules/observability-metrics.md).

### 5. Idempotency and Recoverability

Workflows MUST be retriable, redrivable, and recoverable. Never do the same work twice. Read `rules/principle-idempotency.md`.

### 6. Respect External System Limits

**Ask the user:**
- What are the rate limits of the target system? (requests per second/minute)
- What is the max batch size the target system accepts?
- Are there concurrency limits?

Read `rules/principle-throttling.md` for the throttling architecture.

### 7. Alert On Critical Failures

Every workflow MUST page on-call via **PagerDuty** when it fails critically — a
batch run MUST NEVER fail silently. Wire a PagerDuty trigger at the terminal
failure path (Step Functions top-level `Catch` before `Fail`, failed Glue run
state, or a DLQ alarm) so one page fires per failed execution. Read
`rules/principle-failure-alerting.md`, and use the SOCAPITAL `integrating-pagerduty`
skill for the integration contract.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Step Functions Strategy | `rules/strategy-step-functions.md` | CRITICAL |
| Glue Strategy | `rules/strategy-glue.md` | CRITICAL |
| Input Validation | `rules/principle-input-validation.md` | CRITICAL |
| Response Validation | `rules/principle-response-validation.md` | CRITICAL |
| Cost Prediction Gate | `rules/principle-cost-gate.md` | CRITICAL |
| Idempotency & Recovery | `rules/principle-idempotency.md` | HIGH |
| Throttling & Concurrency | `rules/principle-throttling.md` | HIGH |
| Critical Failure Alerting | `rules/principle-failure-alerting.md` | CRITICAL |
