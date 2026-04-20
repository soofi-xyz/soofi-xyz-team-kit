# Pipeline Phase

Run this phase only after the lexicon mapping is confirmed.

## Required User Inputs

Ask for these when not already known:

- source location: API, database, file, S3 landing zone, or other
- example payload or extract
- access method: credentials, endpoint, IAM role, bucket path, or connection details
- temporal class: `realtime`, `snapshot`, or `historical`
- expected volume
- rate limits or concurrency limits
- cost ceiling for workflows that may need approval gates

If any of these are unclear, stop and ask.

## Lane Selection

Choose the ingestion path that best matches the source contract:

- `realtime`: prefer a polling lane that emits operational metrics on a short cadence
- `historical`: prefer a landed-file or batch lane with explicit validation, cost controls, and idempotency
- `snapshot`: prefer a dated snapshot lane with explicit `metric_date` semantics

Reuse `livevox-metrics-pipeline` patterns before designing a new lane.

## Snapshot Rules

For `snapshot` metrics:

- If the source is current-state only, treat `metric_date` as the observation date or timestamp, not the vendor event date.
- Document whether the source supports historical queries or backfill. If it does not, state that the lane is observation-only and does not support historical backfill.
- Capture freshness semantics explicitly when the source exposes last-updated fields or when staleness can be derived.
- Decide missing-day behavior and dashboard fallback expectations as part of the lane design, not as a later dashboard-only concern.

## Reuse Targets

Prefer these patterns when they fit:

- `app/config/metrics/` for declarative metric definitions
- `app/services/livevox_dashboard_contract.py` for canonical metric name and unit inventories
- `scripts/check_lexicon_contract.py` for lexicon alignment
- `docs/metrics-inventory.md` for semantic documentation
- source-owned widget JSON when business metrics are published from the pipeline repo

## Naming Rules

- Metric names must match the confirmed lexicon name exactly before code or widget changes.
- Keep units, dimensions, and descriptions aligned with the lexicon decision.
- Preserve low-cardinality dimensions.

## Temporary Mismatch Rule

Default behavior is to stop and reconcile the lexicon first.

Only continue with a temporary mismatch if the user explicitly approves twice:

1. confirm that the mismatch is intentional and temporary
2. confirm that they accept CI, dashboard, and documentation drift risk until reconciliation

Record that exception clearly in the response.

## Validation Rules

Carry forward existing pipeline guardrails:

- validate input data before processing
- validate external responses
- use cost prediction gates for batch workflows
- preserve idempotency and recoverability
- respect external system rate limits
- keep metrics inventory and alignment checks updated with code
- document `metric_date`, freshness, and backfill semantics for snapshot lanes

Use `build-batch-workflows` for the workflow principles when the lane is batch-oriented.

## Stop Conditions

Stop and ask when:

- the source contract does not support the requested business metric
- the source semantics do not match the confirmed lexicon definition
- the required access method is unavailable
- the metric would need unsupported high-cardinality dimensions
- the lane choice is ambiguous between realtime, snapshot, and historical behavior
