# Rules Product - Product Requirements Document (PRD)

Authoritative blueprint for building the **Rules** marketplace product. It captures the batch workflow, synchronous single-entity execution path, rule contracts, graph-read behaviour, output artifacts, metrics, and infrastructure topology enforced by the current implementation in `../implementation/filter`, with the public product name normalised to **Rules**. The implementation language is **TypeScript everywhere** except Glue Python Shell preparation jobs; infrastructure is **AWS CDK only**, deployed to the installer-supplied tenant AWS region, per the Golden Path engineering standards.

---

## 1. Product Overview

### 1.1 Mission

Rules is a tenant-local decisioning product. It can run batch evaluations over a population of debt identifiers, and it can run synchronous ruleset evaluation for one debt identifier when a downstream product needs a point-in-time decision inside an interactive request path. In both modes, Rules retrieves current graph facts through Persist and evaluates lexicon-backed contactability and eligibility rules.

Rules exists to make "who can we contact right now?" a repeatable, auditable batch workflow rather than a hardcoded report. The product compiles rule definitions published by the Lexicon product into Gremlin projections, runs those projections through Persist's SigV4-authenticated Gremlin API, classifies debts and phone numbers from the returned rule reports, and emits:

1. a results dataset containing only debts that passed all debt rules and at least one phone number that passed all phone rules;
2. per-file statistics and one aggregated statistics document explaining how many debts and phones were accepted or filtered out;
3. optional per-debt/per-phone rule reports for audit and debugging;
4. CloudWatch metrics for suggested call counts, phone counts, rule-failure counts, and estimated/actual run cost.

The synchronous path reuses the same ruleset loader, compiler, query builder, Persist client, and classifier, but it does not create Step Functions executions or S3 run artifacts. It accepts a single `debt_identifier`, returns the decision payload directly, and targets sub-300ms warm-path service latency.

Rules is a **SERVICE** marketplace component because it deploys runtime infrastructure: Step Functions, Lambda, Glue, S3, CloudWatch Logs, and SSM outputs. It is not a DATA component and it is not a rule-authoring repository.

### 1.2 Primary user surface

Rules does **not** expose a public REST API. Its primary surfaces are a tenant-local **AWS Step Functions STANDARD state machine** for batch runs and an IAM-protected Lambda function for synchronous single-entity evaluation. Both discovery pointers are published to SSM and CloudFormation outputs at deploy time.

| Surface | Identifier | Auth | Purpose |
| ------- | ---------- | ---- | ------- |
| **Batch workflow** | SSM `/rules/workflow/state-machine-arn` and stack output `StateMachineArn` | AWS IAM `states:StartExecution` | Run a rules evaluation batch over either a caller-supplied S3 population or the full Persist debt population. |
| **Single-entity evaluator** | SSM `/rules/sync/evaluator-function-arn` and stack output `EvaluatorFunctionArn` | AWS IAM `lambda:InvokeFunction` | Evaluate one `debt_identifier` synchronously and return the same pass/fail classification used by the batch workflow. |
| **Output bucket** | stack output `OutputBucketName` | AWS IAM/S3 | Read workflow outputs under `rules/<execution-start>/<execution-name>/...`. |
| **Operational metrics** | CloudWatch namespace `CDM` | CloudWatch IAM | Observe accepted populations, rule failures, and cost signals. |

The current implementation publishes the workflow under `filter-workflow-state-machine-arn`; the canonical Rules product MUST publish `/rules/workflow/state-machine-arn`. A temporary compatibility alias may be emitted during migration, but new marketplace bundles, docs, tags, metrics dimensions, and stack names use `rules`, not `filter`.

The workflow input is:

```jsonc
{
  "input_s3_uri": "s3://tenant-bucket/path/to/file-or-prefix/", // optional
  "rule_s3_uris": [
    "s3://lexicon-bucket/rulesets/phone-interactions/rules/not_do_not_call/"
  ], // optional explicit rule subset
  "skip_report_metrics": false, // optional; default false
  "save_rules_reports": false // optional; default false
}
```

Successful executions return one of these shapes:

```jsonc
{
  "resultsS3Uri": "s3://<output-bucket>/<prefix>/parts/results/",
  "aggregatedStatisticsS3Uri": "s3://<output-bucket>/<prefix>/aggregated-statistics.json"
}
```

or, when `save_rules_reports=true`:

```jsonc
{
  "resultsS3Uri": "s3://<output-bucket>/<prefix>/parts/results/",
  "aggregatedStatisticsS3Uri": "s3://<output-bucket>/<prefix>/aggregated-statistics.json",
  "rulesReportsS3Uri": "s3://<output-bucket>/<prefix>/parts/rules-reports/"
}
```

The synchronous evaluator input is:

```jsonc
{
  "debt_identifier": "D001",
  "ruleset_id": "phone", // optional; default phone
  "rule_s3_uris": [
    "s3://lexicon-bucket/rulesets/phone-interactions/rules/not_do_not_call/"
  ], // optional explicit rule subset
  "include_rules_report": false // optional; default false
}
```

Successful synchronous evaluations return a direct decision payload:

```jsonc
{
  "debt_identifier": "D001",
  "accepted": true,
  "ruleset_id": "phone",
  "ruleset_version": "1.0.0",
  "evaluated_at": "2026-05-19T12:34:56.000Z",
  "latency_ms": 143,
  "result": {
    "debt_identifier": "D001",
    "balance": 100.25,
    "first_name": "Jane",
    "last_name": "Doe",
    "postal_code": "12345",
    "tu_score": 650,
    "preferred_language": "en",
    "phone_numbers": []
  }
}
```

When `include_rules_report=true`, the response includes `rules_report` and each returned phone may include `phone_rules_report`. The main `result.phone_numbers` list still contains only phones that passed all phone-scoped rules.

### 1.3 Non-goals

- Rules does **not** expose a public HTTP API or create an API Gateway base-path mapping. Batch callers start the workflow through AWS Step Functions/IAM. Synchronous single-entity callers invoke the IAM-protected evaluator Lambda directly unless a future product explicitly adds a private HTTP adapter.
- Rules does **not** write to Persist, Neptune, or any graph store. Persist remains the only graph-persistence product; Rules is a read-only graph consumer.
- Rules does **not** run Gremlin directly against Neptune. It calls Persist's `/persist/gremlin` and `/persist/gremlin-async` APIs with SigV4.
- Rules does **not** own the lexicon or the rule repository. It consumes Lexicon product rulesets from S3 via the `/lexicon/rulesets-uri` SSM parameter or explicit `rule_s3_uris`.
- Rules does **not** provide CRUD for rule definitions, rule approval, legal review, or rule publishing. Those belong to Lexicon product governance.
- Rules does **not** guarantee that a passed debt is legally contactable in every downstream channel forever. It produces a point-in-time result based on graph data and rules available at execution time.
- Rules does **not** orchestrate outbound communications. Downstream communication products consume its output; Rules never sends SMS, email, calls, or letters.
- Rules does **not** synthesise its own subdomain, ACM certificate, Usage Plan, or tenant identity. It has no public API surface.
- Rules does **not** preserve `Filter` as a public marketplace product name. Internal code may be migrated from `filter`, but product metadata, cost tags, stack outputs, SSM names, and CloudWatch dimensions must use `Rules`.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the batch workflow implementation layer.** Every batch run is expressed as a STANDARD Step Functions state machine with native `Choice`, `Wait`, `Map`, `Retry`, `Catch`, and service integrations. There is no Lambda-only orchestrator, chained-SQS batch driver, or in-process workflow runtime.
2. **Persist is the graph boundary.** Rules reads graph data only through Persist's SigV4-authenticated APIs. It never connects to Neptune directly, never embeds Neptune endpoints, and never bypasses Persist's read policies.
3. **Rulesets are lexicon-backed data inputs.** Rule definitions are JSON + Gremlin objects in S3. The runtime compiles supported rules at execution time; rule changes ship as ruleset data revisions, not Lambda code changes, as long as they stay within the supported semantic patterns.
4. **Batch input is S3 or Persist discovery.** A caller may provide `input_s3_uri` containing CSV/Parquet files with `debt_id`, or omit it to let Rules discover every debt identifier through Persist async Gremlin and prepare batch input through Glue.
5. **Single-entity execution is a synchronous read path.** The single-entity evaluator accepts exactly one canonical `debt_identifier`, uses the same compiled rule semantics as batch, performs one Persist `/persist/gremlin` read, and returns the classification directly. It does not start Step Functions, invoke Glue, write S3 artifacts, or emit batch cost metrics.
6. **Outputs are immutable run artifacts.** Each batch execution writes under a unique output prefix. The workflow never mutates prior outputs and never updates graph rows based on a result.
7. **Metrics are a side effect, not the source of truth.** S3 artifacts are authoritative for batch run results. Synchronous responses are authoritative for the single request that produced them. CloudWatch metrics are operational summaries that can be missing or delayed without changing either output contract.
8. **The canonical product identity is Rules.** Marketplace catalog metadata uses `component_id="Rules"` and `component_name="Rules"` / product name `Rules`. Lowercase `rules` is the service slug for source package names, SSM paths, S3 prefixes, tags, metrics dimensions, and internal resource names. Current implementation names like `FilterStack`, `project_name=filter`, and `serviceName=filter` are migration artifacts.

