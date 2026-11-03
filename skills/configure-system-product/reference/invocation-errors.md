# Diagnose an invocation 5xx

A 5xx from `POST /flows/{name}/invocations` is one of several different failures.
Identify which one before changing a flow. Do not restructure a composition,
such as replacing a child flow with inline steps, to avoid a 5xx whose cause you
have not read.

## 1. Read the response body

| Status and body | What failed | Next step |
| --- | --- | --- |
| `502 {"message":"Internal server error"}` | The System API Lambda threw. API Gateway answers this itself, so no run may exist. | Read the ApiFn log (step 2). This is a System defect: route it to Zygarde with the log line. |
| `502` with `invocationId`, `status: FAILED`, `TIMED_OUT` or `ABORTED`, `error`, `failedStep` | The run started and failed within the wait. System returns this 502 by design. | Diagnose the run with `GET /invocations/{id}` and its Step Functions history. Fix the cause, then `POST /invocations/{id}/redrive`. See [failures and redrive](failures-and-redrive.md). |
| `502` with `error: OUTPUT_INVALID` | The run succeeded, but its output breaks the definition's `outputSchema`. | Compare the `problems` with the template `Output`. |
| `503 INPUT_NORMALIZER_UNAVAILABLE` | The definition's input normalizer did not answer. | Check the normalizer product. |
| `504` | The API Lambda did not answer within API Gateway's 29 s, for example because of a slow input normalizer. | Read the ApiFn log for the request. |
| `202` with `status: RUNNING` | Not an error: the run outlasted the 20 s wait. | Poll `GET /invocations/{id}`. |

## 2. Join the access log to the API Lambda log

1. In the access log of the API the caller used, find the request's `requestId`
   and `status`. That is `/aws/apigateway/<identity>-key-api` for the shared
   domain, or `/aws/apigateway/<identity>-api` for the IAM API. These logs show
   the status, not the cause.
2. In the ApiFn log group (`<identity>-ApiLogs…`), filter on that `requestId`.
   System's logger adds it to every line. An unhandled error shows as the Lambda
   runtime's `ERROR` line with the error message.
3. Record the message, the flow, the definition and the System revision
   (`GET /products/<name>` returns `sourceRevision`) as evidence.

Known cause: `schema with key or id "<$id>" already exists` in a System revision
before prismteam-ai/system#89. A definition whose input or output schema has a
`$id` failed with 502 on every save or invocation after the first in a warm
Lambda. Upgrade System. Until then, remove `$id` from the definition's schemas
and save it again.

## 3. A child flow called from a parent step

A parent template that calls `POST /system/flows/<child>/invocations` through a
shared-domain api step sees the child's answer as the step's result or error:

- A child 5xx fails the step as `Product.Unavailable`, or as `ApiGateway.502`
  for a bound slot. The cause holds the first 500 characters of the body, so
  apply step 1 to that text.
- A child that runs longer than 20 s answers `202 RUNNING`. The parent step
  succeeds with that body, not with the child's result. Poll the child with a
  `Wait` and `GET /system/invocations/{id}` loop, or have the child report back
  by callback. Do not treat the 202 as the result.
- A child run that fails answers System's own 502 with `status: FAILED`, and the
  parent step fails. Catch it by name in the parent and keep the child's
  `invocationId` from the cause for its redrive.

Reproduce a suspected System defect with the same definition, template and
input on a mock-leaf flow, and call it at least twice: some failures only appear
in a warm Lambda.
