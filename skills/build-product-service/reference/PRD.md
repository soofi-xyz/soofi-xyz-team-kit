# Product Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Product** service. It captures the full feature set, data contracts, runtime behaviour, and infrastructure topology that the service must enforce. The current production code at `staircase/product` is a Python 3.9 + Serverless Framework implementation split across `product` and `product-flow-templates`; this PRD specifies the equivalent target service in canonical form: **TypeScript everywhere**, **AWS CDK only**, `pnpm`, Vitest, ESLint, Prettier, and Lambda `nodejs24.x` on ARM64.

The intentional product change from the legacy implementation is narrow but important: **template-backed product flows are the only executable product-flow model**. Product itself still owns products, product schemas, product flow templates, template-backed product flows, invocations, waterfalls, reports, SMS, email, blobs, widgets, OpenAPI metadata, status/debug APIs, and operational telemetry. It does **not** recreate the legacy built-in/default connector flow pipeline.

---

## 1. Product Overview

### 1.1 Mission

Product is the platform's configurable product-orchestration service. It lets operators define a named **Product**, publish JSON-schema-backed request/response contracts and OpenAPI metadata for that product, define reusable **Product Flow Templates** that compile to AWS Step Functions, bind those templates into executable **Product Flows**, and invoke those flows either directly or through a waterfall.

A Product is a business-facing unit such as an employment verification product, income product, communication product, or any other productized workflow that composes services. A Product Flow Template is the execution blueprint. A Product Flow is a configured instance of a template for one product, carrying selection tags, product API/configuration identifiers, language/report settings, mocks, callback behaviour, widget settings, and other per-flow metadata.

The service's core responsibility is to turn a product invocation into a durable, observable Step Functions execution and to close the invocation lifecycle with status, callback, health, finance, debug, and optional report/widget/email/SMS side effects.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<tenant-subdomain>/product/`, API-key authorised (`x-api-key` per the Bootstrap-managed shared Usage Plan), with the following capability groups:

| Group | Routes | Purpose |
| --- | --- | --- |
| **Products** | `POST /products`, `GET /products`, `GET/PATCH/DELETE /products/{product_name}` | Create, list, inspect, update, and delete Product definitions |
| **Schemas and examples** | `GET /products/{product_name}/request-schema`, `GET /response-schema`, `GET /request-elements`, `GET /response-elements`, `GET /schema/{data_object}`, `POST /request-elements/validate` | Store and expose JSON schemas, example payloads, derived element lists, and collection validation |
| **OpenAPI and custom endpoints** | `GET/PATCH/DELETE /products/{product_name}/openapi/endpoint_definitions`, `GET /products/{product_name}/openapi`, `ANY /products/{product_name}/custom_endpoint/{my_custom_endpoint}` | Manage product-specific endpoint definitions and produce the product OpenAPI view |
| **Partners** | `GET /products/{product_name}/partners`, `PUT /partners/{partner}/status`, `PUT/GET /partners/ordering` | Inspect and configure partner ordering/status metadata used by Product UI and flow selection |
| **Product Flow Templates** | `PUT/GET/DELETE /products/{product_name}/flow-templates/{template_name}`, `GET /products/{product_name}/flow-templates`, `GET /flow-template-upserts/{upsert_id}` | Upsert reusable template definitions, compile them to Step Functions, list/read/delete templates, and poll async compile status |
| **Template-backed Product Flows** | `POST/GET /products/{product_name}/product_flows`, `GET/PATCH/DELETE /products/{product_name}/product_flows/{product_flow_name}` | Configure executable flows. `flow_template_name` is required for every create/update that makes a flow runnable |
| **Invocations and waterfalls** | `POST /products/{product_name}/invocations`, `GET /products/{product_name}/invocations/{invocation_id}`, `POST /flow-invocations/{invocation_id}/states/{step_name}/webhooks`, `POST /flow-templates/invocations/{invocation_id}/resume`, `PUT/GET/DELETE /products/{product_name}/waterfall` | Start, resume, callback, inspect, and waterfall-order template-backed flow invocations |
| **Debug and obfuscation** | `GET/PUT /products/{product_name}/invocations/{invocation_id}/debug`, `POST /products/{product_name}/invocations/{invocation_id}/obfuscated_data`, `GET /products/{product_name}/invocations/{invocation_id}/obfuscated_data` | Retrieve invocation execution detail and create/read obfuscated debug artifacts |
| **Status** | `GET /products/{product_name}/status/{transaction_id}/{collection_id}` | Map a transaction/collection pair back to Product invocation status |
| **Reports** | `PUT/GET/DELETE /products/{product_name}/report-templates[/{template_name}]`, `POST /products/{product_name}/reports` | Store HTML/PDF report templates and generate report blobs from product output data |
| **SMS** | `POST /products/{product_name}/sms`, `GET /products/{product_name}/sms/{sms_id}`, `PUT/GET/DELETE /products/{product_name}/sms-templates[/{template_name}]` | Send SMS through configured provider credentials, check status, and manage SMS templates |
| **Email** | `POST /products/{product_name}/emails`, `GET /products/{product_name}/emails/{email_id}/events`, `PUT/GET/DELETE /email-templates[/{template_name}]`, `PUT/GET/DELETE /email-domains/{domain}`, `POST /email-events/webhooks` | Send email, process provider events, manage email templates and sender domains |
| **Blobs, widgets, links** | `POST /create_blob_from_content`, `GET /widgets/{invocation_id}`, `POST /shorten_links`, `GET /shorten_urls/{url_id}` | Store content blobs, serve invocation widgets, mint short links, and proxy short-link objects |
| **Internal — service info** | `GET /information` | Static service metadata (API Gateway `MOCK`, no API key) |

