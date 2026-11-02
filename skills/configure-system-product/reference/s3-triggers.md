# Configure S3 triggers for a flow

Start a System flow when objects land in (or leave) an S3 bucket, in addition to
calling `POST /flows/{name}/invocations`. Triggers are part of the flow: the
`s3Triggers` list saved with `PUT /flows/{name}`. The engine contract is
[System S3 triggers](../../build-system-product/reference/s3-triggers.md).

## 1. Verify deployed support first

Confirm on the target System stage, not in this kit:

- the stack outputs `S3TriggerBusArn`, `S3TriggerQueueUrl` and
  `S3TriggerDispatcherLogGroup`;
- for `OBJECT_JSON`, the deployed revision dispatches it (an older revision
  refuses an `OBJECT_JSON` trigger with `FLOW_INVALID`);
- `GET /flows/{name}/rejections` answers `200` (or `503 REJECTIONS_NOT_READY`
  while its index is still building) rather than a missing route.

Every installation, System-prod included, has the trigger infrastructure; there
is no install switch to turn on. If support is missing on the deployed revision,
stop and hand a `PRODUCT_CHANGE` to `zygarde`. Do not wire S3 notifications,
EventBridge rules or Lambdas yourself.

## 2. Choose the options

| Decision | Choose |
| --- | --- |
| Which flow | The template-backed flow the files feed. At most 10 triggers per flow; two triggers of one flow may not match the same object. |
| `id` | Kebab-case, 1–12 characters, unique within the flow. It is part of the role's `ExternalId`, so keep it stable. |
| `keyPrefix` / `keySuffix` | The narrowest literal folder and extension the producer writes. No wildcards. |
| `events` | `OBJECT_CREATED` for new files; add `OBJECT_REMOVED` only if the flow handles deletions. |
| `inputMode` | `OBJECT_REFERENCE` when a step (for example a Transform job) reads the file itself, or the file can exceed 192 KiB. `OBJECT_JSON` only for small JSON-object documents that are the flow input, created objects only. |

