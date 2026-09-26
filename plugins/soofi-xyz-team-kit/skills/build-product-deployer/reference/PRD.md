# Deployer Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Deployer** service. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to the installer-supplied home AWS region, per the Golden Path engineering standards. The current production code at `staircase/deploy` is a Python 3.9 + Serverless Framework implementation; this PRD specifies the equivalent target service in canonical form.

---

## 1. Product Overview

### 1.1 Mission

Deployer is the marketplace ecosystem's **infrastructure-deployment product**. It is the single component in the platform that actually executes AWS CDK deployments, and it does so **only against the AWS account it is itself running in**. It accepts a presigned URL to an immutable Build-produced CDK cloud assembly, validates the built artifact, publishes staged assets into the local account's CDK bootstrap resources, drives the CloudFormation deploy loop inside its own account through a single STANDARD AWS Step Functions state machine, and reports terminal status back to the originating caller (Marketplace, in normal operation) over a one-shot HTTPS `callback_url`.

Because the Deployer is local-account-only, it MUST be installed once per tenant environment — before the other marketplace products (Marketplace Puller, Persist, Connect, …) that the tenant subscribes to. The initial install is performed by the operator-run bootstrap CLI, not by Account or Marketplace: the CLI uses the tenant owner's API key to discover the latest Deployer cloud assembly artifact from Marketplace, then uses the operator's AWS profile/SSO credentials to install Deployer into the newly provisioned tenant account. After Deployer is live, every subsequent product install goes through `https://<tenant-subdomain>/infra-deployer/deploy-by-token`; Marketplace never multiplexes one Deployer across accounts.

A **bundle** is the unit of distribution, and its payload is a built CDK cloud assembly, not product source. The zip contains `marketplace.product.json`, Build's `build/build.manifest.json` provenance file, and `cdk.out/` with `manifest.json`, synthesized CloudFormation templates, asset manifests, and staged file assets. Products do **not** provide deploy commands, synth commands, `update.json` templates, Docker build scripts, per-module artifact layouts, or source files for Deployer to execute. Deployer owns artifact validation, deployment-parameter resolution, asset publication, stack selection, and CloudFormation deployment.

The runtime is **callback-driven**: every long-running CloudFormation operation suspends a Step Functions task with `WAIT_FOR_TASK_TOKEN`. CloudFormation stack events stream into an SNS topic in the same account and **the same AWS region as the target stack**; an SNS-subscribed regional relay matches each event to a persisted task token and calls `SendTaskSuccess` / `SendTaskFailure` against the home-region state machine. The Deployer never busy-waits CloudFormation.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<subdomain>/infra-deployer/`, API-key authorised (`x-api-key` per usage plan), with the capability groups below (full mapping in §3 and §4):

| Group                            | Routes                                                                                                                                  | Purpose                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Bundle deploy**                | `POST /deploy-by-token`, `POST /deploy-data-by-token`, `POST /deployments`                                                              | Start a service / data bundle deployment (single-stack or multi-stack, single-region or multi-region)  |
| **Bundle delete**                | `POST /delete-by-token`, `POST /deployments/delete`                                                                                     | Delete every CloudFormation stack for a previously deployed bundle                                      |
| **Bundle status**                | `GET /deploy/{bundle_id}`, `GET /deploy-data/{bundle_id}`, `GET /deployments/{bundle_id}`                                               | Poll terminal/in-flight bundle status with logs and per-stack details                                  |
| **Deployment logs**              | `GET /deployments/logs/{response_collection_id}?product_api_identifier=…`                                                               | Fetch buffered debug-log records for a past deployment (dual-key authoriser)                           |
| **Internal — service info**      | `GET /information`                                                                                                                      | Static service metadata (API Gateway `MOCK` integration, no API key)                                   |

Every mutating route is API-key-gated (`apiKeyRequired: true`) plus CORS preflight; the only exceptions are `GET /information` (mock) and `GET /deployments/logs/{response_collection_id}` (which authenticates via a Lambda authoriser that accepts **either** the canonical service API key **or** a separate `Health` API key, see §2.3.6).

Every successful POST that mints work returns `200` with `{ bundle_id, deploy_id, transaction_id }`. `bundle_id` is server-supplied if the caller did not provide one (a UUID) and is the canonical product-bundle identity used for status lookup and stack tagging. `deploy_id` is the per-attempt identity for that POST: deploys mint `deploy_id = dep_<ulid>` and use it as the Step Functions execution name. Callers that miss or delay the terminal `callback_url` delivery MUST reconcile through `GET /deploy/{bundle_id}` / `GET /deployments/{bundle_id}` instead of applying their own deployment-duration timeout; the Deployer status endpoint is authoritative for accepted work.

### 1.3 Non-goals

- Deployer does **not** deploy into any AWS account other than its own. There is no cross-account assume-role, no caller-supplied credential blob, no multi-tenant fan-out. To deploy into another account, install another Deployer there.
- Deployer does **not** mint, host, or sign the Build artifact. It consumes a caller-supplied presigned URL (the legacy wire field is still `artifacts_url`, but it now points to a built CDK cloud assembly), validates it with a streaming `GET` to read `Content-Length`, rejects artifacts larger than the Marketplace bundle limit (`MAX_DEPLOYER_ARTIFACT_BYTES`, default 256 MiB), and downloads the contents into ephemeral storage on the worker.
- Deployer does **not** build or synthesize product source. Build owns source normalization, Golden Path checks, CDK synth, cloud assembly portability validation, and Lambda minification/obfuscation policy validation. Deployer re-validates Build provenance and then deploys the built cloud assembly.
- Deployer does **not** own the marketplace catalog, ontology, or subscription model. That belongs to the **Marketplace** service, which is the canonical caller of `/deploy-by-token`.
- Deployer does **not** synthesise its own subdomain or ACM certificates. The `Subdomain` parameter is provided by the upstream installer (Marketplace + the marketplace-account product).
- Deployer does **not** invent its own auth identity. API keys are minted upstream; Bootstrap creates the tenant's single shared API Gateway Usage Plan and binds the service key to it. Deployer only attaches its API stage to that shared plan.
- Deployer does **not** open raw outbound SSH or run product-supplied build/deploy containers. Docker image assets are rejected in the first production contract; a future prebuilt-image contract must let Deployer publish image artifacts without building product source.
- Deployer does **not** persist Build artifacts long-term. Temporary cloud assembly extracts and deployment work objects have bounded retention. Runtime assets are published through the CDK asset publishing flow into the Deployer account's bootstrap resources, not through a product-defined artifact layout.
- Deployer does **not** perform code review / static analysis. That belongs to the **Comply** service upstream.
- Deployer does **not** bootstrap itself from its own API. The only supported self-install path is the bootstrap CLI's local deploy mode, which is constrained to the Deployer system component and uses the same cloud-assembly validation, deployment-parameter resolution, tagging, and CDK deployment semantics as a normal product deploy.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every bundle deploy compiles to a single STANDARD `DeployArtifact` state machine. Worker-size dispatch (`SMALL | MEDIUM | LARGE`), per-region fan-out, artifact validation, asset publication, stack deployment, rollback continuation, and post-success/failure reconciliation are expressed exclusively as ASL primitives (`Choice`, `Map`, `Wait`, `Retry`, `Catch`, `WAIT_FOR_TASK_TOKEN`). There is no second workflow runtime, no in-Lambda step orchestrator, no SQS-chained worker fan-out.
2. **CloudFormation status is callback-driven, not polled.** Each CDK Toolkit stack deploy task is invoked with `arn:aws:states:::lambda:invoke.waitForTaskToken`; the worker configures the underlying CloudFormation operation in the target region with `NotificationARNs=[<regional DeploymentNotificationTopic ARN>]` and persists the task token on the stack-deployment row. CloudFormation stack events arrive via the same-region SNS topic to `RegionalDeploymentEventRelay`, which resolves the task token from the home-region DynamoDB tables and calls `states:SendTaskSuccess` / `states:SendTaskFailure` on the home-region state machine. The state machine resumes only when CloudFormation reaches a terminal status. The only places that explicitly wait are `Wait 60s` loops between status reconciliation attempts for transient `*_IN_PROGRESS` states.
3. **Same-account deployment, explicit parameter plumbing.** Every CloudFormation, S3, IAM, KMS, Lambda, ECR, and CDK Toolkit action targets the Deployer's **own** account (the one its Lambdas execute in) using the worker's own IAM role. There is no Fernet decrypt, no `STS:AssumeRole`, no static-credential provider, and no cross-account session factory. Per-environment configuration (`Subdomain`, `Regions`, default parameter overrides) is sourced from CFN install-time parameters and SSM at cold start; account domain metadata is fetched from the Bootstrap-created SSM parameter and supplied only to Build-declared CloudFormation parameters. Per-call overrides come from the request body's `custom_parameters` field (§3.5) and are applied only to declared deployment parameters. To deploy into a different AWS account, install another Deployer in that account.
4. **CDK cloud assembly execution is the deploy engine.** Deployer invokes the AWS CDK Toolkit Library directly from controlled workers, or an equivalent platform asset publisher over the CDK cloud assembly schema, for asset publishing, stack deployment, diff/status lookup, and rollback-related operations. Product artifacts never supply shell commands, CDK CLI commands, source files, or build hooks.
5. **Build provenance is mandatory for production deploys.** Deployer validates `service-builder.artifact_kind = "CDK_CLOUD_ASSEMBLY"`, `deployer_contract_version = "1"`, source/assembly/artifact hashes, template/file-asset hashes, deployment parameters, component/type fields, and `lambda_asset_policy = { minified: true, obfuscated: true, source_maps: false }` before publishing assets or creating CloudFormation changes. Test fixtures may bypass this only through explicit test-only configuration.
6. **Worker right-sizing is explicit and bounded by Marketplace.** Pre-deployment worker memory/disk cohorts are `SMALL = 384 MB`, `MEDIUM = 1024 MB + 1024 MB ephemeral`, `LARGE = 5120 MB + 9216 MB ephemeral`, dispatched by `Choice` on `worker_size` derived from `Content-Length(artifacts_url) * 3`. Deployer rejects Build artifacts whose `Content-Length > MAX_DEPLOYER_ARTIFACT_BYTES` (default 256 MiB, matching Marketplace's `MAX_BUNDLE_BYTES`) before starting any deploy. Oversized artifacts do not fall back to product-supplied commands or arbitrary build scripts.

### 2.1 Stacks (AWS CDK)

The CDK app is composed of three stacks deployed in order:

```
bin/app.ts
├── DataStack                         # Home-region KMS CMK, S3 buckets,
│                                     # four DynamoDB tables
├── WorkflowStack                     # Home-region DeployArtifact STANDARD state
│                                     # machine, CDK Toolkit runner roles
├── DeployerStack                     # Home-region Lambdas, REST API + IAM
│                                     # authorisers, API Gateway custom resources,
│                                     # /information mock, clean-lambda-version schedule
└── RegionalNotificationStack[region] # One stack per configured deployment region:
                                      # same-region SNS topic, relay Lambda,
                                      # and regional deploy-code bucket