Every mutating route is API-key-gated except provider webhooks, invocation state webhooks, widget/short-link retrieval, and `GET /information`. Debug and obfuscation routes additionally accept the Health API key authoriser used by production support.

### 1.3 Non-goals

- Product does **not** recreate the legacy built-in/default product-flow pipeline. There is no shared `flow_invocation` state machine that infers Connector/Translator/Language/report steps from `vendor_name`, `flow_name`, and language fields alone. Every executable Product Flow must reference a Product Flow Template.
- Product does **not** allow `POST /products/{product_name}/product_flows` to create any flow without `flow_template_name`. Legacy connector fields may be accepted only as descriptive metadata on template-backed flows; they never define a standalone flow and never select a second execution engine.
- Product does **not** keep a separate `product-flow-templates` deployment with hard-coded CloudFormation exports. Flow-template storage, common template-step Lambdas, compile workflow, cleanup, and invocation webhooks are first-class resources in the same CDK application.
- Product does **not** own partner credential storage. Credentials remain in Account/Connect-owned stores and are read through those products' public contracts.
- Product does **not** own the Marketplace ontology. `marketplace_product_id` (legacy alias `product_identifier`), `product_api_id` (legacy alias `product_api_identifier`), and `configuration_id` are validated against Marketplace's local ontology, but the canonical catalog remains Marketplace.
- Product does **not** own graph persistence. It calls Persist when an invocation needs request/response collection storage.
- Product does **not** synthesize tenant DNS, custom domains, or usage plans. Bootstrap creates the shared tenant API Gateway domain and Usage Plan; Product owns only its `/product` base-path mapping and idempotent stage attachment.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

1. **Product Flow Templates are the only execution model.** A Product Flow is executable only when it references an existing template. Invocation dispatch always loads the referenced template's compiled state machine ARN and starts that state machine. There is no fallback to a default/legacy state machine.
2. **Step Functions is the workflow implementation layer.** Template compile, template invocation, waterfall invocation, obfuscation, report generation, and provider-event closeout use STANDARD Step Functions state machines. Branching, maps, parallelism, retries, catches, waits, and callback waits are expressed as ASL primitives.
3. **Templates compile to AWS-native state machines.** Template authors use a Product DSL (`StaircaseService`, `DownloadPublicContent`, `SendCallback`, `PatchEvent`, plus native `Choice`, `Map`, and `Parallel`). Product compiles this into real ASL with Lambda tasks, callback tokens, status listeners, output-path handling, and catch/failure states.
4. **One Product deployment, multiple stacks.** The legacy `product` and `product-flow-templates` services collapse into one CDK app with ordered stacks. No hard-coded `product-flow-templates-dev` import/export names may survive.
5. **Status and telemetry are first-class.** Every invocation emits status-change records, Health metrics, optional Finance metrics, cold-start/overhead timing, failure reason, and debug artifacts. Template-backed invocations use the modern metric path only; legacy metric synthesis is removed.
6. **Route composition is isolated.** Missing configuration for SMS, email, reports, Marketplace validation, or provider-specific integrations must not break unrelated Product CRUD, schema, or template routes.
7. **Generated OpenAPI is checked in.** Route definitions drive `scripts/generate-openapi.ts`; the generated `docs/openapi.json` must be committed and must match the source route definitions.

### 2.1 Stacks (AWS CDK)

The CDK app is composed of three stacks deployed in order:

```
bin/app.ts
├── DataStack       # KMS CMK, ProductsTable, FlowTemplatesTable,
│                   # ProductsBucket, FlowTemplatesBucket, queues and DLQs
├── WorkflowStack   # Template upsert, template invocation, waterfall invocation,
│                   # report/obfuscation helper state machines, EventBridge status rules
└── ProductStack    # REST API, route Lambdas, template-step Lambdas,
                    # API Gateway custom resources, provider webhooks, /information mock
```

`ProductStack.addDependency(workflowStack); workflowStack.addDependency(dataStack)` ensures storage deploys first, then orchestration, then routing. All stacks are TypeScript CDK v2 and deploy to the installer-supplied tenant AWS region.

#### 2.1.1 Marketplace / Deployer distribution contract

Product is distributed as a Marketplace **SERVICE** component and deployed by the tenant-local Deployer. Product source is submitted to Build, and the Marketplace artifact consumed by Deployer is a built CDK cloud assembly:

```
cloud-assembly.zip
├── marketplace.product.json
├── cdk.out/
│   ├── manifest.json
│   ├── <StackName>.template.json
│   ├── <asset-manifest>.assets.json
│   └── asset.<file-asset-hash>/
└── build/
    └── build.manifest.json
```

`marketplace.product.json` is declarative only:

```jsonc
{
  "component_id": "Product",
  "component_name": "Product",
  "bundle_type": "SERVICE",
  "context_schema_version": "1",
  "stacks": ["DataStack", "WorkflowStack", "ProductStack"],
  "base_path": "product",
  "requires": {
    "domain": true,
    "shared_usage_plan": true,
    "identity": false
  }
}
```

The manifest in the deploy artifact must not include command strings (`entrypoint`, `synth_command`, `deploy_command`, `post_deploy_command`, package-script lifecycle hooks, or alternate deploy-engine selectors). Build owns dependency installation, TypeScript loading, synthesis, and asset bundling. Deployer owns deployment-parameter resolution, asset publication, and deployment through the AWS CDK Toolkit Library or platform cloud-assembly deployer.

In source, `marketplace/app.ts` exports exactly one `createMarketplaceApp({ app, context })` factory for Build to execute during synth. The factory validates `context.schemaVersion === "1"`, instantiates `DataStack`, `WorkflowStack`, and `ProductStack`, and returns without calling `app.synth()`, invoking the CDK CLI, reading process-level deployment env vars, or performing AWS SDK side effects at synth time.

