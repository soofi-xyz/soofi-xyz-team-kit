# Persist Service — Product Requirements Document (PRD)

Authoritative blueprint for re-creating the **Persist** graph-persistence service from scratch. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the current implementation enforces today.

---

## 1. Product Overview

### 1.1 Mission

Persist is a serverless graph-persistence layer for SOCAPITAL that fronts an Amazon Neptune cluster behind a SigV4-authenticated HTTPS API. It accepts SOCAPITAL-lexicon-compliant graph data in two shapes (GraphSON v3 documents and Neptune bulk-load CSV) and exposes both synchronous and asynchronous Gremlin query channels.

### 1.2 Primary user surface

A single AWS API Gateway HTTP API at `/persist/*`, IAM-authorised, with the following capabilities:

| Verb     | Path                                | Purpose                                                                                                |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST`   | `/persist/ingest`                   | Synchronous, transactional GraphSON v3 ingest with hashed IDs and lexicon validation                   |
| `POST`   | `/persist/ingest-async`             | Validate + enqueue GraphSON v3 ingest; payload stored in S3, pointer enqueued to SQS                   |
| `POST`   | `/persist/validate`                 | Validate a GraphSON v3 document against the lexicon **without persisting** (supports candidate lexicon)|
| `POST`   | `/persist/gremlin`                  | Run a **read-only** Gremlin query against the Neptune **reader** endpoint and return GraphSON v3       |
| `POST`   | `/persist/gremlin-async`            | Submit a long-running Gremlin query for asynchronous execution; returns `requestId`                    |
| `GET`    | `/persist/gremlin-async/:requestId` | Get terminal/in-flight job state and metadata                                                          |
| `DELETE` | `/persist/gremlin-async/:requestId` | Idempotent cancel; persists `cancelRequested` intent or terminal `CANCELLED` depending on state        |

Out-of-band, the service also exposes a **Step Functions state machine** (the **Neptune CSV workflow**) for bulk CSV ingest from S3.

### 1.3 Non-goals

- Persist does **not** expose a public read API beyond Gremlin. Lexicon-aware projection / search lives elsewhere.
- Persist does **not** synthesise its own VPC certificates or domains. Custom domains are the caller's responsibility.
- Persist does **not** own the SOCAPITAL lexicon document; it consumes a lexicon JSON from S3 referenced by an SSM parameter.

---

## 2. Architecture

### 2.1 Stacks (AWS CDK)

The CDK app is composed of two stacks deployed in order:

```
bin/app.ts
├── NeptuneStack    # VPC + Neptune cluster + Lambda SG + bulk-load IAM role
└── PersistStack    # All Lambdas, S3 buckets, SQS queues, DynamoDB, ECS Fargate,
                    # Step Functions, EventBridge Pipes, HTTP API + IAM authoriser
