# Deployer Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Deployer** service. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to the installer-supplied home AWS region, per the SOCAPITAL Golden Path engineering standards. The current production code at `staircase/deploy` is a Python 3.9 + Serverless Framework implementation; this PRD specifies the equivalent target service in canonical SOCAPITAL form.

---

## 1. Product Overview

### 1.1 Mission

Deployer is the marketplace ecosystem's **infrastructure-deployment product**. It is the single component in the platform that actually executes CloudFormation, and it does so **only against the AWS account it is itself running in**. It accepts a presigned `artifacts_url` to a packaged bundle, drives the per-module CloudFormation create/update/rollback/delete loop inside its own account through a single STANDARD AWS Step Functions state machine, and reports terminal status back to the originating caller (Marketplace, in normal operation) over a one-shot HTTPS `callback_url`.

Because the Deployer is local-account-only, it MUST be installed once per tenant environment — before the other marketplace products (Marketplace Puller, Persist, Connect, …) that the tenant subscribes to. The initial install is performed by the operator-run bootstrap CLI, not by Account or Marketplace: the CLI uses the tenant owner's API key to discover the latest Deployer bundle from Marketplace, then uses the operator's AWS profile/SSO credentials to deploy that bundle's CDK/CloudFormation modules into the newly provisioned tenant account. After Deployer is live, every subsequent product install goes through `https://<tenant-subdomain>/infra-deployer/deploy-by-token`; Marketplace never multiplexes one Deployer across accounts.

A **bundle** is the unit of distribution — a zip whose `config.json` declares one or more **modules** (each a CloudFormation stack with its own `update.json` template + sibling artifacts), an optional `docker_images[]` block (one Dockerfile per ECR destination), and a `bundle_type` (`SERVICE | DATA | FRONTEND | FRONTEND_CONFIG | CHAT`). Deployer treats every bundle as a deployment unit, partitions it per configured region (see §2.5 — `Regions` parameter), and produces one CloudFormation stack per `(module, region)` pair.

The runtime is **callback-driven**: every long-running CloudFormation operation suspends a Step Functions task with `WAIT_FOR_TASK_TOKEN`. CloudFormation stack events stream into an SNS topic in the same account and **the same AWS region as the target stack**; an SNS-subscribed regional relay matches each event to a persisted task token and calls `SendTaskSuccess` / `SendTaskFailure` against the home-region state machine. The Deployer never busy-waits CloudFormation.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<subdomain>/infra-deployer/`, API-key authorised (`x-api-key` per usage plan), with the capability groups below (full mapping in §3 and §4):

| Group                            | Routes                                                                                                                                  | Purpose                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Bundle deploy**                | `POST /deploy-by-token`, `POST /deploy-data-by-token`, `POST /deployments`                                                              | Start a service / data bundle deployment (single-stack or multi-stack, single-region or multi-region)  |
| **Bundle status**                | `GET /deploy/{bundle_id}`, `GET /deploy-data/{bundle_id}`, `GET /deployments/{bundle_id}`                                               | Poll terminal/in-flight bundle status with logs and per-stack details                                  |
| **Deployment logs**              | `GET /deployments/logs/{response_collection_id}?product_api_identifier=…`                                                               | Fetch buffered debug-log records for a past deployment (dual-key authoriser)                           |
| **Internal — service info**      | `GET /information`                                                                                                                      | Static service metadata (API Gateway `MOCK` integration, no API key)                                   |

Every mutating route is API-key-gated (`apiKeyRequired: true`) plus CORS preflight; the only exceptions are `GET /information` (mock) and `GET /deployments/logs/{response_collection_id}` (which authenticates via a Lambda authoriser that accepts **either** the canonical service API key **or** a separate `Health` API key, see §2.3.6).

Every successful POST that mints work returns `200` with `{ bundle_id, deploy_id, transaction_id }`. `bundle_id` is server-supplied if the caller did not provide one (a UUID) and is the canonical identifier for the entire deployment from then on. `deploy_id` equals `bundle_id` for Lambda-driven deploys and equals the CodeBuild build ID for CodeBuild-driven deploys (see §3.4). Callers that miss or delay the terminal `callback_url` delivery MUST reconcile through `GET /deploy/{bundle_id}` / `GET /deployments/{bundle_id}` instead of applying their own deployment-duration timeout; the Deployer status endpoint is authoritative for accepted work.

### 1.3 Non-goals

- Deployer does **not** deploy into any AWS account other than its own. There is no cross-account assume-role, no encrypted credential token, no multi-tenant fan-out. To deploy into another account, install another Deployer there.
- Deployer does **not** mint, host, or sign the artifact bundle. It consumes a caller-supplied presigned `artifacts_url` (matching the `PRESIGNED_S3_URL_PATTERN` regex), validates it with a streaming `GET` to read `Content-Length`, and downloads the contents into ephemeral storage on the worker.
- Deployer does **not** own the marketplace catalog, ontology, or subscription model. That belongs to the **Marketplace** service, which is the canonical caller of `/deploy-by-token`.
- Deployer does **not** synthesise its own subdomain or ACM certificates. The `Subdomain` parameter is provided by the upstream installer (Marketplace + the marketplace-account product).
- Deployer does **not** invent its own auth identity. API keys are minted upstream and bound to API Gateway usage plans by the installer (see §2.3.5 — `ApiUsagePlanCustom`).
- Deployer does **not** open raw outbound SSH or run a build container in-process. Container builds and pushes always go through **AWS CodeBuild** (`aws-sdk:codebuild:startBuild.waitForTaskToken`).
- Deployer does **not** persist artifact bundles long-term. The build-output bucket has a 14-day expiry; per-bundle templates are uploaded to a Deployer-managed `deploy-code-<uuid>` bucket inside its own account (created on first deploy via SSM `/deploy/automatic/code-bucket-name` and reused thereafter).
- Deployer does **not** perform code review / static analysis. That belongs to the **Comply** service upstream.
- Deployer does **not** bootstrap itself from its own API. The only supported self-install path is the bootstrap CLI's local deploy mode, which is constrained to the Deployer system component and uses the same bundle validation, parameter rendering, tagging, and CloudFormation execution semantics as a normal product deploy.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every bundle deploy compiles to a single STANDARD `DeployArtifact` state machine. Worker-size dispatch (`SMALL | MEDIUM | LARGE`), per-region fan-out, per-module stack-status loops, change-set execution, rollback continuation, docker-image pre/post stages, and post-success/failure reconciliation are expressed exclusively as ASL primitives (`Choice`, `Map`, `Wait`, `Retry`, `Catch`, `WAIT_FOR_TASK_TOKEN`). There is no second workflow runtime, no in-Lambda step orchestrator, no SQS-chained worker fan-out.
2. **CloudFormation status is callback-driven, not polled.** Each `CreateStack` / `UpdateStack` task is invoked with `arn:aws:states:::lambda:invoke.waitForTaskToken`; the worker calls `cloudformation:CreateStack|UpdateStack` in the target region with `NotificationARNs=[<regional DeploymentNotificationTopic ARN>]` and persists the task token on the stack-deployment row. CloudFormation stack events arrive via the same-region SNS topic to `RegionalDeploymentEventRelay`, which resolves the task token from the home-region DynamoDB tables and calls `states:SendTaskSuccess` / `states:SendTaskFailure` on the home-region state machine. The state machine resumes only when CloudFormation reaches a terminal status. The only places that explicitly wait are `Wait 60s` loops between `GetStackStatus` polls for transient `*_IN_PROGRESS` states.
3. **Same-account deployment, no credential-token plumbing.** Every CloudFormation, S3, IAM, KMS, Lambda, ECR, and CodeBuild action targets the Deployer's **own** account (the one its Lambdas execute in) using the worker's own IAM role. There is no `environment_token`, no Fernet decrypt, no `STS:AssumeRole`, and no cross-account session factory. Per-environment configuration (`Subdomain`, `Regions`, default CFN parameter overrides) is sourced from CFN install-time parameters and SSM at cold start; account domain metadata is fetched from Account and passed into each service stack as standardized CloudFormation parameters. Per-call CFN parameter overrides come from the request body's `custom_parameters` field (§3.5). To deploy into a different AWS account, install another Deployer in that account.
4. **AWS-native Step Functions integrations beat custom code.** `aws-sdk:codebuild:startBuild.waitForTaskToken` for Docker image pre/post processing; `lambda:invoke.waitForTaskToken` for create/update stack; plain `lambda:invoke` for status / review / rollback / delete / pre-deployment / post-deployment. Custom Lambdas exist only for business logic that cannot be expressed natively.
5. **Worker right-sizing is explicit.** Pre-deployment worker memory/disk cohorts are `SMALL = 384 MB`, `MEDIUM = 1024 MB + 1024 MB ephemeral`, `LARGE = 5120 MB + 9216 MB ephemeral`, dispatched by `Choice` on `worker_size` derived from `Content-Length(artifacts_url) * 3`. Bundles whose `Content-Length * 3 > 3 GB` (or whose caller passed `legacy_deploy: true`) fall back to **CodeBuild**; everything else uses Lambda.

### 2.1 Stacks (AWS CDK)

The CDK app is composed of three stacks deployed in order:

```
bin/app.ts
├── DataStack                         # Home-region KMS CMK, S3 buckets,
│                                     # four DynamoDB tables
├── WorkflowStack                     # Home-region DeployArtifact STANDARD state
│                                     # machine, CodeBuild projects, runtime roles
├── DeployerStack                     # Home-region Lambdas, REST API + IAM
│                                     # authorisers, API Gateway custom resources,
│                                     # /information mock, clean-lambda-version schedule
└── RegionalNotificationStack[region] # One stack per configured deployment region:
                                      # same-region SNS topic + relay Lambda
```

`DeployerStack.addDependency(workflowStack); workflowStack.addDependency(dataStack)` ensures storage deploys first, then orchestration, then routing. Every `RegionalNotificationStack[region]` depends on `WorkflowStack` so its relay can target the home-region state machine and tables. All stacks are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per `cloud-aws-primary`).

### 2.2 DataStack contents

#### 2.2.1 KMS

- **`DataKey`** — symmetric customer-managed key (alias `alias/CodeDeployerDbCollections`) used to encrypt every DynamoDB table. Key policy grants the account root `kms:*`, the Lambda runtime role `kms:Encrypt|Decrypt|ReEncrypt*|GenerateDataKey*|DescribeKey` on `*`, plus `kms:CreateGrant|ListGrants|RevokeGrant` constrained by `kms:GrantIsForAWSResource=true`.

#### 2.2.2 Storage

| Bucket                  | Encryption / ACL                                                                                                              | Lifecycle               | Purpose                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ArtifactsBucket`       | S3-managed AES-256 encryption, `BLOCK_ALL` public access, SSL-only via bucket policy with `aws:SecureTransport=false` deny    | `ExpirationInDays: 14`  | CodeBuild build artifacts under `build_artifacts/<build_id>/{deploy_output.json,artifacts.zip,…}`                              |
| `CodeBuildSourceBucket` | S3-managed AES-256 encryption, `BLOCK_ALL` public access, SSL-only `ListBucket` deny                                          | —                       | Zipped CodeBuild sources for the two CodeBuild projects (Docker bundle and Docker-only). Re-uploaded on deploy.                 |

The `ArtifactsBucket` policy explicitly grants the Deployer's runtime role `s3:GetBucketLocation|ListBucket|ListBucketMultipartUploads|GetObject|GetObjectTagging|ListMultipartUploadParts` so the API can presign `artifact_url`s in the status response.

