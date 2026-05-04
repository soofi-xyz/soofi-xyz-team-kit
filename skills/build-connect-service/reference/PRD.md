# Connect Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Connect** partner-integration service. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to `us-east-2`, per the SOCAPITAL Golden Path engineering standards.

---

## 1. Product Overview

### 1.1 Mission

Connect is a serverless partner-integration platform for SOCAPITAL that fronts every external data partner (Plaid, Argyle, Atomic, AVMs, credit bureaus, lenders, …) behind a single REST API. It hides the complexity of each partner's quirks (authentication, content type, polling, webhooks, widgets, static-IP allow-listing, multipart payloads, OAuth refresh, etc.) behind one declarative **flow specification** that the platform compiles into an AWS Step Functions state machine and exposes as `POST /vendors/{vendor_name}/{entity}/{name}/jobs`.

**AWS Step Functions is the single, canonical implementation layer for every Connect workflow.** Every flow and lookup compiles to a Step Functions state machine; there is no "alternative runtime" — no Lambda-only orchestrator, no in-process workflow engine, no SQS-chained worker fan-out. Branching, looping, error handling, retries, parallelism, timeouts, fan-out, and human-in-the-loop waits are expressed exclusively as native ASL constructs (`Choice`, `Map`, `Parallel`, `Retry`, `Catch`, `Wait`, `Wait For Task Token`).

**Outbound HTTP calls to partners are issued by Step Functions itself, not by Lambda.** Connect uses the native Step Functions **HTTP Task** integration (`arn:aws:states:::http:invoke`) backed by **EventBridge `Connection` resources** for credential storage. Every HTTP-shaped task type in §3.5.1 (`HTTP_JSON`, `HTTP_XML`, `HTTP_ANY`, `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`, `GET_XML`, `POST_XML`, `DELETE_XML`, `POST_BASE64`, `POST_FORM_URL_ENCODED`) compiles to a native HTTP Task — no Lambda hop. Lambda workers are reserved exclusively for the narrow set of HTTP cases the native integration cannot express directly (multipart streaming, blob upload from a presigned source, raw binary file download to S3, static-IP-bound egress through the on-demand NAT, and XML envelope rewrites that require code).

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<subdomain>/connector-jobs/`*, API-key authorised (`x-api-key` per usage plan), with the capability groups below (full mapping in §3 and §4):


| Group                                  | Routes                                                                                                                                        | Purpose                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Partners**                           | `POST/GET/PATCH/DELETE /vendors[/{vendor_name}]`                                                                                              | Create, list, get, patch, delete a partner                                                                  |
| **Partner credentials**                | `PUT/PATCH /vendors/{vendor_name}/credentials` and `…/passed-credentials`                                                                     | Replace/merge static-auth credentials and passed-through credentials                                        |
| **Partner pull credentials**           | `PATCH /vendors/{vendor_name}/pulled-credentials`                                                                                             | Sync credentials from an upstream Account Manager service (SigV4 fetch)                                     |
| **Partner information**                | `GET /vendors/{vendor_name}/information`                                                                                                      | Report which credential buckets are populated (presence-only, no values)                                    |
| **Partner connectivity configuration** | `POST/GET /vendors/{vendor_name}/configurations`, `DELETE /…/configurations/{partner_configuration_id}`                                       | Per-tenant overrides of partner credentials, scoped by `partner_configuration_id`                           |
| **Flow constructor (async)**           | `POST/GET/PUT/DELETE /vendors/{vendor_name}/{entity}/[{name}]` (`entity ∈ flows                                                               | lookups`),` GET /flow/schema`,` GET /{entity}/creations/{creation_id}`                                      |
| **Job execution**                      | `POST /vendors/{vendor_name}/{entity}/{name}/jobs`                                                                                            | Fire a single execution of a compiled flow / lookup                                                         |
| **Batch execution**                    | `POST /vendors/{vendor_name}/flows/{name}/batch-executions`, `GET /batch-executions/{batch_execution_id}/aggregation`                         | Distributed-Map fan-out over a JSON file in S3                                                              |
| **Job status & history**               | `GET /vendors/{vendor_name}/flows/{name}/jobs/{job_id}`, `GET /vendors/{vendor_name}/flows/{name}/executions`, `POST /…/jobs/{job_id}` (stop) | Trace per-event execution history, abort a running job                                                      |
| **Webhooks**                           | `POST /vendors/{vendor_name}/flows/{name}/webhook`                                                                                            | Inbound partner callback that releases a `WAIT_FOR_TASK_TOKEN` step                                         |
| **Response recovery**                  | `POST /response-url-recovery`                                                                                                                 | Re-mint presigned URLs for response objects of a past `job_id`                                              |
| **Token registry**                     | `POST/GET/PATCH/DELETE /tokens/{token_name}`                                                                                                  | Centralised, encrypted token store reusable across partners                                                 |
| **Static IP**                          | `GET/POST/DELETE /network/ip`                                                                                                                 | Allocate / release a NAT-gateway-fronted Elastic IP for partners that allow-list IPs                        |
| **Internal — proxy links**             | `GET /proxy-links/{...}` (created at runtime)                                                                                                 | Vanity API Gateway routes that 302 to S3 presigned URLs (Atomic-style widgets, downloadable response files) |
| **Internal — service info**            | `GET /information`                                                                                                                            | Static service metadata (mocked through API Gateway)                                                        |
| **Internal — Health authorizer**       | (Lambda authorizer)                                                                                                                           | Dual API-key authoriser used by health/metric routes                                                        |


Each successful POST that mints work returns `202 Accepted` with a server-generated `creation_id`, `job_id`, or `batch_execution_id`. Every mutating route is API-key-gated (`api_key_required: true`) plus CORS preflight; the only exceptions are `POST /…/webhook` (partner-authenticated via per-flow secret) and `GET /information` (mock).

### 1.3 Non-goals

- Connect does **not** persist partner response bodies long-term; it stages them in S3 with a 30-day lifecycle.
- Connect does **not** own partner contracts. Partners' OpenAPI shapes are encoded in the flow spec authored by the integrator.
- Connect does **not** synthesise its own subdomain or ACM certificates. The `Subdomain` parameter is provided by the deployer.
- Connect does **not** invent its own auth identity. API keys are minted upstream and bound to API Gateway usage plans by the deployer.
- Connect does **not** broker SOAP envelopes natively — XML traffic is supported as a transport, not as a schema.
- Connect does **not** host arbitrary user-supplied code. Partners that need transformation logic do it in their own service or via flow primitives (`Pass`, `Choice`, `JSONPath`-driven request mapping).
- Connect does **not** open raw outbound SSH from Lambda. SFTP traffic goes exclusively through **AWS Transfer Family Connectors** with the listing-first poller flow (see §2.3.7 and §5.6).

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Step Functions is the workflow implementation layer.** Every flow and lookup compiles to a Step Functions state machine (STANDARD for flows, EXPRESS for lookups). There is no second workflow runtime, no in-Lambda step orchestrator, no chained-SQS state machine. Branching (`Choice`), looping (`Map`), parallelism (`Parallel`), retries (`Retry`), error catches (`Catch`), waits (`Wait`), and human-in-the-loop pauses (`waitForTaskToken`) are expressed exclusively as ASL primitives.
2. **Step Functions issues outbound HTTP itself.** Native Step Functions **HTTP Tasks** (`arn:aws:states:::http:invoke`) backed by EventBridge `Connection` resources are the default transport for every partner HTTP call. The compiler emits HTTP Tasks for `HTTP_`*, `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`, `GET_XML`, `POST_XML`, `DELETE_XML`, `POST_BASE64`, and `POST_FORM_URL_ENCODED` task types. Lambda HTTP workers exist **only** for the cases the native integration cannot express (multipart streaming, blob upload from a presigned source, raw binary file download to S3, static-IP-bound egress, XML envelope code-driven rewrites).
3. **Authorisation lives on the EventBridge Connection, not in code.** Basic, API-key, and OAuth2 client-credentials flows are configured on the EventBridge `Connection`. The compiled state machine never sees the secret material — it only references the Connection ARN. Token rotation is delegated to EventBridge for OAuth2 connections; the central token registry (`TokensTable`) remains the source of truth for partners that need cross-flow token reuse outside EventBridge's native OAuth2 support.
4. **AWS-native integrations beat custom code.** Where Step Functions has a first-class service integration (`states:startExecution.sync:2`, `s3:getObject`, `dynamodb:GetItem`, `sqs:sendMessage.waitForTaskToken`, `lambda:invoke`, `events:putEvents`, `transfer:StartFileTransfer` via Lambda for SFTP), the compiler emits the integration directly. Custom Lambdas exist only when no AWS-native integration suffices.
5. **No in-process workflow engine, no in-process SSH client, no in-process code sandbox.** These exclusions remain enforced (see §7.6 and §2.5).

### 2.1 Stacks (AWS CDK)

The CDK app is composed of two stacks deployed in order:

```
bin/app.ts
├── NetworkStack    # VPC + 2 private app subnets + Lambda SG +
│                    # the on-demand Static-IP fabric (Internet GW, public subnet,
│                    # EIP, NAT GW, two private routes) provisioned by Step Functions
└── ConnectStack    # All Lambdas, S3 buckets, SQS queues, DynamoDB tables, KMS CMK,
                    # Step Functions, REST API + IAM authorisers, API Gateway custom
                    # resources, OpenAPI spec, dynamic /proxy-links/* fabric,
                    # AWS Transfer Family SFTP connectors + listing-first poller
```

`ConnectStack.addDependency(networkStack)` ensures the network deploys first. Both stacks are declared in **TypeScript** (`aws-cdk-lib` v2.170+) and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per §`cloud-aws-primary`).

### 2.2 NetworkStack contents

- **VPC** with `maxAzs: 2`, `natGateways: 0` (the static-IP NAT is provisioned on demand by `EnableStaticIp`), two subnet tiers (`public`, `app=PRIVATE_WITH_EGRESS` reserved for static-IP-bound Lambdas), and an S3 gateway endpoint reachable from `app`.
- **VPC Flow Logs** (`ALL` traffic) into a 1-day-retention CloudWatch Logs group.
- One **Security Group**:
  - `LambdaSg` — `allowAllOutbound: true`, attached to every VPC-bound Lambda that needs to egress through the static IP.
- **Static-IP fabric scaffolding**: the two Step Functions (`EnableStaticIp` / `DisableStaticIp`), their backing Lambdas, and the IAM role they assume are all declared in NetworkStack but **the EIP, NAT Gateway, public subnet, and routes are created and destroyed at runtime** by those state machines (so cost is zero when no partner needs allow-listing).
- All resources carry `sc:service:name=connect` and `sc:product:name=Connect` cost tags (per `cloud-aws-primary`).

Stack outputs (re-exported at the application level): `VpcId`, `LambdaSgId`, `PrivateSubnetIds`, `EnableStaticIpStateMachineArn`, `DisableStaticIpStateMachineArn`.

### 2.3 ConnectStack contents

#### 2.3.1 Storage


| Bucket                   | Encryption / ACL                                                                                                                         | Lifecycle                                                                                                                                                                                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VendorsResponsesBucket` | S3-managed encryption, `BLOCK_ALL` public access, `BUCKET_OWNER_ENFORCED`, SSL-only via bucket policy, S3 access logs to `LoggingBucket` | 30-day expiry on prefix `_flow_or_lookup_creations/anyflow/`; 30-day expiry on `_batch_raw_items_object_prefix/`; 30-day expiry on `widgets/`; 30-day expiry on `transfer-listings/` and `sftp-inbound/` | Response payloads keyed `<job_id>/<file>`, widget HTML at `widgets/<vendor>/<flow><uuid>.html`, batch input + per-item output objects under `_batch_raw_items_object_prefix/`, async creation-objects under `_flow_or_lookup_creations/anyflow/`, AWS Transfer Family directory listings under `transfer-listings/<vendor>/<YYYY>/<MM>/<DD>/<listingId>.json`, files transferred via the SFTP poller under `sftp-inbound/<vendor>/<YYYY>/<MM>/<DD>/<remote-path>` (per `build-inbound-sftp-workflows`). |
| `LoggingBucket`          | S3-managed encryption, `LogDeliveryWrite` ACL                                                                                            | —                                                                                                                                                                                                        | S3 server access log target for the responses bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |


All buckets enforce `BLOCK_ALL` public access, SSL-only, and `BUCKET_OWNER_ENFORCED` ownership.

#### 2.3.2 Queues


| Queue           | Retention | VT   | DLQ + maxReceiveCount | Purpose                                                                                                                                                                                                                               |
| --------------- | --------- | ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebhooksQueue` | 4 d       | 30 s | `WebhooksDlq`, 5      | Webhook task-token reference rows. The compiled flow's `WAIT_FOR_TASK_TOKEN` step writes the token via `arn:aws:states:::sqs:sendMessage.waitForTaskToken`; `WebhooksWriter` Lambda (SQS-triggered) persists the row to `FlowsTable`. |


The DLQ has a 14-day retention. SQS-managed encryption, `enforceSSL: true`.

#### 2.3.3 DynamoDB

Both tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled, and TTL on `ttlEpochSeconds` for transient rows.


| Table         | Keys                | Indexes                                    | Notes                                                                                                                                                                          |
| ------------- | ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FlowsTable`  | `pk` (S) / `sk` (S) | `gsi1: type / vendor_name`, `gsi2: gsi2pk` | Single-table store for partners, flows, lookups, partner connectivity configurations, webhook references, and non-blocking webhook dedup rows. Item shape mirrors §6.5 / §6.7. |
| `TokensTable` | `pk` (S) / `sk` (S) | —                                          | Centralised token registry. Stores `token_value` (encrypted via the same CMK) plus an arbitrary `extra` map.                                                                   |


A single AWS-KMS Customer-Managed Key (`DataKey`) encrypts both tables and is granted `kms:Decrypt`/`kms:Encrypt` for the runtime Lambda role, scoped via `kms:ViaService=dynamodb.us-east-2.amazonaws.com`.

#### 2.3.4 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so any CommonJS dependency can satisfy dynamic built-in `require`s. Logging format is JSON with three-month CloudWatch log-group retention. Handlers use `**@aws-lambda-powertools/{logger,tracer,metrics}`** with `POWERTOOLS_SERVICE_NAME=connect-*`, `POWERTOOLS_LOG_LEVEL=INFO`, `POWERTOOLS_METRICS_NAMESPACE=connect` (per `observability-logging-tracing`).

**HTTP-by-default is Step Functions-native, not Lambda.** Per §2.0 principle 2, the flow compiler emits a native Step Functions HTTP Task (`arn:aws:states:::http:invoke`) for every plain HTTP-shaped task type — `HTTP_JSON`, `HTTP_XML`, `HTTP_ANY`, `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`, `GET_XML`, `POST_XML`, `DELETE_XML`, `POST_BASE64`, `POST_FORM_URL_ENCODED`. Authorisation is bound to the EventBridge `Connection` resource referenced by the task; the runtime state machine never sees the credential material. Lambda workers in the **vendor request workers** cohort exist exclusively for the residual HTTP cases the native HTTP Task integration cannot express end-to-end (multipart streaming, blob upload from a presigned source, raw binary file download to S3) and for **static-IP-bound egress** that must traverse the on-demand NAT.

There are seven cohorts; the full per-task-type worker matrix lives in §3.5.1.


| Cohort                                                                                         | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Memory     | Timeout  | VPC                                                                            | Trigger                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Public API router**                                                                          | `ConnectHandler`                                                                                                                                                                                                                                                                                                                                                                                                                                              | 512 MB     | 30 s     | —                                                                              | API Gateway REST API                                                                                                          |
| **Compilation pipeline** (driven by `FlowCreationStateMachine` / `LookupCreationStateMachine`) | `TransformFlowSpec`, `TransformLookupSpec`, `AddPassThroughAuthorization`, `AddCallApiAuthorization`, `AddCallTokenManagement`, `AddCredentialsToAuthorization`, `AddDryRun`, `ValidateAslDefinition`, `CreateRuntimeStateMachine`, `UpdateRuntimeStateMachine`, `SaveFlow`                                                                                                                                                                                   | 256–512 MB | 20–30 s  | —                                                                              | Step Functions task                                                                                                           |
| **Vendor request workers** (residual HTTP only — most HTTP traffic is a native SFN HTTP Task)  | `PostMultipartWorker`, `PutMultipartWorker`, `PostBlobWorker`, `PutBlobWorker`, `GetFileWorker`. **Plain JSON / XML / form-encoded / base64 HTTP do NOT have Lambda workers** — the compiler emits `arn:aws:states:::http:invoke` directly with an EventBridge Connection.                                                                                                                                                                                    | 1024 MB    | 20–120 s | —                                                                              | Step Functions task in compiled flow                                                                                          |
| **Static-IP variants**                                                                         | `HttpJsonStaticIpWorker`, `HttpXmlStaticIpWorker`. Required because Step Functions HTTP Tasks egress from the AWS-managed network and cannot be pinned to the on-demand EIP/NAT; partners that allow-list our static IP must therefore route via these VPC-bound Lambdas.                                                                                                                                                                                     | 1024 MB    | 120 s    | ✓ (`LambdaSg` in two private subnets so egress goes through the on-demand NAT) | Step Functions task                                                                                                           |
| **SFTP via AWS Transfer Family** (one shared poller, no SSH client in Lambda)                  | `SftpPoller` (resolves config from event → env, starts an `AWS::Transfer::Connector` directory listing, polls `DescribeDirectoryListing`, reads listing JSON from S3, dedupes paths, fans out `StartFileTransfer` with retry on throttling, returns counts + listing URI + bounded errors per `build-inbound-sftp-workflows` Phase 4)                                                                                                                         | 1024 MB    | 900 s    | —                                                                              | Step Functions task in compiled flow (`SFTP` type), EventBridge Scheduler (per-partner schedule), or manual `Invoke` for test |
| **Flow control & utility workers**                                                             | `ReplyBackWorker`, `DryRunWorker`, `GetCredentialsWorker`, `GetAuthorizationWorker`, `TokenManagementAuthWorker`, `ProgressiveWaitingWorker`, `ProcessFailStatesWorker`, `PollInvocationWorker`, `TokenManagementGetWorker`, `TokenManagementSetWorker`, `SendHealthMetricWorker`, `FakeRangeCreatorWorker`, `CleanupApigwWorker`, `CreateProxyLinkWorker`, `CreateWidgetWorker`, `WebhooksWriter` (SQS-triggered, `batchSize=10`, `reportBatchItemFailures`) | 256–512 MB | 30–120 s | —                                                                              | Mostly Step Functions tasks; `WebhooksWriter` is SQS-driven                                                                   |
| **Static-IP step workers**                                                                     | `CreateInternetGatewayWorker`, `CreatePublicSubnetWorker`, `CreateEipWorker`, `CreateNatGatewayWorker`, `CreateTwoPrivateRoutesWorker`, `ProcessEnableOrDisableErrorWorker`, `DeleteInternetGatewayWorker`, `DeletePublicSubnetWorker`, `DeleteElasticIpWorker`, `DeleteNatGatewayWorker`, `DeleteTwoPrivateRoutesWorker`, `ProcessDeletionErrorWorker`                                                                                                       | 256 MB     | 60 s     | —                                                                              | `EnableStaticIp` / `DisableStaticIp` SFN                                                                                      |
| **Operational helpers**                                                                        | `ApiUsagePlanCustomResource` (binds the API key to the usage plan), `ApiGatewayLogCustomResource` (installs the access log group), `ProxyResourceCleanupCustomResource` (purges stale `/proxy-links/`* resources on deploy), `HealthApiKeyAuthorizer` (Lambda authoriser)                                                                                                                                                                                     | 256–512 MB | 30–900 s | —                                                                              | CloudFormation custom resources / Lambda authoriser                                                                           |


