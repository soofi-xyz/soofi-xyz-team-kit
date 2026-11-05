# Human waits and Connect callbacks

Read this before a template waits on a person (a review task) or on any Connect
job through `WaitForCallback`.

## Chain products step to step

Chain leaf products step to step in one template: a Transform result feeds the
next step's Connect request, and Connect's result feeds the Transform answer
route. Do not hand off through EventBridge; the run then owns ordering, retries
and redrive.

Unbound shared-domain api calls fail with `Product.Unavailable` (429 and 5xx) or
`Product.Rejected` (every other 4xx); only bound calls use `ApiGateway.<status>`.
Catch `Product.Rejected` to handle a 409, 422 or 400, then read the resource to
tell which.

## Connect waits and redrive

Connect returns the stored job for a repeated `transaction_id` and neither
attaches a new `callback.task_token` nor resends the reply. So:

- A `WaitForCallback` Connect step never retries `States.Timeout` or 5xx; retry
  only `ApiGateway.429`, which happens before a job exists.
- A step a redrive may rerun sends a transaction id that changes on redrive:
  `States.Format('{}-{}', <base>, $$.Execution.RedriveCount)`. That needs
  JSONPath, so the step cannot carry `FailWhen`. Check its status in a
  following `Set` whose `FailWhen` adds
  `{ "Variable": "$$.Execution.RedriveCount", "NumericEqualsPath": "$.steps.<RoundSet>.output.redrive" }`:
  it fails the first time, and after a redrive it lets a `Choice` route back to
  the Connect step with a fresh id.
- Never use a fresh id for a step whose side effect must happen once (opening a
  ticket). For it, a redrive cannot recover without a Connect change; hand that
  to `zygarde` and `lapras`.

## Wait in rounds

Templates are capped at `TimeoutSeconds` 86400, and a `Batch` item inherits it.
Await a person in rounds shorter than the run: each round is a fresh Connect job
(round and redrive count in the transaction id) whose poll ends with
`PollExhausted` before the step's `TimeoutSeconds`. Treat `PollExhausted` and
`States.Timeout` (a recovering catch) as "start the next round".

A pending review leaves the run `TIMED_OUT`: it must be redriven daily, and Step
Functions refuses a redrive 14 days after the run stopped. With
`ToleratedFailurePercentage` 0, one failed item stops every sibling's wait; the
redrive resumes them.

## Optional body fields

An absent `.$` path is dropped from a request body only when the step compiles
to JSONata (it has `FailWhen`); in a JSONPath step it fails the run with
`States.Runtime`. Use `FailWhen`, or compute the body in an earlier step, when a
body has optional fields. Read the compiled ASL to confirm which one a step got.