For `OBJECT_REFERENCE`, make the definition `inputSchema` accept
`{"s3": {"bucket", "key", "versionId", "etag", "size", "eventType", "eventTime"}}`
for every selected event (a deleted object has no `etag` or `size`); saving
checks a sample. For `OBJECT_JSON`, the schema validates the file body itself
when each object arrives (after the flow's input normalizer, if it has one),
and its `type`, if set, must include `object` or the
save is refused with `FLOW_INVALID`.

A wrong option, prefix or schema is a `CONFIGURATION` finding you fix here.
Missing engine behavior is a `PRODUCT_CHANGE` for `zygarde`.

## 3. Prepare the bucket account

Ask the bucket owner (do not create IAM in their account without approval) to:

1. Enable EventBridge notifications on the bucket.
2. Create the trigger role with the trust and permissions listed in the
   [engine contract](../../build-system-product/reference/s3-triggers.md#the-role),
   using `ExternalId` `system:<systemAccountId>:<stage>:<flow>:<id>`. For
   `OBJECT_JSON` the role also needs `s3:GetObject` and `s3:GetObjectVersion`
   under the prefix.

Record the role ARN only. Never put credentials, bucket contents or sample keys
that contain personal data into tickets, manifests or evidence.

## 4. Save the flow and read it back

Add `s3Triggers` to the flow document and save the whole flow, as for any other
flow setting:

```http
PUT /flows/sale-availability
{
  "description": "...",
  "definition": "sale-availability",
  "template": "sale-availability",
  "bindings": { ... },
  "s3Triggers": [
    {
      "id": "partner-in",
      "enabled": true,
      "bucket": "partner-inbound-dev",
      "keyPrefix": "orders/",
      "keySuffix": ".json",
      "events": ["OBJECT_CREATED"],
      "inputMode": "OBJECT_REFERENCE",
      "roleArn": "arn:aws:iam::111122223333:role/system-s3-trigger-partner-in"
    }
  ]
}
```

Use SigV4 on the IAM API, or the shared domain with the shared `x-api-key`;
both accept flows with triggers. Read back with `GET /flows/{name}` and confirm
the triggers match the request and no execution started. A refused save
(`CONFIGURATION_INVALID`, `FLOW_INVALID`, `ROLE_NOT_ASSUMABLE`,
`BUCKET_NOT_FOUND`, `BUCKET_EVENTBRIDGE_DISABLED`, `502 RULE_SETUP_FAILED`)
stores nothing; fix the cause and save again. To disable a trigger, save it
with `enabled: false`; to retire it, save the flow without it. In a
configuration bundle the triggers travel inside the flow document.

**Wait before testing.** A newly written rule takes a short while to match
(EventBridge is eventually consistent). Objects written right after the save can
start no run; wait about 30 seconds after saving a new trigger before writing
test objects, and do not report a missing run until you have.

## 5. Test sequence

Run mock-first in a non-production account with test objects whose keys carry no
personal data. The `System-s3-trigger-e2e` stack in System's dev account belongs
to System's own e2e suite (its role trusts only the e2e flows' `ExternalId`s);
prepare your own bucket and role instead.

| # | Case | Expected |
| --- | --- | --- |
| 1 | Save the flow | rule exists and is enabled; no execution started |
| 2 | Matching object (after the wait) | one execution; input and `source.type: s3` match the object |
| 3 | Non-matching prefix or suffix | no execution |
| 4 | Same object version delivered again | `TriggerDuplicate`; same invocation id |
| 5 | Overwrite the object | new version, new execution |
| 6 | `OBJECT_JSON`: non-JSON, array, schema-invalid or over-192 KiB body | no execution, not retried; listed in `GET /flows/{name}/rejections` with key and reason |
| 7 | Role trust removed | retries, then `S3TriggerDlq` and its alarm |
| 8 | `enabled: false` then upload | no execution; `TriggerSkipped` if an event was in flight |
| 9 | API invocation of the same flow | unchanged; `source.type: api` |
| 10 | Fail a leaf, start a run from an object, fix the leaf, `POST /invocations/{id}/redrive` | the run resumes at the failed step with the same invocation id and `source.type: s3` |

## 6. Rejections, failed runs and recovery

- An object refused before a run exists (`OBJECT_NOT_JSON`, `OBJECT_TOO_LARGE`,
  `OBJECT_VERSION_GONE`, `OBJECT_IDENTITY_MISSING` for an event with neither
  version nor ETag, or `INPUT_INVALID` for an input the schema or the
  flow's input normalizer refuses) is a rejection: read it with
  `GET /flows/{name}/rejections?limit=&cursor=`. Fix the object or the schema,
  then write the object again; a new version starts a new run. Rejections are
  kept 30 days; each keeps at most 20 `problems` of up to 500 characters, plus
  an `…and N more problems` line. Page with `cursor` until `nextCursor` is
  absent; never send an empty `cursor` (`400 REQUEST_INVALID`).
- A run that started and failed is an ordinary invocation: recover it with
  `POST /invocations/{id}/redrive`
  ([failures and redrive](failures-and-redrive.md)), like any other run, not by
  writing the object again.
- If the flow's input normalizer is unreachable, each attempt is listed as an
  `INPUT_NORMALIZER_UNAVAILABLE` rejection and the event is retried.
- A start that kept failing lands in `S3TriggerDlq`; fix the cause (usually the
  role) and hand redelivery questions to `zygarde`.

### Redrive, not replay

A rejected start has no run and nothing to redrive, and rejections are not
replayed. There is no per-trigger redrive route: redrive each failed run by its
invocation id.

## 7. What to inspect and report

- Step Functions execution ARN, status, input and `source` per case
  (`GET /invocations/{id}`).
- `GET /flows/{name}/rejections` entries for refused objects.
- `S3TriggerQueue`, `S3TriggerDlq` and `S3TriggerRuleDlq` counts; the rule DLQ
  stays empty.
- Metrics in `System/S3Triggers` for the flow and trigger id.
- Dispatcher log entries: key hash, version, attempt, outcome; confirm no full
  key, body or credential appears.

Record per case: flow, trigger id, object version, invocation or rejection id,
execution ARN, expected/actual result and verdict. Report deployed evidence
separately from local schema checks; a passing manifest check is not a
triggered run. Hand dispatcher, rule or save-validation defects to `zygarde`.
