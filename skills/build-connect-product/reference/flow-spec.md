# Connect — flow specification v3

Five documents describe everything Connect does. Validate each against its
definition in [`contracts/flow.schema.json`](contracts/flow.schema.json)
(JSON Schema Draft 2020-12, `$defs/<Name>`) before storing it, then apply the
semantic checks in §6. Worked documents are in [examples/](examples/).

| Document | Author | Changes how often |
| --- | --- | --- |
| `Flow` | Connect engineer | When partner behavior changes |
| `PartnerConfiguration` | Operator, per partner × tenant × environment | When credentials, prefixes or cutoffs change |
| `Activation` | Operator | When a schedule, drop zone or webhook is turned on or off |
| `JobRequest` | Calling product | Every call |
| `ResultManifest` | Connect | Every job |

## 1. Flow

```json
{
  "version": "3",
  "flow_name": "partner-file-intake",
  "kind": "flow",
  "description": "Land new partner files and archive the source copy.",
  "connections": { "inbox": { "types": ["azure_blob", "sftp", "s3", "drop_zone"] } },
  "parameters": { "type": "object", "properties": {} },
  "partner_parameters": {
    "type": "object",
    "required": ["prefix", "pattern", "archive_prefix"],
    "properties": { "prefix": {"type": "string"}, "pattern": {"type": "string"},
                    "archive_prefix": {"type": "string"}, "cutoff": {"type": "string"} }
  },
  "triggers": ["api", "schedule"],
  "limits": { "timeout_seconds": 3600, "max_items": 5000, "max_bytes": 21474836480 },
  "definition": { "StartAt": "ListNewFiles", "States": { "...": {} } }
}
```

- `connections` declares aliases and the connection types each alias accepts.
  The compiler checks every verb against the intersection of those types'
  capabilities, so a flow that works for Azure also works for SFTP and S3.
- `parameters` and `partner_parameters` are JSON Schemas for `$.request` and
  `$.partner`. Undeclared fields are rejected.
- `triggers` lists which activation kinds may run the flow (`api`,
  `schedule`, `drop_zone`, `webhook`).
- `webhooks` declares named inbound webhooks and their correlation contract;
  their auth lives on the partner configuration.
- `limits` are required. They bound runtime, item count, bytes and optional
  `max_cost_usd`; the runtime stops the job when a limit is reached.
- `kind: lookup` allows exactly one `CALL` and compiles to EXPRESS.
- `delivery_settings` holds flow-wide default `Retry` / `Catch`; `dry_run`
  holds a mocked response for callers that pass `dry_run: true`.

## 2. Partner configuration

```json
{
  "configuration_id": "americor-prod",
  "partner": "americor",
  "tenant": "socapital",
  "environment": "prod",
  "connections": {
    "inbox": {
      "type": "azure_blob",
      "account_url": "https://<account>.blob.core.windows.net",
      "containers": ["americor"],
      "auth": { "profile": "connection_string", "secret_ref": "arn:aws:secretsmanager:<region>:<account>:secret:<name>" }
    }
  },
  "parameters": { "prefix": "TO_SOC/", "pattern": "*.xlsx", "archive_prefix": "TO_SOC/completed/",
                  "cutoff": "2026-06-01T00:00:00Z" },
  "keys": {},
  "allow_delete": false
}
```

Bind every alias the flow declares. Keep only references to secrets. `keys`
names PGP or signing keys by reference for `DECRYPT` and webhook auth.
`webhooks.<name>.auth` configures inbound webhook authentication
(`header_secret`, `hmac_sha256`, `basic`).

## 3. Activation

```json
{
  "activation_id": "americor-intake-hourly",
  "flow_name": "partner-file-intake",
  "flow_version": 4,
  "configuration_id": "americor-prod",
  "trigger": { "type": "schedule", "cron": "0 * * * ? *", "timezone": "America/New_York" },
  "subscriber": { "url": "https://<claydol-intake-endpoint>", "signing_secret_ref": "arn:aws:secretsmanager:..." },
  "enabled": true
}
```

Trigger variants:

- `schedule`: `cron`, `timezone`, optional default `request`.
- `drop_zone`: `connection` (a `drop_zone` alias), optional `match`, `ledger`;
  one job per object, with the object in `$.trigger.file`.
- `webhook`: `webhook` name, optional `batch` (`max_events`, `max_seconds`) so
  high-volume partner events land as one file per batch instead of one job per
  event; events arrive in `$.trigger.events` or `$.trigger.file`.

Pin `flow_version`. An activation never follows a moving latest version.
Toggle `enabled` at runtime; creating or disabling an activation never needs a
deploy.

## 4. Job request

```json
{
  "transaction_id": "claydol-2026-09-24-001",
  "configuration_id": "interprose-prod",
  "request_payload": { "debt_ids": ["123", "456"] },
  "callback": { "url": "https://<caller-endpoint>" },
  "dry_run": false,
  "replay": { "items": ["TO_SOC/scrub-2026-09-20.xlsx"] }
}
```

`callback` is `{url}` (HTTPS, signed replies) or `{task_token}` (the caller's
Step Functions execution waits). `replay` re-admits named ledger items. Batch
requests add `batch_input` (array or file pointer) and `maximum_concurrency`.

## 5. Result manifest

```json
{
  "job_id": "...", "flow_name": "partner-file-intake", "flow_version": 4,
  "configuration_id": "americor-prod", "status": "SUCCEEDED",
  "started_at": "...", "finished_at": "...",
  "files": [{ "s3Uri": "s3://<connect-bucket>/jobs/americor/<job_id>/files/scrub.xlsx",
              "sha256": "...", "size": 48213, "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "source": { "connection": "inbox", "path": "americor/TO_SOC/scrub.xlsx", "etag": "0x8DC..." } }],
  "values": {},
  "items": [{ "key": "americor/TO_SOC/scrub.xlsx", "status": "SUCCEEDED" }],
  "errors": []
}
```

`status` is `SUCCEEDED`, `PARTIAL` (some items failed) or `FAILED`. Store the
manifest at `jobs/<partner>/<job_id>/result.json`, return it from
`GET /jobs/{job_id}`, and send it to the callback or subscriber. Errors carry
phase, code, retryability and item key, never payloads or credentials.

## 6. Semantic checks

1. Every alias used by a verb is declared in `connections`, and every declared
   alias is bound by the partner configuration with an accepted type.
2. Every verb is supported by every accepted connection type (driver
   capabilities), and every option is valid for its verb.
3. JSONPaths resolve against declared schemas; writes go only to `$.vars`.
4. `Map` has `Concurrency`; `ItemsFrom` points at a `FileRef`; bodies terminate.
5. `WAIT_FOR_WEBHOOK` names a declared webhook; its partner auth is configured.
6. `Ledger` keys exist on the listed item. `ModifiedSince` resolves to a
   timestamp when present; an absent optional partner parameter disables that
   filter rather than failing the job.
7. `DELETE` requires `allow_delete`; `PUT` to a partner requires an explicit
   `Overwrite` policy.
8. `limits` are present and within environment maxima.
9. Legacy types are rewritten (blocks.md §6) and the canonical form is stored.
10. No state references internal systems: no Persist, EventBridge, SNS,
    product queues or internal service URLs.
