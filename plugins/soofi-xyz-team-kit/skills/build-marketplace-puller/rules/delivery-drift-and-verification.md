---
title: Drift Detection and Verification
impact: HIGH
tags: [delivery, drift, verification, alarms]
---

# Drift Detection and Verification

The puller is a safety net. Verify the safety net actually catches things.

## Smoke Tests (per release of the puller)

Run against a throwaway tenant in a non-production marketplace.

1. **Subscribe baseline** — release version `1.0.0` of an echo component, subscribe a tenant. Wait until `marketplace:version=1.0.0` tag appears on the stack.
2. **Push-primary happy path** — release `1.0.1`. Marketplace push deploys it. Within one puller cycle, `last-run` updates and no `reconcile_enqueued` log appears (push beat the puller to it).
3. **Drop a release** — release `1.0.2` and use chaos injection to fail the marketplace push (e.g. revoke its StackSet permission for one minute). Confirm the live tag stays at `1.0.1`. Restore permission. Within two puller cycles, the puller calls `POST /deploys` and the live tag updates to `1.0.2`.
4. **Mutate a stack manually** — change a tag on the live stack. Confirm `cloudformation:DetectStackDrift` next hour reports `DRIFTED`. Within one puller cycle, the puller enqueues a redeploy of the same released version, which clears the drift.
5. **Outside-window** — set the window to `mon-fri 02:00-04:00 UTC` and run at noon. Confirm drift is logged with `drift_skipped_outside_window` and **not** acted on.
6. **Pull-only mode** — set mode to `pull-only`, release `1.0.3`. Marketplace push is silent. Within one puller cycle, the tenant-local executor pulls the artifact via the presigned URL and updates the stack to `1.0.3`.
7. **Auth rotation** — rotate the puller's API key via Account Manager. Confirm next puller invocation reads the new key from Secrets Manager and authenticates.
8. **Disabled** — set `/marketplace/puller/enabled=false`. Confirm next invocation returns `{status: disabled}` without calling marketplace.

## Alarms

Install in every tenant subscribed to the puller:

| Alarm | Threshold |
| --- | --- |
| `Puller/NoSuccessfulRun` | `last-run` older than 2 h |
| `Puller/AuthFailure` | any `auth_failure` log in 5 min |
| `Puller/ReconcileBacklog` | any `(component)` with `live != released` for > 1 h while window is open |
| `Puller/LockHeldExpired` | a lock TTL expired without a successful run |

## Audit

Every reconcile enqueue produces:

- A structured log entry in the tenant's CloudWatch
- A `Deployments` row in the marketplace (created by the Deployer when it picks up the intent), with `intent_source=puller`

Both must be present for an action to count as audited.

## Rules

1. **The puller's own update is delivered via the same path as any other component.** Releasing a new puller version goes through the marketplace; the previous puller installs the new puller before being replaced.
2. **No silent failures.** Every error path either alarms or surfaces in the marketplace's `Deployments` table.
3. **Smoke tests run on every puller release.** They are part of the marketplace release pipeline for the puller component.