Product infrastructure consumes Build-provided Marketplace context tokens for domain, `basePath ?? "product"`, shared usage plan, and service info. Tenant-varying values must synthesize into CloudFormation parameters listed in Build metadata. Product CDK code declares only Product-owned resources and its own base-path mapping to the existing Bootstrap-created API Gateway domain. It must not create, copy, delete, or mutate the shared API Gateway custom domain, shared Usage Plan, Account DNS/certificate records, or any other service's API mapping.

### 2.2 DataStack contents

#### 2.2.1 KMS

- **`DataKey`** — symmetric customer-managed key used for DynamoDB SSE, S3 object encryption where customer-managed encryption is required, and encrypted provider/runtime artifacts. Runtime roles receive only the encrypt/decrypt/data-key permissions needed by their route or worker.

#### 2.2.2 Storage

| Bucket | Retention | Purpose |
| --- | --- | --- |
| `ProductsBucket` | Configurable lifecycle for invocation/debug artifacts; no public access | Product schemas, examples, invocation request/response data, report outputs, widgets, blobs, short-link documents, and obfuscated debug artifacts |
| `FlowTemplatesBucket` | Configurable lifecycle for template support artifacts; no public access | Compiled template definitions, template invocation request payloads, template widgets, and template-specific debug artifacts |
| `AccessLogsBucket` | 30-90 days per environment | S3 and API access logs when enabled |

Every bucket enforces `BLOCK_ALL` public access, SSL-only access, bucket-owner-enforced ownership, and encryption. Widget and short-link reads are exposed through Product API routes or presigned URLs, not public bucket policy.

#### 2.2.3 DynamoDB

All tables use `PAY_PER_REQUEST`, KMS SSE, Point-In-Time Recovery, and TTL where noted.

| Table | Keys | Indexes | Purpose |
| --- | --- | --- | --- |
| `ProductsTable` | `pk` / `sk` | `gsi1: type/gsi1sk`, `gsi2: gsi2pk/gsi2sk` | Product rows, product flows, waterfalls, invocations, report templates, SMS templates, email template metadata, provider-event cursors, short-link metadata, and status rows |
| `FlowTemplatesTable` | `pk` / `sk` | `gsi1: type/gsi1sk`, `gsi2: gsi2pk/gsi2sk` | Product Flow Templates, upsert status rows, compiled state-machine ARNs, template metadata, deleted-template cleanup cursors |
| `EmailEventsTable` | `pk` / `sk` | by product/email id | Normalised provider email events retained for status APIs |
| `IdempotencyTable` | `idempotency_key` | TTL | Optional request idempotency for template upsert, invocation start, provider webhooks, and short-link creation |

The single-table key vocabulary must keep entity ownership obvious:

```ts
type ProductItem =
  | { pk: `PRODUCT#${string}`; sk: "META"; type: "PRODUCT"; name: string }
  | { pk: `PRODUCT#${string}`; sk: `FLOW#${string}`; type: "PRODUCT_FLOW"; flow_template_name: string }
  | { pk: `PRODUCT#${string}`; sk: "WATERFALL"; type: "WATERFALL" }
  | { pk: `INVOCATION#${string}`; sk: "META"; type: "FLOW_INVOCATION" | "WATERFALL_INVOCATION" }
  | { pk: `PRODUCT#${string}`; sk: `REPORT_TEMPLATE#${string}`; type: "REPORT_TEMPLATE" };

type FlowTemplateItem =
  | { pk: `PRODUCT#${string}`; sk: `FLOW_TEMPLATE#${string}`; type: "FLOW_TEMPLATE"; state_machine_arn: string }
  | { pk: `UPSERT#${string}`; sk: "META"; type: "FLOW_TEMPLATE_UPSERT"; upsert_status: "STARTED" | "COMPLETED" | "FAILED" };
