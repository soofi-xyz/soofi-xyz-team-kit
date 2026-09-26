---
title: Reconciler
impact: CRITICAL
tags: [implementation, reconciler, idempotency, locking]
---

# Reconciler

The reconciler is the single Lambda function the EventBridge schedule invokes. It MUST be idempotent, time-bounded, and free of side effects outside `POST /deploys` (or the tenant-local executor's SQS).

## Pseudocode

```python
def handler(event, context):
    if not enabled():
        return {"status": "disabled"}

    if not acquire_lock():
        return {"status": "concurrent_run_skipped"}

    try:
        api_key = secrets.get(f"/{env_slug}/puller/marketplace-api-key")
        last_etag = ssm.get(f"/marketplace/puller/last-etag")
        desired = get_desired_state(api_key, env_id, if_none_match=last_etag)

        if desired.status == 304 and not force_full_scan():
            log("desired_state_unchanged")
            return {"status": "no_changes"}

        ssm.put(f"/marketplace/puller/last-etag", desired.etag)

        for sub in desired.subscriptions:
            stack_name = f"{sub.component}-{env_slug}"
            live = describe_stack_optional(stack_name)
            live_version = live.tags.get("marketplace:version") if live else None

            if live_version == sub.released_version and not drift_detected(stack_name):
                continue

            if not in_update_window(now()):
                log("drift_skipped_outside_window", sub.component, live_version, sub.released_version)
                continue

            mode = ssm.get("/marketplace/puller/mode")
            intent_id = f"puller-{env_slug}-{sub.component}-{sub.released_version}"
            if mode == "pull-only":
                enqueue_local_executor(sub, intent_id)
            else:
                enqueue_marketplace_deploy(api_key, sub, env_slug, intent_id)

            log("reconcile_enqueued", sub.component, live_version, sub.released_version)

        ssm.put(f"/marketplace/puller/last-run", now_iso())
        return {"status": "reconciled"}

    finally:
        release_lock()
```

## Single-Execution Lock

DynamoDB table `PullerLock` (PK `env_slug`).

```python
def acquire_lock():
    try:
        ddb.put_item(
            Item={"env_slug": env_slug, "expires_at": now() + 600},
            ConditionExpression="attribute_not_exists(env_slug) OR expires_at < :now",
            ExpressionAttributeValues={":now": now()},
        )
        return True
    except ConditionalCheckFailedException:
        return False
```

The 600-second TTL self-heals if the Lambda is killed mid-run.

## Drift Detection

For each subscribed stack:

1. Cheap path: compare `marketplace:version` tag to `released_version`. Differs → reconcile.
2. Expensive path: invoke `cloudformation:DetectStackDrift` once per hour per stack (rate-limited via SSM `/marketplace/puller/last-drift-check`).
3. If drift status is `DRIFTED`, reconcile regardless of version match.

## Update Windows

`/marketplace/puller/window` SSM value is a cron-like spec, e.g.:

```
mon-fri 02:00-06:00 UTC
sat,sun never
```

The reconciler computes the next window-open time and skips with reason if `now()` is outside.

## Error Handling

- Marketplace 5xx → log + skip the subscription, retry next tick. No backoff state stored.
- Marketplace 401/403 → log `auth_failure`, emit alarm, skip the run. The customer must rotate the puller key via Account Manager.
- AssumeRole / DDB / Secrets failures → throw, Step Function retries, lock auto-expires.

## Rules

1. **No more than one POST /deploys per `(component, version)` per puller invocation.** The intent_id makes the marketplace dedup; the puller does not need its own dedup beyond the lock.
2. **Drift detection is rate-limited.** Default 1/h per stack. Adjustable via SSM but never < 5 minutes.
3. **The reconciler runs only one mode per invocation.** If the SSM mode value changes mid-run, the value read at the start wins.
4. **Logs are structured JSON.** Fields: `env_slug`, `component`, `live_version`, `released_version`, `action`, `reason`.
