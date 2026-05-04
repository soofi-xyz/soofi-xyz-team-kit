---
name: build-persist-service
description: "Guides building the Persist service — a serverless graph-persistence layer that fronts an Amazon Neptune cluster behind a SigV4-authenticated HTTPS API at /persist/*. Covers the dual ingest model (synchronous GraphSON v3 transactional ingest and asynchronous bulk ingest via SQS + Step Functions), Neptune CSV bulk-load workflow, sync and async Gremlin query channels, lexicon-driven validation with hashed deterministic IDs, and the AWS CDK two-stack topology (NeptuneStack + PersistStack). Triggers on: persist service, graph persistence, Neptune backend, GraphSON ingest, Gremlin query API, bulk-load CSV, lexicon validation, hashed graph IDs, SigV4 graph API."
---

# Building the Persist Service

Persist is the SOCAPITAL **graph-persistence platform service**. It is a single deployable product that fronts an Amazon Neptune cluster behind a SigV4-authenticated HTTPS API and exposes both write and read paths against the SOCAPITAL lexicon.

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). This SKILL.md is the high-level map; consult the PRD for every contract, env var, and IAM scope before implementation.

## What This Product Owns

1. **The `/persist/*` HTTP API.** A single AWS API Gateway HTTP API, IAM-authorised, hosting all ingest, validation, and Gremlin routes.
2. **The Neptune cluster.** A VPC-private Amazon Neptune cluster (writer + reader instances) with IAM auth, audit logs, and a custom parameter group.
3. **The lexicon enforcement boundary.** Every write path validates against the SOCAPITAL lexicon (loaded from S3, URI in SSM `/lexicon/data-uri`) and rejects non-conforming GraphSON.
4. **Hashed deterministic IDs.** All vertex and edge IDs are derived from a stable hash of the lexicon-normalised payload — the client never picks IDs.
5. **The bulk CSV workflow.** A Step Functions state machine that ingests Neptune-format CSV objects from S3 with cost gates, validation, and direct/aggregate routing.
6. **The async Gremlin executor.** Long-running queries run on ECS Fargate via SQS → EventBridge Pipes → Step Functions → Fargate (`WAIT_FOR_TASK_TOKEN`).

## Primary User Surface (HTTP)

| Verb | Path | Purpose |
| --- | --- | --- |
| `POST` | `/persist/ingest` | Synchronous, transactional GraphSON v3 ingest (lexicon-validated, returns hashed IDs) |
| `POST` | `/persist/ingest-async` | Validate + enqueue GraphSON v3 ingest; payload to S3, pointer to SQS |
| `POST` | `/persist/validate` | Validate a GraphSON v3 document against the lexicon **without persisting** |
| `POST` | `/persist/gremlin` | Read-only Gremlin against the **reader** endpoint, GraphSON v3 response |
| `POST` | `/persist/gremlin-async` | Submit a long-running Gremlin job; returns `requestId` |
| `GET`  | `/persist/gremlin-async/:requestId` | Inspect job state |
| `DELETE` | `/persist/gremlin-async/:requestId` | Idempotent cancel (intent-or-terminal) |

A separate **Step Functions state machine** (Neptune CSV workflow) handles bulk CSV ingest from S3 — it is not exposed as an HTTP route.

## Architecture (CDK two-stack topology)

```
bin/app.ts
├── NeptuneStack    # VPC + Neptune cluster + Lambda SG + bulk-load IAM role
└── PersistStack    # Lambdas, S3 buckets, SQS queues, DynamoDB,
                    # ECS Fargate, Step Functions, EventBridge Pipes,
                    # HTTP API + IAM authoriser
```

`PersistStack.addDependency(neptuneStack)` ensures the database deploys first.

Key data planes:

- **Neptune cluster** — writer `db.r8g.8xlarge`, reader `db.r8g.12xlarge`, IAM auth, isolated subnets, `neptune_query_timeout=3600000` ms.
- **S3 buckets** — `IngestAsyncPayloadBucket` (2 d), `NeptuneBulkLoadBucket` (2 d), `GremlinAsyncResultsBucket` (7 d), all `BLOCK_ALL` + SSL-only.
- **SQS** — `IngestAsyncQueue`, `FilteredBatchQueue`, `GremlinAsyncQueue`, each with a DLQ.
- **DynamoDB** — `GremlinAsyncJobsTable` (PK `requestId`, TTL 7 d).
- **Compute** — Node.js 24 ARM64 Lambdas (ESM) for the API and ingest workers; an ECS Fargate task hosts the long-running async-Gremlin executor (1 h cap).
- **Routing fabric** — HTTP API + `HttpIamAuthorizer`; EventBridge Pipe `GremlinAsyncQueue → Step Functions GremlinAsyncStateMachine` (no Lambda hop); Step Functions `PersistNeptuneCsvWorkflow` for bulk CSV.

## Required Implementation Checklist

- [ ] `NeptuneStack` provisions VPC (`maxAzs: 2`, `natGateways: 1`), Neptune cluster with IAM auth, two SGs (`LambdaSg`, `NeptuneSg`), and `NeptuneBulkLoadRole`.
- [ ] `PersistStack` provisions all S3 buckets, SQS queues + DLQs, the `GremlinAsyncJobsTable`, every Lambda (with VPC + ESM bundling), the Fargate task, and the API Gateway with IAM auth.
- [ ] All Lambdas use `runtime=NODEJS_24_X`, `architecture=ARM_64`, `format: ESM`, with the `createRequire` banner so `gremlin`/`gremlin-aws-sigv4` work.
- [ ] Lexicon loader caches in-process for 300 s with single-flight refresh and fails closed on post-expiry refresh failure.
- [ ] Every write path strips server-managed properties before hashing and returns the hashed IDs as `g:UUID` typed values.
- [ ] Async ingest is two-stage: stage-1 worker filters + writes to `FilteredBatchQueue`; stage-2 aggregator writes the bulk-load CSV and starts the loader.
- [ ] CSV workflow has a cost predictor (`WORKFLOW_COST_CEILING_USD`), `direct` vs `aggregate` routing by object size (`WORKFLOW_DIRECT_LOAD_THRESHOLD_BYTES`), and idempotent loader polling.
- [ ] Async Gremlin runs on Fargate (`WAIT_FOR_TASK_TOKEN`, 65-min heartbeat); the retained Lambda variant is fallback only.
- [ ] All HTTP responses use the `{ ok, data | error: { type, message, details } }` envelope.
- [ ] All resources tagged `sc:service:name=persist` and `sc:product:name=Persist`.
- [ ] Follow `skills/apply-engineering-guidelines/` for TypeScript, CDK, observability, testing.

## Decision Triggers

Use this skill when:

- A caller needs to **persist lexicon-conforming graph data** (GraphSON or bulk CSV) in SOCAPITAL.
- A caller needs to **query the graph** with Gremlin (sync or async).
- A new platform component needs to read or write the SOCAPITAL graph and there is no existing Persist deployment in the target environment.

Do NOT use this skill when:

- A Persist deployment already exists in the target environment — the caller integrates with the existing `/persist/*` API, no new infrastructure is needed (point them at §3 of the PRD for request/response contracts).
- The use case is non-graph storage (DynamoDB, S3, RDS) — Persist is graph-only.
- The use case is non-lexicon graph data — Persist will reject it at validation.

## Source of Truth

- **`reference/PRD.md`** — the authoritative product blueprint. Read it before deciding storage shapes, env vars, IAM scopes, error tags, or workflow steps. This SKILL.md does not duplicate the PRD.