### 2.1 Stacks (AWS CDK)

The CDK app is a single tenant-local stack:

```text
bin/app.ts
└── RulesStack    # Output bucket, log group, Lambda workers, Glue Python Shell
                  # preparation job, synchronous evaluator Lambda, STANDARD
                  # Step Functions workflow, SSM parameters + CloudFormation
                  # outputs
```

`RulesStack` is declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or product-supplied deploy scripts are permitted.

The deploy region is the installer-supplied tenant AWS region. `marketplace/app.ts` receives Build's parameterized `MarketplaceContext` during synth and instantiates `RulesStack` with deploy-time account/region tokens, not concrete Build account values. Runtime SigV4 calls use the deployed region for Persist execute-api signing unless the Persist API URL explicitly identifies a different region through a typed install parameter. The current implementation hardcodes `us-east-2` in `bin/app.ts` and SigV4 calls; that is a migration gap, not a target contract.

### 2.2 RulesStack contents

#### 2.2.1 Storage

| Bucket | Encryption / ACL | Lifecycle | Purpose |
| ------ | ---------------- | --------- | ------- |
| `RulesOutputBucket` | S3-managed encryption, `BLOCK_ALL` public access, SSL-only, `BUCKET_OWNER_ENFORCED` ownership | Retained by default; lifecycle may be configured by stage | Run outputs under `rules/<execution-start>/<execution-name>/...`, including prepared input shards, per-file results, per-file statistics, optional rules reports, and aggregated statistics. |

Output layout:

```text
rules/<execution-start>/<execution-name>/
├── input/                         # generated only when input_s3_uri is omitted
│   └── batch_0000.csv
├── parts/
│   ├── results/
│   │   └── <input-file>_results.json
│   ├── statistics/
│   │   └── <input-file>_statistics.json
│   └── rules-reports/             # generated only when save_rules_reports=true
│       └── <input-file>_rules_reports.json
└── aggregated-statistics.json
```

Rules does not own a general-purpose input bucket. The workflow reads caller-supplied `s3://...` input files/prefixes and Lexicon product ruleset objects from S3. Install-time IAM must therefore grant the Rules runtime read access only to the tenant buckets/prefixes it is allowed to process and to the Lexicon ruleset prefix. The current implementation grants broad S3 read access; the target product should scope this through deployment parameters or an explicit tenant-managed bucket policy.

#### 2.2.2 Compute

All TypeScript Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`), and the standard ESM `createRequire` banner so CommonJS dependencies can satisfy dynamic built-in `require`s. Logging is structured JSON with three-month CloudWatch log retention. Handlers use `@aws-lambda-powertools/{logger,tracer}` with `POWERTOOLS_SERVICE_NAME=rules-*` and `POWERTOOLS_LOG_LEVEL=INFO`.

| Function | Memory | Timeout | Trigger | Purpose |
| -------- | ------ | ------- | ------- | ------- |
| `ListFilesFunction` | 512 MB | 1 min | Step Functions task | Resolve an `input_s3_uri` file or prefix into a list of `.csv` and `.parquet` files and carry the run output prefix forward. |
| `SubmitAsyncQueryFunction` | 512 MB | 1 min | Step Functions task | Submit `g.V().hasLabel('debt').values('debt_identifier')` to Persist `/persist/gremlin-async` when the caller did not provide `input_s3_uri`. |
| `PollQueryStatusFunction` | 512 MB | 1 min | Step Functions task after `Wait 30s` | Poll Persist `/persist/gremlin-async/{requestId}` until it returns `SUCCEEDED` with a `resultS3Uri`, or `FAILED`. |
| `ProcessFileFunction` | 4096 MB | 15 min | Step Functions `Map` item | Read debt IDs from one CSV/Parquet file, load/compile rules, query Persist `/persist/gremlin` in batches, classify results, and write per-file outputs. |
| `AggregateStatisticsFunction` | 512 MB | 1 min | Step Functions task | Merge all per-file statistics into `aggregated-statistics.json`. |
| `ReportPredictedCostFunction` | 512 MB | 1 min | Step Functions task | Emit a pre-run cost estimate before graph discovery when metrics are enabled. |
| `ReportMetricsFunction` | 512 MB | 1 min | Step Functions task | Read aggregated statistics and emit CloudWatch metrics for accepted populations, rule failures, and actual estimated cost. |
| `EvaluateDebtFunction` | 1024 MB | 2 sec | Direct Lambda invoke | Validate one `debt_identifier`, load compiled rules from the warm in-memory cache, query Persist once, classify the debt, and return the synchronous decision payload. |

#### 2.2.3 Glue

Rules includes one Glue Python Shell job:

| Job | Runtime | Capacity | Timeout | Purpose |
| --- | ------- | -------- | ------- | ------- |
| `rules-prepare-input` | Python 3.9 | 1 DPU | 1 h | Read Persist async Gremlin result JSON from S3 and split the debt identifier array into CSV input shards with header `debt_id` and up to 50,000 rows per file. |

Python is used only for this Glue preparation job. The runtime service, CDK app, tests, and business logic remain TypeScript.

#### 2.2.4 Step Functions

The `RulesStateMachine` is a STANDARD workflow, X-Ray tracing enabled, with a six-hour execution timeout. High-level shape:

```text
MetricsModeChoice
  -> RulesReportsModeChoice
  -> RuleSubsetModeChoice
  -> InputSourceChoice
       ├── input_s3_uri present
       │     -> UseProvidedInputUri
       │     -> ListFiles
       ├── metrics enabled and no input_s3_uri
       │     -> ReportPredictedCost
       │     -> SubmitAsyncQuery
       └── metrics disabled and no input_s3_uri
             -> SubmitAsyncQuery

SubmitAsyncQuery -> WaitForQuery(30s) -> PollQueryStatus -> QueryStatusChoice
  ├── SUCCEEDED -> PrepareInputFiles(Glue RUN_JOB) -> BuildInputUri -> ListFiles
  ├── FAILED    -> AsyncQueryFailed
  └── otherwise -> WaitForQuery

ListFiles -> ProcessAllFiles(Map, MaxConcurrency=4) -> AggregateResults
  -> ReportMetricsChoice
       ├── metrics enabled  -> ReportMetrics -> RulesReportsOutputChoice
       └── metrics disabled -> RulesReportsOutputChoice
  -> FormatOutput | FormatOutputWithRulesReports