```

`PersistStack.addDependency(neptuneStack)` ensures the database deploys first.

### 2.2 NeptuneStack contents

- **VPC** with `maxAzs: 2`, `natGateways: 1`, three subnet tiers (`public`, `app=PRIVATE_WITH_EGRESS`, `db=PRIVATE_ISOLATED`), and an S3 gateway endpoint reachable from `app` and `db`.
- Two **Security Groups**:
  - `LambdaSg` — `allowAllOutbound: true`, attached to every Lambda/Fargate task that talks to Neptune.
  - `NeptuneSg` — egress to `0.0.0.0/0:443` (for S3 bulk loading), ingress on `8182/tcp` from `LambdaSg` and from the VPC CIDR.
- **Neptune cluster** (`CfnDBCluster`):
  - Subnet group on isolated subnets, custom cluster parameter group `neptune1.4` with `neptune_query_timeout=3600000` ms.
  - `iamAuthEnabled: true`, `storageEncrypted: true`, `enableCloudwatchLogsExports: ["audit"]`, `copyTagsToSnapshot: true`.
  - `deletionProtection` defaults true (false in non-prod via `--context stage=…`).
  - Writer instance `db.r8g.8xlarge`, reader instance `db.r8g.12xlarge`.
- **Bulk-load IAM role** (`NeptuneBulkLoadRole`, assumed by `rds.amazonaws.com`) with `s3:ListBucket`/`s3:GetObject` on `*`, exported to PersistStack and granted read on the Neptune bulk-load bucket.

Stack outputs (re-exported at the application level): `NeptuneWriterEndpoint`, `NeptuneReaderEndpoint`, `NeptunePort`, `NeptuneClusterResourceId`, `NeptuneClusterIdentifier`, `NeptuneBulkLoadRoleArn`, `NeptuneVpcId`.

### 2.3 PersistStack contents

#### 2.3.1 Storage

| Bucket                       | Retention                   | Purpose                                                                                              |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `IngestAsyncPayloadBucket`   | 2-day lifecycle             | GraphSON v3 async-ingest payloads under `ingest-async/YYYY/MM/DD/<requestId>.json`                   |
| `NeptuneBulkLoadBucket`      | 2-day lifecycle             | Generated/aggregated Neptune CSV files under `bulk-load/`, `bulk-load-aggregate/`, `workflow-rehash/`, plus `workflow-summaries/` |
| `GremlinAsyncResultsBucket`  | 7-day lifecycle             | JSON result documents from async Gremlin queries under `gremlin-async/results/YYYY/MM/DD/<requestId>.json` |

All buckets enforce `BLOCK_ALL` public access, SSL-only, S3-managed encryption, and `BUCKET_OWNER_ENFORCED` ownership.

#### 2.3.2 Queues

| Queue                                           | Retention | VT      | DLQ + maxReceiveCount |
| ----------------------------------------------- | --------- | ------- | --------------------- |
| `IngestAsyncQueue` (GraphSON async ingest)      | 2 d       | 30 min  | `IngestAsyncDlq`, 5   |
| `FilteredBatchQueue` (stage-2 aggregator input) | 2 d       | 30 min  | `FilteredBatchDlq`, 5 |
| `GremlinAsyncQueue` (async Gremlin submissions) | 4 d       | 15 min  | `GremlinAsyncDlq`, 5  |

Each DLQ has a 4–14-day retention. SQS-managed encryption, `enforceSSL: true` everywhere.

#### 2.3.3 DynamoDB

| Table                   | Key                       | Notes                                                                |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| `GremlinAsyncJobsTable` | PK `requestId` (S)        | PAY_PER_REQUEST, AWS-managed encryption, PITR enabled, TTL on `ttlEpochSeconds` (default `7d` from `queuedAt`) |

Item shape mirrors the `GremlinAsyncJobState` schema (see §6.3).

#### 2.3.4 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so `gremlin`/`gremlin-aws-sigv4` (CommonJS) can satisfy dynamic built-in `require`s like `buffer`. Logging format is JSON with three-month CloudWatch log-group retention.

| Function                            | Memory | Timeout | VPC | Trigger                                       | Purpose |
| ----------------------------------- | ------ | ------- | --- | --------------------------------------------- | ------- |
| `PersistHandler`                    | 512    | 30 s    | ✓   | API Gateway HTTP API                          | API router for all `/persist/*` routes |
| `PersistAsyncBulkWorker`            | 1024   | 15 min  | ✓   | `IngestAsyncQueue` SQS (`batchSize=400`, `maxBatchingWindow=1m` prod / `3s` test, `maxConcurrency=10`, `reportBatchItemFailures`) | Stage-1 ingest worker |
| `PersistAsyncBulkAggregateWorker`   | 1024   | 15 min  | ✓   | `FilteredBatchQueue` SQS (`batchSize=6`, similar batching window) | Stage-2 ingest aggregator |
| `GremlinAsyncValidate`              | 256    | 60 s    | ✓   | Step Functions `LambdaInvoke`                 | Validate-and-set-running for async Gremlin |
| `GremlinAsyncFailureHandler`        | 256    | 60 s    | ✓   | Step Functions catch                          | Persist failure terminal state |
| `PersistAsyncGremlinWorker`         | 1024   | 15 min  | ✓   | (retained, no SQS source — Pipes routes to Step Functions instead) | Lambda fallback path for async Gremlin worker |
| `PersistWorkflowStart`              | 512    | 30 s    | —   | Step Functions                                | Decode/normalise workflow input |
| `PersistWorkflowCostPredictor`      | 512    | 60 s    | —   | Step Functions                                | List S3 prefixes, compute cost estimate |
| `PersistWorkflowValidate`           | 1024   | 15 min  | —   | Step Functions Distributed Map item processor | Per-CSV-object lexicon validation |
| `PersistWorkflowItemRoute`          | 256    | 60 s    | —   | Step Functions                                | `headObject` to choose `direct` vs `aggregate` mode |
| `PersistWorkflowItemProcessor`      | 4096 + 10 GiB ephemeral storage | 15 min | ✓ | Step Functions (with task token in `aggregate` mode) | Dedup → upload → start load (or enqueue stage-2) |
| `PersistWorkflowItemStatus`         | 1024   | 180 s   | ✓   | Step Functions                                | Detailed bulk-load status check |
| `PersistWorkflowItemStatusSimple`   | 1024   | 180 s   | ✓   | Step Functions                                | Lightweight bulk-load status check (used inside Distributed Map polling loop) |

Plus an **ECS Fargate** task (ARM64, 1 vCPU / 2048 MB, 120 s stop timeout) packaged from `lambda/fargate/Dockerfile` that hosts the long-running async-Gremlin executor (`GREMLIN_ASYNC_EXECUTION_TIMEOUT_MS=3600000` ms = 1 h cap).

#### 2.3.5 Routing fabric

- **HTTP API** (`HttpApi` `PersistApi`) with default stage and CORS pre-flight for `*`. Routes:
  - `/persist` and `/persist/{proxy+}` for all methods → `HttpLambdaIntegration(PersistHandler)` with `HttpIamAuthorizer`.
- **EventBridge Pipe** (`GremlinAsyncPipe`) source = `GremlinAsyncQueue` (`batchSize: 1`), target = Step Functions `GremlinAsyncStateMachine` (`FIRE_AND_FORGET`). The submission flow is therefore SQS → EventBridge Pipe → Step Functions, **not** SQS → Lambda.
- **Step Functions / GremlinAsyncStateMachine**:
  ```
  UnwrapSqsRecord ($[0]) → ValidateAndSetRunning (Lambda)
                          ├── action == SKIP → Succeed
                          └── otherwise     → ExecuteQuery (Fargate, WAIT_FOR_TASK_TOKEN, heartbeat 65 min)
                                                ├── on success → Succeed (terminal write inside container)
                                                └── catch    → HandleFailure (Lambda)
  ```
  Total state machine timeout: 7200 s (2 h). Tracing enabled.
- **Step Functions / PersistNeptuneCsvWorkflow** (Neptune CSV bulk-load) – see §5.

#### 2.3.6 IAM (high-level)

- All Neptune-touching roles get `neptune-db:connect` plus the strictly-needed read/write/delete/loader actions on `arn:aws:neptune-db:<region>:<account>:<clusterResourceId>/*`.
- Workers that emit task callbacks have `states:SendTaskSuccess` / `states:SendTaskFailure` on `*` (Step Functions does not support resource-level constraints here).
- The Glue start step uses the AWS-required `glue:* on *` (Step Functions optimised integration).
- API Gateway routes use `HttpIamAuthorizer`; every caller must SigV4-sign `execute-api` requests.

### 2.4 Configuration surface (env vars)

The runtime is configured exclusively via env vars (read once on cold start; missing required values must fail closed). Notable keys:

| Key                                         | Default       | Used by                                      |
| ------------------------------------------- | ------------- | -------------------------------------------- |
| `NEPTUNE_HOST` / `NEPTUNE_WRITER_HOST` / `NEPTUNE_READER_HOST` | — | Gremlin client + Neptune Data API client |
| `NEPTUNE_PORT`                              | `8182`        | Gremlin client                               |
| `NEPTUNE_CONNECTION_MAX_AGE_MS`             | `2700000`     | Connection rotation                          |
| `NEPTUNE_RETRY_MAX_ATTEMPTS`                | `5`           | `GremlinRetry`                               |
| `NEPTUNE_RETRY_BASE_DELAY_MS`               | `1000`        | `GremlinRetry`                               |
| `LEXICON_DATA_URI`                          | from SSM `/lexicon/data-uri` at deploy time | Lexicon loader |
| `LEXICON_OBJECT_TIMEOUT_MS`                 | `10000`       | Lexicon S3 fetch                             |
| `INGEST_ASYNC_PAYLOAD_BUCKET`               | bucket arn    | API + worker                                 |
| `INGEST_ASYNC_QUEUE_URL`                    | queue url     | API submit                                   |
| `INGEST_ASYNC_MAX_RECEIVE_COUNT`            | `5`           | Stage-1 worker (matches CDK)                 |
| `INGEST_FILTERED_BATCH_QUEUE_URL`           | queue url     | Stage-1 → stage-2                             |
| `INGEST_FILTERED_BATCH_MAX_RECEIVE_COUNT`   | `5`           | Stage-2 worker                               |
| `NEPTUNE_BULK_BUCKET`                       | bucket name   | All bulk paths                               |
| `NEPTUNE_BULK_PREFIX`                       | `bulk-load`   | Sync ingest stage                            |
| `NEPTUNE_FILTERED_BULK_PREFIX`              | `bulk-load-aggregate` | Stage-2 aggregator                   |
| `WORKFLOW_BULK_PREFIX`                      | `bulk-load`   | Workflow item processor                      |
| `WORKFLOW_SUMMARY_PREFIX`                   | `workflow-summaries` | Both `direct` and `aggregate` paths   |
| `NEPTUNE_BULK_IAM_ROLE_ARN`                 | role arn      | StartLoaderJob                               |
| `NEPTUNE_BULK_REGION`                       | stack region  | StartLoaderJob                               |
| `BULK_POLL_INTERVAL_MS` / `BULK_MAX_WAIT_MS`| `5000` / `840000` | Bulk loader poller                       |
| `NEPTUNE_BULK_START_REQUEST_TIMEOUT_MS`     | `120000`      | StartLoaderJob HTTP timeout                  |
| `NEPTUNE_BULK_STATUS_REQUEST_TIMEOUT_MS`    | `30000`       | GetLoaderJobStatus HTTP timeout              |
| `NEPTUNE_BULK_REQUEST_TIMEOUT_MS`           | `30000`       | Legacy fallback for both                     |
| `NEPTUNE_BULK_STATUS_LOG_EVERY_POLLS`       | `12`          | Loader poll log cadence                      |
| `NEPTUNE_CSV_DEDUP_BATCH_SIZE`              | `1000`        | Dedup batches                                |
| `NEPTUNE_CSV_DEDUP_BATCH_CONCURRENCY`       | `100` (CDK overrides 110) | Vertex dedup concurrency           |
| `NEPTUNE_CSV_EDGE_DEDUP_BATCH_CONCURRENCY`  | `100` (CDK 8 to limit edge fan-out) | Edge dedup concurrency      |
| `WORKFLOW_MAX_OBJECT_SIZE_BYTES`            | `524288000` (500 MiB) | Per-CSV size guard                   |
| `WORKFLOW_DIRECT_LOAD_THRESHOLD_BYTES`      | `16777216` (16 MiB) | `direct` vs `aggregate` routing        |
| `WORKFLOW_COST_CEILING_USD`                 | `10`          | Cost-predictor default                       |
| `WORKFLOW_COST_PER_GB_USD`                  | `0.12`        | Cost predictor                               |
| `WORKFLOW_COST_PER_1000_OBJECTS_USD`        | `0.0004`      | Cost predictor                               |
| `WORKFLOW_VALIDATION_REQUEST_TIMEOUT_MS`    | `30000`       | Workflow validation S3 calls                 |
| `WORKFLOW_COST_PREDICTOR_REQUEST_TIMEOUT_MS`| `10000`       | Cost predictor S3 list                       |
| `GREMLIN_ASYNC_QUEUE_URL`                   | queue url     | API submit                                   |
| `GREMLIN_ASYNC_JOBS_TABLE_NAME`             | table name    | DDB-backed job store                         |
| `GREMLIN_ASYNC_RESULTS_BUCKET` / `GREMLIN_ASYNC_RESULTS_PREFIX` | bucket / `gremlin-async/results` | Result store |
| `GREMLIN_ASYNC_JOB_TTL_SECONDS`             | `604800` (7 d)| DDB TTL                                      |
| `GREMLIN_ASYNC_EXECUTION_TIMEOUT_MS`        | `840000` (Lambda) / `3600000` (Fargate) | Execute Gremlin timeout |
| `GREMLIN_ASYNC_MAX_EXECUTION_TIMEOUT_MS`    | matches above | Hard ceiling                                 |
| `GREMLIN_ASYNC_STATUS_REQUEST_TIMEOUT_MS`   | `30000`       | GetGremlinQueryStatus                        |
| `GREMLIN_ASYNC_CANCEL_REQUEST_TIMEOUT_MS`   | falls back to status timeout | CancelGremlinQuery             |
| `GREMLIN_ASYNC_MAX_RECEIVE_COUNT`           | `5`           | Worker retry decision                        |
| `GREMLIN_BATCH_EXISTS_CHUNK_SIZE`           | `1000`        | Existence checks chunk size                  |
| `GREMLIN_BATCH_EXISTS_CONCURRENCY`          | `100` (capped at 110) | Existence checks concurrency         |
| `POWERTOOLS_SERVICE_NAME` / `POWERTOOLS_LOG_LEVEL` / `POWERTOOLS_METRICS_NAMESPACE` | `persist*` / `INFO` / `persist` | Logging + metrics |

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses use a uniform JSON envelope. Success:

```json
{ "ok": true, "data": <route-specific> }
```

Error (HTTP status mapped per error tag — see §3.6):

```json
{
  "ok": false,
  "error": {
    "type": "GraphSONPayloadValidationError",
    "message": "GraphSON payload validation failed",
    "details": { "issues": [ { "code": "Type", "path": "/vertices/0/@value/id", "message": "..." } ], "issueCount": 1 }
  }
}
```

`accepted(...)` returns `202` for queued submissions; everything else is `200`/`4xx`/`5xx` per §3.6.

### 3.2 GraphSON v3 typed values

The service accepts and returns the GraphSON v3 typed-object representation:

- Primitives: `g:Int32`, `g:Int64` (number **or** bigint-as-string), `g:Float`, `g:Double`, `g:UUID`, `g:Date`, `g:Timestamp`, `g:List<T>`, `g:Set<T>`, `g:Map<K,V>` (alternating array).
- IDs (`GraphSONId`) MUST be `g:Int32`, `g:Int64`, or `g:UUID`. Plain string IDs are rejected.
- Vertices: `g:Vertex` with non-empty `properties` (validated by schema).
- Edges: `g:Edge` carrying `id`, `label`, `inV/outV` (`GraphSONId`), `inVLabel`, `outVLabel`, optional `properties` (`g:Property` map).
- Vertex properties: `g:VertexProperty[]` keyed by property name.

The full request body for ingest/validate is wrapped:

```json
{
  "@type": "tinker:graph",
  "@value": {
    "vertices": [ { "@type": "g:Vertex", "@value": { ... } } ],
    "edges":    [ { "@type": "g:Edge",   "@value": { ... } } ]
  }
}
```

### 3.3 Lexicon (single source of truth)

The lexicon JSON document lives in S3 (URI in SSM `/lexicon/data-uri`). It declares `vertices[]` and `edges[]` rules. Each rule supports:

- `type` (label),
- `properties: { [key]: { type, required?, enum?, format?, items? } }` where `type ∈ string|integer|number|boolean|array`,
- `required: string[]` (vertex; optional on edge),
- `from` / `to` (edge endpoint labels).

The loader (`LexiconSchemaService`):

- Reads the URI from `LEXICON_DATA_URI`, parses the S3 URI, fetches the object with a per-request timeout (`LEXICON_OBJECT_TIMEOUT_MS`, default 10 s), JSON-parses it, and validates against the lexicon schema (collecting **all** issues, not just the first).
- Caches the loaded lexicon in-process for **300 s** with single-flight refresh.
- Supports a request-scoped **candidate lexicon override** (`candidate_lexicon_s3_uri`) — accepted only if the URI is in the same bucket as the default lexicon and under prefix `ovid-agent-changes/` ending in `.json`.
- Fails closed: any post-expiry refresh failure surfaces a tagged error (we never serve a stale lexicon).

### 3.4 Hashed IDs (deterministic)

Server-managed meta-properties (`created_at`, the literal `id` property) are stripped before hashing. Then:

- **Vertex ID** = `sha256(stable_stringify({ label, properties: normalize(properties) }))`.
- **Edge ID** = `sha256(stable_stringify({ label, outV: normalize(outV), inV: normalize(inV), properties: normalize(properties) }))` where `outV`/`inV` already use the hashed vertex ID when the endpoint is part of the same payload.
- Normalisation sorts object keys lexicographically, treats `BigInt` as `{type:"bigint", value: stringDigits}`, recursively normalises GraphSON-typed wrappers, and sorts vertex multi-property values by their stable string. Numbers and booleans pass through; arrays preserve order **except** vertex multi-properties.
- Hashed IDs flow back as `g:UUID` typed values in the response payload — the client must use them on subsequent writes.

### 3.5 GraphSON ingest semantic + integrity rules

Three-phase validation runs **before** any side effect:

1. **Schema decode** (collecting **all** issues, not just the first). On failure returns `GraphSONPayloadValidationError` with `[{ code, path: <JSON Pointer>, message }]`. Union noise is collapsed (e.g. multiple GraphSON wrapper attempts at the same path are reported as a single user-friendly `Type` issue, and the redundant child `/@type Missing` issue under that path is suppressed).
2. **Integrity**:
   - Empty graph → `EmptyGraph` issue.
   - Edges referencing vertex IDs not present in the same payload → `MissingEdgeVertex` (with `direction: outV|inV`).
   - Vertices that no edge connects to → `IsolatedVertex`.
3. **Semantic / lexicon**:
   - Required vertex/edge properties present (server-managed keys excluded).
   - Unknown vertex/edge labels and properties.
   - Type mismatches (`TypeMismatch`), enum mismatches (`EnumMismatch`), string-format mismatches (`FormatMismatch`) — formats supported: `date`, `date-time`, `email`, `phone_number`, `time`, `uri`. Date formats also accept `g:Date`/`g:Timestamp` GraphSON wrappers and report `expected ISO date string or g:Date` etc.
   - Edge endpoint sanity: `outVLabel`/`inVLabel` must equal the lexicon `from`/`to`, and the labels of vertex IDs referenced inside the same payload must match.

### 3.6 Error catalogue → HTTP status

The HTTP layer is the authoritative tag-to-status mapper. Each error type is a structured object with a discriminator (`type` / `_tag`), a `message`, and an optional `details` object whose contents are tag-specific (e.g. `endpoint`, `query`, `requestId`, `path`, `expected`, `received`, `issues[]`, etc.). Tags map to:

| HTTP | Tag(s) |
| ---- | ----- |
| 400  | `BadRequest`, `GremlinSyntaxError`, `GremlinMutationNotAllowedError`, `GraphSONValidationError`, `GraphSONPayloadValidationError`, `GraphSONIntegrityError` |
| 404  | `VertexNotFoundError`, `GremlinAsyncRequestNotFoundError` |
| 500  | `GremlinExecutionError`, `GremlinAsyncJobSerializationError`, `GremlinAsyncResultSerializationError`, `GremlinAsyncJobConditionalConflictError`, fallback `InternalServerError` |
| 503  | `NeptuneConnectionError`, `NeptuneRetriableError`, `S3PayloadStoreError`, `SqsEnqueueError`, `GremlinAsyncJobStoreError`, `GremlinAsyncResultStoreError`, `GremlinAsyncExecutionError`, `GremlinAsyncExecutionTimeoutError`, `GremlinAsyncCancelError` |

The router additionally **sanitises** GraphSON error payloads on the `/ingest` path (e.g. `GremlinExecutionError` is converted into a generic `Internal Server Error` to avoid leaking query text to callers).

---

## 4. Synchronous APIs

### 4.1 `POST /persist/gremlin`

- Schema: `{ gremlin: string (1..50,000) }`.
- Read-only: a query policy rejects queries containing any of `addV|addE|property|drop|mergeV|mergeE|sideEffect|tx|commit|rollback` (case-insensitive, word-boundary regex). Returns `GremlinMutationNotAllowedError` (400).
- Executes via the **reader** Gremlin client using `client.submit(query)`; results are normalised through a `toJsonSafe` pass that:
  - Stringifies `bigint`,
  - Converts `Date` → epoch ms,
  - Converts `Map`/`Set` → plain object/array (Map keys flattened to string via `mapKeyToString` honoring `{ key }` / `{ name }` cases).
- Response: `{ results: unknown[], durationMs: number, requestId?: string }`. Errors map via the connection / retry / syntax classifier (see §7).

### 4.2 `POST /persist/ingest`

- Body: `GraphSONIngestRequest` (see §3.2).
- Pipeline:
  1. **Validate payload** — schema + integrity + lexicon validation (§3.5).
  2. **Normalise for persist** — strip meta props, hash IDs, build a response copy, then **stamp** `created_at` (`g:Timestamp`, ingest-time epoch ms) on every vertex (`label="created_at"`, deterministic VP id `<vertexId>#created_at`) and edge.
  3. **Upsert vertices/edges** inside a single `g.tx().begin()` transaction:
     - `upsertVertex(g, hash, label, props)` = `g.V().has(id, hash).fold().coalesce(unfold(), addV(label).property(id, hash).property(...))`.
     - `upsertEdge(g, hash, outV, label, inV, props)` = `g.E().has(id, hash).fold().coalesce(unfold(), V(out).addE(label).to(V(in)).property(id, hash)...)`.
     - Properties unwrap GraphSON typed values back to host-language primitives (with temporal canonicalisation, see §7.1).
- All-or-nothing semantics: the wrapper commits on success, rolls back on any failure or interruption (when `tx.isOpen`).
- Response: `{ vertices: { upserted: GVertex[] }, edges: { upserted: GEdge[] }, durationMs: number }`. Each upserted entity carries the hashed ID.

### 4.3 `POST /persist/validate`

- Accepts either the bare `tinker:graph` body **or** a wrapper `{ graph, candidate_lexicon_s3_uri? }`. The router's `parseValidationRequest` returns `400` (`BadRequest`) for malformed wrappers.
- Runs the **same** validation pipeline as `/ingest` minus the persistence stage.
- Response: `{ valid: true }` on success; otherwise the appropriate validation error.

### 4.4 Service composition / dependency wiring

Each router scopes its own dependency container so that a config error in an unrelated router cannot break this one. The three composition groups are:

- **GraphSON router** depends on: Gremlin client + transactions, Lexicon loader, GraphSON semantic validator, GraphSON validator, GraphSON sync ingest service, GraphSON async ingest service.
- **Gremlin router** depends on: Gremlin client + transactions, GraphSON service (for shared utilities).
- **Async Gremlin router** depends on: Submit, Status, and Cancel services (each backed by the DDB job store and, for cancel, the Neptune Data API client).

The container is constructed **once per router**, not per request, so the lexicon TTL cache survives across invocations within the same Lambda warm container.

---

## 5. Asynchronous Pipelines

### 5.1 GraphSON async ingest (`POST /persist/ingest-async`)

- Accepts the same payload shape as `/ingest`, optionally with header `x-task-token` to forward a Step Functions task token.
- Pipeline:
  1. Validate payload (full validation, including integrity + lexicon — fail fast before any side effect).
  2. Capture an ingest-time epoch ms via an injectable clock, normalise temporal properties, stamp `created_at`.
  3. Build internal payload `{ schemaVersion: "2", requestId, graph: <persist-shape> }`. `requestId` is a UUID v4.
  4. PUT to S3 at `s3://<INGEST_ASYNC_PAYLOAD_BUCKET>/ingest-async/YYYY/MM/DD/<requestId>.json` (UTC).
  5. Send `{ schemaVersion: "2", requestId, s3_uri, task_token? }` to `IngestAsyncQueue`.
- Response (`202`): `{ requestId, s3Uri, queueMessageId, queuedAt }`.

#### 5.1.1 Stage-1 — `PersistAsyncBulkWorker`

- Triggered by `IngestAsyncQueue` (batch up to 400 messages).
- For each record (concurrency 5):
  - Decode queue message → fetch payload from S3 → decode `AsyncPayloadDocument`.
  - On decode/fetch error: if `ApproximateReceiveCount < INGEST_ASYNC_MAX_RECEIVE_COUNT`, send back as `batchItemFailures`; otherwise (terminal attempt) send `sendTaskFailure("AsyncIngestPayloadFailure")` if a `task_token` was provided.
- After preprocessing the batch:
  - Compute net-new vertex/edge counts via the dedup helper (single round-trip per batch hitting the **reader** for existing IDs).
  - Build a Neptune CSV with widened scalar types (`Bool|Byte|Short|Int|Long|Float|Double|String|Date|Datetime`), header `~id,~label[,prop:Type[(single)]]…` for vertices and `~id,~from,~to,~label[,prop:Type]…` for edges. The vertex header for `created_at` is forced to `(single)` cardinality.
  - PUT vertices/edges CSV to `s3://<NEPTUNE_BULK_BUCKET>/bulk-load/YYYY/MM/DD/<batchId>/{vertices,edges}.csv` and start the Neptune bulk load (`StartLoaderJob`, see §5.5).
  - Wait for terminal status. On `LOAD_FAILED` with **only** `SINGLE_CARDINALITY_VIOLATION` for `created_at` and zero `parsingErrors`/`datatypeMismatchErrors`, treat as **effective success** (counted in `toleratedCreatedAtConflictCount`, normalised status `LOAD_COMPLETED_WITH_TOLERATED_CREATED_AT_CONFLICTS`).
  - Per-token bookkeeping: aggregate successful `requestIds` per `task_token` and call `sendTaskSuccess` once per token; on permanent load failure, call `sendTaskFailure` (one per terminal record). Retryable records re-emit as `batchItemFailures`.
  - Publish CloudWatch metrics `vertices_ingested` / `edges_ingested` with dimension `ingest_method=async_ingest`.

#### 5.1.2 Stage-2 — `PersistAsyncBulkAggregateWorker`

This worker is **only** consumed by the workflow (§5.4); it accepts both legacy `schemaVersion=1` (graphson) and `schemaVersion=2` (csv-workflow) filtered-batch messages.

- Group records by message kind. For each group:
  - **Workflow (`schemaVersion=2`)**: fetch each `source_prefix`'s phase CSV from S3 (`vertices.csv` or `edges.csv`), merge with widened scalar types, upload merged file under `bulk-load-aggregate/YYYY/MM/DD/<batchId>-<executionId>-<phase>/<phase>.csv`, then start a single bulk load (`edgeOnlyLoad: phase==='edges'`). On success, `recordIngestCounts({method:"async_csv_upload", phase, vertices/edges})` and `WorkflowSummaryService.writeSummary(...)` per request, then `sendTaskSuccess` per task token. Cardinality of created_at conflicts is preserved.
  - **GraphSON (`schemaVersion=1`)**: same pattern but loads vertices first then edges. If both merged sets are empty, send a `skipped: true` callback to all tokens.
- Failure handling: classify retryable vs terminal records by receive count; emit `batchItemFailures` for retryable, send task-failure callbacks for terminal.

### 5.2 Async Gremlin (`POST /persist/gremlin-async`, `GET …`, `DELETE …`)

#### Submit

- Body: `{ gremlin: string }` (1..50,000 trim-non-empty).
- Validate, hash query (sha256), generate `requestId` (UUID v4), `queuedAt` (ISO 8601 UTC).
- Persist DDB row `status: "QUEUED"`, `attemptCount: 0`, `cancelRequested: false`, `ttlEpochSeconds = queuedAt + 7d` (configurable). Use `attribute_not_exists(requestId)` on PutItem (idempotent).
- Send `{ schemaVersion: "1", requestId, queuedAt }` to `GremlinAsyncQueue`. On `SqsEnqueueError`: write `FAILED` terminal state (best-effort; logged on persistence failure) so the job never sticks in `QUEUED`, then surface `503` to caller.
- Response (`202`): `{ requestId, status: "QUEUED", queuedAt }`.

#### Status

- Lookup by `requestId` (consistent read). Response shape is **metadata only** — never inline the Neptune result body:
  ```
  { requestId, status, queuedAt, startedAt?, finishedAt?, durationMs?, resultS3Uri?, error?, neptuneQueryId? }
  ```
  `durationMs` is computed from started/finished if both are present and well-formed.

#### Cancel (idempotent)

- `QUEUED` → `compareAndSet(QUEUED → CANCELLED)` writing `cancelRequested=true`, `canceledAt`, `finishedAt`. Returns `{ status: "CANCELLED", canceledAt }`.
- `RUNNING` + known `neptuneQueryId` → call Neptune Data API `CancelGremlinQuery`, then write terminal `CANCELLED`.
- `RUNNING` without `neptuneQueryId` → persist `cancelRequested=true` only, return `{ status: "RUNNING" }`. The next Fargate poll/finalisation respects this intent and writes a terminal `CANCELLED`.
- Already terminal `CANCELLED` → echo back idempotently.
- Conditional conflicts (someone else moved the row) trigger a re-read and the resolved state is returned.

#### Execution path

- **EventBridge Pipe** delivers each SQS record as a single-element array to the **GremlinAsyncStateMachine**:
  1. `UnwrapSqsRecord` → take `$[0]`.
  2. `ValidateAndSetRunning` (`GremlinAsyncValidate` Lambda):
     - Parse `body` (a JSON string) and validate it against the `GremlinAsyncQueueMessage` contract.
     - Read job state. If missing or `status != QUEUED`, return `{ action: "SKIP" }`. If `cancelRequested` and currently `QUEUED`, write terminal `CANCELLED` first, then `SKIP`.
     - Otherwise `compareAndSet(QUEUED → RUNNING)` setting `startedAt`, incremented `attemptCount`, clearing `cancelRequested`. Return `{ action: "EXECUTE", requestId, gremlinQuery, queuedAt }`.
  3. `Choice`: `SKIP` → `Succeed`. `EXECUTE` → `EcsRunTask` with `WAIT_FOR_TASK_TOKEN` and a 65-min heartbeat.
- **Fargate worker** (`gremlin-async-fargate-entrypoint.ts`):
  - Reads `TASK_TOKEN` and the `QUEUE_MESSAGE` env vars, decodes the message.
  - Re-reads job state; refuses anything but `RUNNING`. If `cancelRequested`, writes terminal `CANCELLED`, sends task-failure with reason `CANCELLED`.
  - Calls Neptune Data API `ExecuteGremlinQuery({ gremlinQuery })` with a 14-min request timeout (Lambda) / 1-h timeout (Fargate). Failures map to `GremlinAsyncExecutionError` or `GremlinAsyncExecutionTimeoutError` and become DDB terminal `FAILED`/`TIMEOUT`.
  - On success: re-read job to honour late `cancelRequested`. If still running, write the result document to S3 (`gremlin-async/results/YYYY/MM/DD/<requestId>.json`) including a metadata snapshot, then `compareAndSet(RUNNING → SUCCEEDED)` with `resultS3Uri`/`resultSizeBytes`/`neptuneQueryId`. Send `SendTaskSuccess`. If a write fails after Neptune already executed, fall back to terminal `FAILED` with the original `neptuneQueryId` preserved.
  - Step Functions catch (`HandleFailure` Lambda) writes a terminal failure if any unexpected error escapes the container.
- **Lambda fallback worker** (`PersistAsyncGremlinWorker`) is retained but no longer SQS-triggered — kept for rollback / diagnostics, with the same logic as the Fargate path but constrained to a 14-min execution budget.

### 5.3 Step Functions: GremlinAsyncStateMachine

- Type: STANDARD, total timeout 7200 s, X-Ray tracing enabled.
- Wait-for-task-token heartbeat: 3900 s.

### 5.4 Step Functions: PersistNeptuneCsvWorkflow

A STANDARD state machine that ingests Neptune-shaped CSVs from S3:

```
PrepareWorkflowInput            (Lambda: workflow-start)
  → PredictWorkflowCost          (Lambda: workflow-cost-predictor)
  → IsWorkflowCostApproved (Choice)
        ├── REJECTED   → Fail "WorkflowCostCeilingExceeded"
        └── APPROVED   → ShouldRunPersistSparkRehash (Choice)
                              ├── glue.shouldRun=true
                              │     → ValidateWorkflowCsvObjects (Distributed Map over input prefix)
                              │     → RunPersistSparkRehash (Glue job, RUN_JOB)
                              │     → ProcessVertices (Distributed Map)
                              │     → ProcessEdges    (Distributed Map)
                              └── glue.shouldRun=false → ProcessVertices → ProcessEdges
```

#### 5.4.1 Inputs (accepted shapes)

```jsonc
// Preferred — single shared prefix, runs the persist-spark Glue rehash job
{ "s3_uri": "s3://bucket/prefix", "costCeilingUsd": 10, "maxConcurrency": 2,
  "candidate_lexicon_s3_uri": "s3://lexicon-bucket/ovid-agent-changes/<session>/lexicon.json" }

// Backwards-compatible alias for the same shape
{ "input_prefix_s3_uri": "s3://bucket/prefix", ... }

// Legacy — sibling /vertices/ and /edges/ prefixes; skips Glue
{ "vertices_s3_uri": "s3://bucket/root/vertices/", "edges_s3_uri": "s3://bucket/root/edges/", ... }
```

`PrepareWorkflowInput` emits a normalised `NeptuneCsvWorkflowPreparedInput`:

```jsonc
{
  "schemaVersion": "1",
  "executionId":   "<arn>",
  "candidateLexiconS3Uri": "...",  // optional
  "maxConcurrency": 60,            // default; honours integer input
  "cost": { "costCeilingUsd": 10 },
  "glue": { "shouldRun": true, "inputPrefixS3Uri", "inputBucket", "inputPrefix", "outputPrefixS3Uri" },
  // OR { "shouldRun": false }
  "phases": {
    "vertices": { "bucket", "prefix": "…/vertices/", "validationMode": "skip" | "required" },
    "edges":    { "bucket", "prefix": "…/edges/",    "validationMode": "skip" | "required" }
  }
}
```

When Glue runs, the output Spark prefix is computed from `PERSIST_SPARK_OUTPUT_BUCKET` (the workflow's bulk-load bucket) + `PERSIST_SPARK_OUTPUT_PREFIX=workflow-rehash` + a sanitised executionId (legal chars `[A-Za-z0-9._-]+`).

#### 5.4.2 Cost gate

The cost predictor calls `ListObjectsV2` (paginated, `WORKFLOW_COST_PREDICTOR_REQUEST_TIMEOUT_MS` per request) on either the Glue input prefix or both legacy phase prefixes. Estimated USD = `totalBytes/GiB * costPerGbUsd + totalObjects/1000 * costPer1000ObjectsUsd` (rounded to 4 decimals). Status is `APPROVED` if `<= costCeilingUsd`, otherwise `REJECTED` and the workflow `Fail`s with `error: "WorkflowCostCeilingExceeded"`.

#### 5.4.3 Validation (Distributed Map over Glue input prefix)

Only when `glue.shouldRun=true`. Each item:

- Skip silently for non-CSV objects (e.g. `_metadata.json` from Spark).
- Infer phase from the source key (`/vertices/` or `/edges/`).
- Stream the CSV through a streaming CSV parser; fail with `WorkflowInputValidationError` if there is no header row.
- Run lexicon validation per row. Header validates: required structural cols (`~id,~label[,~from,~to]`), unknown property columns, duplicate property columns, invalid `propertyKey:Type[(single|set)]` headers, server-managed keys are excluded. Per-row validation: missing `~label`, unknown row label, type/enum/format mismatches, required-property gaps, multi-value cells (`val1;val2` with `\;` escape) split correctly with cardinality checks.

#### 5.4.4 Rehash (Glue)

A Step Functions `GlueStartJobRun` task with `RUN_JOB` integration invokes the rehash Glue job with arguments `--input_prefix` and `--output_prefix`. The job name is sourced from SSM `/persist-spark/glue/neptune-csv-rehash/job-name`. IAM uses the Step Functions optimised wildcard policy (`glue:StartJobRun`/`GetJobRun`/`GetJobRuns`/`BatchStopJobRun` on `*` per AWS docs).

#### 5.4.5 Phase Distributed Maps (vertices first, then edges)

Each phase map iterates `s3:ListObjectsV2` over the phase prefix using a custom item reader that supports a JSON-path-resolved bucket name and a `Prefix.$` projection (so the prefix can come from the previous step's output). Item selector emits:

```jsonc
{ "schemaVersion": "1", "executionId", "phase", "sourceBucket", "sourceKey",
  "validationMode", "objectSize", "itemIndex", "candidateLexiconS3Uri" }
```

`maxConcurrency` is `$.maxConcurrency` (the prepared input value).

For each item:

1. **Route** (`PersistWorkflowItemRoute` Lambda): `headObject` → choose `processingMode = "direct"` if `contentLength > WORKFLOW_DIRECT_LOAD_THRESHOLD_BYTES` (16 MiB) else `"aggregate"`, and emit `{ ...input, contentLength, processingMode }`.
2. **Aggregate path** (`processingMode === "aggregate"`):
   - Step Functions invokes `PersistWorkflowItemProcessor` with **`WAIT_FOR_TASK_TOKEN`**. The Lambda dedups the CSV (see §5.4.6), uploads the filtered CSV under `bulk-load/...`, builds a `schemaVersion=2` filtered-batch message and sends it to `FilteredBatchQueue`. The aggregate worker picks it up, merges across messages, runs the bulk load, writes the workflow summary, and **calls `SendTaskSuccess` with the `taskToken`**. Step Functions resumes only when the load completes.
3. **Direct path** (`processingMode === "direct"`):
   - Step Functions invokes `PersistWorkflowItemProcessor` synchronously (no task token). The Lambda dedups, uploads, and **starts** the bulk load for that single object (`startLoad(sourcePrefix, { edgeOnlyLoad: phase==='edges' })`).
   - If the dedup result is `skipped`, the response carries `skipped=true`; the Choice routes to `Skip*DirectItem` Succeed.
   - Otherwise the `startResult` enters a polling loop: `Wait(60s) → Check*LoadStatus (PersistWorkflowItemStatusSimple) → Choice(done==true ? Complete : Wait)` until terminal.
   - On terminal success: metrics (`async_csv_upload`) and workflow summary are recorded inside `PersistWorkflowItemStatusSimple` once the loader reaches `LOAD_COMPLETED` (or the tolerated `created_at` conflict status).

Lambda invokes have explicit retry (`Lambda.ServiceException`, `Lambda.AWSLambdaException`, `Lambda.SdkClientException`, `Lambda.ClientExecutionTimeoutException`, `Lambda.TooManyRequestsException`, `Lambda.Unknown`, `Sandbox.Timedout`, `Runtime.ExitError`) with 2 s base, x2 backoff, 6 attempts (or 1-min steady polls × 4 for status checks).

#### 5.4.6 Dedup

Per CSV object:

- Reject if `objectSize > WORKFLOW_MAX_OBJECT_SIZE_BYTES`. Skip when size is 0 or the key is not `*.csv`.
- Stream rows via a streaming CSV parser.
- Header sanity: `~id` (and `~from`,`~to`,`~label` for edges). Strip any inbound `created_at` columns; append a single `created_at:Datetime` column (with `(single)` cardinality on vertices) to the output header.
- Buffer rows into batches of `NEPTUNE_CSV_DEDUP_BATCH_SIZE`. For each batch (with phase-specific concurrency capped at 110 for vertices / 8 for edges, the lower edge cap protects edge fan-out from Neptune throttling):
  - Optionally validate rows against the lexicon when `validationMode === "required"`.
  - Hit the **reader** Gremlin connection with `g.V|E().has(id, P.within(...idsChunk)).id().toList()` to find existing IDs.
  - Drop rows already present; serialise the survivors with the deterministic `created_at` column appended.
- Output is written to a temp file under `os.tmpdir()/persist-workflow-*/{vertices|edges}.csv`. Cleanup runs on success and failure.
- Returns counters `{ rowsRead, rowsExisting, rowsNew, skipped, skipReason?, tempFilePath?, tempDirPath? }`. `skipReason="NO_NEW_ROWS"` when the filtered set is empty.

A separate batch-mode helper, used by stage-1 ingest, computes aggregate net-new vertex/edge counts in a single round-trip per SQS batch.

### 5.5 Neptune bulk loader (`NeptuneBulkLoaderService`)

A custom HTTPS client signed with SigV4 for the `/loader` endpoint:

- **Start**: `POST https://<host>:<port>/loader` with body `{ source, format:"csv", iamRoleArn, region, mode:"NEW", updateSingleCardinalityProperties:false, queueRequest:true, failOnError:false, parallelism:"OVERSUBSCRIBE", edgeOnlyLoad }`. Per-attempt timeouts and SigV4 are enforced; transient send errors get up to 4 retries with exponential backoff (200 ms base × 2ⁿ); **Max load task queue size limit breached** errors are additionally auto-retried 40 times at 15-s spacing.
- **Status**: AWS SDK `GetLoaderJobStatusCommand` with `details: true` and (for terminal failures) `errors: true`, paginated through up to 400 pages of 25 errors each. Transient status errors (`getaddrinfo EBUSY`, `EAI_AGAIN`, `ECONNRESET`, `ETIMEDOUT`, `GetLoaderJobStatus request timed out`) are retried by both the loader and the workflow status checker.
- **Polling**: `BULK_POLL_INTERVAL_MS=5000` ms (loader) or `Wait 1 min` (workflow Map). `BULK_MAX_WAIT_MS=840000` ms (≈14 min).
- **Tolerated created_at conflicts**: when terminal status is `LOAD_FAILED` and the **only** error code present is `SINGLE_CARDINALITY_VIOLATION` for the `created_at` property and `parsingErrors=0` and `datatypeMismatchErrors=0`, the result is normalised to `LOAD_COMPLETED_WITH_TOLERATED_CREATED_AT_CONFLICTS` and `effectiveSuccess=true`. The conflict count flows into `toleratedCreatedAtConflictCount` for observability.
- **Logging**: progress logs are emitted on status change or every `NEPTUNE_BULK_STATUS_LOG_EVERY_POLLS=12` polls. Failures sample up to 5 error-log entries plus the full `overallStatus` payload.

