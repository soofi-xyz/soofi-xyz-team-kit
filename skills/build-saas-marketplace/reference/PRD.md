# Marketplace Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Marketplace** product/data distribution service. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to the installer-supplied AWS region, per the Golden Path engineering standards.

---

## 1. Product Overview

### 1.1 Mission

Marketplace is a serverless product/data distribution platform. It catalogs reusable **Components** (services and data configurations) as versioned **Bundles**, organises them under a navigable **Ontology** (families → categories → products → APIs → prices → configurations → components), and **notifies subscribers via signed webhooks whenever a new bundle becomes available** so they can pull and deploy it on their own.

A **Component** is the unit of distribution. Every component is owned by exactly one **catalog product** (see §3.4) and carries a `type`:

- `SERVICE` — service configurations: stateful CloudFormation/CDK templates, Lambda functions, Sagemaker models, etc.
- `DATA` — data configurations: static annotations consumed by another product (Connection flows, Language mappings, Language rules, …). Stateless after deploy, no runtime.

A **Bundle** is one immutable revision of a component (artifact URL + signed metadata).

A **Subscription** is a `(component_id, webhook_url)` binding owned by whoever can prove control of the URL via a signing secret. It supersedes the historical "deploy to subscriber environment" + "realtime listener" split: there is now exactly **one** subscription concept, and its sole purpose is to deliver a **`component.bundle.published`** webhook to the registered URL whenever the corresponding component publishes a new `Valid` bundle. Subscribers decide what to do with the notification — typically, they fetch the `bundle_url` and hand it to their local deployer or puller.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<subdomain>/marketplace/`*, API-key authorised (`x-api-key` per usage plan), with the capability groups below (full mapping in §3 and §4):


| Group                       | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Purpose                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Catalog (ontology)**      | `POST/GET/DELETE /ontology/families[/{family_id}]`, `POST/GET/DELETE /ontology/families/{family_id}/categories`, `POST/GET/DELETE /ontology/families/{family_id}/categories/{category_id}/products`, `POST/GET/DELETE /ontology/products/{product_id}/api[/{api_id}]`, `POST/GET/DELETE /ontology/products/{product_id}/api/{api_id}/prices`, `POST/GET/DELETE /ontology/products/{product_id}/configurations[/{configuration_id}]`, `POST/GET/DELETE /ontology/products/{product_id}/components[/{component_id}]`, `GET/PATCH /ontology/(family|category|product)/{id}/metadata`, `GET /ontology/components/search/{search_by}`, `GET /ontology` | Sole hierarchical browsable catalog: families → categories → products → APIs → prices, plus product configurations, product-owned components, free-form metadata, and full-tree dump |
| **Bundles**                 | `PUT /ontology/products/{product_id}/components/{component_id}/bundles`, `GET /ontology/products/{product_id}/components/{component_id}/bundles`, `GET/DELETE /ontology/products/{product_id}/components/{component_id}/bundles/{bundle_id}`, `POST /ontology/products/{product_id}/components/{component_id}/rollback`, `GET /reviews/{review_id}`                                                                                                                                                                                                                                                                                            | Upload, list, fetch, rollback, delete a bundle; poll a review pipeline status                                                                                                        |
| **Subscriptions**           | `POST /subscriptions`, `GET /subscriptions`, `GET/PATCH/DELETE /subscriptions/{subscription_id}`, `POST /subscriptions/{subscription_id}/rotate-secret`, `GET /subscriptions/{subscription_id}/notifications[/{notification_id}]`, `POST /subscriptions/{subscription_id}/notifications/replay`, `POST /subscriptions/verify`                                                                                                                                                                                                                                                                                                                  | Create, list, inspect, pause/resume, rotate signing secret, browse notification history, manually replay the last notification, verify a webhook URL is reachable                    |
| **Instance configuration**  | `PUT /settings`, `GET /settings/status`, `GET /settings/schema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Configure instance-wide secrets (review env, env-admin, site, comply, quicksight, code-assessment regulator) and inspect operational status                                          |
| **Internal — analytics**    | `PUT /quicksight/subscription-to-component`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Trigger the QuickSight subscription↔component dataset refresh (private)                                                                                                              |
| **Internal — service info** | `GET /information`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Static service metadata (API Gateway `MOCK` integration, no API key)                                                                                                                 |


Every mutating route is API-key-gated (`apiKeyRequired: true`) plus CORS preflight; the only exception is `GET /information` (mock).

Every successful POST that mints work returns `200`/`201`/`202`/`204` per route; `PUT /ontology/products/{product_id}/components/{component_id}/bundles` returns `202 Accepted` with `{ component_id, bundle_status: "UPLOADING_IN_PROGRESS", review_id }` because the publication state machine runs out-of-band.

### 1.3 Non-goals

- Marketplace does **not** host bundle artifacts at upload time — it consumes a caller-supplied `bundle_url`, validates it (`HEAD` for availability, decodes its metadata header), and re-uploads a sanitised copy to its own S3 bucket only **after** the bundle passes the review pipeline.
- Marketplace does **not** itself deploy CloudFormation / CDK stacks into subscriber accounts. Subscribers receive a notification with a presigned `bundle_url` and are responsible for handing the artifact to their own deployer / puller. There is no per-subscription deploy state machine, no `WAIT_FOR_TASK_TOKEN` deployer callback, and no per-environment credential exchange.
- Marketplace does **not** maintain an `(api_key, domain_name)` trust relationship with subscribers. A subscription is identified by an opaque `subscription_id` and managed by proof of webhook control plus knowledge of its current `signing_secret` (returned once at create-time and rotation-time). The caller's API key gates access to the Marketplace API, but it is not stored as subscription ownership state and rotation of that key never changes subscription ownership.
- Marketplace does **not** orchestrate per-subscriber dependency layering at runtime. Dependencies are validated at upload (cycle dry-run, lexicon-version compatibility, assessment-hash freshness — see §4.1.1) and surfaced in the notification payload (`dependencies`, `deploy_time_dependencies`, `dependency_layers`). The Puller treats this metadata as an install-order contract and deploys dependency layers before the notified bundle.
- Marketplace does **not** perform code review / static analysis. That belongs to the **Comply** service, whose result is consumed from the bundle's `service-comply` metadata block (see §3.3).
- Marketplace does **not** synthesise its own subdomain or ACM certificates. The `Subdomain` parameter is provided by the deployer.
- Marketplace does **not** invent its own auth identity. API keys are minted upstream; Bootstrap creates the tenant's single shared Usage Plan and binds the service key to it. Marketplace only attaches its API stage to that shared plan.
- Marketplace does **not** broker arbitrary partner integrations. Outbound HTTPS goes only to the per-instance configured **review environment** (during bundle review), **environment administrator** (when validating instance settings), **site publisher** (publishing the public catalog), **persistence**, **work-dashboard**, and the per-subscription **`webhook_url`** (the only fan-out target).

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every long-running publication or notification fan-out compiles to a STANDARD AWS Step Functions state machine. Branching (`Choice`), looping (`Map`), parallelism (`Parallel`), retries (`Retry`), error catches (`Catch`), and waits (`Wait`) are expressed exclusively as ASL primitives. There is no second workflow runtime, no in-Lambda step orchestrator.
2. **Subscriber notification is push-only and signed.** When a bundle becomes `Valid`, Marketplace fans out a single signed webhook (`component.bundle.published`) to every subscription bound to that component via the `NotifyComponentSubscribers` SFN. Every outbound notification carries an HMAC-SHA256 signature over the canonical body, computed with the per-subscription `signing_secret`. Subscribers verify the signature; Marketplace never needs to know the subscriber's identity beyond the URL.
3. **Marketplace fan-out replaces every prior pull/deploy variant.** There is no Marketplace-side Deployer integration, no per-subscriber `WAIT_FOR_TASK_TOKEN` callback, no separate "realtime listener" channel, and no expectation that subscribers run a poller against Marketplace. Subscribers can still run their own poller as a redundancy mechanism (against `GET /ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1`), but the canonical mechanism is the signed webhook.
4. **Dependency resolution is shallow at write-time only.** Bundle uploads run a dependency-cycle dry-run and a lexicon-version compatibility check; the resolved transitive layers are persisted on the bundle row and surfaced verbatim in every subsequent notification's `dependency_layers` field. Marketplace does not orchestrate dependency installation order at notification time, but the field is normative for subscribers that auto-deploy (notably Puller).
5. **Tagged AWS-native integrations beat custom code.** Where Step Functions has a first-class service integration (`states:startExecution.sync`, `lambda:invoke`, `s3:getObject`, `dynamodb:GetItem`, EventBridge Pipes), use it. Custom Lambdas exist only for business logic that cannot be expressed natively (e.g. the HMAC-signed HTTP fan-out itself, since Step Functions HTTP Tasks cannot compute per-target signatures).

### 2.1 Stacks (AWS CDK)

The CDK app is composed of three stacks deployed in order:

```
bin/app.ts
├── DataStack        # KMS CMK, private S3 BundlesBucket, transport-only bucket policy, three DynamoDB tables
├── WorkflowStack    # Step Functions state machines (publication, notification fan-out,
│                      analytics) + EventBridge schedule for self-clean
└── MarketplaceStack # All Lambdas, REST API + IAM authorisers, API Gateway custom resources,
                      # OpenAPI spec, /information mock, settings SSM parameters
```

`MarketplaceStack.addDependency(workflowStack); workflowStack.addDependency(dataStack)` ensures that storage deploys first, then orchestration, then routing. Both `WorkflowStack` and `MarketplaceStack` are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per `cloud-aws-primary`).

### 2.2 DataStack contents

#### 2.2.1 KMS

- **`DataKey`** — symmetric customer-managed key (alias `marketplace_encryption_key`) used to encrypt every DynamoDB table and the bundles bucket. Key policy grants the account root `kms:*` and the Lambda runtime role `kms:Encrypt|Decrypt|ReEncrypt*|GenerateDataKey*|DescribeKey` on `*`, plus `kms:CreateGrant|ListGrants|RevokeGrant` constrained by `kms:GrantIsForAWSResource=true`.

#### 2.2.2 Storage

| Bucket          | Encryption / ACL                                                                                                                                                                                                                          | Lifecycle | Purpose                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BundlesBucket` | S3-managed AES-256 encryption, `BLOCK_ALL` public access (`BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets`), `ObjectWriter` ownership, SSL-only via bucket policy with `aws:SecureTransport=false` deny | —         | Sanitised bundle artifacts under `bundles/<product_id>/<component_id>/<bundle_id>` plus daily ontology-dump JSON under `<ontology-prefix>/<YYYY-MM-DD>` |

The bucket policy is limited to service-owned guardrails such as denying insecure transport; it does **not** grant cross-account principals direct S3 access. Subscribers and their tenant-local deployers fetch artifacts only through Marketplace-minted presigned URLs returned by bundle reads and notification payloads.

#### 2.2.3 DynamoDB

All four tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled. `NotificationsTable` enables TTL on `ttl` for transient delivery-attempt rows. All four publish a DynamoDB stream (`NEW_AND_OLD_IMAGES` for ontology, `NEW_IMAGE` elsewhere).

| Table                | Keys                | Indexes                                               | Purpose                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComponentsTable`    | `pk` (S) / `sk` (S) | `gsi1: gsi1pk/gsi1sk`, `gsi2: gsi2pk`, `gsi3: gsi3pk` | Single-table store for components (each owned by a catalog product, typed `SERVICE` or `DATA`), their bundles (in-review and committed states), and failed-review records. `gsi2pk` carries `ONTOLOGY_PRODUCT_ID#<product_id>` so component-by-product queries are O(1) on a single GSI lookup.                  |
| `OntologyTable`      | `pk` (S) / `sk` (S) | `gsi1: gsi1pk`, `gsi2: gsi2pk/gsi2sk`, `gsi3: gsi3pk` | Single-table store for the local catalog: families, categories, products, APIs, prices (with revisions), and configurations (per-product, per-company). Item shape mirrors §6.3.                                                                                                                                |
| `SubscriptionsTable` | `pk` (S) / `sk` (S) | `gsi1: gsi1pk/gsi1sk`, `gsi2: gsi2pk`                 | One row per subscription. `pk = COMPONENT#<component_id>`, `sk = SUB#<subscription_id>`, plus `gsi1pk = SUB#<subscription_id>` for direct lookup and `gsi2pk = WEBHOOK_HOST#<host>` for ops-side host-grouped queries (e.g. "list all subscriptions targeting `subscriber.example.com`"). Item shape mirrors §6.2. |
| `NotificationsTable` | `pk` (S) / `sk` (S) | `gsi1: gsi1pk/gsi1sk`                                 | One row per delivery attempt. `pk = SUB#<subscription_id>`, `sk = NOTIF#<notification_id>#<attempt_n>`, plus `gsi1pk = COMPONENT#<component_id>` / `gsi1sk = <bundle_id>#<subscription_id>` so per-bundle fan-out can be inspected. TTL on `ttl` keeps successful rows for 30 days, failed rows for 180 days.    |