```

`ProcessAllFiles` invokes `ProcessFileFunction` with `retryOnServiceExceptions=false` and explicit retry for `Lambda.TooManyRequestsException` and `Lambda.ServiceException` (`IntervalSeconds=5`, `MaxAttempts=6`, `BackoffRate=2`). Per-file graph fetches inside the worker use their own retry policy for Persist 5xx and transient fetch errors.

#### 2.2.5 SSM and outputs

Rules publishes:

| Name | Value | Purpose |
| ---- | ----- | ------- |
| `/rules/workflow/state-machine-arn` | `RulesStateMachine` ARN | Stable discovery pointer for operators and downstream orchestrators. |
| `/rules/sync/evaluator-function-arn` | `EvaluateDebtFunction` ARN | Stable discovery pointer for low-latency single-entity callers. |
| `StateMachineArn` | `RulesStateMachine` ARN | CloudFormation output for deployment automation. |
| `EvaluatorFunctionArn` | `EvaluateDebtFunction` ARN | CloudFormation output for deployment automation. |
| `OutputBucketName` | `RulesOutputBucket` name | CloudFormation output for operators and downstream readers. |

During migration from the current `filter` implementation, the stack may also publish `filter-workflow-state-machine-arn` as an alias. That alias is not part of the long-term product contract.

### 2.3 IAM (high-level)

- The workflow role can invoke only the Rules worker Lambdas, start/read the single Glue preparation job, and write X-Ray traces.
- Worker roles are split by capability. `ProcessFileFunction` reads allowed input/ruleset S3 prefixes, writes only to `RulesOutputBucket`, reads `persist-api-url` and `/lexicon/rulesets-uri`, and invokes only the configured Persist execute-api ARN. `EvaluateDebtFunction` reads the same ruleset sources, reads `persist-api-url`, invokes only Persist `/persist/gremlin`, and does not have S3 write permissions. `ReportMetricsFunction` reads only Rules outputs and writes CloudWatch metric data. `SubmitAsyncQueryFunction` and `PollQueryStatusFunction` read only `persist-api-url` and invoke Persist.
- Persist calls are SigV4-signed as `execute-api`. IAM grants should be scoped to the Persist API ARN and method paths `/persist/gremlin` and `/persist/gremlin-async*`; the current implementation's `arn:aws:execute-api:us-east-2:*:*` wildcard is a migration gap, not a target requirement.
- The Glue role reads the Persist async result object, writes generated input shards to `RulesOutputBucket`, and emits Glue logs. It must not read arbitrary S3 unless the tenant explicitly grants those prefixes.
- There is no API Gateway, Usage Plan, custom domain, Secrets Manager vault, DynamoDB table, EventBridge schedule, or cross-account assume-role in Rules.

### 2.4 Configuration surface

The runtime is configured through environment variables and SSM. Missing required values fail closed at cold start.

| Key | Source | Used by |
| --- | ------ | ------- |
| `OUTPUT_BUCKET` | `RulesOutputBucket` | Every worker that writes or reads run artifacts. |
| `SSM_PERSIST_API_URL_PARAM` | static `persist-api-url` unless overridden | Submit, poll, and batch query workers. |
| `SSM_LEXICON_RULESETS_URI_PARAM` | static `/lexicon/rulesets-uri` | Ruleset loader when `rule_s3_uris` is omitted. |
| `BATCH_SIZE` | default `50` | Number of debt IDs per Persist `/persist/gremlin` query. |
| `MAX_CONCURRENCY` | default `50` | In-process concurrency cap for batch Persist requests inside one `ProcessFileFunction`. |
| `MAX_RETRIES` | default `5` | Per-batch Persist retry attempts. |
| `RULESET_CACHE_TTL_SECONDS` | default `300` | Warm-container TTL for loaded and compiled rulesets in both batch workers and the single-entity evaluator. |
| `SINGLE_ENTITY_PERSIST_TIMEOUT_MS` | default `220` | Fetch timeout budget for the evaluator's single Persist `/persist/gremlin` call. |
| `SINGLE_ENTITY_TARGET_LATENCY_MS` | default `300` | Service-side warm-path latency SLO used for logging and metrics. |
| `AWS_REGION` / CDK region | deployment environment | SigV4 signing region and AWS client region. |
| `POWERTOOLS_SERVICE_NAME` | `rules-*` | Structured logs/traces. |
| `POWERTOOLS_LOG_LEVEL` | `INFO` | Runtime logging. |

`persist-api-url` is created by the Persist product and points at the tenant-local `/persist` API base URL. `/lexicon/rulesets-uri` points at an S3 prefix containing the ruleset catalog described in section 3.2.

Install-time configuration is carried through Deployer's `MarketplaceContext.customParameters`. These values are deployment configuration, not workflow input, and the Rules CDK app validates them before creating IAM grants or runtime environment variables:

| Custom parameter | Required | Purpose |
| ---------------- | -------- | ------- |
| `persistApiUrlSsmParam` | optional; default `persist-api-url` | SSM parameter that stores the tenant-local Persist API base URL. |
| `persistExecuteApiArn` | required unless the deploy environment supplies an equivalent scoped grant | Execute-api ARN pattern for Persist `/persist/gremlin` and `/persist/gremlin-async*` IAM grants. |
| `persistSigningRegion` | optional; default `context.tenant.region` | Override only when the Persist API URL is intentionally in a different region. |
| `lexiconRulesetsUriSsmParam` | optional; default `/lexicon/rulesets-uri` | SSM parameter for the default ruleset catalog S3 prefix. |
| `allowedInputS3Prefixes` | required for production installs | S3 prefixes that Rules may read when callers provide `input_s3_uri`. |
| `allowedRulesetS3Prefixes` | required for production installs unless covered by the Lexicon bucket policy | S3 prefixes that Rules may read for the Lexicon ruleset catalog and explicit `rule_s3_uris`. |
| `outputRetentionDays` | optional | Lifecycle policy for run outputs; omitted means retain by default. |
| `batchSize` / `maxConcurrency` / `maxRetries` | optional | Install-time defaults for the runtime env vars `BATCH_SIZE`, `MAX_CONCURRENCY`, and `MAX_RETRIES`. |
| `singleEntityProvisionedConcurrency` | optional; recommended `1` or higher for production low-latency callers | Provisioned concurrency for `EvaluateDebtFunction`. The 300ms SLO assumes warm execution or provisioned concurrency. |
| `singleEntityPersistTimeoutMs` | optional; default `220` | Persist call budget for the synchronous evaluator. |

---

## 3. Data Model & Contracts

### 3.1 Workflow input

```jsonc
{
  "input_s3_uri": "s3://bucket/path/", // optional file or prefix
  "rule_s3_uris": ["s3://bucket/rulesets/phone-interactions/rules/<rule>/"], // optional
  "skip_report_metrics": false,
  "save_rules_reports": false
}
```

Rules:

- `input_s3_uri` may reference a single `.csv` file, a single `.parquet` file, or a prefix containing `.csv` / `.parquet` files.
- CSV input files must have a header column named `debt_id`.
- Parquet input files must have a column named `debt_id`.
- If `input_s3_uri` is omitted, Rules queries Persist for all debt identifiers and creates CSV input shards through Glue.
- `rule_s3_uris`, when provided, must contain at least one S3 prefix. Each prefix must contain exactly one `.json` rule definition and exactly one `.gremlin` query object.
- `skip_report_metrics=true` disables both predicted and actual metric emission for that execution.
- `save_rules_reports=true` writes per-debt/per-phone rule report artifacts in addition to the filtered results.

### 3.1.1 Synchronous single-entity input

The evaluator input is intentionally smaller than the batch workflow input:

```jsonc
{
  "debt_identifier": "D001",
  "ruleset_id": "phone",
  "rule_s3_uris": ["s3://bucket/rulesets/phone-interactions/rules/<rule>/"],
  "include_rules_report": false
}
```

Rules:

- `debt_identifier` is required, must be a non-empty string, and is the canonical graph identifier. The synchronous path does not accept `debt_id` aliases in its public contract.
- `ruleset_id` is optional and defaults to `phone`. Only rulesets present in the Lexicon catalog are accepted.
- `rule_s3_uris` follows the same explicit subset contract as the batch workflow. Explicit subsets are cacheable by the normalized URI list.
- `include_rules_report=false` returns the same filtered decision payload that downstream products should use for action. `include_rules_report=true` adds audit fields to the response without changing pass/fail classification.
- The evaluator has no `input_s3_uri`, `skip_report_metrics`, or `save_rules_reports` fields. It never reads population input files, writes S3 artifacts, or emits batch cost metrics.

Success response:

```jsonc
{
  "debt_identifier": "D001",
  "accepted": true,
  "ruleset_id": "phone",
  "ruleset_version": "1.0.0",
  "evaluated_at": "2026-05-19T12:34:56.000Z",
  "latency_ms": 143,
  "result": {
    "debt_identifier": "D001",
    "balance": 100.25,
    "first_name": "Jane",
    "last_name": "Doe",
    "postal_code": "12345",
    "tu_score": 650,
    "preferred_language": "en",
    "phone_numbers": [
      {
        "phone_number": "5551112222",
        "latest_phone_status": "ACTIVE",
        "latest_rpc_contact_date": "2026-05-08T12:00:00Z",
        "overall_call_start_time": "09:00",
        "overall_call_end_time": "20:00",
        "phone_usage_12_months": "HIGH",
        "verified": "true",
        "verification_result": "VERIFIED",
        "day_windows": []
      }
    ]
  }
}
```

Not found response:

```jsonc
{
  "debt_identifier": "D404",
  "accepted": false,
  "ruleset_id": "phone",
  "evaluated_at": "2026-05-19T12:34:56.000Z",
  "latency_ms": 91,
  "result": null,
  "reason": "not_loaded_to_graph"
}
```

Rejected-by-rules response:

```jsonc
{
  "debt_identifier": "D002",
  "accepted": false,
  "ruleset_id": "phone",
  "ruleset_version": "1.0.0",
  "evaluated_at": "2026-05-19T12:34:56.000Z",
  "latency_ms": 137,
  "result": null,
  "reason": "debt_rule_failed"
}
```

`reason` is one of `not_loaded_to_graph`, `debt_rule_failed`, `no_phone_numbers`, or `no_passing_phone_numbers`. When `include_rules_report=true`, rejected responses may include `rules_report` and `phone_numbers[*].phone_rules_report` to explain the rejection; when it is false, rejected responses stay compact and action-safe with `result=null`.

### 3.2 Lexicon ruleset catalog

When `rule_s3_uris` is omitted, Rules reads the ruleset catalog from `s3://<bucket>/<prefix>/index.json`, where the bucket/prefix comes from SSM `/lexicon/rulesets-uri` published by the Lexicon product.