```

### 2.3 WorkflowStack contents

#### 2.3.1 State machines

| State machine | Trigger | Purpose |
| --- | --- | --- |
| `UpsertFlowTemplate` | `PUT /products/{product_name}/flow-templates/{template_name}` | Validate template DSL, normalise access paths, compile to ASL, create/update the per-template state machine, install status listener, persist upsert result |
| `InvokeTemplatedFlow` | Started indirectly by Product invocation dispatch through the compiled template ARN | Execute one template-backed Product Flow with request data, current product/flow config, callback URLs, output path, persistence settings, and debug hooks |
| `WaterfallInvocation` | `POST /products/{product_name}/invocations` with `invocation_mode="waterfall"` | Resolve ordered flow list, run template-backed flows one by one until success or exhaustion, aggregate status/errors |
| `ObfuscateInvocationData` | Debug route | Produce obfuscated request/response/template/failure artifacts for support |
| `GenerateReport` | Report route or terminal invocation step | Render report templates into blobs and optionally merge report metadata into response collection |

`InvokeTemplatedFlow` is conceptual: each Product Flow Template compiles into its own state machine, so the actual ARN is stored on the template item. The shared WorkflowStack owns roles, common task Lambdas, status-listener rules, and lifecycle controls.

#### 2.3.2 Template compiler

The compiler accepts a template document:

```ts
type ProductFlowTemplate = {
  name: string;
  product_name: string;
  definition: {
    StartAt: string;
    States: Record<string, ProductTemplateState>;
  };
  output_path?: string;
  persistence_integration?: boolean;
  return_widget_url?: boolean;
  metadata?: Record<string, unknown>;
};
```

Supported Product-specific state types:

| DSL state | Compiled behaviour |
| --- | --- |
| `StaircaseService` | Lambda task that calls another product/API using configured resource definition, request data, and invocation context |
| `DownloadPublicContent` | Lambda task that downloads external public content into a Product-owned blob |
| `SendCallback` | Conditional callback task; skipped when invocation has no callback URL |
| `PatchEvent` | Mutates the current event using declarative patch rules before the next state |

Native ASL `Choice`, `Map`, and `Parallel` are allowed and normalised so Product context, current item/index, extracted JSON paths, and invocation metadata are available to nested branches. Template compilation inserts standard `_CompleteState` and `_CatchTaskFailed` paths and wraps Lambda tasks with retry/catch defaults.

Deleted templates trigger cleanup that stops open executions where safe, removes EventBridge status listeners, and deletes the template-owned state machine only after no active invocation can reference it.

### 2.4 ProductStack contents

#### 2.4.1 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard `createRequire` banner for CommonJS dependencies. CloudWatch log retention is three months. Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with service names prefixed by `product-` and metrics namespace `product`.

Handler cohorts:

| Cohort | Examples | Trigger |
| --- | --- | --- |
| **Public API routers** | Product, schema, OpenAPI, partner, flow, template, invocation, waterfall, debug, report, SMS, email, blob/link, info routers | API Gateway REST API |
| **Template compiler workers** | ValidateTemplate, CompileTemplate, UpsertTemplateStateMachine, InstallTemplateStatusListener, PersistTemplateUpsert | Step Functions |
| **Template runtime workers** | StaircaseService, DownloadPublicContent, CompleteState, CatchFailedState, PrepareChoice, PrepareMap, SendInvocationCallback, SendCustomCallback, PatchEvent | Compiled template state machines |
| **Invocation workers** | SelectProductFlow, PersistInvocationStart, ProcessTemplatedWebhook, ResumeInvocation, ProcessStatusChange, GenerateInvocationReports, ObfuscateData | API Gateway, Step Functions, EventBridge |
| **Waterfall workers** | DefineProductFlowsOrderedList, InvokeProductFlow, SelectNextFlow, ProcessResultsAndErrors | Step Functions |
| **Comms/report workers** | SendSms, SmsStatus, SendEmail, ProcessEmailEventsWebhook, GenerateReport | API Gateway, SQS/provider webhooks |
| **Custom resources** | ApiGatewayLogCustom, ApiUsagePlanStageAttachmentCustom | CloudFormation |

#### 2.4.2 Routing fabric

- **REST API** (`RestApi` `ProductApi`) with default stage, regional endpoint type, CORS preflight for `*`, access logs, `DisableExecuteApiEndpoint: true`, and base path mapping `product` against the Bootstrap-created tenant custom domain.
- **API key attachment** uses an idempotent custom resource that reads `/account/shared-usage-plan-id` and attaches Product's stage. It must not create usage plans or API keys.
- **`GET /information`** is a `MOCK` integration returning `MarketplaceContext.serviceInfo` as supplied through Deployer.
- **Provider webhooks** are route-isolated and verify provider signatures/tokens before enqueueing any side effects.
- **Debug / obfuscation support authorizer** accepts either the tenant service API key or the configured Health API key. It resolves the tenant service key from `/account/current-service-api-key` and the Health key through `HEALTH_API_KEY_ID`, matching Deployer's dual-key support route pattern.
- **Template invocation webhooks** use `/flow-invocations/{invocation_id}/states/{step_name}/webhooks`, not the removed legacy `/products/{product_name}/invocations/{invocation_id}/webhooks` path. The legacy path may return `410 Gone` during migration but must not resume an execution.

#### 2.4.3 IAM (high-level)

- Per-route Lambda roles are least-privilege. CRUD routes get only the table/bucket operations for their entity.
- Template compiler workers can create/update/delete Step Functions state machines only with Product-owned name/tag constraints and can manage only Product-owned EventBridge rules/targets.
- Template runtime workers can call Product-owned buckets/tables and the configured product endpoints. External calls must flow through typed product clients.
- `states:SendTaskSuccess` / `states:SendTaskFailure` are allowed only for workers that receive task tokens.
- SMS/email workers can access only the configured provider secrets and SSM parameters they require.
- No runtime role receives wildcard `apigateway:*`, `states:*`, `dynamodb:*`, or `s3:*` in the target implementation.

### 2.5 Configuration surface

Runtime configuration is read from env vars and SSM at cold start, with route-local config readers so optional integrations cannot break unrelated routes.

| Key | Source | Used by |
| --- | --- | --- |
| `PRODUCTS_TABLE_NAME` | DataStack output | Product, flow, invocation, report, SMS, email, status routers |
| `FLOW_TEMPLATES_TABLE_NAME` | DataStack output | Template API, compiler, invocation dispatch |
| `PRODUCTS_BUCKET_NAME` | DataStack output | Schemas, examples, invocations, reports, blobs, widgets, short links |
| `FLOW_TEMPLATES_BUCKET_NAME` | DataStack output | Template payloads, template widgets, template debug artifacts |
| `UPSERT_FLOW_TEMPLATE_STATE_MACHINE_ARN` | WorkflowStack output | Template upsert API |
| `WATERFALL_STATE_MACHINE_ARN` | WorkflowStack output | Invocation API |
| `DOMAIN_NAME` | `MarketplaceContext.tenant.subdomain` / Deployer `Subdomain` parameter | URL construction for widgets, callbacks, links |
| `SHARED_USAGE_PLAN_ID_SSM_PARAM` | `MarketplaceContext.sharedUsagePlanIdSsmParam` or `/account/shared-usage-plan-id` | Shared Usage Plan stage attachment |
| `TENANT_SERVICE_API_KEY_SSM_PARAM` | `/account/current-service-api-key` | Debug / obfuscation dual-key authorizer |
| `HEALTH_API_KEY_ID` | Deployer / install parameter, nullable | Optional Health key accepted by debug / obfuscation support routes |
| `SERVICE_INFO` | `MarketplaceContext.serviceInfo` | `/information` mock payload and service metadata |
| `PRODUCT_NAME` | static `Product` | Tags, logs, Product self-identification |
| `PRODUCT_ID` / `INVOCATIONS_API_ID` / `SEND_EMAIL_API_ID` | Marketplace `product_id` and API ids for Product's own registration | Health/Finance metrics |
| `MARKETPLACE_API_URL` / connection config | SSM / env | Product identifier, product API, and configuration validation |
| `PERSIST_API_URL` | SSM / env | Request/response collection persistence |
| `ACCOUNT_API_URL` / `CONNECT_API_URL` | SSM / env | Credential/configuration lookup |
| `SMS_PROVIDER_CONFIG_*` | SSM / Secrets Manager | SMS send/status |
| `EMAIL_PROVIDER_CONFIG_*` | SSM / Secrets Manager | Email send/domain/event workflows |
| `POWERTOOLS_*` | env | Logging, tracing, metrics |

---

## 3. Data Model & Contracts

### 3.1 Response envelope

Product preserves the legacy response style where successful routes return the route-specific JSON payload and errors return:

```json
{
  "message": "Flow template with name 'x' is not found."
}
```

The target implementation should also emit structured internal errors with a stable tag:

```ts
type ProductError = {
  type:
    | "BadRequest"
    | "ProductNotFound"
    | "ProductConflict"
    | "FlowTemplateNotFound"
    | "TemplateCompileFailed"
    | "InvocationNotFound"
    | "ExternalProductCallFailed"
    | "InternalServerError";
  message: string;
  details?: Record<string, unknown>;
};
```

HTTP mapping:

| HTTP | Tags |
| --- | --- |
| 400 | `BadRequest`, validation failures, invalid template definitions |
| 401/403 | missing/invalid API key, invalid Health API key, invalid provider webhook signature |
| 404 | `ProductNotFound`, `ProductFlowNotFound`, `FlowTemplateNotFound`, `InvocationNotFound`, template/report/SMS/email entity not found |
| 409 | `ProductConflict`, duplicate product/flow/template, duplicate default flow |
| 410 | removed legacy flow webhook path |
| 422 | `ExternalProductCallFailed`, Marketplace definitively rejected a product/API/configuration id, provider operation rejected |
| 500 | fallback `InternalServerError`, compile/runtime bugs |
| 503 | transient AWS SDK, Marketplace, provider, or downstream product failure |

Every response includes CORS headers, `Strict-Transport-Security`, and an echoed `X-Sc-Health-Transaction-Id`.

### 3.2 Product

```ts
type Product = {
  name: string;
  metadata: {
    description: string;
    version: string;
    product_category: string;
    product_family: string;
    [key: string]: unknown;
  };
  marketplace_product_id?: string;
  product_identifier?: string; // legacy alias for marketplace_product_id
  request_schema?: JsonSchema;
  response_schema?: JsonSchema;
  product_schema?: {
    request?: Record<string, JsonSchema>;
    response?: Record<string, JsonSchema>;
    merged?: Record<string, JsonSchema>;
  };
  request_examples?: Record<string, unknown>;
  response_examples?: Record<string, unknown>;
  invocation_parameters_mapping: InvocationParameterMapping[];
  product_statuses: StatusMapping[];
  generate_reports: string[];
  generate_reports_merge_language_name?: string;
  is_staircase_product: boolean;
  openapi_settings?: {
    include_x_product_components?: string[];
    exclude_x_product_components?: string[];
  };
  base_path?: string; // Product/OpenAPI metadata only; not the service API Gateway base path
  financial_info?: {
    customer_price: Price;
    partner_price: Price[];
  };
  integrations?: Record<string, unknown>;
  validate_request: boolean;
};
```

Rules:

- `name` is ASCII and non-empty. If it contains spaces, `base_path` is required.
- `marketplace_product_id` is the canonical reference to Marketplace's `product_id`; `product_identifier` is accepted only as a legacy alias for the same value. Exactly one of them may be supplied on a request. The resolved Marketplace product id must be unique locally and must exist in Marketplace.
- Marketplace validation uses the local ontology only. Remote reference shapes such as `{ environment: { host, api_key }, value }`, host fields, or API-key fields are rejected.
- `base_path` is product-level OpenAPI/custom-endpoint metadata. It must never change Product's deployed API Gateway base path; service infrastructure always mounts at `MarketplaceContext.basePath ?? "product"`.
- `product_schema` is mutually exclusive with `request_schema`, `response_schema`, `request_examples`, and `response_examples`.
- `openapi_settings` may include or exclude components, not both.
- Product create stores the row and schema/example artifacts atomically from the caller's perspective: either all product definition artifacts are visible or the route fails.

### 3.3 Product Flow Template

```ts
type ProductFlowTemplate = {
  product_name: string;
  name: string;
  definition: ProductTemplateDefinition;
  state_machine_arn: string;
  output_path?: string;
  persistence_integration?: boolean;
  return_widget_url?: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  last_update_at: string;
};
```

`PUT /products/{product_name}/flow-templates/{template_name}` returns `202 Accepted`:

```json
{
  "upsert_id": "uuid",
  "upsert_status": "STARTED",
  "started_on": "2026-05-08T00:00:00Z",
  "input_data": {
    "product_name": "income",
    "name": "verify_income"
  }
}
```

`GET /flow-template-upserts/{upsert_id}` returns `STARTED | COMPLETED | FAILED`, `failure_reason?`, and the compiled template fields that matter to callers (`state_machine_arn`, `output_path`, `persistence_integration`).

### 3.4 Template-backed Product Flow

```ts
type ProductFlow = {
  name: string;
  flow_template_name: string;
  active: boolean;
  default_product_flow: boolean;
  default_vendor_flow: boolean;
  tags?: string[];
  metadata?: { widget_expiration_hours?: number; [key: string]: unknown };
  partner_product_name?: string;
  product_api_id?: string;
  product_api_identifier?: string;
  configuration_id?: string;
  platform?: string;
  vendor_name?: string;        // selection/reporting metadata only
  vendor_status?: "active" | "inactive" | "pending";
  report_documents?: ReportDocumentConfig;
  financial_info?: FlowFinancialInfo;
  mocks?: FlowMock[];
  return_widget_url?: boolean;
  merge_request_response_collections?: boolean;
  connector_output_data_url_path?: string;
  convert_to_staircase_version?: boolean;
  types_to_merge?: string;
  verification_type?: string;
  byoc?: boolean;
};
```

Rules:

- `flow_template_name` is required on create and must reference an existing Product Flow Template for the same product.
- Updates may change `flow_template_name`, but the new template must exist before the row is written.
- `vendor_name`, `flow_name`, `input_language_name`, `output_language_name`, and related legacy fields may remain only as metadata, selection labels, and report-mapping inputs on a template-backed flow. They do not define a flow by themselves and do not trigger a legacy Connector/Translator execution path.
- A product may have at most one `default_product_flow` and at most one `default_vendor_flow` per `vendor_name`.
- Tags are stored in queryable prefixed attributes and returned as a plain string list.
- `product_api_id` is the canonical Marketplace API id. `product_api_identifier` is accepted only as a legacy alias for the same value. Exactly one of them may be supplied on a flow or mock entry.
- `product_api_id` / `product_api_identifier`, `configuration_id`, and mock API references must exist under the Product's resolved Marketplace `product_id`: Product validates APIs with `GET /ontology/products/{product_id}/api/{api_id}` and configurations with `GET /ontology/products/{product_id}/configurations/{configuration_id}`.
- Product stores only scalar Marketplace ids for product/API/configuration references. It must not persist remote host/API-key reference shapes or perform Marketplace-to-Marketplace ontology lookups.

### 3.5 Invocation

```ts
type ProductInvocationRequest = {
  data?: unknown;
  options?: Record<string, unknown>;
  product_flow_name?: string;
  vendor_name?: string;
  tags?: string[];
  invocation_mode?: "single" | "waterfall";
  callback_url?: string;
  create_response_collection?: boolean;
  partner_configuration?: Record<string, unknown> | Array<{ partner_name: string; configuration: unknown }>;
  debug_config?: { dry_run?: boolean; [key: string]: unknown };
};
```

Dispatch:

1. Load the Product.
2. Validate request data against the Product request schema when configured.
3. Resolve a Product Flow:
   - explicit `product_flow_name`;
   - otherwise active flows filtered by `vendor_name`, `platform`, and tags;
   - otherwise default flow, exact tag match, or first active flow.
4. Assert the resolved Product Flow has `flow_template_name`; if not, fail with `400 BadRequest` because legacy flows are removed.
5. Load the Product Flow Template and start its compiled `state_machine_arn`.
6. Persist invocation metadata, request payload, optional request collection, widget URL, and callback data.

The accepted response is:

```json
{
  "invocation_id": "uuid",
  "invocation_status": "STARTED",
  "transaction_id": "transaction",
  "request_collection_id": "collection",
  "response_collection_id": "collection",
  "widget_url": "https://tenant.example.com/product/widgets/uuid.html"
}
```

### 3.6 Waterfall

```ts
type ProductWaterfall = {
  waterfall: Array<{
    flow_name: string;
    order?: number;
    stop_on_status?: "SUCCEEDED" | "FAILED" | "ANY";
  }>;
};
```

Waterfall execution resolves every `flow_name` to a template-backed Product Flow before any child invocation starts. If any flow lacks `flow_template_name`, the waterfall request fails before side effects. Product then runs flows in configured order until one returns a successful terminal result or the waterfall exhausts all configured flows.

### 3.7 Reports, SMS, and email

Reports:

- Report templates are Product-owned named templates.
- `POST /products/{product_name}/reports` renders a report from product output data and returns blob metadata/download URLs.
- Invocation terminal steps may generate reports from `generate_reports` or `report_documents` and merge report mapping output into the response collection.

SMS:

- Product owns SMS templates and send/status routes.
- Provider credentials are read through configured Account/Connect/provider stores.
- Send returns a provider message id and status route maps provider state to Product response shape.

Email:

- Product owns email templates, sender-domain routes, send route, and provider event webhook ingestion.
- Provider webhooks are deduped and stored so `GET /products/{product_name}/emails/{email_id}/events` returns a stable event history.

### 3.8 Debug and obfuscation

Debug APIs expose operator-only invocation detail: selected product flow, template definition, per-step status, downstream product calls, failure reason, request/response collection ids, and execution history pointers. Obfuscation creates a separate artifact that strips or masks PII while preserving enough template and error context for support.

---

## 4. Synchronous APIs

### 4.1 Product CRUD

- `POST /products` validates the Product body, checks local uniqueness by name and resolved Marketplace product id, validates Marketplace registration when `marketplace_product_id` or legacy `product_identifier` is supplied, persists the Product row, and stores schemas/examples.
- `PATCH /products/{product_name}` updates mutable fields and schema artifacts.
- `DELETE /products/{product_name}` removes the product only when there are no in-flight invocations or active flow-template upserts for that product.

### 4.2 Schema and OpenAPI APIs

- Schema reads return stored JSON schemas or versioned slices from `product_schema`.
- Element routes derive request/response element lists from JSON schema.
- Validation route validates a caller-supplied collection against Product's request elements/schema.
- OpenAPI endpoint-definition routes store product-specific endpoint metadata, and `GET /products/{product_name}/openapi` merges Product metadata, configured endpoint definitions, and schema information.

### 4.3 Product Flow Template APIs

- Upsert is asynchronous and idempotent by `(product_name, template_name, definition_hash)` where an idempotency key is supplied.
- Reads support pagination with `after_name` and `sort=asc|desc`.
- Delete marks the template deleted and starts cleanup of state machine/rules; it does not delete historical invocation debug artifacts.

### 4.4 Product Flow APIs

- Create/update validates the referenced template, Marketplace product API/configuration ids, optional Language/Translator references used for report/data mapping, report-document compatibility, mock definitions, default-flow uniqueness, and tag shape.
- Rows lacking `flow_template_name` are invalid in the target model. Import/migration tooling must either attach a valid template or drop the row; public read routes should not expose them as supported flows.

### 4.5 Invocation APIs

- `POST /products/{product_name}/invocations` starts a template-backed flow or waterfall.
- `GET /products/{product_name}/invocations/{invocation_id}` returns status and metadata, never raw sensitive request/response bodies.
- Webhook/resume routes validate invocation id, step name, callback token/task token correlation, and update only the matching in-flight execution.

---

## 5. Asynchronous Pipelines

### 5.1 Flow-template upsert

```
UpsertFlowTemplate API
  → Put STARTED upsert row
  → UpsertFlowTemplate SFN
      → ValidateTemplate
      → NormaliseAccessPaths
      → CompileDefinitionToASL
      → CreateOrUpdateStateMachine
      → InstallStatusChangeRule
      → PersistTemplateAndCompleteUpsert