---

## 6. Internal Data Schemas

### 6.1 Async-bulk queue messages

```ts
// Stage-1 inbound (GraphSON async ingest)
{ schemaVersion: "2", requestId: string, s3_uri: string, task_token?: string }

// Stage-1 → Stage-2 (GraphSON path)
{ schemaVersion: "1", batchId: string, source_prefix: "s3://…/<batchId>/",
  requests: [ { requestId, task_token? } ] }

// Stage-1 → Stage-2 (CSV-workflow path)
{ schemaVersion: "2", batchId, executionId, phase: "vertices"|"edges",
  source_prefix: "s3://…/<batchId>-<phase>-<itemIndex>/",
  requests: [ { requestId, itemIndex, sourceS3Uri, rowsRead, rowsExisting, rowsNew, task_token? } ] }
```

Stage-1 GraphSON payload document (S3):

```ts
{ schemaVersion: "2", requestId: string, graph: GraphSONIngestBody }
```

### 6.2 Workflow item records

`schemaVersion="1"`:

- Routing input: `{ executionId, phase, sourceBucket, sourceKey, validationMode, objectSize, itemIndex, candidateLexiconS3Uri? }`.
- Routing output adds `processingMode: "aggregate"|"direct"` and `contentLength`.
- Started result (direct path): adds `stagedPrefix, loadId, startedAtEpochMs`.
- Skipped result: adds `skipped: true, skipReason?`.
- Completed result: adds `stagedPrefix, loadId, loaderStatus`.
- Status pending result: `{ done: false, loadId, loaderStatus }`. Status completed result: `{ done: true, item }`.

