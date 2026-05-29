---
name: orchestrate-sms-workflow
description: "Design and verify the deterministic SMS orchestration workflow that chains filter, solver, Jigglypuff rendering, SMS lifecycle, Quiq feedback, processed S3 exports, Athena-ready data, and Interprose SFTP delivery. Use when building or refactoring Kadabra orchestration, Step Functions, end-to-end SMS workflow contracts, Jigglypuff fanout, retry/replay behavior, or E2E tests."
---

# Orchestrate SMS Workflow

Use this skill when defining the top-level deterministic workflow that connects the reusable SMS capabilities into an executable service.

## Ownership

This skill owns the orchestration contract between worker capabilities:

- `select-communication-audience` owns filter/audience handoff.
- `assemble-communication-runtime` owns solver/runtime outputs.
- `manage-channel-templates` owns template inventory and Jigglypuff rendering contract.
- `manage-communication-activity` owns SMS lifecycle, Quiq sending, feedback, processed exports, and activity closure.
- `build-sms-communication-service` owns Kadabra builder governance and golden-prompt alignment.

Do not move filter rules, solver scoring, template CRUD, or provider API details into this skill. Keep those in the owning worker skills.

## Required Workflow Shape

The SMS orchestration workflow should be:

```text
Filter -> Solver -> Render with Jigglypuff -> SmsLifecycleWorkflow -> Quiq feedback batch -> DailyInterproseExportWorkflow
```

Required state machines for the current service:

- `SmsOrchestrationWorkflowStateMachine`: top-level orchestrator.
- `SmsSolverWorkflow`: prepares solver input, runs Glue/OR-Tools, verifies artifacts.
- `SmsLifecycleWorkflow`: batches rendered sends, waits until scheduled time, enqueues or sends messages.
- `ProcessQuiqEventsWorkflow`: optional near-real-time raw Quiq event processor.
- `DailyInterproseExportWorkflow`: daily raw Quiq batch processing, processed-row generation, export file writing, and SFTP upload.

## Step Contracts

### Filter

Input:

- `input_s3_uri` or equivalent audience seed.
- `rule_context: { channel: "SMS" }`.
- `save_rules_reports: true` in development or debug runs.

Output:

- filtered eligible population in S3.
- stable identifiers needed downstream: debt, person, phone, account, and evidence fields.
- rule reports for audit/debug when enabled.

Failure behavior:

- hard suppressions remain filter-owned.
- if filter output is empty, the orchestrator should stop successfully with an explicit empty-run artifact.

### Solver

Input:

- filtered population S3 URI.
- template identifier or template policy chosen upstream.
- caps, selected day/hour policy, scoring policy, and run metadata.

Output:

- scheduled send rows partitioned by scheduled hour.
- `message_id` as UUID, not a hash.
- selected phone, debt/person ids, scheduled timestamp, template identifier, provider, policy version.

Failure behavior:

- Glue retries should cover transient infrastructure failures.
- solver output verification must fail loudly if expected partitions or required fields are missing.

### Jigglypuff Rendering

Input:

- scheduled send rows grouped into bounded render batches.
- template identifier and subject identifiers.
- channel `sms`, output format `text`.

Output per row:

- `rendered_message`.
- `asset_id` when the template has an MMS asset.
- `interaction_identifier`.
- `render_status`, missing fields, or render error.

Fanout rules:

- never send thousands of single-subject render calls serially.
- batch by template and scheduled partition.
- use Step Functions Map/Distributed Map or SQS fanout with bounded concurrency.
- persist each rendered partition to S3 so lifecycle can replay without re-rendering.
- fail only the affected partition when possible; preserve successful rendered outputs.

Retry rules:

- retry Jigglypuff submit/result polling for transient 5xx/throttling.
- polling must have a bounded max wait.
- graph tracking warnings inside Jigglypuff should not block rendered content if the text artifact was generated.

### SMS Lifecycle

Input:

- rendered scheduled send files or inline rendered items.

Output:

- provider send results and artifacts.
- send context keyed by Quiq `providerMessageId`.
- delivery-context fields: local `messageId`, `debtId`, `phoneNumber`, `templateIdentifier`, `interactionIdentifier`, `messageBody`, `sentAt`, provider status.

Execution rules:

- enforce scheduled send time before enqueue/send.
- use SQS handoff for sends in normal operation; direct invoke is only for controlled tests.
- `QUIQ_SENDER_ENABLED` must be false by default in prod unless the queue consumer is intentionally enabled.
- route with the configured DLC/shortcode policy.
- Quiq payload assets must use `{ "assetId": "<asset_id>" }`.

### Quiq Feedback And Export

Input:

- raw Quiq S3 files under date folders, e.g. `quiq-inbound/bi-data/springoakscapital/YYYY-MM-DD/`.
- send context table keyed by `providerMessageId`.

Output:

- processed JSONL rows in `sms-lifecycle/interprose-processed/export_date=YYYYMMDD/file_type=.../`.
- Interprose pipe files in `sms-lifecycle/interprose-exports/YYYYMMDD/<run_id>/`.
- SFTP uploads to `incoming/SOC Datawarehouse/`.

Batch export rules:

- daily export may scan raw S3 folders directly; it does not require S3 notifications.
- scan a small rolling folder window around the export date to catch late files.
- filter rows into the export day using the legacy 10PM Eastern cutoff.
- write deterministic processed-row keys so reruns overwrite rather than duplicate.
- do not emit unresolved rows for non-Kadabra provider IDs that lack send context.

## Retry And Recovery

- State machine tasks should retry transient Lambda, S3, DynamoDB, Glue, and provider failures with exponential backoff.
- Use DLQs for async handoffs and preserve the original payload.
- Every externally visible side effect needs an idempotency key: run id, batch id, `message_id`, provider message id, source S3 object hash, or export date.
- Recovery should support rerunning from S3 artifacts without re-filtering or re-rendering when upstream outputs already exist.

## E2E Test Plan

Minimum E2E validation:

1. Run filter with `rule_context.channel = "SMS"` and verify eligible output.
2. Run solver and verify all required scheduled-hour partitions and UUID `message_id` values.
3. Render a bounded partition with Jigglypuff and verify `rendered_message`, `asset_id`, and `interaction_identifier`.
4. Run lifecycle in mock mode and verify send context/artifacts.
5. For controlled live tests, enable the sender only for the specific direct invoke or queue consumer window, then restore it.
6. Confirm Quiq raw S3 contains `NotificationsDeliverabilityStatus` for the provider id.
7. Run `DailyInterproseExportWorkflow` with `uploadSftp: false` first and inspect `sms_log`.
8. Run with SFTP enabled only after the preview file is correct.

Acceptance evidence:

- `sms_log` contains `interaction_identifier` as the final column.
- `te_id` equals Quiq `providerMessageId`.
- both local UUID `message_id` and Quiq provider id are stored in send context.
- SFTP logs show all expected files uploaded.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Data Contracts And Testing | `rules/data-contracts-and-testing.md` | CRITICAL |