`index.json`:

```jsonc
{
  "rulesets": [
    {
      "id": "phone",
      "label": "Phone Interactions",
      "description": "Phone interaction eligibility rules",
      "version": "1.0.0",
      "manifest_path": "phone-interactions/ruleset.json"
    },
    {
      "id": "sms",
      "label": "SMS Interactions",
      "description": "SMS interaction eligibility rules",
      "version": "1.0.0",
      "manifest_path": "sms-interactions/ruleset.json"
    }
  ]
}
```

Rules currently selects the catalog item whose `id` is `phone`. The Lexicon product may publish additional rulesets such as `sms`; Rules ignores them unless a later workflow input or product version explicitly selects them.

Ruleset manifest:

```jsonc
{
  "id": "phone",
  "name": "phone_interactions",
  "label": "Phone Interactions",
  "version": "1.0.0",
  "description": "Rules that decide which debts and phone numbers can be called",
  "owner_company": "Spring Oaks Capital",
  "rules": [
    {
      "id": "not_do_not_call",
      "path": "phone-interactions/rules/not_do_not_call/not_do_not_call.json",
      "query_path": "phone-interactions/rules/not_do_not_call/not_do_not_call.gremlin",
      "order": 10
    }
  ]
}
```

Rule definition object:

```jsonc
{
  "id": "not_do_not_call",
  "name": "not_do_not_call",
  "description": "Reject phone numbers with an active DNC marker",
  "filter_type": "exclusion",
  "filter_scope": "phone",
  "vertices_used": ["debt", "person", "phone_number"],
  "edges_used": ["person_phone_number_has_dnc"],
  "legal_compliance_reference": "optional human-readable citation"
}
```

Rule query object:

```gremlin
g.V().hasLabel('debt').has('debt_identifier', debtId)
  .in('person_owes_debt').has('version', 2)
  .out('person_has_phone_number')
  .not(inE('person_phone_number_has_dnc').has('dnc_status', true))
```

### 3.3 Supported rule compiler patterns

The rule compiler parses each `.gremlin` query and accepts a bounded semantic subset:

- The traversal must start from the canonical debt lookup: `g.V().hasLabel('debt').has('debt_identifier', <identifier>)`.
- Optional debt root aliases such as `.as('d')` are allowed and removed from rule fragments where appropriate.
- `filter_scope` may be `debt`, `phone`, or `metadata`.
- `metadata` rules are skipped by the rule-report compiler; they may describe enrichment queries but do not produce pass/fail report keys.
- Phone rules may enter through `out('person_has_phone_number')`, `outE('person_has_phone_number')`, or person-to-phone hyperedges such as `outE('person_phone_number_status_changed')`.
- Person vertex filters between `in('person_owes_debt')` and the phone traversal are allowed when they do not change the traversed element (`has`, `hasLabel`, `hasNot`).
- Supported rule body shapes are negated traversals, positive `where` traversals, positive chains, `choose` conditionals, `or` predicates, and `hasNext` existence chains.
- Scope mismatches fail closed. A query inferred as phone-scoped with `filter_scope="debt"` is rejected before any graph query is issued.

The compiler injects date placeholders at query-build time:

| Placeholder | Replacement |
| ----------- | ----------- |
| `__TODAY__` | Current local date as `YYYY-MM-DD`, wrapped in Gremlin `datetime(...)` by the rule. |
| `__SEVEN_DAYS_AGO__` | Date seven days before execution. |
| `__TODAY_DAY_OF_WEEK__` | Uppercase weekday name (`MONDAY`, `TUESDAY`, ...). |

### 3.4 Persist query contract

Rules submits two kinds of Persist requests.

Full-population discovery:

```jsonc
POST /persist/gremlin-async
{
  "gremlin": "g.V().hasLabel('debt').values('debt_identifier')"
}
```

Status polling:

```jsonc
GET /persist/gremlin-async/{requestId}
```

Expected status response:

```jsonc
{
  "data": {
    "status": "QUEUED|RUNNING|SUCCEEDED|FAILED",
    "resultS3Uri": "s3://persist-results/gremlin-async/results/..." // present on SUCCEEDED
  }
}
```

Per-batch evaluation:

```jsonc
POST /persist/gremlin
{
  "gremlin": "<compiled Gremlin projection for one batch of debt identifiers>"
}
```

Single-entity evaluation uses the same endpoint with a single canonical debt root instead of a `within(...)` batch clause:

```jsonc
POST /persist/gremlin
{
  "gremlin": "<compiled Gremlin projection for debt_identifier='D001'>"
}
```

Expected single-entity response:

```jsonc
{
  "data": {
    "results": [
      {
        "debt_identifier": "D001",
        "balance": 100.25,
        "phone_numbers": [],
        "rules_report": {
          "no_open_dispute": true
        }
      }
    ]
  }
}
```