Workflow summaries are written by `WorkflowSummaryService` to `s3://<NEPTUNE_BULK_BUCKET>/workflow-summaries/<executionId>/<phase>/item-<itemIndex>.json`.

### 6.3 Async Gremlin job state (DynamoDB)

```ts
{
  requestId: string,                    // PK
  status: "QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"TIMEOUT"|"CANCELLED",
  gremlinQuery: string,                 // 1..50,000
  queryHash: string,                    // sha256 hex
  queuedAt:   ISO8601 UTC,
  startedAt?: ISO8601 UTC,
  finishedAt? ISO8601 UTC,
  updatedAt:  ISO8601 UTC,
  attemptCount: int >= 0,
  cancelRequested: boolean,
  canceledAt?: ISO8601 UTC,
  neptuneQueryId?: string,
  resultS3Uri?: "s3://...",
  resultSizeBytes?: int,
  errorType?, errorMessage?, errorDetails?: { ... },
  sfnExecutionArn?: string,
  ttlEpochSeconds: int (default queuedAt + 7d)
}
```

`compareAndSetStatus` uses `ConditionExpression: attribute_exists(requestId) AND status IN (:expected0, …)` and `UpdateExpression` builds typed expression names/values to avoid reserved keywords. `writeTerminalState` SETs the new status fields and REMOVEs no-longer-relevant attributes (e.g. `errorType`/`errorMessage`/`errorDetails` when no error). Conditional failures map to `GremlinAsyncJobConditionalConflictError`, which the calling services use to re-read state and respond idempotently.

