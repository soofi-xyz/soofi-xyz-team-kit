---
title: Deploy Orchestrator
impact: CRITICAL
tags: [implementation, step-functions, sqs, idempotency]
---

# Deploy Orchestrator

A single Step Function in the marketplace account drives every deploy. SQS feeds it; nothing else may write CloudFormation in target accounts.

## Step Function Definition

```
ResolveContext
   └─ ValidateContextSchema
        └─ ReserveBasePath?  (only if basePathRequired)
             └─ ChooseAdapter
                  ├─ DeployStackSet
                  └─ DeployAssumeRole
                  └─ WaitForTerminal
                       └─ RecordDeployment
                            └─ EmitDeployCompleted
```

## States in Detail

| State | Type | Notes |
| --- | --- | --- |
| ResolveContext | Lambda | Calls Domain Router + Account Manager APIs; returns `EnvironmentContext` |
| ValidateContextSchema | Lambda | Zod validation against the version pinned in the component manifest |
| ReserveBasePath | Lambda | Conditional create on `BasePaths`; idempotent |
| ChooseAdapter | Choice | Routes by `componentManifest.adapter` |
| DeployStackSet | Lambda | `CreateStackInstances` or `UpdateStackInstances` |
| DeployAssumeRole | Lambda | AssumeRole + `CreateChangeSet` + `ExecuteChangeSet` |
| WaitForTerminal | Wait + Choice loop | polls every 30 s, max 60 minutes |
| RecordDeployment | Lambda | Append to `Deployments` table with parameters digest |
| EmitDeployCompleted | EventBridge | Publishes `marketplace.deploy.completed` |

## Idempotency

The Step Function execution name is `sha256(component|version|env_slug)`. Re-enqueueing the same intent is a no-op (Step Functions rejects duplicate names within a 90-day window). For longer windows, the Lambda explicitly compares `parameters_digest` of the current intent to the latest `Deployments` row for `(component, env_slug)`; if they match and the prior status is `succeeded`, it short-circuits to `RecordDeployment` with status `noop`.

## Failure Handling

- Each state has `Retry` with exponential backoff for transient AWS errors.
- Terminal failures route to a `RecordFailure` state that writes `Deployments.status=failed` and emits `marketplace.deploy.failed`.
- Rollback is initiated by the marketplace's `Rollback component` API enqueuing a fresh deploy intent for the previous version. The Deployer does NOT do automatic rollback.

## Tables Read / Written

| Table | Read | Write |
| --- | --- | --- |
| `Components`, `Versions`, `Releases` | yes | no |
| `Subscriptions` | yes | no |
| `Environments` (Account Mgr) | via API | no |
| `BasePaths` (Domain Router) | via API | yes (reserve) |
| `Deployments` | yes | yes (start, terminal) |

## Rules

1. **One Step Function, one direction.** No code path other than the Step Function executes the deploy adapters.
2. **No DynamoDB cross-product reads.** Account Manager and Domain Router data is fetched via their public APIs.
3. **Every state writes a structured log** with `intent_id`, `component`, `version`, `env_slug`, `state_name`.
4. **Parameters digest is required** for the no-op short-circuit to be safe.