> **Note on the per-deploy bucket.** The actual CloudFormation deploy uploads templates and module artifacts to a `deploy-code-<uuid>` bucket in **this same account** (created on first deploy via SSM parameter `/deploy/automatic/code-bucket-name` and reused thereafter). The bucket is **not** declared in `DataStack` — it is provisioned at runtime by `PreDeploymentWorker` using the worker's own role. Per-region replicas (one bucket per region listed in `Regions`) are created on demand on the first deploy that touches that region.

#### 2.2.3 DynamoDB

All tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled. Three of the four enable TTL on `expire_at`.

| Table                              | Keys                                  | Indexes | TTL          | Purpose                                                                                                                 |
| ---------------------------------- | ------------------------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `DeploymentStatusTable`            | `bundle_id` (S), `stack_id` (S)        | —       | `expire_at`  | Per-stack deployment status row; `stack_id="root"` is the bundle-level row carrying the `task_token` for SNS callbacks |
| `StackBundleMapTable`              | `stack_id` (S)                         | —       | `expire_at`  | Reverse index from CloudFormation stack ARN → `bundle_id` (used by the regional SNS relay)                             |
| `DeploymentLogsTable`              | `response_collection_id` (S), `product_api_identifier` (S) | — | `expire_at`  | Buffered debug log records (`stack_trace`, `error`) keyed by `(bundle_id, product_api_identifier)`                     |
| `LegacyDeployerTable`              | `bundle_id` (S), `code_build_id` (S)   | —       | —            | Legacy CodeBuild-only deploy index (read-only fallback for `legacy_deploy_status`); writes are gated by `legacy_deploy=true` |

Default TTL for transient rows is **30 days** from creation (`get_ttl()`). Item shapes mirror §6.

#### 2.2.4 Regional CloudFormation notification fabric

- **`RegionalNotificationStack[region]`** — deployed once for every region listed in `Regions` (including the home region). It creates a same-region `DeploymentNotificationTopic` and a `RegionalDeploymentEventRelay` Lambda.
  - Topic name: `DeploymentNotification`.
  - CloudFormation `CreateStack` / `UpdateStack` calls MUST select the topic ARN whose region equals the target stack region. A cross-region SNS ARN is never valid in `NotificationARNs`.
  - **Topic policy** is account-local: only `cloudformation.amazonaws.com` from this account is allowed `sns:Publish`. There is no cross-account / org-wide grant.
  - The relay Lambda runs in the notification region, parses the stack event, then uses SDK clients configured for the Deployer home region to read/write `DeploymentStatusTable` + `StackBundleMapTable` and call `states:SendTaskSuccess` / `states:SendTaskFailure`.

### 2.3 WorkflowStack contents

#### 2.3.1 IAM roles