```

`DeployerStack.addDependency(workflowStack); workflowStack.addDependency(dataStack)` ensures storage deploys first, then orchestration, then routing. Every `RegionalNotificationStack[region]` depends on `WorkflowStack` so its relay can target the home-region state machine and tables. All stacks are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per `cloud-aws-primary`).

### 2.2 DataStack contents

#### 2.2.1 KMS

- **`DataKey`** — symmetric customer-managed key (alias `alias/CodeDeployerDbCollections`) used to encrypt every DynamoDB table. Key policy grants the account root `kms:*`, the Lambda runtime role `kms:Encrypt|Decrypt|ReEncrypt*|GenerateDataKey*|DescribeKey` on `*`, plus `kms:CreateGrant|ListGrants|RevokeGrant` constrained by `kms:GrantIsForAWSResource=true`.

#### 2.2.2 Storage

| Bucket                  | Encryption / ACL                                                                                                              | Lifecycle               | Purpose                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ArtifactsBucket`       | S3-managed AES-256 encryption, `BLOCK_ALL` public access, SSL-only via bucket policy with `aws:SecureTransport=false` deny    | `ExpirationInDays: 14`  | Temporary Build artifact extracts, CDK cloud assemblies, deployment summaries, and status artifacts                              |
| `CdkRunnerCacheBucket`  | S3-managed AES-256 encryption, `BLOCK_ALL` public access, SSL-only `ListBucket` deny                                          | lifecycle per stage     | Deployer-owned cache for CDK Toolkit runner inputs; never a product-defined artifact store                                      |
| `DeployCodeBucket`      | S3-managed AES-256 encryption, `BLOCK_ALL` public access, SSL-only via bucket policy with `aws:SecureTransport=false` deny    | lifecycle per stage     | Backward-compatible name for Deployer-owned deployment working files; CDK assets are published to CDK bootstrap resources       |

The `ArtifactsBucket` policy explicitly grants the Deployer's runtime role `s3:GetBucketLocation|ListBucket|ListBucketMultipartUploads|GetObject|GetObjectTagging|ListMultipartUploadParts` so the API can presign `artifact_url`s in the status response.

> **Note on deployment working storage.** CDK assets are published to the account's CDK bootstrap bucket/ECR repository through the CDK Toolkit Library or platform cloud-assembly deployer. Deployer-owned buckets are only for temporary Build artifact extracts, cloud assemblies, runner cache, and status artifacts; Marketplace artifacts do not define deploy-code buckets or artifact destinations.

#### 2.2.3 DynamoDB

All tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled. Three of the four enable TTL on `expire_at`.

| Table                              | Keys                                  | Indexes | TTL          | Purpose                                                                                                                 |
| ---------------------------------- | ------------------------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `DeploymentStatusTable`            | `bundle_id` (S), `stack_id` (S)        | —       | `expire_at`  | Per-stack deployment status row; `stack_id="root"` is the bundle-level row carrying the `task_token` for SNS callbacks |
| `StackBundleMapTable`              | `stack_id` (S)                         | —       | `expire_at`  | Reverse index from CloudFormation stack ARN → `bundle_id` (used by the regional SNS relay)                             |
| `DeploymentLogsTable`              | `response_collection_id` (S), `product_api_identifier` (S) | — | `expire_at`  | Buffered debug log records (`stack_trace`, `error`) keyed by `(bundle_id, product_api_identifier)`                     |

Default TTL for transient rows is **30 days** from creation (`get_ttl()`). Item shapes mirror §6.

#### 2.2.4 Regional CloudFormation notification fabric

- **`RegionalNotificationStack[region]`** — deployed once for every region listed in `Regions` (including the home region). It creates a same-region `DeploymentNotificationTopic` and a `RegionalDeploymentEventRelay` Lambda.
  - Topic name: `DeploymentNotification`.
  - CloudFormation `CreateStack` / `UpdateStack` calls MUST select the topic ARN whose region equals the target stack region. A cross-region SNS ARN is never valid in `NotificationARNs`.
  - **Topic policy** is account-local: only `cloudformation.amazonaws.com` from this account is allowed `sns:Publish`. There is no cross-account / org-wide grant.
  - The relay Lambda runs in the notification region, parses the stack event, then uses SDK clients configured for the Deployer home region to read/write `DeploymentStatusTable` + `StackBundleMapTable` and call `states:SendTaskSuccess` / `states:SendTaskFailure`.

### 2.3 WorkflowStack contents

#### 2.3.1 IAM roles