The evaluator treats zero results as `not_loaded_to_graph`. More than one result for the same `debt_identifier` is a data integrity failure and returns a tagged `persist_result_not_unique` error.

Expected batch response:

```jsonc
{
  "data": {
    "results": [
      {
        "debt_identifier": "D001",
        "balance": 100.25,
        "first_name": "Jane",
        "last_name": "Doe",
        "postal_code": "12345",
        "tu_score": 650,
        "preferred_language": "en",
        "phone_numbers": [],
        "rules_report": {
          "no_open_dispute": true
        }
      }
    ]
  }
}
```

Rules treats missing debt rows as `not_loaded_to_graph_count`. It does not synthesize a placeholder result for them.

### 3.5 Debt result

```jsonc
{
  "debt_identifier": "D001",
  "balance": 100.25,
  "first_name": "Jane",
  "last_name": "Doe",
  "postal_code": "12345",
  "tu_score": 650,
  "preferred_language": "en",
  "phone_numbers": [
    {
      "phone_number": "5551112222",
      "latest_phone_status": "ACTIVE",
      "latest_rpc_contact_date": "2026-05-08T12:00:00Z",
      "overall_call_start_time": "09:00",
      "overall_call_end_time": "20:00",
      "phone_usage_12_months": "HIGH",
      "verified": "true",
      "verification_result": "VERIFIED",
      "day_windows": [
        {
          "day_of_week": "FRIDAY",
          "preferred_call_start_time": "09:00",
          "preferred_call_end_time": "18:00"
        }
      ],
      "phone_rules_report": {
        "not_do_not_call": true,
        "has_active_phone_number": true
      }
    }
  ],
  "rules_report": {
    "no_open_dispute": true,
    "not_in_bankruptcy": true
  }
}
```

Classification rules:

- A debt fails when any `rules_report` value is `false`.
- A debt fails when it has no phone numbers.
- A debt passes only when all debt rules pass and at least one phone number has all `phone_rules_report` values set to `true`.
- The filtered output includes only passing phone numbers and strips rule-report maps from the main results payload.

### 3.6 Output artifacts

Per-file results:

```jsonc
{
  "results": [
    {
      "debt_identifier": "D001",
      "balance": 100.25,
      "first_name": "Jane",
      "last_name": "Doe",
      "postal_code": "12345",
      "tu_score": 650,
      "preferred_language": "en",
      "phone_numbers": [
        {
          "phone_number": "5551112222",
          "latest_phone_status": "ACTIVE",
          "latest_rpc_contact_date": "2026-05-08T12:00:00Z",
          "overall_call_start_time": "09:00",
          "overall_call_end_time": "20:00",
          "phone_usage_12_months": "HIGH",
          "verified": "true",
          "verification_result": "VERIFIED",
          "day_windows": []
        }
      ]
    }
  ]
}
```

Per-file statistics and aggregated statistics share this shape:

```jsonc
{
  "input_debts_count": 1000,
  "not_loaded_to_graph_count": 5,
  "filtered_debts_count": 320,
  "filtered_phone_numbers_count": 410,
  "not_passed_rules_debts_count": 675,
  "not_passed_rules_statistics": {
    "not_in_bankruptcy": 20,
    "not_do_not_call": 15
  }
}
```

Optional rules reports:

```jsonc
{
  "results": [
    {
      "debt_identifier": "D001",
      "rules_report": {
        "no_open_dispute": true
      },
      "phone_numbers": [
        {
          "phone_number": "5551112222",
          "phone_rules_report": {
            "not_do_not_call": true
          }
        }
      ]
    }
  ]
}
```

`not_passed_rules_statistics` counts a debt-level rule failure once per failed debt. For phone rules, it counts a rule against a failed debt only when every phone number on that debt failed that phone rule.

### 3.7 Error behaviour

Rules is fail-closed:

- Invalid S3 URIs fail the worker.
- Missing or blank synchronous `debt_identifier` fails validation before ruleset or graph reads.
- Unsupported input file types fail the worker.
- Empty explicit `rule_s3_uris` fails before graph reads.
- Duplicate explicit rule IDs or rule names fail before graph reads.
- Ruleset catalogs without an item `id="phone"` fail before graph reads.
- A rule whose Gremlin query cannot be parsed into the supported compiler subset fails before graph reads.
- Persist non-2xx responses fail the affected batch after bounded retries.
- Synchronous Persist timeout or non-2xx responses return a tagged evaluator error and emit error metrics; they do not synthesize an accepted or rejected decision.
- Persist async status `FAILED` fails the workflow through `AsyncQueryFailed`.

There is no partial-success workflow output contract. If a `ProcessFile` map item fails after retries, the Step Functions execution fails and callers should inspect execution history plus any already-written part artifacts.

---

## 4. Runtime Workflow Details

### 4.1 Input discovery path

When `input_s3_uri` is present:

1. `UseProvidedInputUri` sets the workflow `inputUri`.
2. `ListFilesFunction` resolves the URI.
3. If the URI points to a prefix, only `.csv` and `.parquet` objects under that prefix are processed.
4. `prepareExecutionTime` is set to `0` for cost reporting.

When `input_s3_uri` is omitted:

1. `SubmitAsyncQueryFunction` submits the all-debt identifier Gremlin query to Persist async Gremlin.
2. `PollQueryStatusFunction` polls every 30 seconds.
3. On `SUCCEEDED`, `PrepareInputFiles` starts the Glue Python Shell job with `RUN_JOB`.
4. Glue reads Persist's result S3 object and writes `input/batch_####.csv` files under the execution prefix.
5. `BuildInputUri` points `ListFilesFunction` at the generated `input/` prefix.

If metrics are enabled, `ReportPredictedCostFunction` runs before the async query. This predicted metric is an operational estimate only.

### 4.2 Per-file processing

For each input file, `ProcessFileFunction`:

1. reads debt IDs from CSV or Parquet column `debt_id`;
2. loads the default phone ruleset or explicit rule subset;
3. compiles the rules into debt and phone rule projection fragments;
4. splits debt IDs into batches of `BATCH_SIZE` (default 50);
5. builds a Gremlin projection for each batch;
6. calls Persist `/persist/gremlin` with SigV4 and in-process concurrency capped by `MAX_CONCURRENCY`;
7. classifies each returned `DebtResult`;
8. writes per-file result and statistics artifacts;
9. writes per-file rules reports when enabled.

The generated Gremlin projection enriches each debt with current balance, person name, residential postal code, TU score, preferred language, phone status, latest RPC contact date, communication preference windows, contactability profile, verification result, debt rule reports, and phone rule reports.

### 4.3 Aggregation and metrics

After all files are processed:

1. `AggregateStatisticsFunction` reads each per-file statistics artifact and writes `aggregated-statistics.json`.
2. If metrics are enabled, `ReportMetricsFunction` reads aggregated statistics and emits CloudWatch metrics.
3. The workflow formats output URIs for the caller.

CloudWatch metrics:

| Namespace | Metric | Dimensions | Meaning |
| --------- | ------ | ---------- | ------- |
| `CDM` | `cost_predicted` | `service=Rules` | Estimated run cost before full-population graph discovery. |
| `CDM` | `actual_cost` | `service=Rules` | Estimated cost based on file count and Glue execution time. |
| `CDM` | `suggested_to_call` | `source=Rules` | Count of debts that passed rules. |
| `CDM` | `suggested_phone_numbers_to_call` | `source=Rules` | Count of phone numbers on passed debts that passed phone rules. |
| `CDM` | `filtered_out_by_rules` | `source=Rules`, `rule=<rule-name>` | Count of debts excluded by each rule. |

The current implementation emits `service=Filter` / `source=Filter`; canonical Rules deployments MUST emit `Rules`.

### 4.4 Synchronous single-entity execution

The single-entity evaluator is an IAM-protected Lambda function designed for interactive downstream flows where a caller already knows the canonical `debt_identifier`.