- **`StateMachineRole`** — assumed by `states.amazonaws.com`, holds `lambda:InvokeFunction`, `cloudformation:*`, `codebuild:*` (scoped to the two project ARNs), and `events:*` on `*`.
- **`CodeBuildRole`** — assumed by `codebuild.amazonaws.com`, holds `logs:*`, `cloudformation:*`, `s3:*`, `dynamodb:*`, `cloudfront:*`, `kms:*`, `lambda:InvokeFunction`, `apigateway:*`, `states:SendTaskSuccess`, `states:SendTaskFailure` on `*`. Used by both CodeBuild projects.
- **`CloudformationExecRole`** — assumed by `cloudformation.amazonaws.com` with `Action: "*"` / `Resource: "*"`. Lives in this stack (the Deployer's own account, which is also the deployment target) and is `iam:PassRole`-passed to CloudFormation by every `CreateStack` / `UpdateStack` call. Declared statically in CDK; never created at runtime.
- **`CloudWatchRole`** — API Gateway → CloudWatch Logs role.

#### 2.3.2 CodeBuild projects

| Project                          | Image                                | Privileged | Source bucket / key                                              | Purpose                                                                        |
| -------------------------------- | ------------------------------------ | ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `devops-deployer-dev`            | `aws/codebuild/standard:4.0`         | `true`     | `CodeBuildSourceBucket / DockerBuildArtifact.zip`                | Legacy single-shot deploy worker (used when bundle exceeds Lambda LARGE budget or `legacy_deploy=true`) |
| `devops-docker-deployer-dev`     | `aws/codebuild/standard:7.0`         | `true`     | `CodeBuildSourceBucket / DockerOnlyBuildArtifact.zip`            | Docker pre-deploy / post-deploy step inside the Lambda flow                    |

Both projects target `S3` artifacts at `arn:aws:s3:::ArtifactsBucket/build_artifacts/<BUILD_ID>/`, `TimeoutInMinutes: 120`, ARM64 not required (CodeBuild is x86-64 here).

#### 2.3.3 Step Functions: `DeployArtifact`

A STANDARD state machine, X-Ray tracing enabled, no execution-history output (`noOutput: true`). High-level shape:

```
WorkerSizeCheck (Choice on $.worker_size)
  ├── SMALL   → PreDeploymentSmall
  ├── MEDIUM  → PreDeploymentMedium
  └── LARGE   → PreDeploymentLarge   (default)
         ↓
DockerPreDeployCheck (Choice on $.docker_image_exist)
  ├── true    → PrepareDockerImages (codebuild:startBuild.waitForTaskToken, devops-docker-deployer-dev, STEP=PRE_DEPLOY)
  └── otherwise → LambdaWorkerParallelismCheck
         ↓
LambdaWorkerParallelismCheck (Choice on $.parallel_module_deployment)
  ├── true  → ParallelDeploymentWithLambda  (Map over $.all_regions_details, then Map over $.modules)
  └── false → SequentialDeploymentWithLambda (Map over $.prepared_modules with MaxConcurrency=1)
         ↓ (per item)
GetStackStatus  → StackStatusCheck (Choice)
                    ├── stack_exist=false ∧ stack_status=null            → CreateStack (lambda:invoke.waitForTaskToken, 1200s)
                    ├── stack_exist=true ∧ status ∈ {DELETE_FAILED, ROLLBACK_COMPLETE, ROLLBACK_FAILED}
                                                                          → DeleteStack → GetStackStatus
                    ├── stack_exist=true ∧ status = UPDATE_ROLLBACK_FAILED
                                                                          → RollbackContinue → GetStackStatus
                    ├── stack_exist=true ∧ status ∈ {*_IN_PROGRESS, IMPORT_*_IN_PROGRESS, UPDATE_COMPLETE_CLEANUP_IN_PROGRESS, UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS}
                                                                          → Wait 60s → GetStackStatus
                    ├── stack_exist=true ∧ status = REVIEW_IN_PROGRESS    → ReviewChanges → GetStackStatus
                    └── default                                            → UpdateStack (lambda:invoke.waitForTaskToken, 1200s)

         ↓ (catch on Map)  ModuleDeploymentException → PostFailedDeployment → BundleDeploymentFail
         ↓
DockerPostDeployChoice (Choice on $.docker_image_exist)
  ├── true    → PostDeploymentWithDocker (codebuild:startBuild.waitForTaskToken, STEP=POST_DEPLOY)
  └── otherwise → PostSuccessfulDeployment (lambda) → BundleDeploymentSuccess
                  └── catch PostDeploymentFailure   → BundleDeploymentFail
```

Per-task standards:

- `Lambda.ServiceException | Lambda.AWSLambdaException | Lambda.SdkClientException | Lambda.TooManyRequestsException | Lambda.Unknown` retry: `IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`.
- `AWSTooManyRequestsException | AWSServiceException | AWSServiceUnavailableException | AWSThrottlingException | AWSGeneralServiceException` retry: `IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`.
- `DeploymentInProgressError` catch on `CreateStack` / `UpdateStack` / `DeleteStack` / `RollbackContinue` / `ReviewChanges` → `Next: GetStackStatus` (re-poll).
- `StackAlreadyExistsException` catch on `CreateStack` → `Next: GetStackStatus` (transition to update path).
- `States.ALL` catch at the Map level → `PostFailedDeployment`.

Total state machine timeout is unbounded; per-task timeouts are: pre-deployment 600 s, create/update 1200 s, delete 600 s, rollback-continue 600 s, get-stack-status 30 s, review-changes 300 s, post-success 600 s, post-failed 60 s, codebuild docker steps 1200 s.

The state machine is published to SSM at `/deployer/state-machine/deploy-artifact-arn` so the API handler does not depend on CloudFormation `Ref`.

### 2.4 DeployerStack contents

#### 2.4.1 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so any CommonJS dependency (e.g. `aws-cloudformation-resource-parser`) can satisfy dynamic built-in `require`s. Logging is JSON via `@aws-lambda-powertools/logger` with three-month CloudWatch log-group retention (`logRetentionInDays: 90` per `cloud-aws-primary`; the legacy Python implementation keeps `logRetentionInDays: 1` and that override must NOT survive into the new build).

Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with `POWERTOOLS_SERVICE_NAME=deployer-*`, `POWERTOOLS_LOG_LEVEL=INFO`, `POWERTOOLS_METRICS_NAMESPACE=deployer`. Every handler stamps a `PRODUCT_API_IDENTIFIER` env var (a fixed UUID per handler) into outgoing health-metric payloads (see §7.4).

There are five cohorts:

| Cohort                   | Functions                                                                                                                                                    | Memory             | Timeout | VPC | Trigger                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Public API**           | `DeployByTokenHandler`, `DeployStatusHandler`, `DeploymentLogsHandler`, `HealthApiKeyAuthorizer`                                                              | 128–256 MB         | 30 s    | —   | API Gateway REST API (`DeploymentLogsHandler` via Lambda authorizer; others via API key)                                             |
| **State machine workers**| `PreDeploymentWorkerSmall/Medium/Large` (one binary, three deployments), `CreateStackWorker`, `UpdateStackWorker`, `DeleteStackWorker`, `RollbackContinueStackWorker`, `ReviewChangesWorker`, `GetStackStatusWorker`, `PostSuccessDeploymentWorker`, `PostFailedDeploymentWorker` | 128 MB / 384 / 1024 / 5120 MB | 30–600 s | — | Step Functions task                                                                                                                  |
| **CFN event relay**      | `RegionalDeploymentEventRelay` (one deployment in each configured region)                                                                                     | 128 MB             | 30 s    | —   | Regional SNS `DeploymentNotificationTopic`                                                                                           |
| **Operational helpers**  | `CleanLambdaVersion` (cron @ 12 h)                                                                                                                            | 256 MB             | 400 s   | —   | EventBridge schedule; also fire-and-forget invoked by `PreDeploymentWorker` before each deploy                                       |
| **Custom resources**     | `ApiGatewayLogCustomResource`, `ApiUsagePlanCustomResource`, `CodeBuildSourceLambda`, `DeploymentQuotaLambda`                                                | 128–256 MB         | 30 s    | —   | CloudFormation custom resources                                                                                                      |

Per-handler `PRODUCT_API_IDENTIFIER` UUIDs are stable and well-known so the upstream **Health** service can correlate metrics to the responsible Deployer code path. The PRD does not enumerate them; the implementation MUST keep them stable across releases (changing one is a breaking observability change).

#### 2.4.2 Routing fabric

- **REST API** (`RestApi` `DeployerApi`) with default stage `${stage}` (default `dev`), regional endpoint type, CORS pre-flight for `*`, dedicated access log group, and `DisableExecuteApiEndpoint: true` (the API is reachable only via the deployer-supplied custom domain). Routes:
  - `POST /deploy-by-token` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `POST /deploy-data-by-token` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `POST /deployments` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `GET /deploy/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deploy-data/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deployments/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deployments/logs/{response_collection_id}` → `LambdaIntegration(DeploymentLogsHandler)` with **token-based Lambda authoriser** `HealthApiKeyAuthorizer` (`identitySource = "method.request.header.x-api-key"`).
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON.
  - `GatewayResponse` rules normalise `INVALID_API_KEY` (`"API key is not valid"`), `DEFAULT_4XX` (`"Request has been declined."`), and `DEFAULT_5XX` per §3.1, all with `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` and `*` CORS.
- **API Gateway custom domain mapping** under base path `infra-deployer` against the deployer-supplied `Subdomain` (`AWS::ApiGatewayV2::ApiMapping`).
- **API Gateway custom resources** (CFN `Custom::*` types):
  - `ApiUsagePlanCustom` — binds the deployer-supplied `ServiceApiKeyID` to a usage plan named after the `Subdomain` and attaches the API stage. Idempotent on `ConflictException`. Re-runs on stack update via the `Nonce: ServiceInfo` property.
  - `ApiGatewayLogCustom` — wires the API Gateway access log group, enabling `apiGateway: true` tracing-style logs at the stage level.
  - `CodeBuildArtifactLambda` (×2) — zips the runtime bundle of each CodeBuild project's source tree (`src/codebuild_docker_only` plus the legacy `src/scripts`) and uploads to `CodeBuildSourceBucket` keyed on `${self:custom.CODE_BUILD_*_ARTIFACT_KEY}` so every CDK deploy refreshes the source.
  - `DeploymentQuota` — fires once on stack create and requests CloudFront quota increases (`L-B4048FB4` to 200, `L-F432D044` to 200) via `service-quotas:RequestServiceQuotaIncrease`. Failures are **silently swallowed** (best-effort): logging the error and returning `cfnresponse.SUCCESS` so the stack does not block on AWS Service Quotas approval latency.

#### 2.4.3 IAM (high-level)

- The provider role is **never** wildcarded across services. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- The `DeployByTokenHandler` role has: `dynamodb:{Get,Put,Update,Query}Item` on `DeploymentStatusTable` + `StackBundleMapTable`, `kms:{Encrypt,Decrypt,GenerateDataKey,DescribeKey}` on `DataKey`, `codebuild:StartBuild` on the two CodeBuild project ARNs, `states:StartExecution` on the `DeployArtifact` ARN, and `apigateway:GetApiKey` (for surfacing API GW info into health metrics; see §7.4).
- The `DeployStatusHandler` role has: `dynamodb:{Get,Query}Item` on `DeploymentStatusTable` + `LegacyDeployerTable`, `codebuild:BatchGetBuilds` on `*`, `s3:GetObject` + `s3:PutObject` (presign) on `ArtifactsBucket/build_artifacts/*`, `logs:GetLogEvents` on `*` (CodeBuild logs are not resource-tagged enough to scope tighter — `cloud-aws-primary` exempts this case).
- The `DeploymentLogsHandler` role has: `dynamodb:Query` on `DeploymentLogsTable`.
- The state machine workers (`Pre/Create/Update/Delete/Rollback/Review/GetStatus/PostSuccess/PostFailed`) hold the union of permissions they need against the local account: `dynamodb:{Get,Put,Update}Item` on `DeploymentStatusTable` + `StackBundleMapTable`, `s3:*` on `ArtifactsBucket/*` and `arn:aws:s3:::deploy-code-*` (the per-Deployer template/artifact bucket created on first run), `kms:*` on `DataKey`, `cloudformation:{CreateStack,UpdateStack,DeleteStack,DescribeStacks,DescribeStackResources,ListStackResources,ListChangeSets,ExecuteChangeSet,ContinueUpdateRollback,GetTemplate}` on `*`, `iam:PassRole` on `CloudformationExecRole` only, `ec2:Describe*` for VPC reads (in case a deployed module needs it), `ecr:{ListImages,BatchDeleteImage,DescribeRepositories}` on `*` (used by `DeleteStack`), `cloudwatch:{DeleteLogGroup,DescribeLogGroups}` on `*`, `apigateway:*` on `*` only for `update_information_api` and the Deployer's own API custom resources, `lambda:{ListFunctions,GetFunction,InvokeFunction}` on the `CleanLambdaVersion` ARN, `ssm:{GetParameter,PutParameter,GetParametersByPath}` on the `/deploy/automatic/*` and `/deployer/*` parameter prefixes only, `states:SendTaskSuccess` + `states:SendTaskFailure` on `*` (Step Functions does not support resource-level constraints here), and `service-quotas:GetServiceQuota|RequestServiceQuotaIncrease` on `*`. Service API mappings are created by the deployed service stacks, not by Deployer post-deploy copy hooks.
- Each `RegionalDeploymentEventRelay` role holds `dynamodb:{Get,Put,Update}Item` on the home-region `DeploymentStatusTable` + `StackBundleMapTable` and `states:SendTaskSuccess` + `states:SendTaskFailure` on the home-region `DeployArtifact` state machine executions.
- `iam:PassRole` is granted on `CloudformationExecRole` only (passed to CloudFormation by every `CreateStack` / `UpdateStack`).
- The `CleanLambdaVersion` role holds `lambda:ListFunctions|ListVersionsByFunction|DeleteFunction` and `lambda:ListLayers|ListLayerVersions|GetLayerVersion|DeleteLayerVersion` on `*`. There is no cross-account variant — it only reaps versions in this account.
- The `HealthApiKeyAuthorizer` role holds `apigateway:GET` on `arn:aws:apigateway:<region>::/apikeys/{HEALTH_API_KEY_ID,SERVICE_API_KEY_ID}`.
- Each regional `DeploymentNotificationTopicPolicy` allows `sns:Publish` from `cloudformation.amazonaws.com` with `Condition: aws:SourceAccount == <this account>` only — no cross-account publishers.

### 2.5 Configuration surface

The runtime is configured exclusively via CDK parameters (CloudFormation `Parameters`) and env vars (read once on cold start; missing required values must fail closed).

CloudFormation parameters supplied by the upstream installer:

| Parameter            | Default                                | Purpose                                                                                                                                  |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Subdomain`          | required                               | Deployer's custom-domain FQDN; mounted at base path `infra-deployer`. Also stamped onto every deployed bundle as the `Subdomain` CFN param. |
| `Regions`            | required JSON-encoded array             | Active regions this Deployer fans bundles into when `multi_region_deployment=true`. Each entry is `{ "RegionName": "<region>", ...<per-region CFN param overrides> }`; the installer must include the home region if local-only deploys should be allowed. |
| `AccountDomainConfigSsmParam` | `/account/domain-config` (string)      | SSM parameter containing Account's domain-config endpoint or cached domain-config JSON for this tenant. Deployer resolves it before rendering service stack parameters. |
| `EnvParameters`      | `{}` (JSON-encoded object)             | Per-environment CFN parameter defaults injected into every deploy (e.g. `{ "VpcId": "vpc-…", "LogBucketName": "…" }`). Merged below request-body `custom_parameters`. |
| `ServiceApiKeyID`    | `null`                                 | Operator API key bound to the usage plan by `ApiUsagePlanCustom`                                                                         |
| `HealthApiKeyID`     | `null`                                 | Secondary API key accepted by `HealthApiKeyAuthorizer` for `/deployments/logs/*`                                                         |
| `ProductName`        | `Deploy`                               | Cost-tag value used on every taggable resource as `sc:product:name`                                                                      |
| `ServiceInfo`        | `null`                                 | JSON string returned verbatim by `GET /information` and used as the `Nonce` for `ApiUsagePlanCustom`                                     |
| `BuildHash`          | `null`                                 | Build identifier stamped into every health-metric emission                                                                               |
| `CloudFrontFuncArn` / `CloudFrontID` | —                  | Pass-through CloudFront association used by FRONTEND bundles                                                                              |

Env vars (Lambda-level):

| Key                                         | Default                                                  | Used by                                      |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `DEPLOY_PRODUCT_IDENTIFIER`                 | `229c0982-b5fe-4d4c-8f9e-80ad38f5d4b8` (lexicon-stable)  | Health metrics                               |
| `PRODUCT_API_IDENTIFIER`                    | per-handler UUID                                         | Health metrics                               |
| `SERVICE_API_KEY_ID`                        | from `ApiUsagePlanCustom`                                | API GW info lookup                           |
| `HEALTH_API_KEY_ID`                         | from CFN parameter                                       | `HealthApiKeyAuthorizer`                     |
| `DOMAIN_NAME`                               | from `Subdomain`                                         | Health outbound calls; also the canonical `Subdomain` CFN param value |
| `REGIONS`                                   | from `Regions`                                           | `PreDeploymentWorker` multi-region planner   |
| `ACCOUNT_DOMAIN_CONFIG_SSM_PARAM`           | from `AccountDomainConfigSsmParam`                       | Domain metadata lookup for service CFN parameters |
| `ENV_PARAMETERS`                            | from `EnvParameters`                                     | Default CFN-parameter bag for every deploy   |
| `ACCOUNT_ID`                                | `AWS::AccountId`                                         | Regional SNS topic ARN composition           |
| `KMS_KEY_ARN`                               | `DataKey.Arn`                                            | DDB encryption                               |
| `BUILD_HASH`                                | from CFN parameter                                       | Health                                       |
| `DEPLOY_ARTIFACT_SF`                        | `DeployArtifact` ARN                                     | `DeployByTokenHandler`                       |
| `DEPLOY_CODEBUILD_PROJECT`                  | `devops-deployer-dev`                                    | Legacy CodeBuild fallback                    |
| `ARTIFACTS_BUCKET_NAME`                     | bucket name                                              | `DeployByTokenHandler`, status presign       |
| `DEPLOYMENT_SNS_TOPIC_NAME`                 | `DeploymentNotification`                                 | Regional topic-ARN composer                  |
| `DEPLOYMENT_SNS_TOPIC_ARNS_BY_REGION`       | JSON map from `RegionalNotificationStack` outputs         | CodeBuild env-vars + CFN `NotificationARNs`  |
| `STACK_BUNDLE_MAP_COLLECTION`               | table name                                               | All stack-status workers                     |
| `DEPLOYMENT_STATUS_COLLECTION`              | table name                                               | All stack-status workers                     |
| `DEPLOYMENT_LOGS_COLLECTION`                | table name                                               | `DeploymentLogsHandler`, log writers         |
| `CF_EXECUTION_ROLE`                         | `CloudformationExecRole.Arn`                             | `iam:PassRole` target on every CFN call      |
| `CODE_BUILD_SOURCE_BUCKET`                  | bucket name                                              | Custom resources only                        |
| `CLEAN_LAMBDA_VERSION_FUNCTION`             | `deployer-${stage}-cleanLambdaVersion`                   | `PreDeploymentWorker`                        |

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses use a uniform JSON envelope. Success:

```json
{ "statusCode": 200, "body": <route-specific> }
```

Error responses are JSON with a `message` (string or list) and may carry a `reason`:

```json
{
  "statusCode": 500,
  "body": {
    "error": { "message": "Service error" }
  }
}
```

Validation failures (400) flatten the marshmallow / zod error structure as `{ <field>: [<msg>, …] }`. Conflict on retry (409) returns `{ "deploy_status": "FAILED", "reason": "<reason from previous attempt>" }`.

Every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, and `Access-Control-Allow-Methods: OPTIONS,POST,GET`. The `INVALID_API_KEY` gateway response is overridden to return `{"message":"API key is not valid"}`; `DEFAULT_4XX` returns `{"message":"Request has been declined."}`.

### 3.2 Bundle structure (caller responsibility)

The `artifacts_url` MUST resolve to a `application/zip` payload with this layout (from the staircase-built bundles):

```
bundle.zip
├── config.json
├── artifacts/
│   └── <module_name>/
│       ├── update.json          # the CloudFormation template
│       ├── <artifact>.zip       # one or more module artifacts (Lambda code, Layer code, etc.)
│       └── …
└── docker_images/               # optional
    └── <image_name>/
        ├── Dockerfile
        ├── deployment-bucket.yml
        └── scripts/
```

`config.json` schema (excerpts):

```jsonc
{
  "name": "simple-multi-stack-service",
  "version": 1.0,
  "service_name": "<bundle_name>",          // optional, becomes ProductName CFN param
  "bundle_type": "SERVICE | DATA | FRONTEND | FRONTEND_CONFIG | CHAT",
  "base_path": "<api-gw-base-path>",         // required for FRONTEND/FRONTEND_CONFIG/CHAT
  "artifact_bucket_name": "<placeholder>",   // replaced by the Deployer-managed deploy-code-<uuid> bucket name
  "modules": [
    {
      "module": "<key>",
      "module_name": "<directory-name>",
      "stack_name": "<cfn-stack-name>",
      "artifacts": ["<artifact-file>", "..."],
      "artifact_directory_name": "<s3-prefix>",
      "api": false
    }
  ],
  "docker-images": [
    { "dockerfile_path": "docker/x.Dockerfile", "context": "x/", "destination": "module-x.ECRRepositoryURI" }
  ],
  "deployment": { "multi_region_deployment": false },
  "documentation": { "type": "private", "path": "requirements/swagger.yml" }
}
```

`bundle_type` drives a post-deploy hook:

- `SERVICE`: no Deployer-owned custom-domain copy hook. Each service CDK stack defines its own `AWS::ApiGatewayV2::ApiMapping` resources using the standardized domain parameters Deployer passes in from Account. `PostDeploymentServiceBundleSuccess` is limited to service metadata / information API refresh work and MUST NOT create, copy, delete, or mutate API Gateway mappings.
- `FRONTEND`: `PostDeploymentFrontendBundleSuccess` runs the frontend post-deploy hook (CloudFront association, S3 sync, etc., per `PreDeploymentFrontendBundle.run`). This PRD treats frontend internals as out-of-scope for re-implementation; preserve the existing semantics.
- `DATA`: no Deployer-owned post-deploy hook. Data bundles are expected to provision their own storage/import resources; graph ingestion, when needed, is handled by the deployed component calling the Persist service's SigV4 `/persist/*` API directly.
- `CHAT` / `FRONTEND_CONFIG`: dedicated pre-deploy bundles (`PreDeploymentChatBundle`, `PreDeploymentFrontendConfigBundle`).

### 3.3 Per-environment configuration source

The Deployer is configured exclusively through CFN install-time parameters and SSM. There is no per-call credential plumbing.

| Source                                | Provides                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CFN parameter `Subdomain`             | Deployer's own FQDN. Stamped onto every deployed bundle as the `Subdomain` CFN param (per-region: `<region>.<subdomain>` for non-home regions). |
| CFN parameter `Regions`               | JSON array of `{ "RegionName": <region>, ...<per-region CFN param overrides> }`. Honoured only when the request body has `multi_region_deployment=true`. |
| Account domain config                 | Account-owned domain metadata for this tenant, resolved before stack create/update and passed to every service stack as standardized CFN parameters. Service CDK code consumes these values to create its own API mappings. |
| CFN parameter `EnvParameters`         | JSON object of default CFN parameter overrides applied to every deploy (e.g. `VpcId`, `LogBucketName`, third-party endpoints).                 |
| Request body field `custom_parameters` | Per-call CFN parameter overrides; merged on top of `EnvParameters` (request wins).                                                            |
| SSM `/deploy/automatic/code-bucket-name` | Auto-created on first deploy; the Deployer-managed `deploy-code-<uuid>` bucket name reused across deploys.                                  |
| SSM `/deployer/state-machine/deploy-artifact-arn` | Published by `WorkflowStack`; consumed by the public API handler.                                                                      |

Effective CFN parameter resolution at deploy time:

```
cloudformation_parameters = {
  Subdomain: <CFN-param>,                    // overridden per non-home region to "<region>.<Subdomain>"
  DomainName: <Account canonical domain>,     // Account-owned tenant FQDN
  CustomDomains: JSON.stringify(<Account alias domains>),
  HostedZoneId: <Account hosted zone id>,
  CertificateArn: <Account regional certificate arn>,
  ...JSON.parse(EnvParameters),               // env-wide defaults
  ...region.entry,                            // per-region overrides from Regions[i]
  ...request.custom_parameters,               // per-call overrides
  BundleId: <bundle_id>,
  ServiceInfo: <derived>,
  ProductName?: <config.service_name>,
  BundleName?: <config.service_name>
}
```

Before rendering this bag, Deployer resolves Account's domain config for the local account. The preferred source is Account's `GET /accounts/{account_id}/domain-config`; an Account-managed SSM cache may be used for cold-start resilience, but Account remains the source of truth. The domain fields are standardized across every service bundle so service CDK infrastructure can declare API Gateway domain names and base-path mappings directly.

Any key in this bag that does NOT correspond to a `Parameters` entry in the module's `update.json` is dropped before submitting the CFN call (see `update_cloudformation_parameters` in §5.1.1).

> **No credential plumbing.** The Deployer's Lambdas and CodeBuild projects rely entirely on their own IAM roles (§2.4.3) to call CloudFormation, S3, IAM, KMS, ECR, and Lambda. The legacy `environment_token` field — and the Fernet-decrypt + cross-account `boto3` session factory it powered — is removed. Callers that previously used to pass an `environment_token` MUST stop sending it; the field is rejected as `400 BadRequest` (`"unknown field environment_token; this Deployer is local-account only"`).

### 3.4 Deploy types (worker dispatch)

| Path                   | Worker             | When                                                                                                                                                                                            |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lambda (default)**   | Step Functions     | `legacy_deploy != true` ∧ `Content-Length(artifacts_url) * 3 <= 3 GB`. Worker size dispatched by `WorkerSizeCheck` (SMALL ≤ 78 MB, MEDIUM ≤ 384 MB, LARGE ≤ 3 GB).                              |
| **CodeBuild (legacy)** | `devops-deployer-dev` | `legacy_deploy = true` ∨ `Content-Length(artifacts_url) * 3 > 3 GB`.                                                                                                                            |

`get_lambda_worker_size(size_bytes_x3)` returns `SMALL` (≤ 78,000,000 B), `MEDIUM` (≤ 384,000,000 B), `LARGE` (≤ 3,000,000,000 B), and raises `LambdaWorkerSizeExceedError` for anything larger (caller falls back to CodeBuild).

`is_lambda_worker(body, size)` returns `false` immediately when `body.legacy_deploy === true`; otherwise calls `get_lambda_worker_size(size * 3)` and returns `true` if that succeeds. Any exception becomes `false` (CodeBuild fallback).

### 3.5 Request body — `POST /deploy-by-token` / `POST /deploy-data-by-token` / `POST /deployments`

```ts
{
  bundle_id?:       string,                          // optional; UUID minted server-side if absent
  transaction_id?:  string,                          // optional; caller-supplied correlation ID; defaults to bundle_id
  artifacts_url:    string,                          // required; presigned S3 URL pattern
  callback_url?:    string,                          // default "null"; webhook fired once on terminal status
  log_level?:       "INFO" | "DEBUG",                // default INFO
  configuration?: {
    parallel_module_deployment?:  boolean,           // default true
    limit_check_on_pre_deployment?: boolean          // default false
  },
  force_deployment?:        boolean | null,
  multi_region_deployment?: boolean | null,          // gates fan-out across the configured `Regions`
  custom_parameters?:       Record<string, string>,  // CFN parameter overrides; merged on top of `EnvParameters`
  legacy_deploy?:           boolean,                 // default false; force CodeBuild path
  domain_name?:             string,                  // optional; if present MUST equal this Deployer's `Subdomain`
  // Old field, kept for backward compatibility, no longer used:
  parallel_deployment?:     boolean
}
```

Validation runs in this order:

1. Schema decode. **Reject any payload that includes the legacy `environment_token` field** with `400 { environment_token: ["unknown field; this Deployer is local-account only"] }`.
2. `validate_artifacts_url` — regex match against `PRESIGNED_S3_URL_PATTERN` plus a streaming `GET` (`timeout=3s, allow_redirects=false`) to assert reachability and capture `Content-Length` (cached in `ARTIFACT_SIZE_MAP[url]`).
3. If `domain_name` is present, assert `domain_name === <this Deployer's Subdomain>`; otherwise return `400 { domain_name: ["does not match this Deployer's Subdomain"] }`. This catches misrouted calls (e.g. Marketplace targeting the wrong tenant's Deployer) before any side effect.

Any failure returns `400 {<field>: [<msg>, …]}`.

### 3.6 Status statuses

`DeploymentOpStatusTypes` (vended through DynamoDB rows and the wire `deploy_status` field):

| Value             | Meaning                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `REQUEST_MADE`    | Initial state immediately after API accepts the request and writes the root row.                                                      |
| `PRE_DEPLOYMENT`  | Set by `PreDeploymentWorker` once it begins downloading + partitioning the bundle; carried on every per-stack row at creation time.    |
| `IN_PROGRESS`     | Set by `Create/Update/Delete/Rollback/Review` workers on success of their `boto3` call (CloudFormation has accepted the change).        |
| `SUCCEEDED`       | Set by `PostSuccessDeploymentWorker` on terminal success of the entire bundle, **and** by the regional SNS relay on per-stack `*_COMPLETE` events. |
| `FAILED`          | Set by the regional SNS relay on per-stack `*_FAILED` / `*_ROLLBACK_COMPLETE` events, and by `PostFailedDeploymentWorker` on terminal bundle failure. |

Marketplace's wire-status semantics (consumed via `GET /deploy/{bundle_id}`):

- `IN_PROGRESS` is reported when the root row is in `REQUEST_MADE | PRE_DEPLOYMENT | IN_PROGRESS`.
- `SUCCEEDED` and `FAILED` are reported as-is.
- For CodeBuild workers, the wire status is the verbatim CodeBuild `buildStatus` (`SUCCEEDED | FAILED | IN_PROGRESS | TIMED_OUT | STOPPED | FAULT`). Marketplace's `CAN_BE_REDEPLOYED_STATUSES_FROM_DEPLOYER = ["FAILED", "FAULT", "STOPPED", "TIMED_OUT"]` therefore relies on this passthrough.

### 3.7 Error catalogue

Implementation-level error tags (MUST be a tagged class hierarchy with a `_tag` discriminator):

| Tag                                 | HTTP / SFN handling                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationError`                   | 400 with field issues.                                                                                                           |
| `LambdaWorkerSizeExceedError`       | Caller falls back to CodeBuild silently (not propagated).                                                                        |
| `DeployError`                       | 500; payload may carry `{ deployment_events, status_code }`.                                                                     |
| `DeploymentRetryExceedError`        | Final terminal failure on `DeleteStack` after `MAX_RETRY_THRESHOLD = 3` retries.                                                 |
| `StackAlreadyExistsException`       | SFN `Catch` on `CreateStack` → `Next: GetStackStatus`.                                                                           |
| `StackDoesNotExistError`            | Treated as a precondition failure inside `UpdateStack` (caller already deleted the stack); the SFN bubble-up triggers `PostFailedDeployment`. |
| `DeploymentInProgressError`         | SFN `Catch` on every CFN-mutating step → `Next: GetStackStatus` (the engine re-polls until terminal).                            |
| `LambdaCodeStorageExceedError`      | Health metric `invocation_code=4000` (capacity), then bubble up; caller sees a 500.                                              |
| `AWSTooManyRequestsException`<br>`AWSServiceException`<br>`AWSServiceUnavailableException`<br>`AWSThrottlingException`<br>`AWSGeneralServiceException` | SFN retries (`IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`); the regional SNS relay maps CFN failure-event reasons containing each substring back to one of these tags via `check_deployment_error` and emits `SendTaskFailure(error=<tag>)`. |

The HTTP layer is the authoritative tag-to-status mapper. Errors NOT in the table fall back to `500 Service error` (the body never echoes raw stack traces — those are written to `DeploymentLogsTable` and accessible via the dual-key authoriser route).

---

## 4. Synchronous APIs

### 4.1 `POST /deploy-by-token` (and aliases `/deploy-data-by-token`, `/deployments`)

- Decorators applied (in this order, top-to-bottom): `override_headers` (force the standard CORS/HSTS headers onto every response), `Logger.injectLambdaContext({ logEvent: true })`, `cors_headers`, `dump_json_body`, `load_json_body`, `populate_bundle_id` (mints `bundle_id = uuidv4()` if absent and pins it on the event for downstream handlers).
- Pipeline:
  1. Decode body via `DeployByTokenSchema` → reject `environment_token` if present → `validate_artifacts_url(artifacts_url)` (cached `Content-Length` in `ARTIFACT_SIZE_MAP[url]`) → optional `domain_name === DOMAIN_NAME` consistency check.
  2. Resolve `transaction_id`: if `body.transaction_id` is set, use it; otherwise set `transaction_id = bundle_id`. The Deployer never calls a local `/persistence/*` document API; transaction IDs are correlation metadata stored on Deployer's own DynamoDB rows and emitted to Health metrics/callbacks.
  3. Lambda branch (`is_lambda_worker(body, content_length) === true`):
     - Build `sf_payload` per §6.2 and call `stepfunctions.startExecution({ stateMachineArn: DEPLOY_ARTIFACT_SF, name: bundle_id, input: JSON.stringify(sf_payload) })`.
     - Persist `add_deployment_status({ bundle_id, deploy_id: bundle_id, worker_type: "lambda", stack_id: "root", status: REQUEST_MADE, host_domain, api_key, callback_url })`.
     - Return `200 { deploy_id: bundle_id, bundle_id, transaction_id }`.
  4. CodeBuild branch (everything else):
     - `codebuild.startBuild({ projectName: "devops-deployer-dev", environmentVariablesOverride: [CLOUD_FRONT_FUNC_ARN, CLOUD_FRONT_ID, ARTIFACTS_URL, BUNDLE_ID, CALLBACK_URL, HOST, ARTIFACTS_BUCKET_NAME, X_API_KEY, LOG_LEVEL, FORCE_DEPLOYMENT, MULTI_REGION_DEPLOYMENT, REGIONS, ACCOUNT_DOMAIN_CONFIG, ENV_PARAMETERS, CUSTOM_PARAMETERS, DEPLOYMENT_SNS_TOPIC_ARNS_BY_REGION, STACK_BUNDLE_MAP_COLLECTION, DEPLOYMENT_STATUS_COLLECTION] })`. Note the absence of `ENV_TOKEN` — the legacy CodeBuild deploy script must be ported to read its target-account configuration from `REGIONS`/`ACCOUNT_DOMAIN_CONFIG`/`ENV_PARAMETERS`/`CUSTOM_PARAMETERS` instead, select the SNS topic ARN whose region matches the target stack, and use the build's own task role for AWS calls.
     - Persist `add_deployment_status({ bundle_id, deploy_id: <build_id>, worker_type: "code_build", stack_id: "root", status: REQUEST_MADE, host_domain, api_key, callback_url })`.
     - Return `200 { deploy_id: <build_id>, bundle_id, transaction_id }`.
- All exceptions: emit a `failed` health metric with `invocation_code=5000` and the full stack trace, return `500 { error: { message: "Service error" } }`.

### 4.2 `GET /deploy/{bundle_id}` (and `/deploy-data/{bundle_id}`, `/deployments/{bundle_id}`)

- Read root row (`stack_id = "root"`) from `DeploymentStatusTable`.
  - On read failure (row missing), fall through to `legacy_deploy_status(bundle_id)` (queries `LegacyDeployerTable` for a `code_build_id`, then `codebuild.batchGetBuilds`). If that also fails: `404 { message: "Deploy is not found" }`.
- Branch on `worker_type`:
  - `lambda` (or `null`, for backward compat): `getBundleDeploymentStatus(bundle_id)` returns the full per-stack array (with `expire_at`, `metadata`, `api_key`, `task_token` redacted). The wire `deploy_status` is computed from the root row's status: `{ REQUEST_MADE, PRE_DEPLOYMENT, IN_PROGRESS } → IN_PROGRESS`, otherwise the root status verbatim. Returns `200 { bundle_id, deploy_id, deploy_status, bundle_details: <stacks> }`.
  - `code_build`: `codebuild.batchGetBuilds([deploy_id])`; if `buildStatus !== "IN_PROGRESS"`, the worker fetches `deploy_output.json` from the build's S3 artifact prefix, presigns `artifacts.zip` (1 h), and pulls all log events. Returns `200 { deploy_status: <buildStatus>, reason?, metadata?, artifact_url?, logs? }`. If the root row carries `status=FAILED` with `status_code=409`, returns `409 { deploy_status: "FAILED", reason }`.
- 5xx / 500 → uniform `{ message: "Service Error" }`; emit a `failed` health metric.

### 4.3 `GET /deployments/logs/{response_collection_id}?product_api_identifier=...`

- Authoriser: `HealthApiKeyAuthorizer` accepts the request iff `event.authorizationToken ∈ { HEALTH_API_KEY_VALUE, SERVICE_API_KEY_VALUE }`. The authoriser pulls the live values via `apigateway.getApiKey({ apiKey, includeValue: true })` for `HEALTH_API_KEY_ID` and `SERVICE_API_KEY_ID`.
- Request: validate `{ response_collection_id, product_api_identifier? }` via `DeploymentLogsSchema`.
- Response: `200 <list of log records>` from `DeploymentLogsTable` `Query(KeyConditionExpression=Key("response_collection_id").eq(...))`, optionally filtered by `product_api_identifier`.

### 4.4 `GET /information`

- API Gateway `MOCK` integration. Returns the deployer-supplied `ServiceInfo` JSON with the standard CORS / HSTS headers. **No API key required.** This is the standard introspection endpoint that upstream services use to confirm the Deployer is reachable and to read its tenant identity (`Subdomain`, `BuildHash`).

---

## 5. Asynchronous Pipelines

### 5.1 `DeployArtifact` state machine — entry and pre-deployment

The state machine is started by `DeployByTokenHandler` with the §6.2 input. The first stage is `WorkerSizeCheck → PreDeployment{Small,Medium,Large}` (`PreDeploymentWorker` Lambda; one source binary, three CDK deployments at distinct memory/disk cohorts).

#### 5.1.1 `PreDeploymentWorker`

For every invocation:

1. Read the per-environment configuration from env vars: `Subdomain = DOMAIN_NAME`, `regions = JSON.parse(REGIONS)`, `account_domain_config = resolveAccountDomainConfig(ACCOUNT_DOMAIN_CONFIG_SSM_PARAM)`, `env_parameters = JSON.parse(ENV_PARAMETERS)`. Treat missing optional values as `[]` / `{}` but fail closed if Account domain config is unavailable for a `SERVICE` or `FRONTEND` bundle that declares domain parameters.
2. Compute `active_regions`: always include the home region (`AWS::Region` of this Lambda); if `body.multi_region_deployment === true`, additionally include every entry in `regions[]` whose `RegionName` differs from the home region. Each region carries its own per-region CFN parameter overrides.
3. Download the bundle from `artifacts_url` (streaming `fetch`), parse `x-amz-meta-service-*` JWT-encoded metadata (decoded without verification — the JWTs are stamped by the upstream **Site** publisher and we do not own its key), and extract the zip into a Lambda-ephemeral `tempfile.TemporaryDirectory` under `/tmp`.
4. Read `bundle/config.json`. Bail with `DeployError("config.json not found inside bundle.")` on miss. Bail with `DeployError("base_path not found inside config.json")` if `bundle_type ∈ {FRONTEND, FRONTEND_CONFIG, CHAT}` and `base_path` is missing.
5. **Backward-compatible bundle copy.** Replicate the bundle under `<bundle_path>/<region>/...` for every active region (recursive copy). Then upload each module's artifacts + `update.json` to the local `deploy-code-<uuid>` bucket under `<artifact_directory_name>/...` using the worker's own `@aws-sdk/client-s3` instance (no session factory).
6. For each `region`:
   - Invoke `CleanLambdaVersion` (`InvocationType: Event`, fire-and-forget) so old Lambda versions in this account are reaped before the new deploy fills storage.
   - Compose `cloudformation_parameters = { Subdomain: DOMAIN_NAME, DomainName: account_domain_config.domain_name, CustomDomains: JSON.stringify(account_domain_config.custom_domains), HostedZoneId: account_domain_config.hosted_zone_id, CertificateArn: account_domain_config.certificate_arn, ...env_parameters, ...region.entry, ...request.custom_parameters, BundleId, ServiceInfo, ProductName?, BundleName? }`. For non-home regions, additionally set `Subdomain = "<region>.<DOMAIN_NAME>"` and pick the region-appropriate certificate when Account provides one.
   - For each module: replace the bundle's `artifact_bucket_name` placeholder with the local `deploy-code-<uuid>` bucket name, upload artifacts + `update.json` under `<artifact_directory_name>/...`, presign the template URL (1 h, region-correct S3 endpoint), strip CFN parameters that don't appear in the template (`update_cloudformation_parameters`), and ask CloudFormation whether the stack already exists (`StackResource.stack_id`/`stack_status`) using the worker's own `@aws-sdk/client-cloudformation` (regional client per `region`). The result is one `module_payload` per `(stack_name, region)` carrying every field §6.2 expects on the `prepared_modules[]` items.
   - Apply `bundle_type`-specific pre-deploy hooks: `PreDeploymentFrontendBundle.run(...)`, `PreDeploymentChatBundle.run(...)`, `PreDeploymentFrontendConfigBundle.run(...)`. The `SERVICE` and `DATA` paths skip these.
   - Optional `limit_check_on_pre_deployment` runs `QuotaService.check()` (the only check today is Lambda code-storage size in this account; raises `LambdaCodeStorageExceedError` at ≥99 % of quota).
7. On success update root row → `IN_PROGRESS`, emit a `succeeded` health metric, and return §6.2 `pre_deployment_output`.
8. On any failure: write `root_status = FAILED` with `reason = error.toString()`, emit a `failed` health metric (`invocation_code = 4000` for `LambdaCodeStorageExceedError`, else `5000`), and rethrow so SFN catches it.

The temp directory is cleaned up by the `temp_dir_context` decorator on every exit.

### 5.2 Stack-status loop (per module, per region)

For every prepared module the state machine runs the loop in §2.3.3. Each branch is a small Lambda. Every worker uses its own AWS SDK clients (regional `@aws-sdk/client-cloudformation`, `@aws-sdk/client-s3`, `@aws-sdk/client-ecr`, etc.) — there is no cross-account session factory.

| Lambda                         | Side effect                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetStackStatusWorker`         | `cf_resource.Stack(name).stack_status`. Sets `stack_exist = stack_status != null`.                                                                                                    |
| `CreateStackWorker`            | `cloudformation.create_stack({ StackName, TemplateURL, Parameters, NotificationARNs:[<sns-topic-arn>], Capabilities:[CAPABILITY_NAMED_IAM,CAPABILITY_AUTO_EXPAND], OnFailure:ROLLBACK, RoleARN:<CloudformationExecRole>, TimeoutInMinutes:30, Tags:[{sc:service:name=<module>},{sc:product:name=<bundle>}] })`. Maps `AlreadyExistsException` to `StackAlreadyExistsException`. Persists `add_bundle_stack_mapping` and `add_deployment_status({ bundle_id, stack_id, status: IN_PROGRESS, task_token })`. |
| `UpdateStackWorker`            | `cloudformation.update_stack(...)` with the same parameter set. Maps `ValidationError("...is in UPDATE_IN_PROGRESS state...") → DeploymentInProgressError`, `ValidationError("Stack [%s] does not exist") → StackDoesNotExistError`, and `ValidationError("No updates are to be performed") → no-op` (returns `null` stack ID, completes the task). |
| `DeleteStackWorker`            | Best-effort empties S3 buckets and ECR repositories declared in the template before calling `Stack.delete()`. After delete, polls a custom `StackDeleteWaiter` (`Delay=30s, MaxAttempts=120`). Tracks `event.retries` per error code; raises `DeploymentRetryExceedError` once `retries[error_code] ≥ MAX_RETRY_THRESHOLD = 3`. Re-emits `event` with cleared `error` so the SFN catch path can re-loop into `GetStackStatus`. |
| `RollbackContinueStackWorker`  | `cloudformation.continue_update_rollback(StackName)` then waits on the `stack_rollback_complete` waiter. On `WaiterError`, scans `Stack.events.limit(100)` for `UPDATE_FAILED` events, re-runs `continue_update_rollback(StackName, ResourcesToSkip=<failed_resources>)`, waits again. If still failing, raises `DeployError("Rollback failed for stack:<name>. Cancelling deployment...")`. |
| `ReviewChangesWorker`          | When `stack_status = REVIEW_IN_PROGRESS`: `list_change_sets(StackName)`. If exactly one change set is in `CREATE_COMPLETE`, `execute_change_set(ChangeSetName, StackName)`. Anything else returns silently — the next `GetStackStatus` will re-evaluate. |

`CreateStack` and `UpdateStack` use `lambda:invoke.waitForTaskToken`. The Lambda persists `task_token = $$.Task.Token` on the per-stack row, then **does not** call `SendTaskSuccess` itself — the regional SNS relay (§5.3) does that when CloudFormation reaches a terminal state.

### 5.3 `RegionalDeploymentEventRelay` (CFN reconciler)

Subscribed to the `DeploymentNotificationTopic` in the same region as the stack operation. Each SNS message body is a CFN-event newline-separated `Key=Value` envelope. The relay:

1. Parses `cf_obj` from the message body (lines of `Key=Value`, splitting on the first `=`; ignores empty lines and lines without `=`).
2. If `ResourceStatus ∈ CfStatusTypes.failed_statuses` (`CREATE_FAILED, DELETE_FAILED, ROLLBACK_FAILED, UPDATE_FAILED, UPDATE_ROLLBACK_FAILED, IMPORT_ROLLBACK_FAILED`): `add_failed_event(stack_id, cf_obj)` appends to the per-stack row's `failed_events[]` and `send_health_metric(subdomain, api_key, payload)` emits a granular failure metric to the upstream Health service for the whole bundle.
3. If `ResourceId == StackName` (i.e. it's a stack-level event):
   - `ResourceStatus ∈ complete_statuses` (`CREATE_COMPLETE, DELETE_COMPLETE, ROLLBACK_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE, UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS, IMPORT_COMPLETE, IMPORT_ROLLBACK_COMPLETE`):
     - Look up `bundle_id` via `get_bundle_id_by_stack_id(stack_id)`. If missing → log `BundleNotFoundException` and skip (legacy deploy contention; see §5.3.1).
     - Read the per-stack row. If `cf_status ∈ rollback_complete_statuses`, write terminal `status: FAILED` + `reason: "Stack resource failure"`, then call `check_deployment_error` to inspect `failed_events[]` for known retryable substrings (`TooManyRequestsException`, `ServiceException`, `ServiceUnavailableException`, `ThrottlingException`, `GeneralServiceException`) and `SendTaskFailure(error=<corresponding tag>)` so SFN re-routes via the retry block. Anything else `SendTaskFailure(error="DeployError")`.
     - Otherwise, write terminal `status: SUCCEEDED` + `finishedAt` + `cfStatus = ResourceStatus`, and `SendTaskSuccess(taskToken, output=JSON.stringify(stack_deployment_status))`. Clear the `task_token` field on the row so it isn't double-released.
   - `ResourceStatus ∈ failed_statuses` at stack level: same terminal-failure path as above.
4. On any unexpected exception: `handle_failure_on_worker_handler(stack_id, stack_name, error)` writes `status=FAILED` + `reason: <error>` and emits a Health metric noting the worker fault, then rethrows so SQS-equivalent retries kick in.

#### 5.3.1 Why `BundleNotFoundException` is silently ignored

Stack events for a stack that was created via the **new** SFN flow but is later being updated via the **legacy** CodeBuild path (or vice-versa) still arrive on the regional SNS topic (`NotificationARNs` are sticky on the stack). The legacy path doesn't write a `bundle_id` mapping, so `get_bundle_id_by_stack_id` returns nothing. The relay logs and skips — there's no SFN execution to release. This guard MUST remain until every legacy CodeBuild deploy is gone. Re-introducing a hard error here would break customers mid-migration.

### 5.4 Post-deployment hooks

#### `PostSuccessDeploymentWorker`

For every `(region_detail, module_outputs)` pair (using the worker's own regional AWS SDK clients):

1. Call `update_information_api(module_outputs)` — for each module that emitted a `Payload.stack_id`, look up the stack name via `get_stack_name_from_stack_id(stack_id)` and call `deploy_information_api(stack_name, cf_resource, apigateway_client)` (the `/information` resource on the deployed API gateway gets refreshed with the new bundle's metadata).
2. Branch on `bundle_type`:
   - `SERVICE`: per module, refresh only service metadata / information API details. Deployer MUST NOT copy API mappings to custom domains; each service CDK stack owns those mappings using the Account-derived `DomainName`, `CustomDomains`, `HostedZoneId`, and `CertificateArn` parameters.
   - `FRONTEND`: per module, `PostDeploymentFrontendBundleSuccess.run(custom_domains, stack_name, base_path, cloudformation_parameters)`.

On success: write `root_status = SUCCEEDED, finished_at = now()`, fire the optional `callback_url` (POST `{ bundle_id, status: "SUCCEEDED" }` with retry `total=3, statusForcelist=[403,404,429,500,502,503,504], method_whitelist=[HEAD,POST,OPTIONS]`), retain the deployment summary on the root/per-stack DynamoDB rows, and emit two `succeeded` Health metrics (`invocation_code=2000`). The Deployer does not create deployment-summary collections in a separate Persistence service.

On failure: same steps but with `status=FAILED, invocation_code=5000`, post `{ status: "FAILED" }` to the callback, and retain failure details on the Deployer-owned deployment rows plus `DeploymentLogsTable`.

#### `PostFailedDeploymentWorker`

Identical post-success post-processing but skipping the per-module hooks: write `root_status = FAILED, finished_at = now()`, fire callback with `{ status: "FAILED" }`, persist failure details locally, and emit Health metrics.

### 5.5 `CleanLambdaVersion` (cron, plus on-demand from `PreDeploymentWorker`)

EventBridge schedule fires every 12 h. Body: `{ target_region?, transaction_id }` (no credential payload). Behaviour:

1. Construct a regional `@aws-sdk/client-lambda` client using the worker's own role, defaulting `target_region` to the home region.
2. `clean_old_lambda_versions(client)`: list every function, keep `$LATEST` and the most recent 2 numbered versions, delete the rest. Same for layer versions (keeps the most recent 5 versions per layer).
3. On any exception: emit a `failed` Health metric with `invocation_code=5000` and rethrow.

---

## 6. Internal Data Schemas

### 6.1 DynamoDB row shapes

`DeploymentStatusTable` (root row, `stack_id = "root"`):

```ts
{
  bundle_id: string,                      // PK
  stack_id: "root",                       // SK
  deploy_id: string,                      // bundle_id (lambda) | code_build_id
  worker_type: "lambda" | "code_build",
  status: DeploymentOpStatusTypes,
  reason?: string,
  status_code?: 200 | 409 | 500,
  host_domain: string,
  api_key: string,                        // encrypted at rest via KMS-CMK
  callback_url: string | "null",
  failed_events?: FailedEvent[],
  finished_at?: ISO8601,
  created_at: ISO8601,                    // server-stamped
  expire_at: epochSeconds                 // 30d default
}
```

`DeploymentStatusTable` (per-stack rows):

```ts
{
  bundle_id: string,                      // PK
  stack_id: string,                       // CFN stack ARN
  status: "PRE_DEPLOYMENT" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED",
  task_token?: string,                    // present while a WAIT_FOR_TASK_TOKEN step is suspended
  cf_status?: string,                     // last seen CFN status
  failed_events?: FailedEvent[],
  reason?: string,
  finished_at?: ISO8601,
  created_at: ISO8601,
  expire_at: epochSeconds
}
```

`StackBundleMapTable`:

```ts
{ stack_id: string /*PK*/, bundle_id: string, expire_at: epochSeconds }
```

`DeploymentLogsTable`:

```ts
{
  response_collection_id: string,         // PK (typically bundle_id)
  product_api_identifier: string,         // SK (the per-handler UUID)
  stack_trace?: string,
  error?: string,
  transaction_id?: string,
  created_at: ISO8601,
  expire_at: epochSeconds
}
```

`LegacyDeployerTable` (read-only / write only on `legacy_deploy=true`):

```ts
{ bundle_id: string /*PK*/, code_build_id: string /*SK*/ }
```

### 6.2 Step Functions input / per-stage payload

`DeployArtifact` input (built by `DeployByTokenHandler`):

```ts
{
  bundle_id: string,
  deploy_id: string,                       // === bundle_id for lambda path
  transaction_id: string | "NULL",
  artifacts_url: string,
  worker_size: "SMALL" | "MEDIUM" | "LARGE",
  artifacts_bucket_name: string,
  x_api_key: string,
  host: string,                            // "https://<requestContext.domainName>/"
  log_level: "INFO" | "DEBUG",
  callback_url: string | "null",
  force_deployment: string,                // JSON.stringify of bool|null
  multi_region_deployment: string,
  custom_parameters: Record<string, string>,  // request-level CFN parameter overrides
  parallel_module_deployment: boolean,
  limit_check_on_pre_deployment: boolean
}
```

`PreDeploymentWorker` output (input to `WorkerSizeCheck → DockerPreDeployCheck → LambdaWorkerParallelismCheck`):

```ts
{
  bundle_id, callback_url, custom_domains,
  transaction_id, bundle_name, bundle_type,
  base_path, docker_image_exist,
  parallel_module_deployment,
  all_regions_details: [
    {
      target_region, custom_domains, docker_image_exist, bundle_type, base_path,
      transaction_id, modules: PreparedModule[], bundle_name
    }
  ],
  // Sequential path uses prepared_modules instead, flattened:
  prepared_modules?: PreparedModule[],
  // Used by docker pre/post tasks:
  codebuild_payload: {
    ARTIFACTS_URL, TRANSACTION_ID, ARTIFACTS_BUCKET_NAME, BUNDLE_ID, CALLBACK_URL,
    HOST, X_API_KEY, LOG_LEVEL, FORCE_DEPLOYMENT, MULTI_REGION_DEPLOYMENT,
    DEPLOYMENT_SNS_TOPIC_ARNS_BY_REGION, STACK_BUNDLE_MAP_COLLECTION, DEPLOYMENT_STATUS_COLLECTION
  }
}
```

`PreparedModule` (one per `(stack, region)`):

```ts
{
  bundle_id, transaction_id,
  stack_exist: boolean, stack_id: string|null, stack_status: string|null,
  deployment_status: "PRE_DEPLOYMENT",
  stack_name, module_name, template_url,
  cloudformation_parameters: Record<string, string>,
  target_region
}
```

### 6.3 Persistence collection (lexicon-shaped)

`build_final_collection` produces (`@type` and `@id` fields tie into the SOCAPITAL graph lexicon):

```jsonc
{
  "metadata": { "fuzzy_searchable": false, "version": 3, "validation": false, "serialise_to_graph": true },
  "data": {
    "bundles":      [{ "@type": "bundle", "@id": "bundle_id", "bundle_type": "Service|Data|FrontEnd|Chat|NULL", "base_path": "...", "has_product": "p_id" }],
    "products":     [
      { "@id": "p_id",   "@type": "product", "name": "<bundle_name>" },
      { "@id": "p_id_2", "@type": "product", "name": "Deploy",
        "product_identifier": "229c0982-b5fe-4d4c-8f9e-80ad38f5d4b8",
        "has_product_api": "product_api_id" }
    ],
    "product_apis": [{ "@type": "product_api", "@id": "product_api_id", "name": "Deployment",
                       "product_api_identifier": "a1257a35-5261-4293-9747-2e958c56f53c" }],
    "deployments":  [{ "@type": "deployment", "@id": "depl_id", "deployment_status_type": "Succeeded|Failed",
                       "has_invocation": "inv_id", "has_bundle": "bundle_id",
                       "start_time": "<start>", "end_time": "<end>" }],
    "invocations":  [{ "@type": "invocation", "@id": "inv_id",
                       "invocation_message": "<deploy_id>", "has_product_api": "product_api_id" }]
  }
}
```

`bundle_to_lexicon = { SERVICE: "Service", DATA: "Data", FRONTEND: "FrontEnd", CHAT: "Chat" }`. Anything else maps to `"NULL"`.

The `DEPLOY_PRODUCT_IDENTIFIER` (`229c…`) and the `Deployment` `product_api_identifier` (`a125…`) are well-known constants; do NOT regenerate them on every deploy.

---

## 7. Cross-cutting Concerns

### 7.1 AWS SDK client provisioning (local-account only)

Every AWS call uses the worker's own IAM role and a per-region SDK client constructed at cold start. There is no session factory, no credential injection, no `STS:AssumeRole`, and no `environment_token` decryption. The legacy `environmentSessionFactory(env_token, region_name)` and the matching `BotoService` wrapper are removed.

A small `AwsClients` helper memoises one client per `(service, region)` pair so workers serving multi-region deploys don't pay client-construction cost per module:

```ts
class AwsClients {
  private cache = new Map<string, unknown>();
  cf(region: string)     { return this.get("cf",     region, () => new CloudFormationClient({ region })); }
  s3(region: string)     { return this.get("s3",     region, () => new S3Client({ region })); }
  ecr(region: string)    { return this.get("ecr",    region, () => new ECRClient({ region })); }
  lambda(region: string) { return this.get("lambda", region, () => new LambdaClient({ region })); }
  // … kms, ssm, apigateway, codebuild, sfn, sns, dynamodb …
  private get<T>(service: string, region: string, build: () => T): T { /* memoised */ }
}
```

Workers receive the helper through their composition root; tests inject a mock with deterministic clients.

### 7.2 SNS topic addressing (same-account, same-region)

The CFN `NotificationARNs=` array always carries the `DeploymentNotificationTopic` ARN for the **same region as the target stack**. `DEPLOYMENT_SNS_TOPIC_ARNS_BY_REGION` is a JSON map emitted by the `RegionalNotificationStack[region]` instances and keyed by region name. All `CreateStack` / `UpdateStack` calls happen in this account, so the publishing CFN service principal and the topic share an account boundary — no cross-account topic policy is needed. Cross-region SNS ARNs are rejected before calling CloudFormation.

### 7.3 Health-metric emission

Two emitters live in `health_service`:

- `send_new_health_metric({ transaction_id, response_collection_id, status, elapsed_time, invocation_code, stack_trace? })` — `POST https://<DOMAIN_NAME>/code-health-checker/metrics` with `x-api-key` from `getApiGwInfo()` and a payload of `{ host_environment, product_identifier, product_api_identifier, transaction_id, response_collection_id, status, elapsed_time, invocation_code, product_build_hash }`. If `stack_trace` is set, **also** writes a row to `DeploymentLogsTable` so the dual-key authoriser route can serve it back to operators.
- `send_health_metric(subdomain, api_key, payload)` — legacy direct POST to `https://<subdomain>/code-health-checker/performance/metrics` with `Retry(total=3, statusForcelist=[403,404,429,500,502,503,504], method_whitelist=[HEAD,POST,OPTIONS])`. Used only by the regional SNS relay for failure narratives. Slated for removal once the new health service fully consumes both shapes.