### 6.4 Async Gremlin result document (S3)

```jsonc
{
  "schemaVersion": "1",
  "requestId": "...",
  "storedAt":  "ISO8601 UTC",
  "metadata": { "status": "SUCCEEDED", "queuedAt", "attemptCount", "cancelRequested",
                "startedAt?", "finishedAt?", "durationMs?", "neptuneQueryId?" },
  "payload":  <ExecuteGremlinQueryCommandOutput>
}
```

---

## 7. Cross-cutting Concerns

### 7.1 Temporal handling

- Lexicon string formats `date` and `date-time` are also satisfied by GraphSON `g:Date`/`g:Timestamp` typed wrappers. The validator reports `expected: "ISO date string or g:Date"` (or `... or g:Timestamp`) when the wrapper is mismatched.
- For persistence, the GraphSON normaliser canonicalises temporal wrappers into the host-language temporal value Gremlin expects (e.g. `Date`/`Number` epoch ms in TypeScript) before submitting traversals.
- For Neptune CSV, scalar widening honours `Bool < Byte < Short < Int < Long`, falls through to `Double` when mixing integral + floating, and tags `g:Date`/`g:Timestamp` as `Date`/`Datetime` strings in the canonical CSV format (`YYYY-MM-DDTHH:MM:SSZ` for Datetime).