A single AWS-KMS Customer-Managed Key (`DataKey`) encrypts all four tables and the `BundlesBucket`. Each Lambda role gets `kms:Decrypt|Encrypt|GenerateDataKey|DescribeKey` on `DataKey` ARN, scoped via `kms:ViaService=dynamodb.<region>.amazonaws.com` (or `s3.<region>.amazonaws.com`) where possible.

### 2.3 MarketplaceStack contents

#### 2.3.1 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so any CommonJS dependency can satisfy dynamic built-in `require`s. Logging format is JSON with three-month CloudWatch log-group retention. Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with `POWERTOOLS_SERVICE_NAME=marketplace-*`, `POWERTOOLS_LOG_LEVEL=INFO`, `POWERTOOLS_METRICS_NAMESPACE=marketplace`.

There are four cohorts; the full per-route handler matrix lives in §4.

| Cohort                                                                  | Examples                                                                                                                                                                                                                                                                                                                                                                                                       | Memory      | Timeout   | Trigger                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| **Public API router**                                                   | `MarketplaceHandler` (one per logical route group: `catalog`, `bundles`, `subscriptions`, `notifications`, `instance`, `analytics`, `info`)                                                                                                                                                                                                                                                                    | 256–512 MB  | 28–30 s   | API Gateway REST API                                                               |
| **Publication pipeline workers** (driven by `PutProductBundle` SFN)     | `PutBundleToS3`, `DeployBundleToSandbox`, `CheckComplyStatus`, `CheckDeployStatus`, `GetFailedDeployLogs`, `UpdateBundleStatus`, `EmitBundlePublished` (kicks off `NotifyComponentSubscribers` and `PublishToSite` in parallel). `PutBundleToS3` streams only artifacts at or below `MAX_BUNDLE_BYTES`; oversized bundles are rejected before this worker runs.                                                                                                          | 256–512 MB  | 60–120 s  | Step Functions task in `PutProductBundle`                                          |
| **Notification fan-out workers** (driven by `NotifyComponentSubscribers` Distributed Map) | `BuildNotificationPayload`, `SignAndSendNotification` (HMAC-SHA256 signed POST with classifier-aware retry), `RecordNotificationOutcome`                                                                                                                                                                                                                                                                       | 512–1024 MB | 60–120 s  | Step Functions task (Distributed Map child workflow)                               |
| **Operational helpers**                                                 | `ConfigureMarketplace`, `CheckMarketplaceInstance`, `RetrieveMarketplaceSettingsSchema`, `VerifySubscriptionWebhookUrl`, `RotateSubscriptionSecret`, `ReplayLastNotification`, `CleanSelfCleaningEnvironment` (cron @ `02:00 UTC`), `InvokeQuicksightDump`, `UpdateQuicksightDataset`, `ApiUsagePlanStageAttachmentCustom`, `ApiGatewayLogCustom`, `CreateManagedOntology`, `CreateManagedOntologyV2`           | 256–2048 MB | 28–900 s  | API Gateway, EventBridge schedule, CloudFormation custom resource                  |

The state machines created by the publication and fan-out flows share a constrained `WorkflowRuntimeRole` whose policies are: `lambda:InvokeFunction` on the worker ARNs they reference, `dynamodb:GetItem|PutItem|UpdateItem|Query` on the four tables (no `Scan` except for the analytics worker), `kms:Decrypt|Encrypt|GenerateDataKey` on `DataKey`, `s3:GetObject|PutObject|ListBucket` on `BundlesBucket`, `secretsmanager:GetSecretValue` on the per-subscription `signing_secret` secrets, and `ssm:GetParameter` on `arn:aws:ssm:<region>:<account>:parameter/marketplace/*`. Because `PutProductBundle` invokes `NotifyComponentSubscribers` through `states:startExecution.sync`, the same role also holds `states:StartExecution` on the `NotifyComponentSubscribers` state machine, `states:DescribeExecution|StopExecution` on that state machine's executions, and the Step Functions `.sync` EventBridge permissions `events:PutRule|PutTargets|DescribeRule` scoped to the managed rule pattern `arn:aws:events:<region>:<account>:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`.

#### 2.3.2 Routing fabric

- **REST API** (`RestApi` `MarketplaceApi`) with default stage `${stage}`, regional endpoint type, CORS pre-flight for `*`, a dedicated access log group, and `DisableExecuteApiEndpoint: true` (the API is reachable only via the deployer-supplied custom domain). Routes:
  - All public paths in §1.2 → `LambdaIntegration(<group handler>)` with `apiKeyRequired: true`.
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON (no API key).
  - `GatewayResponse` rules normalise `INVALID_API_KEY`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, and `DEFAULT_4XX` per §3.1.
- **API Gateway custom domain mapping** under base path `marketplace` against the Bootstrap-created tenant custom domain passed by Deployer (`AWS::ApiGateway::BasePathMapping` for the REST API). Marketplace must not create the shared API Gateway `DomainName`.
- **Dynamic Custom Resources**:
  - `ApiGatewayLogCustom` — installs the per-stage access log group with `loglevel=ERROR` (created on `Create`/`Update`, no-op on `Delete`).
  - `ApiUsagePlanStageAttachmentCustom` — reads the Bootstrap-managed shared Usage Plan id from `/account/shared-usage-plan-id` and idempotently adds this API stage to that plan. It MUST NOT create a Usage Plan or bind an API key.
  - `OntologyForSelectedEnvironmentsV2` — runs a versioned migration of the managed ontology (`MigrationName` parameter); resource semantics are "applied once, idempotent, do nothing on re-deploy".

There is **no inbound webhook integration** in this stack. Marketplace is push-only on the subscription axis; the only callbacks Marketplace receives are `PUT /settings`-driven SSM writes and (out-of-band) the daily ontology dump trigger.

#### 2.3.3 IAM (high-level)

- The provider role is **never** wildcarded. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- Each public router holds only the DynamoDB / KMS / S3 / Step Functions permissions required by **its** routes. The only Lambda invoke exception is the catalog router, which holds `lambda:InvokeFunction` on `SCHEDULED_ONTOLOGY_LAMBDA_ARN` solely for lazy `GET /ontology` snapshot backfill / force-dump paths; the subscriptions router has no `states:StartExecution` for the publication state machine.
- The `WorkflowRuntimeRole` (assumed by every state machine task that needs cross-resource access) is the single source of cross-table writes plus `secretsmanager:GetSecretValue` on the per-subscription signing secrets.
- The `SignAndSendNotification` worker role additionally holds `secretsmanager:GetSecretValue` scoped to `arn:aws:secretsmanager:<region>:<account>:secret:marketplace/subscription/*` and **no** S3 / DynamoDB write permissions beyond what `RecordNotificationOutcome` needs.
- The custom-resource handlers hold `apigateway:*` scoped to the rest API ARN and the named usage-plan ARN respectively (no account-wide `apigateway:*`).

### 2.4 Configuration surface (env vars + SSM)

The runtime is configured exclusively via env vars (read once on cold start; missing required values must fail closed) plus a small SSM-Parameter-Store-backed set of operator-managed secrets. Notable keys:

| Key                                                           | Source                                                  | Used by                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `COMPONENTS_TABLE` / `ONTOLOGY_TABLE` / `SUBSCRIPTIONS_TABLE` / `NOTIFICATIONS_TABLE` | DataStack → MarketplaceStack outputs | Every router + worker                                                |
| `BUNDLES_S3_BUCKET_NAME`                                      | DataStack output                                        | Bundle publishing + presigned-URL minting for notifications          |
| `KMS_KEY_ARN`                                                 | DataStack output                                        | DynamoDB SSE + S3 server-side encryption helpers                     |
| `LOCAL_DOMAIN_NAME`                                           | `Subdomain` parameter                                   | Bundle URL generation, notification `issuer` claim                   |
| `SHARED_USAGE_PLAN_ID_SSM_PARAM`                              | `/account/shared-usage-plan-id`                         | Shared Usage Plan stage attachment                                   |
| `BUILD_HASH`                                                  | Deployer-supplied parameter                             | Health-metric emission                                               |
| `INTERNALSWAGGER_PATH`                                        | static (`requirements/swagger.yml`)                     | OpenAPI publication                                                  |
| `ONTOLOGY_FOR_DATE_BUNDLE_BUCKET_KEY`                         | static (`ONTOLOGY/FULL`)                                | Daily ontology-dump prefix                                           |
| `NOTIFY_COMPONENT_SUBSCRIBERS_ARN`                            | WorkflowStack output                                    | `EmitBundlePublished` step in `PutProductBundle`                     |
| `SCHEDULED_ONTOLOGY_LAMBDA_ARN`                               | MarketplaceStack output                                 | `force_ontology_dump` from ontology download routes                  |
| `SUBSCRIPTION_SECRET_NAMESPACE`                               | static (`marketplace/subscription/`)                    | Per-subscription secret naming convention                            |
| `MAX_BUNDLE_BYTES`                                            | `268435456` (256 MiB)                                   | Hard upper bound for accepted `bundle_url` artifacts                  |
| `NOTIFICATION_RETRY_MAX_ATTEMPTS`                             | `5` (default)                                           | `SignAndSendNotification` retry cap                                  |
| `NOTIFICATION_RETRY_BASE_DELAY_MS`                            | `2000` (default)                                        | Exponential-backoff base for transient failures                      |
| `NOTIFICATION_RETRY_MAX_DELAY_MS`                             | `300000` (default; 5 min)                               | Exponential-backoff cap                                              |
| `NOTIFICATION_TIMEOUT_MS`                                     | `15000` (default)                                       | Per-attempt HTTP timeout                                             |
| `NOTIFICATION_PRESIGN_TTL_SECONDS`                            | `3600` (default; 1 h)                                   | TTL for the `bundle_url` presigned link in the notification payload  |
| `REVIEW_API_KEY_SSM_PARAM`                                    | `/marketplace/<stage>/review-api-key`                   | Bundle review delivery (sandbox) + instance status                   |
| `SELF_CLEANING_REVIEW_API_KEY_SSM_PARAM`                      | `/marketplace/<stage>/self-cleaning-review-api-key`     | Optional secondary review env (parallel review + nightly self-clean) |
| `REVIEW_ENVIRONMENT_HOSTS_SSM_PARAM`                          | `/marketplace/<stage>/review-environment-hosts`         | JSON array of review environment FQDNs used by bundle sandbox deploy |
| `SELF_CLEANING_REVIEW_ENVIRONMENT_HOST_SSM_PARAM`              | `/marketplace/<stage>/self-cleaning-review-environment-host` | Optional self-cleaning review environment FQDN                  |
| `DOCUMENTATION_API_KEY_SSM_PARAM`                             | `/marketplace/<stage>/documentation-api-key`            | OpenAPI publication target                                           |
| `ENV_ADMIN_API_KEY_SSM_PARAM`                                 | `/marketplace/<stage>/env-admin-api-key`                | Optional: instance-setting validation only                           |
| `ENV_ADMIN_DOMAIN_SSM_PARAM`                                  | `/marketplace/<stage>/env-admin-domain-name`            | Optional: instance-setting validation only                           |
| `SITE_API_KEY_SSM_PARAM`                                      | `/marketplace/<stage>/site-api-key`                     | Public catalog site publication target                               |
| `QUICKSIGHT_API_KEY`                                          | `/marketplace/<stage>/quicksight/quicksight-api-key`    | Analytics dataset refresh                                            |
| `ASSESS_INTEGRATION_CONFIGURATION`                            | `/marketplace/<stage>/assess-integration-configuration` | Code-assessment regulator product identifier                         |