Execution flow:

1. Validate `debt_identifier`, optional `ruleset_id`, optional `rule_s3_uris`, and `include_rules_report`.
2. Resolve `persist-api-url` from the warm parameter cache.
3. Load the default ruleset or explicit subset from the warm compiled-rules cache. Cache keys include `ruleset_id`, normalized explicit URI list, manifest version, object ETags when available, and the local date used for date placeholders.
4. Build the single-id Gremlin projection with `g.V().hasLabel('debt').has('debt_identifier', debtIdentifier)`.
5. Call Persist `/persist/gremlin` once with SigV4 and `SINGLE_ENTITY_PERSIST_TIMEOUT_MS`.
6. Classify the returned `DebtResult` with the same classifier used by `ProcessFileFunction`.
7. Return the decision payload directly and emit operational latency/count metrics.

The evaluator does not write S3 artifacts. Callers that need durable evidence should store the response, request ID, and timestamp in their own activity record, or run the batch workflow with `save_rules_reports=true` for auditable population outputs.

Latency SLO:

| Segment | Target budget |
| ------- | ------------- |
| Lambda invoke + event validation | <= 25 ms |
| Warm SSM/ruleset cache lookup and query build | <= 20 ms |
| Persist `/persist/gremlin` round trip | <= 220 ms |
| Classification, response shaping, and metric enqueue | <= 35 ms |
| **Warm service-side total** | **<= 300 ms p95** |

The 300ms requirement is a warm-path service-side SLO. Production installs that depend on it should configure `singleEntityProvisionedConcurrency >= 1` and keep the Persist graph-read path healthy enough to satisfy the Persist segment budget. Lambda cold starts, caller-side network latency, IAM policy evaluation delays outside the service, and Persist p95 above the configured budget are outside the SLO but must be visible through metrics.

Single-entity metrics:

| Namespace | Metric | Dimensions | Meaning |
| --------- | ------ | ---------- | ------- |
| `CDM` | `rules_single_entity_latency_ms` | `service=Rules`, `ruleset=<ruleset-id>` | End-to-end evaluator handler duration. |
| `CDM` | `rules_single_entity_evaluations` | `service=Rules`, `ruleset=<ruleset-id>`, `accepted=true|false` | Count of completed evaluator decisions. |
| `CDM` | `rules_single_entity_errors` | `service=Rules`, `error=<tag>` | Count of validation, ruleset, Persist, and classifier failures. |
| `CDM` | `rules_single_entity_cache_hit` | `service=Rules`, `cache=ruleset|persist-url` | Warm-cache hit count for latency diagnosis. |

### 4.5 Cost model

Rules reports estimated cost from Lambda and Glue constants:

- Lambda ARM64 GB-second price;
- Lambda request price;
- Glue Python Shell DPU-hour price;
- `ProcessFileFunction` memory size;
- observed file count;
- Glue preparation execution time.

These metrics are not billing records. They are directional operational signals for comparing runs and catching unexpected scale changes. Any customer-facing billing, cost allocation, or marketplace price calculation belongs outside Rules.

---

## 5. Marketplace Packaging

### 5.1 Component identity

Rules is registered under a Marketplace catalog product named **Rules** and published as a Marketplace `SERVICE` component:

```jsonc
{
  "component_id": "Rules",
  "type": "SERVICE",
  "description": "Tenant-local rules evaluation product for batch and single-entity contactability and eligibility decisions"
}
```

`component_id="Rules"` is the Marketplace-distributed component identity. Lowercase `rules` is only the implementation slug used for package names, tags, SSM paths, S3 prefixes, metrics dimensions, and internal resource names.

