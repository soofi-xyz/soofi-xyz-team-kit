# Translate Service - Product Requirements Document (PRD)

Authoritative blueprint for building the **Translate** data-translation service as a new Golden Path project: **TypeScript everywhere**, AWS CDK v2 only, API-registered partner languages, deploy-registered TypeScript mappings, and predictable execution telemetry.

---

## 1. Product Overview

### 1.1 Mission

Translate is a serverless product that converts structured payloads from one registered language to another using explicit, versioned TypeScript mapping modules.

The product exists for cases where the platform needs repeatable data shape translation between partner payloads, internal service contracts, and lexicon-compliant objects. A **language** is a named, versioned data contract registered through the API with schema, ownership metadata, and examples. A **mapping** is checked-in TypeScript that references a source language and target language, then uses normal TypeScript code to produce the output.

### 1.2 Primary user surface

A single AWS API Gateway REST API mounted under `/translate/`, API-key authorised through the tenant shared Usage Plan. The service exposes:

| Verb | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/translate/languages/{language_name}/register` | Register or update a partner language from JSON Schema plus metadata |
| `GET` | `/translate/registrations/{job_id}` | Read asynchronous language registration status |
| `GET` | `/translate/languages` | List registered languages with company/product filters |
| `GET` | `/translate/languages/{language_name}` | Retrieve language metadata, versions, schema digest, and examples/artifact links |
| `GET` | `/translate/mappings` | List deployed TypeScript mappings and latest enabled versions |
| `GET` | `/translate/mappings/{mapping_name}` | Retrieve metadata for one deployed mapping, including language references and bundle digest |
| `POST` | `/translate/validate` | Validate an input payload against a mapping source language without creating an execution |
| `POST` | `/translate/preview` | Synchronously translate a small payload for development and release smoke checks |
| `POST` | `/translate/executions` | Start an asynchronous translation execution |
| `GET` | `/translate/executions/{execution_id}` | Read execution status, timings, warnings, and artifact pointers |
| `GET` | `/translate/executions/{execution_id}/artifacts` | Mint presigned URLs for input, output, warnings, coverage, and debug artifacts |
| `GET` | `/translate/executions/{execution_id}/logs` | Return a normalised Step Functions / Lambda execution history summary |
| `GET` | `/translate/information` | Static service metadata (`MOCK` integration, no API key) |

Every public route except `/translate/information` is API-key-gated through the tenant shared Usage Plan. Every `PUT /translate/languages/{language_name}/register` returns `202 Accepted` with a server-generated `job_id`. Every `POST /translate/executions` returns `202 Accepted` with a server-generated `execution_id`. Small `POST /translate/preview` requests return `200 OK` with the translated output inline and are hard-limited by payload size and timeout.

### 1.3 Non-goals

- Translate does **not** provide a schema-authoring UI. Partner languages are registered by API using caller-supplied schemas and metadata.
- Translate does **not** provide a custom mapping operation DSL. Mapping authors use normal TypeScript inside reviewed, tested, bundled modules.
- Translate does **not** accept runtime mapping code from API callers. Mapping code is TypeScript source reviewed, tested, bundled, and deployed either with the Translate runtime service or as Marketplace `DATA` mapping-pack bundles.
- Translate does **not** own the shared lexicon. It may emit lexicon-compliant JSON objects and call Persist, but lexicon governance and graph persistence remain owned by their products.
- Translate does **not** keep translated payloads forever. Execution artifacts are retained only for the configured operational window.
- Translate does **not** create the tenant custom domain or usage plan. Bootstrap and Deployer provide those shared inputs; Translate maps only its `/translate` base path.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the implementation.

1. **Step Functions is the workflow implementation layer.** Language registration and asynchronous translation execution are STANDARD Step Functions workflows. Branching, retries, catches, callback dispatch, and terminal failure handling are expressed as ASL primitives. There is no in-Lambda workflow orchestrator and no SQS-chained worker runtime.
2. **Translate runtime is a Marketplace `SERVICE` component.** The runtime service is distributed as a Marketplace source snapshot and deployed by the tenant-local Deployer. The snapshot MUST satisfy Deployer's `marketplace.product.json` + `marketplace/app.ts` contract and deploy exactly the service-owned API, workflows, tables, buckets, and custom resources.
3. **Mapping packs are Marketplace `DATA` components when released independently.** Partner or product-specific mapping modules that should version independently from the Translate runtime are bundled as Marketplace `DATA` components. A mapping pack provisions/imports checked-in TypeScript mapping modules, fixtures, and manifest metadata into Translate-owned storage/catalog resources; it has no public runtime and no `deploy_time_dependencies`.
4. **Shared routing is owned upstream.** Bootstrap creates the tenant custom domain and shared Usage Plan. Deployer passes domain and usage-plan context into Translate. Translate creates only its own base-path mapping under `translate` and idempotently attaches its API stage to the shared plan.
5. **Mapping execution is side-effect constrained by build-time and runtime controls.** Mapping modules are ordinary TypeScript, but they run through Translate's restricted mapping runner. Static validation rejects forbidden imports, and runtime execution exposes only validated JSON input, mapping context, and approved deterministic helpers.

### 2.1 Stacks (AWS CDK)

The Translate runtime `SERVICE` CDK app is a single stack:

```
bin/app.ts
`-- TranslateStack    # REST API, Lambdas, Step Functions, DynamoDB,
                      # S3 artifacts, language registration, mapping manifest,
                      # API mapping, OpenAPI generation inputs
```

Translate does not require a VPC by default. If a future mapping needs private-network access, that must be represented as a separate service integration owned by the product that needs the access, not as arbitrary network access from mapping code.

Mapping-pack `DATA` components may have their own data-only CDK stack. Such stacks must not create public APIs, custom domains, usage plans, schedulers, or long-running runtimes; they only publish mapping assets and catalog metadata into the Translate runtime's documented import surface.

### 2.2 TranslateStack contents

#### 2.2.1 Storage