`HealthOperationStatus` enum: `ABORTED, REQUEST_MADE, IN_PROGRESS, SUCCEEDED, FAILED, CANCELLED`.

`invocation_code`s in use: `2000` (success), `4000` (capacity / quota / token-expired), `5000` (service error).

### 7.4 Long-running command discipline

Every external call (CFN, S3, IAM, EC2, KMS, Lambda, ECR, API Gateway in this account; plus Persistence, Health, CodeBuild, SNS, SFN, DDB) is wrapped in a promise-with-timeout helper that maps timeouts and SDK errors to the appropriate tagged error. Polling loops emit progress logs before/after each poll with structured annotations (`bundle_id`, `stack_id`, `transaction_id`, `region`).

The state machine `Wait` loop for CFN `*_IN_PROGRESS` states is **60 s** between polls. The `StackDeleteWaiter` polls every **30 s** (max 120 attempts = 60 min). The `stack_rollback_complete` waiter uses `Delay=10s, MaxAttempts=60` (10 min). These are AWS-defined or AWS-recommended cadences; do not tune below them or you will get throttled.

### 7.5 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double:

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Errors are **structured tagged classes** with a discriminator (`_tag`).
- Composition is split per route so a missing env var for an unrelated route never breaks this one.

The major service layers:

- `lambda/services/deployment/` — `DeploymentRepository` (DDB CRUD on the three deployment tables), `BundleStackMappingRepository`.
- `lambda/services/cf/` — `CloudFormationService` (create/update/delete/rollback/review wrappers built on `@aws-sdk/client-cloudformation`), `StackDeleteWaiterFactory`.
- `lambda/services/codebuild/` — `CodeBuildLauncher` (legacy + docker), `CodeBuildLogService` (paginated `GetLogEvents`).
- `lambda/services/lambda/` — `LambdaCleaner` (local version reaper).
- `lambda/services/quota/` — `QuotaService` (Lambda code-storage check in this account; in-memory TTL cache, 600 s).
- `lambda/services/health/` — `HealthMetricsClient` (both v1 and legacy emitters).
- `lambda/services/api-gw/` — `ApiGwService` (resolve `SERVICE_API_KEY_ID` to the live key value at runtime), `ApiGwInfoCache` (TTL'd).
- `lambda/services/aws-clients/` — the `AwsClients` memoising helper from §7.1.
- `lambda/util/` — `awsUtils` (SSM `get_or_create`, SNS topic ARN builder), `httpUtils` (retry-wrapped `fetch`).
- `lambda/domain/bundles/` — `service`, `frontend`, `frontend_config`, `chat` (per-bundle-type pre/post hooks).

### 7.6 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=deployer-*`, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once (`@logger.injectLambdaContext({ logEvent: true })`) and stamps `bundle_id`, `transaction_id`, `stack_name`, `module_name`, `target_region` into structured log keys.
- **Metrics**: AWS Lambda Powertools metrics, namespace `deployer`. Per-handler counters for `deploy_started`, `deploy_succeeded`, `deploy_failed` with dimension `worker_type ∈ lambda|code_build`.
- **Tracing**: state machine tracing enabled (X-Ray); Lambda tracing disabled by default (`tracing.lambda: false` per the legacy serverless.yml — keep this off for cost; turn it on per-handler via env override only when debugging).
- **Sensitive-key redaction**: `api_key`, `x-api-key`, `authorization`, and `secret` are scrubbed by the Powertools structured-logger redactor on every emission. (The `environment_token`, `access_key`, `secret_key`, and `session_token` fields are no longer in the data model and would never appear in logs.)

### 7.7 Testing strategy

- Unit tests live in `test/services/**`, `test/handlers/**`, `test/state-machine/**`, `test/cdk/deployer-stack.test.ts`.
- Vitest is the test runner. `setupTests.ts` resets the deployment-status repository's in-memory test double before each test.
- A real CloudFormation engine is **not** required for unit tests — every CFN call goes through the `CloudFormationService` interface, which has a deterministic in-memory test double. The `DeleteStack` waiter is contract-tested against a `cloudformation-mock` stub.
- Step Functions Local is required for compiled-ASL tests (`scripts/start-sfn-local.sh`). `just test` (the canonical CI command) starts/stops the docker container and runs Vitest with `STATE_MACHINE_LOCAL_ENDPOINT=http://localhost:8083`.
- Integration tests in `test/integration/deployer-api.test.ts` hit a deployed stage (`DEPLOYER_API_URL`, `AWS_PROFILE`, `SERVICE_API_KEY`). The CI pipeline runs them against the dev stage on every PR to `main`.

### 7.8 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the SOCAPITAL shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- The Deployer is installed inside each tenant AWS account by the bootstrap CLI. There is one Deployer per environment.
- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI/CDK with permissions in this account for KMS, S3, DynamoDB, SNS, Step Functions, CodeBuild, IAM, API Gateway, Lambda, CloudWatch Logs, SSM, EventBridge — the same account where the bundles will be deployed.
- A pre-populated CFN parameter `Subdomain` for the deployer's custom domain (its own FQDN).
- A pre-populated CFN parameter `Regions` (JSON array; no service hardcoded default). The installer supplies every deployment region and the CDK app creates a `RegionalNotificationStack[region]` for each entry.
- A pre-populated CFN parameter `AccountDomainConfigSsmParam` pointing at Account-provided domain metadata for this tenant.
- A pre-populated CFN parameter `EnvParameters` (JSON object; defaults to `{}`).
- A pre-populated CFN parameter `ServiceApiKeyID` (the canonical operator API key minted by the upstream installer).
- A pre-populated CFN parameter `HealthApiKeyID` (the secondary key for `/deployments/logs/*` if Health is to read its own logs).
- An accessible local **Health** service at `https://<DOMAIN_NAME>/code-health-checker/metrics` (best-effort).

### 8.1.1 Bootstrap CLI contract

The bootstrap CLI is specified in `Bootstrap.md`. Deployer owns the bundle validation, CloudFormation parameter rendering, and deployment semantics reused by the CLI's local Deployer install; Bootstrap owns the user-facing command contract, manifest handling, secret redaction, resume behavior, and the switch from local Deployer install to normal `/deploy-by-token` for Puller.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # DataStack first (CDK auto-orders), then WorkflowStack, then DeployerStack
pnpm cdk:destroy          # only when deletionProtection=false (non-prod) — note this leaves
                          # the `deploy-code-<uuid>` bucket (created at runtime via SSM) in
                          # the account; clean up manually if a full reset is needed
```

Stack outputs: `DeployerApiUrl`, `DeployArtifactStateMachineArn`, `DeploymentNotificationTopicArn`, `ArtifactsBucketName`, `CodeBuildSourceBucketName`. SSM parameters created: `/deployer/api-url`, `/deployer/state-machine/deploy-artifact-arn`.

### 8.3 Smoke tests

After every deploy run:

1. `GET https://<subdomain>/infra-deployer/information` returns the `ServiceInfo` JSON.
2. `POST /deploy-by-token` with a fixture bundle from `test/fixtures/sample-bundle.zip` (presigned URL); assert `200 { bundle_id, deploy_id, transaction_id }`. The body needs only `artifacts_url` (and optionally `bundle_id`, `callback_url`, `custom_parameters`).
3. Poll `GET /deploy/<bundle_id>` every 15 s until `deploy_status ∈ {SUCCEEDED, FAILED}`. Expect `SUCCEEDED` with `bundle_details[*].status == SUCCEEDED`.
4. Confirm the optional `callback_url` (if supplied) received a `{ status: "SUCCEEDED", bundle_id }` POST.
5. Issue a deliberate failure (corrupted `update.json`), poll status, expect `FAILED` with `failed_events[]` populated and the rollback-complete CFN status reflected in `bundle_details[*].cf_status`.
6. Send a request body containing `environment_token: "x"`; assert `400 { environment_token: ["unknown field; this Deployer is local-account only"] }`.

### 8.4 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps DynamoDB / S3 / SNS in place; in-flight SFN executions continue against the new code path.
2. Re-run smoke checks.
3. Confirm no `bundle_id` is stuck in `IN_PROGRESS` past the worker-cohort budget (LARGE = 600 s pre-deployment + 1200 s per CFN step + post-deploy hooks). Audit DDB by scanning `DeploymentStatusTable` filtered by `status = "IN_PROGRESS"` and `created_at < now - 2h`; for each, manually call `states:SendTaskFailure` against the persisted `task_token` to release it.

### 8.5 Common runbook items

- **Stuck `IN_PROGRESS` bundle**: Inspect the per-stack rows. If a stack is in CFN `UPDATE_IN_PROGRESS` past 2 h, it's almost certainly a hand-edit in the AWS console blocking the operation; cancel the stack update via the console and let the SFN poll-loop pick it up on the next `GetStackStatus`.
- **`AlreadyExistsException` storm**: Two SFN executions raced for the same bundle. The `StackAlreadyExistsException` SFN catch routes back through `GetStackStatus` and falls into the update path; the second execution will finish when the first is done. Verify via the per-stack row's `task_token` that no token is orphaned.
- **`LambdaCodeStorageExceedError`**: This account's Lambda code-storage quota (~ 75 GB) is full. `CleanLambdaVersion` runs every 12 h but a manual one-shot is sometimes needed: `aws lambda invoke --function-name deployer-${stage}-cleanLambdaVersion --payload '{"transaction_id":"NULL"}' /tmp/out.json`.
- **CFN events not reaching the regional SNS relay**: Verify the stack was created via the new SFN flow and that `NotificationARNs=[<topic>]` points to the topic in the stack's own region. Stacks created by older CLI tooling won't notify the topic and have to be drained manually before re-deployed via the new flow.
- **`domain_name does not match this Deployer's Subdomain`**: The caller (typically Marketplace) is targeting the wrong tenant Deployer. Update the caller's per-tenant routing table (see `Marketplace.md` §5).
- **`unknown field environment_token`**: An old caller still sends `environment_token`. The Deployer is local-account only since the v2 PRD; have the caller drop the field. Rolling-back to a v1 Deployer is not supported.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,event-handler}`, `@aws-sdk/{client-cloudformation,client-codebuild,client-dynamodb,lib-dynamodb,client-ecr,client-iam,client-kms,client-lambda,client-s3,s3-request-presigner,client-service-quotas,client-sfn,client-sns,client-ssm,client-api-gateway}`, `@smithy/{config-resolver,node-config-provider,protocol-http}`, `csv-parse` (only if FRONTEND/CHAT bundle pre-deploy needs it), `archiver`/`yauzl` for zip in/out, built-in `fetch` for outbound HTTP. **Do NOT** depend on `@aws-sdk/credential-providers` static credentials, Fernet, or any cross-account session library — the Deployer never assumes credentials it does not have via its own role. CDK: `aws-cdk-lib`, `constructs`, `aws-cdk`. Validation library and DI conventions are the implementer's choice — the contracts in §3 and §6 must be honoured but the implementation style is unconstrained.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `deploy-by-token`, `deployment-logs`, `bundle-config`, `cfn-event`, `health-metric`, `errors`. Errors are tagged classes; everything else is type+validator pairs. The schema for `deploy-by-token` MUST reject `environment_token` as an unknown field.
4. **Utils**: `lambda/util/{awsUtils,httpUtils,zipExtract,jwtPassthrough}.ts`. JWT decoding is verify-OFF by design (the metadata is upstream-signed and we don't carry the key).
5. **Configuration**: `lambda/config/deployer.ts` (CFN parameters + env vars per §2.5). Required vars must throw at startup; optional vars must default per §2.5. JSON-decoded `Regions` and `EnvParameters` are validated at cold start; Account domain config is validated when loaded and before any service stack receives domain parameters.
6. **Services** (one file each in `lambda/services/`): Deployment (`Repository`, `BundleStackMapping`); CF (`Service`, `StackDeleteWaiter`); CodeBuild (`Launcher`, `LogService`); Lambda (`Cleaner`); Quota (`Service`); Health (`MetricsClient`); ApiGw (`InfoService`); AwsClients (`memoised regional client provider`); plus a composition module `services/index.ts` that exports per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts,responses.ts,gateway-responses.ts}`, `lambda/logging/{powertools.ts,runtime.ts}`, the three handlers (`deploy-by-token`, `deploy-status`, `deployment-logs`), the `health-api-key-authorizer`, and the `/information` mock binding in CDK.
8. **State-machine workers**: `lambda/state-machine/{pre-deployment,create-stack,update-stack,delete-stack,rollback-continue,review-changes,get-stack-status,post-bundle-success,post-bundle-failed}/handler.ts`.
9. **Reconciler**: `lambda/state-machine/deployment-event-sns-worker/handler.ts`.
10. **Operational**: `lambda/clean-lambda-version/handler.ts` plus the per-CFN-custom-resource handlers (`api-gateway-log`, `api-usage-plan`, `code-build-source`, `deployment-quota`).
11. **CDK stacks**: `lib/data-stack.ts`, `lib/workflow-stack.ts`, `lib/deployer-stack.ts` per §2.2 / §2.3 / §2.4, then `bin/app.ts`.
12. **State-machine ASL**: `lib/state-machines/deploy-artifact.asl.ts` (TypeScript builder using `aws-cdk-lib/aws-stepfunctions` or a plain ASL JSON) compiled by `WorkflowStack`.
13. **Bootstrap CLI support**: shared modules for bundle validation, parameter rendering, and local Deployer install that satisfy `Bootstrap.md`. The Deployer repo may host `cli/bootstrap.ts`, but `Bootstrap.md` is the authoritative CLI PRD.
14. **Local runners**: `scripts/start-sfn-local.sh`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared SOCAPITAL workflows.
15. **Smoke tests**: replicate the five steps from §8.3 in `test/integration/deployer-api.test.ts`, plus a CLI contract test that stubs Account/Marketplace, verifies the Deployer local-deploy plan, and verifies the Puller handoff uses `/infra-deployer/deploy-by-token`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- The Deployer **never** issues an AWS API call against an account other than its own. There is no `STS:AssumeRole`, no static-credentials provider, no cross-account session factory, and no Fernet decrypt anywhere in the code path. Audited via static analysis (no imports of `@aws-sdk/credential-providers` static factories).
- The `deploy-by-token` schema rejects `environment_token` (legacy field) with a 400 error explaining the local-account contract.
- `POST /deploy-by-token` is callback-driven: a successful end-to-end deploy keeps the SFN suspended on `WAIT_FOR_TASK_TOKEN` until the same-region `RegionalDeploymentEventRelay` releases it. Any path that busy-waits CFN status from a worker is a bug.
- `isLambdaWorker` + `getLambdaWorkerSize` produce identical decisions as the legacy implementation across the four reference sizes (61 MB, 256 MB, 1 GB, 4 GB).
- Multi-region deploys partition the bundle exactly once per region listed in `Regions`, upload to the local `deploy-code-<uuid>` bucket once per region, and run the per-stack loop in parallel (default `parallel_module_deployment=true`).
- The `StackAlreadyExistsException` and `DeploymentInProgressError` SFN catch loops do not infinite-spin; eventually they reach a terminal stack status because every CFN call ultimately moves to a `*_COMPLETE` or `*_FAILED` state and the regional SNS relay releases the task token.
- `BundleNotFoundException` from the regional SNS relay logs and skips silently — never blocks legacy deploys.
- Best-effort downstream (`Persistence`, `Health`, `Account Manager`) outages never fail a deploy; failures are logged and the deploy proceeds.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so any CommonJS dependency works at runtime.
- IAM permissions follow least-privilege per §2.4.3.
- All structured logs include the relevant `bundle_id` / `stack_id` / `transaction_id` / `target_region` so an operator can trace a single deploy end-to-end via CloudWatch Logs Insights.
- The Marketplace ↔ Deployer contract is honoured: `POST <tenant-host>/infra-deployer/deploy-by-token` with `{ artifacts_url, bundle_id, callback_url }` (and optional `custom_parameters`, `multi_region_deployment`, `force_deployment`, `legacy_deploy`) succeeds, `GET <tenant-host>/infra-deployer/deploy/<bundle_id>` returns the documented status shape, and the Deployer eventually POSTs `{ status, bundle_id, ... }` to the supplied `callback_url` exactly once on terminal success or failure. The `<tenant-host>` is always the tenant's own subdomain — Marketplace MUST route per-tenant; there is no shared central Deployer.
