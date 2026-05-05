# Marketplace Puller Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Marketplace Puller** product. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to the installer-supplied tenant AWS region, per the SOCAPITAL Golden Path engineering standards.

---

## 1. Product Overview

### 1.1 Mission

Marketplace Puller is the **tenant-side counterpart** to the Marketplace's push-based notification fabric. One Puller is installed inside **every tenant AWS sub-account** that the Account service has provisioned, immediately after Deployer during bootstrap. It owns three jobs:

1. **Webhook ingress.** Receive signed `component.bundle.published` webhooks from the central Marketplace, verify the HMAC signature, dedupe by `event_id`, persist Marketplace's dependency metadata, and enqueue a dependency-aware local deploy.
2. **Reconciliation polling.** On a schedule, list the latest released bundle for every component this tenant is subscribed to (against `GET <marketplace-host>/marketplace/ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1`) so the tenant catches up even when a webhook is lost or the Puller was offline. Root operator subscriptions also maintain managed Marketplace subscriptions for every transitive dependency in the latest `dependency_layers`, so dependency components receive their own webhooks when they publish new versions.
3. **Deployer handoff + drift reconciliation.** For every distinct `(component_id, bundle_id)` pair the Puller has accepted (whether via webhook or polling), call the **local** Deployer at `https://<this-tenant-subdomain>/infra-deployer/deploy-by-token` with the bundle's presigned `bundle_url`, persist the resulting `deploy_id`, and reconcile the terminal callback Deployer sends back. The currently-deployed `bundle_id` per component is stored on a tenant-local row so a follow-up reconciliation can detect drift (the row says `bundle_X`, the latest released bundle is `bundle_Y`) and self-heal.

The Marketplace **decides what is published** (catalog ownership lives in Marketplace per `Marketplace.md` §3.4); Account **decides who is a tenant** (identity, AWS sub-account, FQDN, service key — per `Account.md` §1.1); Deployer **decides how a bundle becomes infrastructure** (per `Deployer.md` §1.1); the Puller is the **glue** that keeps each tenant continuously up-to-date with the marketplace catalog without requiring the marketplace control plane to know how to deploy into the tenant.

The Puller is a **single-tenant, local-account-only** product. It runs in the same AWS sub-account as its Deployer and never assumes a role into another account; cross-tenant fan-out is exclusively the Marketplace's responsibility (the Marketplace dispatches one webhook per subscription, and one subscription is bound to one Puller's webhook URL).

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<tenant-subdomain>/marketplace-puller/`, with the capability groups below (full mapping in §3 and §4). The same API serves three audiences (the central Marketplace, the local tenant operator, and the local Deployer) with three distinct authentication models.


| Group                       | Routes                                                                                                                                                                                                                                             | Auth                                            | Purpose                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Marketplace webhook**     | `POST /webhooks/marketplace`                                                                                                                                                                                                                       | Hook-secret handshake or HMAC (`X-Marketplace-Signature`) | Echo Marketplace's subscription handshake, then receive `component.bundle.published` notifications. The single ingress for Marketplace-driven deploys.                                                                                      |
| **Subscription management** | `POST /subscriptions`, `GET /subscriptions`, `GET/PATCH/DELETE /subscriptions/{subscription_id}`, `POST /subscriptions/{subscription_id}/rotate-secret`, `POST /subscriptions/{subscription_id}/resync`                                            | Tenant `x-api-key`                              | CRUD over the Puller's local subscription registry. Each local row mirrors a Marketplace-side subscription; create/rotate-secret operations also call the Marketplace to set up the upstream subscription and persist the returned secret. |
| **Deploy lifecycle**        | `GET /components`, `GET /components/{component_id}`, `GET /components/{component_id}/deployments[/{deploy_run_id}]`, `POST /components/{component_id}/redeploy`, `POST /components/{component_id}/pause`, `POST /components/{component_id}/resume` | Tenant `x-api-key`                              | Inspect what is currently deployed in this tenant, the per-component deploy history, the latest released bundle the Puller is aware of, and trigger ad-hoc redeploy / pause / resume of the puller's auto-deploy on a single component.    |
| **Deployer callback**       | `POST /deployer-callbacks/{deploy_run_id}`                                                                                                                                                                                                         | One-time HMAC token (carried in `callback_url`) | Receive Deployer's terminal `{ status: "SUCCEEDED" | "FAILED", bundle_id }` callback. Closes the deploy run, persists the new live `bundle_id`, optionally reports the outcome back to Marketplace.                                        |
| **Reconciliation control**  | `POST /reconcile`, `GET /reconcile/runs[/{reconcile_run_id}]`                                                                                                                                                                                      | Tenant `x-api-key`                              | Force a reconciliation poll against Marketplace (per-component or whole-catalog), view the history of scheduled / on-demand reconciliation runs.                                                                                           |
| **Internal — service info** | `GET /information`                                                                                                                                                                                                                                 | None (API Gateway `MOCK`)                       | Static service metadata.                                                                                                                                                                                                                   |


Every mutating route except `POST /webhooks/marketplace` and `POST /deployer-callbacks/{deploy_run_id}` is API-key-gated against the **tenant's own** Usage Plan (the `service_api_key` minted by Account per `Account.md` §3.2 and bound to API Gateway by `ApiUsagePlanCustom` exactly the way Marketplace and Deployer do it). `POST /webhooks/marketplace` is API-key-free because Marketplace first proves reachability with an Asana-style `X-Marketplace-Hook-Secret` echo handshake, then authenticates event deliveries with the per-subscription HMAC signature (per `Marketplace.md` §3.6 — `X-Marketplace-Signature: v1=<hex>`). `POST /deployer-callbacks/{deploy_run_id}` is API-key-free because the Deployer cannot be expected to carry the tenant's own `x-api-key` — instead the callback URL itself contains a one-time HMAC token the Puller minted when it called the Deployer.

Successful POSTs return `200`/`201`/`202`/`204` per route. The webhook handler returns `204` for a valid subscription handshake and returns `200` as soon as a real notification row is persisted (`enqueued_for_deploy`) so the Marketplace's per-attempt retry budget (`NOTIFICATION_TIMEOUT_MS` = 15 s per `Marketplace.md` §2.4) is honoured — the actual Deployer call happens out-of-band on the SFN.

### 1.3 Non-goals

- The Puller does **not** itself execute CloudFormation. Every deploy goes through the local Deployer (`Deployer.md` §1.1). There is no second CFN engine, no CodeBuild project, no `cdk synth` in this service.
- The Puller does **not** validate, sanitise, or re-host bundle artifacts. It accepts the presigned `bundle_url` Marketplace minted (TTL = `NOTIFICATION_PRESIGN_TTL_SECONDS`, default 1 h per `Marketplace.md` §2.4) and hands it verbatim to the Deployer's `artifacts_url` field. If the URL has expired by the time the Deployer downloads, the Deployer reports `FAILED` and the Puller's reconciliation loop fetches a fresh URL on the next pull (see §5.2).
- The Puller does **not** run cross-tenant. It is installed once per tenant AWS sub-account by the bootstrap CLI defined in `Bootstrap.md` after Deployer is live (`Account bootstrap manifest -> local Deployer install -> Deployer deploys Puller`), and its REST API serves only this tenant's operators plus the central Marketplace's outbound webhooks.
- The Puller does **not** mint the marketplace catalog. Components, bundles, ontology, and reviews live in the central Marketplace (`Marketplace.md` §3.4). Subscription writes from `POST /subscriptions` flow through to the Marketplace's `POST /subscriptions` endpoint; the Puller persists a local mirror row and the returned `signing_secret`.
- The Puller does **not** act as a partner-credential vault, a config registry, or a customer identity store. Those are Connect / Account / future services.
- The Puller does **not** synthesise its own subdomain or ACM certificates. The `Subdomain` / `MarketplaceHost` / `TenantApiKey` / `TenantAwsAccountId` parameters are provided by the bootstrap CLI through the local Deployer at install time.
- The Puller does **not** open inbound SSH, run a build container, decode bundle internals, or execute caller-supplied JavaScript. There is no in-process workflow engine, no `vm2`, no `node-ssh`.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every long-running pipeline (webhook-driven deploy, reconciliation poll, subscription rotation, drift heal) compiles to a STANDARD AWS Step Functions state machine. Branching (`Choice`), looping (`Map`), parallelism (`Parallel`), retries (`Retry`), error catches (`Catch`), waits (`Wait`), and human-in-the-loop pauses (`waitForTaskToken`, used only for the Deployer hand-off — see §5.1) are expressed exclusively as ASL primitives. There is no in-Lambda step orchestrator and no second workflow runtime.
2. **Webhook ingress is handshake-aware, signature-verified, idempotent, and fire-and-forget.** The webhook handler first short-circuits Marketplace's `X-Marketplace-Hook-Secret` subscription handshake by echoing the header with no side effects. Real notification deliveries run the HMAC-SHA256 verification described in `Marketplace.md` §3.6 / §7.5 against the **raw** request body, dedupe by `event_id` (= `notification_id`), persist the row, and return `200` within the per-attempt budget. The actual dependency walk and Deployer calls happen out-of-band on `DeployFromBundle` SFN; the webhook handler must not block on dependency state or Deployer reachability.
3. **The Marketplace is the authoritative source of truth for `(component_id → latest released bundle_id)`.** Webhooks are the fast path; the reconciliation poll is the slow / catch-up path. When the two disagree the Marketplace's `GET .../bundles?sort=desc&limit=1` wins, because it reads the Marketplace's own DDB row, while a webhook may be replayed, lost, or out of order. Reconciliation overrides — it never **silences** — webhook-driven decisions.
4. **The Deployer is the only path to CloudFormation.** The Puller invokes `POST <local-deployer-host>/infra-deployer/deploy-by-token` (per `Deployer.md` §4.1) with the bundle's presigned `bundle_url`, the Marketplace-supplied `bundle_id`, and a signed one-shot `callback_url` that points back at this Puller. There is no direct `cloudformation:CreateStack` from anywhere in this codebase.
5. **Marketplace dependency layers are both an install-order and subscription contract.** For auto-deploy, the Puller MUST process `bundle.dependency_layers` in array order before invoking Deployer for the notified bundle. Components within the same layer may deploy in parallel; the next layer and target bundle wait until every dependency run in the prior layer is `DEPLOYER_SUCCEEDED`. The same dependency closure is also used to idempotently maintain tenant-local Marketplace subscriptions for each dependency component, so a dependency's future bundle publications are not stranded until a parent component publishes again.
6. **Local-account only.** Every AWS API call uses the Puller's own IAM role, in the same AWS sub-account as its Deployer. There is no `STS:AssumeRole`, no cross-account session factory, no Fernet decrypt. Cross-tenant Puller-to-Puller communication is impossible by construction.
7. **Tagged AWS-native integrations beat custom code.** Where Step Functions has a first-class service integration (`aws-sdk:dynamodb:GetItem`, `aws-sdk:secretsmanager:GetSecretValue`, EventBridge Pipes, native HTTP Tasks via EventBridge Connections), the workflow uses it. Custom Lambdas exist only for business logic that cannot be expressed natively (HMAC-signed Marketplace request, payload reshaping, etc.).

### 2.1 Stacks (AWS CDK)

The CDK app is composed of two stacks deployed in order:

```
bin/app.ts
├── DataStack         # KMS CMK, DynamoDB tables (subscriptions, components live state,
│                     # deploy runs, reconcile runs, dedupe ledger), DLQ for the webhook
│                     # ingress, EventBridge Connection for outbound Marketplace calls
└── PullerStack       # All Lambdas, REST API + custom domain, four Step Functions state
                      # machines (DeployFromBundle, ReconcileCatalog, DeployerWatchdog, SubscriptionLifecycle),
                      # EventBridge Scheduler entries (catalog reconcile + drift sweep + deployer watchdog),
                      # API Gateway custom resources, /information mock