### 7.2 Gremlin connection management

- Live connection: SigV4-signed WebSocket (`wss://<host>:8182/gremlin`) using a SigV4 helper to compute the signed URL and headers. The driver wrapper extends the standard gremlin driver `RemoteConnection` so bytecode is submitted through `client.submit(bytecode, null, requestOptions)` and the underlying client closes cleanly on shutdown.
- Two **state managers** (writer / reader) with single-flight create, max-age refresh (`NEPTUNE_CONNECTION_MAX_AGE_MS=2,700,000` ms = 45 min), `close` listeners, log-once reuse, and `reset` on retriable errors.
- Test connection: plain WebSocket to `localhost:8182` (overridable via `GREMLIN_TEST_HOST`/`GREMLIN_TEST_PORT`).

### 7.3 Retry classification

A message classifier inspects the lower-cased error text and returns `{ retriable, shouldReconnect, retryClass }`:

- `iam_signature_freshness` — `signature expired`, `signature not yet current`, `old date`, `future date`. Always reconnect.
- `neptune_throttling` — `ThrottlingException`, `too many concurrent requests`. Backoff capped at 10 s.
- `transient_connection` — websocket/connection drops, `timed out`, `econnreset`, `readonlyviolationexception`, `concurrentmodificationexception`. Backoff capped at 30 s. Reconnect for connection drops + signature freshness.