SSM parameter values are loaded lazily (single-flight cache, refreshed on TTL — see §7.3) so a missing optional parameter never blocks unrelated routes.

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses use a uniform JSON envelope. Success:

```json
<status-code-specific payload>
```

Error (HTTP status mapped per error tag — see §3.7):

```json
{
  "error": {
    "message": "Unprocessable Entity",
    "reason": "Component(`Connector`) is outdated.",
    "_additional_documentation": [
      "https://api.staircase.co/docs/DevOps/Distribution/Marketplace/updateComponent__componentsRepository#dependency-validation"
    ]
  }
}
```

`reason` may be a string or a list of strings. `_additional_documentation` is an optional list of public-doc links the caller should read to fix the error. Every response includes a `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` header and CORS headers; the caller's `X-Sc-Health-Transaction-Id` (or the request's AWS request ID if absent) is echoed back so the same transaction can be traced end-to-end through Marketplace.

### 3.2 Component (catalog item)

A **Component** is the unit of distribution. It is owned by exactly one catalog product (see §3.4) and its on-the-wire shape is:

```jsonc
{
  "component_id": "Connector",               // canonical, ASCII, ≤80 chars, globally unique
  "type": "SERVICE|DATA",                    // immutable after creation
  "product_id": "9e4…",                      // owning catalog product (UUIDv4)
  "description": "…",                        // optional
  "dependencies": ["Persist", "Lexicon"],    // runtime deps (zero or more)
  "deploy_time_dependencies": ["Build"],     // deploy-time deps (zero or more, SERVICE only)
  "bundle_status": "Valid|Failed|UPLOADING_IN_PROGRESS|ROLLBACK_IN_PROGRESS",
  "update_at": "ISO8601 UTC",                // last successful publication timestamp
  "created_at": "ISO8601 UTC",
  "bundle_url": "https://…",                 // S3 presigned URL of the latest valid bundle
  "bundle_meta": { … }                       // decoded latest bundle metadata (see §3.3)
}
```

Components live exclusively under catalog products and are created by `POST /ontology/products/{product_id}/components` (see §4.3). The `component_id` is globally unique across both `SERVICE` and `DATA` types — a creation that would shadow an existing component name returns `409 Conflict`. Component `type` is set at creation and is immutable thereafter; switching a component's type requires deleting it (which is rejected while it has any bundles or active subscriptions) and recreating under a new id. The `gsi2pk` slot on the underlying DDB row is `ONTOLOGY_PRODUCT_ID#<product_id>` and is the authoritative product link.

### 3.3 Bundle (revision item)

A **Bundle** is one immutable revision of a component:

```jsonc
{
  "bundle_id": "01H01965DB8QGSD9EZWF1VS7BC", // ULID, server-generated at upload
  "component_id": "Connector",               // owning component
  "product_id": "9e4…",                      // owning catalog product (denormalised for read efficiency)
  "type": "SERVICE|DATA",                    // inherited from the owning component
  "bundle_url": "https://…",                  // caller-supplied at upload; replaced by the S3 URL after success
  "bundle_status": "UPLOADING_IN_PROGRESS|Valid|Failed|ROLLBACK_IN_PROGRESS",
  "uploaded_at": "ISO8601 UTC",
  "description": "…",
  "dependencies": ["…"],
  "deploy_time_dependencies": ["…"],
  "dependency_layers": [[{ "component_id": "Build", "type": "SERVICE", "product_id": "…" }], …],
  "lexicon_version_id": "01J42CH184DC48N1PY3R2YCJ9P|null",
  "bundle_meta": {
    "service-builder":     { "lexicon_version_id?": "…", "bundle_type": "SERVICE|DATA", "version_hash": "…" },
    "service-assessor":    { "version_hash": "…" },           // populated by Assess
    "service-test":        { "version_hash": "…" },           // populated by Test (DATA bundles only)
    "service-comply":      { "severity_label": "…" },         // populated by Comply
    "service-marketplace": { "id": "<bundle_id>", "component_id": "<component_id>", "status": "SUCCEEDED",
                             "issuer": "<host>marketplace/", "timestamp": <epoch>, "version": "1.0" }
  }
}
```

Bundles are caller-supplied via `bundle_url` (any HTTPS URL whose `HEAD` succeeds with valid metadata in headers and `Content-Length <= MAX_BUNDLE_BYTES`). Bundle metadata is carried in `x-amz-meta-service-*` object metadata headers as unsigned JWT-shaped strings (`<base64url header>.<base64url JSON payload>.`, no signature). Marketplace decodes the JWT payload JSON for validation and review. After the publication state machine succeeds, Marketplace **re-uploads** the artifact to `s3://<BundlesBucket>/bundles/<product_id>/<component_id>/<bundle_id>` with a **sanitised** metadata block (status / version / applied_rules stripped from each `service-*` sub-block) and stamps `service-marketplace.id = <bundle_id>` so subscribers can match by it. The sanitized metadata is written back to S3 using the same JWT-shaped `x-amz-meta-service-*` header format Deployer expects; raw JSON metadata headers are invalid. `dependency_layers` is the topologically-sorted closure computed at upload time and is the same data the notification payload's `dependency_layers` field carries verbatim.

### 3.4 Catalog (Ontology)

The catalog is the **single, authoritative product ontology**. There is no second registry of components or products. It is a navigable hierarchy stored in `OntologyTable`:

```
Family (family_name unique, family_id minted)
  └── Category (category_name unique under family)
        └── Product (product_name unique under category, product_id minted)
              ├── API (api_id minted, fields: name, description, type, invocation_type)
              │     └── Price (revisions: amount, unit, calculation, timing)
              ├── Configuration (per company_ids[])
              ├── Component (component_id unique globally, type SERVICE|DATA, with bundles in `ComponentsTable`)
              └── Metadata (free-form validated JSON: description, asana, codex, homepage, logotype_url, …)
```

`family_id`, `category_id`, `product_id`, `api_id`, `configuration_id`, `price_id`, and `revision_id` are **UUIDv4** strings (minimum 24, maximum 36 chars; case-insensitive hex). `family_name`, `category_name`, and `product_name` are PascalCase ASCII (`^[A-Z][A-Za-z]*$`, ≤30 chars). `component_id` is a free-form ASCII identifier (≤80 chars, unique globally).

**Configuration references are local-only.** `configured_product_id`, `configured_product_api_id`, and every `company_ids[]` entry MUST be scalar identifiers from this Marketplace instance's own ontology. Request schemas reject remote reference shapes such as `{ environment: { host, api_key }, value }` and reject persisted host fields such as `configured_product_host` or `company_host`. Marketplace validates configuration references with local `OntologyTable` reads only; configuration persistence never performs outbound Marketplace-to-Marketplace ontology calls.

**Component ownership.** A component is created **inside** a catalog product via `POST /ontology/products/{product_id}/components` and is owned by exactly that product. Bundle uploads (`PUT /ontology/products/{product_id}/components/{component_id}/bundles`) refuse 404 if the component is not under the path's product.

### 3.5 Subscription

A **Subscription** is a `(component_id, webhook_url)` binding. Its on-the-wire shape on read is:

```jsonc
{
  "subscription_id": "sub_01H01965DB8QGSD9EZWF1VS7BC",   // server-minted at create time, stable
  "component_id": "Connector",
  "product_id": "9e4…",                                   // denormalised from the component's owning catalog product
  "webhook_url": "https://subscriber.example.com/marketplace/notifications",
  "signing_secret_set": true,                             // boolean; the actual secret is returned ONLY at create / rotate time
  "status": "ACTIVE|PAUSED",
  "description": "…",                                     // optional
  "metadata": { … },                                      // optional caller-defined key/value (≤4 KB)
  "created_at": "ISO8601 UTC",
  "updated_at": "ISO8601 UTC",
  "last_published_bundle_id": "01H01… | null",            // most recent bundle Marketplace tried to notify about
  "last_notification_id": "ntf_01H01…",                   // most recent notification fan-out attempt id
  "last_notification_status": "PENDING|DELIVERED|FAILED|EXHAUSTED|null",
  "last_notification_at": "ISO8601 UTC | null"
}
```

The body to create is `POST /subscriptions { component_id, webhook_url, description?, metadata? }`. The response is `201 { ...subscription, signing_secret: "<one-time>" }` — the `signing_secret` is shown **only at create time** (and at `rotate-secret` time). Marketplace persists a SHA-256 digest of the secret in DynamoDB and stores the raw value in AWS Secrets Manager at `arn:aws:secretsmanager:<region>:<account>:secret:marketplace/subscription/<subscription_id>` (KMS-encrypted with `DataKey`). Lost secrets are rotated via `POST /subscriptions/{subscription_id}/rotate-secret`, which atomically writes a new secret and invalidates the prior one.

A `webhook_url` MUST be `https://`. At create-time Marketplace runs an **Asana-style handshake** against the exact target URL before the subscription row becomes active:

```http
POST <webhook_url>
X-Marketplace-Hook-Intent: subscription.handshake
X-Marketplace-Hook-Secret: <signing_secret>
```

The receiver MUST respond `200 OK` or `204 No Content` and echo the identical `X-Marketplace-Hook-Secret` header. Marketplace refuses with 422 if the URL is unreachable, returns non-2xx, omits the echoed header, or echoes a different value. The handshake is not a Marketplace event: it carries no `X-Marketplace-Event`, no notification body, and no `X-Marketplace-Signature`. Marketplace does not persist the subscription row or secret until this probe succeeds, and receivers such as Puller must treat the probe as a stateless liveness check that does not depend on their local subscription-create transaction having completed. Subscribers can re-run the probe later via `POST /subscriptions/verify { webhook_url, signing_secret? }` (idempotent) without persisting a row; Marketplace sends the same handshake headers, using the provided secret or a one-shot probe secret if absent.

A subscription is **scoped to exactly one component**. To listen on N components, create N subscriptions; this keeps fan-out, retry budgets, and audit trails strictly per-component.

### 3.6 Notification

A **Notification** is one fan-out event for one `(subscription, bundle)` pair. Its lifecycle and outbound payload are:

```
Lifecycle (per (subscription_id, bundle_id) pair):
  PENDING  → DELIVERING → DELIVERED                              (success on attempt n ≤ NOTIFICATION_RETRY_MAX_ATTEMPTS)
           → DELIVERING → FAILED → DELIVERING → … → DELIVERED   (transient failures, retried with backoff)
           → DELIVERING → FAILED → … → EXHAUSTED                 (max attempts reached; subscription auto-paused after 3 consecutive EXHAUSTED runs)
```

