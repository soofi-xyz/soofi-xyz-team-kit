# Connect — AWS runtime

Use the current [Connect scope](../../build-connect-service/reference/PRD.md)
and inspect the target revision. Reuse its deployment. The 2026-09-30 comparison
reports runtime compilation in the API Lambda, worker-family execution, SigV4
and imported Transfer Family connectors.

The table below preserves design targets. Static-IP egress and Fargate Runner
are not established as shipped; do not require or expose them without
implementation evidence or an explicit engine-change request. Native HTTP Tasks
with EventBridge Connections are the required target for HTTP auth (§6); Connect
main does not ship them yet (every HTTP call runs in the HTTP worker), so plan
them as an engine-change feature piece. Follow the target worker/compiler conformance tests.

## 1. Compilation targets

| Construct | Compiles to |
| --- | --- |
| `CALL`, inline response within `MaxInlineBytes` | Native Step Functions HTTP Task (`arn:aws:states:::http:invoke`) bound to the connection's EventBridge Connection |
| `CALL` with `Mode: file`, `Decode`, multipart/binary, `static_ip` egress or `client_certificate` auth | HTTP streaming worker (static-IP variant when required) writing to the Connect bucket |
| `CALL` + `Paginate` | Inline loop (`Choice` + HTTP Task) for `Collect: inline`; paging worker writing JSONL for `Collect: file` |
| `POLL` | HTTP Task (or worker) + `Wait` + `Choice` loop with attempt counter |
| `WAIT_FOR_WEBHOOK` | `dynamodb:putItem.waitForTaskToken` registration; `EarlyArrival: buffer` checks the buffered-event table first |
| File verbs on `sftp` | Transfer Family connector: `StartDirectoryListing` for `LIST`, `StartFileTransfer` for `FETCH`/`PUT`; `MOVE`/`DELETE` through the connector's remote file operations |
| File verbs on `azure_blob` | Azure driver worker using the Azure Storage SDK, streaming to or from S3 |
| File verbs on `s3` | S3 driver worker with STS `AssumeRole` (with `external_id`); server-side copy when the partner bucket policy allows it |
| File verbs on `drop_zone` | S3 driver on the Connect-owned drop-zone bucket |
| `DECRYPT`, `DECODE` | Transform worker streaming S3 → S3; OpenPGP key from the credentials table (§6) |
| `Runner: container` or `auto` over limits | ECS Fargate task (`ecs:runTask.sync`) running the same driver code |
| `Map` with `Items` under the inline limit | Inline Map |
| `Map` with `ItemsFrom` or large `MaxItems` | Distributed Map reading the landed file |
| `Ledger` | DynamoDB conditional writes keyed by `(scope, partner configuration, item key)`, with lease expiry, commit and release |
| Legacy task types | Rewritten to canonical verbs before expansion |

Inject into every compiled flow: auth resolution per connection, default and
flow-wide Retry/Catch, per-item error capture, ledger commit/release, result
manifest write, `ReplyBack` / `ReplyBackError`, supported operational metrics and dry-run
short-circuit.

## 2. Triggers

| Trigger | Mechanism |
| --- | --- |
| `api` | Existing job and lookup routes |
| `schedule` | EventBridge Scheduler schedule created by the activation API in the shared Connect schedule group, targeting the job starter with the activation ID |
| `drop_zone` | Per-partner prefix in the Connect drop-zone bucket; object-created notifications → SQS → starter, ledger dedupe on `(path, etag)` |
| `webhook` | Per-partner webhook route with partner auth; events land in SQS; a batcher writes JSONL files by `max_events` / `max_seconds` and starts one job per batch. `signed_token` auth fetches the configured `jwks_url` over HTTPS from the ingress (3 s timeout) and caches the keys in memory; give the ingress HTTPS egress to the key endpoint |

The activation API creates, updates, enables and disables these resources at
runtime. Deploy the scheduler group, drop-zone bucket, webhook ingress and
batcher once, inactive until an activation exists.

## 3. Storage layout

```text
s3://<connect-bucket>/
  jobs/<partner>/<job_id>/files/<name>          landed payloads
  jobs/<partner>/<job_id>/result.json            result manifest
  jobs/<partner>/<job_id>/pages/                 paginated responses
  webhooks/<partner>/<webhook>/<date>/<batch>.jsonl
s3://<connect-drop-zone-bucket>/<partner>/<prefix>/...
```

