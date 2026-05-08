# Rules Product - Product Requirements Document (PRD)

Authoritative blueprint for building the **Rules** marketplace product. It captures the batch workflow, rule contracts, graph-read behaviour, output artifacts, metrics, and infrastructure topology enforced by the current implementation in `../implementation/filter`, with the public product name normalised to **Rules**. The implementation language is **TypeScript everywhere** except Glue Python Shell preparation jobs; infrastructure is **AWS CDK only**, deployed to the installer-supplied tenant AWS region, per the Golden Path engineering standards.

---

## 1. Product Overview

### 1.1 Mission

Rules is a tenant-local batch decisioning product. It reads a population of debt identifiers, retrieves each debt's current graph facts through Persist, evaluates lexicon-backed contactability and eligibility rules, and writes the resulting callable debt and phone-number population to S3.

Rules exists to make "who can we contact right now?" a repeatable, auditable batch workflow rather than a hardcoded report. The product compiles rule definitions stored in the shared lexicon ruleset repository into Gremlin projections, runs those projections through Persist's SigV4-authenticated Gremlin API, classifies debts and phone numbers from the returned rule reports, and emits:

1. a results dataset containing only debts that passed all debt rules and at least one phone number that passed all phone rules;
2. per-file statistics and one aggregated statistics document explaining how many debts and phones were accepted or filtered out;
3. optional per-debt/per-phone rule reports for audit and debugging;
4. CloudWatch metrics for suggested call counts, phone counts, rule-failure counts, and estimated/actual run cost.

Rules is a **SERVICE** marketplace component because it deploys runtime infrastructure: Step Functions, Lambda, Glue, S3, CloudWatch Logs, and SSM outputs. It is not a DATA component and it is not a rule-authoring repository.

### 1.2 Primary user surface

Rules does **not** expose a public REST API. Its primary surface is one tenant-local **AWS Step Functions STANDARD state machine** whose ARN is published to SSM and CloudFormation outputs at deploy time.

| Surface | Identifier | Auth | Purpose |
| ------- | ---------- | ---- | ------- |
| **Batch workflow** | SSM `/rules/workflow/state-machine-arn` and stack output `StateMachineArn` | AWS IAM `states:StartExecution` | Run a rules evaluation batch over either a caller-supplied S3 population or the full Persist debt population. |
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

### 1.3 Non-goals

- Rules does **not** expose a public HTTP API or create an API Gateway base-path mapping. Callers start the workflow through AWS Step Functions/IAM.
- Rules does **not** write to Persist, Neptune, or any graph store. Persist remains the only graph-persistence product; Rules is a read-only graph consumer.
- Rules does **not** run Gremlin directly against Neptune. It calls Persist's `/persist/gremlin` and `/persist/gremlin-async` APIs with SigV4.
- Rules does **not** own the lexicon or the rule repository. It consumes rulesets from S3 via the `/lexicon/rulesets-uri` SSM parameter or explicit `rule_s3_uris`.
- Rules does **not** provide CRUD for rule definitions, rule approval, legal review, or rule publishing. Those belong to lexicon/ruleset management.
- Rules does **not** guarantee that a passed debt is legally contactable in every downstream channel forever. It produces a point-in-time batch result based on graph data and rules available at execution time.
- Rules does **not** orchestrate outbound communications. Downstream communication products consume its output; Rules never sends SMS, email, calls, or letters.
- Rules does **not** synthesise its own subdomain, ACM certificate, Usage Plan, or tenant identity. It has no public API surface.
- Rules does **not** preserve `Filter` as a public marketplace product name. Internal code may be migrated from `filter`, but product metadata, cost tags, stack outputs, SSM names, and CloudWatch dimensions must use `Rules`.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every batch run is expressed as a STANDARD Step Functions state machine with native `Choice`, `Wait`, `Map`, `Retry`, `Catch`, and service integrations. There is no Lambda-only orchestrator, chained-SQS batch driver, or in-process workflow runtime.
2. **Persist is the graph boundary.** Rules reads graph data only through Persist's SigV4-authenticated APIs. It never connects to Neptune directly, never embeds Neptune endpoints, and never bypasses Persist's read policies.
3. **Rulesets are lexicon-backed data inputs.** Rule definitions are JSON + Gremlin objects in S3. The runtime compiles supported rules at execution time; rule changes ship as ruleset data revisions, not Lambda code changes, as long as they stay within the supported semantic patterns.
4. **Batch input is S3 or Persist discovery.** A caller may provide `input_s3_uri` containing CSV/Parquet files with `debt_id`, or omit it to let Rules discover every debt identifier through Persist async Gremlin and prepare batch input through Glue.
5. **Outputs are immutable run artifacts.** Each execution writes under a unique output prefix. The workflow never mutates prior outputs and never updates graph rows based on a result.
6. **Metrics are a side effect, not the source of truth.** S3 artifacts are authoritative for run results. CloudWatch metrics are operational summaries that can be missing or delayed without changing the execution output.
7. **The canonical product identity is Rules.** Marketplace catalog metadata uses `component_id="Rules"` and `component_name="Rules"` / product name `Rules`. Lowercase `rules` is the service slug for source package names, SSM paths, S3 prefixes, tags, metrics dimensions, and internal resource names. Current implementation names like `FilterStack`, `project_name=filter`, and `serviceName=filter` are migration artifacts.

