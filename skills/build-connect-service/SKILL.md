---
name: build-connect-service
description: "Guides building the Connect service — a serverless partner-integration platform that fronts every external data partner (Plaid, Argyle, Atomic, AVMs, credit bureaus, lenders, …) behind a single REST API. Covers the declarative flow specification compiled into AWS Step Functions state machines, partner credential and token registries, on-demand static-IP fabric, AWS Transfer Family SFTP connectors, webhook callback fabric (`WAIT_FOR_TASK_TOKEN`), batch executions over Distributed Map, and the AWS CDK two-stack topology (NetworkStack + ConnectStack). Triggers on: connect service, partner integration, vendor api, plaid argyle atomic, flow specification, step functions partner workflow, partner webhook, static ip allow list, sftp partner, partner credential vault, batch executions."
---

# Building the Connect Service

Connect is the SOCAPITAL **partner-integration platform service**. It fronts every external data partner (Plaid, Argyle, Atomic, AVMs, credit bureaus, lenders, …) behind a single REST API and hides each partner's quirks behind a declarative **flow specification** that the platform compiles into an AWS Step Functions state machine.

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). This SKILL.md is the high-level map; consult the PRD for every route, env var, IAM scope, and flow-spec primitive before implementation.

## What This Product Owns

1. **The `/connector-jobs/*` REST API.** A single AWS API Gateway REST API, API-key-authorised (`x-api-key` per usage plan), with route groups for partners, credentials, flows, lookups, jobs, batch executions, webhooks, tokens, static IP, and proxy links.
2. **The flow-spec compiler.** A declarative JSON document per `(vendor, entity, name)` that compiles into a Step Functions state machine — with primitives for HTTP requests, OAuth refresh, polling, webhook callbacks, widgets, multipart payloads, JSONPath request mapping, and `WAIT_FOR_TASK_TOKEN` waits.
3. **The partner credential vault.** Static credentials, passed-through credentials, pulled credentials (from an upstream Account Manager via SigV4), and per-tenant connectivity overrides scoped by `partner_configuration_id`.
4. **The token registry.** A KMS-CMK-encrypted, reusable token store keyed by `token_name` for credentials shared across partners.
5. **The on-demand static-IP fabric.** Two Step Functions (`EnableStaticIp`, `DisableStaticIp`) that runtime-provision an EIP + NAT Gateway + public subnet + routes for partners that allow-list IPs — zero cost when idle.
6. **The webhook callback fabric.** `POST /…/webhook` releases a `WAIT_FOR_TASK_TOKEN` step; SQS + a writer Lambda persist the token reference row in `FlowsTable`.
7. **The batch execution surface.** Distributed-Map fan-out over a JSON file in S3 (`POST /…/batch-executions`) with aggregation results.
8. **The SFTP connector path.** AWS Transfer Family connectors with the listing-first poller flow — Connect never opens raw outbound SSH from Lambda.

## Primary User Surface (HTTP)

| Group | Routes | Purpose |
| --- | --- | --- |
| Partners | `POST/GET/PATCH/DELETE /vendors[/{vendor_name}]` | Register, list, get, patch, delete a partner |
| Partner credentials | `PUT/PATCH /vendors/{vendor_name}/credentials`, `…/passed-credentials` | Replace/merge static + passed-through credentials |
| Pulled credentials | `PATCH /vendors/{vendor_name}/pulled-credentials` | Sync credentials from upstream Account Manager (SigV4) |
| Partner information | `GET /vendors/{vendor_name}/information` | Presence-only credential audit (no values) |
| Connectivity config | `POST/GET /…/configurations`, `DELETE /…/configurations/{partner_configuration_id}` | Per-tenant credential overrides |
| Flow constructor (async) | `POST/GET/PUT/DELETE /vendors/{vendor_name}/{entity}/[{name}]` (`entity ∈ flows \| lookups`), `GET /flow/schema`, `GET /{entity}/creations/{creation_id}` | Author, list, replace, delete flows and lookups |
| Job execution | `POST /vendors/{vendor_name}/{entity}/{name}/jobs` | Fire one execution of a compiled flow / lookup |
| Batch execution | `POST /vendors/{vendor_name}/flows/{name}/batch-executions`, `GET /batch-executions/{batch_execution_id}/aggregation` | Distributed-Map fan-out, aggregated results |
| Job status & history | `GET /…/jobs/{job_id}`, `GET /…/executions`, `POST /…/jobs/{job_id}` (stop) | Trace per-event history; abort a running job |
| Webhooks | `POST /vendors/{vendor_name}/flows/{name}/webhook` | Inbound partner callback releasing a task token |
| Response recovery | `POST /response-url-recovery` | Re-mint presigned URLs for past `job_id` artefacts |
| Token registry | `POST/GET/PATCH/DELETE /tokens/{token_name}` | Centralised encrypted token store |
| Static IP | `GET/POST/DELETE /network/ip` | Allocate / release the NAT-gateway-fronted EIP |
| Internal — proxy links | `GET /proxy-links/{...}` | Vanity routes that 302 to S3 presigned URLs |
| Internal — service info | `GET /information` | Static service metadata (mocked) |

