# Configure S3 triggers for a flow

Start a System flow when objects land in (or leave) an S3 bucket, in addition to
calling `POST /flows/{name}/invocations`. Each flow has its own triggers. The
engine contract is [System S3 triggers](../../build-system-product/reference/s3-triggers.md).

## 1. Verify deployed support first

Confirm on the target System stage, not in this kit:

- the install has `s3Triggers: true` and the stack outputs `S3TriggerBusArn`,
  `S3TriggerQueueUrl` and `S3TriggerDispatcherLogGroup`;
- `GET /flows/{flow}/s3-triggers/{anyId}` answers `404` rather than
  `400 S3_TRIGGERS_NOT_ENABLED` or a missing route.

If support is missing, stop and hand a `PRODUCT_CHANGE` to `zygarde`. Do not
wire S3 notifications, EventBridge rules or Lambdas yourself.

## 2. Choose the options

| Decision | Choose |
| --- | --- |
| Which flow | The template-backed flow the files feed. One trigger per bucket/prefix/event on that flow. |
| `keyPrefix` / `keySuffix` | The narrowest literal folder and extension the producer writes. No wildcards. |
| `events` | `OBJECT_CREATED` for new files; add `OBJECT_REMOVED` only if the flow handles deletions. |
| `inputMode` | `OBJECT_REFERENCE` when a step (for example a Transform job) reads the file itself, or the file can exceed 192 KiB. `OBJECT_JSON` only for small JSON documents that are the flow input. |

For `OBJECT_REFERENCE`, make the definition `inputSchema` accept
`{"s3": {"bucket", "key", "versionId", "etag", "size", "eventType", "eventTime"}}`.
For `OBJECT_JSON`, the schema validates the file body itself.

A wrong option, prefix or schema is a `CONFIGURATION` finding you fix here.
Missing engine behavior is a `PRODUCT_CHANGE` for `zygarde`.

## 3. Prepare the bucket account

Ask the bucket owner (do not create IAM in their account without approval) to:

1. Enable EventBridge notifications on the bucket.
2. Create the trigger role with the trust and permissions listed in the
   [engine contract](../../build-system-product/reference/s3-triggers.md#the-role),
   using `ExternalId` `system:<systemAccountId>:<stage>:<triggerId>`.

Record the role ARN only. Never put credentials, bucket contents or sample keys
that contain personal data into tickets, manifests or evidence.

## 4. Register and read back

```http
PUT /flows/sale-availability/s3-triggers/partner-orders-dev
{
  "enabled": true,
  "bucket": "partner-inbound-dev",
  "keyPrefix": "orders/",
  "keySuffix": ".json",
  "events": ["OBJECT_CREATED"],
  "inputMode": "OBJECT_REFERENCE",
  "roleArn": "arn:aws:iam::111122223333:role/system-s3-trigger-partner-orders"
}
```

Use SigV4. Read back with `GET`, keep the returned `revision` for later updates
(`If-Match`) and confirm `status: ACTIVE` and the `ruleName`. Registration must
not start any execution. Add the trigger to a configuration bundle as an
`s3-trigger` document pinned to the flow reference.

## 5. Test sequence

Run mock-first in a non-production account with test objects whose keys carry no
personal data.

| # | Case | Expected |
| --- | --- | --- |
| 1 | Register | rule exists and is enabled; no execution started |
| 2 | Matching object | one execution; input and `source.type: s3` match the object |
| 3 | Non-matching prefix or suffix | no execution |
| 4 | Same version event again (replay endpoint) | `TriggerDuplicate`; same invocation id |
| 5 | Overwrite the object | new version, new execution |
| 6 | Schema-invalid or non-JSON body (`OBJECT_JSON`) | no execution; `TriggerRejected` and `lastRejection.reason` |
| 7 | Role trust removed | retries, then `S3TriggerDlq` and its alarm |
| 8 | `enabled: false` then upload | no execution; `TriggerSkipped` if an event was in flight |
| 9 | API invocation of the same flow | unchanged; `source.type: api` |

## 6. What to inspect and report

- Step Functions execution ARN, status and input per case.
- `S3TriggerQueue`, `S3TriggerDlq` and `S3TriggerRuleDlq` counts; the rule DLQ
  stays empty.
- Metrics in `System/S3Triggers` for the flow and trigger id.
- Dispatcher log entries: key hash, version, attempt, outcome; confirm no full
  key, body or credential appears.

Record per case: trigger id and revision, object version, invocation id,
execution ARN, expected/actual result and verdict. Report deployed evidence
separately from local schema checks; a passing manifest check is not a
triggered run. Hand dispatcher, rule or validation defects to `zygarde`.