Retries: `maxAttempts = NEPTUNE_RETRY_MAX_ATTEMPTS + 1` (default 6), exponential `baseDelay * 2^(attempt-1)` (or linear `baseDelay * attempt` for throttling). The retry helper logs the classification, attempt number, planned delay, and whether the connection will be reset before the next try.

### 7.4 Transactions

`withTransaction(fn)` opens a session-bound `g.tx().begin()`, commits on success, rolls back on failure or interruption (only if `tx.isOpen`). Errors map to `NeptuneRetriableError | GremlinExecutionError` so the same retry helper governs them. The test runtime bypasses transactions and runs effects directly on `g` (a session-capable Gremlin server is not required for tests).

### 7.5 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=persist*`, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once, appends a request-scoped key (`workflowItemRequestId`, `batchRequestId`, `workflowValidationRequestId`, …), and resets the keys in `finally`.
- **Structured logging across services**: every service emits start/progress/end logs with the same shape — a span name (`ServiceName.method`), structured annotations (`requestId`, `executionId`, `loadId`, `taskToken`, `phase`, `bucket`, `key`, …), and a level (`info`/`warn`/`error`). Polling loops emit progress every N polls or on status change.
- **Metrics**: AWS Lambda Powertools metrics, namespace `persist`. Buffered counters `vertices_ingested` / `edges_ingested` with dimension `ingest_method` ∈ `sync_ingest|async_ingest|async_csv_upload` (and optional `phase=vertices|edges`). The buffer is flushed in the API handler's `finally` block and in the async-bulk-worker's `finally` block.
- **Tracing**: Step Functions state machines have `tracingEnabled: true` (X-Ray).

### 7.6 Long-running command discipline

Every external call (Neptune Data API, S3, Step Functions, SQS, DynamoDB) is wrapped in a promise-with-timeout helper that maps timeouts and SDK errors to the appropriate tagged error. Polling loops emit progress logs before/after each poll with elapsed counters and structured annotations so a stalled run is observable from CloudWatch alone.

### 7.7 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double. The shape is intentionally framework-light so it can be reproduced in any DI style (constructor injection, factory functions, or a runtime container):

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Complex services (`GremlinAsyncJobStore`, `NeptuneDataApiGremlin`, `GremlinAsyncSubmit`, `GraphSONAsyncIngest`, etc.) expose pure-function factories (`makeXxxService(runtime)`) so tests can pass mocks (in-memory clients, fixed clocks, deterministic UUIDs).
- Errors are **structured tagged classes** with a discriminator (`type` / `_tag`) so the HTTP layer can `switch` on them when mapping to status codes.
- Composition is split per route (§4.4) to keep config requirements minimal — a missing env var for an unrelated route must never fail this route.

### 7.8 Testing strategy

