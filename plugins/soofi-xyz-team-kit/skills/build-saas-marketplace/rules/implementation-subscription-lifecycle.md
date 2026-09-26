---
title: Subscription & Release Lifecycle
impact: CRITICAL
tags: [lifecycle, state-machine, idempotency, release, rollback, subscribe]
---

# Subscription & Release Lifecycle

The six operations map to explicit state transitions. Each transition is idempotent and every side-effect is recorded in `Deployments` (see `implementation-component-registry.md`).

## State Diagrams

### Release pointer (`Releases` table row)

```
        ┌───────────────────┐
        │ current = null    │
        │ previous = null   │
        └─────────┬─────────┘
       release v1│
                 ▼
        ┌───────────────────┐
        │ current = v1      │
        │ previous = null   │
        └─────────┬─────────┘
       release v2│
                 ▼
        ┌───────────────────┐
        │ current = v2      │◀─────── rollback ─────┐
        │ previous = v1     │                       │
        └─────────┬─────────┘                       │
       release v3│                                   │
                 ▼                                   │
        ┌───────────────────┐                        │
        │ current = v3      │ ────── rollback ───────┘
        │ previous = v2     │
        └───────────────────┘
```

Rollback swaps `current ↔ previous`. It is reversible: two consecutive rollbacks restore the original release.

### Subscription (`Subscriptions` row + stack in tenant)

```
        (no row)
           │
     subscribe
           ▼
    ┌─────────────┐           redeploy (release/rollback)
    │  pending    │ ─────────────────────────────┐
    └──────┬──────┘                              │
     CFN create_complete                         │
           ▼                                     │
    ┌─────────────┐                              │
    │  active     │ ◀────────────────────────────┘
    └──────┬──────┘
     unsubscribe
           ▼
    ┌─────────────┐
    │  deleting   │
    └──────┬──────┘
     CFN delete_complete
           ▼
        (row removed)
```

## Per-Operation State Transitions

### Register (`POST /components/{name}/versions/{version}`)

1. Verify `Idempotency-Key` not replayed; if replayed, return stored response.
2. Verify `(component, version)` does not exist in `Versions`.
3. Upload artifact to S3 (see `integration-component-artifact-contract.md`).
4. Conditional `PutItem` on `Versions` with `attribute_not_exists(version)`.
5. Emit audit event `component.version.registered`.
6. No deploy side-effect.

### Release (`POST /components/{name}/release`)

1. Verify `Idempotency-Key`.
2. Verify requested version exists in `Versions`.
3. `TransactWrite`:
   - `Update Releases`: set `current_version = <target>`, `previous_version = <old current>`.
   - `Put idempotency row` with the response payload.
4. Query `Subscriptions GSI_component = <component>` for active rows.
5. For each active subscription, start a deploy Step Function execution with name derived from `Idempotency-Key + tenant_account_id`.
6. Return immediately with `affected_subscriptions = count`.

### Rollback (`POST /components/{name}/rollback`)

1. Verify `Idempotency-Key`.
2. Verify `Releases.previous_version != null` (else `409`).
3. `TransactWrite`: swap `current_version ↔ previous_version`.
4. Query active subscriptions.
5. Start deploy Step Function executions (same as release).
6. Return immediately.

### Subscribe (`POST /subscriptions`)

1. Verify `Idempotency-Key`.
2. Verify `tenant_account_id` is in the `Tenants` OU.
3. Verify component exists and `Releases.current_version != null`.
4. Verify `region ∈ component.supported_regions`.
5. `TransactWrite`:
   - `Put Subscriptions` with `status=pending`, `subscribed_version=current_version`.
   - `Put Deployments` with `action=deploy, status=in_progress`.
6. Start deploy Step Function: create stack instance in tenant.
7. Step Function on success → update `Subscriptions.status=active`, `Deployments.status=succeeded`.
8. Step Function on failure → update `Subscriptions.status=pending` (leave for manual retry), `Deployments.status=failed`.

### Unsubscribe (`DELETE /subscriptions/{tenant}/{component}`)

1. Verify `Idempotency-Key`.
2. Verify subscription exists.
3. Update `Subscriptions.status=deleting` and insert `Deployments` row with `action=delete, status=in_progress`.
4. Start delete Step Function: delete stack instance in tenant.
5. On success → delete `Subscriptions` row, `Deployments.status=succeeded`.
6. On failure → leave `Subscriptions.status=deleting`, `Deployments.status=failed`, alarm.

### List (`GET /components`)

1. Read from `Components`; paginate.
2. For each, look up `Releases` and count from `Subscriptions GSI_component`.
3. Consider caching in ElastiCache if call volume grows.

## Rules

1. **Idempotency key is the operation's identity.** Same key + same operation = same response. Different key for different intent — retries MUST reuse the key, fresh calls MUST generate a new key.
2. **Deploy / redeploy / delete is always asynchronous.** The API Lambda returns after `TransactWrite`; Step Functions drive the CFN state machine.
3. **State transitions use DynamoDB transactions.** Never do "write subscription, then write deployment" as two separate writes — partial failure leaves a row without its audit.
4. **Do not mutate `Versions` rows.** Ever. Even on rollback, `Versions` is untouched; only `Releases` changes.
5. **Redeploy on release is per-subscription, not global.** Start one Step Function execution per subscription so one tenant's failure does not gate others.
6. **On failure, do not auto-rollback to the previous version of the *subscription*.** Surface the failure; require operator decision. Auto-rollback of a subscription hides real incidents.
7. **Release-wide auto-rollback is allowed but explicit.** If >= N% of subscriptions fail within the deploy window, trigger a release rollback as a single audited operation — log the reason clearly.

## Deploy Step Function Shape

```
┌────────────────────────────────┐
│ Start                          │
└────────────┬───────────────────┘
             ▼
┌────────────────────────────────┐
│ Resolve target S3 template URL │
└────────────┬───────────────────┘
             ▼
┌────────────────────────────────┐
│ Call StackSet UpdateStackInstances│
│  OR AssumeRole + CreateStack   │
└────────────┬───────────────────┘
             ▼
┌────────────────────────────────┐
│ Poll status (wait + describe)  │
└────────────┬───────────────────┘
             ▼
┌────────────────────────────────┐
│ Update Deployments.status      │
│ Update Subscriptions on success│
└────────────┬───────────────────┘
             ▼
           End
```

## ✅ Correct

- Release v1.2.0 with 17 active subscribers starts 17 deploy Step Function executions, each with a distinct execution name.
- Rollback a tenant's subscription failure is a new subscribe call at a specific version (operator override), never auto.
- Unsubscribe updates `status=deleting` immediately so a concurrent release does not redeploy a vanishing subscription.

## ❌ Incorrect

- Subscribe synchronously waits for `CreateStack` completion inside API Gateway (timeout).
- Deploy Step Function updates `Subscriptions.subscribed_version` before CloudFormation reports success (lies about state).
- A retry of the same release triggers a second wave of deploys because the Step Function execution name was not derived from `Idempotency-Key`.