```

`PullerStack.addDependency(dataStack)` ensures storage deploys first. Both stacks are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per `cloud-aws-primary`).

### 2.2 DataStack contents

#### 2.2.1 KMS

- `**DataKey`** — symmetric customer-managed key (alias `marketplace_puller_encryption_key`) used to encrypt every DynamoDB table and the per-subscription `signing_secret` material in Secrets Manager. Key policy grants the account root `kms:*` and the runtime Lambda role `kms:Encrypt|Decrypt|ReEncrypt*|GenerateDataKey*|DescribeKey` on `*`, plus `kms:CreateGrant|ListGrants|RevokeGrant` constrained by `kms:GrantIsForAWSResource=true`.

#### 2.2.2 Storage

The Puller does not own any S3 buckets — bundle artifacts are hosted by the Marketplace (`Marketplace.md` §2.2.2 — `BundlesBucket`) and downloaded directly by the Deployer at deploy time. The Puller only ever holds metadata.

#### 2.2.3 DynamoDB

All five tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled. `DedupeLedgerTable` enables TTL on `ttl` for transient idempotency rows; `DeployRunsTable` and `ReconcileRunsTable` enable TTL on `ttl` for old run history.


| Table                 | Keys                | Indexes                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubscriptionsTable`  | `pk` (S) / `sk` (S) | `gsi1: gsi1pk` (subscription-by-component), `gsi2: gsi2pk/gsi2sk` (managed dependencies) | One row per component this Puller is subscribed to. `pk = SUB#<subscription_id>`, `sk = _`, plus `gsi1pk = COMPONENT#<component_id>` so a webhook can resolve `(component_id, marketplace_signature) → signing_secret_arn` in O(1). Dependency-managed rows set `gsi2pk = MANAGED_DEPENDENCY`, `gsi2sk = <component_id>` so root-subscription delete/update paths can remove stale dependency references without scanning all tenant subscriptions. Item shape mirrors §6.1.                                                                                                             |
| `ComponentStateTable` | `pk` (S) / `sk` (S) | `gsi1: gsi1pk/gsi1sk` (by `auto_deploy_status`)       | One row per **component** the Puller knows about. `pk = COMPONENT#<component_id>`, `sk = _`. Carries `last_released_bundle_id` (latest the Puller has seen from Marketplace, regardless of whether it has been deployed locally), `live_bundle_id` (the most recently `SUCCEEDED` Deployer-side bundle), `pending_bundle_id` (currently in flight), `auto_deploy_status` (`AUTO                                                                                                                          |
| `DeployRunsTable`     | `pk` (S) / `sk` (S) | `gsi1: gsi1pk/gsi1sk` (by component + creation order) | One row per **deploy run** the Puller has triggered. `pk = COMPONENT#<component_id>`, `sk = RUN#<deploy_run_id>`. `gsi1pk = STATUS#<status>` so dashboards can list every `IN_PROGRESS` run cheaply. Carries `bundle_id`, `notification_id?` (set when triggered by webhook), `reconcile_run_id?` (set when triggered by polling), `deployer_bundle_id`, `deployer_deploy_id`, `status`, `attempt_count`, `last_error?`, `callback_token_sha256`, `started_at`, `finished_at?`. Item shape mirrors §6.3. |
| `ReconcileRunsTable`  | `pk` (S) / `sk` (S) | —                                                     | One row per reconciliation pass. `pk = RECONCILE#<reconcile_run_id>`, `sk = `_. Carries `trigger` (`schedule                                                                                                                                                                                                                                                                                                                                                                                             |
| `DedupeLedgerTable`   | `pk` (S)            | —                                                     | Idempotency ledger keyed by `pk = NOTIF#<notification_id>` (Marketplace's `event_id` from `Marketplace.md` §3.6). Holds `received_at`, `result` (`accepted                                                                                                                                                                                                                                                                                                                                               |


#### 2.2.4 EventBridge Connection

A single **EventBridge Connection** (`MarketplaceApiKeyConnection`) holds the **Marketplace tenant API key** (the `x-api-key` Account minted for this tenant against the central Marketplace's Usage Plan) so Step Functions HTTP Tasks can call the Marketplace REST API natively (`Marketplace.md` §1.2). Account is the source of truth for the current valid service key: its service-key rotation workflow updates the Account-managed tenant SSM parameter (`/marketplace-puller/<stage>/marketplace-api-key`) and calls EventBridge `UpdateConnection` on this connection before revoking the old key. The Puller reads/uses those Account-managed locations but does not mint, rotate, or overwrite the key itself.

The connection allows Step Functions to call:

- `GET <MarketplaceHost>/marketplace/ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1` (reconciliation poll, per `Marketplace.md` §4.1).
- `POST <MarketplaceHost>/marketplace/subscriptions` and `PATCH/DELETE/POST .../rotate-secret` (subscription lifecycle, per `Marketplace.md` §4.2).
- `GET <MarketplaceHost>/marketplace/subscriptions/{subscription_id}/notifications` (audit, per `Marketplace.md` §4.2).

### 2.3 PullerStack contents

#### 2.3.1 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so any CommonJS dependency can satisfy dynamic built-in `require`s. Logging format is JSON with three-month CloudWatch log-group retention. Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with `POWERTOOLS_SERVICE_NAME=marketplace-puller-`*, `POWERTOOLS_LOG_LEVEL=INFO`, `POWERTOOLS_METRICS_NAMESPACE=marketplace-puller`.

There are five cohorts; the full per-route handler matrix lives in §4.


| Cohort                                                                 | Examples                                                                                                                                                                                                                                                                                                                                                                                             | Memory     | Timeout  | Trigger                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------ |
| **Public API router**                                                  | `PullerHandler` (one per logical group: `webhook`, `subscriptions`, `components`, `reconcile`, `callback`, `info`)                                                                                                                                                                                                                                                                                   | 256–512 MB | 28–30 s  | API Gateway REST API                                   |
| **Deploy pipeline workers** (driven by `DeployFromBundle`)             | `EnsureDependencySubscriptions` (idempotently mirrors dependency components as managed Marketplace subscriptions), `PlanDependencyLayers` (normalises Marketplace `dependency_layers`), `FetchDependencyBundle` (refreshes dependency bundle URLs), `StartDependencyDeploy`, `StartDependencyExecutionAndWait`, `PollExistingDependencyRun` (layer-ordered prerequisite deploys), `BuildDeployerRequest` (computes the per-tenant `artifacts_url`, mints the one-shot callback token, renders `custom_parameters`), `InvokeDeployer` (`POST /infra-deployer/deploy-by-token` with `WAIT_FOR_TASK_TOKEN` semantics — see §5.1), `RecordDeployOutcome` (handles the Deployer callback, watchdog close-out, or a Step Functions failure), `MaybeReportToMarketplace` (optional outcome reflection) | 512 MB     | 60–120 s | Step Functions task                                    |
| **Reconciliation workers** (driven by `ReconcileCatalog`)              | `LoadActiveSubscriptions`, `FetchLatestBundle` (calls Marketplace `GET .../bundles?sort=desc&limit=1` via the EventBridge Connection HTTP Task), `EvaluateDrift` (compares `last_released_bundle_id` / `live_bundle_id`), `EnqueueDriftDeploy` (kicks off `DeployFromBundle` per drifted component)                                                                                                  | 512 MB     | 60–300 s | Step Functions Distributed Map child workflow          |
| **Deployer watchdog workers** (driven by `DeployerWatchdog`)           | `LoadStaleDeployRuns`, `FetchDeployerStatus`, `CloseRunFromDeployerStatus`, `EmitWatchdogSummary`                                                                                                                                                                                                                                                                                                     | 512 MB     | 60–300 s | Step Functions Map child workflow                      |
| **Subscription lifecycle workers** (driven by `SubscriptionLifecycle`) | `CreateMarketplaceSubscription`, `EnsureDependencySubscriptions`, `UpdateMarketplaceSubscription`, `PruneDependencySubscriptions`, `DeleteMarketplaceSubscription`, `RotateSubscriptionSecret`, `PersistSubscriptionRow`, `StoreSigningSecret`                                                                                                                                                                                                                        | 256 MB     | 60 s     | Step Functions task                                    |
| **Operational helpers**                                                | `ScheduleDriftSweep` (cron @ `*/15` minutes — see §5.2), `ScheduleCatalogReconcile` (cron @ hourly), `ScheduleDeployerWatchdog` (cron @ hourly), `ApiUsagePlanCustom`, `ApiGatewayLogCustom`                                                                                                                                                                                                             | 256 MB     | 28–60 s  | EventBridge Scheduler / CloudFormation custom resource |


The state machines created by the deploy and reconciliation flows share a constrained `WorkflowRuntimeRole` whose policies are: `lambda:InvokeFunction` on the worker ARNs they reference, `dynamodb:GetItem|PutItem|UpdateItem|Query|TransactWriteItems` on the five tables, `kms:Decrypt|Encrypt|GenerateDataKey` on `DataKey`, `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<region>:<account>:secret:marketplace-puller/subscription/`* and on the EventBridge Connection's secret, `events:InvokeApiDestination` on the Marketplace API destinations, `states:StartExecution|DescribeExecution|StopExecution` on `DeployFromBundle` for newly-created dependency runs, and `states:SendTaskSuccess|SendTaskFailure` on the per-deploy-run task tokens.

#### 2.3.2 Routing fabric

- **REST API** (`RestApi` `MarketplacePullerApi`) with default stage `${stage}`, regional endpoint type, CORS pre-flight for `*`, dedicated access log group, and `DisableExecuteApiEndpoint: true` (the API is reachable only via the deployer-supplied custom domain — the same `<tenant-subdomain>` that fronts every other Staircase product in this account). Routes:
  - `POST /webhooks/marketplace` → `LambdaIntegration(WebhookHandler)` with `apiKeyRequired: false`. Handshake requests echo `X-Marketplace-Hook-Secret`; event deliveries authenticate with HMAC (`X-Marketplace-Signature` per `Marketplace.md` §3.6).
  - `POST /deployer-callbacks/{deploy_run_id}` → `LambdaIntegration(DeployerCallbackHandler)` with `apiKeyRequired: false`. Authentication is the one-shot HMAC token embedded in the `callback_url` (see §3.5).
  - All other public paths in §1.2 → `LambdaIntegration(<group handler>)` with `apiKeyRequired: true`.
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON.
  - `GatewayResponse` rules normalise `INVALID_API_KEY`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, and `DEFAULT_4XX` per §3.7 (mirrors Marketplace, Deployer, Account).
- **API Gateway custom domain mapping** under base path `marketplace-puller` against the deployer-supplied `Subdomain` (`AWS::ApiGatewayV2::ApiMapping`).
- **Dynamic Custom Resources**:
  - `ApiGatewayLogCustom` — installs the per-stage access log group with `loglevel=ERROR`.
  - `ApiUsagePlanCustom` — binds the deployer-supplied `TenantApiKeyID` (the tenant `service_api_key` minted by Account per `Account.md` §3.2) to a usage plan named after the `Subdomain` and attaches the API stage. Idempotent on `ConflictException`.
- **EventBridge Scheduler** group `marketplace-puller-schedules` hosts three schedules:
  - `catalog-reconcile-hourly` (`rate(1 hour)`) targets `ReconcileCatalog` SFN with `{ trigger: "schedule" }`.
  - `drift-sweep-quarter-hour` (`rate(15 minutes)`) targets a thin `ScheduleDriftSweep` Lambda that lists every `ComponentStateTable` row where `last_released_bundle_id != live_bundle_id ∧ auto_deploy_status = AUTO` and starts `DeployFromBundle` per drifted component (see §5.2).
  - `deployer-watchdog-hourly` (`rate(1 hour)`) targets `DeployerWatchdog` SFN with `{ trigger: "schedule" }` so stale `DEPLOYER_RUNNING` rows are reconciled against Deployer status instead of being timed out locally.

There is **no inbound Marketplace control-plane integration beyond the webhook** — the Puller is push-receiver-only on the notification axis and pull-only on the catalog axis.

#### 2.3.3 IAM (high-level)

- The provider role is **never** wildcarded. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- `WebhookHandler` holds: `dynamodb:GetItem|PutItem|UpdateItem|TransactWriteItems` on `SubscriptionsTable` + `DedupeLedgerTable` + `ComponentStateTable` + `DeployRunsTable`, `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<region>:<account>:secret:marketplace-puller/subscription/`*, `kms:Decrypt` on `DataKey`, `states:StartExecution` on `DeployFromBundle` ARN.
- `DeployerCallbackHandler` holds: `dynamodb:GetItem|UpdateItem` on `DeployRunsTable` + `ComponentStateTable`, `states:SendTaskSuccess|SendTaskFailure` on `*` (Step Functions does not support resource-level constraints here), `kms:Decrypt` on `DataKey` (for verifying the callback token).
- `InvokeDeployer` holds: `dynamodb:UpdateItem` on `DeployRunsTable`, `kms:Encrypt|GenerateDataKey` on `DataKey` (for minting the callback token), and **no** Deployer-side IAM grant is required because the call is plain HTTPS to the local Deployer's API Gateway with the tenant `x-api-key` from the EventBridge Connection's secret.
- `DeployerWatchdog` workers hold: `dynamodb:Query|GetItem|UpdateItem|TransactWriteItems` on `DeployRunsTable` + `ComponentStateTable`, `states:SendTaskSuccess|SendTaskFailure` on `*` for still-open `DeployFromBundle` executions, and Secrets Manager read access for the local Deployer API key.
- `ReconcileCatalog` workers hold: `dynamodb:Query|GetItem|UpdateItem|TransactWriteItems` on the four primary tables, `events:InvokeApiDestination` on the `MarketplaceApiKeyConnection` destinations, and `secretsmanager:GetSecretValue` on the connection's secret.
- The `WorkflowRuntimeRole` (assumed by every state machine task that needs cross-resource access) is the single source of cross-table writes plus `secretsmanager:GetSecretValue` on the per-subscription signing secrets.
- Custom-resource handlers hold `apigateway:`* scoped to the rest API ARN and the named usage-plan ARN respectively (no account-wide `apigateway:*`).

### 2.4 Configuration surface (env vars + SSM)

The runtime is configured exclusively via env vars (read once on cold start; missing required values must fail closed) plus a small SSM-Parameter-Store-backed set of operator-managed secrets and addresses. Notable keys:


| Key                                                                                                                    | Source                                                            | Used by                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SUBSCRIPTIONS_TABLE` / `COMPONENT_STATE_TABLE` / `DEPLOY_RUNS_TABLE` / `RECONCILE_RUNS_TABLE` / `DEDUPE_LEDGER_TABLE` | DataStack → PullerStack outputs                                   | Every router + worker                                                                       |
| `KMS_KEY_ARN`                                                                                                          | DataStack output                                                  | DDB SSE + callback-token signing                                                            |
| `LOCAL_DOMAIN_NAME`                                                                                                    | `Subdomain` parameter                                             | Callback URL composition, `issuer` claim in deploy requests                                 |
| `LOCAL_DEPLOYER_BASE_URL`                                                                                              | `https://<Subdomain>/infra-deployer` (derived from `Subdomain`)   | All Deployer outbound calls; mirrors `Deployer.md` §1.2 mounting path                       |
| `LOCAL_DEPLOYER_API_KEY_SSM_PARAM`                                                                                     | `/marketplace-puller/<stage>/local-deployer-api-key`              | Tenant `x-api-key` for the local Deployer (the tenant's own service key, minted by Account) |
| `MARKETPLACE_HOST`                                                                                                     | `MarketplaceHost` parameter (e.g. `marketplace.staircaseapi.com`) | EventBridge Connection target host                                                          |
| `MARKETPLACE_API_KEY_CONNECTION_ARN`                                                                                   | DataStack output                                                  | Step Functions HTTP Tasks                                                                   |
| `MARKETPLACE_API_KEY_SSM_PARAM`                                                                                        | `/marketplace-puller/<stage>/marketplace-api-key`                 | Bootstrap of the EventBridge Connection's secret + ad-hoc Lambda calls                      |
| `TENANT_AWS_ACCOUNT_ID`                                                                                                | `TenantAwsAccountId` parameter                                    | Health-metric correlation, callback URL signing context                                     |
| `TENANT_API_KEY_ID`                                                                                                    | `TenantApiKeyID` parameter                                        | `ApiUsagePlanCustom`                                                                        |
| `BUILD_HASH`                                                                                                           | Deployer-supplied parameter                                       | Health-metric emission                                                                      |
| `DEPLOY_FROM_BUNDLE_SFN_ARN`                                                                                           | PullerStack output                                                | Webhook handler, drift sweeper                                                              |
| `RECONCILE_CATALOG_SFN_ARN`                                                                                            | PullerStack output                                                | EventBridge Scheduler target, manual `POST /reconcile`                                      |
| `SUBSCRIPTION_LIFECYCLE_SFN_ARN`                                                                                       | PullerStack output                                                | `POST /subscriptions`, `PATCH/DELETE/POST .../rotate-secret`                                |
| `SUBSCRIPTION_SECRET_NAMESPACE`                                                                                        | static (`marketplace-puller/subscription/`)                       | Per-subscription secret naming convention                                                   |
| `CALLBACK_TOKEN_HMAC_SECRET_ARN`                                                                                       | Secrets Manager `marketplace-puller/callback-token-hmac`          | One-shot Deployer callback authentication (see §3.5)                                        |
| `CALLBACK_TOKEN_ACCEPTANCE_DAYS`                                                                                       | `30`                                                              | Maximum age for callback tokens; matches terminal DeployRun retention, not deployment duration |
| `WEBHOOK_CLOCK_SKEW_TOLERANCE_SECONDS`                                                                                 | `300` (default; 5 min)                                            | Reject `X-Marketplace-Signature-Time` skew larger than this                                 |
| `RECONCILE_CONCURRENCY`                                                                                                | `25` (default)                                                    | `ReconcileCatalog` Distributed Map `MaxConcurrency`                                         |
| `RECONCILE_PAGE_SIZE`                                                                                                  | `15` (default; matches `Marketplace.md` §4.1 cap)                 | Per-component bundle list size                                                              |
| `DEPLOYER_INVOCATION_TIMEOUT_SECONDS`                                                                                  | `45`                                                              | HTTP timeout for the synchronous `POST /deploy-by-token` call                               |
| `DEPENDENCY_WAIT_POLL_SECONDS`                                                                                         | `30`                                                              | Poll interval when a parent waits on an already-running dependency deploy                    |
| `DRIFT_SWEEP_BATCH_SIZE`                                                                                               | `50`                                                              | Max components reconciled per sweep                                                         |
| `DEPLOYER_WATCHDOG_STALE_AFTER_SECONDS`                                                                                | `14400` (4 h)                                                     | Age after which an in-flight deploy run is checked against Deployer status                  |
| `DEPLOYER_WATCHDOG_BATCH_SIZE`                                                                                         | `50`                                                              | Max stale in-flight deploy runs reconciled per watchdog pass                                |


SSM parameter values are loaded lazily (single-flight cache, refreshed on TTL — see `Marketplace.md` §7.3 for the same pattern) so a missing optional parameter never blocks unrelated routes.

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses use a uniform JSON envelope. Success bodies are route-specific. Error responses follow the same `{ error: { message, reason, _additional_documentation? } }` shape `Marketplace.md` §3.1 defines, so a single client SDK can talk to both Marketplace and Puller. Every response includes a `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` header and CORS headers; the caller's `X-Sc-Health-Transaction-Id` (or the request's AWS request ID if absent) is echoed back so a single transaction can be traced through Marketplace → Puller → Deployer.

### 3.2 Subscription (local mirror)

A **Subscription** in the Puller is the **local mirror** of a Marketplace `(component_id, webhook_url)` binding (`Marketplace.md` §3.5). Its on-the-wire shape on read is:

```jsonc
{
  "subscription_id": "sub_01H01965DB8QGSD9EZWF1VS7BC",   // the Marketplace-side subscription_id, persisted verbatim
  "component_id": "Connector",
  "product_id": "9e4…",                                   // denormalised from the Marketplace-side notification
  "webhook_url": "https://<tenant-subdomain>/marketplace-puller/webhooks/marketplace",
  "signing_secret_set": true,                             // boolean; the actual secret is in Secrets Manager
  "marketplace_status": "ACTIVE|PAUSED",                  // mirrored from the Marketplace's PATCH endpoint
  "auto_deploy_status": "AUTO|PAUSED",                    // local-only: when PAUSED, webhooks are accepted but no deploys are triggered
  "subscription_origin": "ROOT|DEPENDENCY|ROOT_AND_DEPENDENCY",
  "managed_by_root_subscription_ids?": ["sub_parent_…"],  // dependency rows only; reference-counts roots that still require this component
  "managed_by_root_component_ids?": ["Connector"],        // dependency rows only; operator-readable reverse references
  "paused_reason?": "auto_paused_after_deploy_failures",  // optional
  "description?": "…",
  "metadata?": { … },                                     // optional caller-defined key/value (≤4 KB)
  "created_at": "ISO8601 UTC",
  "updated_at": "ISO8601 UTC",
  "last_received_event_id?": "ntf_01H01…",
  "last_received_event_at?": "ISO8601 UTC",
  "last_deployed_bundle_id?": "01H01…",
  "last_deploy_run_id?": "run_01H01…",
  "last_deploy_status?": "SUCCEEDED|FAILED|IN_PROGRESS|null"
}
```

The body to create is `POST /subscriptions { component_id, product_id, description?, metadata?, auto_deploy_status?: "AUTO"|"PAUSED" }`. This creates or promotes a **root** subscription: the component the tenant explicitly wants to keep deployed. The Puller composes the canonical `webhook_url = https://<LOCAL_DOMAIN_NAME>/marketplace-puller/webhooks/marketplace`, calls Marketplace `POST /marketplace/subscriptions { component_id, webhook_url, description, metadata }` (per `Marketplace.md` §4.2) using the EventBridge Connection's tenant API key, echoes Marketplace's `X-Marketplace-Hook-Secret` handshake when the create call probes the webhook URL, persists the returned `signing_secret` in AWS Secrets Manager at `arn:aws:secretsmanager:<region>:<account>:secret:marketplace-puller/subscription/<subscription_id>` (KMS-encrypted with `DataKey`), and writes the local row with `subscription_origin = ROOT`. The response is `201` with the **subscription metadata only** (no `signing_secret`; the secret never leaves the Puller). This is intentional: the operator does not need the secret because every webhook is signed by Marketplace and verified by the Puller. The unauthenticated handshake path does **not** write the secret by itself; the `SubscriptionLifecycle` workflow persists the same secret from the authenticated Marketplace response so a random internet probe cannot create local trust state.

Lost secrets are rotated via `POST /subscriptions/{subscription_id}/rotate-secret`, which forwards to Marketplace's `POST /subscriptions/{subscription_id}/rotate-secret` (per `Marketplace.md` §4.2), atomically writes the new secret into Secrets Manager, and keeps the prior secret valid for 60 s of overlap by writing the new value to a new secret version (the verifier tries the latest version first, then the prior version once).

A subscription is **scoped to exactly one component** (mirroring `Marketplace.md` §3.5). To listen on N root components, create N root subscriptions. The Puller creates dependency subscriptions automatically from Marketplace's `dependency_layers`; those rows use the same webhook URL and are marked `subscription_origin = DEPENDENCY` unless an operator later promotes the same component to a root subscription, in which case the row becomes `ROOT_AND_DEPENDENCY`.

**Managed dependency subscriptions.** After a root subscription is created, and every time a webhook or reconciliation result carries a newer `dependency_layers` closure for that root, the Puller runs `EnsureDependencySubscriptions`:

1. Flatten `dependency_layers` to distinct `(component_id, product_id, type)` records and ignore the root component itself.
2. For each dependency, query `SubscriptionsTable.gsi1pk = COMPONENT#<component_id>`.
3. If a local row exists, add the root subscription/component IDs to `managed_by_root_subscription_ids` / `managed_by_root_component_ids` with a conditional update. If the row was `ROOT`, promote it to `ROOT_AND_DEPENDENCY`; keep the existing Marketplace subscription and signing secret.
4. If no local row exists, call Marketplace `POST /marketplace/subscriptions` with the same canonical `webhook_url`, persist the returned secret, and create a local row with `subscription_origin = DEPENDENCY`, `auto_deploy_status = AUTO`, and the root reference sets populated.

Deleting or pausing a root subscription does not immediately delete dependency rows that another root still references. On root deletion, `PruneDependencySubscriptions` removes that root reference from dependency rows; it deletes the Marketplace subscription and local secret only when `subscription_origin = DEPENDENCY` and the reference set becomes empty. A `ROOT_AND_DEPENDENCY` row is demoted back to `ROOT` when the last dependency reference is removed.

### 3.3 Component live state

A **ComponentState** row tracks what the Puller currently knows about one component:

```jsonc
{
  "component_id": "Connector",
  "product_id": "9e4…",
  "type": "SERVICE|DATA",
  "auto_deploy_status": "AUTO|PAUSED",                    // PAUSED means new bundles are recorded but not deployed
  "paused_reason?": "manual|auto_paused_after_deploy_failures",
  "paused_at?": "ISO8601 UTC",
  "consecutive_failed_deploys": 0,                        // resets on any SUCCEEDED deploy
  "last_released_bundle_id?": "01H01…",                    // the latest bundle Marketplace says exists for this component
  "last_released_bundle_seen_at?": "ISO8601 UTC",
  "last_released_bundle_source": "webhook|reconcile",
  "live_bundle_id?": "01GZ…",                              // the most recent bundle that succeeded in this account
  "live_bundle_deployed_at?": "ISO8601 UTC",
  "pending_bundle_id?": "01H01…",                          // currently in flight (set when DeployFromBundle starts)
  "pending_deploy_run_id?": "run_01H01…",
  "pending_started_at?": "ISO8601 UTC",
  "dependencies?": ["Persist", "Lexicon"],
  "deploy_time_dependencies?": ["Build"],
  "dependency_layers?": [[{ "component_id": "Build", "type": "SERVICE", "product_id": "…" }], …],
  "last_bundle_meta?": { … }                               // sanitised, mirrors the notification payload
}
```

`live_bundle_id` is the **only** field that drives drift detection (`live_bundle_id ≠ last_released_bundle_id ∧ auto_deploy_status == AUTO ∧ pending_bundle_id == null` ⇒ schedule a deploy). `pending_bundle_id` exists to deduplicate: if a webhook arrives while a prior deploy of the same `(component_id, bundle_id)` is in flight, the second webhook is recorded in `DedupeLedgerTable` and discarded. If a webhook arrives for a **newer** bundle while an older bundle is mid-deploy, the older deploy is **not** cancelled — instead the newer bundle is queued as a follow-on by setting `last_released_bundle_id` and letting the next reconcile / drift-sweep pick it up after the current run finishes.

**Auto-pause.** If three consecutive deploys fail for the same component, `auto_deploy_status` flips to `PAUSED` with `paused_reason: "auto_paused_after_deploy_failures"`. Webhooks are still accepted (and the dedupe ledger updated) but no `DeployFromBundle` SFN is started until an operator calls `POST /components/{component_id}/resume`.

### 3.4 Deploy run

A **DeployRun** is a single end-to-end deploy attempt for one `(component_id, bundle_id)` pair. Its lifecycle:

```
QUEUED  → INVOKING_DEPLOYER → DEPLOYER_RUNNING → DEPLOYER_SUCCEEDED          (happy path)
        → INVOKING_DEPLOYER → DEPLOYER_RUNNING → DEPLOYER_FAILED              (Deployer reported FAILED)
        → INVOKING_DEPLOYER → INVOKE_FAILED (transient) → … → ABORTED         (after invoke retry budget)
        → DEPLOYER_RUNNING  → CALLBACK_TIMEOUT                               (watchdog proves callback is missing after Deployer is no longer running)
```

On the wire (`GET /components/{component_id}/deployments`):

```jsonc
{
  "deploy_run_id": "run_01H01965DB8QGSD9EZWF1VS7BC",
  "component_id": "Connector",
  "product_id": "9e4…",
  "bundle_id": "01H01965DB8QGSD9EZWF1VS7BC",
  "trigger": "webhook|reconcile|drift_sweep|manual",
  "notification_id?": "ntf_01H01…",                      // when trigger = webhook
  "reconcile_run_id?": "rec_01H01…",                     // when trigger = reconcile|drift_sweep
  "deployer_bundle_id?": "01H01…",                       // returned by Deployer (matches bundle_id)
  "deployer_deploy_id?": "01H01…",                       // returned by Deployer (deploy_id field — see Deployer.md §1.2)
  "status": "QUEUED|INVOKING_DEPLOYER|DEPLOYER_RUNNING|DEPLOYER_SUCCEEDED|DEPLOYER_FAILED|INVOKE_FAILED|ABORTED|CALLBACK_TIMEOUT",
  "attempt_count": 1,
  "last_error?": "<class>: <message>",
  "started_at": "ISO8601 UTC",
  "finished_at?": "ISO8601 UTC",
  "duration_ms?": 312453
}
```

A failed deploy run does **not** automatically retry the same `bundle_id`. Operators redeploy via `POST /components/{component_id}/redeploy` (which mints a new `deploy_run_id` for the same `bundle_id`) or wait for the reconciliation loop to find a newer bundle.

### 3.5 Deployer callback authentication

When the Puller calls `POST /infra-deployer/deploy-by-token`, it generates a one-shot **callback token** that the Deployer will include when it POSTs the terminal callback back to the Puller. The token is opaque to the Deployer; the Puller derives the `callback_url` it sends as:

```
callback_url = https://<LOCAL_DOMAIN_NAME>/marketplace-puller/deployer-callbacks/<deploy_run_id>?token=<callback_token>
```

`callback_token` is constructed as:

```
ts          = unix_seconds(now())
payload     = `${deploy_run_id}.${ts}`
signature   = base64url(HMAC-SHA256(get_secret(CALLBACK_TOKEN_HMAC_SECRET_ARN), payload))
callback_token = `${ts}.${signature}`
```

`callback_token_sha256 = SHA-256(callback_token)` is persisted on the `DeployRunsTable` row at deploy-run creation time.

The receiving handler:

1. Re-derives the expected `signature` from `(deploy_run_id, ts)` and constant-time-compares with the supplied `signature`.
2. Computes `SHA-256(callback_token)` and verifies it matches the row's `callback_token_sha256` (defence in depth: Secrets Manager rotation does not silently accept old tokens).
3. Rejects with `401` if `now() - ts > CALLBACK_TOKEN_ACCEPTANCE_DAYS * 86400` (default 30 d, aligned with DeployRun retention). The callback token is not a deployment-duration SLA; it remains valid for the whole period in which the Puller can still close the run.
4. Rejects with `409 AlreadyClosed` if the deploy run is already in a terminal state.
5. Calls `states:SendTaskSuccess` with the Deployer's body so `DeployFromBundle` resumes; updates the `DeployRunsTable` row + `ComponentStateTable` row in one DDB transaction.

The Marketplace control plane never needs to know this token; only the Deployer (which received it in the original `POST` body) and the Puller (which minted it) ever see it.

### 3.6 Webhook payload

`POST /webhooks/marketplace` has two mutually exclusive modes:

1. **Subscription handshake.** If the request has `X-Marketplace-Hook-Intent: subscription.handshake` and `X-Marketplace-Hook-Secret: <secret>`, the handler returns `204 No Content` and echoes the identical `X-Marketplace-Hook-Secret` header. It does not parse a body, require `X-Marketplace-Event`, verify a signature, write DynamoDB, or start a deploy. This mirrors Asana's webhook-confirmation exchange and lets Marketplace prove that the exact target URL is reachable before it activates the subscription.
2. **Bundle notification.** Otherwise, the Puller accepts the **exact** `component.bundle.published` payload Marketplace defines in `Marketplace.md` §3.6.

The notable notification fields it consumes are:

- `event_id` — used as the idempotency key in `DedupeLedgerTable`.
- `event_time` and the `X-Marketplace-Signature-Time` header — checked against `WEBHOOK_CLOCK_SKEW_TOLERANCE_SECONDS`.
- `marketplace.subscription_id` — used to look up the local subscription row and the per-subscription `signing_secret`.
- `component.{component_id, product_id, type}` — used to fetch / upsert the `ComponentStateTable` row.
- `bundle.{bundle_id, bundle_url, bundle_url_expires_at, dependencies, deploy_time_dependencies, dependency_layers, lexicon_version_id, bundle_meta}` — the `bundle_url` is forwarded to the Deployer as `artifacts_url`; the rest is persisted on the `ComponentStateTable` row for inspection.
- `previous_bundle_id` — informational; persisted on the `DeployRunsTable` row.

The notification verifier:

1. Reads the **raw** request body bytes (API Gateway `proxy: true` exposes them via the base64-decoded body). Re-serialising the parsed JSON before HMAC verification breaks the signature; the route MUST hash the bytes verbatim.
2. Computes `HMAC-SHA256(signing_secret, raw_body)` and constant-time-compares with the `X-Marketplace-Signature: v1=<hex>` header. Falls back to the prior secret version (one read) if rotation is in progress.
3. On verification failure: writes a `signature_invalid` row to `DedupeLedgerTable`, returns `401`. Marketplace's `EXHAUSTED` policy (`Marketplace.md` §3.6) treats 401 as a **permanent** failure (it's a 4xx other than 408/429), which is intentional — a misrouted or tampered notification must not loop.

### 3.7 Error catalogue → HTTP status


| HTTP | Tag(s)                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `BadRequest`, `InvalidPaginationToken`, `InvalidQueryParams`, `InvalidPathParams`, `InvalidBody`                                           |
| 401  | `WebhookSignatureInvalid`, `CallbackTokenInvalid`, `CallbackTokenExpired`, `IncorrectAuthorization`                                        |
| 403  | `SubscriptionNotOwnedHere` (the local subscription row is missing — the webhook was routed to the wrong tenant Puller)                     |
| 404  | `SubscriptionNotFound`, `ComponentNotFound`, `DeployRunNotFound`, `ReconcileRunNotFound`                                                   |
| 409  | `SubscriptionAlreadyExists`, `DeployRunAlreadyClosed`, `ComponentAutoDeployPaused`, `ComponentAlreadyResumed`, `DependencyCycleDetected`    |
| 422  | `InvalidWebhookPayload`, `MarketplaceSubscriptionConflict`, `LocalDeployerUnreachable`, `BundleUrlExpired`, `IncompatibleLexiconVersionId` |
| 429  | `MarketplaceUpstreamThrottled`, `DeployerUpstreamThrottled`                                                                                |
| 500  | `InternalServerError`                                                                                                                      |
| 504  | `MarketplaceUpstreamTimeout`, `DeployerUpstreamTimeout`                                                                                    |


Webhook handler responses are constrained by `Marketplace.md` §3.6 receiver semantics: `200` for `accepted` or `duplicate`, `401` for signature failure, `409` for known-stale events (e.g. the bundle is older than `live_bundle_id`), `422` only when the payload itself is malformed (caller mistake; Marketplace will not retry).

---

## 4. Synchronous APIs

### 4.1 Webhook ingress


| Verb   | Path                    | Auth                                              | Behaviour                                                                                                        |
| ------ | ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POST` | `/webhooks/marketplace` | `X-Marketplace-Hook-Secret` echo or HMAC signature | Echo Marketplace's subscription handshake or receive a `component.bundle.published` notification. See §4.1.1. |


#### 4.1.1 `POST /webhooks/marketplace` pipeline

The router runs the gates **before** any side effect:

1. **Handshake short-circuit.** If `X-Marketplace-Hook-Intent: subscription.handshake` is present, require non-empty `X-Marketplace-Hook-Secret` and require all event-delivery headers (`X-Marketplace-Event`, `X-Marketplace-Signature`, `X-Marketplace-Subscription`) to be absent. Return `204` with the same `X-Marketplace-Hook-Secret`. Missing secret or mixed handshake/event headers → 400.
2. **Read raw body.** Capture the byte-exact request body for HMAC verification.
3. **Header sanity.** Require `X-Marketplace-Event: component.bundle.published`, `X-Marketplace-Subscription`, `X-Marketplace-Event-Id`, `X-Marketplace-Signature: v1=<hex>`, `X-Marketplace-Signature-Time: <unix_seconds>`. Missing → 400.
4. **Clock skew.** `|now() - X-Marketplace-Signature-Time| > WEBHOOK_CLOCK_SKEW_TOLERANCE_SECONDS` → 401 `WebhookSignatureInvalid` with `reason: "clock_skew"`. (The signature itself is body-only per `Marketplace.md` §7.5; the header skew is an additional defence.)
5. **Subscription resolution.** `gsi1pk = COMPONENT#<body.component.component_id>` → list local subscription rows; pick the one whose `subscription_id == X-Marketplace-Subscription`. Missing → 403 `SubscriptionNotOwnedHere` (the Marketplace fan-out targeted a Puller that no longer owns the subscription; idempotent — the Marketplace will eventually mark this subscription `EXHAUSTED` and auto-pause it).
6. **Signature verification.** Fetch the latest secret version from `marketplace-puller/subscription/<subscription_id>`; compute `hex(HMAC-SHA256(secret, raw_body))`; constant-time-compare with the header. On mismatch, fetch the prior version (rotation overlap, 60 s) and retry. On both failures → 401 `WebhookSignatureInvalid`; persist `signature_invalid` to the dedupe ledger.
7. **Idempotency.** `DedupeLedgerTable.PutItem({ pk: NOTIF#<event_id>, condition: attribute_not_exists(pk) })`. On `ConditionalCheckFailedException` → 200 with `{ status: "duplicate", event_id }` (Marketplace will dedupe; the response keeps the per-attempt budget happy).
8. **Subscription state gate.** If the local subscription's `auto_deploy_status === "PAUSED"`, persist `paused` to the dedupe ledger and return 200 with `{ status: "accepted_paused", event_id }` (the bundle is recorded but no deploy is started).
9. **Component state upsert.** Transactionally update `ComponentStateTable` to set `last_released_bundle_id = bundle.bundle_id`, `last_released_bundle_seen_at = now()`, `last_released_bundle_source = "webhook"`, `dependencies / deploy_time_dependencies / dependency_layers / last_bundle_meta` from the payload, **conditional on** `pending_bundle_id != bundle.bundle_id` (so a webhook arriving while the same bundle is mid-deploy is a no-op on this row but still captured in the dedupe ledger).
10. **Already-deployed check.** If `live_bundle_id == bundle.bundle_id ∧ pending_bundle_id == null`, return 200 with `{ status: "already_live", event_id, deploy_run_id: null }`. Skip the SFN start.
11. **Already-pending check.** If `pending_bundle_id == bundle.bundle_id`, return 200 with `{ status: "in_flight", event_id, deploy_run_id: <pending_deploy_run_id> }`. Skip the SFN start.
12. **DeployRun mint + SFN start.** Mint `deploy_run_id = "run_" + ulid()`, write the row at `status: "QUEUED"`, set `ComponentStateTable.pending_`* fields in the same `TransactWriteItems`, then `states:StartExecution` on `DeployFromBundle` with `name = deploy_run_id` and the input shape in §6.5.
13. Return `200 { status: "accepted", event_id, deploy_run_id }`.

Any unexpected error → write the failure to CloudWatch + emit a `failed` health metric, return `500`. Marketplace will retry per its own backoff.

### 4.2 Subscription management


| Verb     | Path                                             | Auth    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/subscriptions`                                 | API key | Subscribe this tenant to a root component. Body: `{ component_id, product_id, description?, metadata?, auto_deploy_status?: "AUTO"|"PAUSED" }`. The Puller composes `webhook_url = https://<LOCAL_DOMAIN_NAME>/marketplace-puller/webhooks/marketplace` and calls `SubscriptionLifecycle` SFN to (a) create or promote the local Marketplace subscription, (b) persist the returned `signing_secret` to Secrets Manager when a new Marketplace row is needed, (c) write the local mirror row with `subscription_origin = ROOT`, and (d) fetch the latest bundle, if any, to create managed dependency subscriptions from its `dependency_layers`. Returns `201 { subscription_id, status: "ACTIVE", auto_deploy_status }`. The `signing_secret` itself is **never** returned. |
| `GET`    | `/subscriptions`                                 | API key | Paginated list of local subscriptions. Optional `?component_id=<id>` and `?status=ACTIVE|PAUSED` filters; `?limit=<1..100>&next_token=<base64>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET`    | `/subscriptions/{subscription_id}`               | API key | Detail. 404 if missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PATCH`  | `/subscriptions/{subscription_id}`               | API key | Update `description`, `metadata`, `marketplace_status` (forwarded to Marketplace's `PATCH`), `auto_deploy_status` (local-only; a flip from `PAUSED` → `AUTO` triggers an immediate reconcile of the underlying component to catch up).                                                                                                                                                                                                                                                                                                                                                                    |
| `DELETE` | `/subscriptions/{subscription_id}`               | API key | Delete or demote the root subscription. The Marketplace-side `DELETE /subscriptions/{subscription_id}` (per `Marketplace.md` §4.2) is best-effort only when the row is no longer needed as `DEPENDENCY`; a 404 from Marketplace is treated as success. `PruneDependencySubscriptions` removes this root from every managed dependency row and deletes dependency Marketplace subscriptions whose reference sets become empty. The Secrets Manager secret is `secretsmanager:DeleteSecret`-ed with `RecoveryWindowInDays=7` whenever the corresponding Marketplace subscription is deleted. Returns `204`. |
| `POST`   | `/subscriptions/{subscription_id}/rotate-secret` | API key | Forward to Marketplace's rotate endpoint; persist the new secret as a new Secrets Manager version (the prior version remains valid for 60 s for in-flight webhooks); update the local row. Returns `200 { rotated_at }`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST`   | `/subscriptions/{subscription_id}/resync`        | API key | Force the Puller to re-fetch the latest bundle for this subscription's component from Marketplace and (if newer than `live_bundle_id`) start a deploy. Equivalent to `POST /reconcile { component_ids: [<component_id>] }` scoped to one component. Returns `202 { reconcile_run_id }`.                                                                                                                                                                                                                                                                                                                   |


### 4.3 Component / deploy lifecycle


| Verb   | Path                                                     | Auth    | Behaviour                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/components`                                            | API key | Paginated list of `ComponentStateTable` rows. Optional `?status=AUTO|PAUSED`, `?drifted=true` filters.                                                                                                                                           |
| `GET`  | `/components/{component_id}`                             | API key | Detail of one component (the §3.3 row).                                                                                                                                                                                                          |
| `GET`  | `/components/{component_id}/deployments`                 | API key | Paginated list of `DeployRunsTable` rows for this component. `?status=…&limit=<1..50>&next_token=<base64>`.                                                                                                                                      |
| `GET`  | `/components/{component_id}/deployments/{deploy_run_id}` | API key | Detail of one deploy run.                                                                                                                                                                                                                        |
| `POST` | `/components/{component_id}/redeploy`                    | API key | Body: `{ bundle_id?: <ulid>, custom_parameters?: Record<string,string> }`. If `bundle_id` is omitted, redeploys `last_released_bundle_id`. Returns `202 { deploy_run_id }`. 409 if the component is `PAUSED` (the operator must `resume` first). |
| `POST` | `/components/{component_id}/pause`                       | API key | Set `auto_deploy_status = "PAUSED"`, `paused_reason = "manual"`. New webhooks are still accepted (and dedupe-ledgered) but no deploys are started. Returns `200`.                                                                                |
| `POST` | `/components/{component_id}/resume`                      | API key | Set `auto_deploy_status = "AUTO"`, clear `paused_reason`. Triggers a one-shot reconcile so a paused-then-resumed component catches up to the latest released bundle. Returns `200`.                                                              |


### 4.4 Deployer callback


| Verb   | Path                                            | Auth                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/deployer-callbacks/{deploy_run_id}?token=<…>` | One-shot HMAC token (§3.5) | Verify `token`. Body is the Deployer's terminal payload `{ status: "SUCCEEDED" | "FAILED", bundle_id, deploy_id?, transaction_id?, reason?, failed_events? }` (per `Deployer.md` §5.4 / §8.1). On `SUCCEEDED`: transactionally set the run row to `DEPLOYER_SUCCEEDED`, set `ComponentStateTable.live_bundle_id = bundle_id`, clear `pending_`*, reset `consecutive_failed_deploys = 0`, `states:SendTaskSuccess` on the row's `task_token`. On `FAILED`: same, but `DEPLOYER_FAILED`, increment `consecutive_failed_deploys`, auto-pause if ≥3, `states:SendTaskFailure(error="DeployerFailed", cause=<JSON-stringified body>)`. Returns `200 { acknowledged: true }` (idempotent: a duplicate callback with the same `(deploy_run_id, status)` returns `200`; a contradictory one returns `409 DeployRunAlreadyClosed`). |


### 4.5 Reconciliation control


| Verb   | Path                                 | Auth    | Behaviour                                                                                                                                                                                        |
| ------ | ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/reconcile`                         | API key | Body: `{ component_ids?: string[], trigger?: "manual" }`. Starts `ReconcileCatalog` SFN with the supplied component scope (or all subscriptions if omitted). Returns `202 { reconcile_run_id }`. |
| `GET`  | `/reconcile/runs`                    | API key | Paginated history of reconcile runs.                                                                                                                                                             |
| `GET`  | `/reconcile/runs/{reconcile_run_id}` | API key | Detail of one reconcile run, including `components_drifted` and the `deploy_run_id`s it kicked off.                                                                                              |


### 4.6 Service info

`GET /information` — API Gateway `MOCK` integration. Returns the deployer-supplied `ServiceInfo` JSON with the standard CORS / HSTS headers. **No API key required.** Used by upstream services and operator diagnostics to confirm the Puller is reachable and to read its tenant identity (`Subdomain`, `BuildHash`). Marketplace subscription verification uses the webhook handshake on `POST /webhooks/marketplace`, not this route.

---

## 5. Asynchronous Pipelines

The Puller operates four STANDARD Step Functions state machines (all `tracingEnabled: true`). Concurrency caps are documented per-Map; every workflow uses tagged error classes (§3.7) so `Catch` can route correctly.

### 5.1 `DeployFromBundle` — webhook / reconcile / drift / manual deploy

```
LoadDeployRun (Lambda; reads DeployRunsTable + ComponentStateTable)
  → CheckPreconditions (Choice)
        ├── auto_deploy_status == PAUSED → Abort (DeployRunAborted)
        ├── live_bundle_id == bundle_id → ShortCircuitSucceed (rare; reconcile race) → SuccessState
        └── else → EnsureDependencySubscriptions
  → EnsureDependencySubscriptions (Lambda; idempotently creates/promotes dependency Marketplace subscriptions for this root's dependency_layers)
  → PlanDependencyLayers (Lambda; validates dependency_layers from Marketplace and removes layers already live)
  → HasDependencies? (Choice)
        ├── yes → DeployDependencyLayers (Map over layers, MaxConcurrency=1)
        │           Per layer: DeployDependencyLayer (Map over components in layer, MaxConcurrency=10)
        │             → FetchDependencyBundle (HTTP Task against Marketplace latest-bundle route)
        │             → StartDependencyDeploy (Lambda; creates or finds a child DeployRunsTable row)
        │             → DependencyRunAlreadyStarted? (Choice)
        │                   ├── false → StartDependencyExecutionAndWait (states:startExecution.sync:2 on DeployFromBundle with dependency_context)
        │                   └── true  → PollExistingDependencyRun (Wait → aws-sdk:dynamodb:GetItem → Choice loop)
        │             → AssertDependencySucceeded
        └── no  → BuildDeployerRequest
  → BuildDeployerRequest (Lambda; mints callback token (§3.5), composes the POST body)
  → InvokeDeployer (Lambda invoked with arn:aws:states:::lambda:invoke.waitForTaskToken)
        Worker steps:
          - Persist task_token + callback_token_sha256 in DeployRunsTable
          - HTTP POST <LOCAL_DEPLOYER_BASE_URL>/deploy-by-token
              x-api-key: <tenant_service_key>
              body: { artifacts_url, bundle_id, callback_url, custom_parameters?, multi_region_deployment?, force_deployment? }
          - Update DeployRunsTable: status = DEPLOYER_RUNNING, deployer_bundle_id, deployer_deploy_id
          - Return — task token is held until the Deployer's terminal callback fires SendTaskSuccess/Failure
        Catch:
          - Retry on 408/429/5xx/network errors (3 attempts, expo backoff base 2 s, max 30 s)
          - On exhaustion: SendTaskFailure(error="DeployerInvokeFailed") → RecordDeployOutcome
  → RecordDeployOutcome (Lambda; runs both on success and on caught failure)
        - SUCCEEDED: DeployRunsTable.status = DEPLOYER_SUCCEEDED + ComponentStateTable.live_bundle_id = bundle_id + clear pending + reset failure count
        - FAILED:    DeployRunsTable.status = DEPLOYER_FAILED + clear pending + ComponentStateTable.consecutive_failed_deploys += 1
        - CALLBACK_TIMEOUT: same as FAILED with last_error = "callback_missing_after_deployer_terminal"
        - Increment consecutive_failed_deploys; if == 3, set auto_deploy_status = PAUSED, paused_reason = "auto_paused_after_deploy_failures"
  → MaybeReportToMarketplace (Choice on ENV REPORT_OUTCOME_TO_MARKETPLACE)
        ├── true  → ReportToMarketplace (Lambda; PATCH <MarketplaceHost>/marketplace/subscriptions/{subscription_id}/notifications history annotation when supported, else no-op)
        └── false → SuccessState
```

- **Inputs**: `{ deploy_run_id, component_id, product_id, bundle_id, bundle_url, bundle_url_expires_at, dependencies?, dependency_layers?, custom_parameters?, multi_region_deployment?, trigger, notification_id?, reconcile_run_id?, dependency_context? }` (see §6.5).
- **Dependency ordering**: `dependency_layers` comes from Marketplace and is authoritative. `PlanDependencyLayers` reads `ComponentStateTable` for every dependency component; a dependency is satisfied only when its latest Marketplace bundle is already live locally and no `pending_bundle_id` is set. Unsatisfied dependencies are deployed layer by layer (`MaxConcurrency=1` across layers, parallel within a layer) before the target bundle reaches `BuildDeployerRequest`.
- **Dependency idempotency**: `StartDependencyDeploy` creates a child run with `trigger = "dependency"` and `dependency_context = { parent_deploy_run_id, root_component_id, layer_index }`, returning `{ dependency_deploy_run_id, already_started }`. If it creates a new child run, `StartDependencyExecutionAndWait` starts `DeployFromBundle` with `name = dependency_deploy_run_id` and waits with `states:startExecution.sync:2`. If the dependency already has `pending_bundle_id == latest_bundle_id`, the existing `pending_deploy_run_id` is never passed to `StartExecution`; `PollExistingDependencyRun` instead reads `DeployRunsTable` every `DEPENDENCY_WAIT_POLL_SECONDS` until the row reaches `DEPLOYER_SUCCEEDED` or a terminal failure. This avoids Step Functions `ExecutionAlreadyExists` while still preserving layer ordering. Any dependency failure, timeout, pause, or detected recursive path fails the parent run with `DependencyDeployFailed`; the target bundle is not handed to Deployer.
- **No local deployment timeout**: the `InvokeDeployer` wait-for-task-token state does not set a total timeout for Deployer completion. Deployer owns the CloudFormation / CodeBuild lifecycle and explicitly allows an unbounded state-machine duration (`Deployer.md` §2.3). Puller only times out the synchronous HTTP invocation attempt; terminal deployment state comes from the Deployer callback or the watchdog reconciliation in §5.3.
- **Bundle URL refresh**: Marketplace's presigned URL TTL is 1 h by default (`Marketplace.md` §2.4 — `NOTIFICATION_PRESIGN_TTL_SECONDS`). If `bundle_url_expires_at - now() < 5 min`, `BuildDeployerRequest` calls Marketplace `GET <MarketplaceHost>/marketplace/ontology/products/{product_id}/components/{component_id}/bundles/{bundle_id}` (per `Marketplace.md` §4.1) to fetch a fresh URL before invoking the Deployer.
- **Idempotency**: SFN execution name is `deploy_run_id`; a second `StartExecution` with the same name fails with `ExecutionAlreadyExists`. Top-level runs are protected by the webhook / reconcile `pending_`* preconditions, and dependency runs are protected by `StartDependencyDeploy` returning `already_started=true` so the parent polls the existing row instead of starting the execution again.

### 5.2 `ReconcileCatalog` — periodic reconciliation + drift sweep

```
LoadActiveSubscriptions (Lambda; Query SubscriptionsTable for marketplace_status = ACTIVE,
                                       optionally filtered by input.component_ids[])
  → DistributedMap (Mode=DISTRIBUTED, ExecutionType=STANDARD,
                    MaxConcurrency=RECONCILE_CONCURRENCY (default 25))
      ItemsPath: $.subscriptions
      Iterator (per subscription):
        FetchLatestBundle (Step Functions HTTP Task via MarketplaceApiKeyConnection)
            GET <MarketplaceHost>/marketplace/ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1
            Retry on 429/5xx (3 attempts, base 2 s, max 30 s)
            Catch: Continue (record per-component error, do not fail the whole reconcile)
        → EnsureDependencySubscriptions (Lambda; for root rows, reconcile managed dependency subscriptions from the fetched bundle's dependency_layers)
        → EvaluateDrift (Lambda; loads ComponentStateTable, compares latest_bundle_id vs live_bundle_id)
            - If latest_bundle_id == live_bundle_id ∧ pending_bundle_id == null → record "in_sync"
            - If latest_bundle_id == pending_bundle_id → record "in_flight"
            - If latest_bundle_id ≠ live_bundle_id ∧ auto_deploy_status == PAUSED → record "drifted_paused"
            - Otherwise → upsert ComponentStateTable.last_released_bundle_id, source="reconcile", and emit deploy intent
        → EnqueueDriftDeploy (Choice on $.intent)
            ├── deploy   → MintDeployRun (Lambda; transactional DeployRunsTable + ComponentStateTable.pending_* upsert)
            │              → states:StartExecution(DeployFromBundle, name=<new deploy_run_id>, input=<§6.5>)
            │              (StartExecution.sync is NOT used — reconcile completes when every drift deploy has been queued, not when each finishes)
            └── skip     → SuccessState
  → AggregateReconcileSummary (Lambda; writes ReconcileRunsTable with components_scanned/drifted/queued)
```

- **Trigger**: EventBridge Scheduler (`rate(1 hour)`) or manual `POST /reconcile`. The rate is conservative (`Marketplace.md` §1.2 already pushes; reconcile is the catch-up safety net).
- **Drift sweep variant**: A second EventBridge Scheduler entry (`rate(15 minutes)`) targets `ScheduleDriftSweep` Lambda, which runs a cheaper version of the same logic — it scans `ComponentStateTable.gsi1pk = STATUS#AUTO` for rows where `last_released_bundle_id != live_bundle_id ∧ pending_bundle_id == null`, batched at `DRIFT_SWEEP_BATCH_SIZE` (default 50), and starts `DeployFromBundle` per row. It does **not** re-poll Marketplace; it only resolves drift the previous reconcile already detected. This keeps small deploys flowing in <15 min even when an hourly reconcile is overdue.
- **Total budget**: ~10 min for a tenant subscribed to 200 components; Distributed Map scales horizontally.

### 5.3 `DeployerWatchdog` — stale callback reconciliation

```
LoadStaleDeployRuns (Lambda; query DeployRunsTable.gsi1pk = STATUS#DEPLOYER_RUNNING
                              where started_at < now - DEPLOYER_WATCHDOG_STALE_AFTER_SECONDS,
                              limit DEPLOYER_WATCHDOG_BATCH_SIZE)
  → MapStaleRuns (Map, MaxConcurrency=10)
      → FetchDeployerStatus (HTTP GET <LOCAL_DEPLOYER_BASE_URL>/deploy/{deployer_bundle_id || bundle_id})
            x-api-key: <tenant_service_key>
            Retry on 408/429/5xx/network errors (3 attempts, expo backoff base 2 s, max 30 s)
      → InterpretStatus (Choice)
            ├── IN_PROGRESS / REQUEST_MADE / PRE_DEPLOYMENT → leave run as DEPLOYER_RUNNING
            ├── SUCCEEDED → synthesize the same close-out transaction as a successful callback
            ├── FAILED / FAULT / STOPPED / TIMED_OUT → synthesize the same close-out transaction as a failed callback
            ├── 404 and deployment age < CALLBACK_TOKEN_ACCEPTANCE_DAYS → leave run open with last_error = "deployer_status_not_found"
            └── 404 or no status after callback acceptance window → mark CALLBACK_TIMEOUT
  → EmitWatchdogSummary
```

The watchdog never marks a run `CALLBACK_TIMEOUT` merely because the Puller's Step Functions execution has been waiting for a long time. It first asks Deployer, whose status endpoint is authoritative for the deployment it accepted. `CALLBACK_TIMEOUT` means the Puller can no longer reconcile an accepted deploy from either the callback or Deployer status; it is not a substitute for a deployment-duration SLA.

### 5.4 `SubscriptionLifecycle` — create / update / delete / rotate-secret

```
RouteOperation (Choice on $.op)
  ├── create        → LoadExistingSubscriptionByComponent (Lambda)
  │                   → ExistingDependency? (Choice)
  │                        ├── yes → PromoteDependencyToRoot (Lambda; subscription_origin=ROOT_AND_DEPENDENCY)
  │                        └── no  → CallMarketplaceCreateSubscription (HTTP Task)
  │                                  → StoreSigningSecret (Lambda; secretsmanager:CreateSecret in marketplace-puller/subscription/<subscription_id>)
  │                                  → PersistSubscriptionRow (Lambda; DDB Put with status=ACTIVE, subscription_origin=ROOT)
  │                   → FetchLatestBundleForRoot (HTTP Task; skip if no Valid bundle exists yet)
  │                   → EnsureDependencySubscriptions (Lambda/HTTP Tasks; create/promote managed DEPENDENCY rows from dependency_layers)
  │                   → SuccessState
  ├── update        → CallMarketplaceUpdateSubscription (HTTP Task)
  │                   → PersistSubscriptionRow (Lambda; DDB UpdateExpression on description/metadata/marketplace_status/auto_deploy_status)
  │                   → SuccessState
  ├── rotate-secret → CallMarketplaceRotateSecret (HTTP Task)
  │                   → StoreSigningSecret (Lambda; secretsmanager:PutSecretValue creating a new version while VersionStage=AWSPENDING for 60 s, then promote to AWSCURRENT)
  │                   → PersistSubscriptionRow (Lambda; updated_at)
  │                   → SuccessState
  └── delete        → PruneDependencySubscriptions (Lambda/HTTP Tasks; remove this root's references and delete now-unreferenced DEPENDENCY rows)
                      → MaybeDeleteMarketplaceSubscription (HTTP Task; skip if the row is still needed as DEPENDENCY; treat 404 as success)
                      → MaybeDeleteSigningSecret (Lambda; secretsmanager:DeleteSecret with RecoveryWindowInDays=7 when the Marketplace subscription is deleted)
                      → DeleteOrDemoteSubscriptionRow (Lambda; DDB DeleteItem for pure ROOT, update to DEPENDENCY for ROOT_AND_DEPENDENCY)
                      → SuccessState
```

Errors at any step abort with the specific tagged error from §3.7 (`MarketplaceUpstreamThrottled`, `MarketplaceUpstreamTimeout`, `MarketplaceSubscriptionConflict`). `create` is idempotent for dependency rows and non-idempotent for root rows: if the local API handler finds an existing `DEPENDENCY` row for the same component, it promotes the row to `ROOT_AND_DEPENDENCY` and returns the existing `subscription_id`; if it finds an existing `ROOT` or `ROOT_AND_DEPENDENCY` row, it returns 409 `SubscriptionAlreadyExists`.

### 5.5 Outcome reporting (optional)

When `REPORT_OUTCOME_TO_MARKETPLACE=true`, the `MaybeReportToMarketplace` step posts a tenant-side annotation back to Marketplace. The Marketplace's `GET /subscriptions/{subscription_id}/notifications` (per `Marketplace.md` §4.2) is read-only today — the Puller does not hit it for write — so this step is a no-op until/unless Marketplace adds a tenant-driven outcome surface. The hook is wired so a future Marketplace-side route can be opted into without a Puller code change.

---

## 6. Internal Data Schemas

### 6.1 SubscriptionsTable item shape

```
{ pk: "SUB#<subscription_id>",
  sk: "_",
  subscription_id, component_id, product_id,
  webhook_url,                                 // canonical lowercased
  signing_secret_arn,                          // arn:aws:secretsmanager:<region>:<account>:secret:marketplace-puller/subscription/<subscription_id>
  marketplace_status: "ACTIVE|PAUSED",
  auto_deploy_status: "AUTO|PAUSED",
  subscription_origin: "ROOT|DEPENDENCY|ROOT_AND_DEPENDENCY",
  managed_by_root_subscription_ids?: string[],  // DEPENDENCY / ROOT_AND_DEPENDENCY only
  managed_by_root_component_ids?: string[],     // DEPENDENCY / ROOT_AND_DEPENDENCY only
  paused_reason?, paused_at?,
  description?, metadata?,
  created_at, updated_at,
  last_received_event_id?, last_received_event_at?,
  last_deployed_bundle_id?, last_deploy_run_id?, last_deploy_status?,
  gsi1pk: "COMPONENT#<component_id>",           // webhook lookup
  gsi2pk?: "MANAGED_DEPENDENCY",                // present for DEPENDENCY / ROOT_AND_DEPENDENCY rows
  gsi2sk?: "<component_id>"
}
```

### 6.2 ComponentStateTable item shape

```
{ pk: "COMPONENT#<component_id>",
  sk: "_",
  component_id, product_id, type: "SERVICE|DATA",
  auto_deploy_status: "AUTO|PAUSED",
  paused_reason?, paused_at?,
  consecutive_failed_deploys: <int>,
  last_released_bundle_id?, last_released_bundle_seen_at?, last_released_bundle_source: "webhook|reconcile|manual",
  live_bundle_id?, live_bundle_deployed_at?,
  pending_bundle_id?, pending_deploy_run_id?, pending_started_at?,
  dependencies?, deploy_time_dependencies?, dependency_layers?,
  last_bundle_meta?,
  gsi1pk: "STATUS#<auto_deploy_status>", gsi1sk: "<component_id>"   // drift-sweep scan
}
```

### 6.3 DeployRunsTable item shape

```
{ pk: "COMPONENT#<component_id>",
  sk: "RUN#<deploy_run_id>",
  deploy_run_id, component_id, product_id,
  bundle_id, bundle_url_seen, bundle_url_expires_at_seen,
  trigger: "webhook|reconcile|drift_sweep|manual|dependency",
  notification_id?, reconcile_run_id?,
  status: "QUEUED|WAITING_FOR_DEPENDENCIES|INVOKING_DEPLOYER|DEPLOYER_RUNNING|DEPLOYER_SUCCEEDED|DEPLOYER_FAILED|INVOKE_FAILED|ABORTED|CALLBACK_TIMEOUT",
  attempt_count: <int>,
  task_token?,                                  // present while SFN is suspended
  callback_token_sha256,                        // SHA-256 of the one-shot callback token (§3.5)
  deployer_bundle_id?, deployer_deploy_id?,
  deployer_response_excerpt?, last_error?,
  dependency_context?: { parent_deploy_run_id, root_component_id, layer_index, path: string[] },
  started_at, finished_at?, duration_ms?,
  ttl: <unix_epoch>,                            // 30 d for terminal rows; 7 d for ABORTED
  gsi1pk: "STATUS#<status>", gsi1sk: "<started_at>#<deploy_run_id>"
}
```

### 6.4 ReconcileRunsTable item shape

```
{ pk: "RECONCILE#<reconcile_run_id>",
  sk: "_",
  reconcile_run_id, trigger: "schedule|manual|drift_sweep",
  started_at, finished_at?, status: "RUNNING|SUCCEEDED|FAILED",
  components_scanned: <int>, components_in_sync: <int>, components_in_flight: <int>,
  components_drifted: <int>, components_drifted_paused: <int>,
  deploy_runs_started: ["run_…", …],
  errors?: [ { component_id, error_class, message, http_status? }, … ],
  ttl: <unix_epoch>                              // 30 d
}
```

### 6.5 Step Functions input shapes

```ts
// DeployFromBundle input
{
  deploy_run_id: string,                   // also the SFN execution name
  component_id: string,
  product_id: string,
  bundle_id: string,                       // ULID
  bundle_url: string,                      // presigned S3 URL the Marketplace minted (1 h TTL by default)
  bundle_url_expires_at: string,           // ISO 8601 UTC; refreshed by BuildDeployerRequest if <5 min remain
  dependencies?: string[],
  deploy_time_dependencies?: string[],
  dependency_layers?: Array<Array<{ component_id: string, type: "SERVICE"|"DATA", product_id: string }>>,
  custom_parameters?: Record<string, string>,
  multi_region_deployment?: boolean,       // forwarded to Deployer; defaults to false
  force_deployment?: boolean,              // forwarded to Deployer; defaults to false
  trigger: "webhook"|"reconcile"|"drift_sweep"|"manual"|"dependency",
  notification_id?: string,                // when trigger == webhook
  reconcile_run_id?: string,               // when trigger == reconcile|drift_sweep
  dependency_context?: {
    parent_deploy_run_id: string,
    root_component_id: string,
    layer_index: number,
    path: string[]                         // used to reject recursive dependency paths defensively
  }
}

// ReconcileCatalog input
{
  reconcile_run_id: string,
  trigger: "schedule"|"manual"|"drift_sweep",
  component_ids?: string[]                  // empty means "every active subscription"
}

// DeployerWatchdog input
{
  trigger: "schedule"|"manual",
  component_ids?: string[],                 // optional operator scope
  older_than_seconds?: number               // defaults to DEPLOYER_WATCHDOG_STALE_AFTER_SECONDS
}

// SubscriptionLifecycle input
{
  op: "create"|"update"|"delete"|"rotate-secret",
  subscription_id?: string,                 // required for update/delete/rotate-secret
  component_id?: string,                    // required for create
  product_id?: string,                      // required for create
  subscription_origin?: "ROOT"|"DEPENDENCY",
  root_subscription_id?: string,             // required when creating dependency subscriptions
  root_component_id?: string,                // required when creating dependency subscriptions
  description?: string,
  metadata?: Record<string, unknown>,
  marketplace_status?: "ACTIVE"|"PAUSED",
  auto_deploy_status?: "AUTO"|"PAUSED"
}
```

### 6.6 OpenAPI

The full public/private API surface is described by `requirements/swagger.yml`. It is generated from the route module by `scripts/generate-openapi.ts` and checked in. The generator MUST run as part of `pnpm check` so a stale spec fails CI.

---

## 7. Cross-cutting Concerns

### 7.1 Error model and result envelope

All errors flow through a single `buildStdHttpError(status, ...other)` helper, which emits the `{ error: { message, reason, ... } }` envelope and maps the HTTP status to the right phrase / description. Internal sentinels are tagged classes (`_tag` discriminator) so Step Functions catches can route on `ErrorEquals`.

### 7.2 Authentication + authorisation model

- **Tenant `x-api-key`** — every public route except `POST /webhooks/marketplace`, `POST /deployer-callbacks/{deploy_run_id}`, and `GET /information`. The single Usage Plan key is the tenant's own `service_api_key` minted by Account (per `Account.md` §3.2) and bound to API Gateway by `ApiUsagePlanCustom`. There is no cross-tenant routing — the API only ever serves this tenant.
- **HMAC subscription signing** — inbound webhooks are verified per `Marketplace.md` §3.6 / §7.5. The Puller mirrors the same algorithm (`HMAC-SHA256` over the raw request body, `X-Marketplace-Signature: v1=<hex>`).
- **One-shot callback HMAC** — Deployer callbacks (§3.5) use a TTL-bounded HMAC token derived from `CALLBACK_TOKEN_HMAC_SECRET_ARN` and the `deploy_run_id`. Persistence of `callback_token_sha256` per row defends against secret rotation accidentally accepting old tokens.
- **EventBridge Connection** — outbound calls to Marketplace use the connection's secret (`x-api-key: <tenant marketplace API key>`); the secret is rotated by Account-side flows.

### 7.3 Configuration loading

Each `ConfigEntry` is a thin SSM/Secrets-Manager wrapper with three operations: `get_value()` (returns raw, raises if absent), `value_or(default)` (returns raw or default), `update_secure(value)` (writes a SecureString). Values are cached in-process for a TTL; cache buckets are time-quantised so all warm Lambdas converge on the same value within one TTL window. A missing optional value MUST NOT block unrelated routes — the bootstrap pattern from `Marketplace.md` §7.3 is reused verbatim.

### 7.4 Idempotency

- **Webhook ingress** is keyed by `event_id` in `DedupeLedgerTable` (TTL 30 d). Marketplace's at-least-once delivery is upgraded to exactly-once-per-30-days at the Puller boundary.
- **Deploy runs** are keyed by `deploy_run_id` (used as both the DDB SK and the SFN execution name). A second `StartExecution` with the same name is a guarded error and is never reached: top-level paths check `pending_`* state before starting, and dependency paths poll an existing `pending_deploy_run_id` instead of attempting to attach to it.
- **Reconcile runs** are keyed by `reconcile_run_id`; manual `POST /reconcile` calls are idempotent only by request — two simultaneous calls produce two independent runs that may both queue the same drift deploy, in which case the deploy-run mint step's transactional `pending_`* check rejects the second attempt with `ConditionalCheckFailedException` and the second reconcile records `intent: "in_flight"`.
- **Deployer callback** is keyed by `deploy_run_id`; a duplicate callback with the same status returns `200 { acknowledged: true, duplicate: true }`; a contradictory one returns `409 DeployRunAlreadyClosed`.

### 7.5 Transaction tracing

Every public route reads or mints `X-Sc-Health-Transaction-Id` (header constant `TRACE_HEADER`) and stamps it on the response. Internal SFN executions use the same value as the `name` argument to `StartExecution` when feasible (deploy runs use `deploy_run_id`; reconcile runs use `reconcile_run_id`). The Puller propagates the trace header to the Deployer's `POST /deploy-by-token` so a single transaction is queryable end-to-end across Marketplace → Puller → Deployer.

### 7.6 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=marketplace-puller-`*, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once, appends a request-scoped key (`subscription_id`, `notification_id`, `deploy_run_id`, `reconcile_run_id`, `component_id`, `bundle_id`), and resets the keys in `finally`.
- **Metrics**: CloudWatch EMF in the `marketplace-puller` namespace, dimensioned by `component_id`. Notable counters: `puller.webhooks.accepted`, `puller.webhooks.duplicates`, `puller.webhooks.signature_invalid`, `puller.deploys.invoked`, `puller.deploys.succeeded`, `puller.deploys.failed`, `puller.deploys.callback_timeout`, `puller.deployer.watchdog.checked`, `puller.deployer.watchdog.closed_from_status`, `puller.reconcile.runs`, `puller.reconcile.drifted_components`, `puller.deployer.invocation_latency_ms`.
- **Tracing**: API Gateway access logs at log-level `ERROR`; X-Ray on every state machine; X-Ray on Lambda handlers.

### 7.7 Long-running command discipline

Every external HTTP call (Marketplace, Deployer) is wrapped in a shared HTTP client with `Retry(total=3, backoffFactor=0.5, statusForcelist=[408,429,500,502,503,504])` and a 30 s timeout default. The Marketplace EventBridge Connection respects the same retry policy via its built-in `RetryPolicy`. Deployer invocations follow `DEPLOYER_INVOCATION_TIMEOUT_SECONDS` (default 45 s) per attempt and rely on the Deployer callback for the long tail. The Puller never busy-waits the Deployer; the watchdog performs coarse reconciliation from Deployer's status endpoint when a callback appears stale.

### 7.8 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double:

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Complex services (`SubscriptionsRepository`, `ComponentStateRepository`, `DeployRunsRepository`, `WebhookVerifier`, `DeployerClient`, `MarketplaceClient`, `CallbackTokenSigner`) expose pure-function factories so tests can pass mocks.
- Errors are **structured tagged classes** with a discriminator (`type` / `_tag`) so the HTTP layer can `switch` on them when mapping to status codes.
- Composition is split per route group (`webhook` / `subscriptions` / `components` / `reconcile` / `callback`) so a missing env var for an unrelated route never breaks this one.

### 7.9 Testing strategy

- Unit tests live in `test/services/**/*.ts`, `test/handlers/**/*.ts`, `test/state-machines/**/*.ts`, `test/schemas/**/*.ts`, and `test/cdk/puller-stack.test.ts`.
- Vitest is the test runner. Integration tests live in `test/integration/puller-api.test.ts` and hit a deployed API with `PULLER_API_URL` + `PULLER_API_KEY`.
- A test-double Marketplace receiver (`scripts/start-marketplace-sink.sh`) and a test-double Deployer receiver (`scripts/start-deployer-sink.sh`) are required for end-to-end webhook + deploy-handoff tests. `just test` (the canonical CI command) starts/stops the Docker containers automatically and asserts on the recorded payload + signatures.
- Step Functions Local is required for compiled-ASL tests; `just test` orchestrates the docker container.
- The OpenAPI spec at `requirements/swagger.yml` is regenerated by `scripts/generate-openapi.ts` (driven from the route definitions module) and checked in.

### 7.10 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the SOCAPITAL shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`) **plus** OpenAPI regeneration. `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- The Puller is installed inside each tenant AWS sub-account by the bootstrap CLI after the local Deployer information endpoint is healthy. One Puller per tenant.
- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI / CDK with permissions for DynamoDB, KMS, SSM, Secrets Manager, Lambda, API Gateway, Step Functions, EventBridge (Scheduler + API destinations + Connections), IAM, CloudWatch Logs.
- A pre-populated `Subdomain` value for the deployer-supplied custom domain (the same FQDN that fronts every other Staircase product in this account).
- A pre-populated `MarketplaceHost` (e.g. `marketplace.staircaseapi.com`) and a tenant-bound API key to call it (held in Secrets Manager via the EventBridge Connection).
- A pre-populated `TenantApiKeyID` (the canonical operator API key minted by Account, the same key the rest of the products in this account accept).
- A reachable local Deployer at `https://<Subdomain>/infra-deployer/` (`Deployer.md` §1.2).

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # DataStack first, then PullerStack (CDK auto-orders)
pnpm cdk:destroy          # only when none of the DDB tables hold operator data
```

Stack outputs: `ApiUrl`, `SubscriptionsTableName`, `ComponentStateTableName`, `DeployRunsTableName`, `ReconcileRunsTableName`, `DedupeLedgerTableName`, `KmsKeyArn`, `DeployFromBundleArn`, `ReconcileCatalogArn`, `SubscriptionLifecycleArn`, `MarketplaceApiKeyConnectionArn`. The `service-marketplace-puller` cost tags are stamped on every resource.

### 8.3 First-time configuration

1. Confirm the EventBridge Connection's secret has the tenant Marketplace API key. (The installer should have populated `/marketplace-puller/<stage>/marketplace-api-key`; the Puller's bootstrap custom resource reads it and updates the connection.)
2. Subscribe to the components this tenant wants: `POST /subscriptions { component_id, product_id }` for each. The Puller minted webhook URL is `https://<Subdomain>/marketplace-puller/webhooks/marketplace`; the upstream Marketplace verifies it via `POST /subscriptions/verify` (per `Marketplace.md` §4.2) before persisting.
3. Trigger an initial reconcile to catch up to whatever bundles exist today: `POST /reconcile {}` with no `component_ids` enumerates every subscription. Watch the deploys via `GET /reconcile/runs/{reconcile_run_id}` and `GET /components`.
4. Confirm at least one component reaches `live_bundle_id == last_released_bundle_id`; this proves the end-to-end Puller → Deployer path is wired.

### 8.4 Smoke tests

After every deploy run the five release-validation calls listed in `README.md` §"Marketplace Puller release validation":

1. `POST /subscriptions { component_id: "DummyComponent", product_id: <id> }` against a sandbox Marketplace instance with a known-good test component. Confirm the local row appears with `marketplace_status: "ACTIVE"` and the Marketplace's webhook-verify probe was answered.
2. Trigger an upstream bundle publication on the sandbox Marketplace; within `NOTIFICATION_RETRY_MAX_ATTEMPTS * NOTIFICATION_RETRY_MAX_DELAY_MS` (default ≤25 min, see `Marketplace.md` §2.4) the Puller's `GET /components/DummyComponent` MUST show a non-null `last_released_bundle_id` and a `pending_*` triplet.
3. Wait for the Deployer's terminal callback (per `Deployer.md` §5.4); after Deployer reports terminal success, the Puller's `GET /components/DummyComponent` MUST show `live_bundle_id == last_released_bundle_id` and `pending_bundle_id == null`. If the callback is deliberately suppressed in a test, the watchdog MUST close the run from `GET /deploy/{bundle_id}` without marking it timed out while Deployer still reports `IN_PROGRESS`.
4. `POST /components/DummyComponent/redeploy` with no body; confirm a fresh `deploy_run_id` is minted and the Deployer is invoked again with the same `bundle_id`.
5. `DELETE /subscriptions/<subscription_id>` — confirm the upstream Marketplace row is gone (`GET <MarketplaceHost>/marketplace/subscriptions/<id>` → 404), the local row is gone, and the Secrets Manager secret is in the 7-day deletion window.

### 8.5 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps storage (DynamoDB, Secrets Manager) in place.
2. Re-run the smoke tests above.
3. Confirm no SFN executions are stuck `RUNNING` past the per-run budget — `aws stepfunctions list-executions --status-filter RUNNING ...`.

### 8.6 Common runbook items

- **Webhook returning 401 `WebhookSignatureInvalid`**: Either the Marketplace's `signing_secret` rotated and the Puller's local secret is stale, or the wrong subscription mapping is hit. Inspect `DedupeLedgerTable` for the failing `event_id`'s `result`. Fix: `POST /subscriptions/<subscription_id>/rotate-secret` (which forwards to Marketplace).
- **Component stuck with `pending_bundle_id` while Deployer is terminal**: The callback may have been lost. First run or inspect `DeployerWatchdog`; it should call `GET /deploy/{bundle_id}` and close the Puller run from Deployer's authoritative status. Only manually release the task token after confirming Deployer has no active execution and the watchdog cannot reconcile the row.
- `**auto_deploy_status: "PAUSED"` with `paused_reason: "auto_paused_after_deploy_failures"`**: Check `GET /components/{component_id}/deployments` for the three failing runs; the most common cause is a bad bundle (Marketplace's review env passed but the tenant's account has different IAM / quota constraints). After the bundle is fixed upstream, `POST /components/{component_id}/resume` will catch up.
- **Reconcile run reports `MarketplaceUpstreamThrottled`**: The Puller is being rate-limited by the Marketplace. Bump `RECONCILE_CONCURRENCY` down (from 25 to 10) and let the Marketplace recover; the per-component `EvaluateDrift` step has its own retry budget so a single throttled call does not fail the whole run.
- **Drift sweep keeps queuing the same `(component_id, bundle_id)` over and over**: Indicates the Deployer is acknowledging the deploy but the post-deploy `live_bundle_id` write isn't happening. Inspect the `DeployRunsTable` rows: a `DEPLOYER_SUCCEEDED` status that is not paired with a `live_bundle_id` flip on `ComponentStateTable` is a bug in `RecordDeployOutcome`'s transactional write.
- `**MarketplaceSubscriptionConflict` on subscription create**: The Marketplace already has a subscription bound to this Puller's `webhook_url` for the same `component_id`. List `GET <MarketplaceHost>/marketplace/subscriptions?component_id=<id>` and either delete the duplicate or import its `subscription_id` + `signing_secret` into the local row.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,tracer,event-handler,parameters}`, `@aws-sdk/{client-dynamodb,lib-dynamodb,client-secrets-manager,client-sfn,client-ssm,client-kms,client-eventbridge,client-scheduler,client-apigateway,credential-providers}`, `aws-sdk-client-mock` (test only), `ulid`, `zod` (or `@sinclair/typebox`), `cfnresponse`-equivalent custom-resource shim, `undici` for outbound HTTP. CDK: `aws-cdk-lib`, `constructs`, `aws-cdk`. **No** SSH client, **no** in-process workflow engine.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `webhook`, `subscription`, `component`, `deploy-run`, `reconcile-run`, `error`. Errors are tagged classes; everything else is type+validator pairs.
4. **Utils**: `lambda/utils/{trace,ulid,kms,hmac,callback-token,marketplace-client,deployer-client,clock}.ts`.
5. **Configuration**: `lambda/config/instance.ts` (per-instance SSM-backed entries with TTL caching) plus per-service config readers tied to the env vars listed in §2.4. Required vars must throw at startup; optional vars must default per §2.4.
6. **Services** (one file each in `lambda/services/`): Subscriptions (`Repository`, `SecretsBroker`); ComponentState (`Repository`, `DriftEvaluator`); DeployRuns (`Repository`); Reconcile (`Repository`, `MarketplacePoller`); Webhook (`Verifier`, `Idempotency`); Deployer (`Client`, `RequestBuilder`); Marketplace (`Client` — wraps the EventBridge Connection); Callback (`TokenSigner`, `Verifier`); Health (`MetricsEmitter`); plus a composition module `services/index.ts` that exports per-router and per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts, responses.ts, decorators.ts}`, `lambda/logging/{powertools.ts, runtime.ts}`, the six routers (`webhook`, `subscriptions`, `components`, `reconcile`, `callback`, `info`) and `router.ts` mounting them with `prefix="/marketplace-puller"`, then `handler.ts`.
8. **Worker handlers** in `lambda/{build-deployer-request, invoke-deployer, record-deploy-outcome, maybe-report-to-marketplace, load-active-subscriptions, fetch-latest-bundle, evaluate-drift, mint-deploy-run, schedule-drift-sweep, aggregate-reconcile-summary, create-marketplace-subscription, update-marketplace-subscription, delete-marketplace-subscription, rotate-subscription-secret, store-signing-secret, persist-subscription-row, delete-subscription-row}/`.
9. **Custom resources**: `lambda/custom-resources/{api-usage-plan,api-gateway-log,marketplace-connection-bootstrap}.ts` plus the `cfnresponse`-equivalent helper.
10. **OpenAPI generator**: `lambda/api/definitions.ts` and `scripts/generate-openapi.ts`. `pnpm api:spec` writes `requirements/swagger.yml` (the generated spec is checked in).
11. **CDK stacks**: `lib/data-stack.ts` and `lib/puller-stack.ts` per §2.1–§2.3, then `bin/app.ts`.
12. **State-machine ASL**: `lib/state-machines/{deploy-from-bundle,reconcile-catalog,subscription-lifecycle}.asl.ts` (TypeScript builders using `aws-cdk-lib/aws-stepfunctions`).
13. **Local sinks**: `scripts/start-marketplace-sink.sh`, `scripts/start-deployer-sink.sh`, `scripts/marketplace-sink/Dockerfile`, `scripts/deployer-sink/Dockerfile`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared SOCAPITAL workflows.
14. **Smoke tests**: replicate the five release-validation steps from §8.4 in the integration suite under `test/integration`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- `POST /webhooks/marketplace` completes Marketplace's `X-Marketplace-Hook-Secret` subscription handshake with no side effects, verifies the `X-Marketplace-Signature` HMAC over the **raw** request body for real notifications (per `Marketplace.md` §3.6 / §7.5), dedupes by `event_id`, and returns `200` within the 15-second per-attempt budget. A signature failure returns `401` and is **not** retried by Marketplace's policy.
- A `component.bundle.published` notification accepted by the webhook handler **always** results in either (a) a queued `DeployFromBundle` SFN execution that calls the local Deployer, or (b) a `dedupe`/`already_live`/`in_flight`/`paused` short-circuit recorded in `DedupeLedgerTable`. There is no third path.
- The Puller calls **only** the local Deployer (`https://<Subdomain>/infra-deployer/`); audited via static analysis (no outbound HTTPS targets other than `MARKETPLACE_HOST` and `LOCAL_DOMAIN_NAME`).
- The Deployer callback (`POST /deployer-callbacks/{deploy_run_id}`) authenticates via the one-shot HMAC token (§3.5) — the token is single-use across `(deploy_run_id, callback_token_sha256)` and acceptance-bounded by `CALLBACK_TOKEN_ACCEPTANCE_DAYS`.
- A successful Deployer callback transactionally (a) sets the `DeployRunsTable` row to `DEPLOYER_SUCCEEDED`, (b) sets `ComponentStateTable.live_bundle_id = bundle_id` and clears `pending_`*, (c) resets `consecutive_failed_deploys`, and (d) calls `states:SendTaskSuccess` on the SFN. A failed callback does the symmetric `DEPLOYER_FAILED` path and increments `consecutive_failed_deploys`; if it reaches 3, `auto_deploy_status` flips to `PAUSED`.
- `ReconcileCatalog` runs hourly by default and a `drift_sweep` runs every 15 minutes. A drifted component (`live_bundle_id != last_released_bundle_id ∧ auto_deploy_status == AUTO ∧ pending_bundle_id == null`) is **always** picked up within one drift-sweep cycle, even if every webhook for it was lost.
- Subscription create / update / delete / rotate-secret flow through `SubscriptionLifecycle` SFN and keep the local row, the Secrets Manager secret, and the Marketplace-side row consistent. Marketplace 404s on delete are tolerated (the operation is idempotent).
- The Puller never assumes any role into another AWS account. All AWS calls use the worker's own IAM role. Audited via static analysis (no `STS:AssumeRole` calls anywhere in the code path).
- The Marketplace's `POST /subscriptions/verify` handshake probe (per `Marketplace.md` §4.2) succeeds against `https://<Subdomain>/marketplace-puller/webhooks/marketplace` by echoing `X-Marketplace-Hook-Secret` with a 2xx.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so any CommonJS dependency works at runtime.
- IAM permissions follow least-privilege per §2.3.3.
- All structured logs include the relevant `subscription_id` / `notification_id` / `deploy_run_id` / `reconcile_run_id` / `component_id` / `bundle_id` so an operator can trace a single bundle's lifecycle end-to-end via CloudWatch Logs Insights.
- The Marketplace ↔ Puller ↔ Deployer contract is honoured: a bundle published in the central Marketplace becomes a `live_bundle_id` flip on the tenant Puller after Deployer reaches terminal success and posts its callback; if the callback is lost, the watchdog must derive the same close-out from Deployer's status endpoint. The Puller never marks a still-running Deployer execution as timed out solely because a local wait budget elapsed.