- Unit tests live in `test/services/**/*.ts`, `test/schemas/**/*.ts`, `test/handlers/**/*.ts`, `test/routes/**/*.ts`, `test/http/responses.test.ts`, and `test/cdk/persist-stack.test.ts`.
- Vitest is the test runner. `setupTests.ts` wires the ingest-metrics reset/flush before/after each test.
- A real Gremlin Server (TinkerGraph) is required for traversal tests. `just test` (the canonical CI command) starts/stops the docker container automatically using `scripts/start-gremlin-test.sh` and `gremlin/tinkergraph-empty.properties` (string IDs enabled to mirror Neptune `T.id`).
- Integration tests live in `test/integration/persist-api.test.ts` and hit a deployed API via SigV4 (`PERSIST_API_URL`, `AWS_PROFILE`).
- The OpenAPI spec at `docs/openapi.json` is regenerated by `scripts/generate-openapi.ts` (driven from the route definitions module).

### 7.9 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the SOCAPITAL shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI/CDK with permissions for VPC, Neptune, S3, SQS, DynamoDB, ECS, Step Functions, EventBridge Pipes, IAM, API Gateway, Lambda, CloudWatch Logs, SSM.
- A pre-populated SSM parameter `/lexicon/data-uri` pointing to the lexicon JSON in S3.
- A pre-populated SSM parameter `/persist-spark/glue/neptune-csv-rehash/job-name` pointing at the persist-spark Glue rehash job.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # NeptuneStack first (CDK auto-orders), then PersistStack
pnpm cdk:destroy          # only when deletionProtection=false (non-prod)
```

Stack outputs: `ApiUrl`, `NeptuneCsvWorkflowArn`, `NeptuneWriterEndpoint`, `NeptuneReaderEndpoint`, `NeptunePort`, `NeptuneClusterResourceId`, `NeptuneVpcId`. Two SSM parameters are created: `persist-api-url` and `persist-neptune-csv-workflow-arn`.

### 8.3 Smoke tests

After every deploy run the four release-validation calls listed in `README.md` §"Async Gremlin release validation":

1. Quick `g.V().limit(1).count()` async submit + poll until `SUCCEEDED`.
2. Cancel a queued request before it runs.
3. Submit a known-long-running query and confirm `TIMEOUT` after the configured budget.
4. Confirm the status response keeps result bodies out of the metadata and that `resultS3Uri` is reachable.

For `/persist/ingest` and `/persist/gremlin`, use the bash/zsh `awscurl` helper documented in the README.

### 8.4 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps infrastructure (DynamoDB, SQS, S3) in place.
2. Re-run the smoke checks.
3. Confirm no jobs are stuck in `QUEUED` / `RUNNING` without terminal updates (audit DynamoDB scan filtered by `status` and `updatedAt < now - 1h`).

### 8.5 Common runbook items

- **Loader queue full**: `Max load task queue size limit breached` is auto-retried 40× at 15 s. If still failing, throttle producer concurrency (`maxConcurrency` workflow input).
- **Created_at single cardinality** noise: tolerated automatically on otherwise-clean loads. Anything else (parsing/datatype errors, mixed error codes) hard-fails.
- **Stuck async-Gremlin job**: `GET` the request to inspect status. If `RUNNING` past max budget, `DELETE` to register cancel intent — the next Fargate poll (or successive worker restart) will clean up.
- **Connection storms**: bumping `NEPTUNE_RETRY_MAX_ATTEMPTS` and lowering `GREMLIN_BATCH_EXISTS_CONCURRENCY` is the standard mitigation; the default `100..110` was tuned for `db.r8g.12xlarge` reader.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript 5.6+, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,event-handler}`, `@aws-sdk/{client-neptunedata,client-s3,client-sfn,client-sqs,credential-providers}`, `@smithy/{config-resolver,node-config-provider,hash-node,protocol-http,signature-v4}`, `gremlin@^3.8`, `gremlin-aws-sigv4`, `csv-parse`. CDK: `aws-cdk-lib@^2.170`, `constructs`, `aws-cdk@^2.170`. Choose any preferred validation library and structured-error / DI conventions — the contracts in §3 and §6 must be honoured but the implementation style is unconstrained.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `graphson/{types,vertex,edge,ingest,validate}`, `gremlin`, `gremlin-async`, `async-bulk`, `workflow`, `lexicon`, `http`, `errors`. Errors are tagged classes; everything else is type+validator pairs.
4. **Utils**: `lambda/utils/{csv,errors,graphsonTemporalTransform,lexiconStringFormat,neptuneTemporal,s3}.ts`.
5. **Configuration**: `lambda/config/neptune.ts` (Neptune host/port/region, retry, connection age) plus per-service config readers tied to the env vars listed in §2.4. Required vars must throw at startup; optional vars must default per §2.4.
6. **Services** (one file each in `lambda/services/`): GraphSON (`Hash`, `Decode`, `PersistTransform`, `PersistTransformService`, `SemanticValidationService`, `ValidationService`, `Service`, `AsyncIngestService`); Gremlin (`Client`, `Tx`, `Retry`, `QueryPolicy`, `Service`); Lexicon (`Schema`); Async Gremlin (`JobStore`, `ResultStore`, `Submit`, `Status`, `Cancel`, `Worker`, `NeptuneDataApi`); Async Bulk (`IngestPayload`, `BulkWorker`, `BulkAggregateWorker`, `FilteredBatchEnqueue`, `BulkLoader`, `BulkStage`, `CsvService`, `CsvDedup`, `CsvLexiconValidation`, `CsvWorkflowValidation`); Workflow (`Input`, `CostPredictor`, `ItemRouting`, `ItemStart`, `ItemStatus`, `Summary`, `StepFunctionsCallback`); Metrics (`IngestMetrics`); plus a composition module `services/index.ts` that exports per-router and per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts, responses.ts}`, `lambda/logging/{powertools.ts, runtime.ts}`, the three routers (`graphson`, `gremlin`, `gremlin-async`) and `router.ts` mounting them with `prefix="/persist"`, then `handler.ts`.
8. **Worker handlers** + **Workflow handlers** + **Fargate entrypoint** in `lambda/{async-bulk-worker, async-bulk-aggregate-worker, gremlin-async-validate, gremlin-async-worker, workflow-start, workflow-cost-predictor, workflow-validate, workflow-item-route, workflow-item-processor, workflow-item-status, workflow-item-status-simple, fargate}/`.
9. **OpenAPI generator**: `lambda/api/definitions.ts` and `scripts/generate-openapi.ts`. `pnpm api:spec` writes `docs/openapi.json` (the generated spec is checked in).
10. **CDK stacks**: `lib/neptune-stack.ts` and `lib/persist-stack.ts` per §2.2 and §2.3, then `bin/app.ts`.
11. **Local Gremlin**: `scripts/start-gremlin-test.sh`, `gremlin/tinkergraph-empty.properties`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared SOCAPITAL workflows.
12. **Smoke tests**: replicate the four release-validation steps from §8.3 in the integration suite under `test/integration`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- `POST /persist/ingest` is transactional: a failure on any vertex/edge inside one request leaves zero new records in Neptune.
- Hashing rules in §3.4 produce identical IDs across two independent runs of the same payload (fuzz-tested by `test/services/GraphSONHash.test.ts`).
- `POST /persist/validate` accepts both the bare `tinker:graph` payload and the `{ graph, candidate_lexicon_s3_uri }` wrapper, and surfaces issues with `code` + JSON-pointer `path`.
- Async Gremlin survives the four release-validation steps in §8.3 inside a single deployed environment.
- The Neptune CSV workflow accepts all three input shapes in §5.4.1 and produces a `workflow-summaries/<executionId>/<phase>/item-<itemIndex>.json` for every successful item.
- Loaders treat `created_at` `SINGLE_CARDINALITY_VIOLATION` as effective success only when no other error mix is present.
- Async ingest never leaves a job stuck in `QUEUED`: failure to enqueue is followed by a best-effort `FAILED` terminal write; failure to validate happens **before** any S3 PUT or SQS send.
- Lexicon TTL cache (300 s) is reused across requests on the same router and refreshed on expiry; refresh failures fail closed.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so `gremlin`/`gremlin-aws-sigv4` work at runtime.
- IAM permissions follow least-privilege per §2.3.6.
- All structured logs include the relevant `requestId` / `executionId` / `loadId` / `taskToken` so an operator can trace a single ingestion end-to-end via CloudWatch Logs Insights.

