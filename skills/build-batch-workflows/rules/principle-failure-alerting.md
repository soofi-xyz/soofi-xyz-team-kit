---
title: Alert On Critical Failures
impact: CRITICAL
tags: pagerduty, alerting, on-call, failures, dlq, step-functions, glue, reliability, observability
---

## Alert On Critical Failures

Every batch workflow MUST page the on-call rotation through **PagerDuty** when it
fails critically. A batch run that fails silently is a production incident no one
knows about — this is forbidden. Logging the error is not enough; a human MUST be
notified when batch work does not complete.

### When To Page

Trigger a PagerDuty alert when:

- The workflow reaches a terminal `Fail` state (any unrecoverable step failure).
- A worker exhausts its retries and the item/batch is abandoned.
- Items land in a **dead-letter queue** for a critical path.
- A Glue job fails (`FAILED`/`TIMEOUT`/`STOPPED`) on a critical pipeline.
- A scheduled run does not start or does not finish within its expected window.

Do NOT page for a single retriable error that later succeeds, for input
validation rejections that are part of normal processing, or for a cost-gate
pause awaiting approval (that is an expected human-in-the-loop wait, not a
failure). Reserve paging for "the batch work did not get done."

### How To Wire It

Place the alert at the point where failure becomes terminal, so one page fires
per failed execution — not one per failed item.

- **Step Functions:** add a top-level `Catch` (or wrap the body in a `Parallel`
  with a `Catch`) that routes to a PagerDuty-trigger `LambdaInvoke` task and then
  to the `Fail` state. Use `resultPath: DISCARD` on the alert task so it does not
  clobber the failure cause.
- **Glue → Step Functions:** check the Glue run state; on a failing state, route
  to the same PagerDuty-trigger task.
- **DLQ:** alarm on `ApproximateNumberOfMessagesVisible > 0` (or a DLQ consumer)
  that triggers a PagerDuty alert.

Use the SOCAPITAL **`integrating-pagerduty`** skill for the integration contract
(routing key from Secrets Manager, Events API v2 `POST /v2/enqueue`,
`event_action: "trigger"` payload, `202` + `dedup_key`, IAM). Pass a clear
`summary`, the workflow name as `source`, and the failed step plus identifiers in
`custom_details`. This requirement is the batch-specific application of the
`apply-engineering-guidelines` `observability-pagerduty-alerting` rule.

### ✅ Correct

```typescript
// CDK: workflow body wrapped so any terminal failure pages on-call before failing
const triggerPagerDutyAlert = new tasks.LambdaInvoke(this, 'TriggerPagerDutyAlert', {
  lambdaFunction: pagerDutyAlertFunction,
  payload: sfn.TaskInput.fromObject({
    Error: sfn.JsonPath.stringAt('$.workflow_failure.Error'),
    Cause: sfn.JsonPath.stringAt('$.workflow_failure.Cause'),
  }),
  resultPath: sfn.JsonPath.DISCARD,
});

const failExecution = new sfn.Fail(this, 'FailExecution');

const workflowBody = new sfn.Parallel(this, 'WorkflowBody')
  .branch(costPrediction.next(processData).next(deliverResults))
  .addCatch(triggerPagerDutyAlert.next(failExecution), {
    resultPath: '$.workflow_failure',
  });

const workflow = new sfn.StateMachine(this, 'BatchWorkflow', {
  definitionBody: sfn.DefinitionBody.fromChainable(workflowBody),
});
```

### ❌ Incorrect

```typescript
// Terminal failure path with no PagerDuty alert — the batch fails silently
const workflowBody = new sfn.Parallel(this, 'WorkflowBody')
  .branch(costPrediction.next(processData).next(deliverResults))
  .addCatch(new sfn.Fail(this, 'FailExecution'), {
    resultPath: '$.workflow_failure',
  }); // no one is paged when this fails
```

```python
# Glue job swallows a critical failure — logs only, no page
try:
    run_pipeline()
except Exception:
    logger.exception("pipeline failed")  # on-call never finds out
```

### References

- `integrating-pagerduty` skill (SOCAPITAL `soc-team-kit` plugin).
- `apply-engineering-guidelines` → `observability-pagerduty-alerting` rule.
- [Step Functions error handling (Catch / Retry)](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [PagerDuty Events API v2](https://developer.pagerduty.com/docs/send-alert-event)