- **`StateMachineRole`** — assumed by `states.amazonaws.com`, holds `lambda:InvokeFunction`, scoped permissions to invoke CDK runner workers, and `events:*` on `*`.
- **`CdkToolkitRunnerRole`** — assumed by the Deployer-owned CDK runner workers. It holds the local-account permissions needed by the AWS CDK Toolkit Library or platform cloud-assembly deployer to publish assets and deploy stacks: CloudFormation create/update/delete/describe/change-set actions, S3 access to the Deployer working buckets and CDK bootstrap file-asset bucket, ECR push/read permissions to CDK bootstrap image-asset repositories when the platform later supports prebuilt image assets, IAM pass-role for `CloudformationExecRole`, and DynamoDB/KMS writes for deployment status. It never assumes caller-supplied roles and never executes product-supplied command strings.
- **`CloudformationExecRole`** — assumed by `cloudformation.amazonaws.com` with `Action: "*"` / `Resource: "*"`. Lives in this stack (the Deployer's own account, which is also the deployment target) and is `iam:PassRole`-passed to CloudFormation by every `CreateStack` / `UpdateStack` call. Declared statically in CDK; never created at runtime.
- **`CloudWatchRole`** — API Gateway → CloudWatch Logs role.

#### 2.3.2 CDK Toolkit runner

Deployer owns a CDK cloud assembly runner used by the `PreDeployment*` workers. The runner is a TypeScript module, not a shell command wrapper. It:

- extracts the immutable Build cloud assembly artifact into a temporary workspace;
- validates `cdk.out/manifest.json`, stack templates, asset manifests, hashes, and deployment parameters;
- resolves Build-declared CloudFormation parameters from Deployer configuration and the request body;
- invokes the AWS CDK Toolkit Library or platform cloud-assembly deployer programmatically for asset publishing, deploy, diff/status lookup, and destroy operations;
- writes cloud assembly metadata and stack-deployment summaries back to `ArtifactsBucket` for status APIs.

The runner MUST NOT call `npx cdk`, `pnpm cdk:*`, `pnpm install`, arbitrary package scripts, `marketplace/app.ts`, or product-declared command strings. Product source and `package.json` scripts are not present in a valid deployment artifact.

#### 2.3.3 Step Functions: `DeployArtifact`

A STANDARD state machine, X-Ray tracing enabled, no execution-history output (`noOutput: true`). High-level shape:

```
WorkerSizeCheck (Choice on $.worker_size)
  ├── SMALL   → PreDeploymentSmall
  ├── MEDIUM  → PreDeploymentMedium
  └── LARGE   → PreDeploymentLarge   (default)
         ↓
DeployStacksWithCdkToolkit (Map over $.prepared_stacks with MaxConcurrency=1)
         ↓ (per item)
CdkDeployStack (lambda:invoke.waitForTaskToken, 21600s)
         ├── transient CloudFormation/CDK status → Wait 60s → CdkDeployStack
         └── terminal failure                    → PostFailedDeployment → BundleDeploymentFail
         ↓
PostSuccessfulDeployment (lambda, 1800s) → BundleDeploymentSuccess
                  └── catch PostDeploymentFailure → BundleDeploymentFail
```

Per-task standards:

- `Lambda.ServiceException | Lambda.AWSLambdaException | Lambda.SdkClientException | Lambda.TooManyRequestsException | Lambda.Unknown` retry: `IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`.
- `AWSTooManyRequestsException | AWSServiceException | AWSServiceUnavailableException | AWSThrottlingException | AWSGeneralServiceException` retry: `IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`.
- `DeploymentInProgressError` catch on CDK/CloudFormation stack deployment → `Wait 60s` and retry status/deploy reconciliation.
- `StackAlreadyExistsException` is treated as a normal CDK update path.
- `States.ALL` catch at the Map level → `PostFailedDeployment`.

Total state machine timeout is unbounded. Per-task timeouts are intentionally longer than the downstream AWS operation budgets they supervise: pre-deployment 600 s; asset/deploy wait-for-token tasks 21600 s (6 h); status reconciliation waits are 60 s; post-success and post-failed 1800 s (30 m).

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
| **Custom resources**     | `ApiGatewayLogCustomResource`, `ApiUsagePlanStageAttachmentCustomResource`                                                                                     | 128–256 MB         | 30 s    | —   | CloudFormation custom resources                                                                                                      |

Per-handler `PRODUCT_API_IDENTIFIER` UUIDs are stable and well-known so the upstream **Health** service can correlate metrics to the responsible Deployer code path. The PRD does not enumerate them; the implementation MUST keep them stable across releases (changing one is a breaking observability change).

#### 2.4.2 Routing fabric

- **REST API** (`RestApi` `DeployerApi`) with default stage `${stage}` (default `dev`), regional endpoint type, CORS pre-flight for `*`, dedicated access log group, and `DisableExecuteApiEndpoint: true` (the API is reachable only via the deployer-supplied custom domain). Routes:
  - `POST /deploy-by-token` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `POST /deploy-data-by-token` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `POST /deployments` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`.
  - `POST /delete-by-token` and `POST /deployments/delete` → `LambdaIntegration(DeployByTokenHandler)` with `apiKeyRequired: true`; same request/auth shape as deploy, but `operation="DELETE"` and Deployer destroys only the stacks recorded for the bundle.
  - `GET /deploy/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deploy-data/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deployments/{bundle_id}` → `LambdaIntegration(DeployStatusHandler)` with `apiKeyRequired: true`.
  - `GET /deployments/logs/{response_collection_id}` → `LambdaIntegration(DeploymentLogsHandler)` with **token-based Lambda authoriser** `HealthApiKeyAuthorizer` (`identitySource = "method.request.header.x-api-key"`).
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON.
  - `GatewayResponse` rules normalise `INVALID_API_KEY` (`"API key is not valid"`), `DEFAULT_4XX` (`"Request has been declined."`), and `DEFAULT_5XX` per §3.1, all with `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` and `*` CORS.
- **API Gateway custom domain mapping** under base path `infra-deployer` against the Bootstrap-created tenant custom domain (`AWS::ApiGateway::BasePathMapping` for the REST API). The Deployer stack must not create the shared API Gateway `DomainName`; Bootstrap creates it before the local Deployer install.
- **API Gateway custom resources** (CFN `Custom::*` types):
  - `ApiUsagePlanStageAttachmentCustom` — reads the Bootstrap-managed shared Usage Plan id from `SharedUsagePlanIdSsmParam` (default `/account/shared-usage-plan-id`) and idempotently adds this API stage to that plan. It MUST NOT create a Usage Plan or bind an API key; Bootstrap owns the single `UsagePlanKey`.
  - `ApiGatewayLogCustom` — wires the API Gateway access log group, enabling `apiGateway: true` tracing-style logs at the stage level.
  - No custom resource uploads product deploy workers or product source bundles. Deployer's CDK runner is packaged as normal Lambda code in `WorkflowStack`.

#### 2.4.3 IAM (high-level)

- The provider role is **never** wildcarded across services. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- The `DeployByTokenHandler` role has: `dynamodb:{Get,Put,Update,Query}Item` on `DeploymentStatusTable` + `StackBundleMapTable`, `kms:{Encrypt,Decrypt,GenerateDataKey,DescribeKey}` on `DataKey`, `states:StartExecution` on the `DeployArtifact` ARN, and `apigateway:GetApiKey` (for surfacing API GW info into health metrics; see §7.4).
- The `DeployStatusHandler` role has: `dynamodb:{Get,Query}Item` on `DeploymentStatusTable`, `s3:GetObject` + `s3:PutObject` (presign) on `ArtifactsBucket/*`, and `logs:GetLogEvents` for Deployer-owned Lambda log groups.
- The `DeploymentLogsHandler` role has: `dynamodb:Query` on `DeploymentLogsTable`.
- The state machine workers (`Pre/CdkDeployStack/Delete/Rollback/GetStatus/PostSuccess/PostFailed`) hold the union of permissions they need against the local account: `dynamodb:{Get,Put,Update}Item` on `DeploymentStatusTable` + `StackBundleMapTable`, scoped `s3:GetObject|PutObject|DeleteObject|ListBucket|GetBucketLocation` on `ArtifactsBucket`, `CdkRunnerCacheBucket`, and CDK bootstrap file-asset buckets, `kms:*` on `DataKey`, CDK Toolkit-required `cloudformation:{CreateStack,UpdateStack,DeleteStack,DescribeStacks,DescribeStackResources,ListStackResources,ListChangeSets,ExecuteChangeSet,ContinueUpdateRollback,GetTemplate}` on `*`, `iam:PassRole` on `CloudformationExecRole` only, optional ECR asset-publishing actions only when the platform later supports prebuilt image assets, `cloudwatch:{DeleteLogGroup,DescribeLogGroups}` on `*`, `apigateway:*` on `*` only for `update_information_api` and the Deployer's own API custom resources, `lambda:{ListFunctions,GetFunction,InvokeFunction}` on the `CleanLambdaVersion` ARN, `ssm:{GetParameter,GetParametersByPath}` on the `/deployer/*`, `/account/*`, and CDK bootstrap parameter prefixes needed by the runner, `states:SendTaskSuccess` + `states:SendTaskFailure` on `*` (Step Functions does not support resource-level constraints here), and `service-quotas:GetServiceQuota|RequestServiceQuotaIncrease` on `*`. Service API mappings are created by the deployed service stacks, not by Deployer post-deploy copy hooks.
- Each `RegionalDeploymentEventRelay` role holds `dynamodb:{Get,Put,Update}Item` on the home-region `DeploymentStatusTable` + `StackBundleMapTable` and `states:SendTaskSuccess` + `states:SendTaskFailure` on the home-region `DeployArtifact` state machine executions.
- `iam:PassRole` is granted on `CloudformationExecRole` only (passed to CloudFormation by every `CreateStack` / `UpdateStack`).
- The `CleanLambdaVersion` role holds `lambda:ListFunctions|ListVersionsByFunction|DeleteFunction` and `lambda:ListLayers|ListLayerVersions|GetLayerVersion|DeleteLayerVersion` on `*`. There is no cross-account variant — it only reaps versions in this account.
- The `HealthApiKeyAuthorizer` role holds `apigateway:GET` on `arn:aws:apigateway:<region>::/apikeys/{HEALTH_API_KEY_ID}` and `ssm:GetParameter` on `/account/current-service-api-key` to compare the canonical tenant service key.
- Each regional `DeploymentNotificationTopicPolicy` allows `sns:Publish` from `cloudformation.amazonaws.com` with `Condition: aws:SourceAccount == <this account>` only — no cross-account publishers.

### 2.5 Configuration surface

The Deployer runtime is configured exclusively via its own CDK parameters (CloudFormation `Parameters`) and env vars (read once on cold start; missing required values must fail closed).

CloudFormation parameters supplied to the Deployer install by the upstream installer:

| Parameter            | Default                                | Purpose                                                                                                                                  |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Subdomain`          | required                               | Tenant FQDN whose API Gateway custom domain was created by Bootstrap; Deployer mounts itself at base path `infra-deployer` and supplies the same FQDN to Build-declared stack parameters. |
| `Regions`            | required JSON-encoded array             | Active regions this Deployer fans bundles into when `multi_region_deployment=true`. Each entry is `{ "RegionName": "<region>", ...<per-region CFN param overrides> }`; the installer must include the home region if local-only deploys should be allowed. |
| `AccountDomainConfigSsmParam` | `/account/domain-config` (string)      | SSM parameter containing Account's domain-config endpoint or cached domain-config JSON for this tenant. Deployer resolves it before stack deployment and supplies needed values to declared parameters. |
| `EnvParameters`      | `{}` (JSON-encoded object)             | Per-environment non-secret defaults available to declared deployment parameters for every deploy (e.g. `{ "VpcId": "vpc-…", "LogBucketName": "…" }`). Merged below request-body `custom_parameters`. |
| `SharedUsagePlanIdSsmParam` | `/account/shared-usage-plan-id`        | SSM parameter containing the Bootstrap-created tenant Usage Plan id; Deployer attaches its API stage to that plan                         |
| `HealthApiKeyID`     | `null`                                 | Secondary API key accepted by `HealthApiKeyAuthorizer` for `/deployments/logs/*`                                                         |
| `ProductName`        | `Deploy`                               | Cost-tag value used on every taggable resource as `sc:product:name`                                                                      |
| `ServiceInfo`        | `null`                                 | JSON string returned verbatim by `GET /information` and used as the `Nonce` for custom resources                                          |
| `BuildHash`          | `null`                                 | Build identifier stamped into every health-metric emission                                                                               |
Env vars (Lambda-level):

| Key                                         | Default                                                  | Used by                                      |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `DEPLOY_PRODUCT_IDENTIFIER`                 | `229c0982-b5fe-4d4c-8f9e-80ad38f5d4b8` (lexicon-stable)  | Health metrics                               |
| `PRODUCT_API_IDENTIFIER`                    | per-handler UUID                                         | Health metrics                               |
| `SHARED_USAGE_PLAN_ID_SSM_PARAM`            | from `SharedUsagePlanIdSsmParam`                         | API Gateway shared Usage Plan stage attachment |
| `HEALTH_API_KEY_ID`                         | from CFN parameter                                       | `HealthApiKeyAuthorizer`                     |
| `DOMAIN_NAME`                               | from `Subdomain`                                         | Health outbound calls; also the canonical `Subdomain` CFN param value |
| `REGIONS`                                   | from `Regions`                                           | `PreDeploymentWorker` multi-region planner   |
| `ACCOUNT_DOMAIN_CONFIG_SSM_PARAM`           | from `AccountDomainConfigSsmParam`                       | Domain metadata lookup for deployment parameter resolution |
| `ENV_PARAMETERS`                            | from `EnvParameters`                                     | Default context parameter bag for every deploy |
| `MAX_DEPLOYER_ARTIFACT_BYTES`               | `268435456` (256 MiB)                                    | Hard upper bound; must match Marketplace `MAX_BUNDLE_BYTES` |
| `ACCOUNT_ID`                                | `AWS::AccountId`                                         | Regional SNS topic ARN composition           |
| `KMS_KEY_ARN`                               | `DataKey.Arn`                                            | DDB encryption                               |
| `BUILD_HASH`                                | from CFN parameter                                       | Health                                       |
| `DEPLOY_ARTIFACT_SF`                        | `DeployArtifact` ARN                                     | `DeployByTokenHandler`                       |
| `ARTIFACTS_BUCKET_NAME`                     | bucket name                                              | `DeployByTokenHandler`, status presign       |
| `DEPLOYMENT_SNS_TOPIC_NAME`                 | `DeploymentNotification`                                 | Regional topic-ARN composer                  |
| `DEPLOYMENT_SNS_TOPIC_ARNS_BY_REGION`       | JSON map from `RegionalNotificationStack` outputs         | CFN `NotificationARNs` used during CDK deploy |
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

### 3.2 Cloud assembly artifact structure (Build artifact responsibility)

The `artifacts_url` wire field MUST resolve to an immutable `application/zip` CDK cloud assembly artifact produced by Build and re-hosted by Marketplace. The field name is retained for client compatibility, but the payload is built deployment output. Deployer MUST reject source snapshots, legacy prebuilt bundle shapes that rely on `config.json`, `artifacts/<module>/update.json`, product-supplied synth commands, product-supplied deploy commands, product-owned Docker deployment scripts, or any artifact that requires Deployer to execute product source.

The S3 object metadata MUST include a JWT-shaped `x-amz-meta-service-builder` block with:

- `artifact_kind = "CDK_CLOUD_ASSEMBLY"`;
- `deployer_contract_version = "1"`;
- `component_id` and `bundle_type` matching `marketplace.product.json`;
- `source_hash`, `normalized_source_hash`, `assembly_hash`, `assembly_manifest_hash`, and `artifact_hash`;
- template and file-asset hashes under `cloud_assembly`;
- required and optional deploy-time values under `deployment_parameters`;
- `lambda_asset_policy.minified = true`;
- `lambda_asset_policy.obfuscated = true`;
- `lambda_asset_policy.source_maps = false`.

Required layout:

```
cloud-assembly.zip
├── marketplace.product.json
├── cdk.out/
│   ├── manifest.json              # CDK cloud assembly manifest
│   ├── tree.json
│   ├── <StackName>.template.json
│   ├── <asset-manifest>.assets.json
│   └── asset.<file-asset-hash>/    # staged, built file assets
└── build/
    └── build.manifest.json        # Build provenance, hashes, checks, Lambda asset policy
```

`marketplace.product.json` is declarative only:

```jsonc
{
  "component_id": "connect",
  "component_name": "Connect",
  "bundle_type": "SERVICE | DATA",
  "context_schema_version": "1",
  "stacks": ["NetworkStack", "ConnectStack"],
  "base_path": "connector-jobs",
  "requires": {
    "domain": true,
    "shared_usage_plan": true,
    "identity": false
  },
  "lambda_asset_policy": {
    "minified": true,
    "obfuscated": true,
    "source_maps": false
  }
}
```

The manifest MUST NOT contain command strings. There is no `entrypoint`, `synth_command`, `deploy_command`, `post_deploy_command`, shell hook, or arbitrary executable lifecycle field in the deploy artifact. Deployer owns deployment-parameter resolution, asset publishing, and deployment.

Build-time source still uses `marketplace/app.ts`, but that file is consumed by Build only. Deployer receives the resulting CloudFormation templates and resolves the deployment parameters declared by Build. Required `MarketplaceContext` values are represented as CloudFormation parameters in the templates and listed in `service-builder.deployment_parameters`.

For TypeScript/JavaScript Lambda functions, the cloud assembly artifact must contain staged assets generated through the approved platform construct package validated by Build. Deployer re-runs the Lambda asset policy check against the staged file assets in `cdk.out` and fails the deployment before any CloudFormation side effect if a Node.js Lambda asset lacks minification, obfuscation, or source-map stripping.

`bundle_type` controls validation and post-deploy handling:

- `SERVICE`: no Deployer-owned custom-domain copy hook. Each service CloudFormation template consumes Build-declared parameters for domain, base path, and shared usage-plan handles to define only its own base-path mapping (`AWS::ApiGateway::BasePathMapping` for REST APIs, or `AWS::ApiGatewayV2::ApiMapping` for future API Gateway v2 APIs). `PostDeploymentServiceBundleSuccess` is limited to service metadata / information API refresh work and MUST NOT create, copy, delete, or mutate the shared API Gateway custom domain or mappings outside the stack it just deployed.
- `DATA`: no Deployer-owned post-deploy hook. Data bundles are expected to provision their own storage/import resources; graph ingestion, when needed, is handled by the deployed component calling the Persist service's SigV4 `/persist/*` API directly.

### 3.3 Per-environment configuration source

The Deployer is configured exclusively through CFN install-time parameters and SSM. There is no per-call credential plumbing.

| Source                                | Provides                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CFN parameter `Subdomain`             | Tenant FQDN for the Bootstrap-created API Gateway custom domain. Supplied to matching CloudFormation parameters declared in the Build manifest and, for non-home regions, region-adjusted before stack deployment. |
| CFN parameter `Regions`               | JSON array of `{ "RegionName": <region>, ...<per-region CFN param overrides> }`. Honoured only when the request body has `multi_region_deployment=true`. |
| Bootstrap domain config               | Tenant-account SSM parameter written by Bootstrap after it creates the shared API Gateway custom domain. Resolved before stack deployment and supplied to matching CloudFormation parameters. Service stacks consume these values to create their own base-path mapping only. |
| CFN parameter `EnvParameters`         | JSON object of default non-secret product configuration applied to every deploy (e.g. `VpcId`, `LogBucketName`, third-party endpoints).       |
| Request body field `custom_parameters` | Per-call non-secret overrides; merged on top of `EnvParameters` (request wins) and supplied only to Build-declared CloudFormation parameters. |
| CDK bootstrap resources               | CDK asset bucket, ECR repository, and deployment roles required by the CDK Toolkit Library. Deployer validates the bootstrap contract before asset publish/deploy instead of inventing per-product artifact buckets. |
| SSM `/deployer/state-machine/deploy-artifact-arn` | Published by `WorkflowStack`; consumed by the public API handler.                                                                      |

Effective deploy-time parameter resolution:

```ts
type ResolvedDeploymentParameters = {
  schemaVersion: "1";
  bundleId: string;
  deployId: string;
  transactionId: string | "NULL";
  componentId: string;
  componentName: string;
  bundleType: "SERVICE" | "DATA";
  version?: string;
  commitHash?: string;
  sourceHash: string;
  assemblyHash: string;
  tenant: {
    accountId: string;
    region: string;
    subdomain: string;
  };
  domain: {
    domainName: string;
    customDomains: string[];
    hostedZoneId: string;
    certificateArn: string;
    apiGatewayRegionalDomainName: string;
    apiGatewayRegionalHostedZoneId: string;
  };
  basePath?: string;
  sharedUsagePlanIdSsmParam: string;
  serviceInfo: Record<string, unknown>;
  customParameters: Record<string, unknown>;
  cloudFormationParameters: Record<string, string>;
};
```

Before constructing this object, Deployer resolves the tenant-domain config from `AccountDomainConfigSsmParam`, which Bootstrap writes inside the tenant account after creating the shared API Gateway custom domain. Account remains the source of truth for DNS/certificate inventory, but Deployer deploys against the already-created API Gateway domain. The domain fields are standardized across every service artifact as Build-declared parameters so service CloudFormation templates can declare their own base-path mapping to the existing domain and MUST NOT create another API Gateway custom domain.

`EnvParameters`, per-region `Regions[i]` overrides, and request `custom_parameters` are merged in that order, with request values winning, but Deployer supplies only keys that Build declared under `service-builder.deployment_parameters`. Missing required values fail before asset publication. Deployer does not synthesize CDK or infer undeclared parameters.

> **No caller-supplied credentials.** The Deployer's Lambdas and CDK Toolkit workers rely entirely on their own IAM roles (§2.4.3) to call CloudFormation, S3, IAM, KMS, ECR, and Lambda. Runtime configuration moves through Build-declared CloudFormation parameters, Deployer-owned worker configuration, and SSM Parameter Store. Sensitive values, when a product genuinely needs them, are read from SSM Parameter Store or Secrets Manager using deployed-resource roles; they are not passed through request payloads or ad-hoc environment blobs.

### 3.4 Deploy types (worker dispatch)

| Path                   | Worker             | When                                                                                                                                                                                            |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CDK cloud assembly deploy** | Step Functions     | `Content-Length(artifacts_url) <= MAX_DEPLOYER_ARTIFACT_BYTES`. Worker size dispatched by `WorkerSizeCheck` after multiplying content length by 3 for unzip, validation, asset publishing, and template handling headroom. |

`get_cdk_worker_size(size_bytes_x3)` returns `SMALL` (≤ 78,000,000 B), `MEDIUM` (≤ 384,000,000 B), `LARGE` (≤ 3,000,000,000 B), and raises `LambdaWorkerSizeExceedError` for anything larger. That exception is a validation failure, not a fallback to product-supplied commands.

`is_cdk_worker(body, size)` first requires a present `Content-Length` and `size <= MAX_DEPLOYER_ARTIFACT_BYTES`; violations return `400 BundleTooLarge` before any worker starts. The request schema rejects `legacy_deploy` and any other attempt to select a different deploy engine.

### 3.5 Request body — `POST /deploy-by-token` / `POST /deploy-data-by-token` / `POST /deployments`

```ts
{
  bundle_id?:       string,                          // optional; UUID minted server-side if absent
  transaction_id?:  string,                          // optional; caller-supplied correlation ID; defaults to bundle_id
  artifacts_url:    string,                          // required; presigned Build cloud assembly artifact URL pattern
  callback_url?:    string,                          // default "null"; webhook fired once on terminal status
  log_level?:       "INFO" | "DEBUG",                // default INFO
  configuration?: {
    limit_check_on_pre_deployment?: boolean          // default false
  },
  force_deployment?:        boolean | null,
  multi_region_deployment?: boolean | null,          // gates fan-out across the configured `Regions`
  custom_parameters?:       Record<string, string>,  // non-secret context overrides; merged on top of `EnvParameters`
  domain_name?:             string,                  // optional; if present MUST equal this Deployer's `Subdomain`
  parallel_deployment?:     boolean                  // optional alias kept for clients that use this naming
}
```

Validation runs in this order:

1. Schema decode. The request schema is closed: unknown fields are rejected with `400 BadRequest` before any artifact download or AWS write. Accepted caller-controlled fields are limited to the contract in §3.5. `legacy_deploy`, command fields, and deploy-engine selectors are rejected.
2. `validate_artifacts_url` — regex match against `PRESIGNED_S3_URL_PATTERN` plus a streaming `GET` (`timeout=3s, allow_redirects=false`) to assert reachability, capture `Content-Length` (cached in `ARTIFACT_SIZE_MAP[url]`), and decode the `service-builder` metadata headers. Missing `Content-Length` or `Content-Length > MAX_DEPLOYER_ARTIFACT_BYTES` returns `400 BundleTooLarge`; missing or incompatible Build provenance, including any artifact kind other than `CDK_CLOUD_ASSEMBLY`, returns `400 BuildProvenanceInvalid`.
3. If `domain_name` is present, assert `domain_name === <this Deployer's Subdomain>`; otherwise return `400 { domain_name: ["does not match this Deployer's Subdomain"] }`. This catches misrouted calls (e.g. Marketplace targeting the wrong tenant's Deployer) before any side effect.

Any failure returns `400 {<field>: [<msg>, …]}`.

### 3.6 Status statuses

`DeploymentOpStatusTypes` (vended through DynamoDB rows and the wire `deploy_status` field):

| Value             | Meaning                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `REQUEST_MADE`    | Initial state immediately after API accepts the request and writes the root row.                                                      |
| `PRE_DEPLOYMENT`  | Set by `PreDeploymentWorker` once it begins downloading, validating, resolving parameters, and preparing the cloud assembly artifact; carried on every per-stack row at creation time. |
| `IN_PROGRESS`     | Set by CDK Toolkit deploy workers once CloudFormation has accepted the stack change.                                                       |
| `SUCCEEDED`       | Set by `PostSuccessDeploymentWorker` on terminal success of the entire bundle, **and** by the regional SNS relay on per-stack `*_COMPLETE` events. |
| `FAILED`          | Set by the regional SNS relay on per-stack `*_FAILED` / `*_ROLLBACK_COMPLETE` events, and by `PostFailedDeploymentWorker` on terminal bundle failure. |

Marketplace's wire-status semantics (consumed via `GET /deploy/{bundle_id}`):

- `IN_PROGRESS` is reported when the root row is in `REQUEST_MADE | PRE_DEPLOYMENT | IN_PROGRESS`.
- `SUCCEEDED` and `FAILED` are reported as-is.
- Marketplace's `CAN_BE_REDEPLOYED_STATUSES_FROM_DEPLOYER = ["FAILED", "FAULT", "STOPPED", "TIMED_OUT"]` remains valid for terminal failures surfaced by the CDK Toolkit path.

### 3.7 Error catalogue

Implementation-level error tags (MUST be a tagged class hierarchy with a `_tag` discriminator):

| Tag                                 | HTTP / SFN handling                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationError`                   | 400 with field issues.                                                                                                           |
| `LambdaWorkerSizeExceedError`       | Internal sizing guard after the platform size check; surfaced as `BundleTooLarge` if reached.                                   |
| `BundleTooLarge`                    | 400 when `Content-Length` is missing or exceeds `MAX_DEPLOYER_ARTIFACT_BYTES`; Deployer does not accept bundles larger than Marketplace. |
| `BuildProvenanceInvalid`            | 400 when `service-builder` metadata is missing, not a CDK cloud assembly, has the wrong deployer contract version, mismatched component/type fields, or hashes that do not match the downloaded artifact. |
| `CloudAssemblyInvalid`              | 400 when `cdk.out/manifest.json`, stack templates, asset manifests, staged file assets, deployment parameters, or CDK bootstrap references do not match the Build manifest or cannot be deployed by Deployer. |
| `LambdaAssetPolicyViolation`        | 400 before CloudFormation side effects when built asset validation finds a Node.js Lambda asset that is not minified, obfuscated, and source-map-free per Build metadata. |
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
  1. Decode body via `DeployByTokenSchema` → reject unknown fields → `validate_artifacts_url(artifacts_url)` (cached `Content-Length` in `ARTIFACT_SIZE_MAP[url]`) → optional `domain_name === DOMAIN_NAME` consistency check.
  2. Resolve `transaction_id`: if `body.transaction_id` is set, use it; otherwise set `transaction_id = bundle_id`. Mint a fresh `deploy_id = dep_<ulid>` for the CDK Toolkit deploy. The Deployer never calls a local `/persistence/*` document API; transaction IDs are correlation metadata stored on Deployer's own DynamoDB rows and emitted to Health metrics/callbacks.
  3. CDK Toolkit branch (`is_cdk_worker(body, content_length) === true`):
     - Build `sf_payload` per §6.3 and call `stepfunctions.startExecution({ stateMachineArn: DEPLOY_ARTIFACT_SF, name: deploy_id, input: JSON.stringify(sf_payload) })`.
     - Persist `add_deployment_status({ bundle_id, deploy_id, worker_type: "cdk_toolkit", stack_id: "root", status: REQUEST_MADE, host_domain, api_key, callback_url })`.
     - Return `200 { deploy_id, bundle_id, transaction_id }`.
- All exceptions: emit a `failed` health metric with `invocation_code=5000` and the full stack trace, return `500 { error: { message: "Service error" } }`.

### 4.2 `POST /delete-by-token` / `POST /deployments/delete`

The delete routes are the uninstall counterpart to `POST /deploy-by-token` and are used by Puller before Account disable. Request body is the same closed schema as §3.5 with required `{ bundle_id, callback_url }` and no `artifacts_url`; Deployer loads the previously recorded per-stack rows for that `bundle_id` from `DeploymentStatusTable`.

Pipeline:

1. Verify the caller's `x-api-key`, `bundle_id`, `domain_name` (when present), and callback URL.
2. Load every non-root `DeploymentStatusTable` row for the bundle. If no stack rows exist and the root row is already terminal-delete, return idempotent `200 { deploy_id: bundle_id, bundle_id, transaction_id, status: "DELETE_SUCCEEDED" }`.
3. Start `DeployArtifact` with `operation="DELETE"` and a flattened `prepared_stacks[]` derived from the stored stack rows in reverse deployment order.
4. Each `DeleteStackWorker` calls CloudFormation `DeleteStack` with the same regional notification-topic callback machinery used for create/update and waits for terminal `DELETE_COMPLETE`.
5. On terminal success, write root `status = SUCCEEDED`, `operation = DELETE`, clear retained per-stack task tokens, fire the §6.2 terminal callback with `status="SUCCEEDED"`, and return/persist the delete outcome. On failure, fire `status="FAILED"` with bounded reason/events.

Delete routes never delete the Bootstrap-created shared API Gateway custom domain, shared Usage Plan, Account DNS/certificate records, Deployer stack, or Puller stack. They delete only the CloudFormation stacks recorded for the requested product bundle.

### 4.3 `GET /deploy/{bundle_id}` (and `/deploy-data/{bundle_id}`, `/deployments/{bundle_id}`)

- Read root row (`stack_id = "root"`) from `DeploymentStatusTable`.
  - On read failure (row missing): `404 { message: "Deploy is not found" }`.
- Branch on `worker_type`:
  - `cdk_toolkit`: `getBundleDeploymentStatus(bundle_id)` returns the full per-stack array (with `expire_at`, `metadata`, `api_key`, `task_token` redacted). The wire `deploy_status` is computed from the root row's status: `{ REQUEST_MADE, PRE_DEPLOYMENT, IN_PROGRESS } → IN_PROGRESS`, otherwise the root status verbatim. Returns `200 { bundle_id, deploy_id, deploy_status, bundle_details: <stacks> }`.
- 5xx / 500 → uniform `{ message: "Service Error" }`; emit a `failed` health metric.

### 4.4 `GET /deployments/logs/{response_collection_id}?product_api_identifier=...`

- Authoriser: `HealthApiKeyAuthorizer` accepts the request iff `event.authorizationToken ∈ { HEALTH_API_KEY_VALUE, TENANT_SERVICE_API_KEY_VALUE }`. The authoriser pulls the Health key via `apigateway.getApiKey({ apiKey: HEALTH_API_KEY_ID, includeValue: true })` and the tenant service key from `/account/current-service-api-key`.
- Request: validate `{ response_collection_id, product_api_identifier? }` via `DeploymentLogsSchema`.
- Response: `200 <list of log records>` from `DeploymentLogsTable` `Query(KeyConditionExpression=Key("response_collection_id").eq(...))`, optionally filtered by `product_api_identifier`.

### 4.5 `GET /information`

- API Gateway `MOCK` integration. Returns the deployer-supplied `ServiceInfo` JSON with the standard CORS / HSTS headers. **No API key required.** This is the standard introspection endpoint that upstream services use to confirm the Deployer is reachable and to read its tenant identity (`Subdomain`, `BuildHash`).

---

## 5. Asynchronous Pipelines

### 5.1 `DeployArtifact` state machine — entry and pre-deployment

The state machine is started by `DeployByTokenHandler` with the §6.3 input. The first stage is `WorkerSizeCheck → PreDeployment{Small,Medium,Large}` (`PreDeploymentWorker` Lambda; one implementation binary, three deployment workers at distinct memory/disk cohorts).

#### 5.1.1 `PreDeploymentWorker`

For every invocation:

1. Read the per-environment configuration from env vars: `Subdomain = DOMAIN_NAME`, `regions = JSON.parse(REGIONS)`, `account_domain_config = resolveAccountDomainConfig(ACCOUNT_DOMAIN_CONFIG_SSM_PARAM)`, `env_parameters = JSON.parse(ENV_PARAMETERS)`. Treat missing optional values as `[]` / `{}` but fail closed if the Bootstrap-created domain config is unavailable for a `SERVICE` bundle that declares domain parameters.
2. Compute `active_regions`: always include the home region (`AWS::Region` of this Lambda); if `body.multi_region_deployment === true`, additionally include every entry in `regions[]` whose `RegionName` differs from the home region. Each region carries its own per-region CFN parameter overrides.
3. Download the cloud assembly artifact from `artifacts_url` (streaming `fetch`), parse `x-amz-meta-service-*` JWT-encoded metadata (decoded without verification — the JWTs are stamped by upstream services and Marketplace has already reviewed them), calculate `artifactHash`, and extract the zip into a Lambda-ephemeral `tempfile.TemporaryDirectory` under `/tmp`.
4. Validate Build provenance before reading any deployable template: `service-builder.artifact_kind === "CDK_CLOUD_ASSEMBLY"`, `deployer_contract_version === "1"`, `artifact_hash` matches the downloaded bytes, `assembly_hash` and `assembly_manifest_hash` match `cdk.out`, and `lambda_asset_policy` requires minified, obfuscated, source-map-free Lambda assets. Read `build/build.manifest.json` and verify it agrees with the S3 metadata.
5. Read `marketplace.product.json`. Bail with `DeployError("marketplace.product.json not found inside Build artifact.")` on miss. Bail with `DeployError("unsupported bundle_type")` unless `bundle_type ∈ {SERVICE, DATA}`. Bail if the manifest contains any command/lifecycle/source-entrypoint field (`entrypoint`, `synth_command`, `deploy_command`, `post_deploy_command`, `scripts`, or equivalent). Assert manifest `component_id` / `bundle_type` match the Build metadata.
6. Validate the cloud assembly shape:
   - `cdk.out/manifest.json` and `build/build.manifest.json` are present and match `service-builder`.
   - the CDK cloud assembly manifest loads through the supported schema version.
   - the manifest's stack artifacts are non-empty and list the expected CDK stack ids in dependency order.
   - every referenced template and file asset exists under `cdk.out` and matches the hashes in `service-builder.cloud_assembly`.
   - no `dockerImages` assets are present in the first production contract.
   - no product source directories (`marketplace/`, `lib/`, `src/`, `lambda/`, `test/`), package manager state, legacy `config.json` + `artifacts/<module>/update.json`, or deploy scripts are present.
7. Prepare Deployer-owned execution:
   - Invoke `CleanLambdaVersion` (`InvocationType: Event`, fire-and-forget) so old Lambda versions in this account are reaped before the new deploy fills storage.
   - Resolve Build-declared deployment parameters from `EnvParameters`, the selected `Regions[i]` entry, Bootstrap domain config, pseudo parameters, and request `custom_parameters`. Missing required parameters raise `CloudAssemblyInvalid`.
   - Re-run the Lambda asset policy validator against the staged file assets and asset manifests. Raise `LambdaAssetPolicyViolation` if any Node.js Lambda asset lacks Build's minification/obfuscation/source-map guarantees.
   - Deployer never invokes `pnpm install`, `npx cdk`, `pnpm cdk:*`, `marketplace/app.ts`, or shell command strings supplied by the product.
8. For each active `region`, build a region-specific parameter map by merging `EnvParameters`, the selected `Regions[i]` entry, and `request.custom_parameters`; adjust tenant region, subdomain, and domain handles for non-home regions when Bootstrap provides region-specific domain config.
9. Use the CDK Toolkit Library or platform cloud-assembly deployer to publish file assets to the target region's CDK bootstrap bucket and deploy the manifest-listed stack templates in the order declared by `stacks[]`, while respecting CDK stack dependencies from `cdk.out/manifest.json`. Deployer records one `PreparedStack` per stack/region for status lookup and deletion bookkeeping.
10. `SERVICE` and `DATA` bundles deploy through the same CDK preparation path. `SERVICE` post-success may refresh the deployed `/information` API metadata; `DATA` has no Deployer-owned post-deploy hook.
11. Optional `limit_check_on_pre_deployment` runs `QuotaService.check()` (the only check today is Lambda code-storage size in this account; raises `LambdaCodeStorageExceedError` at ≥99 % of quota).
12. On success update root row → `IN_PROGRESS`, emit a `succeeded` health metric, and return §6.3 `pre_deployment_output`.
13. On any failure: write `root_status = FAILED` with `reason = error.toString()`, emit a `failed` health metric (`invocation_code = 4000` for `LambdaCodeStorageExceedError`, else `5000`), and rethrow so SFN catches it.

The temp directory is cleaned up by the `temp_dir_context` decorator on every exit.

Deployer does not infer product-specific stack ordering. Products that contain multiple stacks MUST list their public stack ids in `marketplace.product.json.stacks[]` in a valid deployment order, and CDK dependencies in the built cloud assembly must agree with that ordering. For products such as Connect (`NetworkStack` before `ConnectStack`) and Persist (`NeptuneStack` before `PersistStack`), Build must preserve the CDK dependency order in `cdk.out/manifest.json`.

### 5.2 CDK stack-status loop (per stack, per region)

For every prepared stack the state machine runs the loop in §2.3.3. Each branch is a small Lambda around the CDK Toolkit runner and regional AWS SDK clients (`@aws-sdk/client-cloudformation`, `@aws-sdk/client-s3`, `@aws-sdk/client-ecr`, etc.) — there is no cross-account session factory.

| Lambda                         | Side effect                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetStackStatusWorker`         | Reads CloudFormation stack status by stack name/ARN and sets `stack_exist = stack_status != null`.                                                                                     |
| `CdkDeployStackWorker`         | Uses the CDK Toolkit Library or platform cloud-assembly deployer to deploy the selected stack template from `cdk.out`, including asset publication, change-set execution, `NotificationARNs=[<sns-topic-arn>]`, `RoleARN=<CloudformationExecRole>`, and standard stack tags. Persists `add_bundle_stack_mapping` and `add_deployment_status({ bundle_id, stack_id, status: IN_PROGRESS, task_token })`. |
| `DeleteStackWorker`            | Best-effort empties S3 buckets and ECR repositories declared in the template before calling `Stack.delete()`. After delete, polls a custom `StackDeleteWaiter` (`Delay=30s, MaxAttempts=120`). Tracks `event.retries` per error code; raises `DeploymentRetryExceedError` once `retries[error_code] ≥ MAX_RETRY_THRESHOLD = 3`. Re-emits `event` with cleared `error` so the SFN catch path can re-loop into `GetStackStatus`. |
| `RollbackContinueStackWorker`  | `cloudformation.continue_update_rollback(StackName)` then waits on the `stack_rollback_complete` waiter. On `WaiterError`, scans `Stack.events.limit(100)` for `UPDATE_FAILED` events, re-runs `continue_update_rollback(StackName, ResourcesToSkip=<failed_resources>)`, waits again. If still failing, raises `DeployError("Rollback failed for stack:<name>. Cancelling deployment...")`. |
| `ReviewChangesWorker`          | When CDK/CloudFormation leaves a stack in `REVIEW_IN_PROGRESS`: `list_change_sets(StackName)`. If exactly one change set is in `CREATE_COMPLETE`, `execute_change_set(ChangeSetName, StackName)`. Anything else returns silently — the next `GetStackStatus` will re-evaluate. |

`CdkDeployStackWorker` uses `lambda:invoke.waitForTaskToken`. The Lambda persists `task_token = $$.Task.Token` on the per-stack row, then **does not** call `SendTaskSuccess` itself — the regional SNS relay (§5.3) does that when CloudFormation reaches a terminal state.

### 5.3 `RegionalDeploymentEventRelay` (CFN reconciler)

Subscribed to the `DeploymentNotificationTopic` in the same region as the stack operation. Each SNS message body is a CFN-event newline-separated `Key=Value` envelope. The relay:

1. Parses `cf_obj` from the message body (lines of `Key=Value`, splitting on the first `=`; ignores empty lines and lines without `=`).
2. If `ResourceStatus ∈ CfStatusTypes.failed_statuses` (`CREATE_FAILED, DELETE_FAILED, ROLLBACK_FAILED, UPDATE_FAILED, UPDATE_ROLLBACK_FAILED, IMPORT_ROLLBACK_FAILED`): `add_failed_event(stack_id, cf_obj)` appends to the per-stack row's `failed_events[]` and `send_health_metric(subdomain, api_key, payload)` emits a granular failure metric to the upstream Health service for the whole bundle.
3. If `ResourceId == StackName` (i.e. it's a stack-level event):
   - `ResourceStatus ∈ complete_statuses` (`CREATE_COMPLETE, DELETE_COMPLETE, ROLLBACK_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE, UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS, IMPORT_COMPLETE, IMPORT_ROLLBACK_COMPLETE`):
    - Look up `bundle_id` via `get_bundle_id_by_stack_id(stack_id)`. If missing → log `BundleNotFoundException` and skip (out-of-band stack event; see §5.3.1).
     - Read the per-stack row. If `cf_status ∈ rollback_complete_statuses`, write terminal `status: FAILED` + `reason: "Stack resource failure"`, then call `check_deployment_error` to inspect `failed_events[]` for known retryable substrings (`TooManyRequestsException`, `ServiceException`, `ServiceUnavailableException`, `ThrottlingException`, `GeneralServiceException`) and `SendTaskFailure(error=<corresponding tag>)` so SFN re-routes via the retry block. Anything else `SendTaskFailure(error="DeployError")`.
     - Otherwise, write terminal `status: SUCCEEDED` + `finishedAt` + `cfStatus = ResourceStatus`, and `SendTaskSuccess(taskToken, output=JSON.stringify(stack_deployment_status))`. Clear the `task_token` field on the row so it isn't double-released.
   - `ResourceStatus ∈ failed_statuses` at stack level: same terminal-failure path as above.
4. On any unexpected exception: `handle_failure_on_worker_handler(stack_id, stack_name, error)` writes `status=FAILED` + `reason: <error>` and emits a Health metric noting the worker fault, then rethrows so SQS-equivalent retries kick in.

#### 5.3.1 Why `BundleNotFoundException` is silently ignored

Stack events can arrive for stacks that were created manually, by an old deployer, or by a failed execution before the stack-to-bundle mapping was persisted. The relay logs and skips because there is no known SFN execution to release. Re-introducing a hard error here would allow unrelated CloudFormation events to poison the regional relay.

### 5.4 Post-deployment hooks

#### `PostSuccessDeploymentWorker`

For every `(region_detail, stack_outputs)` pair (using the worker's own regional AWS SDK clients):

1. Call `update_information_api(stack_outputs)` for `SERVICE` bundles only — for each deployed stack that emitted an API Gateway target, look up the stack name via `get_stack_name_from_stack_id(stack_id)` and call `deploy_information_api(stack_name, cf_resource, apigateway_client)` (the `/information` resource on the deployed API gateway gets refreshed with the new bundle's metadata).
2. `DATA` bundles do not run a Deployer-owned post-deploy hook. Deployer MUST NOT copy API mappings to custom domains; each service stack owns its own base-path mapping using Build-declared domain and base-path parameters.

On success: write `root_status = SUCCEEDED, finished_at = now()`, fire the optional `callback_url` with the terminal callback payload from §6.3 (`status="SUCCEEDED"`) and retry `total=3, statusForcelist=[403,404,429,500,502,503,504], method_whitelist=[HEAD,POST,OPTIONS]`, retain the deployment summary on the root/per-stack DynamoDB rows, and emit two `succeeded` Health metrics (`invocation_code=2000`). The Deployer does not create deployment-summary collections in a separate Persistence service.

On failure: same steps but with `status=FAILED, invocation_code=5000`, post the terminal callback payload from §6.3 (`status="FAILED"`, bounded `reason`, bounded `failed_events[]`) to the callback, and retain full failure details on the Deployer-owned deployment rows plus `DeploymentLogsTable`.

#### `PostFailedDeploymentWorker`

Identical post-success post-processing but skipping the per-module hooks: write `root_status = FAILED, finished_at = now()`, fire the §6.3 terminal callback payload, persist full failure details locally, and emit Health metrics.

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
  deploy_id: string,                      // dep_<ulid> (lambda) | code_build_id
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

### 6.2 Terminal callback payload

When `callback_url !== "null"`, `PostSuccessDeploymentWorker` and `PostFailedDeploymentWorker` POST exactly one terminal payload to the caller:

```ts
type DeploymentTerminalCallback = {
  status: "SUCCEEDED" | "FAILED";
  bundle_id: string;
  deploy_id: string;
  transaction_id: string | "NULL";
  finished_at: string;                         // ISO8601 UTC
  reason?: string;                             // FAILED only; <= 2048 chars, safe for operator display
  failed_events?: Array<{
    stack_id?: string;
    logical_resource_id?: string;
    resource_type?: string;
    resource_status?: string;
    resource_status_reason?: string;           // <= 2048 chars
    event_time?: string;
  }>;                                          // FAILED only; newest 25 events across failed stacks
};
```

The callback payload is intentionally bounded so callers such as Puller can close their local deploy run without querying Deployer logs. Deployer remains the owner of complete diagnostics: full stack events and stack traces stay in `DeploymentStatusTable` / `DeploymentLogsTable` and are available through `GET /deploy/{bundle_id}` and `GET /deployments/logs/{response_collection_id}`.

### 6.3 Step Functions input / per-stage payload

`DeployArtifact` input (built by `DeployByTokenHandler`):

```ts
{
  bundle_id: string,
  deploy_id: string,                       // dep_<ulid>
  transaction_id: string | "NULL",
  artifacts_url: string,                    // legacy field name; presigned immutable Build cloud assembly URL
  worker_size: "SMALL" | "MEDIUM" | "LARGE",
  artifacts_bucket_name: string,
  x_api_key: string,
  host: string,                            // "https://<requestContext.domainName>/"
  log_level: "INFO" | "DEBUG",
  callback_url: string | "null",
  force_deployment: string,                // JSON.stringify of bool|null
  multi_region_deployment: string,
  custom_parameters: Record<string, string>,  // request-level non-secret deployment parameter overrides
  limit_check_on_pre_deployment: boolean
}
```

`PreDeploymentWorker` output (input to `WorkerSizeCheck → DeployStacksWithCdkToolkit`):

```ts
{
  bundle_id, callback_url, custom_domains,
  transaction_id, component_id, component_name, bundle_type,
  source_hash, assembly_hash, service_info,
  all_regions_details: [
    {
      target_region, custom_domains, bundle_type,
      transaction_id, stacks: PreparedStack[], component_name
    }
  ],
  // Sequential path uses prepared_stacks instead, flattened:
  prepared_stacks?: PreparedStack[]
}
```

`PreparedStack` (one per built `(stack, region)` deployment target):

```ts
{
  bundle_id, transaction_id,
  stack_exist: boolean, stack_id: string|null, stack_status: string|null,
  deployment_status: "PRE_DEPLOYMENT",
  stack_name, target_region,
  resolved_parameters: Record<string, string>,
  cloud_assembly_directory: string,
  template_path: string,
  stack_artifact_id: string,
  asset_manifest_ids: string[]
}
```

### 6.4 Persistence collection (lexicon-shaped)

`build_final_collection` produces (`@type` and `@id` fields tie into the shared graph lexicon):

```jsonc
{
  "metadata": { "fuzzy_searchable": false, "version": 3, "validation": false, "serialise_to_graph": true },
  "data": {
    "bundles":      [{ "@type": "bundle", "@id": "bundle_id", "bundle_type": "Service|Data|NULL", "has_product": "p_id" }],
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

`bundle_to_lexicon = { SERVICE: "Service", DATA: "Data" }`. Anything else maps to `"NULL"`.

The `DEPLOY_PRODUCT_IDENTIFIER` (`229c…`) and the `Deployment` `product_api_identifier` (`a125…`) are well-known constants; do NOT regenerate them on every deploy.

---

## 7. Cross-cutting Concerns

### 7.1 AWS SDK client provisioning (local-account only)

Every AWS call uses the worker's own IAM role and a per-region SDK client constructed at cold start. There is no session factory, no credential injection, no `STS:AssumeRole`, and no static-credential provider. The implementation must not include helper APIs that manufacture AWS clients from caller-provided credential material.

A small `AwsClients` helper memoises one client per `(service, region)` pair so workers serving multi-region deploys don't pay client-construction cost per module:

```ts
class AwsClients {
  private cache = new Map<string, unknown>();
  cf(region: string)     { return this.get("cf",     region, () => new CloudFormationClient({ region })); }
  s3(region: string)     { return this.get("s3",     region, () => new S3Client({ region })); }
  ecr(region: string)    { return this.get("ecr",    region, () => new ECRClient({ region })); }
  lambda(region: string) { return this.get("lambda", region, () => new LambdaClient({ region })); }
  // … kms, ssm, apigateway, sfn, sns, dynamodb …
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

Every external call (CDK Toolkit, CFN, S3, IAM, EC2, KMS, Lambda, ECR, API Gateway in this account; plus Persistence, Health, SNS, SFN, DDB) is wrapped in a promise-with-timeout helper that maps timeouts and SDK errors to the appropriate tagged error. Polling loops emit progress logs before/after each poll with structured annotations (`bundle_id`, `stack_id`, `transaction_id`, `region`).

The state machine `Wait` loop for CFN `*_IN_PROGRESS` states is **60 s** between polls. The `StackDeleteWaiter` polls every **30 s** (max 120 attempts = 60 min). The `stack_rollback_complete` waiter uses `Delay=10s, MaxAttempts=60` (10 min). These are AWS-defined or AWS-recommended cadences; do not tune below them or you will get throttled.

### 7.5 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double:

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Errors are **structured tagged classes** with a discriminator (`_tag`).
- Composition is split per route so a missing env var for an unrelated route never breaks this one.

The major service layers:

- `lambda/services/deployment/` — `DeploymentRepository` (DDB CRUD on the three deployment tables), `BundleStackMappingRepository`.
- `lambda/services/cdk-toolkit/` — `CdkToolkitRunner` (cloud assembly extraction, manifest/hash validation, deployment parameter resolution, asset publish, deploy/destroy/status via AWS CDK Toolkit Library or platform cloud-assembly deployer).
- `lambda/services/cf/` — `CloudFormationService` (status/delete/rollback/review wrappers built on `@aws-sdk/client-cloudformation`), `StackDeleteWaiterFactory`.
- `lambda/services/lambda/` — `LambdaCleaner` (local version reaper).
- `lambda/services/quota/` — `QuotaService` (Lambda code-storage check in this account; in-memory TTL cache, 600 s).
- `lambda/services/health/` — `HealthMetricsClient` (both v1 and legacy emitters).
- `lambda/services/api-gw/` — `ApiGwService` (resolve `HEALTH_API_KEY_ID` to the live key value at runtime), `ApiGwInfoCache` (TTL'd).
- `lambda/services/aws-clients/` — the `AwsClients` memoising helper from §7.1.
- `lambda/util/` — `awsUtils` (SSM `get_or_create`, SNS topic ARN builder), `httpUtils` (retry-wrapped `fetch`).
- `lambda/domain/bundles/` — `service` and `data` bundle validation / post-deploy helpers.

### 7.6 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=deployer-*`, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once (`@logger.injectLambdaContext({ logEvent: true })`) and stamps `bundle_id`, `transaction_id`, `stack_name`, `component_id`, `target_region` into structured log keys.
- **Metrics**: AWS Lambda Powertools metrics, namespace `deployer`. Per-handler counters for `deploy_started`, `deploy_succeeded`, `deploy_failed` with dimension `worker_type = cdk_toolkit`.
- **Tracing**: state machine tracing enabled (X-Ray); Lambda tracing disabled by default (`tracing.lambda: false` per the legacy serverless.yml — keep this off for cost; turn it on per-handler via env override only when debugging).
- **Sensitive-key redaction**: `api_key`, `x-api-key`, `authorization`, `secret`, `access_key`, `secret_key`, and `session_token` are scrubbed by the Powertools structured-logger redactor on every emission. Caller-provided AWS credential fields are not part of the data model.

### 7.7 Testing strategy

- Unit tests live in `test/services/**`, `test/handlers/**`, `test/state-machine/**`, `test/cdk/deployer-stack.test.ts`.
- Vitest is the test runner. `setupTests.ts` resets the deployment-status repository's in-memory test double before each test.
- A real CloudFormation engine is **not** required for unit tests — every CFN call goes through the `CloudFormationService` interface, which has a deterministic in-memory test double. The `DeleteStack` waiter is contract-tested against a `cloudformation-mock` stub.
- Step Functions Local is required for compiled-ASL tests (`scripts/start-sfn-local.sh`). `just test` (the canonical CI command) starts/stops the docker container and runs Vitest with `STATE_MACHINE_LOCAL_ENDPOINT=http://localhost:8083`.
- Integration tests in `test/integration/deployer-api.test.ts` hit a deployed stage (`DEPLOYER_API_URL`, `AWS_PROFILE`, `SERVICE_API_KEY`). The CI pipeline runs them against the dev stage on every PR to `main`.

### 7.8 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- The Deployer is installed inside each tenant AWS account by the bootstrap CLI. There is one Deployer per environment.
- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS permissions in this account for KMS, S3, DynamoDB, SNS, Step Functions, IAM, API Gateway, Lambda, CloudWatch Logs, SSM, EventBridge, and CDK bootstrap asset resources — the same account where the bundles will be deployed.
- A pre-populated CFN parameter `Subdomain` for the deployer's custom domain (its own FQDN).
- A pre-populated CFN parameter `Regions` (JSON array; no service hardcoded default). The installer supplies every deployment region and the CDK app creates a `RegionalNotificationStack[region]` for each entry.
- A pre-populated CFN parameter `AccountDomainConfigSsmParam` pointing at Account-provided domain metadata for this tenant.
- A pre-populated CFN parameter `EnvParameters` (JSON object; defaults to `{}`).
- A pre-populated CFN parameter `SharedUsagePlanIdSsmParam` pointing at the Bootstrap-created shared tenant Usage Plan id.
- A pre-populated CFN parameter `HealthApiKeyID` (the secondary key for `/deployments/logs/*` if Health is to read its own logs).
- An accessible local **Health** service at `https://<DOMAIN_NAME>/code-health-checker/metrics` (best-effort).

### 8.1.1 Bootstrap CLI contract

The bootstrap CLI is specified in `Bootstrap.md`. Deployer owns cloud-assembly validation, deployment-parameter resolution, and CDK deployment semantics reused by the CLI's local Deployer install; Bootstrap owns the user-facing command contract, manifest handling, secret redaction, resume behavior, and the switch from local Deployer install to normal `/deploy-by-token` for Puller.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # DataStack first (CDK auto-orders), then WorkflowStack, then DeployerStack
pnpm cdk:destroy          # only when deletionProtection=false (non-prod); deploy-code
                          # bucket removal follows the CDK removal policy for the stage
```

Stack outputs: `DeployerApiUrl`, `DeployArtifactStateMachineArn`, `DeploymentNotificationTopicArn`, `ArtifactsBucketName`, `CdkRunnerCacheBucketName`, `DeployCodeBucketName`. SSM parameters created: `/deployer/api-url`, `/deployer/state-machine/deploy-artifact-arn`, and CDK runner/cache parameters required by the Toolkit workers.

### 8.3 Smoke tests

After every deploy run:

1. `GET https://<subdomain>/infra-deployer/information` returns the `ServiceInfo` JSON.
2. `POST /deploy-by-token` with a Build-produced fixture cloud assembly from `test/fixtures/sample-build-cloud-assembly.zip` (presigned URL, including `service-builder` metadata, `cdk.out/manifest.json`, and `build/build.manifest.json`); assert `200 { bundle_id, deploy_id, transaction_id }`. The body needs only `artifacts_url` (and optionally `bundle_id`, `callback_url`, `custom_parameters`).
3. Poll `GET /deploy/<bundle_id>` every 15 s until `deploy_status ∈ {SUCCEEDED, FAILED}`. Expect `SUCCEEDED` with `bundle_details[*].status == SUCCEEDED`.
4. Confirm the optional `callback_url` (if supplied) received a `{ status: "SUCCEEDED", bundle_id }` POST.
5. Issue a deliberate failure (invalid `marketplace.product.json`, mismatched template hash, missing deployment parameter, or unminified Lambda asset), poll status, and expect `FAILED` with bounded diagnostics.
6. Send a request body containing an unknown field; assert `400 BadRequest` with the field-level unknown-property message and no deployment side effect.

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
---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,event-handler}`, `@aws-sdk/{client-cloudformation,client-dynamodb,lib-dynamodb,client-ecr,client-iam,client-kms,client-lambda,client-s3,s3-request-presigner,client-service-quotas,client-sfn,client-sns,client-ssm,client-api-gateway}`, `@smithy/{config-resolver,node-config-provider,protocol-http}`, `archiver`/`yauzl` for zip in/out, built-in `fetch` for outbound HTTP. **Do NOT** depend on `@aws-sdk/credential-providers` static credentials, Fernet, or any cross-account session library — the Deployer never assumes credentials it does not have via its own role. CDK: `aws-cdk-lib`, `constructs`, AWS CDK Toolkit Library, and the internal `@internal/marketplace-cdk` types. Validation library and DI conventions are the implementer's choice — the contracts in §3 and §6 must be honoured but the implementation style is unconstrained.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `deploy-by-token`, `deployment-logs`, `marketplace-product-manifest`, `build-manifest`, `service-builder-metadata`, `lambda-asset-policy`, `marketplace-context`, `cfn-event`, `health-metric`, `errors`. Errors are tagged classes; everything else is type+validator pairs. The schema for `deploy-by-token` MUST be closed and reject unknown fields before any side effect.
4. **Utils**: `lambda/util/{awsUtils,httpUtils,zipExtract,jwtPassthrough}.ts`. JWT decoding is verify-OFF by design (the metadata is upstream-signed and we don't carry the key).
5. **Configuration**: `lambda/config/deployer.ts` (CFN parameters + env vars per §2.5). Required vars must throw at startup; optional vars must default per §2.5. JSON-decoded `Regions` and `EnvParameters` are validated at cold start; Account domain config is validated when loaded and before any service stack receives domain parameters.
6. **Services** (one file each in `lambda/services/`): Deployment (`Repository`, `BundleStackMapping`); CDK Toolkit (`Runner`, `SourceWorkspace`, `ContextBuilder`, `ManifestValidator`); CF (`Service`, `StackDeleteWaiter`); Lambda (`Cleaner`); Quota (`Service`); Health (`MetricsClient`); ApiGw (`InfoService`); AwsClients (`memoised regional client provider`); plus a composition module `services/index.ts` that exports per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts,responses.ts,gateway-responses.ts}`, `lambda/logging/{powertools.ts,runtime.ts}`, the three handlers (`deploy-by-token`, `deploy-status`, `deployment-logs`), the `health-api-key-authorizer`, and the `/information` mock binding in CDK.
8. **State-machine workers**: `lambda/state-machine/{pre-deployment,cdk-deploy-stack,delete-stack,rollback-continue,review-changes,get-stack-status,post-bundle-success,post-bundle-failed}/handler.ts`.
9. **Reconciler**: `lambda/state-machine/deployment-event-sns-worker/handler.ts`.
10. **Operational**: `lambda/clean-lambda-version/handler.ts` plus the per-CFN-custom-resource handlers (`api-gateway-log`, `api-usage-plan-stage-attachment`).
11. **CDK stacks**: `lib/data-stack.ts`, `lib/workflow-stack.ts`, `lib/deployer-stack.ts` per §2.2 / §2.3 / §2.4, then `bin/app.ts`.
12. **State-machine ASL**: `lib/state-machines/deploy-artifact.asl.ts` (TypeScript builder using `aws-cdk-lib/aws-stepfunctions` or a plain ASL JSON) compiled by `WorkflowStack`.
13. **Bootstrap CLI support**: shared modules for cloud-assembly validation, deployment-parameter resolution, and local Deployer install that satisfy `Bootstrap.md`. The Deployer repo may host `cli/bootstrap.ts`, but `Bootstrap.md` is the authoritative CLI PRD.
14. **Local runners**: `scripts/start-sfn-local.sh`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared workflows.
15. **Smoke tests**: replicate the five steps from §8.3 in `test/integration/deployer-api.test.ts`, plus a CLI contract test that stubs Account/Marketplace, verifies the Deployer local-deploy plan, and verifies the Puller handoff uses `/infra-deployer/deploy-by-token`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- The Deployer **never** issues an AWS API call against an account other than its own. There is no `STS:AssumeRole`, no static-credentials provider, no cross-account session factory, and no Fernet decrypt anywhere in the code path. Audited via static analysis (no imports of `@aws-sdk/credential-providers` static factories).
- The `deploy-by-token` schema rejects unknown fields with a 400 error explaining the local-account contract.
- `POST /deploy-by-token` is callback-driven: a successful end-to-end deploy keeps the SFN suspended on `WAIT_FOR_TASK_TOKEN` until the same-region `RegionalDeploymentEventRelay` releases it. Any path that busy-waits CFN status from a worker is a bug.
- `isCdkWorker` + `getCdkWorkerSize` produce bounded worker-cohort decisions across the four reference sizes (61 MB, 256 MB, 1 GB, 4 GB), and oversized Build artifacts fail before any deploy side effect.
- Production deploys require Build-produced CDK cloud assemblies. Deployer rejects missing or incompatible `service-builder` provenance, mismatched source/assembly/artifact hashes, missing `cdk.out/manifest.json`, missing `build/build.manifest.json`, legacy `config.json` / `artifacts/<module>/update.json` layouts, source snapshots, Docker image assets, and Lambda assets that do not satisfy the minified/obfuscated/source-map-free policy.
- Multi-region deploys build a region-specific CloudFormation parameter map exactly once per region listed in `Regions`, never invoke product source, and run the flattened per-stack loop sequentially in manifest/CDK dependency order. Deployer does not expose a parallel module deployment switch.
- The `StackAlreadyExistsException` and `DeploymentInProgressError` SFN catch loops do not infinite-spin; eventually they reach a terminal stack status because every CFN call ultimately moves to a `*_COMPLETE` or `*_FAILED` state and the regional SNS relay releases the task token.
- `BundleNotFoundException` from the regional SNS relay logs and skips silently — never blocks unrelated stack events.
- Best-effort downstream (`Persistence`, `Health`, `Account Manager`) outages never fail a deploy; failures are logged and the deploy proceeds.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so any CommonJS dependency works at runtime.
- IAM permissions follow least-privilege per §2.4.3.
- All structured logs include the relevant `bundle_id` / `stack_id` / `transaction_id` / `target_region` so an operator can trace a single deploy end-to-end via CloudWatch Logs Insights.
- The Marketplace ↔ Deployer contract is honoured: `POST <tenant-host>/infra-deployer/deploy-by-token` with `{ artifacts_url, bundle_id, callback_url }` (and optional `custom_parameters`, `multi_region_deployment`, `force_deployment`) succeeds when `artifacts_url` points to a valid Build cloud assembly, `GET <tenant-host>/infra-deployer/deploy/<bundle_id>` returns the documented status shape, and the Deployer eventually POSTs `{ status, bundle_id, ... }` to the supplied `callback_url` exactly once on terminal success or failure. The `<tenant-host>` is always the tenant's own subdomain — Marketplace MUST route per-tenant; there is no shared central Deployer.