Apply lifecycle expiry per prefix, SSE-KMS, `BLOCK_ALL` public access and
TLS-only bucket policies. Result manifests reference files by URI and checksum;
products copy what they need to keep.

## 4. IAM and networking

- Grant each driver worker only its verbs' permissions on the Connect bucket
  prefixes and the credential stores of the connections it serves (§6).
- Grant flow roles `states:InvokeHTTPEndpoint` and
  `events:RetrieveConnectionCredentials` only on Connect-owned
  `connect-*` EventBridge Connections. Only the credentials API role may create,
  update or delete them.
- Scope STS `AssumeRole` to role ARNs registered in partner configurations.
- Treat static-IP egress as an explicit engine capability gap unless verified in the target; route SFTP through supported Transfer Family connectors.
- Never grant Connect roles access to Persist, product buckets, product queues
  or EventBridge buses other than the scheduler group it owns.

## 5. Observability

Emit per job: flow, version, partner configuration, trigger, status, duration,
items succeeded/failed/skipped, bytes landed and estimated cost. Alert on
repeated activation failures, ledger lease expiry storms, webhook
authentication failures (`webhook_unauthorized`; a `signed_token` rejection
logs only its reason, such as `issuer_mismatch`, never the token) and callback
delivery failures. Follow the shared
engineering guidelines for alarms and paging.

## 6. Credential stores

The credentials API (architecture §7) is the only write path.

**Implemented in Connect main.** Every profile is stored as one Secrets Manager
secret per credential, `connect/<stage>/credentials/<partner>/<credential>`
(`connect/credentials/` in a Marketplace install), holding
`{profile, values, version, updated_at}`. Only the API function writes that
prefix; workers and the webhook ingress read it through a resolver that caches
values for 60 s. HTTP calls, including `oauth2_refresh_token` and
`oauth2_jwt_bearer` token requests, run in the HTTP worker; Connect main has no
EventBridge Connections or native HTTP Tasks yet.

**Design target.** Store each credential once, in the store its runtime reads
natively, encrypted with the Connect KMS key. Treat moving a profile to the
target store as an engine-change feature piece:

| Profile or use | Store | Runtime read |
| --- | --- | --- |
| `basic`, `api_key`, `bearer`, `oauth2_client_credentials` | EventBridge Connection `connect-<partner>-<credential>` (`BASIC`, `API_KEY`, `API_KEY` with `Authorization: Bearer …`, `OAUTH_CLIENT_CREDENTIALS`) created with `KmsKeyIdentifier` | Native HTTP Task `Authentication.ConnectionArn`, resolved per job from the partner configuration; EventBridge fetches and refreshes OAuth tokens |
| `token_call` | EventBridge Connection as `OAUTH_CLIENT_CREDENTIALS` with `OAuthHttpParameters` when the token endpoint returns `access_token`; otherwise the credentials table | HTTP Task, or the HTTP worker performing the token call |
| HTTP worker calls (`Mode: file`, `Collect: file`, `static_ip`) on the profiles above | The same EventBridge Connection | The worker reads the connection's managed secret (`SecretArn` from `DescribeConnection`); never a second copy |
| `oauth2_refresh_token`, `oauth2_jwt_bearer` | Connect-managed Secrets Manager secret (EventBridge Connections cannot sign a per-subject JWT assertion or hold a user refresh token as a client-credentials grant) | HTTP worker: exchanges the refresh token or signs the assertion, then caches the access token per subject inside one invocation |
| `password`, `private_key` | Connect-managed Secrets Manager secret | Transfer Family connector `SftpConfig.UserSecretId` |
| `jdbc` (table-ingestion sources) | Connect-managed Secrets Manager secret | Glue JDBC connection and the extraction job only; snapshot jobs get no grant |
| `client_certificate`, `connection_string`, `sas`, PGP `keys`, secret-based webhook auth, subscriber signing (`signed_token` webhooks store nothing) | Credentials table (DynamoDB, client-side encrypted with the Connect KMS key) | Driver or transform worker, webhook ingress, reply signer |

In the target, `PUT` and `PATCH` call `CreateConnection` / `UpdateConnection`,
`PutSecretValue` or a versioned table write; status reads use
`DescribeConnection` and item metadata; a `DEAUTHORIZED` connection surfaces as
a credential failure in the job manifest. In every store, never log request
bodies, token responses or provider responses from these calls.
