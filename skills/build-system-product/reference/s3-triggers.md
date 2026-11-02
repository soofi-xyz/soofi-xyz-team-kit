# System S3 triggers

Start a template-backed flow from S3 object events as a second entry point
alongside `POST /flows/{name}/invocations`. S3 triggers are part of the flow
configuration. Zygarde builds the framework; Celebi configures and tests a
flow's triggers on a deployment that has it.

This describes the System engine, not a deployment. Verify the target
revision before claiming any part of it is supported.

## Why System owns it

Starting an invocation is System's job: definitions, flow binding, schema
validation, idempotency, correlation and the invocation record already live
here. An S3 trigger is only another way to submit the same invocation. Connect
must not start from internal events, and leaf products never see a run that was
not started, so the trigger cannot live downstream. Do not build a per-bucket
Lambda pipeline beside System.

## Relation to existing behavior

- The API path does not change. The dispatcher starts runs through the API's
  invocation path, so input validation, input normalizers (the dispatcher may
  invoke ProductCallFn), template binding, retries, redrive and result callbacks
  behave as for an API call.
- Saving a flow with triggers never starts it (configuration-lifecycle rule).
- A definition's `inputSchema` stays the single input contract.
- Every installation, System-prod included, has the trigger bus, queue,
  dispatcher, DLQs and alarms. There is no install parameter or deploy prop
  that turns S3 triggers on or off.

## Configuration

Triggers are the `s3Triggers` list (1–10 entries) of the flow, saved with
`PUT /flows/{name}` like every other flow setting, and read back with
`GET /flows/{name}`. There is no separate trigger endpoint. Saving works on the
IAM (SigV4) API and on the shared domain with the shared `x-api-key`, like any
other configuration call.

