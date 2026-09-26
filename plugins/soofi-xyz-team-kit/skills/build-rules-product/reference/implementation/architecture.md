# Current architecture and configuration

Use [the baseline](PRD.md#evidence-baseline). Keep future install requirements in
[marketplace and migration](marketplace-and-migration.md).

## Infrastructure inventory

`bin/app.ts` instantiates one `FilterStack`. The stack now contains multiple
workflows and supporting state; do not recreate the earlier seven-worker topology.

| Capability | Current infrastructure |
| --- | --- |
| Batch | STANDARD Filter state machine, input/discovery/poll/process/aggregate/metrics Lambdas, Distributed Map, Glue Python Shell preparation |
| Sync | Separate `EvaluateDebtFunction`, `live` alias and provisioned concurrency |
| Capacity | Encrypted DynamoDB lease/queue table with index, KMS key, FIFO dispatcher and DLQ, callback workers, cleanup events, one-minute dispatch backstop and five-minute reconciler, operator policies, SSM config, alarms/dashboard |
| Snapshots | Dedicated retained/versioned S3 bucket, DynamoDB manifests, generator state machine, Graph Ready rule, leases/heartbeats and failure DLQ |
| Eligibility | EventBridge-triggered STANDARD ingestion state machine, planner, Distributed Map with concurrency 2, aggregation and failure DLQ |
| Shared | Output S3 bucket, CloudWatch log group, X-Ray, SSM discovery and configured PagerDuty secret reference |

Use S3-managed encryption/block public access for outputs. Snapshot storage has
90-day current-object and 30-day noncurrent-version expiration; manifests have
TTL. Keep these separate from ordinary run outputs. Logs use three-month retention.

## Compute baseline

The batch/generator execution timeout is currently 495 minutes. ProcessAllFiles
uses a Distributed Map with concurrency 4 and tolerates up to 2 failed items;
inspect `failed_files_count` before claiming a complete successful population.

Current TypeScript Lambdas use Node 22, ARM64 and ESM bundling with `createRequire`
compatibility and parser/WASM assets where needed. Preserve asset packaging when
upgrading. The target Node 24 baseline is an open migration, not the current runtime.

`ProcessFileFunction` uses 4096 MB and 15 minutes. The sync function has its separate
[45-second/32-second limits](single-entity.md#current-limits-and-open-requirement).
Glue uses Python Shell 3.9, 1 DPU, a one-hour timeout, CSV shards up to 50,000 debt
IDs, and queued preparation runs when concurrent execution capacity is occupied.
Keep other runtime and infrastructure code in TypeScript/CDK.

## Configuration

| Value | Current source / meaning |
| --- | --- |
| `OUTPUT_BUCKET` | Stack output bucket; shared config requires it even for the read-only sync evaluator |
| `SSM_PERSIST_API_URL_PARAM` | `persist-api-url` |
| `SSM_LEXICON_RULESETS_URI_PARAM` | `/lexicon/rulesets-uri` |
| `BATCH_SIZE` | ProcessFile CDK value 50 |
| `MAX_CONCURRENCY` | ProcessFile CDK value 20; shared loader fallback differs, so inspect deployed env rather than assuming defaults |
| `MAX_RETRIES` | Shared loader default 5 |
| `RULESET_CACHE_TTL_SECONDS` | Evaluator value/default 300 |
| `SINGLE_ENTITY_PERSIST_TIMEOUT_MS` | Evaluator value/default 32000 |
| `PERSIST_API_URL`, `LEXICON_RULESETS_URI` | Evaluator values resolved from SSM at deployment |
| `DEBT_UNIVERSE_SNAPSHOT_ENABLED`, `DEBT_UNIVERSE_EAGER_MINT_ENABLED` | Current deploy-time flags mapped from CI env into CDK context/Lambda env |
| `/filter/capacity/runtime-config` | Runtime SSM configuration; use the supported capacity CLI |
| PagerDuty | Stack enablement and secret ID; reuse the selected target environment's integration |

Read effective configuration before changing concurrency. Batch capacity, Map
concurrency, worker concurrency and Persist saturation jointly determine load.
Do not multiply individual caps and treat that as a safe total budget.

## IAM and deployment ordering

Preserve capability-specific roles. Current batch/Glue S3 reads and batch
execute-api grants remain broad. The evaluator's S3 reads are scoped to the
discovered Lexicon prefix, while its execute-api grant is still wider than the
specific Persist endpoint. Do not describe all IAM as either fixed or unscoped.

Target allowed input/ruleset prefixes, the specific Persist API/method paths,
output/snapshot buckets, required DynamoDB/SQS/KMS resources and the Glue job.
Preserve callback APIs whose resource-level authorization requires `*`.
Test effective access before tightening to avoid breaking existing inputs.

The current stack resolves Persist and Lexicon SSM values at deployment and uses
the Lexicon location to build IAM. Ensure those parameters exist first. The future
marketplace package must encode this ordering or deliberately move the discovery
boundary; runtime dependency labels alone do not solve deployment ordering.

The app, graph clients and ingestion constants still assume `us-east-2`. Change
all signing/deployment paths together for tenant portability; do not merely change
the CDK stack region. Verify the target account as well as region.

## Source map

Read `lib/filter-stack.ts`, `bin/app.ts`, `src/config.ts`, `src/handler.ts`,
`src/neptune-client.ts`, `src/capacity/`, `src/debt-universe/`, `src/eligibility/`,
`glue/prepare_input.py`, and the stack/flag tests. Apply the specific operating
reference before editing workflow failure/cleanup behavior.
