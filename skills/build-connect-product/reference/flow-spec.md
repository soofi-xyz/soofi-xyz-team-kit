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
  `$.partner`. Undeclared fields are rejected. A partner configuration runs a
  flow only when its `parameters` fit that flow's `partner_parameters`
  (`checkBinding`, `InvalidPartnerParameters`, "Partner configuration cannot
  run this flow"). When one partner configuration serves several flows,
  declare every field it carries (for example `page_size`, `workspace`) in each
  of those flows' `partner_parameters`.
- Every `$.request.<field>` path a `CALL` reads (in `Body`, `Query`,
  `PathParameters` or any other field) must be present at run time, even when
  the schema makes it optional: a missing path fails the job with
  `Connect.ValidationFailed` ("missing path … for state …") before any request
  ([blocks.md](blocks.md) §2). Branch an optional field with a `Choice` on
  `IsPresent` into a state that uses it and one that does not (for example
  `HasParent` → `CreateSubtask` / `CreateTask`); otherwise every caller must
  send it.
- When a `CALL` takes `Subject` from `$.request`, pin the field with a
  `pattern` (for example `^[^@]+@example\.com$`). Connect has no subject
  allowlist, so the schema is the only control on which user a job caller may
  act as.
- `triggers` lists which activation kinds may run the flow (`api`,
  `schedule`, `drop_zone`, `webhook`).
- `webhooks` declares named inbound webhooks and their correlation contract;
  their auth lives on the partner configuration.
- `limits` are required. They bound runtime, item count, bytes and optional
  `max_cost_usd`; the runtime stops the job when a limit is reached.
- `kind: lookup` allows exactly one `CALL`, requires `limits.timeout_seconds`
  of at most 5 (`LookupTimeoutTooLong`; registering a longer one answers
  `400 Flow is invalid`) and compiles to EXPRESS.
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
      "auth": { "profile": "connection_string", "credential": "americor-blob" }
    }
  },
  "parameters": { "prefix": "TO_SOC/", "pattern": "*.xlsx", "archive_prefix": "TO_SOC/completed/",
                  "cutoff": "2026-06-01T00:00:00Z" },
  "keys": {},
  "allow_delete": false
}
```

Bind every alias the flow declares. Name credentials only, never values or
Secrets Manager ARNs; set their values through the credentials API
([architecture.md](architecture.md) §7). A configuration may name a credential
that is not set yet; a job that needs it fails before any partner request.
`keys` names `pgp_key` credentials (the key and its passphrase) for `DECRYPT`.
`webhooks.<name>.auth` configures inbound webhook authentication
(`header_secret` and `hmac_sha256` name a `webhook_secret` credential, `basic`
a `basic` one). `signed_token` (Connect main, PR #30) names no credential: it
checks an `Authorization: Bearer` token signed RS256 by a key published at
`jwks_url`.

```json
"webhooks": {
  "events": {
    "auth": {
      "scheme": "signed_token",
      "issuer": "https://accounts.google.com",
      "jwks_url": "https://www.googleapis.com/oauth2/v3/certs",
      "audience": "https://connect.example.com/connect/webhooks/workspace-meet-prod/events",
      "required_claims": { "email": "pubsub-push@example-project.iam.gserviceaccount.com", "email_verified": true }
    }
  }
}
```

| Field | Rule |
| --- | --- |
| `issuer` | One string compared exactly with `iss`. Google can emit `accounts.google.com` without `https://`; confirm the value in one dev run and configure that exact string |
| `jwks_url` | HTTPS only. Keys are cached for the response's `max-age`, bounded to 60 s–24 h (300 s without one); an unknown `kid` refetches at most once per 60 s |
| `audience` | Compared with `aud` |
| `required_claims` | Top-level claims compared with `===` (strings, numbers or booleans); required, use `{}` only when issuer and audience alone identify the sender |

`exp` is required (60 s clock skew). A missing, malformed, wrongly signed,
expired or mismatched token answers `401 WebhookUnauthorized`; an unreachable
or invalid key endpoint answers `503` so the sender retries. Webhook headers
are used only for auth and content-type parsing; trigger events carry the body.

