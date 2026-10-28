# System S3 triggers

Start a template-backed flow from S3 object events as a second entry point
alongside `POST /flows/{name}/invocations`. Each flow (each configured system)
gets its own trigger configuration. Zygarde builds the framework; Celebi
configures and tests a flow's triggers on a deployment that supports them.

This is a requirement for the System engine, not evidence of deployment. Verify
the target revision before claiming any part of it is supported.

## Why System owns it

Starting an invocation is System's job: definitions, flow binding, schema
validation, idempotency, correlation and the invocation record already live
here. An S3 trigger is only another way to submit the same invocation. Connect
must not start from internal events, and leaf products never see a run that was
not started, so the trigger cannot live downstream. Do not build a per-bucket
Lambda pipeline beside System.

## Relation to existing behavior

- The API path does not change. A trigger reuses the invocation code path, so
  definition input validation, template binding, retries, redrive and result
  callbacks behave as for an API call.
- Registering, updating or deleting a trigger never invokes a business flow
  (configuration-lifecycle rule).
- A definition's `inputSchema` stays the single input contract. A trigger whose
  input shape the schema cannot accept is rejected at registration.

## Install switch

Install with `s3Triggers: true`. It is off by default; with it off, no trigger
bus, queue, dispatcher, routes or alarms exist and the trigger routes return
`400 S3_TRIGGERS_NOT_ENABLED`.

## Configuration artifact

Register with IAM-signed (SigV4) calls only:

```http
PUT /flows/{flow}/s3-triggers/{triggerId}
If-Match: <revision>            (omit on create)
{
  "enabled": true,
  "bucket": "acme-inbound-dev",
  "keyPrefix": "orders/",
  "keySuffix": ".json",
  "events": ["OBJECT_CREATED"],
  "inputMode": "OBJECT_REFERENCE",
  "roleArn": "arn:aws:iam::111122223333:role/system-s3-trigger-orders"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `flow` (path) | yes | An existing template-backed flow. The trigger belongs to this flow only. |
| `triggerId` (path) | yes | Kebab-case, 3–48 characters, unique per System stage. Stable identity for replay and pinning. |
| `enabled` | yes | `false` keeps the configuration and disables event delivery. |
| `bucket` | yes | Bucket name. Same or another AWS account in the System region. |
| `keyPrefix` | yes | Literal prefix, non-empty. No wildcards or patterns. |
| `keySuffix` | no | Literal suffix. No wildcards or patterns. |
| `events` | yes | Non-empty subset of the fixed list below. |
| `inputMode` | yes | One option from the fixed list below. |
| `roleArn` | yes | IAM role in the bucket owner's account that System assumes for this trigger. |

The response returns `revision`, `externalId`, `ruleName`, `status`
(`ACTIVE`, `DISABLED`) and `lastRejection`. `GET` reads it back; `DELETE`
retires it. Configuration bundles carry it as an `s3-trigger` document pinned to
its flow reference; Deploy installs it like other System documents.

### Fixed options

| `events` | S3 EventBridge `detail-type` |
| --- | --- |
| `OBJECT_CREATED` | `Object Created` |
| `OBJECT_REMOVED` | `Object Deleted` |

| `inputMode` | Flow input | Allowed events |
| --- | --- | --- |
| `OBJECT_REFERENCE` | `{"s3": {"bucket", "key", "versionId", "etag", "size", "eventType", "eventTime"}}` | all |
| `OBJECT_JSON` | The object body parsed as a JSON object, at most 192 KiB | `OBJECT_CREATED` only |

Reject anything else with `400 OPTION_UNSUPPORTED`. Do not add free-form
predicates, regex filters, JSONPath mappings or per-source code paths; a new
need is a new fixed option in this contract.

### The role

`roleArn` is the only credential a trigger needs. System assumes it with
`ExternalId` = `system:<systemAccountId>:<stage>:<triggerId>` (deterministic and
documented, so the trust policy can be written before registration). The role:

- trusts System's trigger-manager and dispatcher roles with that `ExternalId`,
  and `events.amazonaws.com` (it is the forwarding rule's target role);
- allows `s3:GetBucketNotification` and `s3:ListBucket` on the bucket;
- allows `s3:GetObject` and `s3:GetObjectVersion` on `bucket/keyPrefix*`;
- allows `events:PutRule`, `events:PutTargets`, `events:DescribeRule`,
  `events:EnableRule`, `events:DisableRule`, `events:RemoveTargets` and
  `events:DeleteRule` on `rule/default/system-s3-*`, and `iam:PassRole` on itself;
- allows `events:PutEvents` on System's trigger bus.

System never stores long-lived credentials for a trigger and never logs session
credentials.

## Registration validation

Run in order and stop at the first failure; nothing is created on failure.

| Code | Check |
| --- | --- |
| `404 FLOW_NOT_FOUND` | the flow exists and names a template |
| `400 OPTION_UNSUPPORTED` | every option is in the fixed lists |
| `400 KEY_PREFIX_REQUIRED` | `keyPrefix` is non-empty |
| `400 INPUT_MODE_UNSUPPORTED_FOR_EVENT` | `OBJECT_JSON` is not combined with `OBJECT_REMOVED` |
| `400 INPUT_SCHEMA_MISMATCH` | for `OBJECT_REFERENCE`, a sample reference passes the definition `inputSchema` |
| `400 ROLE_ARN_INVALID` | `roleArn` is a well-formed IAM role ARN |
| `400 ROLE_NOT_ASSUMABLE` | `sts:AssumeRole` with the `ExternalId` succeeds |
| `400 BUCKET_NOT_FOUND` | `ListBucket` (max 1 key) under `keyPrefix` succeeds with the role |
| `400 BUCKET_EVENTBRIDGE_DISABLED` | the bucket's notification configuration has `EventBridgeConfiguration` |
| `409 TRIGGER_OVERLAP` | no other trigger on the same flow has the same bucket, overlapping prefix/suffix and a shared event |
| `412 REVISION_CONFLICT` | `If-Match` equals the current revision on update |
| `502 RULE_SETUP_FAILED` | the forwarding rule and target were written and read back |

Triggers on different flows may watch the same objects; each starts its own
flow.

## Execution

1. **Forwarding.** Using the role, System writes rule `system-s3-<triggerId>` on
   the bucket account's default bus. Its pattern is `source: aws.s3`, the
   selected `detail-type`s, `detail.bucket.name`, and `detail.object.key` with
   `prefix` and, when set, `suffix` matching. The target is System's trigger bus
   with the role as target role. `enabled: false` disables the rule; `DELETE`
   removes target and rule. System adds the bucket account to the trigger bus
   resource policy for the life of its triggers.
2. **Queue.** A rule on the trigger bus sends events to `S3TriggerQueue`.
   Undeliverable events go to `S3TriggerRuleDlq`.
3. **Dispatch.** The dispatcher resolves the trigger from the rule name in the
   event, skips it if disabled or deleted (`TriggerSkipped`), and assumes the role.
   For `OBJECT_CREATED` it reads `HeadObject` for the event's version and builds
   the input for `inputMode`; `OBJECT_JSON` reads the body (size checked first).
4. **Invoke.** It validates the input against the definition `inputSchema` and
   starts the flow through the same internal path as the API, with idempotency key
   `s3:<triggerId>:<bucket>/<key>@<versionId or sequencer>`. A duplicate event
   returns the existing invocation and starts nothing.
5. **Source record.** The invocation record stores
   `source: {"type": "s3", "triggerId", "triggerRevision", "bucket", "key", "versionId", "sequencer", "eventTime"}`.
   API invocations record `source: {"type": "api"}`. Status/result reads return it.

### Failures

- Not retried, recorded as `TriggerRejected` with `reason` and set as the
  trigger's `lastRejection`: `OBJECT_TOO_LARGE`, `OBJECT_NOT_JSON`,
  `INPUT_SCHEMA_INVALID`, `OBJECT_VERSION_GONE`.
- Retried with jittered backoff (30 s doubling, at most 15 min apart, up to 8
  attempts, `TriggerRetried`), then moved to `S3TriggerDlq`: `AssumeRole`
  failures, S3 throttling or 5xx, and invocation-start errors.
- A started run that fails is an ordinary failed invocation; use redrive, not a
  new S3 event.

## Outputs and observability

Stack outputs: `S3TriggerBusArn`, `S3TriggerQueueUrl`, `S3TriggerDlqUrl`,
`S3TriggerRuleDlqUrl`, `S3TriggerDispatcherLogGroup`, `S3TriggerDlqAlarmName`,
`S3TriggerRuleDlqAlarmName`, `S3TriggerQueueAgeAlarmName`,
`S3TriggerRejectedAlarmName`.

Metrics in `System/S3Triggers` with dimensions `Flow` and `TriggerId`:
`TriggerStarted`, `TriggerDuplicate`, `TriggerSkipped`, `TriggerRejected`,
`TriggerRetried`.

Logs carry trigger id, bucket, a SHA-256 hash of the key, version or sequencer,
attempt, outcome and invocation id. Never log object bodies, full keys (keys can
contain names or other PII) or credentials.

## Replay

`POST /flows/{flow}/s3-triggers/{triggerId}/replay {"key", "versionId"}` runs
steps 3–5 for one object with the same idempotency key: an existing invocation
is returned, otherwise a new one starts. Use it after fixing a rejected object or
draining the DLQ. It requires the trigger to be enabled.

## Acceptance

Verify on a deployment, mock leaves first, same-account and cross-account bucket:

1. Registration rejects each validation code above and creates no rule on failure.
2. Registration creates the rule and starts no flow; read-back matches the request.
3. A matching `OBJECT_CREATED` starts exactly one invocation with the expected
   input and `source`; non-matching prefix/suffix starts none.
4. A repeated event for the same version is a `TriggerDuplicate`; a new version
   starts a new run.
5. `OBJECT_JSON` with a non-JSON, oversized or schema-invalid body is rejected
   without retry and sets `lastRejection`.
6. A role that cannot be assumed retries and lands in `S3TriggerDlq` with the alarm.
7. `enabled: false` stops new runs; `DELETE` removes the rule.
8. API invocations are unchanged (`source.type: api`).
9. No full key, body or credential appears in dispatcher logs.

Celebi configures concrete triggers with
[the configure guide](../../configure-system-product/reference/s3-triggers.md)
only after this support is verified on the target deployment.
