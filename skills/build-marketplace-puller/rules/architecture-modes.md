---
title: Modes
impact: CRITICAL
tags: [architecture, modes, push, pull]
---

# Modes

The puller has three operating modes per environment, set by SSM parameter `/marketplace/puller/mode`. Each mode has a distinct deploy path; do NOT mix them.

## `push-primary` (default)

- Marketplace push (Deployer Step Function in marketplace account) is the primary deploy path.
- Puller runs every 15 minutes for drift reconciliation only.
- When drift is detected and the update window allows, puller calls `POST /deploys` on the marketplace API with `intent_source=puller`.
- The marketplace Deployer executes via the standard `stackset` or `assume-role-cfn` adapter.

This is the default for any tenant inside the AWS Organization.

## `pull-only`

- Marketplace push is disabled for this environment.
- The puller's component bundle includes a **tenant-local CFN executor** stack: SQS queue + Step Function + Lambda that runs entirely in the tenant account.
- When the puller detects a needed deploy, it pulls the artifact from the marketplace S3 bucket via a **read-only presigned URL** that the marketplace mints in the desired-state response.
- The tenant-local executor uses raw `cloudformation:CreateStack` / `UpdateStack` against the local account.
- The component manifest of products supporting `pull-only` MUST set `adapter=tenant-local`.

Used when:

- The tenant account is outside the AWS Organization.
- Network policy forbids inbound StackSet operations from the marketplace account.
- The customer requires an air-gapped audit trail of who applied each change (the executor logs are entirely in their account).

## `disabled`

- Schedule disabled. SSM `/marketplace/puller/enabled=false`.
- Used during incident response or planned freezes.
- The marketplace continues to push releases normally; the puller is silent.

## Mode Switching

- Set by `POST /environments/{env_id}/puller-mode { mode, window }` on the Account Manager API (scope `env:admin`).
- Switching `push-primary` ↔ `pull-only` requires a one-time stack template swap; the Deployer handles this by issuing a release of the puller component with the new manifest.
- Switching to `disabled` is instantaneous (SSM update only).

## Rules

1. **Modes are environment-scoped.** Never assume tenant-wide mode.
2. **`pull-only` requires every subscribed component to declare `adapter=tenant-local` support.** Components without it are unsubscribed from the environment with a clear error.
3. **`disabled` is auditable**: setting it emits `puller.disabled` event with the operator identity and reason.
4. **Mode is read on every puller invocation** from SSM, not cached across invocations.