`hmac_sha256_handshake` (Connect main, PR #50, opt-in) is for partners that
create webhooks through their own API and give each one its own secret in an
unsigned handshake (Asana: `X-Hook-Secret` echoed back, then every delivery
signed in `X-Hook-Signature`). `credential` names a `webhook_secret` credential
holding a **registration token** (at most 60 characters, no `--`); optional
`header` (default `X-Hook-Signature`) and `handshake_header` (default
`X-Hook-Secret`).

```json
"webhooks": {
  "events": {
    "auth": { "scheme": "hmac_sha256_handshake", "credential": "asana-registration" }
  }
}
```

- Register each partner webhook with the target
  `https://<webhook host>/connect/webhooks/<configuration_id>/<webhook>?registration=<token>&hook=<name>`.
  `<name>` is lower-case words joined by single hyphens, unique per partner
  webhook (for example one per board), and `<credential>--<name>` fits in 63
  characters. Keep the token URL-safe (letters, digits, `-`, `_`, `.`, `~`).
- **Handshake:** accepted only with the right `registration` token and a valid
  `hook`. Connect stores the presented secret as credential
  `<credential>--<hook>` (`webhook_secret`, tagged `connect:handshake=true`)
  and echoes it with `200`; it starts no job. A missing or wrong token, a
  missing or invalid `hook`, or a target credential with another profile or
  named by a configuration or activation answers `401 WebhookUnauthorized` and
  stores nothing. A new handshake for the same `hook` replaces its secret.
- **Deliveries** carry `hook=<name>`; the signature must be the hex
  HMAC-SHA256 of the raw body under **that** hook's secret, read uncached.
  Another hook's secret, an older secret or the registration token answers
  `401`.
- Asana counts only `200`/`204` as delivered: set the flow's
  `webhooks.<name>.response` to `{"accepted_status": 200, "unmatched_status": 200}`.
- Per-hook credentials are ordinary credentials (`used_by` empty):
  `DELETE .../credentials/<credential>--<hook>` revokes one webhook and is not
  done for you when a configuration is deleted. Rotating the registration
  token affects only new handshakes.

## 3. Activation

```json
{
  "activation_id": "americor-intake-hourly",
  "flow_name": "partner-file-intake",
  "flow_version": 4,
  "configuration_id": "americor-prod",
  "trigger": { "type": "schedule", "cron": "0 * * * ? *", "timezone": "America/New_York" },
  "subscriber": { "url": "https://<claydol-intake-endpoint>", "signing_credential": "claydol-subscriber-signing" },
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
   alias is bound by the partner configuration with an accepted type. The
   partner configuration's `parameters` validate against the flow's
   `partner_parameters`.
2. Every verb is supported by every accepted connection type (driver
   capabilities), and every option is valid for its verb.
3. JSONPaths resolve against declared schemas; writes go only to `$.vars`.
   A `CALL` reads an optional `$.request` field only on a branch guarded by
   `IsPresent`.
4. `Map` has `Concurrency`; `ItemsFrom` points at a `FileRef`; bodies terminate.
5. `WAIT_FOR_WEBHOOK` names a declared webhook; its partner auth is configured
   (a credential for secret schemes, or `issuer`, `jwks_url`, `audience` and
   `required_claims` for `signed_token`).
6. `Ledger` keys exist on the listed item. `ModifiedSince` resolves to a
   timestamp when present; an absent optional partner parameter disables that
   filter rather than failing the job.
7. `DELETE` requires `allow_delete`; `PUT` to a partner requires an explicit
   `Overwrite` policy.
8. `limits` are present and within environment maxima; a `lookup` sets
   `timeout_seconds` to at most 5.
9. Legacy types are rewritten (blocks.md §6) and the canonical form is stored.
10. No state references internal systems: no Persist, EventBridge, SNS,
    product queues or internal service URLs.

Run these checks locally with Connect's own code before pushing a flow or
bundle: `prepareFlow` (`src/spec/prepare.ts`: schema plus semantic checks, the
same call flow registration makes) for each flow and `checkBinding`
(`src/spec/binding.ts`) for each flow and partner configuration pair. A flow
these reject fails Marketplace review's sandbox install.