| Bucket | Retention | Purpose |
| --- | --- | --- |
| `TranslateArtifactsBucket` | 30-day lifecycle by default | Original input, translated output, warnings, coverage, execution logs, callback payloads, and validation reports under `executions/YYYY/MM/DD/<executionId>/...` |
| `TranslateLanguageAssetsBucket` | retained while stack exists | Registered language schemas, examples, generated TypeScript type snapshots, and registration diagnostics under `languages/<languageName>/<version>/...` |
| `TranslateMappingManifestBucket` | retained while stack exists | Generated mapping manifests and bundle metadata produced from runtime-owned mappings and deployed mapping-pack `DATA` bundles |

All buckets enforce `BLOCK_ALL` public access, SSL-only access, S3-managed encryption, and bucket-owner-enforced object ownership.

#### 2.2.2 DynamoDB

| Table | Key | Indexes | Notes |
| --- | --- | --- | --- |
| `TranslateRegistrationsTable` | PK `jobId` | `gsi1: languageName / createdAt` | Asynchronous language registration state, errors, schema digest, artifact pointers, callback state, TTL |
| `TranslateLanguagesTable` | PK `languageName`, SK `version` | `gsi1: companyName#productName / updatedAt`, `gsi2: status / updatedAt` | Registered language metadata, schema/example artifact pointers, current status, digest |
| `TranslateExecutionsTable` | PK `executionId` | `gsi1: mappingName / createdAt`, `gsi2: idempotencyKey / mappingName` | Execution state, callback state, timing metadata, artifact pointers, warnings summary, TTL |
| `TranslateMappingCatalogTable` | PK `mappingName`, SK `version` | `gsi1: status / updatedAt` | Deploy-time metadata only; executable mapping remains in bundled TypeScript |

Tables use `PAY_PER_REQUEST`, AWS-managed encryption, PITR enabled, and TTL on registration/execution rows. Mapping rows are written by a CDK custom resource from the generated runtime manifest and by mapping-pack `DATA` bundles that target the same catalog contract.

#### 2.2.3 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard `createRequire` banner for CommonJS dependencies. Logging is JSON with three-month CloudWatch log retention. Runtime code uses AWS Lambda Powertools for logger, tracer, and metrics.

| Function | Memory | Timeout | Trigger | Purpose |
| --- | ---: | ---: | --- | --- |
| `TranslateApiHandler` | 512 MB | 30 s | API Gateway REST API | Router for `/translate/*` |
| `TranslateRegisterLanguage` | 512 MB | 60 s | Step Functions | Validate registration request, store schema/example artifacts, create RUNNING registration state |
| `TranslateFinalizeLanguage` | 1024 MB | 5 min | Step Functions | Validate schema, compute digest/type snapshot, upsert language catalog row, complete registration |
| `TranslatePreviewWorker` | 1024 MB | 30 s | Lambda invoke from API handler | Synchronous limited translation preview |
| `TranslatePrepareExecution` | 512 MB | 60 s | Step Functions | Resolve request, validate mapping/language references, store input artifact, create RUNNING state |
| `TranslateApplyMapping` | 1024 MB | 15 min | Step Functions | Materialise validated input, resolve mapping metadata, invoke the restricted runner, and normalise mapper output |
| `TranslateMappingRunner` | 2048 MB | 15 min | Lambda invoke from `TranslateApplyMapping` | Execute one bundled TypeScript mapping module in the restricted mapping runtime |
| `TranslateValidateAndStore` | 1024 MB | 5 min | Step Functions | Validate output, compute coverage, store artifacts, update DDB |
| `TranslateCallbackWorker` | 512 MB | 60 s | Step Functions | POST terminal callback when provided |
| `TranslateFailureHandler` | 512 MB | 60 s | Step Functions catch | Persist FAILED/TIMEOUT state and diagnostic artifact |
| `TranslateMappingCatalogWriter` | 256 MB | 60 s | CloudFormation custom resource | Load generated manifest and upsert mapping catalog rows |

Mapping functions are loaded only by `TranslateMappingRunner`. They receive the validated input, request context, registered source/target language metadata, and deterministic helper library. They are normal TypeScript functions, not declarative operations. They must not import AWS SDK clients, make network calls, read environment variables, use filesystem access, or mutate global state.

#### 2.2.4 Routing fabric

- **REST API** (`RestApi` `TranslateApi`) with default stage `${stage}`, regional endpoint, CORS preflight for `*`, a dedicated access log group, `DisableExecuteApiEndpoint: true`, gateway response normalisation, and API-key requirement for every public route except `GET /information`.
- **GET `/information`** is an API Gateway `MOCK` integration returning the Deployer-supplied `ServiceInfo` JSON with standard CORS / HSTS headers and no API key.
- **API Gateway custom domain mapping** under base path `translate` against the Bootstrap-created tenant domain supplied through Deployer's `MarketplaceContext.domain`.
- **Dynamic Custom Resources**:
  - `ApiUsagePlanStageAttachmentCustom` reads the Bootstrap-managed shared Usage Plan id from `/account/shared-usage-plan-id` (or the `MarketplaceContext.sharedUsagePlanIdSsmParam` override) and idempotently adds this API stage to that plan. It MUST NOT create a Usage Plan or bind an API key.
  - `ApiGatewayLogCustom` wires API Gateway access logging for the stage.
- **Step Functions**:
  ```
  RegisterLanguage
    -> FinalizeLanguage
    -> RegistrationCallback?
         -> CallbackWorker
         -> Success

  PrepareExecution
    -> ApplyMapping
    -> ValidateAndStore
    -> ShouldSendCallback?
         -> CallbackWorker
         -> Success

  Any unhandled error -> FailureHandler -> Fail
  ```
- **OpenAPI** generated from route-definition source by `scripts/generate-openapi.ts`; generated `requirements/swagger.yml` is checked in for Marketplace documentation publication. A JSON copy may also be emitted for local tooling, but `requirements/swagger.yml` is the Marketplace-facing artifact.

#### 2.2.5 IAM (high-level)

- API and workflow Lambdas can read the mapping manifest, read language rows, read/write registration and execution rows, and read/write only the artifact prefixes they own.
- Runtime and mapping-pack custom resources can write only `TranslateMappingCatalogTable` rows and read only the mapping manifest artifacts they own.
- Callback worker has outbound HTTPS only through normal Lambda egress and must redact callback URLs in logs.
- Mapping runner code has no data-plane AWS permissions; AWS SDK, filesystem, process/env, network, and dynamic import access are rejected by build-time validation and blocked by the restricted runtime linker.
- Workers that call Step Functions task callbacks use `states:SendTaskSuccess` / `states:SendTaskFailure` only when required by the workflow implementation.

