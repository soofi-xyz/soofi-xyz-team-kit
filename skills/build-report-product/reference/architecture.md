# Report architecture

Verify against the target revision of `prismteam-ai/report`; its files win over these notes.

## Repository

| Path | What it holds |
| --- | --- |
| `schemas/report-configuration.schema.json`, `src/configuration/` | The `report-1` contract, its TypeScript view and the save-time checks (`validate.ts`: unknown variables, CTE names that collide with sources or datasets, ledger column rules, query size) |
| `src/api/` | Routes (`routes.ts`), management handlers (`management.ts`), HTTP helpers |
| `src/refresh/` | Refresh steps (`steps.ts`), cost estimate (`plan.ts`), Persist client, Athena results, ledger and Glue tables, dataset SQL assembly (`datasets.ts`), output files (`outputs.ts`), execution reconciler |
| `src/schedule/`, `src/store/` | EventBridge Scheduler schedules; DynamoDB store (reports, versions, refreshes, lock, publish pointer) |
| `src/handlers/` | One Lambda entry per step, the API, alerts and the shared usage plan custom resource |
| `cdk/stack.ts`, `marketplace/` | The `Report` stack; the Marketplace app and its cdk-nag suppressions |
| `scripts/api-spec.ts`, `requirements/swagger.yml` | The generated OpenAPI description |
| `examples/` | `portal-performance` (Persist) and `complaint-status-daily` (Athena) |
| `tests/` | Vitest suites; `athena-sql.test.ts` compares the portal datasets on Trino with checked results |

## Stack

- S3 bucket (versioned): `ledger/` (write-once JSON lines), `staging/` (2 days),
  `athena-results/` (7 days), `outputs/` (history copies tagged `report-output=history`,
  90 days). Name in stack output `OutputBucketName` and SSM `/report/Report/output-bucket`.
- Glue database `report_ledger`, one table per report source (`<report>__<source>`), with a
  projected `run_date` partition and a `refresh_id` column. The API creates or updates them
  on save.
- Athena workgroup `Report` (1 TiB per-query cutoff), DynamoDB table, Step Functions state
  machine `Refresh`, EventBridge Scheduler group `Report`, REST API on the shared domain.
- Alarms `RefreshFailed`, `ScheduleDeadLetters`, `ReconcileDeadLetters`, `ApiErrors` to an
  SNS topic and a function that pages PagerDuty when the secret `report/pagerduty` exists.

## A refresh

1. **Plan:** take the report's lock (a scheduled refresh skips while another runs),
   compute the window, estimate the cost from metadata only at $5 per TiB (Persist at a
   20 GiB floor per query, Athena sources at `maxScanGiB`, datasets as a scan of the whole
   ledger plus what this refresh can append) and stop above `costLimitUsd`.
2. **Sources,** at most four at a time: a Persist query through Persist's async Gremlin API
   whose rows a Lambda appends to the ledger, or an Athena `UNLOAD` of the source's
   `SELECT` into the ledger, run by Step Functions in workgroup `Report` and failed above
   `maxScanGiB`.
3. **Datasets,** at most four at a time, in Athena: each dataset is one statement with the
   sources (this refresh's rows) and the earlier datasets it reads in front as `WITH`
   clauses; rows are staged, at most `maxRows`.
4. **Publish:** write every dataset file and the manifest under
   `outputs/<report>/refreshes/<refresh>/`, move the report's pointer (only if no newer
   refresh was published and the report was not re-created), copy to `latest/` with the
   manifest last and remove `latest/` files of datasets the configuration no longer has.
   Publish is idempotent and retried.
5. **Failure:** record the error on the refresh, free the lock, keep the last outputs and
   raise `RefreshFailed`. The reconciler catches executions that time out or are aborted.