```

Failures persist `upsert_status="FAILED"` with a bounded `failure_reason`. Invalid ASL never leaves a partially active template: the existing compiled state machine remains attached until the replacement has compiled and updated successfully.

### 5.2 Templated invocation

```
Invocation API
  → Resolve template-backed Product Flow
  → Store invocation + request payload
  → Start template state machine
      → Product-specific ASL states
      → CompleteState or CatchFailedState
      → EventBridge status listener
      → StatusChangeNotification
```

Status changes update the invocation row and emit Health/Finance metrics. For successful template invocations, Product emits cold-start and overhead metrics and does not run legacy metric reconstruction.

### 5.3 Waterfall invocation

```
WaterfallInvocation
  → Define ordered Product Flow list
  → InvokeProductFlow (template-backed only)
  → Inspect result
      ├── success → terminal success
      └── failure → SelectNextFlow or terminal failure
  → ProcessResultsAndErrors
```

Waterfall child flows carry the parent `waterfall_invocation_id`, callback URL, response collection settings, and original request context.

### 5.4 Provider events

Email/SMS provider callbacks are verified, deduped, normalised, and persisted before returning success to the provider. Provider callbacks must not synchronously call report generation, Persist, Marketplace, or downstream products.

---

## 6. Cross-cutting Concerns

### 6.1 Observability

- Logs are structured JSON with request id, product name, product flow name, template name, invocation id, transaction id, collection ids, state name, execution ARN, and downstream product call metadata where applicable.
- Every public route reads or mints `X-Sc-Health-Transaction-Id`, echoes it on the response, and propagates it to Marketplace, Persist, Account, Connect, Health, Finance, SMS, email, and downstream product clients. Internal Step Functions executions use the transaction id as the execution name where the AWS naming constraints allow it; otherwise they store the transaction id on the execution input and all status/debug rows.
- Metrics include `product_created`, `template_upsert_started`, `template_upsert_failed`, `invocation_started`, `invocation_succeeded`, `invocation_failed`, `waterfall_started`, `waterfall_succeeded`, `waterfall_failed`, `sms_sent`, `email_sent`, `report_generated`, and provider webhook outcomes.
- Health metrics are emitted for Product's own invocation API and, when a resolved Marketplace product id and API id are configured, for the invoked catalog product/API.
- Finance metrics are emitted on successful invocations when Marketplace/environment data supplies the organisation context.

### 6.2 Security

- API keys are never logged.
- Request/response payload logs are redacted by default; full payloads live only in Product-owned buckets and are accessed through explicit debug/obfuscation routes.
- Provider webhook signature verification uses the raw request body.
- Template definitions are validated before compile and cannot inject arbitrary Lambda ARNs, IAM roles, shell commands, or unsupported AWS service integrations.
- Product templates may call only approved product clients and explicitly configured HTTPS endpoints.

### 6.3 Service/module structure

The target implementation should organise behaviour as small TypeScript services with typed interfaces and injectable dependencies:

- `products/*` for Product CRUD, schemas, OpenAPI, partner metadata.
- `flow-templates/*` for DSL schema, compiler, state-machine lifecycle, template storage.
- `flows/*` for template-backed Product Flow CRUD and selection.
- `invocations/*` for dispatch, status, callbacks, waterfall, debug, obfuscation.
- `reports/*`, `sms/*`, `email/*`, `blobs/*` for supporting capabilities.
- `clients/*` for Marketplace, Account, Connect, Persist, Health, Finance, SMS, and email providers.
- `http/*` for route definitions, response mapping, auth, and OpenAPI generation.

### 6.4 Testing strategy

- Unit tests use Vitest and cover schemas, route handlers, service factories, template compiler transforms, invocation selection, waterfall planning, provider webhook verification, and error-to-status mapping.
- ASL tests snapshot compiled template definitions and validate them with Step Functions Local where feasible.
- Integration tests hit a deployed Product stage with `PRODUCT_API_URL`, `AWS_PROFILE`, and `SERVICE_API_KEY`.
- OpenAPI generation test fails when `docs/openapi.json` differs from route definitions.
- Regression tests must prove:
  - a Product Flow without `flow_template_name` cannot be invoked;
  - a waterfall containing any non-template flow fails before side effects;
  - the removed legacy flow webhook path cannot resume executions;
  - template-backed invocations still support callback, widget, persistence, debug, obfuscation, reports, SMS/email side routes, and status metrics.

### 6.5 CI/CD

The target repo exposes:

```bash
pnpm install
pnpm check
pnpm lint
pnpm test
pnpm api:spec
pnpm cdk:synth
pnpm cdk:deploy
pnpm cdk:destroy
```

CI caller workflows expose `just check`, `just test`, `just cdk:synth`, and `just cdk:deploy`, using the shared workflows. Generated OpenAPI is checked in.

---

## 7. Operational Playbook

### 7.1 Prerequisites

- Tenant custom domain and shared Usage Plan created by Bootstrap.
- Tenant service API key and shared Usage Plan are created by Account/Bootstrap. Product only attaches its API stage to the shared Usage Plan via `SHARED_USAGE_PLAN_ID_SSM_PARAM`; it does not receive or mint a Deployer-owned service key.
- Marketplace product registration for Product itself and any Marketplace product/API/configuration ids referenced by Product flows.
- SSM/Secrets Manager values for downstream Product clients and SMS/email providers where those features are enabled.

### 7.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy
pnpm cdk:destroy
```

Stack outputs include `ProductApiUrl`, `ProductsTableName`, `FlowTemplatesTableName`, `ProductsBucketName`, `FlowTemplatesBucketName`, `UpsertFlowTemplateStateMachineArn`, and `WaterfallStateMachineArn`. Stable SSM parameters publish the API URL and state-machine ARNs for other products.

### 7.3 Smoke tests

After deploy:

1. Create a Product with request/response schemas.
2. Upsert a simple Product Flow Template and poll until `COMPLETED`.
3. Create a Product Flow referencing that template.
4. Invoke the Product Flow and poll invocation status until terminal success.
5. Configure a two-flow waterfall using template-backed flows and confirm it stops on success.
6. Verify `GET /products/{product_name}/openapi`, report-template CRUD, SMS-template CRUD, email-template CRUD, widget/short-link, and debug/obfuscation routes.
7. Confirm an attempted Product Flow without `flow_template_name` returns `400` and cannot be selected for invocation.

### 7.4 Rollback

1. Re-deploy the last-known-good bundle through Deployer.
2. Do not delete `ProductsTable`, `FlowTemplatesTable`, or buckets during rollback.
3. Re-run smoke tests for template upsert and invocation.
4. Inspect in-flight template upserts and invocations for stuck states before declaring rollback complete.

---

## 8. Re-creation Checklist

1. Repo skeleton: pnpm workspace, TypeScript, CDK v2, Vitest, ESLint, Prettier, OpenAPI generator, `justfile`, shared CI callers.
2. Build/Marketplace/Deployer cloud-assembly contract: source has `marketplace.product.json`, `marketplace/app.ts`, `createMarketplaceApp`, Marketplace context validation, `base_path="product"`, and no command-string deploy hooks; Build output has `cdk.out/manifest.json`, built assets, `build/build.manifest.json`, and no product source.
3. CDK stacks: `DataStack`, `WorkflowStack`, `ProductStack`, custom resources for API Gateway logs and shared Usage Plan stage attachment.
4. Route definitions for every capability group in §1.2, plus generated `docs/openapi.json`.
5. Product/schema/OpenAPI/partner modules.
6. Product Flow Template DSL schemas, compiler, Step Functions lifecycle service, status listener, cleanup worker.
7. Product Flow CRUD with mandatory `flow_template_name` and rejection of legacy non-template rows.
8. Invocation dispatch that starts only compiled template state machines.
9. Waterfall workflow that runs only template-backed flows.
10. Debug, obfuscation, widget, blob, short-link, status, and provider webhook modules.
11. Report, SMS, and email modules with provider clients and route-local configuration.
12. Typed clients for Marketplace, Account, Connect, Persist, Health, Finance, SMS, and email providers.
13. Tests for template-only flow execution, removed legacy paths, compiler output, invocation lifecycle, waterfall, and all retained supporting features.

---

## 9. Acceptance Criteria

A re-implementation is functionally complete when:

- Product name and service metadata are **Product** everywhere: tags, `/information`, logs, metrics, and Marketplace registration.
- The Product build satisfies the Marketplace/Deployer contract: source declares Product as a `SERVICE` component with `base_path="product"`, `marketplace/app.ts` exports `createMarketplaceApp` for Build-time synth, Build emits a `CDK_CLOUD_ASSEMBLY` artifact with `cdk.out/manifest.json`, and no product-supplied deploy/synth command fields are present.
- `POST /products` supports the Product schema/features in §3.2 and validates `marketplace_product_id` plus the legacy `product_identifier` alias against Marketplace.
- Product Flow Templates can be upserted, listed, read, deleted, compiled to Step Functions, and cleaned up after deletion.
- Product Flow create/update requires a valid `flow_template_name` for any runnable flow.
- Invocations and waterfalls can execute only template-backed Product Flows.
- The legacy built-in/default connector flow state machine, legacy invocation webhook path, and legacy metrics reconstruction are not present in the target build.
- All non-flow features from the legacy service remain available: schemas/examples, elements/validation, OpenAPI endpoint definitions, partner metadata, reports, SMS, email, blobs, widgets, short links, status, debug, obfuscation, and `/information`.
- Template-backed invocations support callbacks, resume, persistence integration, output-path handling, widgets, report generation, Health metrics, Finance metrics, and debug artifacts.
- Debug and obfuscation support routes accept the tenant service API key and, when configured, the Health API key through the documented dual-key authorizer without exposing either key in logs.
- API Gateway is mounted under `/product` on the Bootstrap-created tenant domain and attached to the shared Usage Plan without creating a separate usage plan.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, structured Powertools logs/metrics/tracing, and least-privilege IAM.
- `docs/openapi.json` is generated from route definitions and is not stale.
- Unit, ASL, OpenAPI, and deployed integration tests cover the critical paths and the explicit removal of legacy flows.