#### 2.3.5 Routing fabric

- **REST API** (`RestApi` `ConnectApi`) with default stage `${stage}`, regional endpoint type, CORS pre-flight for `*`, binary media types `multipart/form-data`, and a dedicated access log group. Routes:
  - All public paths in §1.2 → `LambdaIntegration(ConnectHandler)` with `apiKeyRequired: true`.
  - `POST /vendors/{vendor_name}/flows/{flow_name}/webhook` → `LambdaIntegration(ConnectHandler)` with `apiKeyRequired: false` (partner-authenticated via the per-flow secret).
  - `POST /vendors/{vendor_name}/sftp/test-connection` → `LambdaIntegration(ConnectHandler)` with `apiKeyRequired: true`. Triggers a single `SftpPoller` listing for the partner's connector and returns `{ listingId, listingS3Uri, fileCount, sampledFiles[], errors[] }`. This is the manual invocation path required by `build-inbound-sftp-workflows` Phase 5.
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON.
  - `/proxy-links/{...}` → minted at runtime by `CreateProxyLinkWorker` (302 redirect to a partner-supplied or S3-presigned URL); torn down by `CleanupApigwWorker` at the end of the flow.
  - `GatewayResponse` rules normalise `INVALID_API_KEY`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, and `DEFAULT_4XX` per §3.1.
- **API Gateway custom domain mapping** under base path `connector-jobs` against the deployer-supplied `Subdomain` (`AWS::ApiGatewayV2::ApiMapping`).
- **Step Functions** state machines (six, all `tracingEnabled: true`):
  - `FlowCreationStateMachine` (`STANDARD`) — compile + register a runtime `STANDARD` SFN per flow.
  - `LookupCreationStateMachine` (`STANDARD`) — compile + register a runtime `EXPRESS` SFN per lookup.
  - `FlowDecoratorStateMachine` (`STANDARD`, `WAIT_FOR_FLOW_INVOCATION_SFN`) — wraps each runtime flow execution with health-metric + reply-back-error-backup post-processing.
  - `InvocationPollerStateMachine` (`STANDARD`) — optional caller-side server-side polling loop.
  - `BatchInvocationStateMachine` (`STANDARD`) — Distributed Map (`Mode: DISTRIBUTED`, `ExecutionType: STANDARD`) over a JSON-array S3 object.
  - `EnableStaticIpStateMachine` / `DisableStaticIpStateMachine` (`STANDARD`) — idempotent EIP / NAT provisioning.
  The **runtime** state machines created by `CreateRuntimeStateMachine` / `UpdateRuntimeStateMachine` are dynamic, named `<product?>-<vendor>-<flow>[-<token>]`, and use a constrained `RuntimeStateMachineRole` whose policies are: `lambda:InvokeFunction` on the residual worker ARNs (including `SftpPoller` and the static-IP HTTP workers), `sqs:SendMessage` on `WebhooksQueue`, `**states:InvokeHTTPEndpoint`** on the runtime state-machine ARN itself (constrained per §2.3.6), and `**events:RetrieveConnectionCredentials**` + the matching `secretsmanager:GetSecretValue` on the EventBridge connection-managed secret ARNs for the partners the flow targets.
