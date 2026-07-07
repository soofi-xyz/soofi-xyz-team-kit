---
name: lucario-m2d-doc-replay
description: "Use when changing or operating Lucario's M2D failed-document replay, run-status, manual approval, or restart-from-beginning behavior."
---

# Lucario: M2D Failed Document Replay

## Purpose

Lucario can re-queue failed document-processing executions for an existing M2D `runId` by invoking the M2D run-tracker Lambda (`replayFailedDocuments` / `getRunStatus`) with the document-processing state machine ARN. This is document replay only for the `replay_failed_documents` action.

Full preprocessing rerun from the beginning uses Lucario's existing `start_media_processing` action with `restartFromBeginning: true`.

## When To Use

Use this skill when an operator or agent asks to:

- replay failed documents
- rerun failed docs
- retry document processing
- inspect run status around replay
- manually resume an approved run
- restart preprocessing from the beginning for an existing run

You need a `runId` and a target environment label resolved from the user, user profile, task metadata, or runtime configuration.

## Asana Task Contract

Required fields:

- `action`: `replay_failed_documents`
- `runId`: M2D run identifier
- `environment`: target environment label

Optional fields:

- `portfolioId`
- `region`
- `stackName`

If `runId` or `environment` is missing, ask once via an Asana comment or fail validation. Follow-up comments on the same task can supply missing fields when conversation memory applies.

## Runtime Configuration

Set per resolved environment, or use shared fallbacks:

- environment-specific run-tracker Lambda name for `lambda:InvokeFunction`
- environment-specific document-processing Step Functions ARN, not preprocessing
- environment-specific CloudFormation stack name used to resolve `RunTrackerFunction*` and `DocumentProcessingStateMachine*` when explicit names/ARNs are omitted
- shared fallback configuration is allowed only when the user profile or runtime config makes the target unambiguous

Lucario's execution role needs `lambda:InvokeFunction` on run-tracker and `cloudformation:DescribeStackResources` on the M2D stack when using discovery. Cross-account replay may need an environment-specific assume role discovered from user profile, runtime config, stack outputs, or repo configuration.

## Behavior

1. Validate the request. `replay_failed_documents` does not require `sourceBucket` or `sourceKey`.
2. Call run-tracker `replayFailedDocuments`.
3. Post a short comment with requeued/skipped/error counts.
4. Poll `getRunStatus` with a bounded loop.
5. Post human-readable status comments.
6. Complete the Lucario task when the bounded replay flow finishes.

Long-running runs may need a follow-up message or future EventBridge-based monitoring; a single Lambda invocation only covers bounded polling.

## Related Full Rerun

To restart preprocessing from the beginning, keep `action: start_media_processing` and set:

- `restartFromBeginning: true`
- `runId`
- `environment`
- `approvalTaskGid`

That path reuses the existing run, forces `skipStaging = true`, forwards Asana gate task GIDs into M2D preprocessing, and automatically invokes M2D's manual approval callback after the restarted run reaches the approval wait state.

## Out Of Scope

- Do not change M2D run-tracker code from this flow. Lucario consumes it through Lambda invoke.
