---
title: PagerDuty Critical Failure Alerting
impact: CRITICAL
tags: pagerduty, alerting, on-call, incidents, observability, monitoring, failures, reliability
---

## PagerDuty Critical Failure Alerting

Every service MUST page the on-call rotation through **PagerDuty** when a critical
failure or critical issue occurs. Critical production problems MUST NEVER fail
silently. A service that can fail critically but cannot page on-call is an
incomplete service.

### What Counts As Critical

Page PagerDuty for failures that need a human now, including:

- A terminal/unrecoverable failure of a workflow, job, or scheduled run.
- Exhausted retries on a critical operation (the work did not complete).
- Messages landing in a dead-letter queue (DLQ) for a critical path.
- A failed deployment, migration, or production data load.
- A breached critical health/SLO check (e.g. a daily job that did not run).

Do NOT page for expected, self-healing, or non-critical conditions (a single
retriable error that later succeeds, validation rejections that are returned to
the caller, debug noise). Over-paging trains responders to ignore alerts.

### How To Integrate

Use the SOCAPITAL **`integrating-pagerduty`** skill for the concrete integration
contract. The required pattern is:

1. Resolve the per-service routing key from AWS Secrets Manager at runtime
   (never hardcode it, never put it in env vars or logs).
2. Gate paging to the production account so non-prod runs do not page on-call.
3. `POST https://events.pagerduty.com/v2/enqueue` (Events API v2) with an
   `event_action: "trigger"` payload; treat HTTP `202` as accepted and capture
   the returned `dedup_key`.
4. Scope IAM to `secretsmanager:GetSecretValue` on the exact secret ARN.

Wire the alert at the point where a failure becomes terminal — e.g. a Step
Functions `Catch` that routes to a PagerDuty-trigger task before the `Fail`
state, an SQS DLQ alarm/consumer, or a `catch`/finalizer in a Lambda that owns a
critical operation. Keep the alert payload decoupled from any one workflow's
internal shape; pass a clear `summary`, a `source`, and structured
`custom_details`.

### ✅ Correct

```typescript
// Critical operation pages on terminal failure, then rethrows
import { triggerPagerDutyAlert } from './pagerduty';

export const handler = async (event: DailyLoadEvent): Promise<void> => {
  try {
    await runDailyLoad(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await triggerPagerDutyAlert({
      serviceName: 'daily-load',
      summary: `Daily load failed: ${message}`,
      source: 'daily-load-service',
      severity: 'critical',
      customDetails: { runId: event.runId, cause: message },
    });
    throw error; // preserve the failure for Step Functions / retries / DLQ
  }
};
```

```typescript
// CDK: Step Functions routes terminal failure to a PagerDuty trigger before failing
const alert = new tasks.LambdaInvoke(this, 'TriggerPagerDutyAlert', {
  lambdaFunction: pagerDutyAlertFunction,
  resultPath: sfn.JsonPath.DISCARD,
});

processData.addCatch(alert.next(new sfn.Fail(this, 'FailExecution')), {
  resultPath: '$.error',
});
```

### ❌ Incorrect

```typescript
// Critical failure swallowed — nothing pages, the problem is invisible
export const handler = async (event: DailyLoadEvent): Promise<void> => {
  try {
    await runDailyLoad(event);
  } catch (error) {
    console.error('daily load failed', error); // log only — on-call never knows
  }
};
```

```typescript
// Terminal Step Functions failure with no alerting path
const workflow = new sfn.StateMachine(this, 'DailyLoad', {
  definitionBody: sfn.DefinitionBody.fromChainable(processData), // no Catch -> PagerDuty
});
```

### References

- `integrating-pagerduty` skill (SOCAPITAL `soc-team-kit` plugin) — routing key
  retrieval, Events API v2 call, payload structure, and IAM.
- [PagerDuty Events API v2](https://developer.pagerduty.com/docs/send-alert-event)
- [Step Functions error handling (Catch / Retry)](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