- **EventBridge Connections** (`AWS::Events::Connection`, one per partner-auth-profile) hold the credential material for native Step Functions HTTP Tasks. Each connection encodes one of `BASIC` (username/password), `API_KEY` (header name + value), or `OAUTH_CLIENT_CREDENTIALS` (`AuthorizationEndpoint`, `ClientID`, `ClientSecret`, optional `HttpMethod`, optional `OAuthHttpParameters` for body/query/headers). Connection naming is deterministic: `connect-<vendor_name>[-<product_name>][-<auth_profile>]`. Connection ARNs are stored on the partner row (`eventbridge_connection_arns: Record<auth_profile, arn>`) and the compiler stamps the matching ARN onto every native HTTP Task it emits.
- **EventBridge Scheduler** group `connect-sftp-schedules` hosts one `Schedule` per SFTP partner that opted into automatic polling (`scheduleExpression` from the partner's connector config). Each schedule's target is `SftpPoller` with a static input event matching §6.7.

#### 2.3.6 IAM (high-level)

- The provider role is **never** wildcarded. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- The `ConnectHandler` role has: `dynamodb:{Get,Put,Update,Delete,Query,DescribeTable}Item` on `FlowsTable` + `TokensTable`, `kms:{Encrypt,Decrypt,GenerateDataKey,DescribeKey}` on `DataKey`, `sqs:SendMessage` on `WebhooksQueue`, `s3:{PutObject,GetObject,ListObjectsV2,ListBucket}` on `VendorsResponsesBucket`, `states:{StartExecution,DescribeExecution,GetExecutionHistory,StartSyncExecution,StopExecution,ListExecutions,ListMapRuns,DescribeMapRun,DeleteStateMachine}` on the relevant ARN prefixes, `events:{CreateConnection,UpdateConnection,DescribeConnection,DeleteConnection}` scoped to `arn:aws:events:<region>:<account>:connection/connect-*` (so the credential-management routes can mint and rotate the per-partner Connections that back native HTTP Tasks), plus `lambda:InvokeFunction` on the `SftpPoller` ARN (for `POST /vendors/{vendor_name}/sftp/test-connection`).
- The compilation pipeline workers add `states:{CreateStateMachine,UpdateStateMachine}` and `iam:PassRole` for `RuntimeStateMachineRole` only.
- The `**RuntimeStateMachineRole`** (assumed by every compiled flow / lookup state machine) holds: `lambda:InvokeFunction` on the residual worker ARNs (multipart, blob, file, static-IP HTTP, `SftpPoller`, `WidgetService`, `CreateProxyLinkWorker`, `CleanupApigwWorker`, `ReplyBackWorker`, `SendHealthMetricWorker`, the auth-helper workers, etc.); `sqs:SendMessage` on `WebhooksQueue`; `**states:InvokeHTTPEndpoint**` scoped to its own state-machine ARN with a `states:HTTPEndpoint` condition listing the partner host allow-list and a `states:HTTPMethod` condition listing the verbs the flow uses (compiler-stamped per flow); `**events:RetrieveConnectionCredentials**` scoped to the EventBridge Connection ARNs the flow references; and `secretsmanager:GetSecretValue` on the secret ARNs created by those Connections (EventBridge stores connection credentials in Secrets Manager). No wildcard HTTP egress permission is ever granted — the host allow-list is recomputed at compile time from the spec's `URL` fields.
- The `EnableStaticIp` / `DisableStaticIp` workers add the strictly-needed `ec2:`* verbs (`DescribeInternetGateways`, `CreateInternetGateway`, `AttachInternetGateway`, `CreateNatGateway`, `AllocateAddress`, etc.) scoped by tag conditions where possible.
- The `**SftpPoller`** role has the strictly-needed AWS Transfer Family verbs (per `build-inbound-sftp-workflows` Phase 3 step 4): `transfer:StartDirectoryListing`, `transfer:DescribeDirectoryListing`, `transfer:StartFileTransfer`, `transfer:DescribeConnector` (resource-scoped to `arn:aws:transfer:<region>:<account>:connector/`*), plus `s3:{GetObject,PutObject,ListBucket}` on `VendorsResponsesBucket/transfer-listings/*` and `…/sftp-inbound/*`. It does **not** read partner secrets directly — the **Transfer Family connector role** holds `secretsmanager:GetSecretValue` on the per-partner secret ARNs and `s3:{PutObject,GetObject,ListBucket}` on the same prefixes.
- Workers that emit task callbacks have `states:SendTaskSuccess` / `states:SendTaskFailure` on `*` (Step Functions does not support resource-level constraints here).
- API Gateway routes use API-key + per-route IAM where applicable; partner webhooks use the per-flow `webhook_auth.Secret` (no SOCAPITAL credential).

#### 2.3.7 SFTP via AWS Transfer Family Connectors

SFTP support follows the **listing-first connector + poller** pattern from `build-inbound-sftp-workflows`. There is **no SSH client running inside any Lambda**; every SFTP interaction goes through AWS Transfer Family.

Per SFTP partner, ConnectStack provisions (declaratively, in CDK):

1. **One `AWS::Transfer::Connector`** of type `SFTP` for each SFTP partner. The connector carries:
  - `Url: sftp://<partner-host>[:port]` (resolved at deploy from the per-partner config block).
  - `AccessRole`: a per-partner IAM role assumed by Transfer Family with `secretsmanager:GetSecretValue` on the partner's secret ARN and `s3:{PutObject,GetObject,ListBucket}` on `VendorsResponsesBucket/transfer-listings/*` + `…/sftp-inbound/*`.
  - `LoggingRole`: a CloudWatch-Logs-write role for connector access logs.
  - `SftpConfig.UserSecretId`: the partner's Secrets Manager ARN.
  - `SftpConfig.TrustedHostKeys`: SHA-256 fingerprints of the partner's expected host keys (rotated via a separate connector update; never elided to skip verification).
2. **One AWS Secrets Manager secret per partner**, keyed by the canonical contract `{ "Url": "sftp://...", "Username": "...", "Password": "..." }` (per `build-inbound-sftp-workflows` Phase 2). Private-key partners use `{ "Url": ..., "Username": ..., "PrivateKey": "..." }` (RSA / Ed25519) instead of `Password`. Secrets are encrypted with `DataKey`.
3. **The shared `SftpPoller` Lambda** (one for the whole stack, multi-partner) — see §5.6 for the runtime contract.
4. **An optional `EventBridge::Scheduler::Schedule`** per partner that opted into recurring polling. The schedule's input event matches §6.7 verbatim and includes a deterministic `runId = <partner>-<YYYY>-<MM>-<DD>-<HH>` so concurrent polls deduplicate at the listing level.
5. **One CloudWatch Logs group per connector** (`/aws/transfer/connector/<connectorId>`) with 30-day retention.

The mapping between `vendor_name` (Connect's identifier) and the Transfer Family `connectorId` lives on the partner row (`sftp_connector_id`); the per-vendor secret ARN and target prefix are also stored there. Partner-specific values (host, secret ARN, remote directory, target bucket prefix, target schedule, transfer concurrency) are **never hardcoded** in worker source — they flow through the runtime config contract in §6.7. CDK reads them from `cdk.json` context (`connect:sftp:partners`) at synth time and stamps each connector with `sc:sftp:vendor_name=<vendor>` so `SftpPoller` and the test-connection route can locate the right resources by tag.

If a partner uses SFTP **only as a flow-driven outbound integration** (push files we generate to them), the same connector definition applies; the flow's `SFTP` step targets the same `SftpPoller` with `direction: "outbound"` (see §3.5.1).

### 2.4 Configuration surface (env vars)

The runtime is configured exclusively via env vars (read once on cold start; missing required values must fail closed via `process.exit(1)` at module load). Notable keys:


| Key                                                                                 | Default                              | Used by                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `FLOW_CREATION_STATE_MACHINE_ARN`                                                   | from CDK                             | Constructor handlers, `CheckFlowCreation`                                                          |
| `LOOKUP_CREATION_STATE_MACHINE_ARN`                                                 | from CDK                             | Constructor (entity=lookups)                                                                       |
| `FLOW_DECORATOR_STATE_MACHINE_ARN` (`WAIT_FOR_FLOW_INVOCATION_SFN`)                 | from CDK                             | `StartFlowExecution`, `GetExecutionStatus`                                                         |
| `INVOCATION_POLLER_STATE_MACHINE_ARN`                                               | from CDK                             | `StartFlowExecution` (when `debug_config.poll_with` present)                                       |
| `BATCH_INVOCATION_STATE_MACHINE_ARN`                                                | from CDK                             | `StartBatchFlowExecution`, `GetBatchAggregation`, `GetVendorFlowExecutionsStatus`                  |
| `FLOWS_TABLE_NAME`                                                                  | from CDK                             | `FlowsRepository`, `PartnerConfigurationsRepository`                                               |
| `TOKENS_TABLE_NAME`                                                                 | from CDK                             | `TokensRepository`                                                                                 |
| `WEBHOOKS_QUEUE_URL`                                                                | from CDK                             | Compiled-spec compiler injects into runtime SFN; `WebhooksWriter` Lambda                           |
| `VENDORS_RESPONSES_BUCKET`                                                          | from CDK                             | Every worker that stages a response, the widget generator, the data-recovery API                   |
| `DATA_KMS_KEY_ARN`                                                                  | from CDK                             | DDB column-level encryption helpers                                                                |
| `BUILD_HASH`                                                                        | provided by deployer                 | Health-metric tagging                                                                              |
| `SERVICE_API_KEY_ID` / `HEALTH_API_KEY_ID`                                          | provided by deployer                 | API Gateway usage-plan binding + `HealthApiKeyAuthorizer`                                          |
| `CREATION_OBJECTS_KEY_PREFIX`                                                       | `_flow_or_lookup_creations/anyflow/` | Async storage of large flow / lookup definitions during compilation                                |
| `PRE_BATCHED_OBJECTS_PREFIX`                                                        | `_batch_raw_items_object_prefix/`    | Stage S3 input + output for `BatchInvocationStateMachine`                                          |
| `PROXY_LINKS_PATH`                                                                  | `proxy-links`                        | Sub-path under the API where dynamic proxy resources are minted                                    |
| `API_GW_REST_ID` / `API_GW_ROOT_RESOURCE_ID` / `API_GW_PROXY_LINKS_RESOURCE_ID`     | from CDK                             | `CreateProxyLinkWorker` and `CleanupApigwWorker` mint / tear down API Gateway resources at runtime |
| `RUNTIME_STATE_MACHINE_ROLE_ARN`                                                    | from CDK                             | `CreateRuntimeStateMachine` passes this when minting flow SFNs                                     |
| `SERVICE_NAME` / `PRODUCT_NAME`                                                     | `connect` / `Connect`                | Tags applied to dynamically-created state machines                                                 |
| `<TASK_TYPE>_LAMBDA_ARN` (≈ 30 keys, one per worker)                                | `Fn::GetAtt` of each worker          | Injected into `TransformFlowSpec` so the compiler can wire `Resource` ARNs without runtime lookups |
| `SEND_HEALTH_METRIC_FUNCTION_ARN`                                                   | Ref                                  | `StartFlowExecution`, `TransformLookupSpec`, decorator SFN                                         |
| `ENABLE_STATIC_IP_STATE_MACHINE_ARN` / `DISABLE_STATIC_IP_STATE_MACHINE_ARN`        | from CDK                             | `EnableOrDisableStaticIp` API                                                                      |
| `VPC_ID`, `PRIVATE_SUBNET_1_ID`, `PRIVATE_SUBNET_2_ID`                              | from CDK                             | Static-IP API + worker discovery                                                                   |
| `TAG_SC_`*                                                                          | static / context                     | Tag matchers used by static-IP discovery (`DescribeAddresses`, `DescribeNatGateways`)              |
| `SUBDOMAIN` (CDK context)                                                           | provided by deployer                 | API Gateway custom-domain mapping                                                                  |
| `JOB_INPUT_MAX_BYTES`                                                               | `262144` (256 KiB)                   | `serializeFlowInput` rejects oversize payloads with `413` before SFN start                         |
| `WIDGET_DEFAULT_EXPIRATION_HOURS`                                                   | `1`                                  | Widget presigned-URL TTL when the spec omits it                                                    |
| `SFTP_LISTINGS_BUCKET`                                                              | `VendorsResponsesBucket` name        | `SftpPoller` writes Transfer Family directory listings here                                        |
| `SFTP_LISTINGS_PREFIX`                                                              | `transfer-listings/`                 | Prefix root for listing artifacts; `SftpPoller` appends `<vendor>/<YYYY>/<MM>/<DD>/<listingId>`    |
| `SFTP_INBOUND_PREFIX`                                                               | `sftp-inbound/`                      | Prefix root for transferred files; `SftpPoller` appends `<vendor>/<YYYY>/<MM>/<DD>/<remote-path>`  |
| `SFTP_DEFAULT_TRANSFER_CONCURRENCY`                                                 | `5`                                  | Per-listing fan-out cap when `transfer_concurrency` is omitted from the event                      |
| `SFTP_LISTING_POLL_INTERVAL_MS`                                                     | `2000`                               | `DescribeDirectoryListing` poll cadence                                                            |
| `SFTP_LISTING_MAX_WAIT_MS`                                                          | `300000` (5 min)                     | Hard timeout for listing completion → returns `SftpListingTimeout`                                 |
| `SFTP_TRANSFER_RETRY_MAX_ATTEMPTS`                                                  | `4`                                  | `StartFileTransfer` retries on `ThrottlingException` / 5xx                                         |
| `SFTP_POLLER_LAMBDA_ARN`                                                            | from CDK                             | Wired into `RuntimeStateMachineRole` and into the test-connection route handler                    |
| `EVENTBRIDGE_CONNECTION_NAME_PREFIX`                                                | `connect-`                           | Prefix for the `AWS::Events::Connection` names that back native Step Functions HTTP Tasks          |
| `EVENTBRIDGE_CONNECTION_ARN_SSM_PREFIX`                                             | `/connect/eventbridge-connections/`  | SSM Parameter Store prefix that maps `<vendor_name>[/<auth_profile>]` → connection ARN             |
| `RUNTIME_HTTP_TASK_DEFAULT_TIMEOUT_SECONDS`                                         | `60`                                 | Default `Timeout` the compiler injects on every native `arn:aws:states:::http:invoke` Task         |
| `RUNTIME_HTTP_TASK_MAX_RESPONSE_BYTES`                                              | `262144` (256 KiB)                   | Triggers automatic SFN-Task `OutputPath` rewrite to S3-store-then-reference for oversize bodies    |
| `POWERTOOLS_SERVICE_NAME` / `POWERTOOLS_LOG_LEVEL` / `POWERTOOLS_METRICS_NAMESPACE` | `connect-`* / `INFO` / `connect`     | Logging + metrics                                                                                  |


### 2.5 Library / dependency policy

The implementation is **TypeScript-only** and consumes only the libraries listed below (per `stack-typescript-for-apis`):

- `aws-cdk-lib` v2.170+, `constructs`, `aws-cdk` for IaC.
- `@aws-sdk/client-{dynamodb,s3,sfn,sqs,apigateway,ec2,kms,lambda,ssm,sts,transfer,secrets-manager,scheduler,eventbridge}` and `@aws-sdk/credential-providers` for AWS calls. `@aws-sdk/client-eventbridge` is the **only** path for creating, updating, or deleting the `AWS::Events::Connection` resources that back native Step Functions HTTP Tasks; the runtime never calls EventBridge — Step Functions resolves the connection's credentials automatically when executing `arn:aws:states:::http:invoke`.
- `@aws-sdk/lib-dynamodb` for typed DynamoDB document mappings.
- `@aws-lambda-powertools/{logger,tracer,metrics,parameters}` for observability and SSM parameter caching.
- `aws4` for SigV4-signed cross-service HTTPS calls (e.g. `pullCredentials` → Customer Account Manager).
- `zod` for **all** request/response/spec schemas (no `marshmallow`, `jsonschema`, `joi`, `ajv`).
- `undici` for outbound HTTP (or native `fetch` in Node 24); never `axios` or `node-fetch`.
- `fast-xml-parser` for XML transport (XML → JSON parse, JSON → XML serialise).
- `csv-parse` / `csv-stringify` if the batch path needs CSV input/output.
- `vitest` + `@vitest/coverage-v8` for tests.
- `aws-states-language-validator` (or the AWS-published `@aws-sdk/client-stepfunctions::validateStateMachineDefinition` API) for the `ValidateAslDefinition` Lambda.
- **No SSH client.** `ssh2`, `ssh2-sftp-client`, `node-ssh`, and any other in-process SSH/SFTP library are **forbidden** — every SFTP interaction goes through `@aws-sdk/client-transfer` against an AWS Transfer Family connector (per `build-inbound-sftp-workflows`).
- **No in-process code sandbox.** `vm2`, `isolated-vm`, dynamic `eval`, and Node's `node:vm` are **forbidden** in production code paths.
- **LLM use** (e.g. AI-assisted spec authoring or natural-language-to-flow translation, if added) **MUST** route through the **[Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) with strict TypeScript and Zod tool schemas** — direct `openai`, `@anthropic-ai/sdk`, or `@aws-sdk/client-bedrock-runtime` usage is forbidden (per `stack-ai-sdk-for-llm`).
- **Python is forbidden** anywhere in this repository. (PySpark/Glue is the only carve-out in the org, and Connect ships no PySpark/Glue jobs.)

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses share a uniform shape. Success bodies are route-specific (see §4); errors follow:

```json
{ "ok": false, "error": { "type": "FlowSpecValidationError", "message": "…", "details": { "issues": [ { "path": "/definition/States/Foo", "message": "…" } ] } } }
```

Async submissions return `202 Accepted` and one of `creation_id`, `job_id`, or `batch_execution_id`. Synchronous lookups return `200 OK` with `response_payload`. `204 No Content` is used for deletes.

Every non-mock response always carries `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` and `x-sc-trace-id` (per-request UUID propagated downstream into logs and partner headers).

API Gateway-level errors are normalised by configured `GatewayResponse` rules:

- `INVALID_API_KEY` → `{ "url": "https://api.staircase.co/get-started#root", "message": "This key is not valid for this service." }`
- `BAD_REQUEST_BODY` → `{ "message": $context.error.messageString, "error": $context.error.validationErrorString }`
- `BAD_REQUEST_PARAMETERS` → `{ "message": $context.error.messageString }`
- `DEFAULT_4XX` → `{ "message": "Request has been declined." }`

### 3.2 Partner (`vendor`) entity

Stored on `FlowsTable`. Required fields:


| Field                | Type                    | Notes                                                                                                                                   |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor_name`        | string (1..100)         | URL-safe partner identifier; required, unique with `product_name`.                                                                      |
| `product_name`       | string (optional)       | Sub-namespace under a partner.                                                                                                          |
| `company_id`         | string (1..100)         | Optional tenant grouping.                                                                                                               |
| `credentials`        | `Record<string,string>` | Static credentials surfaced as `$vendor_credentials.<key>` **only inside the `Authorization` step**. Encrypted at rest under `DataKey`. |
| `passed_credentials` | `Record<string,string>` | Credentials surfaced as `$.passed_credentials.<key>` inside any flow `Task`. Encrypted at rest.                                         |


`POST /vendors` returns `201 Created` and echoes the request body. `409 Conflict` is returned on `ConditionalCheckFailedException`. `PATCH /vendors/{vendor_name}` permits only `company_id` updates.

### 3.3 Partner connectivity configuration (PCC)

Tenant-scoped overrides of partner credentials. Created via `POST /vendors/{vendor_name}/configurations` with body `{ partner_configuration_id, partner_configuration: { partner_configuration: {...overrides...} } }`. Listed via `GET /…/configurations` with cursor pagination (`page.next_token`). Deleted via `DELETE /…/configurations/{partner_configuration_id}` (204 / 404).

PCCs are referenced at execution time via `partner_configuration.partner_configuration_id` in the job body; if the ID is unknown for the partner, the execution returns `404`.

### 3.4 Authorization model (flow spec)

The flow spec declares **how** to authorise outbound partner calls. Three credential-source modes and three auth modes are supported:


| `authorization.credentials` | Meaning                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `preset`                    | Use the partner's stored credentials (`$vendor_credentials`) — the compiler injects an `AddCredentialsToAuthorization` step. |
| `static`                    | Use values inlined in the spec.                                                                                              |
| `dynamic`                   | Resolve from a JSON-path inside the runtime payload.                                                                         |



| `authorization.mode` | Injected step                                             | Behaviour                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass_through`       | `AddPassThroughAuthorization` only                        | Constant credentials forwarded with every request.                                                                                                                         |
| `call_api`           | `AddCallApiAuthorization` → `AddPassThroughAuthorization` | Fetches a fresh token from a designated endpoint just before the flow runs. The compiler synthesises an `Authorization` step whose `Resource` is `GetAuthorizationWorker`. |
| `token_management`   | `AddCallTokenManagement` → `AddPassThroughAuthorization`  | Reuses the central token registry (`TokensRepository`) to keep a token valid across executions — `TokenManagementAuthWorker` performs the refresh.                         |


Any other combination → the compilation state machine routes to `FailState`.

### 3.5 Flow specification

Authored via `POST /vendors/{vendor_name}/flows` with body validated by `flowCreateSchema` (Zod). The runtime spec carries:


| Section                                            | Notes                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow_name` (or `lookup_name`)                     | URL-safe identifier; must be unique per partner (and product).                                                                                                                                                            |
| `version`, `delivery_settings`, `configuration_id` | Free-form metadata stored on the flow row.                                                                                                                                                                                |
| `dry_run`                                          | Optional. When set, the compiler injects `AddDryRun` which short-circuits the flow with a partner-supplied mocked response (URL or inlined).                                                                              |
| `authorization`                                    | See §3.4.                                                                                                                                                                                                                 |
| `definition`                                       | An ASL-shaped object whose `States[*]` follow the dialect described in §3.5.1 — `ResourceDefinition.Type` selects the worker. The compiler rewrites every `Type=Task` state into a real Step Functions Lambda invocation. |
| `contains_widget`, `widget_expiration_hours`       | Toggle to mint a presigned widget HTML upload at execution time (default `WIDGET_DEFAULT_EXPIRATION_HOURS=1`).                                                                                                            |
| `delivery_settings`                                | Reserved for downstream replay rules.                                                                                                                                                                                     |


#### 3.5.1 Allowed task types (compiler dispatch)

The compiler (`lambda/services/flow-compiler/transformation.ts`) supports the following `ResourceDefinition.Type` values. Per §2.0 principle 2, **HTTP-shaped task types compile to a native Step Functions HTTP Task** (`arn:aws:states:::http:invoke`) bound to an EventBridge `Connection` — no Lambda hop. Non-HTTP task types and the residual HTTP cases that the native integration cannot express end-to-end (multipart, blob streaming, raw binary file download, static-IP-bound egress) map to a worker Lambda whose ARN is read from env vars:


| Type                                                      | Worker                                                                                                                                                                                                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP_JSON`                                               | **Native SFN HTTP Task** (`arn:aws:states:::http:invoke`) bound to the partner's EventBridge `Connection`; `Method`, `ApiEndpoint`, `Headers`, `QueryParameters`, `RequestBody` resolved per §5.8                              | Generic JSON HTTP call. Step Functions handles auth (via the Connection), TLS, retries (`Retry`), and JSON response parsing without a Lambda hop.                                                                                                                                                                                                                                                                                                                                         |
| `HTTP_JSON_WITH_EIP`                                      | `HttpJsonStaticIpWorker` (Lambda, VPC-bound)                                                                                                                                                                                   | Static-IP carve-out: partners that allow-list our NAT'd EIP must traverse a VPC-bound Lambda because native HTTP Tasks egress from the AWS-managed network and cannot be pinned to the on-demand NAT.                                                                                                                                                                                                                                                                                     |
| `HTTP_XML`                                                | **Native SFN HTTP Task** (`Content-Type: application/xml`); response XML parsed by a follow-on `Pass`/`Choice` chain or by an `XmlConverter` Lambda for envelope rewrites                                                      | Generic XML HTTP call. Step Functions issues the request; the compiler emits a tiny follow-on step only when XPath-style extraction is required.                                                                                                                                                                                                                                                                                                                                          |
| `HTTP_XML_WITH_EIP`                                       | `HttpXmlStaticIpWorker` (Lambda, VPC-bound)                                                                                                                                                                                    | Static-IP variant of `HTTP_XML`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `HTTP_ANY`                                                | **Native SFN HTTP Task** (transport-agnostic; `Content-Type` from spec)                                                                                                                                                        | Generic HTTP call when neither JSON nor XML semantics apply.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`        | **Native SFN HTTP Task** with the verb stamped by the compiler                                                                                                                                                                 | Verb-specialised JSON convenience tasks. Identical to `HTTP_JSON` with `Method` fixed.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET_XML`, `POST_XML`, `DELETE_XML`                       | **Native SFN HTTP Task** with the verb stamped by the compiler                                                                                                                                                                 | Verb-specialised XML tasks.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST_BASE64`                                             | **Native SFN HTTP Task** preceded by a `Pass` that runs `States.Base64Encode(...)` on the payload                                                                                                                              | Partners that require base64-encoded payloads. No Lambda needed — the encoding happens inside Step Functions.                                                                                                                                                                                                                                                                                                                                                                             |
| `POST_FORM_URL_ENCODED`                                   | **Native SFN HTTP Task** with `Content-Type: application/x-www-form-urlencoded`; preceding `Pass` serialises `RequestPayload` via `States.Format(...)` for primitives, or via a tiny `FormEncodeWorker` Lambda for nested maps | Form-encoded payload partners. Lambda fallback only when the payload requires nested-key flattening.                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST_MULTIPART`, `PUT_MULTIPART`                         | `Post/PutMultipartWorker` (Lambda)                                                                                                                                                                                             | Multipart upload from spec or from a presigned source. **Lambda required** — native HTTP Tasks do not support `multipart/form-data` body construction.                                                                                                                                                                                                                                                                                                                                    |
| `POST_BLOB`, `PUT_BLOB`                                   | `Post/PutBlobWorker` (Lambda)                                                                                                                                                                                                  | Form-data variants accepting a single file via `blob_url` (streamed via `undici` `Readable.from(response.body)`). **Lambda required** — streamed binary upload is not expressible in a native HTTP Task.                                                                                                                                                                                                                                                                                  |
| `GET_FILE`                                                | `GetFileWorker` (Lambda)                                                                                                                                                                                                       | Stream a partner file → S3 → mint a presigned URL. **Lambda required** — large binary download must be staged in S3 to fit under the 256 KB SFN-output limit.                                                                                                                                                                                                                                                                                                                             |
| `SFTP`                                                    | `SftpPoller` (AWS Transfer Family)                                                                                                                                                                                             | Listing-first ingress / egress over an `AWS::Transfer::Connector`. The compiler turns a `SFTP` task into a sync `LambdaInvoke` of `SftpPoller` with `{ vendor_name, connector_id, remote_directory, target_bucket, target_prefix, transfer_concurrency, direction }` (per §6.7). The worker calls `StartDirectoryListing`, polls `DescribeDirectoryListing`, reads the listing JSON from S3, dedupes file paths, fans out `StartFileTransfer`. **No in-process SSH client is permitted.** |
| `WAIT_FOR_TASK_TOKEN` (auto-injected by webhook)          | (Step Functions native)                                                                                                                                                                                                        | The compiler converts a `WebhookReference` step to `arn:aws:states:::sqs:sendMessage.waitForTaskToken` and stores `request_id_expected_path`, `webhook_response_mapping`, `webhook_conditions`, `webhook_auth`, optional `non_blocking` & `processing_order` metadata on the flow row.                                                                                                                                                                                                    |
| `WIDGET`                                                  | `CreateWidgetWorker`                                                                                                                                                                                                           | Mints a partner widget HTML with the supplied template + render mapping; output goes into `vendors-responses-…/widgets/...`.                                                                                                                                                                                                                                                                                                                                                              |
| `LINK_TRANSFORMATION`                                     | `CreateProxyLinkWorker` (and `CleanupApigwWorker`)                                                                                                                                                                             | Mints a `/proxy-links/<name>` API Gateway resource at runtime that 302s to the chosen URL; cleaned up at flow end.                                                                                                                                                                                                                                                                                                                                                                        |
| `PROGRESSIVE_WAITING`                                     | `ProgressiveWaitingWorker`                                                                                                                                                                                                     | Polling loop with linear or exponential backoff (`MaxAttempts`, `BackoffRate` or `ExponentialBackoffRate`, `IntervalSeconds`). Default `IntervalSeconds=5, MaxAttempts=15, BackoffRate=10`.                                                                                                                                                                                                                                                                                               |
| `TOKEN_MANAGEMENT_GET` / `TOKEN_MANAGEMENT_SET`           | `TokenManagementGetWorker`, `TokenManagementSetWorker`                                                                                                                                                                         | Read/write the central token store from inside a flow.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FAKE_RANGE_CREATOR`                                      | `FakeRangeCreatorWorker`                                                                                                                                                                                                       | Helper used when fanning out over a counter range without an external data source.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Native ASL types: `Wait`, `Choice`, `Pass`, `Map`, `Fail` | (no worker)                                                                                                                                                                                                                    | The compiler keeps native states intact. `Fail` states are rewritten to invoke `ProcessFailStatesWorker` so the failure cause is recorded, then routed to the `ReplyBackError` handler.                                                                                                                                                                                                                                                                                                   |


The compiler additionally rewrites every leaf "happy" state to flow into a synthesised `ReplyBack` task (and every wildcard catch into a synthesised `ReplyBackError`), so the compiled state machine always finishes with a callback to `job_callback_url`. When `LINK_TRANSFORMATION` is used the cleanup step is wired in automatically.

When the compiler emits a native HTTP Task it also: (a) resolves the partner's EventBridge `Connection` ARN from `connection_arn_for(vendor_name, auth_profile)`; (b) renders the `URL` template (`{path_param}` placeholders + `QueryParameters`) into a static `ApiEndpoint.$` JSONata expression so Step Functions performs the substitution at runtime; (c) translates the spec's `Retry` / `Catch` rules into native ASL retries (for example `States.Http.StatusCode.5XX`, `States.Http.SocketTimeoutError`); (d) injects a `Timeout` of `RUNTIME_HTTP_TASK_DEFAULT_TIMEOUT_SECONDS` unless the spec overrides; and (e) rewrites the result into a `Pass` that stages the body to S3 (`vendors-responses-…/<job_id>/<state>.json`) when `SaveResponseToFile=true` or when the response exceeds `RUNTIME_HTTP_TASK_MAX_RESPONSE_BYTES`, replacing the inline body with an S3 presigned URL on the downstream context.

#### 3.5.2 Flow specification — typed contract

The full Zod-derived TypeScript contract for the create-flow body. The same shape (with `lookup_name` instead of `flow_name`) is used by the lookup constructor.

```ts
type FlowCreateRequest = {
  flow_name: string;                          // URL-safe; unique per (vendor, product?)
  product_name?: string;
  version?: string;
  configuration_id?: string;
  delivery_settings?: { default_callback_url?: string; retry_policy?: "none" | "default" };
  contains_widget?: boolean;
  widget_expiration_hours?: number;           // default 1
  dry_run?: { mocked_response_url?: string; mocked_response_body?: unknown };
  authorization: AuthorizationSpec;
  definition: FlowSpecDefinition;
};

type AuthorizationSpec =
  | { credentials: "preset"  | "static" | "dynamic"; mode: "pass_through";
      header_name: string; scheme: "basic" | "bearer" | "api_key"; }
  | { credentials: "preset"  | "static" | "dynamic"; mode: "call_api";
      header_name: string; scheme: "bearer" | "api_key";
      call_api: { url: string; method: "GET" | "POST"; headers?: Record<string, string>;
                  request_payload?: unknown; path_to_token: string; }; }
  | { credentials: "preset"  | "static" | "dynamic"; mode: "token_management";
      header_name: string; scheme: "bearer" | "api_key";
      token_management: { name: string }; };

type FlowSpecDefinition = {
  StartAt: string;
  States: Record<string, FlowSpecState>;
};

type FlowSpecState =
  | TaskState
  | { Type: "Pass";   Result?: unknown; ResultPath?: string; Next?: string; End?: true }
  | { Type: "Wait";   Seconds?: number; SecondsPath?: string; Next: string }
  | { Type: "Choice"; Choices: ChoiceRule[]; Default?: string }
  | { Type: "Map";    ItemsPath: string; Iterator: FlowSpecDefinition; ResultPath?: string; Next?: string; End?: true }
  | { Type: "Fail";   Cause?: string; CausePath?: string };

type TaskState = {
  Type: "Task";
  ResourceDefinition: ResourceDefinition;
  ResultPath?: string;                        // JSONPath where the worker output lands
  OutputPath?: string;
  Next?: string;
  End?: true;
  Retry?: RetryRule[];
  Catch?: CatchRule[];
};

// One discriminated union per Type in §3.5.1 — representative variants below; the rest follow the same pattern.

type ResourceDefinition =
  | HttpJsonResource | HttpXmlResource | HttpAnyResource
  | GetFileResource | PostMultipartResource | PostBlobResource
  | PostBase64Resource | PostFormUrlEncodedResource
  | SftpResource
  | WidgetResource | LinkTransformationResource
  | ProgressiveWaitingResource
  | TokenManagementGetResource | TokenManagementSetResource
  | FakeRangeCreatorResource
  | WebhookReferenceResource;

type HttpJsonResource = {
  Type: "HTTP_JSON" | "HTTP_JSON_WITH_EIP";
  URL: string;                                // may contain `{path_param_name}` placeholders
  Method: "GET" | "POST" | "PUT" | "DELETE";
  PathParameters?: Record<string, string>;    // key = name in URL, value = JSONPath into context
  QueryParameters?: Record<string, string>;   // value = JSONPath
  RequestPayload?: unknown | string;          // literal object or "$.path.into.context"
  AdditionalHeaders?: Record<string, string>;
  IgnoreResponseStatus?: boolean;             // when true, non-2xx still hands the body downstream
  RaiseErrorWithDotStatus?: boolean;          // emits CallVendorError.<status> for fine-grained retries
  SaveOutputTo?: string;                      // JSONPath where parsed JSON lands in flow context
  SaveResponseToFile?: boolean;               // persist raw response in S3, hand back a presigned URL
  ContentType?: "application/json" | "application/x-www-form-urlencoded";
};

type SftpResource = {
  Type: "SFTP";
  Direction: "inbound" | "outbound";
  RemoteDirectory: string;                    // or "$.path" to resolve at runtime
  TargetBucket?: string;                      // defaults to SFTP_LISTINGS_BUCKET
  TargetPrefix?: string;                      // appended under sftp-inbound/<vendor>/<YYYY>/<MM>/<DD>/
  TransferConcurrency?: number;               // 1..50
  SendPaths?: string[];                       // outbound only
  SaveOutputTo?: string;                      // JSONPath where SftpPollerResponse lands
};

type WebhookReferenceResource = {
  Type: "WEBHOOK_REFERENCE";
  WebhookReference: { ValuePath: string; ExpectedPath: string };
  WebhookAuthentication?: { HeaderName: string; Secret: string };
  WebhookConditions?: Array<{ ValuePath: string; ExpectedValues: unknown[] }>;
  WebhookConditionsMatchAll?: boolean;        // default false → OR semantics
  WebhookResponseMapping?: Record<
    "Unauthorized" | "ConditionsMismatch" | "NoRunningFlow" | "NoReferenceFound"
    | "InvocationExpired" | "InvocationTimeout" | "CannotContinue" | "CorruptState",
    { StatusCode: number }
  >;
  NonBlockingConfiguration?: { ProcessingOrder: "FIFO" | "LIFO" };
  SaveResponseToFile?: boolean;
  SaveOutputTo?: string;                      // defaults to "$.webhook_data"
};

type ProgressiveWaitingResource = {
  Type: "PROGRESSIVE_WAITING";
  WaitingConditions?: {
    IntervalSeconds: number;
    MaxAttempts: number;
    BackoffRate?: number;                     // linear backoff multiplier
    ExponentialBackoffRate?: number;          // mutually exclusive with BackoffRate
  };
};

type RetryRule  = { ErrorEquals: string[]; IntervalSeconds: number; MaxAttempts: number; BackoffRate?: number };
type CatchRule  = { ErrorEquals: string[]; Next: string; ResultPath?: string };
type ChoiceRule = { Variable: string; StringEquals?: string; NumericEquals?: number;
                    BooleanEquals?: boolean; IsPresent?: boolean; Next: string };
```

The compiler reads this object, performs the rewrites listed in §5.1, and registers a Step Functions state machine whose states have the canonical AWS shape (`Task` → `arn:aws:states:::lambda:invoke` against the worker ARN, `WAIT_FOR_TASK_TOKEN` for webhook steps, etc.).

### 3.6 Lookup specification

A *lookup* is structurally a flow but compiled as `STATE_MACHINE_TYPE=EXPRESS` and intended for synchronous request/response. Same compilation pipeline (`LookupCreationStateMachine`), same task types, but the runtime handler invokes the SFN with `start_sync_execution` and returns the response inline (`200 OK` with `{ transaction_id, response_payload }` on success, `400`/`502`/`422` mapped from the SFN's typed errors).

### 3.7 Webhook reference

When a flow contains a webhook step the compiler stores per-step metadata on the flow row (`webhooks_info[]`):

```json
{
  "request_id_expected_path": "$.webhook.request_id",
  "non_blocking": false,
  "processing_order": "FIFO",
  "save_webhook_to_file": false,
  "webhook_response_mapping": { "ConditionsMismatch": { "StatusCode": 200 } },
  "webhook_conditions": [ { "ValuePath": "$.status", "ExpectedValues": ["ok"] } ],
  "webhook_conditions_match_all": false,
  "webhook_auth": { "HeaderName": "X-Partner-Sig", "Secret": "…" }
}
```

The runtime `processWebhook` route iterates `webhooks_info[]` until one matches, validates the auth secret, evaluates conditions (`AND`/`OR` via `webhook_conditions_match_all`), looks up the pending DDB row, and either resolves the task token (via `SendTaskSuccess`) or returns the configured custom error status (mapped through the `WebhookErrorCode` enum in §6.1).

XML-content webhooks are converted to JSON via `fast-xml-parser` before condition matching. If `save_webhook_to_file` is set, the original payload (JSON or XML) is staged in S3 and the task token receives a presigned URL instead of inlined data.

### 3.8 Error catalogue → HTTP status

The HTTP layer is the authoritative tag-to-status mapper. Each error is a structured object with a discriminator (`type` / `_tag`), a `message`, and an optional `details` object. Tags map to:


| HTTP    | Tag(s)                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400     | `BadRequest`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, `ZodValidationError`, `IncorrectStringParametersError`, `IncorrectPathParametersError`, `FlowSpecValidationError`, `InvalidRequestPayloadError`, `InvalidNextToken`, `NoRequestIdFoundInPayload`, `RequestIdNotFoundNoPendingFlow` |
| 401/403 | `Unauthorized` (webhook auth), API-Gateway `INVALID_API_KEY`                                                                                                                                                                                                                                   |
| 404     | `VendorNotFound`, `FlowNotFound`, `LookupNotFound`, `ConfigurationNotFound`, `ExecutionNotFound`, `TokenNotFound`, `SftpConnectorNotConfigured`                                                                                                                                                |
| 409     | `VendorAlreadyExists`, `FlowAlreadyExists`, `LookupAlreadyExists`, `TokenNameAlreadyExists`, `PartnerConfigurationAlreadyExists`, `RequestIdAlreadyProcessed`                                                                                                                                  |
| 413     | `JobInputTooLarge` (mirrors Step Functions `States.DataLimitExceeded`)                                                                                                                                                                                                                         |
| 422     | `CannotContinueFlowTimeout`, `CannotContinueFlowExpired`, `CannotContinueFlowCorruptState`, `CannotContinueFlowBase`, `AccountManagerUnavailable`, `SftpListingTimeout`                                                                                                                        |
| 429     | `ThrottlingException` (Step Functions, AWS APIs) → `TooManyRequests`                                                                                                                                                                                                                           |
| 500     | `UnexpectedResourceState` (static-IP), `InternalServerError` (uncategorised SFN failure)                                                                                                                                                                                                       |
| 502     | `CallVendorError` (partner returned a non-2xx) — body carries `transaction_id`, `error`, `cause`                                                                                                                                                                                               |
| 503     | `S3StoreError`, `SqsEnqueueError`, `DynamoDbError`, `StepFunctionsTransientError`, `SftpTransferError` (after `SFTP_TRANSFER_RETRY_MAX_ATTEMPTS` retries)                                                                                                                                      |


Error mappings for the webhook surface are additionally configurable per flow via `webhook_response_mapping` (see §3.7); the resolution table lives in `lambda/services/webhooks/error-codes.ts`.

---

## 4. Synchronous APIs

All public routes are mounted under the API Gateway base path `/connector-jobs/`. The single `ConnectHandler` Lambda hosts a thin `lambda/http/router.ts` that dispatches by `httpMethod` + `resource` to the per-route service. Each route is wrapped in a shared decorator that (a) binds a per-request structured logger keyed by `x-sc-trace-id`, (b) parses the body (or rejects via a Zod-driven `BadRequest`), (c) emits a CloudWatch Logs JSON record on entry/exit, and (d) maps unhandled exceptions to `500 InternalServerError`.

### 4.1 Partners (`/vendors`)

- `POST /vendors` — body validated by `vendorCreateSchema`; persists `vendor_name + product_name` (unique). 201/409/400.
- `GET /vendors` — paginated, sortable (`sort=asc|desc`, `after_name=<name>`), returns `{ count, _links: { next, previous }, vendors[] }`.
- `GET /vendors/{vendor_name}?product_name=…` — single partner.
- `PATCH /vendors/{vendor_name}` — currently `company_id` only.
- `DELETE /vendors/{vendor_name}` — cascades through `FlowsRepository.deleteVendor` (404 if missing).

### 4.2 Partner credentials (`/vendors/{vendor_name}/credentials`, `…/passed-credentials`)

- `PUT` replaces the whole map; `PATCH` merges per key. Body = `{ items: { key: value, … } }`. The handler resolves `credentials` vs `passed_credentials` from the resource path's last segment.
- `**PUT` / `PATCH` on `credentials` also synchronises the partner's EventBridge `Connection` resources** so native Step Functions HTTP Tasks (§5.8) can authenticate without code. The handler interprets well-known credential shapes — `{ basic: { username, password } }` → `BASIC` connection, `{ api_key: { header_name, value } }` → `API_KEY` connection, `{ oauth: { authorization_endpoint, client_id, client_secret, http_method?, oauth_http_parameters? } }` → `OAUTH_CLIENT_CREDENTIALS` connection — and idempotently creates / updates `connect-<vendor_name>[-<product_name>][-<auth_profile>]`. The connection ARN map is persisted on the partner row (`eventbridge_connection_arns`); deleting a credential bucket deletes the matching connection.
- `GET /vendors/{vendor_name}/information` — returns `{ vendor_name, product_name?, credentials: { credentials: bool, "passed-credentials": bool }, eventbridge_connections: Record<auth_profile, { connection_arn, authorization_type, status }> }` (presence-only; never the values).
- `PATCH /vendors/{vendor_name}/pulled-credentials` — synchronously SigV4-fetches credentials (via `aws4`) from the upstream `customer-account-manager/retrieve-credentials` endpoint and merges them in (`type=passed_credentials` rows route into `passed_credentials`, all other rows into `credentials`). The same EventBridge Connection sync described above runs after the merge. 422 on Account Manager failure.

### 4.3 Partner connectivity configurations (`/vendors/{vendor_name}/configurations[/{partner_configuration_id}]`)

- `POST` — create. 201 with `{ partner_configuration_id }` (server-generated if absent). 404 if vendor missing. 409 on duplicate.
- `GET` — list with `next_token`/`limit` pagination. 400 on invalid `next_token` (`InvalidNextToken`).
- `DELETE …/{partner_configuration_id}` — 204/404.

### 4.4 Flow / Lookup constructor (`/vendors/{vendor_name}/{entity}`)

`entity ∈ flows | lookups` (see `ALLOWED_ENTITIES` in §6.2). For brevity the table below uses `*` where the two entities differ only in target SFN type:


| Verb     | Path                                     | Behaviour                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/flow/schema?schema_type=create_flow    | update_flow                                                                                                                                                                                                                                                 |
| `POST`   | `/vendors/{vendor_name}/{entity}`        | Validates the spec, generates `creation_id`, stores the raw definition under `_flow_or_lookup_creations/anyflow/<creation_id>.json`, starts the entity-specific compilation SFN with `name=creation_id`. 202 `{ creation_id, creation_status: "Started" }`. |
| `PUT`    | `/vendors/{vendor_name}/{entity}/{name}` | Same pipeline, `_final_action=UPDATE` if the entity exists else `CREATE`.                                                                                                                                                                                   |
| `GET`    | `/vendors/{vendor_name}/{entity}`        | List flows/lookups for the partner.                                                                                                                                                                                                                         |
| `GET`    | `/vendors/{vendor_name}/{entity}/{name}` | Single flow/lookup.                                                                                                                                                                                                                                         |
| `DELETE` | `/vendors/{vendor_name}/{entity}/{name}` | Deletes the runtime SFN (`DeleteStateMachine`) **before** wiping the DDB row. 204.                                                                                                                                                                          |
| `GET`    | `/{entity}/creations/{creation_id}`      | Tails the compilation SFN execution. 404 on `ExecutionDoesNotExist`. 200 `{ status, error?, cause? }` on found; 429 on throttling.                                                                                                                          |


### 4.5 Job execution (`POST /vendors/{vendor_name}/flows/{flow_name}/jobs`)

For `entity=flows`:

- Validate body via `flowInvokeSchema` (Zod).
- Validate `partner_configuration.partner_configuration_id` against `PartnerConfigurationsRepository` (404 if missing).
- Mint `job_id = randomUUID()`.
- Build the canonical async-flow input via `collectCommonAsyncFlowInput(...)` — captures `transaction_id`, `request_payload`, `request_collection_id`, `response_collection_id`, `dry_run` overrides, `callback_url`, the partner's `state_machine_name`, an internal `__internal.execution_start`, `__internal.x_sc_trace_id`, and `__internal.arn_sfn` (the compiled state machine ARN).
- If `contains_widget`, mint a presigned widget HTML upload (default expiration `WIDGET_DEFAULT_EXPIRATION_HOURS`) and inject `widget_url` + `widget_template_name` + (optional) `__internal.widget_render_ack_url` into the payload.
- `serializeFlowInput(...)` checks the size: any payload ≥ `JOB_INPUT_MAX_BYTES` (256 KiB) is rejected with `413 JobInputTooLarge` before the SFN start (it would otherwise fail with `States.DataLimitExceeded`).
- `sfn.send(new StartExecutionCommand({ stateMachineArn: FLOW_DECORATOR_STATE_MACHINE_ARN, name: job_id, input: ... }))` — the decorator SFN then invokes the per-flow SFN with `arn:…states:startExecution.sync:2` and runs the parallel post-processing branch (health metric + reply-back error backup).
- Optional `debug_config.poll_with` triggers a side execution of `InvocationPollerStateMachine` (`name=<job_id>-side-poller`) for callers that want server-side polling.
- Response: `202` `{ job_id, job_status: "Started", widget_url? }`.
- Emits CloudWatch metrics `jobs_started` (Count, `dimensions={vendor_name, flow_name}`) and `job_input_bytes` (Bytes), buffered through Powertools and flushed in `finally`.

For `entity=lookups`: invokes the EXPRESS state machine via `StartSyncExecutionCommand`, then returns `{ transaction_id, response_payload }` (or 400/502/422 mapped from the SFN error envelope through `representations.parseStateRuntime` and `_error_result`/`_ok_result` decoding).

### 4.6 Batch execution (`POST /vendors/{vendor_name}/flows/{flow_name}/batch-executions`)

- Body: `{ batch_input: { data_source: "s3://…" }, batch_configuration: { maximum_concurrency, maximum_items_per_batch }, … }`.
- Mint `batch_execution_id = randomUUID()`.
- `BatchInputPreparer.getStateMachineInput(...)` materialises a JSON-array S3 object that the Distributed Map will iterate over. Output goes under `<PRE_BATCHED_OBJECTS_PREFIX>output/`.
- `sfn.send(new StartExecutionCommand({ stateMachineArn: BATCH_INVOCATION_STATE_MACHINE_ARN, name: batch_execution_id, input: serialized_payload }))` triggers the batch SFN. Each map iteration: `wrapContext → composeCanonicalInput → invokeStepFunction (sync:2) → PostProcessing (SendMetric ‖ DecideIfNeedsBackupReply → ReplyBackErrorBackup)`. Map run results are aggregated by `BatchPostProcessor`.
- Response `202` `{ batch_execution_id, batch_execution_status: "Started" }`.

### 4.7 Batch aggregation (`GET /batch-executions/{batch_execution_id}/aggregation`)

- Calls `DescribeExecutionCommand`, `ListMapRunsCommand({maxResults: 1})`, then `DescribeMapRunCommand`.
- Returns `{ batch_execution_status, batch_execution_id, batch_execution_items_aggregation: { pending, running, succeeded, failed, timed_out, aborted, total }, batch_execution_executions_aggregation: {...same…} }`. Adds an `error: { error, cause }` block when the SFN status ∈ `{ABORTED, FAILED, TIMED_OUT}`.
- 404 on `ExecutionDoesNotExist` / `ValidationException` / missing map run.

### 4.8 Job status & history

- `GET /vendors/{vendor_name}/flows/{flow_name}/jobs/{job_id}` (`?detailed=…&next_token=…&reverse_order=…&max_results=…`). Tails `DescribeExecutionCommand` + `GetExecutionHistoryCommand`. Detailed mode includes per-state `input_details.request_payload` and `output_details.response_payload` (sanitised through `representations.flowExecutionHistoryErrorCauseNormalizer`). Always returns `executed_events`, `last_event`, `details`, plus an `input` block (`transaction_id`, collection IDs, `callback_url`) and `output` block (`response_payload`, `extraction_errors`). When the request comes from an authoriser context with `disableDataDisplay=true`, `detailed` is forced to `false`, `callback_url` is stripped from `input`, and `output` is emptied. 404 falls back to `tryStatusCorrectionFromInvoker(job_id)` so an in-progress decorator execution still returns `IN_PROGRESS`.
- `GET /vendors/{vendor_name}/flows/{flow_name}/executions` — `ListExecutionsCommand` over the runtime SFN (or the map-run when `batch_execution_id` is supplied). Supports `next_token`, `status_filter`, `max_results` (Zod-validated). 400 on invalid `next_token`.
- `POST /vendors/{vendor_name}/flows/{flow_name}/jobs/{job_id}` — `StopExecutionCommand`. 201 `{ job_id, status: "ABORTED", stop_date }`. 404 on `ExecutionDoesNotExist`.

### 4.9 Webhooks (`POST /vendors/{vendor_name}/flows/{flow_name}/webhook`)

- Partner-authenticated via per-flow `webhook_auth.HeaderName`/`Secret`; the API key is **not** required.
- Iterates `flow.webhooks_info[]`:
  1. Verify auth. On mismatch → `Unauthorized` (status code resolved via `webhook_response_mapping["Unauthorized"]`).
  2. Convert to JSON if the content type is `application/xml`/`text/xml` (via `fast-xml-parser`).
  3. Resolve `request_id_expected_path` via JSONPath; on miss → `NoRequestIdFoundInPayload`.
  4. Look up the pending request row (`getRequest(request_id)` for blocking webhooks, `getUnusedNonBlockingRequest(request_id, processing_order)` for non-blocking).
  5. Evaluate `webhook_conditions[]` honouring `webhook_conditions_match_all` (defaults to OR).
- On success: write the payload to S3 if `save_webhook_to_file`, then `SendTaskSuccessCommand({ taskToken, output })`. Mark non-blocking rows inactive via `markNonBlockingRequestInactive(request)`.
- Always emits a `code-health-checker/metrics` POST (silent best-effort) with `transaction_id`, `webhook_request_id`, status, invocation code, elapsed seconds, configuration ID, build hash, and `x-sc-trace-id`.
- The response always carries `X-Sc-Origin-Trace-Id` from the original request when known.

### 4.10 Response recovery (`POST /response-url-recovery`)

- Body: `{ job_id, expiration?: int seconds default 3600, next_token? }`. Lists up to 100 keys under `<job_id>/` from `VendorsResponsesBucket` and returns presigned `GET` URLs (`@aws-sdk/s3-request-presigner`). Pagination via `ContinuationToken`.

### 4.11 Tokens (`/tokens/{token_name}`)

- `POST` create with `{ token_value, extra? }`. 201/409/400.
- `GET` returns `{ token_name, token_value, extra }`.
- `PATCH` updates `token_value` and optional `extra`. 404 on missing.
- `DELETE` removes; 404 on missing.

### 4.12 Static IP (`/network/ip`)

- `GET` returns `{ ip, resource_status: { elastic_ip: ALLOCATED|DEALLOCATED_OR_NEVER_EXISTED, network_translator: ENABLED|ENABLING_PENDING|DISABLING_PENDING|DISABLED_OR_NEVER_CREATED } }`. Returns `500 UnexpectedResourceState` if more than one EIP or NAT exists with the matching tag set.
- `POST /network/ip` — kicks off `EnableStaticIpStateMachine` (idempotent through tag matchers). 202.
- `DELETE /network/ip` — kicks off `DisableStaticIpStateMachine`. 202.

### 4.13 SFTP test connection (`POST /vendors/{vendor_name}/sftp/test-connection`)

- Body (Zod-validated, all optional except `remote_directory` if the partner config doesn't carry a default): `{ remote_directory?: string, transfer_concurrency?: number, dry_run?: boolean }`. `dry_run: true` means **list only** — no `StartFileTransfer` is issued, only `StartDirectoryListing`.
- The handler resolves `sftp_connector_id`, default `target_bucket`, default `target_prefix`, and default `remote_directory` from the partner row in `FlowsTable`. 404 `SftpConnectorNotConfigured` if the partner has no SFTP connector.
- Synchronously invokes `SftpPoller` with the `runId = "test-<creation_id>"` and `direction: "inbound"`. Returns `200 OK` with `{ listingId, listingS3Uri, fileCount, sampledFiles[], transferIds[], errors[] }`.
- This route is the manual invocation path required by `build-inbound-sftp-workflows` Phase 5; no recurring schedule is started by it.

### 4.14 Internal helpers

- `GET /information` — API Gateway MOCK integration that returns the deployer-supplied `ServiceInfo` JSON (200, with CORS headers).
- `proxy-links/{...}` — dynamically created at runtime by `CreateProxyLinkWorker`; each maps a vanity path to a redirect to a partner-supplied or S3-presigned URL. `CleanupApigwWorker` removes them after the flow ends. `ProxyResourceCleanupCustomResource` purges leftover resources on every deploy.

### 4.15 Service composition / dependency wiring

Each route scopes its own dependency container so that a config error in an unrelated route cannot break this one. The composition groups are:

- **Partners router** depends on: `FlowsRepository`, `vendorCreateSchema`, `vendorUpdateSchema`, KMS encryption helpers.
- **Credentials router** depends on: `FlowsRepository`, `aws4` SigV4 helper, the upstream Account Manager client.
- **Configurations router** depends on: `PartnerConfigurationsRepository`.
- **Constructor router** depends on: `FlowsRepository`, `flowCreateSchema`, `flowUpdateSchema`, `lookupCreateSchema`, `lookupUpdateSchema`, `S3CreationStore`, `SfnClient`.
- **Jobs router** depends on: `FlowsRepository`, `PartnerConfigurationsRepository`, `WidgetService`, `SfnClient`, `MetricsBuffer`.
- **Batch router** depends on: `FlowsRepository`, `BatchInputPreparer`, `S3Client`, `SfnClient`.
- **Webhooks router** depends on: `FlowsRepository`, `WebhookConditionEvaluator`, `XmlConverter`, `SfnClient` (for `SendTaskSuccess`), `HealthMetricClient`.
- **Tokens router** depends on: `TokensRepository`.
- **Static-IP router** depends on: the EC2 client + the two enable/disable SFN ARNs.
- **SFTP router** depends on: `FlowsRepository` (to resolve the partner's `sftp_connector_id`), `LambdaClient` (for invoking `SftpPoller`), and the bounded `SftpTestConnectionRequest` schema.

Containers are constructed **once per Lambda warm container**, not per request, so caches (e.g. SSM-backed config) survive across invocations.

---

## 5. Asynchronous Pipelines

### 5.1 Flow / Lookup compilation pipeline

State machines: `FlowCreationStateMachine` and `LookupCreationStateMachine` (STANDARD type).

```
TransformFlowSpec        (Lambda: TransformFlowSpec / TransformLookupSpec)
   │  reads $._flow_or_lookup_creations/anyflow/<creation_id>.json definition
   │  rewrites every state per §3.5.1
   ↓
CredentialsChoice (Choice)
   ├── preset    → AddCredentialsToAuthorization → AuthorizationChoice
   ├── dynamic   → AuthorizationChoice
   └── static    → AuthorizationChoice
AuthorizationChoice (Choice)
   ├── pass_through      → AddPassThroughAuthorization → DryRunChoice
   ├── token_management  → AddCallTokenManagement     → AddPassThroughAuthorization → DryRunChoice
   └── call_api          → AddCallApiAuthorization    → AddPassThroughAuthorization → DryRunChoice
DryRunChoice (Choice)
   ├── dry_run absent  → ValidateAslDefinition (Lookup pipeline goes straight to CreateOrUpdateChoice)
   └── dry_run present → AddDryRun                  → ValidateAslDefinition
ValidateAslDefinition    (Lambda: TS, calls @aws-sdk/client-stepfunctions::validateStateMachineDefinition)
   ↓
CreateOrUpdateChoice (Choice)
   ├── _final_action == CREATE  → CreateRuntimeStateMachine
   └── _final_action == UPDATE  → UpdateRuntimeStateMachine
SaveFlow                 (Lambda: persists the flow row + `state_machine_name` + `webhooks_info[]`)
```

Common rules:

- All Lambda tasks have `Retry on Lambda.TooManyRequestsException` (`IntervalSeconds=2, MaxAttempts=8, BackoffRate=2`) and `Catch: States.ALL → FailState (ResultPath: $.error)`.
- `FailState` is a terminal `Type: Fail`; the API surface (`GET /{entity}/creations/{creation_id}`) extracts the `error`/`cause` from the matching `*FailedEventDetails` event (see `FAILED_EVENT_TYPES` in `lambda/services/sfn/failed-event-types.ts`).
- The compiler **rewrites `Fail` states** in user input to invoke `ProcessFailStatesWorker`, then routes to `ReplyBackError`, so any partner-side error path always closes the loop with a callback POST.
- The compiler reads the compiled definition from S3 (large definitions stored under `_flow_or_lookup_creations/anyflow/<creation_id>.json`) to dodge the 256-KB Step-Functions input limit.
- `CreateRuntimeStateMachine` calls `CreateStateMachineCommand` with the constrained `RuntimeStateMachineRole` (`role.assumedBy=states.amazonaws.com`, policies = `lambda:InvokeFunction` on each worker ARN + `sqs:SendMessage` on `WebhooksQueue`).

### 5.2 Runtime flow execution (decorator `FlowDecoratorStateMachine`)

```
invokeStepFunction       (states:startExecution.sync:2 → $.['__internal.arn_sfn'])
   ├── Retry 10× on StepFunctions.ExecutionLimitExceeded
   └── Catch States.ALL → PostProcessing (with $.error)
PostProcessing           (Parallel)
   ├── SendMetric        (Lambda: SendHealthMetricWorker — pushes flow-completion metric to code-health-checker)
   └── ReplyBackErrorBackup (Lambda: ReplyBackWorker)
```

`ReplyBackWorker` is the cross-cutting integration callback. It can run as the natural last step of a successful flow (called from inside the runtime SFN as `ReplyBack`) or as a backup after a `States.Runtime` / `States.DataLimitExceeded` error (called from this branch). It POSTs to the caller-supplied `callback_url` with:

```json
{
  "webhook_type": "flow_completion",
  "job_id": "...",
  "job_status": "Completed|Failed",
  "transaction_id": "...",
  "request_collection_id": "...",
  "response_collection_id": "...",
  "response_payload": { "...": "..." },
  "status_code": 200
}
```

Headers always include `x-api-key` (the original caller's) and `X-Sc-Trace-Id`. Any non-2xx callback raises `CallProductError` and is retried up to 9 times (with `_WatcherThrottled` back-pressure honoured for `ThrottlingException`).

### 5.3 Server-side polling (`InvocationPollerStateMachine`)

```
PollTask (Lambda: PollInvocationWorker)
RetryPollOrStop (Choice on $.keep_polling)
   ├── true → Waiter (SecondsPath: $.polling_interval) → PollTask
   └── false → Done (Pass → end)
```

The polling interval defaults to 30 s. `PollInvocationWorker` describes the underlying execution and toggles `keep_polling=false` on terminal status.

### 5.4 Batch execution (`BatchInvocationStateMachine`)

```
distributeBatch          (Distributed Map)
   ItemReader: s3:getObject ($.control.data_bucket / $.control.data_key, JSON)
   ItemBatcher: $.control.batch_max_len items × $.control.batch_max_bytes bytes per batch
   MaxConcurrencyPath: $.control.max_concurrency
   ToleratedFailurePercentage: 100 (failures bubble through map_run_error)
   ResultWriter: s3:putObject ($.control.data_bucket / $.control.data_output_key_prefix)
   ItemProcessor (DISTRIBUTED, STANDARD):
      wrapContext → composeCanonicalInput → invokeStepFunction (sync:2) → PostProcessing
postProcessMapRun        (Lambda: BatchPostProcessor, OutputPath: $.map_run_ok)
   on failure → postProcessMapRunError (Type: Fail, error: Connect.PostProcessingFailure)
```

Per-item retries match the decorator (`StepFunctions.ExecutionLimitExceeded` 10×, then `States.ALL` catch routes the failure into `ReplyBackErrorBackup`). The map run rolls per-item outputs to S3; `BatchPostProcessor` validates the aggregate state (`pending`, `running`, `succeeded`, `failed`, `timedOut`, `aborted`) and exposes them via `GET /batch-executions/{batch_execution_id}/aggregation`.

### 5.5 Webhook ingress (`WAIT_FOR_TASK_TOKEN`)

The compiled flow embeds a `Task` whose `Resource` is `arn:aws:states:::sqs:sendMessage.waitForTaskToken`. Parameters:

```
QueueUrl: <WebhooksQueue URL>
MessageBody:
  request_id.$         : <ValuePath from spec>
  task_token.$         : $$.Task.Token
  transaction_id.$     : $.transaction_id
  response_collection_id.$ : $.response_collection_id
  job_id.$             : $.job_id
  x_sc_trace_id.$      : $.x_sc_trace_id
  non_blocking         : true|false
```

The `WebhooksWriter` SQS Lambda persists the row keyed by `request_id` so `processWebhook` can find and resolve it. Non-blocking webhooks store under `processing_order` so identical `request_id`s arriving concurrently can be matched in FIFO/LIFO order.

### 5.6 SFTP listing-and-transfer (`SftpPoller`)

`SftpPoller` implements the listing-first runtime described in `build-inbound-sftp-workflows` Phase 4. It is invoked synchronously by:

1. The compiled flow's `SFTP` step (`Resource: arn:aws:states:::lambda:invoke` against `SftpPoller` ARN, with `Payload` matching §6.7).
2. An EventBridge Scheduler `Schedule` (per partner that opted into recurring polling).
3. The `POST /vendors/{vendor_name}/sftp/test-connection` route (manual, dry-run-friendly).

Runtime sequence (single invocation, no SSH client in process):

```
SftpPoller(input)
  1. resolve config: event > env defaults > deny if missing required values
     ({ vendor_name, connector_id, remote_directory, target_bucket, target_prefix?,
        transfer_concurrency=SFTP_DEFAULT_TRANSFER_CONCURRENCY,
        direction="inbound"|"outbound",
        runId })
  2. compute deterministic listing key:
       <SFTP_LISTINGS_PREFIX><vendor_name>/<YYYY>/<MM>/<DD>/<runId>/listing.json
  3. transfer.send(StartDirectoryListingCommand({
       ConnectorId,
       RemoteDirectoryPath: remote_directory,
       OutputDirectoryPath: `s3://${SFTP_LISTINGS_BUCKET}/<derived listing prefix>`,
     }))
  4. poll DescribeDirectoryListing every SFTP_LISTING_POLL_INTERVAL_MS
     until status ∈ {COMPLETED, FAILED} or elapsed > SFTP_LISTING_MAX_WAIT_MS
       → on timeout: return SftpListingTimeout (HTTP 422 if surfaced via API)
       → on FAILED: return SftpTransferError with bounded cause + listingId
  5. s3.send(GetObjectCommand({ Bucket, Key: listingKey })) → parse JSON listing
     defensively (tolerate missing fields, treat empty as "0 files")
  6. dedupe file paths (by full remote path), sort lexicographically
  7. for each surviving path, in batches of `transfer_concurrency`:
       transfer.send(StartFileTransferCommand({
         ConnectorId,
         RetrieveFilePaths: [remotePath],     // direction=inbound
         // or SendFilePaths: [...] for direction=outbound
         LocalDirectoryPath: `/${SFTP_INBOUND_PREFIX}<vendor>/<YYYY>/<MM>/<DD>/`,
       }))
       retry on ThrottlingException / 5xx up to SFTP_TRANSFER_RETRY_MAX_ATTEMPTS
       with full-jitter exponential backoff
  8. return {
       listingId, listingS3Uri, fileCount, sampledFiles[],
       transferIds[], errors: TruncatedErrorList
     }
```

Outputs are deterministic and machine-readable: every listing artifact lands at the dated path above, every transferred file lands at `s3://<target_bucket>/<SFTP_INBOUND_PREFIX><vendor>/<YYYY>/<MM>/<DD>/<remote-path>` (basename preserved), and the response shape is constant across success/partial-failure (errors are bounded to the first 25 entries to keep the payload under the 256 KB SFN-output limit). Per-partner concurrency caps and remote-directory paths are **never hardcoded** in this Lambda — they always flow through the event or the per-partner env defaults from §2.4.

### 5.7 Static-IP provisioning (`EnableStaticIpStateMachine` / `DisableStaticIpStateMachine`)

`EnableStaticIp` runs:

```
CreateInternetGateway → CreatePublicSubnet → AllocateAddress → CreateNatGateway (with extra retry on WaitSignalIfNatIsNotYetCreated, up to ~85 min) → CreateTwoPrivateRoutes
```

with a single `Catch → ProcessAndReportFailure → ExecutionFailedTerminator (Type: Fail)` for any state. `DisableStaticIp` mirrors the operations in reverse. Both are idempotent (each step inspects the existing tagged resource set first via the `aws-sdk` EC2 client). The two static-IP Lambdas (`HttpJsonStaticIpWorker`, `HttpXmlStaticIpWorker`) live in the `app` subnets so their egress always goes through the configured NAT.

### 5.8 Native Step Functions HTTP Tasks (default outbound transport)

Per §2.0 principle 2 and §3.5.1, every plain HTTP task type compiles to an `arn:aws:states:::http:invoke` Task — Step Functions itself opens the TLS connection, applies authorisation from the bound EventBridge `Connection`, sends the request, and parses the response. There is no Lambda hop on the hot path.

Compiled shape (canonical):

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::http:invoke",
  "Arguments": {
    "ApiEndpoint.$": "<resolved URL with PathParameters substituted>",
    "Method": "<GET|POST|PUT|DELETE>",
    "Authentication": {
      "ConnectionArn": "<arn of arn:aws:events:<region>:<account>:connection/connect-<vendor>[-<auth_profile>]>"
    },
    "Headers": {
      "Content-Type": "<application/json | application/xml | application/x-www-form-urlencoded | …>",
      "X-Sc-Trace-Id.$": "$.x_sc_trace_id"
    },
    "QueryParameters.$": "<spec-resolved object or omitted>",
    "RequestBody.$": "<spec-resolved JSON|string|States.Base64Encode(...) expression>",
    "Transform": { "RequestBodyEncoding": "NONE" }
  },
  "Retry": [
    { "ErrorEquals": ["States.Http.StatusCode.429"],            "IntervalSeconds": 2,  "MaxAttempts": 5, "BackoffRate": 2 },
    { "ErrorEquals": ["States.Http.StatusCode.5XX",
                       "States.Http.SocketTimeoutError",
                       "States.Http.ConnectionError"],          "IntervalSeconds": 2,  "MaxAttempts": 4, "BackoffRate": 2 }
  ],
  "Catch": [
    { "ErrorEquals": ["States.Http.StatusCode.4XX"], "Next": "ReplyBackError", "ResultPath": "$.error" },
    { "ErrorEquals": ["States.ALL"],                  "Next": "ReplyBackError", "ResultPath": "$.error" }
  ],
  "ResultPath": "<spec-resolved (e.g. $.pull)>",
  "TimeoutSeconds": 60
}
```

Behaviour the compiler enforces:

- **EventBridge `Connection` binding is mandatory.** Compile-time: the partner row is read; if no connection ARN exists for the requested `auth_profile`, compilation fails with `400 FlowSpecValidationError: missing EventBridge connection for vendor=<vendor>, auth_profile=<profile>`. The connection material (`API_KEY`, `BASIC`, `OAUTH_CLIENT_CREDENTIALS`) is configured by the credentials routes in §4.2 — the runtime never reads it directly.
- **OAuth2 token rotation is delegated to EventBridge.** When a connection's `AuthorizationType` is `OAUTH_CLIENT_CREDENTIALS`, EventBridge handles the token fetch and refresh; the central token registry (`TokensTable`) is reserved for partners that do not fit the EventBridge OAuth2 model (e.g. proprietary token responses, multi-step exchanges).
- **Retry classification uses native ASL error names.** `States.Http.StatusCode.<code>`, `States.Http.StatusCode.4XX`, `States.Http.StatusCode.5XX`, `States.Http.SocketTimeoutError`, `States.Http.ConnectionError`, `States.Http.RetryableConnectionFailure`. The compiler turns the spec's `IgnoreResponseStatus`, `RaiseErrorWithDotStatus`, and `Retry` rules into the matching ASL retries; nothing is implemented in code.
- **Response staging.** When `SaveResponseToFile=true` or the response body would exceed `RUNTIME_HTTP_TASK_MAX_RESPONSE_BYTES` (256 KiB by default), the compiler appends a `Pass` that writes the body to `vendors-responses-<…>/<job_id>/<state_name>.json` via the SDK integration `arn:aws:states:::aws-sdk:s3:putObject`, then replaces `$.response_payload` with `{ ok: true, response_url: "<presigned>" }` so the downstream chain never carries the inline body.
- **Tracing.** The compiler always injects `X-Sc-Trace-Id.$ = $.x_sc_trace_id` and `X-Sc-Job-Id.$ = $.job_id` into `Headers` so partner-side logs correlate with our trace ID.
- **Allow-listed hosts only.** The `RuntimeStateMachineRole` policy's `states:HTTPEndpoint` condition stamps the host allow-list at compile time from the spec's `URL` fields. A flow that tries to call a host outside its declared allow-list fails the IAM check at execution time, not at compile time, which catches dynamic-URL exfiltration attempts.
- **Static-IP exception.** When the spec sets `Type: HTTP_JSON_WITH_EIP` / `HTTP_XML_WITH_EIP`, the compiler emits a `lambda:invoke` against `HttpJsonStaticIpWorker` / `HttpXmlStaticIpWorker` instead — native HTTP Tasks cannot be pinned to the on-demand NAT EIP.

This pattern keeps the runtime surface area small: the **only** Lambdas in the request hot path are the residual cases (`POST_MULTIPART`, `PUT_MULTIPART`, `POST_BLOB`, `PUT_BLOB`, `GET_FILE`, the static-IP HTTP workers, and `SftpPoller`). Everything else — branching, looping, retry, HTTP, S3 staging, SQS task tokens, sub-state-machine invocation — is native ASL.

---

## 6. Internal Data Schemas

### 6.1 Webhook error codes → invocation codes

```
NoRequestIdFoundInPayload         → 4000
Unauthorized                       → 4001
ConditionsMismatch                 → 4003
RequestIdNotFoundNoPendingFlow     → 4004
RequestIdAlreadyProcessed          → 4009
CannotContinueFlowBase             → 4022
CannotContinueFlowTimeout          → 4022
CannotContinueFlowExpired          → 4022
CannotContinueFlowCorruptState     → 4022
(default)                          → 5000
```

Each code has a default HTTP status and a per-flow override slot inside `webhook_response_mapping`.

### 6.2 Allowed entities (constructor)

```ts
const ALLOWED_ENTITIES = {
  flows:   { plural: "flows",   singular: "flow",   nameField: "flow_name",   stateMachineType: "STANDARD" },
  lookups: { plural: "lookups", singular: "lookup", nameField: "lookup_name", stateMachineType: "EXPRESS"  },
} as const;
```

The two share the same compilation pipeline; only the destination state-machine type and the synchronous-vs-asynchronous invocation pattern differ.

### 6.3 Async flow input (decorator SFN payload)

```ts
type AsyncFlowInput = {
  job_id: string;                       // uuid
  api_key: string;                      // forwarded from x-api-key
  transaction_id?: string;
  request_host: string;
  request_path: string;
  vendor_name: string;
  product_name?: string;
  flow_name: string;
  state_machine_name: string;           // <product?>-<vendor>-<flow>[-<token>]
  request_collection_id?: string;
  response_collection_id?: string;
  request_payload: unknown;
  origin_request_payload: unknown;
  callback_url: string;
  partner_configuration?: { partner_configuration_id: string };
  dry_run: boolean;
  widget_url?: string;
  widget_template_name?: string;
  "__internal.arn_sfn": string;         // arn:aws:states:::stateMachine:<dynamic>
  "__internal.execution_start": string; // ISO8601 UTC
  "__internal.x_sc_trace_id": string;
  "__internal.widget_render_ack_url"?: string;
  "__internal.is_batch"?: true;         // batch path only
};
```

### 6.4 Webhook reference row (DDB)

```ts
type WebhookReferenceRow = {
  pk: `REQUEST#${string}`;              // request_id
  sk: string;                           // random suffix
  task_token: string;
  transaction_id: string;
  job_id: string;
  response_collection_id?: string;
  x_sc_trace_id?: string;
  non_blocking: boolean;
  processing_order?: "FIFO" | "LIFO";
  inactive?: true;                      // set by markNonBlockingRequestInactive
  ttlEpochSeconds?: number;             // TTL cleanup of long-pending rows
};
```

### 6.5 Flow row (DDB)

```ts
type FlowRow = {
  pk: `VENDOR#${string}` | `VENDOR#${string}#${string}`;
  sk: `FLOW#${string}` | "VENDOR";       // "VENDOR" sk holds the partner-level row
  type: "FLOW" | "VENDOR";
  vendor_name: string;
  product_name?: string;
  flow_name?: string;                    // FLOW rows only
  configuration_id?: string;
  state_machine_name?: string;
  state_machine_type?: "STANDARD" | "EXPRESS";
  contains_widget?: boolean;
  widget_expiration_hours?: number;
  webhooks_info?: WebhookInfo[];
  definition?: FlowSpecDefinition;       // user-authored spec
  delivery_settings?: unknown;
  version?: string;
  // SFTP fields live on the VENDOR row (sk: "VENDOR"):
  sftp_connector_id?: string;            // AWS::Transfer::Connector connectorId
  sftp_secret_arn?: string;              // Secrets Manager ARN holding Url/Username/Password
  sftp_default_remote_directory?: string;
  sftp_default_target_prefix?: string;
  sftp_schedule_expression?: string;     // EventBridge Scheduler expression (optional)
  // EventBridge Connection ARNs that back native Step Functions HTTP Tasks (§5.8) live on the VENDOR row:
  eventbridge_connection_arns?: Record<
    string,                              // auth_profile, e.g. "default", "oauth", "basic"
    {
      connection_arn: string;            // arn:aws:events:<region>:<acct>:connection/connect-<vendor>[-<profile>]
      authorization_type: "BASIC" | "API_KEY" | "OAUTH_CLIENT_CREDENTIALS";
      status: "AUTHORIZED" | "AUTHORIZING" | "DEAUTHORIZED" | "AUTHORIZATION_ERROR";
    }
  >;
};
```

`gsi1` (`type / vendor_name`) supports list-by-vendor; `gsi2` (`gsi2pk`) supports cross-cutting lookups (e.g. `state_machine_name → flow row`).

### 6.6 Token row (DDB)

```ts
type TokenRow = {
  pk: `TOKEN#${string}`;                // token_name
  sk: "v0";
  token_name: string;
  token_value: string;                  // KMS-encrypted; never logged
  extra?: Record<string, unknown>;
};
```

### 6.7 SFTP poller request / response (`SftpPoller`)

```ts
type SftpPollerRequest = {
  vendor_name: string;                   // resolves connector_id via FlowsRepository when absent
  connector_id?: string;                 // AWS::Transfer::Connector connectorId; overrides vendor lookup
  remote_directory: string;              // "/inbox" or partner-specific path
  target_bucket?: string;                // defaults to SFTP_LISTINGS_BUCKET
  target_prefix?: string;                // appended to SFTP_INBOUND_PREFIX/<vendor>/<YYYY>/<MM>/<DD>/
  transfer_concurrency?: number;         // 1..50, defaults to SFTP_DEFAULT_TRANSFER_CONCURRENCY
  direction?: "inbound" | "outbound";    // defaults to "inbound"
  send_paths?: string[];                 // required when direction="outbound"
  dry_run?: boolean;                     // list-only, no StartFileTransfer
  runId: string;                         // deterministic id; idempotency / log correlation
  x_sc_trace_id?: string;
};

type SftpPollerResponse =
  | {
      ok: true;
      listingId: string;
      listingS3Uri: `s3://${string}`;
      fileCount: number;
      sampledFiles: string[];            // first 25 deduped paths, for log/UI sampling
      transferIds: string[];             // empty when dry_run=true
      errors: Array<{
        path: string;
        type: "SftpTransferError" | "ThrottlingException";
        message: string;
        attempts: number;
      }>;                                 // bounded to 25 entries
    }
  | {
      ok: false;
      error: {
        type: "SftpListingTimeout" | "SftpTransferError" | "SftpConnectorNotConfigured";
        listingId?: string;
        listingS3Uri?: `s3://${string}`;
        message: string;
      };
    };
```

The shape is deliberately a strict superset of what `build-inbound-sftp-workflows` Phase 4 step 10 calls "machine-readable results with counts, transfer IDs, listing location, and bounded errors." The `errors` array is **always bounded** so the response stays under the 256 KB Step Functions output limit even on a large failed listing.

---

## 7. Cross-cutting Concerns

### 7.1 Authentication & API-key hygiene

- All public mutating routes are API-key-gated — API Gateway enforces the `x-api-key` header, and the deployer's `ApiUsagePlanCustomResource` binds the supplied `SERVICE_API_KEY_ID` to a per-subdomain usage plan. `INVALID_API_KEY` returns the canonical `{"url": ".../get-started", "message": "This key is not valid for this service."}` payload.
- Webhooks bypass the SOCAPITAL API key and rely on the partner's `webhook_auth.Secret` for authentication. The router still surfaces `event.requestContext.identity.apiKey` (the originating product's API key) so health metrics keep their attribution.
- `HealthApiKeyAuthorizer` is a separate Lambda authoriser that accepts **either** the service API key **or** the upstream `HEALTH_API_KEY_ID` — used by intra-platform health endpoints.
- Secrets (API keys, partner credentials, tokens) are **never** logged. The Powertools `Logger` is wrapped with a `redactPaths(['credentials', 'passed_credentials', 'token_value', 'api_key', 'x-api-key', 'webhook_auth.Secret'])` middleware enforced in unit tests (per `cloud-aws-primary` non-negotiable #5).

### 7.2 Tracing & logging

- Each request gets an `x-sc-trace-id` (UUID) emitted in response headers and recorded in every CloudWatch log entry. The shared `withRequestContext()` middleware (`lambda/http/request-context.ts`) binds it on entry; outbound vendor callers (`callVendorApi`) and the reply-back POST forward `X-Sc-Trace-Id` so downstream systems can correlate.
- **Powertools Tracer** (X-Ray) is enabled on every Lambda — `tracer.captureLambdaHandler(handler)` and `tracer.captureAWSv3Client(...)` for every AWS SDK client.
- **Powertools Logger** is JSON-only (`POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once, appends a request-scoped key (`creation_id`, `job_id`, `batch_execution_id`, `request_id`, `task_token`, `vendor_name`, `flow_name`), and resets the keys in `finally`.
- **Powertools Metrics** are emitted with namespace `connect`. Buffered counters: `jobs_started`, `jobs_completed`, `jobs_failed`, `webhooks_received`, `webhooks_resolved`, `partner_call_errors`, `sftp_listings_started`, `sftp_listings_completed`, `sftp_listings_timed_out`, `sftp_files_transferred`, `sftp_transfer_errors`, with dimensions `{vendor_name, flow_name, status}` (and `direction ∈ inbound|outbound` for SFTP counters). The buffer is flushed in the API handler's `finally` block and in every SQS-driven worker's `finally` block. **Every metric MUST be registered in [Lexicon](https://github.com/Spring-Oaks-Capital-LLC/lexicon)'s `cloudwatch-metrics.json` and surfaced on the [Main Dashboard](https://github.com/Spring-Oaks-Capital-LLC/main-dashboard) before merge** (per `observability-metrics`).

### 7.3 Retry classification

A shared classifier (`lambda/utils/retry.ts`) inspects the lower-cased error name + message and returns `{ retriable, shouldReconnect, retryClass }`:


| Scope                          | Classification                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilation SFN tasks          | Lambda-side: `Lambda.TooManyRequestsException` (8 attempts × 2 backoff). Catch all: route to `FailState`.                                                                                                                                                                                                                                                                                                 |
| Runtime decorator              | `StepFunctions.ExecutionLimitExceeded` (10 attempts, linear). Otherwise capture `States.ALL` and run the post-processing branch with `$.error` populated.                                                                                                                                                                                                                                                 |
| Reply-back / metric branch     | Retries on `Lambda.{ServiceException,AWSLambdaException,SdkClientException,TooManyRequestsException,Unknown}`, `Extension.Crash`, `_WatcherThrottled`, `HTTPError`, `ConnectionError`, `CallProductError` (latter only on reply-back). 10 attempts, 2 s base × 1.5 backoff.                                                                                                                               |
| Static-IP provisioning         | Per-step retries on Lambda errors; `WaitSignalIfNatIsNotYetCreated` is retried 10× exponentially (worst case ≈85 min).                                                                                                                                                                                                                                                                                    |
| Vendor outbound calls          | Caller-controlled. The `callVendorApi` helper raises `CallVendorError` on non-2xx and stamps `partner_status_code_for_health_report` for the health pipeline.                                                                                                                                                                                                                                             |
| AWS SDK calls (DDB/S3/SFN/SQS) | The `@smithy/standard-retry-strategy` is configured with `maxAttempts=4` and full-jitter exponential backoff.                                                                                                                                                                                                                                                                                             |
| SFTP listing + transfer        | `DescribeDirectoryListing` polled every `SFTP_LISTING_POLL_INTERVAL_MS` until terminal or `SFTP_LISTING_MAX_WAIT_MS` (returns `SftpListingTimeout`). `StartFileTransfer` retries `ThrottlingException` / 5xx up to `SFTP_TRANSFER_RETRY_MAX_ATTEMPTS` with full-jitter exponential backoff. Permanent partner-side errors surface as bounded entries in `errors[]` rather than failing the whole listing. |


### 7.4 Connection management

- All AWS SDK clients are **module-level singletons** (`lambda/aws/clients.ts`) so cold starts pay the connection cost only once.
- **Outbound partner HTTP is issued by Step Functions itself**, not by Lambda. Native HTTP Tasks (`arn:aws:states:::http:invoke`, §5.8) handle TLS, connection reuse inside the AWS-managed network, and authentication (via the bound EventBridge `Connection`). Lambdas no longer hold the partner credentials; only EventBridge does.
- For the residual Lambda HTTP workers (multipart, blob, file streaming, static-IP-bound), outbound HTTP uses `**undici`** with a process-wide `Agent` (`new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 })`). For SigV4-signed cross-service calls, `aws4` signs the headers before they hit `undici`.
- Multipart variants stream a remote `blob_url` via the response `Readable` so they fit in the worker's 1 GB memory.
- **SFTP egress is not direct.** No worker opens an outbound SSH socket; every SFTP byte travels via `@aws-sdk/client-transfer` against an `AWS::Transfer::Connector`. This keeps long-lived TCP/SSH sessions out of Lambda and lets AWS handle host-key trust and credential rotation.

### 7.5 Data-size safeguards

- `serializeFlowInput` rejects payloads ≥ `JOB_INPUT_MAX_BYTES` (256 KiB) with `413 JobInputTooLarge` before they reach Step Functions.
- The runtime `ReplyBackWorker` separately translates `States.DataLimitExceeded` and `States.Runtime` into the canonical `Connect.DataLimitExceeded` / `Connect.Runtime` errors with structured `errorMessage`, JSONPath context, and originating state.
- Async creation objects (flow / lookup definitions) are stored on S3 to bypass the 256 KB SFN input limit during compilation; the compilation lambdas read them by `creation_id`.

### 7.6 Resource hygiene & isolation boundaries

- **No in-process code sandbox.** Connect does not host arbitrary user-supplied code; nothing in the Lambda fleet imports `node:vm`, `vm2`, `isolated-vm`, or `eval`-style primitives.
- **No in-process SSH client.** SFTP traffic is mediated by AWS Transfer Family connectors (§2.3.7, §5.6); the partner's host-key trust, credential storage (Secrets Manager), and connection lifecycle are AWS's responsibility, not ours.
- **Per-partner secret isolation.** Each SFTP partner has its own Secrets Manager entry; the Transfer Family connector role is the only principal allowed to read it. `SftpPoller` itself never holds `secretsmanager:GetSecretValue` and therefore cannot exfiltrate credentials even on a buggy code path.
- **Proxy-link resource hygiene.** The dynamically minted proxy-link API resources (`/proxy-links/...`) are scoped to the build instance ID and purged on every deploy by `ProxyResourceCleanupCustomResource` to prevent leaks.
- **Webhook secrets** (`webhook_auth.Secret`) and **partner credentials** are encrypted at rest under `DataKey` and redacted on the way out by the Powertools `Logger` middleware (§7.1).

### 7.7 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double. The shape is intentionally framework-light so it can be reproduced in any DI style (constructor injection, factory functions, or a runtime container):

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Complex services (`FlowsRepository`, `PartnerConfigurationsRepository`, `TokensRepository`, `FlowCompiler`, `WebhookConditionEvaluator`, `BatchInputPreparer`, `WidgetService`, `ProxyLinkManager`, `SftpConnectorRegistry`, etc.) expose pure-function factories (`makeXxxService(runtime)`) so tests can pass mocks (in-memory clients, fixed clocks, deterministic UUIDs).
- Errors are **structured tagged classes** (`class FlowSpecValidationError extends ConnectError { readonly _tag = "FlowSpecValidationError" }`) so the HTTP layer can `switch` on them when mapping to status codes.
- Composition is split per route (§4.15) to keep config requirements minimal — a missing env var for an unrelated route must never fail this route.

Top-level layout:

```
bin/app.ts
lib/
  network-stack.ts          # NetworkStack
  connect-stack.ts          # ConnectStack
lambda/
  http/                     # router.ts, request-context.ts, responses.ts
  api/definitions.ts        # OpenAPI generator source
  schemas/                  # Zod schemas (one file per group)
  services/                 # FlowsRepository, FlowCompiler, ... (one file each)
  workers/                  # one file per Type in §3.5.1
  flow-creation/            # compilation pipeline Lambdas
  static-ip/                # EIP/NAT step Lambdas + helpers
  sftp/                     # SftpPoller + AWS Transfer Family integration
  utils/                    # retry, jsonpath, xml-converter, sigv4, errors
  config/                   # env-var loaders
scripts/
  generate-openapi.ts
  static-asl-validator.ts
test/
  unit/                     # Vitest unit tests
  integration/              # Vitest integration tests against deployed stage
docs/openapi.json
justfile
```

### 7.8 Testing strategy

- **Vitest** is the test runner (per `testing-strategy`); coverage via `@vitest/coverage-v8` is required ≥ 80 % for new modules.
- Unit tests live in `test/unit/`** and follow the testing pyramid — mock AWS SDK clients at the `@aws-sdk/`* boundary using `vitest.mock(...)`; do **not** mock our own service interfaces.
- A real Step Functions Local container (`docker run amazon/aws-stepfunctions-local`) is used in tests that exercise the compiled ASL. `just test` orchestrates docker + Vitest.
- Integration tests live in `test/integration/connect-api.test.ts` and hit a deployed stage via `aws4`-signed `x-api-key` requests (`CONNECT_API_URL`, `AWS_PROFILE`, `SERVICE_API_KEY`).
- The OpenAPI spec at `docs/openapi.json` is regenerated by `scripts/generate-openapi.ts` (driven from `lambda/api/definitions.ts`) and checked in. CI fails if `docs/openapi.json` is stale.
- Powertools `Logger.injectLambdaContext` and `Tracer.captureLambdaHandler` are wrapped in test setup so log + trace assertions survive across test files.

### 7.9 CI / CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the SOCAPITAL shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.
- All deploys go through `cdk deploy` with `--require-approval=any-change` in dev and `--require-approval=broadening` in prod. **No alternative IaC tool is permitted in CI** (per non-negotiable #4).

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI / CDK with permissions for VPC, EC2 (subnets, EIP, NAT), Lambda, Step Functions, API Gateway, S3, DynamoDB (with KMS), SQS, IAM, CloudFormation, CloudWatch Logs, SSM, **AWS Transfer Family** (`transfer:`* for connector + listing + transfer), **Secrets Manager** (per-partner SFTP credentials), and **EventBridge Scheduler** (per-partner SFTP polling cadence). Default deploy region: `us-east-2`.
- Pre-provisioned `Subdomain` (custom domain bound to an ApiGatewayV2 mapping under `/connector-jobs`).
- Pre-issued `SERVICE_API_KEY_ID` and `HEALTH_API_KEY_ID` (forwarded by the deployer through CDK context).
- Per SFTP partner, the contract from `build-inbound-sftp-workflows` Phase 1: hostname / URL, username + password (or private key) **placed in Secrets Manager before deploy** with the canonical `{Url, Username, Password}` keys, expected remote directory, target prefix, schedule expression (if recurring), transfer concurrency cap, and the SHA-256 fingerprints of the partner's host keys.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy           # NetworkStack first (CDK auto-orders), then ConnectStack
pnpm cdk:destroy          # only when deletionProtection=false (non-prod)
```

Stack outputs: `ApiUrl`, `FlowCreationStateMachineArn`, `LookupCreationStateMachineArn`, `FlowDecoratorStateMachineArn`, `BatchInvocationStateMachineArn`, `EnableStaticIpStateMachineArn`, `DisableStaticIpStateMachineArn`, `RuntimeStateMachineRoleArn`, `SftpPollerLambdaArn`, `SftpConnectorIds` (map of `vendor_name → connectorId`), `VpcId`. Three SSM parameters are created: `connect-api-url`, `connect-flow-decorator-arn`, and `connect-sftp-connector-map`.

### 8.3 Smoke tests

After every deploy run the seven release-validation calls listed in `README.md` §"Connect release validation":

1. `POST /vendors` to create a throw-away partner; `DELETE /vendors/{name}` to remove it.
2. `POST /vendors/{name}/flows` with a no-op spec (`Pass → Wait 1 → ReplyBack`); poll `GET /flows/creations/{creation_id}` until `SUCCEEDED`.
3. `POST /vendors/{name}/flows/{flow}/jobs` with a stub `callback_url` (a webhook.site capture) and confirm the callback arrives.
4. `POST /vendors/{name}/flows/{flow}/webhook` to verify the inbound path (after wiring a `WebhookReference` step in the spec).
5. `POST /tokens/<name>` + `GET /tokens/<name>` + `DELETE /tokens/<name>` to validate the token registry.
6. `GET /network/ip` to confirm the EIP fabric reports its current state.
7. **SFTP listing-first live check** (per `build-inbound-sftp-workflows` Phase 5, never skipped on a fresh connector):
  1. Confirm the partner secret exists with the expected `{Url, Username, Password}` (or `PrivateKey`) keys.
  2. Confirm `VendorsResponsesBucket` is writable under `transfer-listings/<vendor>/`.
  3. `POST /vendors/{name}/sftp/test-connection` with `dry_run=true` and verify a `transfer-listings/<vendor>/<YYYY>/<MM>/<DD>/<runId>/listing.json` artifact appears in S3.
  4. Drop one known small file in the partner's remote directory; rerun `POST /vendors/{name}/sftp/test-connection` with `dry_run=false` and confirm the file lands under `sftp-inbound/<vendor>/<YYYY>/<MM>/<DD>/`.
  5. Inspect `SftpPoller` logs for auth, path, permission, networking, and throttling errors. Do **not** claim the connection works unless this live transfer succeeded.

For request signing the README ships a `bash`/`zsh` `awscurl` helper that wraps `aws4` for signed `execute-api` requests.

### 8.4 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps DynamoDB tables, S3 buckets, and SQS queues in place.
2. Re-run the smoke checks.
3. Audit `FlowsTable` for any rows whose `state_machine_name` references a now-missing dynamic SFN; the next compilation overwrites them. Confirm no jobs are stuck in `IN_PROGRESS` past `now - 1h` via `aws stepfunctions list-executions --status-filter RUNNING` against `FlowDecoratorStateMachineArn`.

### 8.5 Common runbook items

- `**States.DataLimitExceeded` cascades**: a partner returned a payload > 256 KiB or the spec attempted to hand the full payload across a state. Either trim with a `Pass` selector or persist via `SaveResponseToFile` so only the URL crosses state boundaries.
- **Stuck `WAIT_FOR_TASK_TOKEN`**: inspect `FlowsTable` for the `REQUEST#<request_id>` row. Confirm the partner ever called the webhook URL. If the row exists but the SFN is gone, `processWebhook` will return `CannotContinueFlowCorruptState`.
- **Throttled `ListExecutions`**: `ThrottlingException` from Step Functions surfaces as `429 TooManyRequests`. Backoff-and-retry on the caller side; do not raise the per-stage Step Functions limit without sign-off.
- **EIP provisioning hung in `ENABLING_PENDING`**: `EnableStaticIp` retries `CreateNatGateway` up to 10 times exponentially; if still failing, manually release the half-created EIP, untag the partial subnet, and re-trigger.
- `**SftpListingTimeout**`: `DescribeDirectoryListing` did not reach `COMPLETED` within `SFTP_LISTING_MAX_WAIT_MS`. Check the connector's CloudWatch Logs (`/aws/transfer/connector/<connectorId>`) for auth, host-key, or path errors. Confirm the partner's host keys still match the trusted fingerprints on the connector — partner-side key rotation is the most common cause.
- `**SftpTransferError` after retries**: `StartFileTransfer` exhausted `SFTP_TRANSFER_RETRY_MAX_ATTEMPTS`. Pull the offending paths from the response's `errors[]`, validate the partner's remote ACL, and re-run `POST /vendors/{vendor}/sftp/test-connection` with the narrowed `remote_directory`. Lower `transfer_concurrency` if the partner is rate-limiting us.
- **Recurring SFTP poll missed**: confirm the EventBridge `Schedule` is enabled (`scheduler:GetSchedule`) and that its target invocation role still has `lambda:InvokeFunction` on `SftpPollerLambdaArn`. The `sftp_listings_started` metric, dimension `vendor_name`, alarms when no invocation lands inside the partner's expected cadence.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript 5.6+, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,tracer,metrics,parameters}`, `@aws-sdk/client-{dynamodb,s3,sfn,sqs,apigateway,ec2,kms,lambda,ssm,sts,transfer,secrets-manager,scheduler,eventbridge}`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/s3-request-presigner`, `@smithy/{config-resolver,node-config-provider,protocol-http,signature-v4}`, `aws4`, `zod`, `zod-to-json-schema`, `undici`, `fast-xml-parser`, `csv-parse`, `csv-stringify`. CDK: `aws-cdk-lib@^2.170`, `constructs`, `aws-cdk@^2.170`. **No `ssh2`, `ssh2-sftp-client`, `vm2`, `isolated-vm`, Python dependencies, Serverless Framework, SAM, Terraform, or Pulumi.**
3. **Schemas / contracts**: one Zod module per group in `lambda/schemas/` — `vendor`, `vendor-credentials`, `partner-configuration`, `flow`, `lookup`, `flow-spec`, `flow-invoke`, `batch`, `webhook`, `token`, `static-ip`, `sftp`, `errors`. Errors are tagged classes; everything else is type+validator pairs.
4. **Utils**: `lambda/utils/{xml-converter,jsonpath,sigv4,retry,errors,duration,size-guard}.ts`.
5. **Configuration**: `lambda/config/{env,sfn,kms,api-gateway,sftp}.ts` plus per-service config readers tied to the env vars listed in §2.4. Required vars must throw at startup; optional vars must default per §2.4.
6. **Services** (one file each in `lambda/services/`): `FlowsRepository`, `PartnerConfigurationsRepository`, `TokensRepository`, `FlowCompiler` (with sub-modules `transformation`, `authorization`, `dry-run`, `creation-and-saving`, `compiler/{const,parameters,to-vendor,general,map-state,lambda-arns,dynamicity-switcher,instructions}`), `WebhookConditionEvaluator`, `WebhookErrorCodes`, `BatchInputPreparer`, `BatchPostProcessor`, `WidgetService`, `ProxyLinkManager`, `S3CreationStore`, `SftpConnectorRegistry`, `HealthMetricClient`, `AccountManagerClient`, `MetricsBuffer`, plus a composition module `services/index.ts` that exports per-router and per-handler dependency containers.
7. **Workers** (one file each in `lambda/workers/`): one per `Type` in §3.5.1 — `http-json`, `http-xml`, `http-any`, `get-json`, `post-json`, `put-json`, `delete-json`, `get-xml`, `post-xml`, `delete-xml`, `post-multipart`, `put-multipart`, `post-blob`, `put-blob`, `post-base64`, `post-form-url-encoded`, `get-file`, `widget`, `link-transformation`, `progressive-waiting`, `token-management-get`, `token-management-set`, `fake-range-creator`, `process-fail-states`, `reply-back`, `dry-run`, `get-credentials`, `get-authorization`, `token-management-auth`, `webhooks-writer`, `send-health-metric`, `cleanup-apigw`. Each worker imports `tracer.captureLambdaHandler` and `logger.injectLambdaContext`.
8. **SFTP fabric**: `lambda/sftp/poller.ts` (`SftpPoller`, listing-first per `build-inbound-sftp-workflows`), `lambda/sftp/connector-config.ts` (per-partner config loader from CDK context), and the CDK construct in `lib/sftp-connector.ts` that mints one `AWS::Transfer::Connector` + one Secrets Manager entry + one IAM access role + one EventBridge `Schedule` per SFTP partner.
9. **Compilation pipeline**: `lambda/flow-creation/{transform-flow,transform-lookup,add-pass-through,add-call-api,add-call-token-management,add-credentials,add-dry-run,validate-asl,create-runtime-state-machine,update-runtime-state-machine,save-flow}.ts`.
10. **Static-IP fabric**: `lambda/static-ip/{ec2-common/{eip,nat,internet,subnet,route,tag-transformers}.ts, handlers/{create,delete,process-errors}.ts}` and the two ASL definitions assembled in CDK via `sfn.StateMachine.fromString(...)`.
11. **HTTP layer**: `lambda/http/{request-context.ts, responses.ts}`, `lambda/logging/{powertools.ts, runtime.ts}`, the per-route routers (partners, credentials, configurations, constructor, jobs, batch, webhooks, tokens, static-ip, **sftp**), and `lambda/http/router.ts` mounting them with `prefix="/"`, then `lambda/handler.ts`.
12. **OpenAPI generator**: `lambda/api/definitions.ts` and `scripts/generate-openapi.ts`. `pnpm api:spec` writes `docs/openapi.json` (the generated spec is checked in).
13. **CDK stacks**: `lib/network-stack.ts` and `lib/connect-stack.ts` per §2.2 and §2.3, then `bin/app.ts`. Add a `cost-tagging` aspect that stamps `sc:service:name=connect` and `sc:product:name=Connect` on every taggable resource. SFTP partner config feeds in via `cdk.json` context (`connect:sftp:partners`) — partner-specific values are **never hardcoded** in source.
14. **Custom resources (CDK `AwsCustomResource` or Lambda-backed)**: `ApiUsagePlanCustomResource`, `ApiGatewayLogCustomResource`, `ProxyResourceCleanupCustomResource`, `HealthApiKeyAuthorizer`.
15. **Local Step Functions**: `scripts/start-stepfunctions-local.sh`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared SOCAPITAL workflows.
16. **Lexicon + Dashboard registration**: every metric introduced in §7.2 MUST land in `cloudwatch-metrics.json` in the [Lexicon](https://github.com/Spring-Oaks-Capital-LLC/lexicon) repo and on the [Main Dashboard](https://github.com/Spring-Oaks-Capital-LLC/main-dashboard) **in the same PR cycle** (per `observability-metrics`).
17. **Smoke tests**: replicate the seven release-validation steps from §8.3 in the integration suite under `test/integration`, including the `build-inbound-sftp-workflows` Phase 5 live listing-and-transfer check.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success/error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- Creating a flow with `authorization.credentials ∈ {preset,static,dynamic}` × `authorization.mode ∈ {pass_through,call_api,token_management}` always lands on a real, validated runtime state machine.
- A flow that contains a `Fail` state always closes with a callback POST to `callback_url` carrying `job_status=Failed`, the canonicalised cause, and the matching status code.
- A flow that contains a `WAIT_FOR_TASK_TOKEN` step is resolvable via the inbound webhook route and survives the full `WebhookErrorCode → custom-status mapping` matrix in §3.7 / §6.1.
- Batch executions paginate per-item outputs back to S3 and surface accurate per-status counts via the aggregation API.
- Async flow inputs ≥ 256 KiB are rejected at the API layer with `413 JobInputTooLarge` before reaching Step Functions.
- The ASL validator catches every spec the compiler can emit; specs that pass validation can always be installed via `CreateStateMachine` / `UpdateStateMachine`.
- The compilation SFN never leaks half-created runtime SFNs: any failure inside `CreateRuntimeStateMachine` / `UpdateRuntimeStateMachine` lands on `FailState`, and the next `PUT` succeeds without manual cleanup.
- Tokens persisted via `POST /tokens` are returned with `extra` intact and decryptable by both `TokenManagementGetWorker` and the partner-call helper that resolves `auth_type ∈ {bearer,api_key}` via `token_name`.
- `processWebhook` always returns within `30 s`, always emits a silent health metric, and always honours the per-flow `webhook_response_mapping` overrides.
- Static-IP enable/disable is idempotent: repeated `POST /network/ip` does not create duplicate NAT/EIP resources, and `GET` correctly reports `ENABLING_PENDING` / `ENABLED` / `DISABLED_OR_NEVER_CREATED`.
- Deploy-time custom resources (`ApiUsagePlan`, `ApiGatewayLog`, `ProxyResourceCleanup`) leave the API stage in a clean state on every deploy.
- **No in-process code execution.** `grep -r "node:vm\|vm2\|isolated-vm\|eval(" lambda/` returns zero hits, and a spec submission containing a `Type` outside the §3.5.1 dispatch table is rejected at compile time with `400 FlowSpecValidationError`.
- **Step Functions is the only workflow runtime.** Every flow / lookup compiles to a Step Functions state machine; the repo contains no in-Lambda step orchestrator, no SQS-chained "workflow worker", and no second compiler target. `grep -r "executeWorkflow\|runFlow\|stepLoop" lambda/` returns zero hits outside Step Functions integration code.
- **Outbound HTTP defaults to a native Step Functions HTTP Task.** Compiling a `HTTP_JSON` (or any other plain HTTP-shaped task type — `HTTP_XML`, `HTTP_ANY`, `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`, `GET_XML`, `POST_XML`, `DELETE_XML`, `POST_BASE64`, `POST_FORM_URL_ENCODED`) emits a Task with `Resource: "arn:aws:states:::http:invoke"` whose `Authentication.ConnectionArn` references an `AWS::Events::Connection`. The compiled ASL contains **no `lambda:invoke` against an HTTP worker** for these task types — verified by an ASL-introspection unit test that compiles a representative spec per type and asserts the resulting `Resource` strings.
- **Lambda HTTP workers are limited to the residual set.** `lambda/workers/` contains only `post-multipart`, `put-multipart`, `post-blob`, `put-blob`, `get-file`, the two static-IP HTTP variants, and the `FormEncodeWorker` fallback. The HTTP_JSON / HTTP_XML / HTTP_ANY / GET_JSON / POST_JSON / PUT_JSON / DELETE_JSON / GET_XML / POST_XML / DELETE_XML / POST_BASE64 / POST_FORM_URL_ENCODED Lambda files are **absent** — `find lambda/workers/ -name 'http-*.ts' -o -name 'get-json.ts' -o -name 'post-json.ts'` returns nothing.
- **Authorisation lives on EventBridge Connections.** Every partner with HTTP endpoints has at least one `AWS::Events::Connection` named `connect-<vendor_name>[-<auth_profile>]`; deleting a partner deletes its connections. `RuntimeStateMachineRole` carries `events:RetrieveConnectionCredentials` (and the matching `secretsmanager:GetSecretValue`) only for the connection ARNs the runtime state machine references — verified by IAM simulation in CI.
- **SFN HTTP Task IAM is host-scoped.** The `RuntimeStateMachineRole`'s `states:InvokeHTTPEndpoint` statement carries a `states:HTTPEndpoint` condition listing only the hostnames the compiled flow targets; an attempt to invoke a host outside that allow-list at runtime fails with `States.Http.AccessDenied`.
- **SFTP traffic goes exclusively through AWS Transfer Family.** A spec containing `Type: "SFTP"` compiles to a `LambdaInvoke` of `SftpPoller` with the §6.7 contract; `grep -r "ssh2\|ssh2-sftp-client\|node-ssh" lambda/ package.json` returns zero hits.
- **The SFTP listing-first flow is preserved.** Every SFTP run produces a `transfer-listings/<vendor>/<YYYY>/<MM>/<DD>/<runId>/listing.json` artifact in S3 **before** any `StartFileTransfer` is issued (per `build-inbound-sftp-workflows` Principle 3). `dry_run=true` runs return `transferIds: []` and write the listing artifact only.
- **SFTP results are deterministic and machine-readable.** Successful transfers land at `sftp-inbound/<vendor>/<YYYY>/<MM>/<DD>/<remote-path>`. The response shape (`SftpPollerResponse`) is constant across success and partial-failure runs, with `errors[]` bounded to 25 entries so the payload stays under the 256 KB SFN-output limit.
- **SFTP retries** on `ThrottlingException` / 5xx are bounded by `SFTP_TRANSFER_RETRY_MAX_ATTEMPTS`; permanent partner-side errors surface as bounded entries in `errors[]` rather than failing the entire listing.
- **SFTP partner values are never hardcoded.** Hostnames, secret ARNs, remote directories, target prefixes, schedules, and concurrency caps live in `cdk.json` context (CDK-time) or in the invocation event (runtime). `grep -r "sftp://" lambda/ lib/` matches nothing outside `cdk.json` / Secrets Manager references.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so any CommonJS dependency works at runtime. **Zero Python files exist in the repository.**
- All LLM interactions (if any) go through the **Vercel AI SDK (`ai`) with strict TypeScript and Zod tool schemas** — `grep -r "openai\|@anthropic-ai/sdk\|@aws-sdk/client-bedrock-runtime" lambda/` returns zero hits.
- IAM permissions follow least-privilege per §2.3.6: in particular, `SftpPoller` does **not** hold `secretsmanager:GetSecretValue` (only the per-partner Transfer Family connector role does).
- Every metric emitted by the service exists in `cloudwatch-metrics.json` (Lexicon) and is rendered on the Main Dashboard — including the `sftp_listings_started` / `sftp_listings_completed` / `sftp_listings_timed_out` / `sftp_files_transferred` / `sftp_transfer_errors` family.
- All structured logs include the relevant `creation_id` / `job_id` / `batch_execution_id` / `request_id` / `task_token` / `vendor_name` / `flow_name` / `connector_id` / `runId` / `listingId` / `x-sc-trace-id` so an operator can trace a single integration call end-to-end via CloudWatch Logs Insights, and **never** include credentials, tokens, `webhook_auth.Secret`, or partner SFTP passwords.

---

## 11. Worked Examples

End-to-end request / response cycles for every public capability. All bodies are real shapes the API accepts (validated by Zod) — copy-paste-ready against a deployed stage. Example partner: `acme-bureau`. Headers shown only when material; every authenticated request also carries `x-api-key: <SERVICE_API_KEY>` and `x-sc-trace-id: <uuid>`.

### 11.1 Create a partner

```http
POST /connector-jobs/vendors HTTP/1.1
Content-Type: application/json
x-api-key: <SERVICE_API_KEY>

{ "vendor_name": "acme-bureau", "company_id": "tenant-001" }
```

```json
HTTP/1.1 201 Created

{ "vendor_name": "acme-bureau", "company_id": "tenant-001" }
```

### 11.2 Set partner credentials

```http
PUT /connector-jobs/vendors/acme-bureau/credentials
Content-Type: application/json

{
  "items": {
    "client_id": "ak_live_abc123",
    "client_secret": "sk_live_xyz789",
    "auth_url": "https://api.acme-bureau.com/oauth/token"
  }
}
```

```json
HTTP/1.1 200 OK

{ "client_id": "ak_live_abc123", "client_secret": "sk_live_xyz789", "auth_url": "https://api.acme-bureau.com/oauth/token" }
```

### 11.3 Create a flow — credit-pull example

A representative real-world spec: OAuth-token fetch → POST a credit pull → progressive-wait until ready → GET the report file → reply back.

```http
POST /connector-jobs/vendors/acme-bureau/flows
Content-Type: application/json

{
  "flow_name": "pull-credit-report",
  "version": "1.0.0",
  "configuration_id": "cfg-prod-001",
  "authorization": {
    "credentials": "preset",
    "mode": "call_api",
    "header_name": "Authorization",
    "scheme": "bearer",
    "call_api": {
      "url": "$vendor_credentials.auth_url",
      "method": "POST",
      "headers": { "Content-Type": "application/x-www-form-urlencoded" },
      "request_payload": "grant_type=client_credentials&client_id=$vendor_credentials.client_id&client_secret=$vendor_credentials.client_secret",
      "path_to_token": "$.access_token"
    }
  },
  "definition": {
    "StartAt": "SubmitPull",
    "States": {
      "SubmitPull": {
        "Type": "Task",
        "ResourceDefinition": {
          "Type": "HTTP_JSON",
          "URL": "https://api.acme-bureau.com/v2/credit-pulls",
          "Method": "POST",
          "ContentType": "application/json",
          "RequestPayload": "$.request_payload",
          "SaveOutputTo": "$.pull"
        },
        "Next": "WaitForReady"
      },
      "WaitForReady": {
        "Type": "Task",
        "ResourceDefinition": {
          "Type": "PROGRESSIVE_WAITING",
          "WaitingConditions": { "IntervalSeconds": 5, "MaxAttempts": 24, "BackoffRate": 1.5 }
        },
        "Next": "CheckStatus"
      },
      "CheckStatus": {
        "Type": "Task",
        "ResourceDefinition": {
          "Type": "GET_JSON",
          "URL": "https://api.acme-bureau.com/v2/credit-pulls/{pull_id}",
          "PathParameters": { "pull_id": "$.pull.id" },
          "SaveOutputTo": "$.status"
        },
        "Next": "IsReady"
      },
      "IsReady": {
        "Type": "Choice",
        "Choices": [
          { "Variable": "$.status.state", "StringEquals": "READY", "Next": "DownloadReport" },
          { "Variable": "$.status.state", "StringEquals": "FAILED", "Next": "ReportFailed" }
        ],
        "Default": "WaitForReady"
      },
      "DownloadReport": {
        "Type": "Task",
        "ResourceDefinition": {
          "Type": "GET_FILE",
          "URL": "$.status.report_url",
          "SaveOutputTo": "$.response_payload"
        },
        "End": true
      },
      "ReportFailed": { "Type": "Fail", "Cause": "Acme bureau reported FAILED" }
    }
  }
}
```

```json
HTTP/1.1 202 Accepted

{ "creation_id": "8f1c8a91-3a47-4f1c-9e6f-ad9f8b5e6f10", "creation_status": "Started" }
```

### 11.4 Poll flow compilation status

```http
GET /connector-jobs/flows/creations/8f1c8a91-3a47-4f1c-9e6f-ad9f8b5e6f10
```

```json
HTTP/1.1 200 OK

{ "status": "SUCCEEDED" }
```

On failure the body carries the structured cause:

```json
{ "status": "FAILED", "error": "FlowSpecValidationError", "cause": "State `WaitForReady` references unknown ResourceDefinition.Type" }
```

### 11.5 Invoke a flow (job)

```http
POST /connector-jobs/vendors/acme-bureau/flows/pull-credit-report/jobs
Content-Type: application/json

{
  "transaction_id": "txn-2026-05-04-0001",
  "request_collection_id": "applicant-9001",
  "response_collection_id": "credit-report-9001",
  "callback_url": "https://api.staircase.co/integration-bus/connect/callback",
  "request_payload": {
    "applicant": { "ssn": "XXX-XX-9001", "dob": "1985-04-12" },
    "products": ["fico_8", "tradelines"]
  },
  "partner_configuration": { "partner_configuration_id": "cfg-prod-001" }
}
```

```json
HTTP/1.1 202 Accepted

{ "job_id": "5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f", "job_status": "Started" }
```

If the spec set `contains_widget: true`, the response also carries `"widget_url": "https://…/widgets/acme-bureau/pull-credit-report<uuid>.html?X-Amz-Signature=…"`.

### 11.6 Reply-back callback (delivered to `callback_url`)

When the flow finishes, Connect POSTs the canonical callback envelope to the URL supplied at job submission (with `x-api-key: <originating product key>` and `X-Sc-Trace-Id`):

```json
POST <callback_url>
Content-Type: application/json
x-api-key: <originating product key>
X-Sc-Trace-Id: <uuid>

{
  "webhook_type": "flow_completion",
  "job_id": "5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f",
  "job_status": "Completed",
  "transaction_id": "txn-2026-05-04-0001",
  "request_collection_id": "applicant-9001",
  "response_collection_id": "credit-report-9001",
  "response_payload": {
    "report_url": "https://<connect-bucket>.s3.us-east-2.amazonaws.com/5e8b1a07-…/report.pdf?X-Amz-Signature=…",
    "fico_8": 742,
    "tradelines": [/* … */]
  },
  "status_code": 200
}
```

On failure the body shape is identical with `job_status: "Failed"`, `status_code` set to the canonical mapping (e.g. `502` for `CallVendorError`), and `response_payload: { "Error": "CallVendorError.503", "Cause": { "errorMessage": "Acme bureau returned HTTP 503", "status_code": 503 } }`.

### 11.7 Inspect job execution status

```http
GET /connector-jobs/vendors/acme-bureau/flows/pull-credit-report/jobs/5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f?detailed=true&max_results=50
```

```json
HTTP/1.1 200 OK

{
  "status": "RUNNING",
  "start_date": "2026-05-04T15:01:22.114Z",
  "end_date": null,
  "duration": null,
  "executed_events": ["SubmitPull", "WaitForReady", "CheckStatus"],
  "last_event": "CheckStatus",
  "details": [
    { "event_id": 7, "event_type": "stateEnteredEventDetails", "event_name": "CheckStatus",
      "timestamp": "2026-05-04 15:01:48.312", "previous_event_id": 6,
      "input_details": { "applicant": { "ssn": "XXX-XX-9001", "dob": "1985-04-12" } } }
  ],
  "input":  { "transaction_id": "txn-2026-05-04-0001", "request_collection_id": "applicant-9001",
              "response_collection_id": "credit-report-9001", "callback_url": "https://…/callback" },
  "output": null
}
```

### 11.8 Webhook from partner (releases `WAIT_FOR_TASK_TOKEN`)

The partner POSTs to the per-flow webhook URL. Connect authenticates via the per-flow `webhook_auth.Secret`, matches the `request_id`, and resolves the pending task token.

```http
POST /connector-jobs/vendors/acme-bureau/flows/pull-credit-report/webhook
Content-Type: application/json
X-Acme-Sig: shared-secret-value

{
  "event": "credit_pull.completed",
  "webhook": { "request_id": "req-9001", "status": "READY" },
  "report_url": "https://api.acme-bureau.com/files/report-9001.pdf"
}
```

```json
HTTP/1.1 202 Accepted

{ "event": "credit_pull.completed", "webhook": { "request_id": "req-9001", "status": "READY" }, "report_url": "https://api.acme-bureau.com/files/report-9001.pdf" }
```

A mismatched `webhook_conditions` evaluates to `403 Conditions did not match.` (or the per-flow `WebhookResponseMapping.ConditionsMismatch.StatusCode`); a missing `request_id` evaluates to `400 NoRequestIdFoundInPayload`.

### 11.9 Stop a running job

```http
POST /connector-jobs/vendors/acme-bureau/flows/pull-credit-report/jobs/5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f
```

```json
HTTP/1.1 201 Created

{ "job_id": "5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f", "status": "ABORTED", "stop_date": "2026-05-04 15:14:08.001" }
```

### 11.10 Batch execution

```http
POST /connector-jobs/vendors/acme-bureau/flows/pull-credit-report/batch-executions
Content-Type: application/json

{
  "callback_url": "https://api.staircase.co/integration-bus/connect/callback",
  "batch_input": { "data_source": "s3://staircase-batches/credit-pulls/2026-05-04/applicants.json" },
  "batch_configuration": { "maximum_concurrency": 25, "maximum_items_per_batch": 1 }
}
```

```json
HTTP/1.1 202 Accepted

{ "batch_execution_id": "b7d2a44c-6c0a-4e22-9ad0-2f1d3e4a5b6c", "batch_execution_status": "Started" }
```

```http
GET /connector-jobs/batch-executions/b7d2a44c-6c0a-4e22-9ad0-2f1d3e4a5b6c/aggregation
```

```json
HTTP/1.1 200 OK

{
  "batch_execution_status": "RUNNING",
  "batch_execution_id": "b7d2a44c-6c0a-4e22-9ad0-2f1d3e4a5b6c",
  "batch_execution_items_aggregation":
    { "pending": 0, "running": 12, "succeeded": 88, "failed": 0, "timed_out": 0, "aborted": 0, "total": 100 },
  "batch_execution_executions_aggregation":
    { "pending": 0, "running": 12, "succeeded": 88, "failed": 0, "timed_out": 0, "aborted": 0, "total": 100 }
}
```

### 11.11 SFTP — flow-driven step

For partners that drop files on SFTP, a flow embeds an `SFTP` task; the compiler turns it into a sync `LambdaInvoke` of `SftpPoller`.

```jsonc
// State inside FlowSpecDefinition.States
"PullDailyDrop": {
  "Type": "Task",
  "ResourceDefinition": {
    "Type": "SFTP",
    "Direction": "inbound",
    "RemoteDirectory": "/outbound/credit-reports",
    "TargetPrefix": "daily-pulls/",
    "TransferConcurrency": 10,
    "SaveOutputTo": "$.sftp_result"
  },
  "Next": "ProcessReports"
}
```

`$.sftp_result` after the step matches `SftpPollerResponse` (§6.7):

```json
{
  "ok": true,
  "listingId": "list-2026-05-04-0001",
  "listingS3Uri": "s3://vendors-responses-connect-…/transfer-listings/acme-bureau/2026/05/04/list-2026-05-04-0001/listing.json",
  "fileCount": 42,
  "sampledFiles": ["/outbound/credit-reports/2026-05-04/applicant-9001.pdf", "/outbound/credit-reports/2026-05-04/applicant-9002.pdf"],
  "transferIds": ["xfer-1a2b", "xfer-3c4d", "…"],
  "errors": []
}
```

### 11.12 SFTP — manual test connection

```http
POST /connector-jobs/vendors/acme-bureau/sftp/test-connection
Content-Type: application/json

{ "remote_directory": "/outbound/credit-reports", "dry_run": true }
```

```json
HTTP/1.1 200 OK

{
  "listingId": "list-test-7e9c4f",
  "listingS3Uri": "s3://vendors-responses-connect-…/transfer-listings/acme-bureau/2026/05/04/test-7e9c4f/listing.json",
  "fileCount": 42,
  "sampledFiles": ["/outbound/credit-reports/2026-05-04/applicant-9001.pdf"],
  "transferIds": [],
  "errors": []
}
```

If the partner has no Transfer Family connector configured:

```json
HTTP/1.1 404 Not Found

{ "ok": false, "error": { "type": "SftpConnectorNotConfigured", "message": "Partner `acme-bureau` has no SFTP connector." } }
```

### 11.13 Lookup (synchronous request/response)

Lookups follow the same constructor surface as flows but compile to an `EXPRESS` SFN and return the response inline.

```http
POST /connector-jobs/vendors/acme-bureau/lookups/zip-to-state/jobs
Content-Type: application/json

{ "transaction_id": "txn-zip-001", "request_payload": { "zip": "94107" } }
```

```json
HTTP/1.1 200 OK

{ "transaction_id": "txn-zip-001", "response_payload": { "state": "CA", "city": "San Francisco" } }
```

A partner-side error:

```json
HTTP/1.1 502 Bad Gateway

{ "transaction_id": "txn-zip-001",
  "error": "CallVendorError.503",
  "cause": { "errorMessage": "Acme bureau returned HTTP 503", "status_code": 503, "url": "https://api.acme-bureau.com/v1/zip/94107" } }
```

### 11.14 Tokens registry

```http
POST /connector-jobs/tokens/acme-oauth-token
Content-Type: application/json

{ "token_value": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp…", "extra": { "expires_at": "2026-05-04T16:30:00Z" } }
```

```json
HTTP/1.1 201 Created

{ "token_name": "acme-oauth-token", "token_value": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp…", "extra": { "expires_at": "2026-05-04T16:30:00Z" } }
```

```http
GET /connector-jobs/tokens/acme-oauth-token
```

```json
HTTP/1.1 200 OK

{ "token_name": "acme-oauth-token", "token_value": "eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp…", "extra": { "expires_at": "2026-05-04T16:30:00Z" } }
```

### 11.15 Static IP

```http
GET /connector-jobs/network/ip
```

```json
HTTP/1.1 200 OK

{ "ip": "3.142.55.108", "resource_status": { "elastic_ip": "ALLOCATED", "network_translator": "ENABLED" } }
```

```http
POST /connector-jobs/network/ip
```

```json
HTTP/1.1 202 Accepted

{ "execution_arn": "arn:aws:states:us-east-2:123456789012:execution:EnableStaticIp:enable-2026-05-04T15-22-10",
  "status": "ENABLING_PENDING" }
```

### 11.16 Partner connectivity configuration (PCC)

```http
POST /connector-jobs/vendors/acme-bureau/configurations
Content-Type: application/json

{
  "partner_configuration_id": "cfg-prod-001",
  "partner_configuration": {
    "partner_configuration": {
      "credentials": { "client_id": "ak_prod_001", "client_secret": "sk_prod_001" },
      "passed_credentials": { "merchant_id": "M-9001" }
    }
  }
}
```

```json
HTTP/1.1 201 Created

{ "partner_configuration_id": "cfg-prod-001" }
```

### 11.17 Response-URL recovery

```http
POST /connector-jobs/response-url-recovery
Content-Type: application/json

{ "job_id": "5e8b1a07-9c4d-4ec1-9f6a-1b3a2c5d4e7f", "expiration": 7200 }
```

```json
HTTP/1.1 200 OK

{
  "page": { "count": 2 },
  "response_file_urls": [
    "https://vendors-responses-connect-….s3.us-east-2.amazonaws.com/5e8b1a07-…/report.pdf?X-Amz-Signature=…",
    "https://vendors-responses-connect-….s3.us-east-2.amazonaws.com/5e8b1a07-…/raw-response.json?X-Amz-Signature=…"
  ]
}
```

### 11.18 Error envelope (any route)

Every 4xx/5xx — except the API-Gateway-rendered ones in §3.1 — uses the canonical envelope:

```json
HTTP/1.1 400 Bad Request

{
  "ok": false,
  "error": {
    "type": "FlowSpecValidationError",
    "message": "Required field `RemoteDirectory` is not present.",
    "details": { "path": "definition.States.PullDailyDrop.ResourceDefinition" }
  }
}
```