```http
PUT /flows/sale-availability
{
  "description": "...",
  "definition": "sale-availability",
  "template": "sale-availability",
  "bindings": { ... },
  "s3Triggers": [
    {
      "id": "orders-in",
      "enabled": true,
      "bucket": "acme-inbound-dev",
      "keyPrefix": "orders/",
      "keySuffix": ".json",
      "events": ["OBJECT_CREATED"],
      "inputMode": "OBJECT_REFERENCE",
      "roleArn": "arn:aws:iam::111122223333:role/system-s3-trigger-orders"
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Kebab-case, 1–12 characters, unique within the flow. |
| `enabled` | yes | `false` keeps the trigger and disables its rule. |
| `bucket` | yes | Bucket name, in the System region; same or another AWS account. |
| `keyPrefix` | yes | Literal prefix, non-empty. No wildcards or patterns. |
| `keySuffix` | no | Literal suffix. No wildcards or patterns. |
| `events` | yes | Non-empty subset of the fixed list below. |
| `inputMode` | yes | One option from the fixed list below. |
| `roleArn` | yes | IAM role in the bucket owner's account that System assumes for this trigger. |

No other property is accepted. A configuration bundle carries triggers inside
the flow document; there is no separate trigger document.

### Fixed options

| `events` | S3 EventBridge `detail-type` |
| --- | --- |
| `OBJECT_CREATED` | `Object Created` |
| `OBJECT_REMOVED` | `Object Deleted` |

| `inputMode` | Flow input | Allowed events |
| --- | --- | --- |
| `OBJECT_REFERENCE` | `{"s3": {"bucket", "key", "versionId", "etag", "size", "eventType", "eventTime"}}`, built from the event without reading the object; fields S3 does not report (such as a deleted object's size) are left out | all |
| `OBJECT_JSON` | The object body, which must be a JSON object of at most 192 KiB | `OBJECT_CREATED` only |

Do not add free-form predicates, regex filters, JSONPath mappings or per-source
code paths; a new need is a new fixed option in this contract.

### The role

`roleArn` is the only credential a trigger needs. System assumes it with
`ExternalId` = `system:<systemAccountId>:<stage>:<flow>:<id>`, which is
deterministic so the trust policy can be written before the flow is saved. The
role:

- trusts System's account with that `ExternalId`, and `events.amazonaws.com`
  (it is the forwarding rule's target role);
- allows `s3:ListBucket` and `s3:GetBucketNotification` on the bucket;
- allows `events:PutRule`, `events:PutTargets`, `events:DescribeRule`,
  `events:RemoveTargets` and `events:DeleteRule` on `rule/default/system-s3-*`,
  and `iam:PassRole` on itself;
- allows `events:PutEvents` on System's trigger bus (stack output
  `S3TriggerBusArn`);
- for `OBJECT_JSON`, also allows `s3:GetObject` and `s3:GetObjectVersion` on
  `bucket/keyPrefix*`.

The bucket must send its events to EventBridge. System stores no credentials
for a trigger and never logs session credentials.

## Saving a flow with triggers

A refused save stores nothing and writes no rule. Every trigger is checked
before any rule is written.

| Code | Refused when |
| --- | --- |
| `400 CONFIGURATION_INVALID` | a field is missing, unknown or malformed: an option outside the fixed lists, an empty prefix, a bad id, bucket or role ARN |
| `400 FLOW_INVALID` | two triggers share an id; `OBJECT_JSON` is combined with `OBJECT_REMOVED`; an `OBJECT_JSON` trigger's definition `inputSchema` has a `type` that excludes `object`; a sample `OBJECT_REFERENCE` input for a selected event fails the definition `inputSchema`; two triggers of the flow can match the same object (same bucket, one prefix extends the other, suffixes compatible, a shared event) |
| `400 ROLE_NOT_ASSUMABLE` | System cannot assume `roleArn` with the `ExternalId` |
| `400 BUCKET_NOT_FOUND` | the role cannot list the bucket under `keyPrefix` |
| `400 BUCKET_EVENTBRIDGE_DISABLED` | the bucket's notification configuration has no EventBridge, or the role cannot read it |
| `502 RULE_SETUP_FAILED` | the forwarding rule and target could not be written and read back |

Triggers on different flows may watch the same objects; each starts its own
flow.

Then, as the role, System writes rule `system-s3-<first 24 hex of sha-256 of
account:stage:flow:id>` on the bucket account's default bus. Its pattern is
`source: aws.s3`, the selected `detail-type`s, the bucket name and the literal
key prefix and suffix; its target is System's trigger bus with the role as
target role. For another account's bucket System first adds that account to the
trigger bus resource policy. `enabled: false` writes the rule disabled. A
trigger dropped from the flow, or moved to another account, has its rule
removed; if its role is already gone the rule stays behind, and its events start
nothing.

A new rule takes a short while to match (EventBridge is eventually consistent):
objects written right after the save may start no run. The e2e waits about 30
seconds after saving a trigger before writing objects.

## Execution

1. **Queue.** A rule on System's trigger bus sends forwarded events to
   `S3TriggerQueue`. Events the bus rule cannot deliver go to
   `S3TriggerRuleDlq`.
2. **Match.** The dispatcher reads the current triggers of every flow watching
   the bucket and keeps those whose prefix, suffix and events match. A disabled
   trigger is skipped (`TriggerSkipped`).
3. **Input.** `OBJECT_REFERENCE` builds the reference from the event.
   `OBJECT_JSON` refuses an object larger than 192 KiB from the event's size
   before reading, and an event with neither `version-id` nor `etag` without
   reading it. Otherwise it assumes the trigger role and reads the object: exactly
   the event's version, or in an unversioned bucket only while its ETag is still
   the event's (`If-Match`), so a later write is never read for an earlier
   event. The body must parse as a JSON object.
4. **Start.** It starts the flow through the API's invocation path with
   idempotency key `s3:<id>:<sha-256 of bucket/key@versionId or sequencer>`. A
   repeated event returns the first run (`TriggerDuplicate`) and starts nothing.
5. **Source.** The run records
   `source: {"type": "s3", "triggerId", "bucket", "key", "versionId", "sequencer", "eventTime"}`,
   returned by `GET /invocations/{id}`. API runs record `{"type": "api"}` and
   event-trigger runs `{"type": "event"}`; runs started before sources were
   recorded have none.

### Failures

- **Rejected, not retried** (`TriggerRejected`): `OBJECT_TOO_LARGE`,
  `OBJECT_NOT_JSON` (not JSON, an array, a scalar or no body),
  `OBJECT_VERSION_GONE` (the version, or the ETag-matched write, no longer
  exists), `OBJECT_IDENTITY_MISSING` (the event has neither `version-id` nor
  `etag`, so the object is not read), and `INPUT_SCHEMA_INVALID` (the definition `inputSchema` refuses the
  input). Other 4xx refusals of the start, except 429, are also not retried.
  Each is recorded as a [rejection](#rejections).
- **Retried** with jitter, 30 s doubling to at most 15 min apart, 8 attempts
  (`TriggerRetried`), then moved to `S3TriggerDlq`: a role that cannot be
  assumed while reading, S3 throttling or 5xx, and 429/5xx start errors
  (including `503 INPUT_NORMALIZER_UNAVAILABLE`, which is also recorded as a
  rejection on each attempt).
- **A started run that fails** is an ordinary invocation. Recover it with
  `POST /invocations/{id}/redrive`, not a new S3 event.

## Rejections

Every start refused before a run exists is recorded as a rejection of its flow,
whichever way it came: API, event trigger or S3 trigger. Read them with
`GET /flows/{name}/rejections?limit=&cursor=` on the IAM API or the shared
domain with the shared key.

- Newest first; `limit` 1–100 (default 50); `cursor` is the previous page's
  `nextCursor`, absent on the last page (even one exactly `limit` long).
  Unknown flow `404`; bad `limit` or
  `cursor`, including an empty `?cursor=`, is `400 REQUEST_INVALID`.
- `503 REJECTIONS_NOT_READY` while the index is still being built after the
  install that added it; retry after a few minutes.
- Each item has `rejectionId`, `flow`, `rejectedAt`, `error`, `problems`,
  `source` (for S3 the trigger, bucket, key and version), `idempotencyKey` and,
  for a service-key caller, `tenantId`. The input is not stored. `problems`
  keeps at most the first 20, each cut to 500 characters, plus a final
  `…and N more problems` line when there were more.
- `error` is `REQUEST_INVALID`, `INPUT_INVALID` (the definition `inputSchema`
  or the flow's input normalizer refused the input),
  `INPUT_NORMALIZER_UNAVAILABLE` (the start answered `503` because the input
  normalizer could not be reached and the flow refuses in that case),
  `IDEMPOTENCY_CONFLICT`, `FLOW_INVALID`, `NOT_FOUND` (definition or template),
  `TRIGGER_MAPPING_FAILED` (an event trigger's input mapping failed; `source`
  `{"type": "event"}`),
  or from the S3 dispatcher `OBJECT_NOT_JSON`, `OBJECT_TOO_LARGE`,
  `OBJECT_VERSION_GONE`, `OBJECT_IDENTITY_MISSING`. A schema-invalid S3 input is recorded as
  `INPUT_INVALID` with its S3 `source`.
- An `INPUT_INVALID` or `INPUT_NORMALIZER_UNAVAILABLE` reply's `invocationId`
  is its `rejectionId`.
- Kept 30 days. A start for a flow that does not exist is not recorded.
  Recording never changes the caller's reply; a failed write is only logged.

## Redrive, not replay

A run an S3 trigger started that failed, timed out or was aborted is an ordinary
invocation, so the existing `POST /invocations/{id}/redrive` resumes it like any
other run: same invocation id, from the step that failed. A rejected start has
no run and nothing to redrive. There is no replay of rejections and no
per-trigger redrive route; fix the object or the schema and write the object
again.

## Outputs and observability

Stack outputs: `S3TriggerBusArn`, `S3TriggerQueueUrl`, `S3TriggerDlqUrl`,
`S3TriggerRuleDlqUrl`, `S3TriggerDispatcherLogGroup`, `S3TriggerDlqAlarmName`,
`S3TriggerRuleDlqAlarmName`, `S3TriggerQueueAgeAlarmName`,
`S3TriggerRejectedAlarmName`.

Metrics in `System/S3Triggers` with dimensions `Flow` and `TriggerId`:
`TriggerStarted`, `TriggerDuplicate`, `TriggerSkipped`, `TriggerRejected`,
`TriggerRetried`. Both DLQs, queue age and rejections have alarms.

Dispatcher logs carry the trigger id, a SHA-256 of the key, version or
sequencer, attempt, outcome and invocation id. Never log object bodies, full
keys (keys can contain names or other PII) or credentials.

## Acceptance

Verify on a deployment, mock leaves first, same-account and cross-account
bucket:

1. Each save refusal above stores nothing and writes no rule.
2. A save writes the rule and starts no flow; `GET /flows/{name}` returns the
   triggers as saved.
3. After the rule settles, a matching `OBJECT_CREATED` starts exactly one run
   with the expected input and `source`; a non-matching prefix or suffix starts
   none.
4. A repeated event for the same version is a `TriggerDuplicate`; a new version
   starts a new run.
5. `OBJECT_JSON` with a non-JSON, array, oversized or schema-invalid body, or
   an event with neither version nor ETag, starts
   no run, is not retried and appears in `GET /flows/{name}/rejections` with its
   key and reason; a good body starts one run with the body as input.
6. A role that cannot be assumed at dispatch retries and lands in
   `S3TriggerDlq` with the alarm.
7. `enabled: false` stops new runs; dropping the trigger removes the rule.
8. A failed S3-started run resumes with `POST /invocations/{id}/redrive` and
   keeps its invocation id and `source`.
9. API invocations are unchanged (`source.type: api`); a schema-invalid API
   start appears in the rejections with `source.type: api`.
10. No full key, body or credential appears in dispatcher logs.

The System repository's `npm run test:e2e` covers this after each pull request's
dev deploy, through the shared domain with the shared key. Besides the
`OBJECT_REFERENCE` and `OBJECT_JSON` cases it checks that each object write
starts one run and a repeated idempotency key returns that run, that dispatcher
logs carry key hashes and never keys, that a read blocked by a temporary
bucket-policy Deny is retried and starts its run once the Deny is gone, and that
`POST /invocations/{id}/redrive` resumes a failed S3 run. Its S3 cases need AWS
credentials for the System account: CI assumes
`arn:aws:iam::904370092316:role/system-e2e-github` through GitHub OIDC. The
fixtures are the CloudFormation stack `System-s3-trigger-e2e`: bucket
`system-s3-trigger-e2e-<account>-<region>` (EventBridge on, `e2e/` objects
expire after a day) and trigger role `system-s3-trigger-e2e`. The suite deploys
the stack when it is missing or changed, keeps it, and deletes only the objects
it wrote; delete the stack to remove the fixtures. Without credentials the S3
cases are skipped.

Celebi configures concrete triggers with
[the configure guide](../../configure-system-product/reference/s3-triggers.md)
only after this support is verified on the target deployment.