### 2.3 Configuration surface (env vars)

Runtime configuration is read once on cold start. Missing required values fail closed for the affected router or worker, without breaking unrelated routes.

CloudFormation / Marketplace context inputs supplied by Deployer:

| Input | Default | Purpose |
| --- | --- | --- |
| `MarketplaceContext.domain` | required for `SERVICE` deploys | Existing tenant API Gateway custom domain, certificate, hosted zone, and regional domain handles |
| `MarketplaceContext.basePath` | `translate` | Base path for the API Gateway mapping |
| `MarketplaceContext.sharedUsagePlanIdSsmParam` | `/account/shared-usage-plan-id` | Shared Usage Plan id source for stage attachment |
| `MarketplaceContext.serviceInfo` | required | JSON returned by `GET /translate/information` |
| `MarketplaceContext.customParameters` | `{}` | Non-secret deploy-time overrides consumed by Translate CDK only when explicitly documented |

| Key | Default | Used by |
| --- | --- | --- |
| `SHARED_USAGE_PLAN_ID_SSM_PARAM` | `/account/shared-usage-plan-id` | API Gateway shared Usage Plan stage attachment |
| `TRANSLATE_REGISTRATIONS_TABLE_NAME` | from CDK | API, registration workers |
| `TRANSLATE_LANGUAGES_TABLE_NAME` | from CDK | API, registration workers, workflow workers |
| `TRANSLATE_EXECUTIONS_TABLE_NAME` | from CDK | API, workflow workers |
| `TRANSLATE_MAPPING_CATALOG_TABLE_NAME` | from CDK | API, catalog writer |
| `TRANSLATE_ARTIFACTS_BUCKET` | from CDK | API, workflow workers |
| `TRANSLATE_LANGUAGE_ASSETS_BUCKET` | from CDK | API, registration workers |
| `TRANSLATE_MAPPING_MANIFEST_BUCKET` | from CDK | API, catalog writer |
| `TRANSLATE_MAPPING_MANIFEST_KEY` | `mappings/manifest.json` | API, catalog writer |
| `TRANSLATE_SERVICE_INFO` | from `MarketplaceContext.serviceInfo` | `GET /information` mock body / custom-resource nonce |
| `TRANSLATE_LANGUAGE_REGISTRATION_STATE_MACHINE_ARN` | from CDK | API language registration |
| `TRANSLATE_STATE_MACHINE_ARN` | from CDK | API submit |
| `TRANSLATE_EXECUTION_TTL_SECONDS` | `2592000` (30 d) | Execution store |
| `TRANSLATE_PREVIEW_MAX_BYTES` | `262144` (256 KiB) | Preview route |
| `TRANSLATE_ASYNC_MAX_BYTES` | `104857600` (100 MiB) | Async submit |
| `TRANSLATE_CALLBACK_TIMEOUT_MS` | `10000` | Callback worker |
| `POWERTOOLS_SERVICE_NAME` | `translate` | Logging / metrics |
| `POWERTOOLS_LOG_LEVEL` | `INFO` | Logging |
| `POWERTOOLS_METRICS_NAMESPACE` | `translate` | Metrics |

### 2.4 Marketplace and Deployer distribution contract

Translate runtime is published to Marketplace as a `SERVICE` component. The Marketplace source snapshot consumed by Deployer MUST include:

```text
source.zip
|-- marketplace.product.json
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- marketplace/
|   `-- app.ts
|-- lib/
|-- lambda/
|-- translate-mappings/
`-- requirements/
    `-- swagger.yml
```

`marketplace.product.json`:

```jsonc
{
  "component_id": "translate",
  "component_name": "Translate",
  "bundle_type": "SERVICE",
  "entrypoint": "marketplace/app.ts",
  "context_schema_version": "1",
  "stacks": ["TranslateStack"],
  "base_path": "translate",
  "requires": {
    "domain": true,
    "shared_usage_plan": true,
    "identity": false
  }
}
```

`marketplace/app.ts` exports `createMarketplaceApp({ app, context })`, validates `context.schemaVersion === "1"`, and instantiates `TranslateStack` with `context.domain`, `context.basePath`, `context.sharedUsagePlanIdSsmParam`, `context.serviceInfo`, and documented `context.customParameters`. It must not call `app.synth()`, invoke shell commands, read product-defined deployment scripts, or perform AWS SDK side effects at synth time.

Marketplace registration:

- Component `Translate` is a `SERVICE` component owned by its catalog product.
- Mapping packs that are released independently are `DATA` components. They package checked-in TypeScript mapping modules, fixture tests, generated mapping manifests, and a data-only CDK import stack/custom resource that writes assets into the Translate mapping manifest bucket and rows into `TranslateMappingCatalogTable`.
- `DATA` mapping-pack components must not declare `deploy_time_dependencies`; dependencies on Translate runtime and relevant language/catalog bundles are runtime dependencies in Marketplace terms.
- Bundle metadata uses the standard `x-amz-meta-service-*` JWT-shaped headers. `service-builder.bundle_type` must be `SERVICE` for the Translate runtime and `DATA` for mapping packs.

TranslateStack writes the following SSM parameters so mapping-pack `DATA` bundles can discover the tenant-local import surface without hardcoded resource names:

| Parameter | Value |
| --- | --- |
| `/translate/api-url` | Public API base URL |
| `/translate/state-machine/execution-arn` | Translation execution state machine ARN |
| `/translate/tables/languages` | `TranslateLanguagesTable` name |
| `/translate/tables/mapping-catalog` | `TranslateMappingCatalogTable` name |
| `/translate/buckets/mapping-manifest` | `TranslateMappingManifestBucket` name |
| `/translate/buckets/language-assets` | `TranslateLanguageAssetsBucket` name |

---

## 3. Languages And Mappings

### 3.1 Language registration

A language is a named data contract that can be used as a mapping source or target. Partner teams register languages through the API before a mapping that references them can be enabled.

`PUT /translate/languages/{language_name}/register` accepts:

```ts
{
  version?: string;                 // defaults to language_name for simple one-version partners
  format: "json";
  type: "class";
  company_name: string;
  product_name: string;
  data?: JsonSchema;
  data_url?: `https://${string}`;
  example?: JsonValue | JsonValue[];
  callback_url?: string;
}
```

Exactly one of `data` or `data_url` is required. `data_url` must be a presigned HTTPS URL with a bounded `Content-Length`; Translate does not accept caller-supplied AWS credentials or arbitrary cross-account `s3://` references. The initial product version supports JSON Schema class contracts. XML, CSV, fixed-width, and document-derived contracts can be added later as additional `format` values, but they must still register into the same language catalog shape.

