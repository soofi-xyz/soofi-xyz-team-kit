# System failures and redrive

A failed, timed-out or aborted System run can be resumed with Step Functions'
own redrive: `POST /invocations/{invocationId}/redrive` (IAM, or the shared
domain with the environment key; no body). The run keeps its invocation id, its
execution and every result it already has, and starts again at the step it
stopped in. Steps that succeeded are not run again; a `Batch` runs again only its
items that failed or never started, each from the state it stopped in. It needs
a System revision that serves this route; check the target revision before
relying on it.

## Why a template cannot end in a Fail state

A redrive resumes a run at the state it stopped in. A run that ended in a `Fail`
state would resume in the `Fail` state and fail again at once, so System compiles
no `Fail` state:

| Template | System |
| --- | --- |
| a `Catch` into a `Fail` state | accepted; the catch is not compiled, so the step's own error ends the run at the step. The run reports the `Fail` state's `Error` (and fixed `Cause`) as `error`, the step's own error as `executionError` |
| a catch into `Fail` before a catch that recovers | refused: dropping it would send its errors to the recovery. Put the catch into `Fail` last |
| a `Choice` rule, `Default` or `Next` into a `Fail` state | refused: `<State> goes to Fail <Name>; a run must stop at the step that failed so a redrive runs it again: use FailWhen on the step that decides it` |

`scripts/check-system-manifest.py` makes the same check on emitted templates.

## FailWhen: fail the step that decides

Put a business-rule failure on the step whose result decides it, so a redrive
runs that step again. `FailWhen` applies to `api` steps (not `ConnectJob`) and
`Set` states:

```json
"ListEvents": {
  "Type": "Product",
  "Binding": "connect",
  "Invoke": "api",
  "WaitForCallback": true,
  "Request": { "Method": "POST", "Path": "/connect/partners/{partner}/flows/{flow}/jobs", "PathParameters": { "partner": "$.input.partner", "flow": "$.input.flow" } },
  "Parameters": { "transaction_id.$": "$.steps.Ids.output.transactionId", "callback": { "task_token.$": "$$.Task.Token" } },
  "FailWhen": [
    { "Variable": "$.steps.ListEvents.output.status", "StringEquals": "FAILED", "Error": "CONNECTOR_FAILED", "Cause": "Connect could not run the connector." },
    { "Variable": "$.steps.ListEvents.output.errors[0].message", "IsPresent": true, "Error": "CONNECTOR_FAILED", "CausePath": "$.steps.ListEvents.output.errors[0].message" }
  ],
  "Next": "Listed"
}
```

- Each rule is one comparison, optionally with more in `And` (all must hold), the
  `Error` (UPPER_SNAKE_CASE) and a fixed `Cause` or a `CausePath` read from the
  result. The first rule that holds fails the step; up to five rules.
- `Variable` reads the step's own result, an earlier result or
  `$$.Execution.RedriveCount`. Comparisons are a `Choice` rule's plus
  `StringNotEquals` (holds when there is no value too) and `NumericEqualsPath`.
  A comparison of a missing or wrongly typed value does not hold.
- To move a `Choice` that went to `Fail`, give each Fail rule an `And` that
  rules out the recovering rules before it, keep only the recovering rules in the
  `Choice`, and make the Choice's last recovering rule its `Default` when its
  `Default` was the `Fail` state.
- The step compiles to JSONata, so its `Parameters` cannot call `States.*`
  intrinsics: compute those in a `Set` just before it. It cannot `Retry`
  `States.ALL` or `States.QueryEvaluationError`, which would repeat a failure its
  own result decided. A `Catch` that recovers still catches it.
- A failed run reports the rule's `Error` and `Cause`, with
  `executionError: "States.QueryEvaluationError"`, and `failedStep`.

## Redrive a run

| Answer | Meaning |
| --- | --- |
| `200` | the redriven run succeeded; `redriveCount` says how many times it was redriven |
| `202` | it is running again; poll `GET /invocations/{id}` |
| `502` | it failed again, and stays redrivable (`redriveStatus: "REDRIVABLE"`) |
| `409 NOT_REDRIVABLE` | still running, succeeded, never started, or Step Functions refuses it (14 days after it stopped, for example); `problems` says why |

Fix what made the run fail first: a redrive runs the failed step with the same
input, against the template version the run started with. A template saved
since does not change a redrive; start a new invocation to use it.

After a redrive, an `OUTPUTS_JSONL` batch's `succeededResultsUri` names one
merged file (`merged/<Step>/<map run>/SUCCEEDED.jsonl`) with the lines of every
attempt, so the step after it reads every item. Each time a redriven run ends, a
callback URL gets its new result.

A configuration whose batch items call another System flow (Replay, for example)
decides whether a failed item fails the batch. Replay's `failedEvents: FAIL_RUN`
makes it so, and one redrive of the Replay run then redrives each failed main
invocation and starts the events that never ran.

## Test sequence

Run against a non-production System with mocked leaves first.

| # | Case | Setup | Expected |
| --- | --- | --- | --- |
| 1 | Step fails, then is fixed | a step that fails until a gate object exists | run `FAILED`, `failedStep` names the step, `redriveStatus: REDRIVABLE`; after the fix the redrive answers `200` with `redriveCount: 1`; earlier steps have no new history events |
| 2 | Fails again | redrive before fixing | `502`, `redriveCount: 1`, still `REDRIVABLE`; a second redrive gets `redriveCount: 2` |
| 3 | Batch fails midway | `MaxConcurrency: 1`, one item fails | map run shows succeeded, failed and pending items; after the redrive only the failed item's run has `redriveCount: 1`, succeeded items keep 0 and their start times, pending items start now |
| 4 | FailWhen | a result the rule matches | the step itself fails with the rule's `Error` and `Cause`; the redrive runs that step again |
| 5 | Catch into Fail | a step whose error a catch names | `error` is the `Fail` state's `Error`, `executionError` the step's own |
| 6 | Not redrivable | redrive a running and a succeeded run | `409 NOT_REDRIVABLE` with the reason |

Record per case the invocation id, execution ARN, `failedStep`, error names and,
for batches, the map run's item counts and each child's `redriveCount` before
and after. Keep these live results separate from local template checks.