Rules source follows the Build input contract (`marketplace.product.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `marketplace/app.ts`, `lib/`, runtime source/assets). Build consumes that source, runs synth, and publishes a Marketplace artifact that Deployer consumes as a built CDK cloud assembly with `cdk.out/manifest.json`, stack templates, staged assets, and `build/build.manifest.json`.

`marketplace.product.json` is declarative only:

```jsonc
{
  "component_id": "Rules",
  "component_name": "Rules",
  "bundle_type": "SERVICE",
  "context_schema_version": "1",
  "stacks": ["RulesStack"],
  "requires": {
    "domain": false,
    "shared_usage_plan": false,
    "identity": false
  }
}
```

- `base_path` is intentionally omitted because Rules has no API Gateway surface and does not create a custom-domain mapping.
- No product-supplied shell deploy command is used; Build owns synth and asset bundling, while Deployer owns asset publishing and CloudFormation deployment.
- The deploy artifact manifest must not contain `entrypoint`, `synth_command`, `deploy_command`, `post_deploy_command`, package-script hooks, or any deploy-engine selector.
- Stack resources carry cost tags `sc:service:name=rules` and `sc:product:name=Rules`.

The Marketplace bundle upload contract for Rules is:

```jsonc
{
  "description": "Rules service cloud assembly",
  "bundle_url": "https://<presigned-build-cloud-assembly-zip>",
  "dependencies": ["Persist", "Lexicon"],
  "deploy_time_dependencies": []
}
```

`Persist` is a runtime dependency because Rules reads graph data exclusively through Persist. `Lexicon` is a runtime data dependency because Rules reads `/lexicon/rulesets-uri` and the ruleset S3 prefix owned by the Lexicon product. Rules does not list Lexicon in `deploy_time_dependencies` unless a future stack resolves Lexicon's bucket ARN at synth/deploy time instead of through runtime SSM and install parameters.

The publication artifact must satisfy Marketplace's bundle validation gates:

- `bundle_url` is HTTPS, reachable by `HEAD`, and has `Content-Length <= MAX_BUNDLE_BYTES`.
- Bundle metadata is carried in JWT-shaped `x-amz-meta-service-*` headers, not raw JSON metadata headers.
- `service-builder.artifact_kind` is `CDK_CLOUD_ASSEMBLY`, `service-builder.bundle_type` is `SERVICE`, and both match the Marketplace component type.
- `service-builder.component_id` / `service-marketplace.component_id`, when present, identify `Rules`.
- The Build artifact contains `cdk.out/manifest.json`, stack templates, staged file assets, and `build/build.manifest.json`, with no product source directories, legacy `config.json`, `artifacts/<module>/update.json`, product-supplied command strings, or product-owned deploy scripts.

### 5.2 Install-time prerequisites

Rules requires:

- Persist deployed in the same tenant and publishing `persist-api-url`.
- Lexicon deployed in the same tenant with SSM `/lexicon/rulesets-uri` pointing at a readable S3 ruleset catalog.
- IAM permissions for Rules to invoke Persist's `/persist/gremlin` and `/persist/gremlin-async` APIs.
- IAM/S3 grants for allowed input prefixes and the Lexicon ruleset prefix.
- AWS Glue service role permissions for the preparation job.
- CDK bootstrap in the target tenant region for Lambda assets and Glue script assets.
- Deployer `custom_parameters` matching section 2.4 so the stack can scope S3 and Persist IAM without broad wildcard grants.

### 5.3 Outputs consumed by downstream products

Downstream products should consume batch Rules results through S3 output URIs, not through internal Lambda logs or CloudWatch metrics. The stable batch artifacts are:

- `resultsS3Uri` for accepted debt and phone candidates;
- `aggregatedStatisticsS3Uri` for run-level counts and failure reasons;
- `rulesReportsS3Uri` when audit mode is enabled.

If a downstream communication product needs a durable handoff, it should store the workflow execution ARN plus these output URIs in its own activity record. Rules does not own downstream activity lifecycle state.

Downstream products that need an interactive, single-debt decision should discover `/rules/sync/evaluator-function-arn` and invoke `EvaluateDebtFunction` with IAM. They should persist the returned decision payload in their own transaction or activity state if they need replayable evidence.

---

## 6. Testing & Verification

### 6.1 Unit tests

The target repository uses Vitest. Current coverage in `../implementation/filter` includes:

- `test/filter-stack.test.ts` - state machine branching for provided input, full graph discovery, rule reports, and rule subset propagation.
- `test/handler-process-file.test.ts` - per-file classification, explicit rule subset loading, output payload shape, optional rules reports, and no-phone edge cases.
- `test/handler-evaluate-debt.test.ts` - synchronous input validation, cache-hit/cold-cache behavior, single-id query generation, not-loaded responses, report inclusion, latency metric tags, and no S3 writes.
- `test/ruleset-loader.test.ts` - default SSM/S3 ruleset loading, explicit prefix loading, duplicate detection, and empty subset rejection.
- `test/lexicon-rule-compiler.test.ts` and `test/lexicon-rules.test.ts` - compiler semantics for debt/phone/metadata scopes, comments, aliases, hyperedges, conditional rules, unsupported roots, and canonical rule fragments.
- `test/query-builder.test.ts` - generated Gremlin projection, date placeholders, versioned person traversals, enrichment fields, empty rule projections, and no dangling Gremlin syntax.
- `test/gremlin-parser.test.ts` - parser support for chained method calls and scalar literal arguments.

Required local commands in the target Rules repository:

```bash
pnpm install
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm cdk:synth
```

The CI-facing `just` contract should expose:

```bash
just check
just test
just cdk:synth
just cdk:deploy
```

The current `justfile` uses `just build` for synth and `just type-check` for TypeScript. The Rules target repository should align with the shared command contract while keeping aliases if helpful.

### 6.2 Integration tests

Integration verification requires a deployed tenant environment with Persist and the Lexicon product's rulesets available.

Test setup:

1. Upload a small CSV with header `debt_id` to an allowed input S3 prefix.
2. Ensure `/lexicon/rulesets-uri` points at a catalog containing a `phone` ruleset.
3. Ensure `persist-api-url` points at a deployed Persist API and the Rules role can SigV4 invoke it.
4. Start the Rules state machine with `input_s3_uri`, `save_rules_reports=true`, and `skip_report_metrics=false`.
5. Assert the execution succeeds and returns all expected S3 URIs.
6. Read `resultsS3Uri`, `aggregatedStatisticsS3Uri`, and `rulesReportsS3Uri` from S3.
7. Confirm filtered outputs contain no rule-report maps, while rules-report artifacts contain the expected pass/fail maps.
8. Confirm `CDM` metrics are emitted with `Rules` dimensions.

Full-population integration additionally omits `input_s3_uri` and verifies the Persist async Gremlin -> Glue preparation -> per-file map path.

Single-entity integration invokes `EvaluateDebtFunction` directly with IAM:

1. Resolve `/rules/sync/evaluator-function-arn`.
2. Invoke the function with a known loaded `debt_identifier` and `include_rules_report=true`.
3. Assert the response returns `accepted`, `result`, `ruleset_id`, `ruleset_version`, `evaluated_at`, and `latency_ms`.
4. Assert rule-report fields match the batch classifier for the same debt and ruleset.
5. Invoke a known missing `debt_identifier` and assert `reason="not_loaded_to_graph"`.
6. Confirm warm p95 service-side latency is under 300ms across a representative sample after at least one warm-up invoke or with provisioned concurrency enabled.

### 6.3 Operational runbook

Common checks:

1. Confirm the workflow ARN exists at `/rules/workflow/state-machine-arn`.
2. Confirm the single-entity evaluator ARN exists at `/rules/sync/evaluator-function-arn`.
3. Confirm `persist-api-url` and `/lexicon/rulesets-uri` exist and point at reachable resources.
4. Confirm no executions are stuck `RUNNING` past six hours: `aws stepfunctions list-executions --status-filter RUNNING`.
5. For failed batch executions, inspect the Step Functions failed state first, then the corresponding Lambda log stream in `RulesLogGroup`.
6. For failed synchronous evaluations, inspect the evaluator log stream by request ID and the `rules_single_entity_errors` metric by `error` tag.
7. For low output counts, inspect `aggregated-statistics.json` before CloudWatch metrics; the S3 artifact is authoritative.
8. For rule compiler failures, validate the offending rule starts from the canonical debt root and has a supported debt/phone traversal shape.
9. For Persist throttling or transient 5xx, tune `BATCH_SIZE`, `MAX_CONCURRENCY`, and `MAX_RETRIES` conservatively before increasing `ProcessAllFiles` map concurrency. For synchronous latency misses, inspect Persist p95, ruleset cache misses, and Lambda cold starts before changing rule semantics.

### 6.4 Migration from current `filter`

The current codebase at `../implementation/filter` is the implementation seed, but the product contract is Rules. Migration work must rename or alias these surfaces:

| Current | Target |
| ------- | ------ |
| package `@soc/filter` | package `@soc/rules` |
| `FilterStack` | `RulesStack` |
| `FilterStateMachine` | `RulesStateMachine` |
| `filter-workflow-state-machine-arn` | `/rules/workflow/state-machine-arn` |
| output prefix `filter/...` | output prefix `rules/...` |
| `project_name=filter` | `sc:service:name=rules`, `sc:product:name=Rules` |
| Powertools service `filter` | `rules-*` |
| CloudWatch dimensions `Filter` | `Rules` |
| Glue job `filter-prepare-input` | `rules-prepare-input` |

Compatibility aliases may be kept only for deployed consumers that already depend on current names. New marketplace metadata, documentation, tests, and examples must use Rules.

---

## 7. Implementation Notes

The current code paths that define the Rules product are:

- `lib/filter-stack.ts` - CDK resources, workflow definition, SSM output, Glue job, and IAM grants.
- `src/handler.ts` - Step Functions worker handlers, classification loop, S3 outputs, and metrics.
- `src/handler-evaluate-debt.ts` - direct-invoke synchronous evaluator handler, input validation, warm-cache usage, single-id Persist read, response shaping, and latency metrics.
- `src/types.ts` - workflow, domain, output, and statistics contracts.
- `src/ruleset-loader.ts` - SSM/S3 ruleset loading plus explicit rule subset loading.
- `src/lexicon-rule-compiler.ts`, `src/lexicon-rules.ts`, `src/lexicon-rule-ir.ts`, `src/gremlin-parser.ts` - rule parser/compiler.
- `src/query-builder.ts` - canonical Gremlin projection template and dynamic rule-report injection.
- `src/neptune-client.ts` - SigV4 execute-api calls to Persist and bounded batch retries.
- `src/s3-input.ts` - CSV/Parquet input discovery and debt-id extraction.
- `src/statistics.ts` - rule failure aggregation.
- `glue/prepare_input.py` - Persist async result sharding.

Before publishing Rules as a marketplace product, the implementation must close these current-code gaps:

- upgrade Lambda runtime from `NODEJS_22_X` to `NODEJS_24_X`;
- remove hardcoded `us-east-2` region assumptions;
- rename public product identifiers from Filter to Rules;
- scope S3 and execute-api IAM to install-time resources where possible;
- publish `/rules/workflow/state-machine-arn`;
- publish `/rules/sync/evaluator-function-arn`;
- align the `just` recipes with the shared target-service command contract;
- ensure generated marketplace bundle metadata declares `component_id="Rules"`, `component_name="Rules"`, `bundle_type="SERVICE"`, and dependency metadata for Persist.

---

## 8. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier, Vitest, `justfile`, and shared CI caller workflows. Package identity is `@soc/rules` or the marketplace-equivalent internal package name.
2. **Runtime dependencies**: AWS Lambda Powertools logger/tracer/parameters, AWS SDK clients for S3, SSM, CloudWatch, Smithy SigV4 signing helpers, `csv-parse`, `hyparquet`, `web-tree-sitter`, and `tree-sitter-groovy`. CDK dependencies are `aws-cdk-lib`, `constructs`, `aws-cdk`, and the Glue alpha construct while the product uses Python Shell jobs.
3. **Contracts**: implement the workflow input, synchronous evaluator input/output, Step Functions intermediate payloads, `DebtResult`, `PhoneNumber`, output artifact payloads, statistics payloads, ruleset catalog, ruleset manifest, rule definition, and explicit-rule-prefix contracts from section 3.
4. **S3 input module**: parse `s3://` URIs, distinguish file vs prefix inputs, list only `.csv` and `.parquet` objects, and extract non-empty `debt_id` values from both formats.
5. **Ruleset loader**: read `/lexicon/rulesets-uri`, load `index.json`, select ruleset `id="phone"`, load the manifest, sort rules by `order`, fetch each JSON definition and `.gremlin` query, and support `rule_s3_uris` subset mode with duplicate detection.
6. **Gremlin parser/compiler**: parse rule traversals with tree-sitter, enforce the canonical debt root, infer `debt` vs `phone` scope, skip `metadata` rules, rewrite supported phone-entry patterns, reject scope mismatches, and emit deterministic `project(...).by(...)` fragments keyed by rule name.
7. **Query builder**: reproduce the canonical debt projection and phone projection, inject debt and phone rule-report blocks, support single-id and `within(...)` batch clauses, and replace date placeholders for today, seven days ago, and weekday.
8. **Persist client**: resolve `persist-api-url` once per warm container, SigV4-sign `execute-api` requests, call `/persist/gremlin-async`, `/persist/gremlin-async/{requestId}`, and `/persist/gremlin`, bound per-batch retries/concurrency by `MAX_RETRIES` and `MAX_CONCURRENCY`, and expose a single-call path with `SINGLE_ENTITY_PERSIST_TIMEOUT_MS`.
9. **Worker handlers**: implement `ListFiles`, `SubmitAsyncQuery`, `PollQueryStatus`, `ProcessFile`, `AggregateStatistics`, `ReportPredictedCost`, `ReportMetrics`, and `EvaluateDebt` with small injectable services where practical so tests can supply S3, SSM, Persist, and CloudWatch doubles.
10. **Glue preparation job**: implement `rules-prepare-input` as the only Python workload, reading Persist async Gremlin result JSON and writing `debt_id` CSV shards of 50,000 rows under `<outputPrefix>/input/`.
11. **Marketplace entrypoint**: implement `marketplace/app.ts` and `marketplace.product.json` with `component_id="Rules"`, `component_name="Rules"`, `bundle_type="SERVICE"`, `stacks=["RulesStack"]`, and no `base_path`. The entrypoint must instantiate `RulesStack` from Build's parameterized `MarketplaceContext` and validate the custom-parameter schema in section 2.4.
12. **CDK stack**: create `RulesStack` with the output bucket, shared log group, eight Node.js 24 ARM64 Lambdas, the Glue Python Shell job, the STANDARD state machine in section 2.2.4, least-privilege IAM, SSM `/rules/workflow/state-machine-arn`, SSM `/rules/sync/evaluator-function-arn`, and stack outputs.
13. **Operational metadata**: tag resources with `sc:service:name=rules` and `sc:product:name=Rules`; make `Rules` the Powertools service prefix and CloudWatch metric dimension value.
14. **Tests**: port and expand the current Vitest coverage for stack wiring, handlers, synchronous evaluator behavior, ruleset loading, rule compiler semantics, query builder output, parser behavior, S3 input parsing, statistics aggregation, latency metrics, and the Filter-to-Rules migration aliases.
15. **Integration smoke**: deploy into a tenant with Persist and Lexicon rulesets, run both batch input modes plus the single-entity evaluator, verify S3 artifacts, synchronous response payloads, latency metrics, and document the exact operator commands.

---

## 9. Acceptance Criteria

A re-implementation is considered functionally complete when:

- The product is discoverable as **Rules** with Marketplace `component_id="Rules"` / `component_name="Rules"`, implementation slug `rules`, stack `RulesStack`, state machine `RulesStateMachine`, output prefix `rules/...`, and SSM `/rules/workflow/state-machine-arn`.
- The synchronous evaluator is discoverable through SSM `/rules/sync/evaluator-function-arn` and stack output `EvaluatorFunctionArn`.
- The Marketplace artifact is a Build-produced `CDK_CLOUD_ASSEMBLY` with a Deployer-compatible `marketplace.product.json`, uses `bundle_type="SERVICE"`, omits `base_path`, declares `dependencies=["Persist", "Lexicon"]`, and uses JWT-shaped `x-amz-meta-service-*` metadata headers.
- Starting the state machine with `input_s3_uri` pointing to a CSV or Parquet file/prefix produces `resultsS3Uri` and `aggregatedStatisticsS3Uri` with the artifact shapes in section 3.6.
- Starting the state machine without `input_s3_uri` runs Persist async Gremlin discovery, waits for completion, shards all debt identifiers through Glue, and then processes the generated `input/` prefix.
- `save_rules_reports=true` writes `parts/rules-reports/*_rules_reports.json` and returns `rulesReportsS3Uri`; `save_rules_reports=false` omits both.
- `skip_report_metrics=true` suppresses predicted and actual metric emission without changing S3 outputs.
- Invoking `EvaluateDebtFunction` with a valid `debt_identifier` returns a synchronous decision payload with `accepted`, `ruleset_id`, `ruleset_version`, `evaluated_at`, `latency_ms`, and either a filtered `result` or a rejection `reason`.
- The synchronous evaluator reuses the same ruleset loader, compiler, query builder, Persist client, and classifier semantics as batch, but does not start Step Functions, invoke Glue, or write S3 artifacts.
- Warm/provisioned-concurrency single-entity evaluations meet p95 service-side latency <= 300ms when the ruleset cache is warm and Persist `/persist/gremlin` p95 stays within the configured `SINGLE_ENTITY_PERSIST_TIMEOUT_MS` budget.
- `include_rules_report=true` on the synchronous evaluator returns debt and phone rule reports without changing classification; `include_rules_report=false` omits those audit maps.
- The default ruleset path reads `/lexicon/rulesets-uri`, selects catalog item `id="phone"`, loads all manifest rules in `order`, and compiles supported `debt` and `phone` rules into report keys.
- `rule_s3_uris` subset mode accepts one or more prefixes, each containing exactly one `.json` definition and one `.gremlin` query, and rejects empty subsets plus duplicate rule IDs or names before any Persist call.
- Rule compiler failures are fail-closed: unsupported roots, unsupported traversal shapes, parse errors, and scope mismatches stop the file/workflow before graph evaluation.
- Per-batch Persist calls are SigV4-signed to `execute-api`, use the configured deployment region, retry transient 5xx/fetch failures, and never connect directly to Neptune.
- Classification matches the current implementation: a debt passes only when all debt rules pass and at least one phone number passes all phone rules; output results include only passing phones and no rule-report maps.
- `not_loaded_to_graph_count`, `filtered_debts_count`, `filtered_phone_numbers_count`, `not_passed_rules_debts_count`, and `not_passed_rules_statistics` are correct for multi-file runs and merge deterministically into `aggregated-statistics.json`.
- CloudWatch metrics use namespace `CDM` and `Rules` dimensions for predicted cost, actual cost, suggested debts, suggested phone numbers, per-rule exclusions, and synchronous evaluator latency/count/error signals.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, the standard `createRequire` banner, structured logs, X-Ray tracing, and three-month log retention.
- IAM is scoped to the installed Persist API ARN, allowed input/ruleset S3 prefixes, the Rules output bucket, the single Glue job, and CloudWatch metric writes; broad S3 and `execute-api` wildcards from the seed implementation are removed or explicitly justified.
- `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm cdk:synth`, `just check`, `just test`, and `just cdk:synth` all pass in the target repository.