The registration endpoint returns `202 Accepted`:

```ts
{
  job_id: string;
  status: "STARTED";
  language_name: string;
  version: string;
  _links: {
    status: string;
  };
}
```

The registration workflow:

1. Validates the request shape and rejects reserved names that are owned by another product.
2. Stores the original schema and examples in `TranslateLanguageAssetsBucket`.
3. Validates JSON Schema syntax and normalises defaults such as `additionalProperties`.
4. Computes `schemaDigest` and generates a TypeScript type snapshot for mapping authors.
5. Upserts `TranslateLanguagesTable`.
6. Marks the registration `COMPLETED` or `FAILED`.
7. Posts the optional callback with `job_id`, `status`, `language_name`, `version`, and `failure_reason`.

Language records expose:

```ts
{
  languageName: string;
  version: string;
  status: "ENABLED" | "DISABLED";
  companyName: string;
  productName: string;
  format: "json";
  type: "class";
  schemaDigest: string;
  schemaS3Uri: string;
  exampleS3Uri?: string;
  generatedTypesS3Uri?: string;
  createdAt: string;
  updatedAt: string;
}
```

`lexicon` is a reserved language name. Translate may expose it as a readable target/source language backed by Persist, but callers cannot register or overwrite it through Translate.

### 3.2 Mapping registration

A mapping is a checked-in TypeScript module. Runtime-owned mappings are registered by adding them to `translate-mappings/registry.ts` in the Translate `SERVICE` source snapshot. Independently released mappings are registered through Marketplace `DATA` mapping-pack bundles that carry their own registry, generated manifest, fixture tests, and data-only CDK import stack. In both cases, the build generates a manifest and a CDK custom resource writes mapping metadata into `TranslateMappingCatalogTable`.

Mappings are not authored through API JSON operations. There are no `copy`, `constant`, `arrayMap`, or other custom mapping primitives to maintain. The mapper function is normal TypeScript. Marketplace `DATA` mapping packs are the normative extension path for partner/product mappings that need a release cadence separate from the Translate runtime.

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonSchema = { readonly [key: string]: JsonValue };

export interface RegisteredLanguage {
  readonly name: string;
  readonly version: string;
  readonly schemaDigest: string;
  readonly companyName: string;
  readonly productName: string;
}

export interface TranslateHelpers {
  readonly clock: { nowIso(): string };
  readonly ids: { ulid(seed?: string): string };
  readonly phone: { normalize(value: string): string };
}

export interface TranslateContext {
  readonly executionId: string;
  readonly mappingName: string;
  readonly mappingVersion: string;
  readonly fromLanguage: RegisteredLanguage;
  readonly toLanguage: RegisteredLanguage;
  readonly requestedAt: string;
  readonly requestMetadata: Readonly<Record<string, string>>;
  readonly helpers: TranslateHelpers;
}

export interface TranslateMapping<TInput, TOutput> {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly owners: readonly string[];
  readonly fromLanguage: LanguageRef;
  readonly toLanguage: LanguageRef;
  readonly validation?: ValidationPolicy;
  readonly coverage?: CoveragePolicy;
  readonly translate: (input: TInput, context: TranslateContext) => TOutput | Promise<TOutput>;
}

export interface LanguageRef {
  readonly name: string;
  readonly version?: string;
}

export interface ValidationPolicy {
  readonly input?: "strict" | "passthrough" | "skip";
  readonly output?: "strict" | "passthrough" | "skip";
}

export interface CoveragePolicy {
  readonly requiredSourcePaths?: readonly string[];
  readonly ignoredSourcePaths?: readonly string[];
  readonly minimumReadRatio?: number;
}
```

Deploy-time validation rejects mappings that:

- fail TypeScript type checking,
- expose duplicate `name + version`,
- omit owners,
- reference disabled or missing language versions in the target environment,
- import disallowed side-effect modules such as AWS SDK clients or filesystem access,
- omit fixture tests for production-enabled mappings,
- omit Marketplace component/bundle metadata when the mapping arrives from a `DATA` mapping-pack bundle.

### 3.3 Example mapping

```ts
import { defineTranslateMapping } from "@internal/translate/mapping";
import type { PartnerApplicant } from "../generated-languages/partner-applicant";
import type { Applicant } from "../generated-languages/applicant";