### 2.1 Stacks (AWS CDK)

The CDK app is a single tenant-local stack:

```text
bin/app.ts
└── RulesStack    # Output bucket, log group, Lambda workers, Glue Python Shell
                  # preparation job, STANDARD Step Functions workflow, SSM
                  # parameter + CloudFormation outputs
```

`RulesStack` is declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or product-supplied deploy scripts are permitted.

The deploy region is the installer-supplied tenant AWS region. `marketplace/app.ts` receives Deployer's validated `MarketplaceContext` and instantiates `RulesStack` with `env.account = context.tenant.accountId` and `env.region = context.tenant.region`. Runtime SigV4 calls use that same region for Persist execute-api signing unless the Persist API URL explicitly identifies a different region through a typed install parameter. The current implementation hardcodes `us-east-2` in `bin/app.ts` and SigV4 calls; that is a migration gap, not a target contract.

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

Rules does not own a general-purpose input bucket. The workflow reads caller-supplied `s3://...` input files/prefixes and lexicon ruleset objects from S3. Install-time IAM must therefore grant the Rules runtime read access only to the tenant buckets/prefixes it is allowed to process and to the lexicon ruleset bucket. The current implementation grants broad S3 read access; the target product should scope this through deployment parameters or an explicit tenant-managed bucket policy.

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
| `StateMachineArn` | `RulesStateMachine` ARN | CloudFormation output for deployment automation. |
| `OutputBucketName` | `RulesOutputBucket` name | CloudFormation output for operators and downstream readers. |

During migration from the current `filter` implementation, the stack may also publish `filter-workflow-state-machine-arn` as an alias. That alias is not part of the long-term product contract.

### 2.3 IAM (high-level)

- The workflow role can invoke only the Rules worker Lambdas, start/read the single Glue preparation job, and write X-Ray traces.
- Worker roles are split by capability. `ProcessFileFunction` reads allowed input/ruleset S3 prefixes, writes only to `RulesOutputBucket`, reads `persist-api-url` and `/lexicon/rulesets-uri`, and invokes only the configured Persist execute-api ARN. `ReportMetricsFunction` reads only Rules outputs and writes CloudWatch metric data. `SubmitAsyncQueryFunction` and `PollQueryStatusFunction` read only `persist-api-url` and invoke Persist.
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
| `allowedRulesetS3Prefixes` | required for production installs unless covered by the lexicon bucket policy | S3 prefixes that Rules may read for lexicon ruleset catalog and explicit `rule_s3_uris`. |
| `outputRetentionDays` | optional | Lifecycle policy for run outputs; omitted means retain by default. |
| `batchSize` / `maxConcurrency` / `maxRetries` | optional | Install-time defaults for the runtime env vars `BATCH_SIZE`, `MAX_CONCURRENCY`, and `MAX_RETRIES`. |

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

### 3.2 Lexicon ruleset catalog