Outbound HTTP payload (`POST <webhook_url>`):

```jsonc
{
  "event": "component.bundle.published",
  "event_id": "ntf_01H01965DB8QGSD9EZWF1VS7BC",          // notification_id, idempotency key for the receiver
  "event_time": "2026-05-05T15:48:12.123Z",
  "marketplace": {
    "host": "marketplace.staircaseapi.com",
    "subscription_id": "sub_01H01…"
  },
  "component": {
    "component_id": "Connector",
    "type": "SERVICE",
    "product_id": "9e4…"
  },
  "bundle": {
    "bundle_id": "01H01965DB8QGSD9EZWF1VS7BC",
    "bundle_url": "https://<presigned-s3-url>",          // TTL = NOTIFICATION_PRESIGN_TTL_SECONDS (default 1 h)
    "bundle_url_expires_at": "2026-05-05T16:48:12Z",
    "uploaded_at": "2026-05-05T15:47:58Z",
    "description": "…",
    "dependencies": ["Persist", "Lexicon"],
    "deploy_time_dependencies": ["Build"],
    "dependency_layers": [[{ "component_id": "Build", "type": "SERVICE", "product_id": "…" }], …],
    "lexicon_version_id": "01J…|null",
    "bundle_meta": { /* sanitised, see §3.3 */ }
  },
  "previous_bundle_id": "01GZ…|null"                     // the bundle the subscriber was last notified about, or null on first delivery
}
```

Headers on every outbound request:

| Header                         | Value                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`                 | `application/json`                                                                                                                                                     |
| `User-Agent`                   | `Marketplace/1.0 (+https://<marketplace_host>/marketplace/information)`                                                                                                |
| `X-Marketplace-Event`          | `component.bundle.published`                                                                                                                                           |
| `X-Marketplace-Event-Id`       | `<notification_id>` (idempotency key; receivers MUST treat duplicate event IDs as no-ops)                                                                              |
| `X-Marketplace-Subscription`   | `<subscription_id>`                                                                                                                                                    |
| `X-Marketplace-Delivery`       | `<delivery_attempt_n>`                                                                                                                                                 |
| `X-Marketplace-Signature`      | `v1=<hex(hmac_sha256(signing_secret, raw_request_body))>` — receivers MUST compute the HMAC over the **raw bytes** of the body and constant-time-compare with this header |
| `X-Marketplace-Signature-Time` | `<unix_seconds>` — receivers MAY reject if skew >5 min                                                                                                                 |

**Receiver contract.** Marketplace treats any 2xx response (including empty body) as `DELIVERED`. Any 4xx response **other than 408** (request timeout) and 429 (rate limit) is treated as a permanent failure (`EXHAUSTED` after one attempt — Marketplace will not retry a 410 / 422 / etc., on the assumption that the receiver has rejected the payload deliberately). 408, 429, 5xx, network errors, and timeouts are retried per `NOTIFICATION_RETRY_*` env-var caps with exponential backoff `min(NOTIFICATION_RETRY_BASE_DELAY_MS * 2^(n-1), NOTIFICATION_RETRY_MAX_DELAY_MS)`. After `NOTIFICATION_RETRY_MAX_ATTEMPTS` (default 5), the notification row is `EXHAUSTED`.

**Auto-pause.** When a subscription accumulates 3 consecutive `EXHAUSTED` notifications, Marketplace flips its `status` to `PAUSED` and stops enqueueing further fan-outs for that subscription until an operator (or the subscription owner) calls `PATCH /subscriptions/{subscription_id} { status: "ACTIVE" }`. The auto-pause is recorded with reason `"auto_paused_after_exhausted"` so dashboards can flag it.

### 3.7 Error catalogue → HTTP status

| HTTP | Tag(s)                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `BadRequest`, `InvalidPaginationToken`, `InvalidQueryParams`, `InvalidPathParams`, `InvalidBody`, `DependencyCycleError` (post-load)                                                          |
| 401  | `IncorrectAuthorization`                                                                                                                                                                     |
| 403  | `SubscriptionSecretMismatch` (caller did not prove knowledge of the subscription's current signing secret)                                                                                    |
| 404  | `ComponentNotFound`, `BundleNotFound`, `SubscriptionNotFound`, `NotificationNotFound`, `ConfigurationNotFound`, `ProductNotFound`, `CategoryNotFound`, `FamilyNotFound`, `ApiNotFound`        |
| 409  | `ComponentNameConflictAcrossRegistries`, `ComponentInUpdatingState`, `SubscriptionAlreadyExists` (same `component_id` + `webhook_url` pair already exists)                                  |
| 422  | `InvalidBundleURL`, `BundleTooLarge`, `BundleAssessmentVersionHashOutdated`, `BundleTesterVersionHashOutdated`, `BundleTypeMismatch`, `UnknownBundleType`, `InvalidDependencySpecification`, `IncompatibleLexiconVersionId`, `WebhookUrlUnreachable`, `WebhookUrlInsecure`, `EnvAdminNotConfigured`, `RegulatorProductInvalid`, `EnvironmentInactive` |
| 500  | `InternalServerError`                                                                                                                                                                        |
| 504  | `WebhookUrlConnectionTimeout`, `RetryableUpstreamError`                                                                                                                                       |

`POST /subscriptions/{subscription_id}/notifications/replay` returns `202` with the new `notification_id`; if the subscription is `PAUSED` it returns `409 SubscriptionPaused`.

---

## 4. Synchronous APIs

### 4.1 Bundles

| Verb     | Path                                                                                       | Auth    | Behaviour                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT`    | `/ontology/products/{product_id}/components/{component_id}/bundles`                        | API key | Upload a new bundle. Body: `{ description?, bundle_url, dependencies?, deploy_time_dependencies? }`. See §4.1.1.                                                                                                                               |
| `GET`    | `/ontology/products/{product_id}/components/{component_id}/bundles`                        | API key | Paginated list of a component's bundles (sort: `desc` by ULID, limit ≤15, `after_id` is a ULID, `next_token` for opaque pagination).                                                                                                           |
| `GET`    | `/ontology/products/{product_id}/components/{component_id}/bundles/{bundle_id}`            | API key | Detail of one bundle (200) or 404. `bundle_id` must be a valid ULID.                                                                                                                                                                           |
| `DELETE` | `/ontology/products/{product_id}/components/{component_id}/bundles/{bundle_id}`            | API key | Delete one bundle from DDB and S3. 404 if missing. Subscribers are **not** notified of deletions.                                                                                                                                              |
| `POST`   | `/ontology/products/{product_id}/components/{component_id}/rollback`                       | API key | Take the previous bundle, rebuild it under a fresh `bundle_id`, and re-run the publication pipeline with `skip_review=True` and `ignore_validate=True`. Refuses (400) if fewer than 2 bundles exist. Deletes the two prior bundles on success. The fresh bundle, once `Valid`, fans out as a normal `component.bundle.published` notification. |
| `GET`    | `/reviews/{review_id}`                                                                     | API key | Get publication-pipeline status for `review_id` (== `bundle_id`). Returns `{ status: "RUNNING|SUCCEEDED|FAILED", review_details?: { deploy_logs, comply_logs, marketplace_logs } }`. 404 if no Step Functions execution exists for this id.    |

#### 4.1.1 `PUT /ontology/products/{product_id}/components/{component_id}/bundles` pipeline

The router executes the validation gates **before** any side effect:

1. **Catalog product must exist** (404).
2. **Component must exist under that product** (404).
3. **Component must not be in an updating state** (409).
4. **Body must validate** against the bundle upload schema (400).
5. **Bundle URL must be reachable** — `HEAD bundle_url` with 3 s timeout. 422 `bundle_url is unavailable.` if not.
6. **Bundle size must be bounded** — require `Content-Length` on the `HEAD` response and reject `Content-Length > MAX_BUNDLE_BYTES` with 422 `BundleTooLarge`. Marketplace's size limit is the platform artifact-size contract; Deployer must reject anything larger too.
7. **Bundle metadata must be decodable** — extract from response headers, JSON-decode (422 `Unknown bundle type.` on failure).
8. **Bundle's declared `bundle_type` must match the component's `type`** (422 `Invalid bundle type. Expected - <component.type>, given - <bundle_type>`).
9. **Assessment version hash must be the latest** — validate against the catalog product's regulator (422). Direct dependencies are similarly checked against the **latest or second-latest** assessment hash.
10. **DATA bundles must additionally pass the Tester version hash check** when a `service-test` block exists in the latest Test bundle's metadata.
11. **DATA components cannot have `deploy_time_dependencies`** (422).
12. **No self-dependency** (422 `cannot depend on itself`).
13. **No intersection between `dependencies` and `deploy_time_dependencies`** (422 with the intersecting names).
14. **No dependency cycle** — topological-sort dry-run over the current component plus the resolved direct dependency owners (422 `Cycle: A -> B -> A`). The resolved layers are persisted on the bundle row as `dependency_layers` and re-emitted in every subsequent notification.
15. **Every direct dependency must be a registered component with at least one bundle** (422).
16. **Lexicon-version compatibility** — when the bundle declares `service-builder.lexicon_version_id`, every dependent component must already be on a lexicon ≥ that ID; otherwise 422 `… is incompatible with its clients.`.

On success, Marketplace mints a ULID `bundle_id`, persists the bundle row (`bundle_status=UPLOADING_IN_PROGRESS`), then `StartExecution` on `PutProductBundle` SFN (§5.1) and returns `202 { component_id, bundle_status: "UPLOADING_IN_PROGRESS", review_id: bundle_id }`.

#### 4.1.2 System components for tenant bootstrap

Marketplace is also the distribution source for the two system components required to make a fresh tenant environment self-deploying:

- `Deployer` — the local-account-only infrastructure deployment product.
- `MarketplacePuller` — the tenant-side subscription, webhook, and reconciliation product.

These are ordinary catalog components with released bundles. The bootstrap CLI defined in `Bootstrap.md` uses the tenant owner's API key to fetch the latest valid bundle for each component through the same `GET /ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1` route that Puller uses for normal reconciliation. Marketplace does not get AWS credentials, does not assume into tenant accounts, and does not call CloudFormation for bootstrap; it only authorizes the caller, returns catalog metadata, and issues presigned `bundle_url`s.

### 4.2 Subscriptions

| Verb     | Path                                                                | Auth     | Behaviour                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/subscriptions`                                                    | API key  | Create a subscription. Body: `{ component_id, webhook_url, description?, metadata? }`. Validates that the component exists, that the URL is `https://` and completes the `X-Marketplace-Hook-Secret` handshake before persistence, and that no active `(component_id, webhook_url)` pair already exists. Mints a `subscription_id` and a one-time `signing_secret`. Returns `201` with the secret in the body. |
| `GET`    | `/subscriptions`                                                    | API key  | Paginated lookup for operators that already know their receiver URL. Requires `?webhook_url=<url>` and `X-Marketplace-Subscription-Secret` matching at least one subscription for that URL; supports `?component_id=<id>`, `?status=ACTIVE|PAUSED`, `?limit=<1..100>&next_token=<base64>`. |
| `GET`    | `/subscriptions/{subscription_id}`                                  | API key  | Detail of one subscription (200) or 404. Requires `X-Marketplace-Subscription-Secret` matching the stored digest for that subscription; 403 on mismatch.                                                                                                                                                                                                                |
| `PATCH`  | `/subscriptions/{subscription_id}`                                  | API key  | Update one or more of `webhook_url`, `description`, `metadata`, `status` (`ACTIVE|PAUSED`). Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret. Re-runs the `X-Marketplace-Hook-Secret` handshake when `webhook_url` changes; refuses 422 if unreachable or not echoed. |
| `DELETE` | `/subscriptions/{subscription_id}`                                  | API key  | Delete the subscription, its Secrets Manager secret, and (TTL'd) its notification history. Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret. `204 No Content`.                                                                                                                                                                  |
| `POST`   | `/subscriptions/{subscription_id}/rotate-secret`                    | API key  | Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret. Mints a new `signing_secret`, atomically replaces the Secrets Manager value, and returns the new secret in the response body (one-time). The old secret remains valid for an overlap window of 60 s so in-flight notifications can still be verified. |
| `GET`    | `/subscriptions/{subscription_id}/notifications`                    | API key  | Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret. Paginated notification history for this subscription (sort: `desc` by `event_time`, limit ≤50). Each row carries `notification_id`, `bundle_id`, `status`, `attempt_count`, `last_attempt_at`, `last_response_status`, `last_response_excerpt` (≤512 chars), `next_attempt_at?`. |
| `GET`    | `/subscriptions/{subscription_id}/notifications/{notification_id}`  | API key  | Detail of one notification (200) or 404. Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret.                                                                                                                                                                                                                                         |
| `POST`   | `/subscriptions/{subscription_id}/notifications/replay`             | API key  | Requires `X-Marketplace-Subscription-Secret` matching the current subscription secret. Re-send the latest notification for this subscription (does NOT mint a new `event_id` — the original idempotency key is preserved so receivers can dedupe). Returns `202 { notification_id, replayed_at }`. 409 if the subscription is `PAUSED`. |
| `POST`   | `/subscriptions/verify`                                             | API key  | Stateless liveness check. Body: `{ webhook_url, signing_secret? }`. Marketplace POSTs the same handshake headers to the URL with the provided secret (or a one-shot probe secret if absent) and returns `{ ok, response_status, response_excerpt }`. Useful pre-create or for ad-hoc diagnostics.                                                                        |

The `POST /subscriptions` body schema:

```jsonc
{
  "component_id": "Connector",
  "webhook_url": "https://subscriber.example.com/marketplace/notifications",
  "description": "Tenant XYZ — Connector pull",   // optional
  "metadata": { "env": "prod" }                    // optional, max 4 KB
}
```

The `POST /subscriptions` `201` response:

```jsonc
{
  "subscription_id": "sub_01H01…",
  "component_id": "Connector",
  "product_id": "9e4…",
  "webhook_url": "https://subscriber.example.com/marketplace/notifications",
  "signing_secret": "whsec_<base64url>",   // shown ONCE; persist client-side
  "signing_secret_set": true,
  "status": "ACTIVE",
  "description": "Tenant XYZ — Connector pull",
  "metadata": { "env": "prod" },
  "created_at": "2026-05-05T15:00:00Z",
  "updated_at": "2026-05-05T15:00:00Z"
}
```

For every subscription management route after creation, the caller MUST include `X-Marketplace-Subscription-Secret: <current signing_secret>` unless the route explicitly documents a one-shot handshake proof. Marketplace hashes the supplied value with SHA-256 and constant-time-compares it with `signing_secret_sha256`; raw secrets are never persisted in DynamoDB. The caller's `x-api-key` remains required by API Gateway for coarse Marketplace access, but Marketplace never stores the API Gateway key id on the subscription row and never uses key id equality as ownership.

### 4.3 Catalog (Ontology)

The catalog API mirrors the hierarchy in §3.4. Every route accepts canonical pagination (`?limit=<1..100>&next_token=<base64>`) where applicable; expensive listings (per-product configurations, per-product APIs with prices, free-form name search) cap `limit` at 15 and default to 5. Cheap listings cap at 100 and default to 20. Public catalog endpoints (those not marked `private: true`) are API-key-required so partner sites can browse the catalog.

| Group          | Verb     | Path                                                                | Behaviour                                                                                                                                                                                                                            |
| -------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Families       | `POST`   | `/ontology/families`                                                | Create a family. Body `{ family_name }`. Returns `201 { family_id }`.                                                                                                                                                                |
|                | `GET`    | `/ontology/families`                                                | Paginated list `{ families: [ { family_id, family_name, created_at } ], page }`.                                                                                                                                                     |
|                | `GET`    | `/ontology/families/{family_id}/categories`                         | Family with paginated categories `{ family_id, family_name, categories[], page }`.                                                                                                                                                   |
|                | `DELETE` | `/ontology/families/{family_id}`                                    | Delete (only if no categories left).                                                                                                                                                                                                 |
| Categories     | `POST`   | `/ontology/families/{family_name}/categories`                       | Create. Body `{ category_name }`. Returns `201 { category_id }`.                                                                                                                                                                     |
|                | `GET`    | `/ontology/categories/{category_id}/products`                       | Category with paginated products `{ category_id, category_name, products[], page }`.                                                                                                                                                 |
|                | `DELETE` | `/ontology/categories/{category_id}`                                | Delete (only if no products left).                                                                                                                                                                                                   |
| Products       | `POST`   | `/ontology/categories/{category_id}/products`                       | Create a product under a category. Body `{ product_name }`. Returns `201 { product_id }`.                                                                                                                                            |
|                | `GET`    | `/ontology/products/by-name?name=<canonical_name>`                  | Search products by name (cross-category). Returns `{ products[], page }`.                                                                                                                                                            |
|                | `PATCH`  | `/ontology/products/{product_id}/name`                              | Rename a product.                                                                                                                                                                                                                    |
|                | `DELETE` | `/ontology/products/{product_id}`                                   | Delete.                                                                                                                                                                                                                              |
| APIs           | `POST`   | `/ontology/products/{product_id}/api`                               | Add one priced API to a product. Body: `ApiFields`. Returns `201 { product_api_identifier }`.                                                                                                                                        |
|                | `POST`   | `/ontology/products/{product_id}/api/many`                          | Add up to 15 priced APIs at once (refuses 409 if any APIs already exist for the product).                                                                                                                                            |
|                | `GET`    | `/ontology/products/{product_id}/api`                               | Paginated APIs (`include_prices=true|false`).                                                                                                                                                                                        |
|                | `GET`    | `/ontology/products/{product_id}/api/{api_id}`                      | Detail of one API.                                                                                                                                                                                                                   |
|                | `DELETE` | `/ontology/products/{product_id}/api/{api_id}`                      | Delete an API.                                                                                                                                                                                                                       |
| Prices         | `POST`   | `/ontology/products/{product_id}/api/{api_id}/prices`               | Add a price revision. Body: `PriceFields` (cents amount, calculation type, unit type, timing type — see §6.3.1).                                                                                                                     |
|                | `GET`    | `/ontology/products/{product_id}/api/{api_id}/prices`               | Paginated price history (latest by default).                                                                                                                                                                                         |
|                | `DELETE` | `/ontology/products/{product_id}/api/{api_id}/prices/{price_id}`    | Delete one price revision.                                                                                                                                                                                                           |
| Configurations | `POST`   | `/ontology/products/{product_id}/configurations`                    | Create a configuration. Body: `{ configuration_description, configured_product_id, configured_product_api_id?, company_ids[] }`. `configured_product_id`, `configured_product_api_id`, and `company_ids[]` must all reference local ontology entities. |
|                | `GET`    | `/ontology/products/{product_id}/configurations`                    | Paginated configurations (optional `?configured_product_id=<id>` filter).                                                                                                                                                            |
|                | `GET`    | `/ontology/products/{product_id}/configurations/{configuration_id}` | Detail of one configuration.                                                                                                                                                                                                         |
|                | `PATCH`  | `/ontology/products/{product_id}/configurations/{configuration_id}` | Extend (companies / description / configured_product_id / configured_product_api_id). Remote host/API-key reference shapes are rejected.                                                                                              |
|                | `DELETE` | `/ontology/products/{product_id}/configurations/{configuration_id}` | Delete a configuration. Optional `?company_ids=…` removes specific companies only.                                                                                                                                                   |
|                | `GET`    | `/ontology/configurations/by-company?company_id=<id>`               | Paginated list of configurations referencing a company.                                                                                                                                                                              |
| Components     | `POST`   | `/ontology/products/{product_id}/components`                        | Create up to 15 components under a product. Body `{ components: [ { component_id, type: "SERVICE"|"DATA", description? } ] }`. Returns `201 { components: [ { component_id, type } ] }`. 409 if any `component_id` already exists globally; 422 if `type` is omitted or invalid. |
|                | `GET`    | `/ontology/products/{product_id}/components`                        | Paginated list of components under a product `{ components: [ { component_id, type, description?, bundle_status?, update_at? } ], page }`.                                                                                          |
|                | `GET`    | `/ontology/products/{product_id}/components/{component_id}`         | Detail of one component (200) or 404; includes the latest bundle's `bundle_meta`, `bundle_url`, `dependencies`, `deploy_time_dependencies` if any bundle exists.                                                                    |
|                | `DELETE` | `/ontology/products/{product_id}/components/{component_id}`         | Delete a component. Refuses (409) if any bundles or active subscriptions reference it.                                                                                                                                              |
|                | `GET`    | `/ontology/components/search/{search_by}`                           | Best-effort component search across the catalog; returns each hit with `component_id`, `type`, `product_id`, and a fully-qualified `_link`.                                                                                          |
| Metadata       | `PATCH`  | `/ontology/(family|category|product)/{id}/metadata`                 | Set free-form metadata (validated against `FamilyMetadata` / `CategoryMetadata` / `ProductMetadata` schemas — `description`, `homepage`, `logotype_url`, `documentation`, `codex`, `asana_board_id`, …).                             |
|                | `GET`    | `/ontology/(family|category|product)/{id}/metadata`                 | Read metadata.                                                                                                                                                                                                                       |
| Full snapshot  | `GET`    | `/ontology`                                                         | Returns a JSON URL or the JSON itself for a daily-cached full ontology snapshot under `s3://<BundlesBucket>/<ontology-prefix>/<YYYY-MM-DD>`. Lazily triggers a re-dump if the day's object is missing.                                |

### 4.4 Instance configuration

| Verb  | Path               | Auth    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT` | `/settings`        | API key | Replace one or more instance settings (review/self-cleaning-review/site/quicksight/env-admin/regulator). Review settings include `review_api_key`, `review_environment_hosts[]`, and optional `self_cleaning_review_api_key` + `self_cleaning_review_environment_host`. Each non-admin key/host pair is validated by calling env-admin to ensure the corresponding environment is reachable and not in a `BAD_ENVIRONMENT_STATUSES` state. The `code_assessment_regulator.regulator_product_identifier` is validated against the local `OntologyTable` product rows (422 if not found). Persists each value to its `*_SSM_PARAM` (KMS-encrypted SecureString for keys, non-secret String/StringList for hosts). |
| `GET` | `/settings/status` | API key | Operational health: `{ status: { component_publication: { is_operational, conflicts[] }, site_publication: { is_operational }, code_assessment_regulator: { is_operational }, secondary_review_environment_status: "Operational|CleaningInProgress|EnvironmentBroken|NotSet" } }`.                                                                                                                                                                                                                                    |
| `GET` | `/settings/schema` | API key | JSONSchema for the `PUT /settings` body, derived from `ConfigureMarketplaceSchema`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 5. Asynchronous Pipelines

Marketplace operates three STANDARD Step Functions state machines (all `tracingEnabled: true`). Concurrency caps are documented per-Map; every workflow uses `RetryableError` / `FailError` / `SignalSkipDeployment` tagged classes (§3.7) so the Step Functions `Catch` can route correctly.

### 5.1 `PutProductBundle` — bundle publication pipeline

```
CheckSkipReview (Choice on $.skip_review)
  ├── true → PutBundleToS3 → UpdateBundleStatus → FailureChoice
  └── false → CheckComplyStatus (Lambda; Catch FailedComplyError → UpdateBundleStatus)
              → DeployBundleToSandbox
              → WaitingState (Wait 15 s) → CheckDeployStatus
                   ├── IN_PROGRESS → WaitingState (poll loop; up to retry budgets per task)
                   ├── SUCCEEDED   → PutBundleToS3
                   └── otherwise   → GetFailedDeployLogs
              → UpdateBundleStatus → FailureChoice
                    ├── Failed → FailState
                    └── Valid  → OnSuccessOperations (Parallel: EmitBundlePublished + PublishSiteArtifacts) → SuccessState
```

- **Inputs**: `{ bundle_url, product_id, component_id, type, bundle_id, dependencies[], deploy_time_dependencies[], dependency_layers, decoded_bundle_metadata, host, api_key, previous_bundle_id?, review_environments, skip_review }`. `review_environments` is loaded by the bundle route from `REVIEW_ENVIRONMENT_HOSTS_SSM_PARAM` plus the optional `SELF_CLEANING_REVIEW_ENVIRONMENT_HOST_SSM_PARAM`; it is never caller-supplied in the bundle upload body.
- **Comply gate**: `CheckComplyStatus` reads `$.decoded_bundle_metadata.service-comply.severity_label`; `CRITICAL`/`HIGH`/`MEDIUM` → `FailedComplyError` → `UpdateBundleStatus`. Anything else → `comply_status=SUCCEEDED`.
- **Sandbox delivery** (`DeployBundleToSandbox`): pushes the bundle into every configured `review_environment_hosts[]` target using `review_api_key` (and into `self_cleaning_review_environment_host` with `self_cleaning_review_api_key` when configured) to confirm the artifact actually deploys end-to-end. On terminal failure in any required review environment, the bundle is marked `Failed` and never fans out to subscribers.
- **Re-upload + sanitisation** (`PutBundleToS3`): re-checks the bundle URL availability, sanitises the metadata (strip `service-*.{status, applied_rules, version}`), stamps `service-marketplace = { component_id, id: bundle_id, status: "SUCCEEDED", issuer: <host>marketplace/, timestamp, version: "1.0" }`, JWT-encodes each sanitized `service-*` metadata payload back into its corresponding `x-amz-meta-service-*` header, uploads to `s3://<BundlesBucket>/bundles/<product_id>/<component_id>/<bundle_id>` with those JWT-shaped metadata headers, and updates the DDB row to `in_review=true, decoded_bundle_metadata=<full>` so the next `UpdateBundleStatus` step can flip `bundle_status=Valid`.
- **OnSuccessOperations** (Parallel): `EmitBundlePublished` (`states:startExecution.sync` against `NotifyComponentSubscribers` SFN — see §5.2) and `PublishSiteArtifacts` (publishes to the configured site env). Both branches catch `States.ALL` to a `Succeed` fallback so a single failure cannot block the success path of the other.
- **Total budget**: ~14 min (30 polls × 15 s for the deploy loop, plus retry buffers).

### 5.2 `NotifyComponentSubscribers` — notification fan-out

```
LoadActiveSubscriptions (Lambda; Query SubscriptionsTable for pk=COMPONENT#<component_id> AND status=ACTIVE)
  → DistributedMap (Mode=DISTRIBUTED, ExecutionType=STANDARD, MaxConcurrency=200)
      ItemsPath: $.subscriptions
      ItemSelector: { subscription, bundle, marketplace, event_id_seed }
      Iterator (per subscription):
        BuildNotificationPayload (Lambda; mints presigned bundle_url with TTL = NOTIFICATION_PRESIGN_TTL_SECONDS)
        → PersistNotificationRow (DDB PutItem in NotificationsTable, status=PENDING, attempt=0)
        → SignAndSendNotification (Lambda; HMAC-signed POST; classifier-aware retry inside the Lambda for sub-second backoffs)
            ├── DELIVERED → RecordNotificationOutcome (status=DELIVERED, response_excerpt)
            ├── FAILED (transient) → Wait (exp-backoff) → SignAndSendNotification (loop, n ≤ NOTIFICATION_RETRY_MAX_ATTEMPTS)
            └── FAILED (permanent: 4xx other than 408/429) → RecordNotificationOutcome (status=EXHAUSTED, attempt=1)
        → CheckExhausted (Choice)
            ├── EXHAUSTED → MaybeAutoPause (Lambda; if 3 consecutive EXHAUSTED for this subscription, set status=PAUSED)
            └── DELIVERED → SuccessState
```

- **Trigger**: `PutProductBundle` calls `states:startExecution.sync` with `{ component_id, bundle_id, product_id }`. The map runs synchronously from the parent's perspective so the publication SFN's success state reflects "every fan-out attempt has been recorded" (not "every fan-out succeeded"; permanent / transient failures are bookkept in `NotificationsTable` and surfaced via `GET /subscriptions/{id}/notifications`).
- **Per-subscription retry budget**: `NOTIFICATION_RETRY_MAX_ATTEMPTS` (default 5) attempts with exponential backoff `min(NOTIFICATION_RETRY_BASE_DELAY_MS * 2^(n-1), NOTIFICATION_RETRY_MAX_DELAY_MS)`. Per-attempt HTTP timeout = `NOTIFICATION_TIMEOUT_MS` (default 15 s).
- **Idempotency**: `event_id` is `notification_id = "ntf_" + ulid(now)` minted **once** per `(subscription_id, bundle_id)` pair and held stable across retries. Receivers MUST treat duplicate `event_id`s as no-ops (see §3.6).
- **Auto-pause**: `MaybeAutoPause` consults the last 3 notification rows for the subscription; if all are `EXHAUSTED`, it CAS-updates `status=PAUSED` with `auto_paused_reason="auto_paused_after_exhausted"` and `auto_paused_at=<now>`.
- **Concurrency**: `MaxConcurrency=200` per Distributed Map; raise via context only when a single component routinely fans out to >200 subscribers.

### 5.3 `UpdateQuicksightDataset` — analytics refresh

```
UpdateQuicksight (Lambda: updateQuicksightDataset, 15 min, 2048 MB; Retry 3× backoff 5)
```

Iterates every `(subscription_id, component_id)` pair in `SubscriptionsTable`, joins per-bundle notification counts from `NotificationsTable`, builds a JSON array, uploads it as a Persistence-API blob, fetches a download URL, and updates a Persistence-API-anchored QuickSight dataset. Triggered manually via `PUT /quicksight/subscription-to-component` (private).

### 5.4 Self-cleaning review env

A simple EventBridge schedule (`cron(0 2 * * ? *)`, daily at 02:00 UTC) invokes `CleanSelfCleaningEnvironment`, which `POST https://<env_admin_domain>/administrator/start-clean/<self_clean_env_fqdn>` whenever `SELF_CLEANING_REVIEW_API_KEY` is set. No state machine is needed — the cleanup is fully owned by env-admin.

---

## 6. Internal Data Schemas

### 6.1 ComponentsTable item shapes

```
# Component row
{ pk: "COMPONENT#<component_id>", sk: "_", component_id, type: "SERVICE|DATA",
  product_id, description, dependencies?, deploy_time_dependencies?,
  created_at, gsi2pk: "ONTOLOGY_PRODUCT_ID#<product_id>" }

# Bundle row (committed)
{ pk: "COMPONENT#<component_id>", sk: "BUNDLE#<bundle_id>", bundle_id, component_id, product_id, type,
  bundle_url (caller-supplied), bundle_status, uploaded_at, description,
  dependencies, deploy_time_dependencies, dependency_layers, lexicon_version_id, decoded_bundle_metadata,
  in_review: false }

# Bundle row (in-review)
{ pk: "COMPONENT#<component_id>", sk: "REVIEW#<bundle_id>", in_review: true, ... }

# Failed-review row
{ pk: "REVIEW_FAILED#<bundle_id>", sk: "_", deploy_logs, comply_logs, marketplace_logs }
```

`gsi1` (`gsi1pk/gsi1sk`) supports component-by-`type` and component-by-`bundle_status` queries; `gsi2` (`gsi2pk`) supports the catalog-product-to-components lookup (`ONTOLOGY_PRODUCT_ID#<product_id>` → all components owned by that product); `gsi3` is used for bundle-by-`gsi3pk` reverse lookups (e.g. by `lexicon_version_id`).

### 6.2 SubscriptionsTable + NotificationsTable item shapes

```
# Subscription row (one per (component_id, subscription_id) pair)
{ pk: "COMPONENT#<component_id>",
  sk: "SUB#<subscription_id>",
  subscription_id, component_id, product_id,
  webhook_url,                                  // canonical lowercased
  webhook_url_host,                             // denormalised for gsi2pk
  signing_secret_sha256,                        // 64-char hex; raw secret lives in Secrets Manager
  signing_secret_arn,                           // arn:aws:secretsmanager:<region>:<account>:secret:marketplace/subscription/<subscription_id>
  status: "ACTIVE|PAUSED",
  description?, metadata?,
  created_at, updated_at,
  last_published_bundle_id?, last_notification_id?, last_notification_status?, last_notification_at?,
  consecutive_exhausted_count: <int>,
  auto_paused_reason?, auto_paused_at?,
  gsi1pk: "SUB#<subscription_id>",              // direct subscription_id lookup
  gsi1sk: "COMPONENT#<component_id>",
  gsi2pk: "WEBHOOK_HOST#<webhook_url_host>"     // operator-side host-grouped queries
}

# Notification row (one per delivery attempt batch — one row covers all attempts of one (subscription_id, bundle_id) pair)
{ pk: "SUB#<subscription_id>",
  sk: "NOTIF#<notification_id>",
  notification_id, subscription_id, component_id, bundle_id,
  event_id: "<notification_id>",                // identical to sk — kept explicit for clarity
  event_time, status: "PENDING|DELIVERING|DELIVERED|EXHAUSTED",
  attempt_count: <int>,
  attempts: [ { n, sent_at, response_status, response_excerpt, error_class? } ],
  next_attempt_at?,
  gsi1pk: "COMPONENT#<component_id>",           // per-bundle fan-out audit
  gsi1sk: "<bundle_id>#<subscription_id>",
  ttl: <unix_epoch>                             // 30 d for DELIVERED, 180 d for EXHAUSTED, 7 d for cancelled
}
```

The signing secret is **never** materialised in DynamoDB — only its SHA-256 digest, used to verify replay attempts and to detect drift between the database and Secrets Manager. The raw value lives in AWS Secrets Manager at `arn:aws:secretsmanager:<region>:<account>:secret:marketplace/subscription/<subscription_id>` (KMS-encrypted with `DataKey`) and is fetched on demand by the `SignAndSendNotification` worker.

### 6.3 OntologyTable item shapes

The catalog is the **only** place where products and the product↔component relationship are stored. There is no second registry; every component is reachable from a catalog product via `gsi2pk` on its row in `ComponentsTable` (§6.1).

```
# Family
{ pk: "FAMILY",   sk: "F#<family_id>",   family_id, family_name, created_at,
  metadata?: { description, homepage, logotype_url } }

# Category
{ pk: "CATEGORY", sk: "C#<category_id>", category_id, category_name, family_id, created_at,
  gsi2pk: "F#<family_id>", metadata? }

# Product
{ pk: "PRODUCT",  sk: "P#<product_id>",  product_id, product_name, category_id, created_at,
  gsi2pk: "C#<category_id>", gsi2sk: "P#<product_name>", metadata? }

# API
{ pk: "API",      sk: "<api_id>",        api_id, product_id, api_name, description, type, invocation_type,
  gsi2pk: "P#<product_id>" }

# Price revision
{ pk: "PRICE",    sk: "<api_id>#<revision_id>", price_id, revision_id, price, price_unit, calculation_type,
  unit_type, timing_type, gsi2pk: "API#<api_id>" }

# Configuration
{ pk: "CONFIG",   sk: "<configuration_id>", configuration_id, product_id, configuration_description,
  configured_product_id, configured_product_api_id?, company_ids[],
  gsi2pk: "P#<product_id>", gsi3pk: "COMPANY#<company_id>" (one row per company) }
```

#### 6.3.1 Price field constraints

`PriceFields` accepts:

- `price_amount`: decimal in cents (`0.01..999_999_999.99`, max 2 decimals).
- `price_amount_unit_type`: `"cent"`.
- `price_calculation_type`: one of `average_supplier`, `cost_of_goods_sold`, `equivalent_labor_cost`, `maturity`.
- `price_unit_type`: one of `environment`, `product`, `seat`, `subscription`, `transaction`, `api_call`, `document`, `hour`, `image`, `page`, `person`, `person_hour`, `pm`, `pm_hour`, `datapoint`.
- `price_timing_type`: `completion` or `monthly`.

`ApiFields` accepts `product_api_description`, `product_api_name`, `product_api_type ∈ {configuration, function, platform}`, `product_api_invocation_type ∈ {aggregated_partner, analytics, environment, notification, operation, proxy, single_partner}`.

### 6.4 Step Functions input shapes

```ts
// PutProductBundle input
{
  product_id: string,               // owning catalog product
  component_id: string,             // owning component
  type: "SERVICE" | "DATA",         // inherited from the component
  bundle_id: string,                // ULID
  bundle_url: string,               // caller-supplied
  decoded_bundle_metadata: object,
  host: string,                     // marketplace https URL
  api_key: string,                  // marketplace local API key
  dependencies: string[],           // component_ids
  deploy_time_dependencies: string[],
  dependency_layers: Array<Array<{ component_id: string, type: "SERVICE" | "DATA", product_id: string }>>,
  previous_bundle_id?: string,
  review_environments: string[],    // FQDNs of review env(s)
  skip_review?: boolean,            // rollback path
  ignore_validate?: boolean,        // rollback path
}

// NotifyComponentSubscribers input
{
  component_id: string,
  bundle_id: string,
  product_id: string,
  trace_id: string                  // also used as SFN execution name; equals the bundle_id by default
}
```

### 6.5 OpenAPI

The full public/private API surface is described by `requirements/swagger.yml`. It is generated from the route module by `scripts/generate-openapi.ts` and checked in. The `documentation` block in `service.yml` (`type: private`, `publish: true`, `path: requirements/swagger.yml`, `components.ordering: [Subscription[warning], Subscription, Notification, Ontology, Product, Component, Custom Settings]`) declares the publication target and the canonical section ordering.

---

## 7. Cross-cutting Concerns

### 7.1 Error model and result envelope

All errors flow through a single `buildStdHttpError(status, ...other)` helper, which emits the `{ error: { message, reason, ... } }` envelope and maps the HTTP status to the right phrase / description. Internal sentinels `RetryableError`, `FailError`, `SignalSkipDeployment` are subclasses of a common `BaseError` whose constructor JSON-encodes the structured reason so Step Functions catches can route on `ErrorEquals`.

### 7.2 Authentication + authorisation model

- **API key** (`x-api-key`) — every public route except `GET /information`. API Gateway API keys provide coarse access to the Marketplace API but are not persisted as subscription owners. Rotating an Account-managed service key therefore has no effect on existing subscriptions.
- **Subscription management proof** — subscription-specific read/mutate/replay routes require `X-Marketplace-Subscription-Secret` with the current per-subscription secret and compare its SHA-256 digest to `signing_secret_sha256`. Create and webhook-URL update additionally prove receiver control through the `X-Marketplace-Hook-Secret` handshake. No subscription row stores API Gateway key ids.
- **HMAC subscription signing** — outbound notifications carry `X-Marketplace-Signature: v1=<hex>`; the secret is per-subscription, rotated by the owner.
- **Env-admin** is **only** consulted at `PUT /settings` time, to verify that the operator-supplied review/site/quicksight API keys really map to reachable environments. It is no longer in the subscription path.

### 7.3 Configuration loading

Each `ConfigEntry` (`REVIEW_API_KEY`, `ENV_ADMIN_API_KEY`, …) is a thin SSM wrapper with three operations: `get_value()` (returns raw, raises if absent), `value_or(default)` (returns raw or default), `update_secure(value)` (writes a SecureString). Values are cached in-process for a TTL; cache buckets are time-quantised so all warm Lambdas converge on the same value within one TTL window. A missing optional value MUST NOT block unrelated routes.

### 7.4 Dependency resolution

The dependency resolver walks the graph DFS at upload time, collecting **deploy-time** and **runtime** edges into a single `DependencyOwner(component_id, {dependencies, deploy_time_dependencies}, type)` set keyed by `component_id`. The dry-run topological sort raises `DependencyCycleError("A -> B -> A")` if a cycle is detected; the live layered sort returns a list-of-lists where each inner list is a layer that can deploy in parallel. The result is persisted as `dependency_layers` on the bundle row and re-emitted verbatim in every notification's `bundle.dependency_layers` field. Puller MUST install these layers in array order before deploying the notified bundle; components within one layer may deploy in parallel.

Constraints on dependencies (echoed verbatim in error messages):

- Runtime and deploy-time dependencies cannot have intersections.
- A component cannot depend on itself.
- A component cannot depend on a component without bundles.
- A component cannot depend on a component that does not exist.
- A `DATA` component cannot have `deploy_time_dependencies`.
- A component and its dependencies cannot form a cycle (deploy-time only; circular runtime deps are allowed for `SERVICE` components).
- A component cannot have dependencies whose `service-assessor.version_hash` is older than the second-latest available value.

### 7.5 Notification signing model

- **Algorithm**: HMAC-SHA256 over the **raw HTTP request body** (the full JSON serialisation, byte-for-byte). The header is `X-Marketplace-Signature: v1=<lowercase-hex>`; receivers MUST constant-time-compare.
- **Key**: per-subscription `signing_secret`, persisted only as a SHA-256 digest in DynamoDB. The raw value is in Secrets Manager and is fetched on demand by `SignAndSendNotification`.
- **Replay protection**: `X-Marketplace-Signature-Time: <unix_seconds>` is included, but it is **not** part of the signed bytes (it's metadata only); receivers MAY reject if skew >5 min, but the cryptographic guarantee is body-only. The server-side replay endpoint (`POST .../notifications/replay`) keeps the original `event_id` so receivers see a duplicate idempotency key and can choose to no-op.
- **Rotation overlap**: `POST /subscriptions/{subscription_id}/rotate-secret` keeps the old secret valid for 60 s after the new one is minted, so in-flight notifications signed with the old secret continue to verify cleanly during rotation.

### 7.6 Transaction tracing

Every public route reads or mints `X-Sc-Health-Transaction-Id` (header constant `TRACE_HEADER`) and stamps it on the response. Internal SFN executions use the same value as the `name` argument to `StartExecution` so a single transaction can be queried end-to-end via `aws stepfunctions describe-execution --execution-arn ...:<trace_id>`. The bundle publication pipeline uses the bundle's ULID `bundle_id` as the trace id; the notification fan-out pipeline uses `bundle_id` as the trace id (so all per-subscription deliveries for one bundle share one trace).

### 7.7 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=marketplace-*`, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once, appends a request-scoped key (`subscriptionId`, `notificationId`, `bundleId`, `componentId`, `productId`, …), and resets the keys in `finally`.
- **Metrics**: per-bundle fan-out emits `marketplace.notifications.delivered`, `marketplace.notifications.failed`, `marketplace.notifications.exhausted`, and `marketplace.notifications.attempt_latency_ms` to the `marketplace` namespace, dimensioned by `component_id` and `webhook_url_host`.
- **Tracing**: API Gateway access logs at log-level `ERROR`; X-Ray on every state machine; X-Ray on Lambda handlers.

### 7.8 Long-running command discipline

Every external HTTP call (review-env publisher, env-admin, site, persistence, comply-auth, work-dashboard) is wrapped in a shared HTTP client with `Retry(total=5, backoffFactor=0.1, statusForcelist=[500,502,503,504])` and a 60 s timeout default; tighter timeouts are applied per call (e.g. logotype-URL HEAD checks use 3 s, subscription liveness probe uses 5 s). The `SignAndSendNotification` worker uses `NOTIFICATION_TIMEOUT_MS` (default 15 s) per attempt and has its own classifier-aware retry policy (see §3.6).

### 7.9 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double:

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Complex services (`ComponentsRepository`, `SubscriptionsRepository`, `NotificationsRepository`, `OntologyRepository`, `BundlePublication`, `NotificationFanout`, `WebhookSigner`, etc.) expose pure-function factories so tests can pass mocks (in-memory clients, fixed clocks, deterministic ULIDs).
- Errors are **structured tagged classes** with a discriminator (`type` / `_tag`) so the HTTP layer can `switch` on them when mapping to status codes.
- Composition is split per route group (catalog / bundles / subscriptions / instance / analytics) so a missing env var for an unrelated route never breaks this one.

### 7.10 Testing strategy

- Unit tests live in `test/services/**/*.ts`, `test/handlers/**/*.ts`, `test/routes/**/*.ts`, `test/schemas/**/*.ts`, `test/dep-resolver/**/*.ts`, `test/notifications/**/*.ts`, and `test/cdk/marketplace-stack.test.ts`.
- Vitest is the test runner. Integration tests live in `test/integration/marketplace-api.test.ts` and hit a deployed API with `MARKETPLACE_API_URL` + `MARKETPLACE_API_KEY`.
- A test-double webhook receiver (`scripts/start-webhook-sink.sh`) is required for end-to-end notification fan-out tests. `just test` (the canonical CI command) starts/stops the Docker container automatically and asserts on the recorded payload + signature.
- The OpenAPI spec at `requirements/swagger.yml` is regenerated by `scripts/generate-openapi.ts` (driven from the route definitions module).

### 7.11 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI / CDK with permissions for S3, DynamoDB, KMS, SSM, Secrets Manager, Lambda, API Gateway, Step Functions, EventBridge, IAM, CloudWatch Logs.
- A pre-populated `Subdomain` value for the deployer-supplied custom domain.
- A Bootstrap-created shared tenant Usage Plan id at `/account/shared-usage-plan-id`; Marketplace attaches its API stage to that plan.
- One or more configured **review environments** (`review_environment_hosts[]`) reachable by `review_api_key` (Marketplace will only fan out bundles that pass sandbox review).

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # DataStack first, then WorkflowStack, then MarketplaceStack (CDK auto-orders)
pnpm cdk:destroy          # only when none of the DDB tables hold operator data
```

Stack outputs: `ApiUrl`, `BundlesBucketName`, `OntologyTableName`, `ComponentsTableName`, `SubscriptionsTableName`, `NotificationsTableName`, `KmsKeyArn`, `PutProductBundleArn`, `NotifyComponentSubscribersArn`, `UpdateQuicksightDatasetArn`. The `service-marketplace` cost tags are stamped on every resource.

### 8.3 First-time configuration

1. `PUT /settings` with at least `review_api_key` and `review_environment_hosts[]` (so bundle uploads can run a sandbox review). Additional keys/hosts (`self_cleaning_review_api_key`, `self_cleaning_review_environment_host`, `site_api_key`, `quicksight_api_key`, `env_administrator_*`, `code_assessment_regulator`) are optional but unlock further capabilities (parallel review env, site publication, analytics dump, regulator-product-bound assessment validation).
2. Build the catalog hierarchy: `POST /ontology/families` → `…/categories` → `…/categories/{category_id}/products`.
3. Register the system bootstrap components (`Deployer` and `MarketplacePuller`) as `SERVICE` components, then publish their first reviewed bundles. Fresh tenants cannot self-install products until these bundles exist.
4. `POST /ontology/products/{product_id}/components` for each additional component you want to publish (`{ component_id, type: "SERVICE"|"DATA", description? }`). Component IDs are globally unique.
5. `PUT /ontology/products/{product_id}/components/{component_id}/bundles` with each component's first bundle. Poll `GET /reviews/{review_id}` until `SUCCEEDED`.
6. Subscribers self-register via `POST /subscriptions { component_id, webhook_url }`. They MUST persist the `signing_secret` returned in the `201` body — Marketplace cannot recover it.

### 8.4 Smoke tests

After every deploy run the five release-validation calls listed in `README.md` §"Marketplace release validation":

1. `POST /ontology/families` with `{ family_name: "ReleaseSmoke" }`, then walk the chain (category → product) and `DELETE` it back out — verifies the catalog write/delete path end-to-end.
2. `POST /ontology/products/<product_id>/components` to create a sandbox component, then `PUT /ontology/products/<product_id>/components/<component_id>/bundles` with a known-good `bundle_url`, and poll `GET /reviews/<review_id>` until `SUCCEEDED`.
3. `POST /subscriptions { component_id, webhook_url: <test-receiver> }` for the sandbox component. Persist the returned `signing_secret`.
4. Confirm the test receiver got the `component.bundle.published` webhook with a verifiable `X-Marketplace-Signature` and the documented payload (§3.6). Then `POST /subscriptions/<subscription_id>/notifications/replay` and confirm the second delivery has the same `event_id`.
5. `DELETE /subscriptions/<subscription_id>` then `DELETE /ontology/products/<product_id>/components/<component_id>` (after deleting the sandbox bundles) — verifies the cleanup path.

### 8.5 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps storage (DynamoDB, S3, Secrets Manager) in place.
2. Re-run the smoke tests above.
3. Confirm no SFN executions are stuck `RUNNING` past 2 h (publication budget) or per-bundle fan-out budgets — `aws stepfunctions list-executions ... --status-filter RUNNING`.

For a single-bundle rollback inside the production marketplace: `POST /ontology/products/{product_id}/components/{component_id}/rollback`. It requires at least 2 prior bundles, runs the publication pipeline with `skip_review=true` and `ignore_validate=true`, and deletes the two prior bundles on success. The new bundle, once `Valid`, fans out as a normal `component.bundle.published` notification — subscribers must be prepared to handle a notification carrying a `bundle_id` that lexicographically sorts **after** an older one with semantically older content.

### 8.6 Common runbook items

- **Subscription auto-paused**: `GET /subscriptions/{subscription_id}` shows `status: "PAUSED"` with `auto_paused_reason: "auto_paused_after_exhausted"`. Inspect `GET /subscriptions/{subscription_id}/notifications` to see the failing response; once the receiver is fixed, `PATCH /subscriptions/{subscription_id} { status: "ACTIVE" }` and `POST /subscriptions/{subscription_id}/notifications/replay` to redeliver the latest event.
- **Receiver claims they did not receive a notification**: `GET /subscriptions/{subscription_id}/notifications/{notification_id}` returns the per-attempt log including HTTP status and response excerpts. Replay if `EXHAUSTED`.
- **Bundle in `UPLOADING_IN_PROGRESS` for >2 h**: the publication SFN is timing out on the deploy-status loop. `GET /reviews/<bundle_id>` returns `RUNNING`; `aws stepfunctions describe-execution` on `PutProductBundle` shows the failing task. Manually transition to `FAILED` by `DELETE /ontology/products/<product_id>/components/<component_id>/bundles/<bundle_id>`.
- **`Component(\`<id>\`) under Product(\`<product_id>\`) was not found.`**: confirm via `GET /ontology/products/{product_id}/components/{component_id}` whether the path's `(product_id, component_id)` pair really exists.
- **`DependencyCycleError`**: read `error.reason` (`Cycle: A -> B -> A`) and break the cycle by removing the offending edge from one of the bundles.
- **`secondary_review_environment_status: CleaningInProgress`** in `GET /settings/status`: the nightly self-clean is mid-flight; reviewers must wait for env-admin's `start-clean` to settle before pushing the next DATA bundle.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,tracer,event-handler}`, `@aws-sdk/{client-dynamodb,client-s3,client-sfn,client-ssm,client-kms,client-secrets-manager,client-apigateway,credential-providers}`, `aws-sdk-client-mock` (test only), `ulid`, `zod` (or `@sinclair/typebox`), `cfnresponse`-equivalent custom-resource shim. CDK: `aws-cdk-lib`, `constructs`, `aws-cdk`. Choose any preferred validation library and structured-error / DI conventions — the contracts in §3 and §6 must be honoured but the implementation style is unconstrained.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `subscription`, `notification`, `bundle`, `component`, `ontology`, `instance-settings`, `error`. Errors are tagged classes; everything else is type+validator pairs.
4. **Utils**: `lambda/utils/{trace,ulid,kms,s3-presign,dependency-resolver,assessment-hash,lexicon-version,hmac}.ts`.
5. **Configuration**: `lambda/config/instance.ts` (per-instance SSM-backed entries with TTL caching) plus per-service config readers tied to the env vars listed in §2.4. Required vars must throw at startup; optional vars must default per §2.4.
6. **Services** (one file each in `lambda/services/`): Components (`Repository`, `Linker`, `OntologyValidator`); Bundles (`Repository`, `Publisher`, `Sanitizer`, `Rollback`); Subscriptions (`Repository`, `SecretsBroker`, `LivenessProber`, `OwnershipGuard`); Notifications (`Repository`, `PayloadBuilder`, `WebhookSigner`, `Sender`, `RetryClassifier`, `AutoPause`, `Replay`); Catalog (`FamiliesRepo`, `CategoriesRepo`, `ProductsRepo`, `ApisRepo`, `PricesRepo`, `ConfigurationsRepo`, `MetadataRepo`, `Snapshot`); Instance (`SettingsRepo`, `Status`, `SchemaProjector`); Health (`MetricsEmitter`); Wrapped HTTP clients (`ReviewEnv`, `EnvAdmin`, `Site`, `Persistence`, `WorkDashboard`, `Ontology`); plus a composition module `services/index.ts` that exports per-router and per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts, responses.ts, decorators.ts}`, `lambda/logging/{powertools.ts, runtime.ts}`, the seven routers (`catalog`, `bundles`, `subscriptions`, `notifications`, `instance`, `analytics`, `info`) and `router.ts` mounting them with `prefix="/marketplace"`, then `handler.ts`.
8. **Worker handlers** in `lambda/{put-bundle-to-s3, check-comply, deploy-to-sandbox, check-deploy-status, get-failed-deploy-logs, update-bundle-status, build-notification-payload, sign-and-send-notification, record-notification-outcome, maybe-auto-pause, publish-to-site, update-quicksight-dataset, clean-self-cleaning-environment, configure-marketplace, check-marketplace-instance, retrieve-marketplace-settings-schema, verify-subscription-webhook-url, rotate-subscription-secret, replay-last-notification}/`.
9. **Custom resources**: `lambda/custom-resources/{api-usage-plan-stage-attachment,api-gateway-log,managed-ontology-v2}.ts` plus the `cfnresponse`-equivalent helper.
10. **OpenAPI generator**: `lambda/api/definitions.ts` and `scripts/generate-openapi.ts`. `pnpm api:spec` writes `requirements/swagger.yml` (the generated spec is checked in).
11. **CDK stacks**: `lib/data-stack.ts`, `lib/workflow-stack.ts`, and `lib/marketplace-stack.ts` per §2.1–§2.3, then `bin/app.ts`.
12. **Local webhook sink**: `scripts/start-webhook-sink.sh`, `scripts/webhook-sink/Dockerfile` (a tiny Node receiver that records every POST body + headers and exposes a `/seen?event_id=...` query endpoint), `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared workflows.
13. **Smoke tests**: replicate the five release-validation steps from §8.4 in the integration suite under `test/integration`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- The catalog (§3.4 / §4.3) is the **only** product ontology surface — no `/products`, `/data`, `/product-or-data/...`, or other parallel registry exists. Components are created exclusively via `POST /ontology/products/{product_id}/components` and reachable only via `/ontology/products/{product_id}/components/...` paths.
- Subscriptions and listeners are unified into a single concept: a `(component_id, webhook_url)` binding with a per-subscription `signing_secret`. There is no separate `/listeners/...` API, no `(api_key, domain_name)` env-admin handshake, no per-subscriber deploy state machine, and no inbound deployer callback route.
- `PUT /ontology/products/{product_id}/components/{component_id}/bundles` is **transactional** at the schema level: every validation gate in §4.1.1 runs **before** the bundle row is persisted; any failure leaves zero rows in `ComponentsTable`. The SFN-driven publication is asynchronous from the caller's perspective but `bundle_status` is monotonic (`UPLOADING_IN_PROGRESS → Valid|Failed`).
- Once a bundle reaches `Valid`, `PutProductBundle` triggers `NotifyComponentSubscribers` synchronously, which fans out exactly **one** `component.bundle.published` notification per `ACTIVE` subscription bound to the component. Each fan-out preserves a stable `event_id` across retries so receivers can dedupe.
- Outbound notifications carry an HMAC-SHA256 signature over the **raw** request body, computed with the per-subscription `signing_secret`, in the `X-Marketplace-Signature: v1=<hex>` header. Receivers MUST be able to verify with constant-time comparison; the test-double webhook sink in CI does so.
- Per-attempt retry policy: 408/429/5xx/network errors are retried up to `NOTIFICATION_RETRY_MAX_ATTEMPTS` (default 5) with exponential backoff `min(base * 2^(n-1), max)`. Other 4xx are terminal. After 3 consecutive `EXHAUSTED` notifications, the subscription auto-pauses with `auto_paused_reason: "auto_paused_after_exhausted"` and stops being a fan-out target until reactivated.
- `signing_secret` is shown to the client **only** at create-time and at `rotate-secret` time. DynamoDB persists only its SHA-256 digest; the raw value lives in Secrets Manager. Rotation keeps the prior secret valid for 60 s of overlap.
- `POST /subscriptions/{subscription_id}/notifications/replay` re-sends the **latest** notification with the **same** `event_id` (so receivers can choose to no-op); 409 if the subscription is `PAUSED`.
- Subscription-specific read/mutate/replay routes refuse `403 SubscriptionSecretMismatch` unless the caller proves knowledge of the current per-subscription `signing_secret` through `X-Marketplace-Subscription-Secret`; no subscription row stores an API Gateway key id.
- Component deletion (`DELETE /ontology/products/{product_id}/components/{component_id}`) refuses with 409 if any bundles or active subscriptions reference the component. Marketplace has no forced component-withdrawal route; operators must explicitly delete subscriptions and bundles before deleting the component.
- The daily ontology dump (`GET /ontology`) lazily back-fills the missing day's snapshot to S3 on first read.
- The self-cleaning review env scheduler (`cron(0 2 * * ? *)`) only fires when `SELF_CLEANING_REVIEW_API_KEY` is set; otherwise it returns early.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so any CommonJS dependency works at runtime.
- IAM permissions follow least-privilege per §2.3.3.
- All structured logs include the relevant `subscription_id` / `notification_id` / `bundle_id` / `component_id` / `product_id` so an operator can trace a single notification end-to-end via CloudWatch Logs Insights.