export default defineTranslateMapping<PartnerApplicant, Applicant>({
  name: "partner-applicant-to-applicant",
  version: "2026-05-08",
  description: "Translate partner applicant payloads into applicant JSON.",
  owners: ["data-platform"],
  fromLanguage: { name: "partner-applicant", version: "2026-05-08" },
  toLanguage: { name: "applicant", version: "2026-05-08" },
  validation: {
    input: "strict",
    output: "strict",
  },
  coverage: {
    requiredSourcePaths: ["applicant.first_name", "applicant.last_name"],
    minimumReadRatio: 0.9,
  },
  translate(input, context) {
    const applicant = input.applicant;

    return {
      people: [
        {
          person_type: "applicant",
          first_name: applicant.first_name.trim(),
          last_name: applicant.last_name.trim(),
          phone_numbers: applicant.phones.map((phone) => ({
            number: context.helpers.phone.normalize(phone.value),
            kind: phone.type.toLowerCase(),
          })),
        },
      ],
    };
  },
});
```

The runtime validates input against the registered source language before calling `translate`, and validates output against the registered target language afterward. Mapping code can use loops, conditionals, local helper functions, libraries approved by the repo dependency policy, and typed generated language contracts.

### 3.4 Versioning

Language identity is `{ languageName, version }`. Mapping identity is `{ mappingName, version }`. Names are stable and human-readable. Versions are immutable and should normally be ISO dates or semantic versions.

Mapping catalog metadata:

```ts
{
  mappingName: string;
  version: string;
  status: "ENABLED" | "DISABLED";
  owners: string[];
  fromLanguageName: string;
  fromLanguageVersion?: string;
  toLanguageName: string;
  toLanguageVersion?: string;
  sourceSchemaDigest: string;
  targetSchemaDigest: string;
  bundleDigest: string;
  marketplaceComponentId?: string;
  marketplaceBundleId?: string;
  marketplaceBundleType: "SERVICE" | "DATA";
  createdAt: string;
  updatedAt: string;
}
```

Callers may omit `mapping_version` only when they accept the latest `ENABLED` mapping version. Executions store the resolved mapping version, bundle digest, language versions, and language schema digests, so replay and audit never depend on a moving alias.

---

## 4. Data Model & Contracts

### 4.1 Response envelope

All HTTP responses use a uniform JSON envelope.

Success:

```json
{ "ok": true, "data": {} }
```

Route-specific response examples below show the value inside the `data` member unless they explicitly show the full envelope.

Error:

```json
{
  "ok": false,
  "error": {
    "type": "TranslateMappingNotFound",
    "message": "Translate mapping was not found",
    "details": { "mappingName": "partner-applicant-to-applicant" }
  }
}
```

### 4.2 Execute request

```ts
{
  mapping_name: string;
  mapping_version?: string;
  input?: JsonValue;
  input_url?: `https://${string}`;
  idempotency_key?: string;
  callback_url?: string;
  validate_input?: boolean;       // default true
  validate_output?: boolean;      // default true
  request_metadata?: Record<string, string>;
}
```

Exactly one of `input` or `input_url` is required. `input_url` must be a presigned HTTPS URL with bounded `Content-Length`; Translate does not accept request-time AWS credentials or arbitrary cross-account `s3://` references. The initial product version supports JSON input only.

`POST /translate/executions` response:

```ts
{
  execution_id: string;
  status: "QUEUED";
  mapping_name: string;
  mapping_version: string;
  created_at: string;
  _links: {
    status: string;
    artifacts: string;
  };
}
```

### 4.3 Preview request

`POST /translate/preview` accepts the same request shape, but:

- `input` is required,
- `input_url` is not accepted,
- `callback_url` is not accepted,
- payload size must be `<= TRANSLATE_PREVIEW_MAX_BYTES`,
- result is returned inline.

### 4.4 Execution state

```ts
{
  executionId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMEOUT" | "CANCELLED";
  mappingName: string;
  mappingVersion: string;
  mappingDigest: string;
  fromLanguageName: string;
  fromLanguageVersion: string;
  fromLanguageSchemaDigest: string;
  toLanguageName: string;
  toLanguageVersion: string;
  toLanguageSchemaDigest: string;
  idempotencyKey?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  ttlEpochSeconds: number;
  inputS3Uri: string;
  outputS3Uri?: string;
  warningsS3Uri?: string;
  coverageS3Uri?: string;
  logsS3Uri?: string;
  callbackUrlHash?: string;
  callbackStatus?: "PENDING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  error?: {
    type: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
```

### 4.5 Artifact layout

Artifacts are written under:

```
s3://<TranslateArtifactsBucket>/executions/YYYY/MM/DD/<executionId>/
|-- input.json
|-- output.json
|-- warnings.json
|-- coverage.json
|-- execution.json
`-- callback.json
```

The API never returns raw artifact bodies from status routes. It returns metadata and short-lived presigned URLs through `/artifacts`.

### 4.6 Error catalogue -> HTTP status

| HTTP | Tag(s) |
| --- | --- |
| 400 | `BadRequest`, `PayloadTooLarge`, `TranslateLanguageRegistrationInvalid`, `TranslateInputValidationError`, `TranslateOutputValidationError`, `TranslatePreviewNotAllowed` |
| 404 | `TranslateLanguageNotFound`, `TranslateMappingNotFound`, `TranslateExecutionNotFound`, `TranslateRegistrationNotFound` |
| 409 | `TranslateIdempotencyConflict` |
| 422 | `TranslateLanguageSchemaInvalid`, `TranslateMappingInvalid`, `TranslateMappingCoverageError` |
| 500 | `TranslateExecutionError`, fallback `InternalServerError` |
| 503 | `TranslateStoreError`, `TranslateWorkflowStartError`, `TranslateArtifactStoreError`, `TranslateCallbackError`, `TranslateRegistrationWorkflowStartError` |

Every error is a structured tagged object with `type`, `message`, and optional `details`.

---

## 5. APIs

### 5.1 `PUT /translate/languages/{language_name}/register`

Starts asynchronous language registration. The request body follows section 3.1. The path `language_name` is authoritative; if the body also contains a language name, it must match.

The endpoint returns `202 Accepted` with `job_id`, `status=STARTED`, and a status link.

### 5.2 `GET /translate/registrations/{job_id}`

Returns registration status:

```ts
{
  job_id: string;
  status: "STARTED" | "RUNNING" | "COMPLETED" | "FAILED";
  language_name: string;
  version: string;
  created_at: string;
  finished_at?: string;
  schema_digest?: string;
  failure_reason?: string;
}
```

### 5.3 `GET /translate/languages`

Returns registered languages, paginated by name and version. Query params:

- `company_name`
- `product_name`
- `format=json`
- `status=ENABLED|DISABLED`
- `next_token`

### 5.4 `GET /translate/languages/{language_name}`

Returns all known versions for one language, latest enabled version, schema digest, company/product metadata, examples/artifact links, and generated type snapshot links. It does not inline large schemas or examples; large payloads are returned as presigned URLs.

### 5.5 `GET /translate/mappings`

Returns enabled mapping metadata, paginated by name and version. Query params:

- `status=ENABLED|DISABLED` (default `ENABLED`)
- `from_language`
- `to_language`
- `next_token`

### 5.6 `GET /translate/mappings/{mapping_name}`

Returns all known versions for one mapping and marks the latest enabled version. It returns mapping metadata, language references, schema digests, and bundle digest, not executable source code.

### 5.7 `POST /translate/validate`

Validates input against the mapping source language and verifies that the mapping and target language are enabled:

```ts
{
  valid: boolean;
  mapping_name: string;
  mapping_version: string;
  from_language_name: string;
  from_language_version: string;
  input_issues: Array<{ path: string; code: string; message: string }>;
}
```

No execution row or S3 artifact is created.

### 5.8 `POST /translate/preview`

Runs the same engine as async execution with tight limits and no callback. Intended for developer smoke tests, UI previews, and release validation.

Response:

```ts
{
  mapping_name: string;
  mapping_version: string;
  from_language_name: string;
  to_language_name: string;
  output: JsonValue;
  warnings: TranslateWarning[];
  coverage: TranslateCoverage;
  duration_ms: number;
}
```

### 5.9 `POST /translate/executions`

Starts the Step Functions workflow:

1. Resolve mapping version.
2. Resolve source and target language versions.
3. Enforce idempotency.
4. Store input artifact.
5. Write `QUEUED` execution row.
6. Start `TranslateExecutionStateMachine`.
7. Return `202`.

If Step Functions start fails after the row is written, the API performs a best-effort terminal `FAILED` update before returning a tagged `503`.

### 5.10 `GET /translate/executions/{execution_id}`

Returns status metadata only:

```ts
{
  execution_id: string;
  status: "SUCCEEDED";
  mapping_name: string;
  mapping_version: string;
  from_language_name: string;
  from_language_version: string;
  to_language_name: string;
  to_language_version: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  warnings_count: number;
  coverage?: { mapped_ratio: number; unmapped_required_paths: string[] };
  artifacts?: {
    input: string;
    output?: string;
    warnings?: string;
    coverage?: string;
  };
  error?: { type: string; message: string; details?: Record<string, unknown> };
}
```

### 5.11 `GET /translate/executions/{execution_id}/artifacts`

Returns short-lived presigned URLs for available artifacts. The caller must still have a valid API key. URLs expire in 15 minutes by default.

### 5.12 `GET /translate/executions/{execution_id}/logs`

Reads Step Functions execution history and the execution artifact summary, then returns a compact, non-secret timeline:

```ts
{
  execution_id: string;
  events: [
    {
      name: "ApplyMapping",
      status: "SUCCEEDED",
      started_at: "2026-05-08T09:46:00.000Z",
      finished_at: "2026-05-08T09:46:03.000Z",
      duration_ms: 3000
    }
  ]
}
```

### 5.13 `GET /translate/information`

API Gateway `MOCK` integration. Returns the Deployer-supplied `ServiceInfo` JSON with standard CORS and HSTS headers. No API key is required. This is the standard introspection endpoint used by Marketplace, Puller, Deployer smoke checks, and operators to confirm the tenant-local Translate install is reachable and to read its build metadata.

---

## 6. Asynchronous Pipelines

### 6.1 Language registration

`TranslateRegisterLanguage`:

- Decodes the registration request.
- Resolves the path `language_name` and optional version.
- Validates required metadata: company, product, format, type, schema source, and callback URL.
- Stores the original schema and examples in the language assets bucket.
- Writes registration state `RUNNING`.

`TranslateFinalizeLanguage`:

- Loads the stored schema.
- Validates JSON Schema syntax.
- Normalises schema defaults that affect runtime validation.
- Computes the schema digest.
- Generates a TypeScript type snapshot for mapping authors.
- Upserts the language catalog row.
- Writes registration state `COMPLETED` or `FAILED`.

### 6.2 Prepare execution

`TranslatePrepareExecution`:

- Decodes the execution request.
- Resolves `{ mapping_name, mapping_version }` to an enabled mapping.
- Resolves source and target language references to enabled language versions.
- Verifies the mapping manifest digest matches the bundled runtime registry.
- Loads inline input or fetches the referenced presigned `input_url`, then copies it to the product-owned artifact prefix.
- Validates input unless `validate_input=false`.
- Writes `RUNNING` state with `startedAt`.

### 6.3 Apply mapping

`TranslateApplyMapping`:

- Parses the stored input artifact.
- Resolves the mapping from the bundled registry/catalog.
- Invokes `TranslateMappingRunner` with validated plain JSON input, mapping identity, language metadata, and deterministic helper context.
- Records mapper duration, helper warnings, declared coverage metadata, and unhandled exceptions.
- Emits an in-memory result for the next state when under Step Functions payload limits; otherwise writes an intermediate artifact and passes a pointer.

`TranslateMappingRunner`:

- Loads exactly one mapping module from the generated manifest.
- Links only approved helper modules and generated language type snapshots.
- Calls the mapping module's `translate(input, context)` function.
- Returns plain JSON output plus warnings/coverage metadata.

Only bundled Translate mapping modules and approved deterministic helpers are allowed in this step.

### 6.4 Validate and store

`TranslateValidateAndStore`:

- Validates output unless `validate_output=false`.
- Computes mapping coverage from recorded or declared source reads and policy.
- Writes `output.json`, `warnings.json`, `coverage.json`, and `execution.json`.
- Updates execution row to `SUCCEEDED` or a terminal validation failure.
- Publishes CloudWatch metrics.

### 6.5 Callback

If `callback_url` is provided, `TranslateCallbackWorker` posts:

```ts
{
  execution_id: string;
  status: "SUCCEEDED" | "FAILED" | "TIMEOUT";
  mapping_name: string;
  mapping_version: string;
  output_s3_uri?: string;
  error?: { type: string; message: string };
}
```

The callback worker never logs full URLs, headers, input, or output payloads. Callback failure does not change a successful translation into a failed translation; it records `callbackStatus=FAILED` and emits a metric.

### 6.6 Failure handling

`TranslateFailureHandler` catches unhandled workflow errors, writes a diagnostic artifact, and moves the execution to `FAILED` or `TIMEOUT`. It must never leave an execution in `QUEUED` or `RUNNING` after the state machine reaches a terminal state.

---

## 7. Cross-cutting Concerns

### 7.1 Determinism and side effects

Mapping code must be deterministic enough to be replayed for audit. Mapping code may:

- read validated input,
- read request metadata,
- call approved helper functions,
- use normal TypeScript control flow and local helper functions,
- construct output values.

Mapping code must not:

- call HTTP services,
- call AWS SDK clients,
- read or write files,
- read environment variables,
- use `Date.now()`, random values, or process-global mutable counters unless the helper injects a deterministic clock or ID generator.

Generated IDs, timestamps, and defaults are supplied by runtime helpers and recorded in execution metadata. If a mapping needs a capability outside those boundaries, it should call a separate product/service before or after Translate rather than embedding side effects inside the mapping.

Enforcement is part of the product contract, not only mapper guidance:

- `scripts/generate-mapping-manifest.ts` statically rejects forbidden imports (`@aws-sdk/*`, `node:fs`, `node:net`, `node:http`, `node:https`, `child_process`, direct `process` access, and dynamic import).
- The runtime mapping runner uses a restricted module linker that exposes only the generated language types, the approved helper package, and the mapper module under execution.
- `TranslateApplyMapping` owns data-plane access. It materialises validated JSON input and receives plain JSON output; `TranslateMappingRunner` does not receive DynamoDB/S3 clients or product configuration.
- The mapping runner role has no intentional AWS data-plane permissions. Any accidental SDK call is both statically rejected and denied at IAM.

### 7.2 Validation

Schemas are registered language JSON Schemas. The runtime converts validation errors into stable issue objects:

```ts
{ path: "/people/0/first_name", code: "invalid_type", message: "Expected string" }
```

Input validation failures stop before workflow execution for preview and before mapping for async execution. Output validation failures are terminal execution failures with output draft stored only when explicitly allowed by the mapping's debug policy.

### 7.3 Coverage and warnings

Because mappings are ordinary TypeScript, coverage cannot depend on a custom mapping-operation DSL. Coverage is computed from optional read tracking, mapping-declared source paths, and validation policy. Coverage output includes:

```ts
{
  mapped_ratio: number;
  required_source_paths: string[];
  mapped_source_paths: string[];
  unmapped_required_paths: string[];
  ignored_source_paths: string[];
}
```

Warnings are structured:

```ts
{
  type: "MissingOptionalSourcePath" | "ConditionalSkipped" | "DefaultApplied" | "CoverageBelowThreshold";
  path?: string;
  message: string;
  details?: Record<string, unknown>;
}
```

### 7.4 Observability

- Logger: AWS Lambda Powertools JSON logs with `executionId`, `mappingName`, `mappingVersion`, `fromLanguage`, `toLanguage`, `stateName`, and `requestId`.
- Metrics namespace: `translate`.
- Metrics:
  - `executions_started`
  - `executions_succeeded`
  - `executions_failed`
  - `language_registrations_started`
  - `language_registrations_completed`
  - `language_registrations_failed`
  - `preview_succeeded`
  - `preview_failed`
  - `translation_duration_ms`
  - `mapping_coverage_ratio`
  - `callback_failed`
- Tracing: Step Functions tracing enabled and Powertools tracer on all Lambdas.
- Every public route reads or mints `X-Sc-Health-Transaction-Id`, echoes it on the response, and uses it as the Step Functions execution name when valid. Registration and translation workflows also persist the trace id on their DynamoDB rows.

### 7.5 Service / module structure

The implementation uses small services with typed interfaces and injectable dependencies:

- `lambda/config/*` - env-derived config readers.
- `lambda/routes/*` - API route handlers.
- `lambda/schemas/*` - request and response validators.
- `lambda/services/language-store.ts` - DynamoDB/S3 registered language metadata and schema access.
- `lambda/services/mapping-registry.ts` - loads generated mapping registry.
- `lambda/services/translation-engine.ts` - validates input/output and executes mapping functions.
- `lambda/services/registration-store.ts` - DynamoDB registration state.
- `lambda/services/execution-store.ts` - DynamoDB execution state.
- `lambda/services/artifact-store.ts` - S3 artifact persistence.
- `lambda/services/coverage.ts` - source path coverage.
- `lambda/services/callback.ts` - callback posting.
- `lambda/errors/*` - tagged structured errors.
- `translate-mappings/*` - helper package, checked-in mapping modules, and registry.
- `generated-languages/*` - generated TypeScript type snapshots derived from registered language schemas.

Factories expose `makeXService(deps)` so tests can supply in-memory stores, fixed clocks, and deterministic ID generators.

### 7.6 Testing strategy

- Unit tests use Vitest.
- Language registration tests cover JSON Schema validation, schema digesting, example storage, callback handling, and generated type snapshots.
- Mapping modules have compile-time tests and runtime fixture tests.
- The translation engine has fixture tests for arbitrary TypeScript mapping functions.
- Route tests cover request parsing, error mapping, idempotency, artifact URL minting, language lookup, and mapping lookup.
- CDK tests assert REST API routes, API key requirement, lifecycle rules, table keys, IAM scope, and Step Functions graph shape.
- Integration tests hit a deployed API with `TRANSLATE_API_URL`, `AWS_PROFILE`, and `SERVICE_API_KEY`.

### 7.7 CI/CD

- `pnpm install`, `pnpm cdk:synth`, `pnpm cdk:deploy`, and `pnpm cdk:destroy` are the target service command contract.
- `just check` runs `tsc -b`.
- `just test` runs Vitest.
- `just cdk:synth` synthesizes the CDK app and generated mapping manifest.
- `just cdk:deploy` deploys through the shared CI/CD workflow.
- `scripts/generate-openapi.ts`, `scripts/generate-mapping-manifest.ts`, and registered-language type generation must be run in CI where applicable; generated artifacts are checked in. `pnpm api:spec` writes `requirements/swagger.yml` for Marketplace documentation publication.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ locally; Lambda runtime is Node.js 24.
- pnpm.
- AWS CLI/CDK permissions for API Gateway, Lambda, Step Functions, DynamoDB, S3, IAM, CloudWatch Logs, X-Ray, and SSM/custom-domain references supplied by Deployer.
- Bootstrap-created tenant custom domain and shared API key usage plan.
- Deployer-compatible Marketplace source snapshot with `marketplace.product.json`, `marketplace/app.ts`, and `requirements/swagger.yml`.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy
pnpm cdk:destroy
```

Stack outputs:

- `TranslateApiUrl`
- `TranslateStateMachineArn`
- `TranslateArtifactsBucketName`
- `TranslateLanguageAssetsBucketName`
- `TranslateLanguagesTableName`
- `TranslateMappingCatalogTableName`

The stack also writes the SSM parameters in §2.4 so Marketplace `DATA` mapping-pack bundles can discover the tenant-local import surface without hardcoded resource names.

### 8.3 Smoke tests

After every deploy:

1. `GET /translate/information` returns the Deployer-supplied `ServiceInfo` JSON without an API key.
2. `PUT /translate/languages/{language_name}/register` registers a smoke-test language and reaches `COMPLETED`.
3. `GET /translate/languages` returns the registered smoke-test language.
4. `GET /translate/mappings` returns at least one enabled mapping that references enabled languages.
5. `POST /translate/validate` accepts a known-good fixture and rejects a known-bad fixture with stable issue paths.
6. `POST /translate/preview` translates a small fixture and returns output inline.
7. `POST /translate/executions` starts an async run; polling reaches `SUCCEEDED`.
8. `/artifacts` returns presigned URLs for input, output, warnings, and coverage.
9. A callback fixture records `callbackStatus=SUCCEEDED`; a failing callback records `callbackStatus=FAILED` without changing translation status.

### 8.4 Rollback

1. Deploy the last known good commit with its matching generated mapping manifest.
2. Confirm the mapping catalog digest matches the bundled registry.
3. Run smoke tests against the rolled-back stage.
4. Inspect `TranslateExecutionsTable` for `RUNNING` rows older than the workflow timeout and mark only proven-orphaned rows with an operational repair script.

### 8.5 Common runbook items

- **Language registration failed**: inspect the registration status and diagnostic artifact; most failures should be invalid JSON Schema, unreachable `data_url`, or reserved language names.
- **Mapping missing**: compare mapping catalog rows against the generated manifest; rerun deploy if the custom resource failed.
- **Coverage below threshold**: inspect `coverage.json` and update the TypeScript mapping or explicitly ignore non-required paths.
- **Output validation failure**: reproduce with the stored `input.json` fixture locally via `pnpm test -- <mapping-name>`.
- **Callback failures**: inspect `callback.json`, not application logs, because callback URLs are redacted.
- **Payload too large**: use `input_url` for async execution or raise `TRANSLATE_ASYNC_MAX_BYTES` only after cost and timeout review.

---

## 9. Implementation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier with import sorting, Vitest, Husky/lint-staged, `justfile`.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,tracer,metrics}`, AWS SDK v3 clients for DynamoDB/S3/SFN, `zod`, and minimal HTTP client support for callbacks. CDK dependencies: `aws-cdk-lib`, `constructs`, `aws-cdk`.
3. **Language registration runtime**: API schemas, registration workflow, language catalog store, schema artifact store, schema digesting, and generated type snapshots.
4. **Translate mapping helper package**: deterministic runtime helpers, `defineTranslateMapping`, mapping context types, and compile-time validation utilities.
5. **Mapping registry**: `translate-mappings/registry.ts` exports all production mappings; fixture tests exercise every mapping.
6. **Generated manifest**: `scripts/generate-mapping-manifest.ts` imports registry metadata, validates duplicates, computes digests, and writes `docs/translate-mapping-manifest.json`.
7. **Schemas / contracts**: route request/response schemas, registration state schemas, execution state schemas, artifact schemas, callback payload schemas, and tagged errors.
8. **Stores**: DynamoDB registration store, language catalog store, execution store, mapping catalog store, and S3 artifact store with injectable clients.
9. **Engine**: deterministic translation engine that calls TypeScript mapping functions, records warnings/coverage, and validates output.
10. **HTTP layer**: API router mounted at `/translate`, response envelope, error mapper, API route definitions, OpenAPI generator, and no-key `/information` mock.
11. **Workflow handlers**: register/finalize language, prepare, apply mapping, validate/store, callback, failure.
12. **CDK stack**: REST API, API mapping, shared Usage Plan stage attachment custom resource, `/information` mock, Lambdas, Step Functions, tables, buckets, IAM, log groups, SSM outputs, and mapping catalog custom resource.
13. **Tests**: unit, route, engine, language registration, mapping fixtures, CDK, and deployed integration smoke tests.
14. **Docs**: README with language registration, local mapping authoring workflow, deployment, smoke tests, and callback behavior.

---

## 10. Acceptance Criteria

The implementation is functionally complete when:

- The product is named **Translate** in code, stack tags, service metadata, OpenAPI, and Marketplace registration.
- Translate is published as a Marketplace `SERVICE` component with a Deployer-compatible source snapshot, `marketplace.product.json`, and `marketplace/app.ts`.
- Independently released mapping packs are Marketplace `DATA` components and write only mapping assets/catalog metadata into the Translate import surface.
- The public API is mounted under `/translate/`; every public route except `/translate/information` requires the tenant service API key.
- `GET /translate/information` is a no-key API Gateway `MOCK` integration returning Deployer-supplied `ServiceInfo`.
- Partner languages can be registered through `/translate/languages/{language_name}/register` with JSON Schema, company/product metadata, examples, async status, and optional callback.
- Translation behavior is defined by checked-in TypeScript mapping modules, not API-authored rule text or a custom mapping-operation DSL.
- Runtime translation behavior is implemented through bundled TypeScript mapping modules and approved deterministic helpers.
- `POST /translate/preview` and `POST /translate/executions` use the same translation engine and produce equivalent output for the same fixture.
- Every execution stores input, output, warnings, coverage, and execution metadata under the documented S3 prefix.
- `GET /translate/executions/{execution_id}` never inlines full payload artifacts.
- Idempotency prevents duplicate concurrent executions for the same `idempotency_key + mapping + version`.
- Callback failure is tracked separately from translation failure.
- Mapping manifest generation fails CI on duplicate names, missing language references, invalid fixture output, or disallowed imports.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and Powertools logging/metrics/tracing.
- Build-time validation, restricted module loading, and IAM prevent mapping code from performing side effects through AWS SDK, filesystem, environment, dynamic import, or network access.
- OpenAPI is generated from route definitions and checked in as `requirements/swagger.yml` for Marketplace publication.
- `just check`, `just test`, `just cdk:synth`, and deployed smoke tests pass before release.
