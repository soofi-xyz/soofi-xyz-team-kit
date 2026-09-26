# Connect — AWS runtime

Build the block architecture on the runtime the
[Connect service PRD](../../build-connect-service/reference/PRD.md) already
defines: API Gateway job API, the flow compiler workflow, worker Lambdas,
EventBridge Connections, the webhook ingress, the Transfer Family SFTP poller
and the static-IP egress. Treat v3 as a new compiler front-end and new drivers
inside that service. Do not provision a second Connect.

Use the PRD for routes, stacks, IAM scoping, env vars, error catalogue and
operational playbook. Use this skill for the flow spec, verbs, drivers,
options, triggers and the external-only boundary. Where they conflict for v3
flows, this skill wins; keep v2 behavior for v2 flows until they are migrated.

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
| `DECRYPT`, `DECODE` | Transform worker streaming S3 → S3; OpenPGP key from Secrets Manager |
| `Runner: container` or `auto` over limits | ECS Fargate task (`ecs:runTask.sync`) running the same driver code |
| `Map` with `Items` under the inline limit | Inline Map |
| `Map` with `ItemsFrom` or large `MaxItems` | Distributed Map reading the landed file |
| `Ledger` | DynamoDB conditional writes keyed by `(scope, partner configuration, item key)`, with lease expiry, commit and release |
| Legacy task types | Rewritten to canonical verbs before expansion |

Inject into every compiled flow: auth resolution per connection, default and
flow-wide Retry/Catch, per-item error capture, ledger commit/release, result
manifest write, `ReplyBack` / `ReplyBackError`, health metric and dry-run
short-circuit.

## 2. Triggers

| Trigger | Mechanism |
| --- | --- |
| `api` | Existing job and lookup routes |
| `schedule` | EventBridge Scheduler schedule created by the activation API in the shared Connect schedule group, targeting the job starter with the activation ID |
| `drop_zone` | Per-partner prefix in the Connect drop-zone bucket; object-created notifications → SQS → starter, ledger dedupe on `(path, etag)` |
| `webhook` | Per-partner webhook route with partner auth; events land in SQS; a batcher writes JSONL files by `max_events` / `max_seconds` and starts one job per batch |

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
  prefixes and the secrets named by the connections it serves.
- Scope STS `AssumeRole` to role ARNs registered in partner configurations.
- Keep the static-IP NAT path for partners that allow-list egress IPs; route
  SFTP through Transfer Family only.
- Never grant Connect roles access to Persist, product buckets, product queues
  or EventBridge buses other than the scheduler group it owns.

## 5. Observability

Emit per job: flow, version, partner configuration, trigger, status, duration,
items succeeded/failed/skipped, bytes landed and estimated cost. Alert on
repeated activation failures, ledger lease expiry storms, webhook
authentication failures and callback delivery failures. Follow the shared
engineering guidelines for alarms and paging.