When `rule_s3_uris` is omitted, Rules reads the ruleset catalog from `s3://<bucket>/<prefix>/index.json`, where the bucket/prefix comes from SSM `/lexicon/rulesets-uri`.

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
    }
  ]
}
```

Rules currently selects the catalog item whose `id` is `phone`.

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
- Unsupported input file types fail the worker.
- Empty explicit `rule_s3_uris` fails before graph reads.
- Duplicate explicit rule IDs or rule names fail before graph reads.
- Ruleset catalogs without an item `id="phone"` fail before graph reads.
- A rule whose Gremlin query cannot be parsed into the supported compiler subset fails before graph reads.
- Persist non-2xx responses fail the affected batch after bounded retries.
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

### 4.4 Cost model

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
  "description": "Tenant-local batch rules evaluation product for contactability and eligibility decisions"
}
```

`component_id="Rules"` is the Marketplace-distributed component identity. Lowercase `rules` is only the implementation slug used for package names, tags, SSM paths, S3 prefixes, metrics dimensions, and internal resource names.

The source bundle follows the Deployer product contract. It is an immutable source zip with the Deployer-required layout (`marketplace.product.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `marketplace/app.ts`, `lib/`, runtime source/assets), and `marketplace/app.ts` exports `createMarketplaceApp`.

`marketplace.product.json` is declarative only:

```jsonc
{
  "component_id": "Rules",
  "component_name": "Rules",
  "bundle_type": "SERVICE",
  "entrypoint": "marketplace/app.ts",
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
- No product-supplied shell deploy command is used; Deployer owns synth, asset publishing, and CloudFormation deployment.
- The manifest must not contain `synth_command`, `deploy_command`, `post_deploy_command`, package-script hooks, or any deploy-engine selector.
- Stack resources carry cost tags `sc:service:name=rules` and `sc:product:name=Rules`.

The Marketplace bundle upload contract for Rules is:

```jsonc
{
  "description": "Rules service source snapshot",
  "bundle_url": "https://<presigned-source-zip>",
  "dependencies": ["Persist"],
  "deploy_time_dependencies": []
}
```

`Persist` is a runtime dependency because Rules reads graph data exclusively through Persist. If the lexicon/ruleset catalog is represented in the target Marketplace ontology as its own DATA component, that exact component id must also be listed in `dependencies`; otherwise ruleset access is treated as tenant configuration through `/lexicon/rulesets-uri`.

The publication artifact must satisfy Marketplace's bundle validation gates:

- `bundle_url` is HTTPS, reachable by `HEAD`, and has `Content-Length <= MAX_BUNDLE_BYTES`.
- Bundle metadata is carried in JWT-shaped `x-amz-meta-service-*` headers, not raw JSON metadata headers.
- `service-builder.bundle_type` is `SERVICE` and matches the Marketplace component type.
- `service-builder.component_id` / `service-marketplace.component_id`, when present, identify `Rules`.
- The source snapshot contains no legacy `config.json`, `artifacts/<module>/update.json`, product-supplied command strings, or product-owned deploy scripts.

### 5.2 Install-time prerequisites

Rules requires:

- Persist deployed in the same tenant and publishing `persist-api-url`.
- SSM `/lexicon/rulesets-uri` pointing at a readable S3 ruleset catalog.
- IAM permissions for Rules to invoke Persist's `/persist/gremlin` and `/persist/gremlin-async` APIs.
- IAM/S3 grants for allowed input prefixes and the lexicon ruleset prefix.
- AWS Glue service role permissions for the preparation job.
- CDK bootstrap in the target tenant region for Lambda assets and Glue script assets.
- Deployer `custom_parameters` matching section 2.4 so the stack can scope S3 and Persist IAM without broad wildcard grants.

### 5.3 Outputs consumed by downstream products

Downstream products should consume Rules through S3 output URIs, not through internal Lambda logs or CloudWatch metrics. The stable artifacts are:

- `resultsS3Uri` for accepted debt and phone candidates;
- `aggregatedStatisticsS3Uri` for run-level counts and failure reasons;
- `rulesReportsS3Uri` when audit mode is enabled.

If a downstream communication product needs a durable handoff, it should store the workflow execution ARN plus these output URIs in its own activity record. Rules does not own downstream activity lifecycle state.

---

## 6. Testing & Verification

### 6.1 Unit tests

The target repository uses Vitest. Current coverage in `../implementation/filter` includes:

- `test/filter-stack.test.ts` - state machine branching for provided input, full graph discovery, rule reports, and rule subset propagation.
- `test/handler-process-file.test.ts` - per-file classification, explicit rule subset loading, output payload shape, optional rules reports, and no-phone edge cases.
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

Integration verification requires a deployed tenant environment with Persist and lexicon rulesets available.

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

### 6.3 Operational runbook

Common checks:

1. Confirm the workflow ARN exists at `/rules/workflow/state-machine-arn`.
2. Confirm `persist-api-url` and `/lexicon/rulesets-uri` exist and point at reachable resources.
3. Confirm no executions are stuck `RUNNING` past six hours: `aws stepfunctions list-executions --status-filter RUNNING`.
4. For failed executions, inspect the Step Functions failed state first, then the corresponding Lambda log stream in `RulesLogGroup`.
5. For low output counts, inspect `aggregated-statistics.json` before CloudWatch metrics; the S3 artifact is authoritative.
6. For rule compiler failures, validate the offending rule starts from the canonical debt root and has a supported debt/phone traversal shape.
7. For Persist throttling or transient 5xx, tune `BATCH_SIZE`, `MAX_CONCURRENCY`, and `MAX_RETRIES` conservatively before increasing `ProcessAllFiles` map concurrency.

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
- align the `just` recipes with the shared target-service command contract;
- ensure generated marketplace bundle metadata declares `component_id="Rules"`, `component_name="Rules"`, `bundle_type="SERVICE"`, and dependency metadata for Persist.

---

## 8. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier, Vitest, `justfile`, and shared CI caller workflows. Package identity is `@soc/rules` or the marketplace-equivalent internal package name.
2. **Runtime dependencies**: AWS Lambda Powertools logger/tracer/parameters, AWS SDK clients for S3, SSM, CloudWatch, Smithy SigV4 signing helpers, `csv-parse`, `hyparquet`, `web-tree-sitter`, and `tree-sitter-groovy`. CDK dependencies are `aws-cdk-lib`, `constructs`, `aws-cdk`, and the Glue alpha construct while the product uses Python Shell jobs.
3. **Contracts**: implement the workflow input, Step Functions intermediate payloads, `DebtResult`, `PhoneNumber`, output artifact payloads, statistics payloads, ruleset catalog, ruleset manifest, rule definition, and explicit-rule-prefix contracts from section 3.
4. **S3 input module**: parse `s3://` URIs, distinguish file vs prefix inputs, list only `.csv` and `.parquet` objects, and extract non-empty `debt_id` values from both formats.
5. **Ruleset loader**: read `/lexicon/rulesets-uri`, load `index.json`, select ruleset `id="phone"`, load the manifest, sort rules by `order`, fetch each JSON definition and `.gremlin` query, and support `rule_s3_uris` subset mode with duplicate detection.
6. **Gremlin parser/compiler**: parse rule traversals with tree-sitter, enforce the canonical debt root, infer `debt` vs `phone` scope, skip `metadata` rules, rewrite supported phone-entry patterns, reject scope mismatches, and emit deterministic `project(...).by(...)` fragments keyed by rule name.
7. **Query builder**: reproduce the canonical debt projection and phone projection, inject debt and phone rule-report blocks, support single-id and `within(...)` batch clauses, and replace date placeholders for today, seven days ago, and weekday.
8. **Persist client**: resolve `persist-api-url` once per warm container, SigV4-sign `execute-api` requests, call `/persist/gremlin-async`, `/persist/gremlin-async/{requestId}`, and `/persist/gremlin`, and bound per-batch retries/concurrency by `MAX_RETRIES` and `MAX_CONCURRENCY`.
9. **Worker handlers**: implement `ListFiles`, `SubmitAsyncQuery`, `PollQueryStatus`, `ProcessFile`, `AggregateStatistics`, `ReportPredictedCost`, and `ReportMetrics` with small injectable services where practical so tests can supply S3, SSM, Persist, and CloudWatch doubles.
10. **Glue preparation job**: implement `rules-prepare-input` as the only Python workload, reading Persist async Gremlin result JSON and writing `debt_id` CSV shards of 50,000 rows under `<outputPrefix>/input/`.
11. **Marketplace entrypoint**: implement `marketplace/app.ts` and `marketplace.product.json` with `component_id="Rules"`, `component_name="Rules"`, `bundle_type="SERVICE"`, `entrypoint="marketplace/app.ts"`, `stacks=["RulesStack"]`, and no `base_path`. The entrypoint must instantiate `RulesStack` from `MarketplaceContext.tenant` and validate the custom-parameter schema in section 2.4.
12. **CDK stack**: create `RulesStack` with the output bucket, shared log group, seven Node.js 24 ARM64 Lambdas, the Glue Python Shell job, the STANDARD state machine in section 2.2.4, least-privilege IAM, SSM `/rules/workflow/state-machine-arn`, and stack outputs.
13. **Operational metadata**: tag resources with `sc:service:name=rules` and `sc:product:name=Rules`; make `Rules` the Powertools service prefix and CloudWatch metric dimension value.
14. **Tests**: port and expand the current Vitest coverage for stack wiring, handlers, ruleset loading, rule compiler semantics, query builder output, parser behavior, S3 input parsing, statistics aggregation, and the Filter-to-Rules migration aliases.
15. **Integration smoke**: deploy into a tenant with Persist and lexicon rulesets, run both input modes, verify S3 artifacts and metrics, and document the exact operator commands.

---

## 9. Acceptance Criteria

A re-implementation is considered functionally complete when:

- The product is discoverable as **Rules** with Marketplace `component_id="Rules"` / `component_name="Rules"`, implementation slug `rules`, stack `RulesStack`, state machine `RulesStateMachine`, output prefix `rules/...`, and SSM `/rules/workflow/state-machine-arn`.
- The Marketplace source bundle contains a Deployer-compatible `marketplace.product.json`, uses `bundle_type="SERVICE"`, omits `base_path`, declares `dependencies=["Persist"]` plus any catalog-mode lexicon/ruleset DATA component, and uses JWT-shaped `x-amz-meta-service-*` metadata headers.
- Starting the state machine with `input_s3_uri` pointing to a CSV or Parquet file/prefix produces `resultsS3Uri` and `aggregatedStatisticsS3Uri` with the artifact shapes in section 3.6.
- Starting the state machine without `input_s3_uri` runs Persist async Gremlin discovery, waits for completion, shards all debt identifiers through Glue, and then processes the generated `input/` prefix.
- `save_rules_reports=true` writes `parts/rules-reports/*_rules_reports.json` and returns `rulesReportsS3Uri`; `save_rules_reports=false` omits both.
- `skip_report_metrics=true` suppresses predicted and actual metric emission without changing S3 outputs.
- The default ruleset path reads `/lexicon/rulesets-uri`, selects catalog item `id="phone"`, loads all manifest rules in `order`, and compiles supported `debt` and `phone` rules into report keys.
- `rule_s3_uris` subset mode accepts one or more prefixes, each containing exactly one `.json` definition and one `.gremlin` query, and rejects empty subsets plus duplicate rule IDs or names before any Persist call.
- Rule compiler failures are fail-closed: unsupported roots, unsupported traversal shapes, parse errors, and scope mismatches stop the file/workflow before graph evaluation.
- Per-batch Persist calls are SigV4-signed to `execute-api`, use the configured deployment region, retry transient 5xx/fetch failures, and never connect directly to Neptune.
- Classification matches the current implementation: a debt passes only when all debt rules pass and at least one phone number passes all phone rules; output results include only passing phones and no rule-report maps.
- `not_loaded_to_graph_count`, `filtered_debts_count`, `filtered_phone_numbers_count`, `not_passed_rules_debts_count`, and `not_passed_rules_statistics` are correct for multi-file runs and merge deterministically into `aggregated-statistics.json`.
- CloudWatch metrics use namespace `CDM` and `Rules` dimensions for predicted cost, actual cost, suggested debts, suggested phone numbers, and per-rule exclusions.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, the standard `createRequire` banner, structured logs, X-Ray tracing, and three-month log retention.
- IAM is scoped to the installed Persist API ARN, allowed input/ruleset S3 prefixes, the Rules output bucket, the single Glue job, and CloudWatch metric writes; broad S3 and `execute-api` wildcards from the seed implementation are removed or explicitly justified.
- `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm cdk:synth`, `just check`, `just test`, and `just cdk:synth` all pass in the target repository.
