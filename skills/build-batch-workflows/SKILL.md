---
name: build-batch-workflows
description: "Building reliable batch workflows and data pipelines — processing strategy, critical-path isolation, side-effect classification, fault injection, cost control, throttling, idempotency, recovery, and failure alerting."
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

### Phase 2 — Classify Dependencies And Choose The Processing Strategy

Before selecting a tool, classify every external dependency and side effect as
primary state, critical gate, auxiliary projection, or compensatable follow-up.
Complete the failure matrix in
`rules/principle-critical-path-isolation.md`. Do not implement until every
synchronous dependency has a documented correctness reason.

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
3. **Inject dependency failures** and verify critical gates block while auxiliary failures do not regress primary state.
4. **Validate outputs** against expected results before scaling up.
5. **Keep the feedback loop tight** — deploy and test should take minutes, not hours.

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

### 5. Isolate Critical Paths

Every workflow MUST persist primary state before auxiliary projections and MUST
document why each synchronous dependency is critical. Use an outbox, queue,
event, or replayable DLQ for decoupled work. Read
`rules/principle-critical-path-isolation.md`.

### 6. Idempotency and Recoverability

Workflows MUST be retriable, redrivable, and recoverable. Never do the same work twice. Read `rules/principle-idempotency.md`.

### 7. Respect External System Limits

**Ask the user:**
- What are the rate limits of the target system? (requests per second/minute)
- What is the max batch size the target system accepts?
- Are there concurrency limits?

Read `rules/principle-throttling.md` for the throttling architecture.

### 8. Alert On Critical Failures

Every workflow MUST page on-call via **PagerDuty** when it fails critically — a
batch run MUST NEVER fail silently. Wire a PagerDuty trigger at the terminal
failure path (Step Functions top-level `Catch` before `Fail`, failed Glue run
state, or a DLQ alarm) so one page fires per failed execution. Read
`rules/principle-failure-alerting.md`, and use the SOCAPITAL `integrating-pagerduty`
skill for the integration contract.

## Judging Existing Architectures

The principles above define what a workflow must do — not where every piece must live or how it must be shaped. When assessing an existing workflow, recognize these as valid architectures, not defects:

- **Split responsibilities.** Responsibilities may be split across repositories or deployment units. A producer can own metric definition, emission, and contract tests while separate systems own metric registration, dashboards, alarms, or consumption. Judge each side only against what it owns.
- **Complete producer contracts.** A missing consumer-side integration is not a producer defect when the producer's contract is complete and the integration is not required for the workflow to operate safely.
- **Control-plane reads vs. processing workloads.** Reads of metadata, catalogs, or control-plane state are not processing workloads. Do not apply processing-workload requirements (strategy selection, cost gating, volume-sized throttling) to them.
- **Fixed conservative ceilings.** A fixed, conservative safety or cost ceiling can be an intentional contract. Configurability is not inherently superior to a deliberately chosen conservative limit.
- **Polyglot layers.** Different system layers may use different languages and toolchains when the boundaries between them are explicit. Apply each language's listed tooling within its layer; the mix itself is not a finding.

When reporting findings, report only concrete violations of the named principles above — cite the principle and the specific violation. The absence of a pattern that no principle requires is not a finding.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Step Functions Strategy | `rules/strategy-step-functions.md` | CRITICAL |
| Glue Strategy | `rules/strategy-glue.md` | CRITICAL |
| Input Validation | `rules/principle-input-validation.md` | CRITICAL |
| Response Validation | `rules/principle-response-validation.md` | CRITICAL |
| Cost Prediction Gate | `rules/principle-cost-gate.md` | CRITICAL |
| Critical Path Isolation | `rules/principle-critical-path-isolation.md` | CRITICAL |
| Idempotency & Recovery | `rules/principle-idempotency.md` | HIGH |
| Throttling & Concurrency | `rules/principle-throttling.md` | HIGH |
| Critical Failure Alerting | `rules/principle-failure-alerting.md` | CRITICAL |