Each `POST` that mints work returns `202 Accepted` with a server-generated `creation_id`, `job_id`, or `batch_execution_id`. Mutating routes are API-key-gated with CORS; the only exceptions are `POST /…/webhook` (partner-authenticated via per-flow secret) and `GET /information` (mock).

## Architecture (CDK two-stack topology)

```
bin/app.ts
├── NetworkStack    # VPC + 2 private app subnets + Lambda SG +
│                    # static-IP fabric scaffolding (EIP/NAT/routes
│                    # provisioned at runtime by Step Functions)
└── ConnectStack    # Lambdas, S3, SQS, DynamoDB tables, KMS CMK,
                    # Step Functions, REST API + IAM authorisers,
                    # OpenAPI spec, /proxy-links/* fabric,
                    # AWS Transfer Family SFTP connectors + listing-first poller
```

`ConnectStack.addDependency(networkStack)` ensures the network deploys first. **TypeScript everywhere**, **AWS CDK only**, deployed to `us-east-2`.

Key data planes:

- **VPC** — `maxAzs: 2`, `natGateways: 0` (the static-IP NAT is provisioned on demand). VPC Flow Logs `ALL` to a 1-day-retention log group.
- **S3 buckets** — `VendorsResponsesBucket` with 30-day expiry on multiple prefixes (responses, batch raw items, widgets, `transfer-listings/`, `sftp-inbound/`); `LoggingBucket` for S3 access logs.
- **SQS** — `WebhooksQueue` (4 d retention, 30 s VT) + `WebhooksDlq` (14 d), backing the webhook task-token writer.
- **DynamoDB** — `FlowsTable` (single-table store: partners, flows, lookups, configurations, webhook references, dedup rows) and `TokensTable` (`token_value` encrypted via the shared CMK), both `PAY_PER_REQUEST`, KMS-CMK SSE, PITR, TTL.
- **Compute** — Node.js 24 ARM64 Lambdas (ESM) for every API handler, the OpenAPI spec, the dynamic `/proxy-links/*` fabric, and the SFTP listing-first poller.
- **Routing fabric** — REST API + `x-api-key` usage plans + Lambda authorizers; Step Functions per compiled flow; on-demand static-IP state machines; AWS Transfer Family connectors.

## Required Implementation Checklist

- [ ] `NetworkStack` provisions VPC (`natGateways: 0`), `LambdaSg`, the static-IP scaffolding (`EnableStaticIp` / `DisableStaticIp` state machines + roles), and `sc:service:name=connect` cost tags.
- [ ] `ConnectStack` provisions `VendorsResponsesBucket`, `LoggingBucket`, `WebhooksQueue` + DLQ, `FlowsTable`, `TokensTable`, the `DataKey` CMK, every Lambda, the REST API + usage plans, and the AWS Transfer Family connectors + listing-first poller.
- [ ] All Lambdas use `runtime=NODEJS_24_X`, `architecture=ARM_64`, `format: ESM`, `@aws-lambda-powertools/{logger,tracer,metrics}`.
- [ ] Flow-spec compiler emits a Step Functions state machine per `(vendor, entity, name)` with the documented primitives (HTTP, OAuth refresh, polling, webhook task-token, multipart, JSONPath, choice/pass).
- [ ] API-key authorisation is enforced on every mutating route except `POST /…/webhook` (per-flow secret) and `GET /information` (mock).
- [ ] Static-IP fabric is allocated only on demand and torn down by `DisableStaticIp` to keep idle cost at zero.
- [ ] SFTP traffic goes exclusively through AWS Transfer Family Connectors; Lambdas never open raw outbound SSH (per `skills/build-inbound-sftp-workflows/`).
- [ ] Token registry encrypts `token_value` with the shared CMK; cleartext is returned exactly once at issuance.
- [ ] Batch executions use Distributed Map over an S3 JSON file with documented aggregation contract.
- [ ] All responses follow the documented envelope; `202 Accepted` for queued work; per-route error tags from the PRD.
- [ ] All resources tagged `sc:service:name=connect` and `sc:product:name=Connect`.
- [ ] Follow `skills/apply-engineering-guidelines/` for TypeScript, CDK, observability, testing.

## Decision Triggers

Use this skill when:

- A caller needs to **integrate a new external partner** (Plaid, credit bureau, AVM, lender, …) and there is no existing Connect deployment in the target environment.
- A caller needs **declarative flow execution** with webhooks, polling, OAuth refresh, multipart uploads, or static-IP allow-listing.
- A caller needs a **centralised token / credential store** shared across partners.

Do NOT use this skill when:

- A Connect deployment already exists in the target environment — the caller authors a new flow spec and `POST`s it via the existing `/connector-jobs/` API; no new infrastructure is needed (point them at §4 of the PRD for the flow-spec schema).
- The integration is graph-data persistence — that is **`build-persist-service/`**, not Connect.
- The integration needs custom transformation code — Connect does not host arbitrary user code; transformations live in flow-spec primitives or in the caller's own service.
- The integration is purely SOAP-schema-driven — Connect supports XML transport only, not as a schema.

## Source of Truth

- **`reference/PRD.md`** — the authoritative product blueprint. Read it before deciding flow-spec primitives, route shapes, env vars, IAM scopes, error tags, or partner-specific quirks. This SKILL.md does not duplicate the PRD.
