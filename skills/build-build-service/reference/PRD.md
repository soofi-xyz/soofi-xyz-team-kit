# Build Service - Product Requirements Document (PRD)

Authoritative blueprint for building the **Build** product. It captures the target feature set, artifact contract, validation rules, runtime behaviour, and infrastructure topology that the service must enforce. The implementation is [`prismteam-ai/build`](https://github.com/prismteam-ai/build); its `README.md`, `requirements/swagger.yml` and `docs/progress.md` record what is deployed, and §1.4 lists where it deliberately differs from this document. It replaces the legacy Python 3.9 + Serverless Framework service (`StaircaseAPI/build`) that used CodeBuild to package Serverless Framework bundles; nothing is migrated from it. This PRD specifies the canonical replacement: **TypeScript everywhere**, **AWS CDK only**, `pnpm`, Vitest, ESLint, Prettier, Lambda `nodejs24.x` on ARM64, and **built CDK cloud assemblies** as the only marketplace build artifact.

The intentional product change is direct: **Build actually builds the service.** Build accepts TypeScript AWS CDK source as input, runs the checks and CDK synth/bundling in CodeBuild, and emits a portable CDK cloud assembly containing synthesized CloudFormation templates plus staged file assets. Build no longer emits source snapshots, `config.json`, `artifacts/<module>/update.json`, Serverless Framework packages, or product-owned deployment scripts.

Official AWS implementation references used for this PRD:

- [AWS CDK assets](https://docs.aws.amazon.com/cdk/v2/guide/assets.html) - CDK assets are local files/directories or Docker images; the synthesized cloud assembly carries asset metadata, and CDK publishes file assets to S3 and image assets to ECR before deployment.
- [AWS CDK synth](https://docs.aws.amazon.com/en_us/cdk/v2/guide/ref-cli-cmd-synth.html) - synthesis produces a cloud assembly containing the CloudFormation templates and assets needed to deploy an app.
- [AWS CDK deployment flow](https://docs.aws.amazon.com/cdk/v2/guide/deploy.html) - deployment takes a synthesized cloud assembly, uploads assets to S3/ECR, and submits templates to CloudFormation.
- [AWS CDK synthesis and bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/configure-synth.html) - synthesized templates must reference bootstrap resources compatible with the target environment.
- [AWS CDK cloud assembly schema](https://docs.aws.amazon.com/cdk/api/v2/docs/cloud-assembly-schema-readme.html) - `manifest.json` is the contract consumed by CDK deployment tooling to build/upload assets and deploy templates.
- [AWS CDK Toolkit Library](https://docs.aws.amazon.com/cdk/v2/guide/toolkit-library.html) - programmatic synth/deploy/list/destroy actions are available without shelling out to `cdk`.
- [AWS CDK `NodejsFunction` bundling](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html) - `NodejsFunction` uses esbuild; minification and source-map behaviour must be set explicitly.
- [AWS CodeBuild buildspec reference](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html) - buildspecs are CodeBuild-owned YAML command contracts; Build supplies the buildspec, not the product source.

---

## 1. Product Overview

### 1.1 Mission

Build is the marketplace ecosystem's **artifact construction and provenance service**. It accepts an immutable source archive from CI or an operator, validates that it is a Deployer-compatible TypeScript CDK application, runs the Golden Path quality gates, synthesizes the CDK app, stages the resulting deployment assets, enforces the Lambda asset minification/obfuscation policy against the built assets, then emits a Marketplace-ready **CDK cloud assembly artifact** with `service-builder` metadata.

Build is upstream of Marketplace and Deployer:

1. CI or an operator calls Build with a presigned `source_url`, or uploads the zip through `POST /sources` and passes the returned `source_id`.
2. Build validates and synthesizes that source into an immutable **Build artifact**.
3. The caller submits Build's `artifact_url` to Marketplace `PUT /ontology/products/{product_id}/components/{component_id}/bundles`.
4. Marketplace validates the Build metadata, runs its review pipeline, re-hosts the artifact, and notifies subscribers.
5. Puller hands the Marketplace `bundle_url` to the tenant-local Deployer.
6. Deployer validates the same Build provenance and deploys the built CDK cloud assembly through the CDK Toolkit Library / platform asset publisher.

The artifact payload is deployment output, not product source. Tenant-specific values that used to be supplied during Deployer-side synth must be represented as CloudFormation parameters, SSM dynamic references, pseudo parameters, or other deploy-time values in the synthesized templates. Build does **not** publish CDK assets to a tenant account and does **not** call CloudFormation; Deployer owns tenant-local asset publication and stack deployment.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<subdomain>/infra-builder/`, API-key authorised (`x-api-key` per the Bootstrap-managed shared Usage Plan), with the capability groups below:

| Group | Routes | Purpose |
| --- | --- | --- |
| **Build runs** | `POST /builds`, `POST /service`, `POST /data` | Start a CDK cloud-assembly build. `/service` defaults `bundle_type=SERVICE`; `/data` defaults `bundle_type=DATA`; `/builds` requires or infers the type from `marketplace.product.json`. |
| **Source uploads** | `POST /sources` | Presigned S3 POST form (15 minutes, `application/zip`, at most 256 MiB) for one source zip; returns a `source_id` bound to the calling API key (§4.0). |
| **Build status** | `GET /builds/{build_id}`, `GET /service/{build_id}`, `GET /data/{build_id}` | Poll in-flight/terminal status and retrieve the Build artifact URL when complete. The `/service` and `/data` aliases cover start and status only; logs and manifest live under `/builds/{build_id}` for every build. |
| **Build logs** | `GET /builds/{build_id}/logs` | Return bounded CodeBuild and validation logs for operators and CI. |
| **Artifact manifest** | `GET /builds/{build_id}/manifest` | Return Build's persisted validation manifest without minting a new artifact URL. |
| **Internal - service info** | `GET /information` | Static service metadata (API Gateway `MOCK`, no API key). |

Every build read is authorized by the API key id that created the build; another caller's build is `404 BuildNotFound`, indistinguishable from an unknown id. The public surface has no signing-key route (`/keys`), no cancel route and no other alias sub-routes.

Successful build POSTs return `202 Accepted` with `{ build_id, build_status: "QUEUED", transaction_id }`. The status routes return:

```ts
type BuildStatusResponse = {
  build_id: string;
  build_status: "QUEUED" | "VALIDATING" | "BUILDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  transaction_id: string;
  component_id?: string;
  component_name?: string;
  bundle_type?: "SERVICE" | "DATA";
  source_hash?: string;
  artifact_hash?: string;
  artifact_url?: string;               // present only when SUCCEEDED; presigned (implementation: 15 minutes)
  artifact_url_expires_at?: string;
  service_builder?: ServiceBuilderMetadata;
  failure?: { tag: string; reason: string; phase?: string };
};
```

### 1.3 Non-goals

- Build does **not** deploy CloudFormation, run `cdk deploy`, publish CDK assets to tenant bootstrap buckets, or call the tenant-local Deployer. Deployment belongs to Deployer.
- Build does **not** publish bundles into Marketplace. It produces a Marketplace-ready artifact; the caller chooses when to submit it to Marketplace.
- Build does **not** perform Marketplace review, subscriber fan-out, dependency resolution, sandbox deployment, or Comply policy gating. Marketplace owns those behaviours.
- Build does **not** accept Serverless Framework bundles, prebuilt CloudFormation, `config.json`, `artifacts/<module>/update.json`, per-module zip layouts, `serverless.yml` deployment packages, or product-owned Docker deployment scripts.
- Build does **not** accept arbitrary product-supplied command fields such as `synth_command`, `deploy_command`, `post_deploy_command`, `build_command`, `scripts`, or lifecycle hooks in `marketplace.product.json`.
- Build does **not** trust a product's package scripts as deployment behaviour. Build may run fixed Golden Path checks (`tsc`, ESLint, Vitest, OpenAPI generation check) through service-owned commands, but product-defined deploy/synth hooks are ignored and rejected when declared as artifact lifecycle controls.
- Build does **not** embed AWS credentials, API keys, presigned source URLs, callback secrets, or tenant configuration in artifacts or manifests.
- Build does **not** include product CDK source, TypeScript Lambda source, tests, or package manager state in the output artifact. CloudFormation templates remain visible to Marketplace and Deployer, and Lambda runtime bundles are visible as deployable assets, so the security requirement is that **runtime Lambda assets are minified, obfuscated, and source-map-free before Build uploads the artifact**.
- Build does **not** support Docker image assets in the first production contract. CDK Docker image assets require a build/push step at deployment time; until Build has a platform-owned prebuilt-image artifact contract, products must use file assets or managed images that do not require Deployer to build product source.
- Build does **not** support legacy `FRONTEND`, `FRONTEND_CONFIG`, `CHAT`, or `CONTRACT` bundle types. Those product lines must be represented as CDK `SERVICE` or `DATA` components.
- Build does **not** create `service-comply`. Comply scanning stays with the product's publish step (Registeel); Build forwards an inbound `service-comply` verbatim.

### 1.4 Implemented contract and deliberate differences

The deployed implementation (`prismteam-ai/build`) settles these points. Keep them unless the user changes the decision:

- **Routes.** PRD §4 plus `POST /sources` (§4.0). Signing was removed by decision: no KMS signing keys and no `GET /keys`. No cancel route (`CANCELLED` stays in the status type; nothing sets it). `/service` and `/data` alias only start and status.
- **Callbacks.** PRD §5.8 only: one best-effort, unsigned POST (up to 3 attempts in one invocation), sent at most once. No SQS queue, DLQ or signature; a callback never changes a build's outcome. `callback_url`, `source_url`, upload forms and presigned `artifact_url`s (including the one in the callback payload) are bearer secrets: never returned, logged or passed through Step Functions input.
- **Auth.** Build creates its own usage plan with two test keys per stage (`build-<stage>-caller-a` / `-b`). Attaching to the Bootstrap shared usage plan, real consumer keys, the `/infra-builder` custom domain and `DisableExecuteApiEndpoint` are deferred; the base URL is the stack output `BuildApiUrl` of `BuildApi-<stage>`.
- **Stacks.** `BuildData-<stage>` → `BuildWorkflow-<stage>` → `BuildApi-<stage>` (the roles of §2.1's DataStack, WorkflowStack and BuildStack).
- **Runner.** CodeBuild in a VPC with endpoint-only routes. The runner receives no `source_url`; `FetchSource` stages the zip. Product code (install, `tsc`, synth) runs without AWS credentials or registry tokens as a separate `build-product` user behind a fail-closed isolation probe. The runner role reaches only the exchange bucket's `inbox/*`/`outbox/*` and CodeArtifact reads; Lambdas own the run row and the artifact bucket.
- **Checks.** The fixed checks are `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` (`DependencyInstallFailed`), `tsc --noEmit -p tsconfig.json` (`CdkSynthFailed`, "Type check failed") and synth. Lint, tests and OpenAPI freshness (§5.4) are not run yet.
- **Entrypoint.** `marketplace/app.ts` runs as a normal CDK app (`new App()` … `app.synth()`) with `tsx`; there is no `createMarketplaceApp` factory (§5.5). Products need `"entrypoint": "marketplace/app.ts"` in `marketplace.product.json` and `requirements/swagger.yml` when the manifest sets `base_path`.
- **Lambda asset policy** (`lambda-asset-policy.v2`). Build inspects the final assets, not the construct package (§3.4, §5.6). Every Node.js function's entry file must be `javascript-obfuscator` output (at least 20 `_0x…` identifiers), minified, with no source maps or TypeScript sources; CDK's own handlers are exempt. Any violation fails the build with `LambdaAssetPolicyViolation`, so every `SUCCEEDED` build is publishable. Container images, inline code, pre-zipped assets and non-Node.js product runtimes are rejected.
- **Artifact.** `marketplace.product.json` + `build/build.manifest.json` (`build.manifest.v2`: Deploy's pack-manifest fields plus provenance) + `cdk.out/`. No separate `validation-report.json` / `synth-report.json`; the status response carries `validation` and `asset_policy`.
- **`service-builder`.** Unsigned and JWT-shaped with the claims in §3.3.
- **Self-publication.** Build is itself a Prism Marketplace product (`Build`, component `build`, `base_path: infra-builder`). Its repository packs, scans and publishes its own bundle (`just pack`, `just publish-dry-run`, `just publish`); the Build and Comply services are not used to build Build.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

1. **CDK cloud assemblies are the only build output.** The output artifact is a zip that Deployer can download, validate, publish assets from, and deploy without product source. It contains `marketplace.product.json`, Build's manifests/reports, and `cdk.out/` with the CDK cloud assembly (`manifest.json`, stack templates, asset manifests, and staged file assets). It never contains `marketplace/app.ts`, `lib/`, `src/`, `lambda/`, `node_modules`, or legacy Serverless Framework deployment artifacts.
2. **Step Functions is the workflow implementation layer.** Build request intake, validation, CodeBuild execution, status reconciliation, callback delivery, and cleanup are expressed through a STANDARD `BuildCloudAssembly` state machine. Lambda handlers do not orchestrate multi-step builds in process.
3. **CodeBuild is the build sandbox.** Any source download, dependency install, typecheck, lint, test, CDK synth, asset bundling, artifact packaging, and optional assessment call happens inside a locked-down CodeBuild project launched by the state machine. API Lambdas only validate requests, persist rows, and start executions.
4. **Build owns the buildspec.** CodeBuild projects use Build-controlled buildspecs checked into the Build implementation repo or rendered by Build from a fixed internal template. Product source archives never supply CodeBuild buildspecs or executable lifecycle command fields.
5. **CDK synth is the build step, not a deploy step.** Build may use the CDK Toolkit Library or a platform CDK runner to synthesize a cloud assembly in a credentialless sandbox. Synthesis proves the source can build, creates the stack templates, and stages all file assets. It does not publish assets, create change sets, or mutate AWS resources.
6. **Cloud assemblies must be tenant-portable.** Build output cannot contain the Build account id, Build region, local file paths, source URLs, or concrete tenant values. Tenant/environment data must appear as CloudFormation parameters, pseudo parameters, SSM dynamic references, or other deploy-time inputs listed in Build's manifest. Build rejects concrete AWS lookups such as `Vpc.fromLookup`, `HostedZone.fromLookup`, availability-zone lookups, or SDK calls during synth.
7. **Lambda minification and obfuscation are policy-gated on final assets.** Product CDK must use the platform Lambda construct package (for example `@internal/marketplace-cdk`) for Node.js Lambdas. That construct fixes `NodejsFunction` bundling to minify, disable source maps, strip original source content, emit ESM for Node 24, and run the Build-owned obfuscation post-process. Build validates the source imports an approved construct version and inspects the staged Lambda file assets in `cdk.out`; Deployer re-validates those same asset bytes before publishing.
8. **Cloud assemblies are reproducible enough for provenance.** Build computes `source_hash`, `normalized_source_hash`, `assembly_hash`, `assembly_manifest_hash`, `artifact_hash`, per-template hashes, and per-asset hashes, stores them in DynamoDB and S3 object metadata, and stamps them into `service-builder`. Marketplace and Deployer re-check the hashes against the downloaded bytes.
9. **Build provenance is metadata, not dependency ordering.** Marketplace components should not list `Build` in `dependencies` or `deploy_time_dependencies` merely because Build produced the artifact. Build is a producer of provenance. Only products that call a tenant-local Build API at runtime should depend on the Build component.

### 2.1 Stacks (AWS CDK)

The CDK app is composed of three stacks deployed in order:

```text
bin/app.ts
|-- DataStack       # KMS CMK, BuildArtifactsBucket, SourceCacheBucket,
|                   # BuildRunsTable, optional report/log tables
|-- WorkflowStack   # BuildCloudAssembly STANDARD state machine,
|                   # CodeBuild projects, runner roles, callback worker
`-- BuildStack      # REST API, API Lambdas, custom resources,
                    # /information mock, cleanup schedules
```

`BuildStack.addDependency(workflowStack); workflowStack.addDependency(dataStack)` ensures storage deploys first, then orchestration, then routing. All stacks are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted.

### 2.2 DataStack contents

#### 2.2.1 KMS

- **`DataKey`** - symmetric customer-managed key (alias `alias/build_encryption_key`) used to encrypt DynamoDB tables, S3 bucket objects when SSE-KMS is selected, and the run row's `source_url`/`callback_url` (no signing keys; §1.4). Runtime roles receive only the `kms:Encrypt|Decrypt|GenerateDataKey|DescribeKey` actions needed by their route or worker, constrained with `kms:ViaService` where possible.

#### 2.2.2 Storage

| Bucket | Encryption / ACL | Lifecycle | Purpose |
| --- | --- | --- | --- |
| `BuildArtifactsBucket` | SSE-S3 or SSE-KMS, `BLOCK_ALL` public access, bucket-owner-enforced ownership, SSL-only bucket policy | Successful artifacts retained 180 days by default; failed partial artifacts 14 days | Final Build cloud assemblies under `artifacts/<component_id>/<build_id>/cloud-assembly.zip`, validation manifests, bounded report files |
| `SourceCacheBucket` | SSE-S3, `BLOCK_ALL`, SSL-only | 7-14 days | Temporary downloaded source archives, normalized source trees, CodeBuild intermediate outputs |
| `AccessLogsBucket` | SSE-S3, `BLOCK_ALL`, object-writer log delivery | 30-90 days per environment | S3/API access logs when enabled |

Artifacts are never public. Status routes and Marketplace upload callers receive presigned URLs with `BUILD_ARTIFACT_PRESIGN_TTL_SECONDS` (default 3600).

#### 2.2.3 DynamoDB

All tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled, and TTL where noted.

| Table | Keys | Indexes | TTL | Purpose |
| --- | --- | --- | --- | --- |
| `BuildRunsTable` | `pk = BUILD#<build_id>`, `sk = META` | `gsi1: SOURCE#<source_hash>`, `gsi2: COMPONENT#<component_id>#STATUS#<status>` | `ttl` for old run rows | One row per build request, current status, source/artifact hashes, CodeBuild id, callback status, error summary |
| `BuildEventsTable` | `pk = BUILD#<build_id>`, `sk = EVENT#<timestamp>#<seq>` | - | `ttl` | Bounded status events and validation findings for logs/status APIs |
| `BuildReportsTable` | `pk = BUILD#<build_id>`, `sk = REPORT#<name>` | - | `ttl` | Optional pointers to test, lint, synth, and assessment report artifacts |

### 2.3 WorkflowStack contents

#### 2.3.1 IAM roles

- **`StateMachineRole`** - assumed by `states.amazonaws.com`; starts CodeBuild builds using `codebuild:StartBuild` / `BatchGetBuilds`, invokes workflow Lambdas, and reads/writes Build tables through scoped DynamoDB actions.
- **`CodeBuildRunnerRole`** - assumed by `codebuild.amazonaws.com` (the implementation narrows it further; §1.4); reads the presigned source URL, writes only to Build-owned S3 buckets, writes Build status/events to Build-owned tables, and calls configured Assess/Test/Comply-adjacent services only when the corresponding instance setting is enabled. It has no CloudFormation create/update/delete permissions and no CDK bootstrap bucket/ECR publish permissions.
- **`ApiRole` / per-handler roles** - API handlers can validate request shape, write an initial row, mint presigned artifact URLs, and start the state machine. They cannot invoke arbitrary CodeBuild projects or mutate artifacts directly.
- **`CallbackWorkerRole`** - posts terminal callbacks to caller-supplied `callback_url`s with retry and redaction; it cannot read source archives or cloud assemblies.

#### 2.3.2 CodeBuild projects

Build owns a small set of CodeBuild projects:

| Project | Environment | Use |
| --- | --- | --- |
| `BuildCloudAssemblyStandard` | Linux x86_64, Amazon Linux 2023 standard image, `BUILD_GENERAL1_MEDIUM`, no privileged mode by default | Default CDK source validation, synth, asset staging, and packaging |
| `BuildCloudAssemblyLarge` | Linux x86_64, larger compute/disk | Large repos, many tests, heavy synth |
| `BuildCloudAssemblyArm` | Linux ARM64, Amazon Linux 2023 ARM image | Source validation for products with ARM-native Lambda dependency checks |

Worker selection is explicit and bounded by request fields plus `Content-Length(source_url)`. Privileged Docker mode is not part of the production contract. Build rejects CDK Docker image assets until the platform defines a prebuilt OCI-image artifact contract that lets Deployer publish images without building product source.

The CodeBuild buildspec is service-owned. Its high-level shape is:

```yaml
version: 0.2
phases:
  install:
    commands:
      - corepack enable
      - pnpm --version
  build:
    commands:
      - node dist/runner/build-cloud-assembly.js
artifacts:
  files:
    - output.json
```

The runner script receives configuration through environment variables set by the state machine (`BUILD_ID`, `SOURCE_URL`, expected hashes, requested checks, and S3 output locations). The product archive never controls this buildspec.

#### 2.3.3 Step Functions: `BuildCloudAssembly`

A STANDARD state machine, X-Ray tracing enabled:

```text
ValidateRequest
  -> PersistQueuedRun
  -> SelectRunner
  -> StartCodeBuild.sync
  -> LoadRunnerOutput
  -> FinalizeArtifact
  -> MaybeSendCallback
  -> Succeed

Catch States.ALL
  -> PersistFailedRun
  -> MaybeSendCallback
  -> Fail
```

Per-task standards:

- `Lambda.ServiceException | Lambda.AWSLambdaException | Lambda.SdkClientException | Lambda.TooManyRequestsException` retry: `IntervalSeconds=2, MaxAttempts=5, BackoffRate=2`.
- `CodeBuild.AWSCodeBuildException | AWSServiceUnavailableException | AWSThrottlingException` retry: `IntervalSeconds=5, MaxAttempts=5, BackoffRate=2`.
- CodeBuild project timeout: default 60 minutes, max 120 minutes by `worker_size`.
- State machine timeout: 3 hours.

The state machine persists status transitions (`QUEUED`, `VALIDATING`, `BUILDING`, terminal) so `GET /builds/{build_id}` never needs to query CodeBuild for old runs after TTL expiry.

### 2.4 BuildStack contents

#### 2.4.1 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), minification enabled, source maps disabled, and the standard `createRequire` banner for CommonJS dependencies. CloudWatch log retention is three months.

Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with `POWERTOOLS_SERVICE_NAME=build-*`, `POWERTOOLS_LOG_LEVEL=INFO`, and `POWERTOOLS_METRICS_NAMESPACE=build`.

| Cohort | Functions | Memory | Timeout | Trigger |
| --- | --- | --- | --- | --- |
| **Public API** | `StartBuildHandler`, `BuildStatusHandler`, `BuildLogsHandler`, `BuildManifestHandler` | 256-512 MB | 28-30 s | API Gateway |
| **Workflow workers** | `ValidateRequest`, `SelectRunner`, `LoadRunnerOutput`, `FinalizeArtifact`, `PersistFailedRun`, `SendBuildCallback` | 256-1024 MB | 30-300 s | Step Functions |
| **Operational helpers** | `PruneOldArtifacts`, `ApiGatewayLogCustom`, `ApiUsagePlanStageAttachmentCustom` | 256 MB | 30-900 s | EventBridge / CloudFormation |

#### 2.4.2 Routing fabric

- **REST API** (`RestApi` `BuildApi`) with default stage `${stage}`, regional endpoint type, CORS pre-flight for `*`, a dedicated access log group, and `DisableExecuteApiEndpoint: true`.
- **API Gateway custom domain mapping** under base path `infra-builder` against the Bootstrap-created custom domain passed by Deployer. Build must not create the shared API Gateway `DomainName`.
- **API key enforcement** for all routes except `GET /information`.
- **GatewayResponse** rules normalise `INVALID_API_KEY`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, `DEFAULT_4XX`, and `DEFAULT_5XX` with the shared CORS/HSTS response shape used by Marketplace and Deployer.
- **Custom resources**:
  - `ApiUsagePlanStageAttachmentCustom` reads `/account/shared-usage-plan-id` and idempotently adds the Build API stage to the shared plan. It does not create the plan or bind keys.
  - `ApiGatewayLogCustom` wires the access log group and stage logging.

#### 2.4.3 Configuration surface

CloudFormation parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `Subdomain` | required | Tenant or central environment FQDN where `/infra-builder` is mounted |
| `SharedUsagePlanIdSsmParam` | `/account/shared-usage-plan-id` | Shared Usage Plan id written by Bootstrap |
| `ProductName` | `Build` | Cost tag value |
| `ServiceInfo` | `null` | JSON returned by `/information` |
| `BuildHash` | `null` | Build service's own deployment hash |

Environment variables:

| Key | Default | Used by |
| --- | --- | --- |
| `BUILD_PRODUCT_IDENTIFIER` | `c72b3b7c-dc30-41d0-81d3-3d3889370ef2` | Health/Finance metrics |
| `BUILD_SOURCE_SNAPSHOT_SFN_ARN` | from WorkflowStack | Start build |
| `BUILD_RUNS_TABLE` / `BUILD_EVENTS_TABLE` / `BUILD_REPORTS_TABLE` | from DataStack | API + workflow |
| `BUILD_ARTIFACTS_BUCKET` / `SOURCE_CACHE_BUCKET` | from DataStack | Artifact storage |
| `KMS_KEY_ARN` | `DataKey.Arn` | DDB/S3 encryption helpers |
| `MAX_SOURCE_BYTES` | `268435456` (256 MiB) | Input source archive size cap |
| `MAX_ARTIFACT_BYTES` | `268435456` (256 MiB) | Output artifact size cap; must match Marketplace/Deployer bundle cap |
| `BUILD_ARTIFACT_PRESIGN_TTL_SECONDS` | `3600` | Status-route artifact URL TTL |
| `APPROVED_MARKETPLACE_CDK_PACKAGE` | `@internal/marketplace-cdk` | Lambda policy validator |
| `MIN_MARKETPLACE_CDK_VERSION` | implementation-set | Minimum secure construct package version |
| `ASSESS_API_URL_SSM_PARAM` | optional | Optional assessment service URL |
| `ASSESS_API_KEY_SSM_PARAM` | optional SecureString | Optional assessment service key |
| `HEALTH_API_URL` / `HEALTH_API_KEY_SSM_PARAM` | optional | Health metric emission |

---

## 3. Artifact Contract

### 3.1 Input source archive

The source is either a `source_id` from `POST /sources` (§4.0) or a `source_url`. `source_url` MUST resolve to an immutable HTTPS zip archive with `Content-Length <= MAX_SOURCE_BYTES`. Build performs SSRF-safe URL validation: HTTPS only, no redirects, no private IP literals, no DNS A/AAAA records resolving to private ranges, and a 3 second reachability check before starting the state machine. An uploaded `source_id` skips the URL probe.

Required source layout:

```text
source.zip
|-- marketplace.product.json
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- marketplace/
|   `-- app.ts
|-- lib/
|   `-- ...
|-- lambda/
|   `-- ...
|-- src/
|   `-- ...
`-- requirements/
    `-- swagger.yml              # required when the component exposes an API (manifest sets base_path)
```

Allowed top-level additions include `test/`, `scripts/generate-openapi.ts`, `docs/`, `gremlin/`, `glue/`, and product-specific runtime directories when referenced by CDK constructs. Disallowed top-level content includes `.git/`, `node_modules/`, `cdk.out/`, `.serverless/`, generated coverage, local env files, private keys, and any legacy `artifacts/` deployment layout.

`marketplace.product.json` is declarative:

```jsonc
{
  "component_id": "Connect",
  "component_name": "Connect",
  "bundle_type": "SERVICE",
  "entrypoint": "marketplace/app.ts",
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

The manifest MUST NOT contain command strings or lifecycle selectors. Build rejects keys such as `synth_command`, `deploy_command`, `post_deploy_command`, `build_command`, `scripts`, `docker_build`, `serverless`, `terraform`, `sam`, `pulumi`, or `engine`.

### 3.2 Output cloud assembly artifact

Build emits a normalized zip containing a CDK cloud assembly and Build provenance:

```text
build-artifact.zip
|-- marketplace.product.json
|-- build/
|   |-- build.manifest.json
|   |-- validation-report.json
|   `-- synth-report.json
`-- cdk.out/
    |-- manifest.json
    |-- tree.json
    |-- <StackName>.template.json
    |-- <asset-manifest>.assets.json
    |-- asset.<file-asset-hash>/
    |   `-- ... built file asset bytes
    `-- ...
```

The implementation emits `marketplace.product.json`, `build/build.manifest.json` and `cdk.out/` only (exactly one `cdk.out/manifest.json`; every stack declares at least one resource); see §1.4.

The output artifact intentionally excludes `marketplace/app.ts`, `lib/`, `src/`, `lambda/`, `test/`, `node_modules`, `.git`, local caches, source maps, local env files, and any files matched by the platform denylist. Deployer receives only the built deployment product: stack templates, CDK assembly metadata, and staged file assets. If a construct would require source code at deploy time, Build fails the run.

`cdk.out/manifest.json` is the authoritative CDK cloud assembly manifest. Build validates it with the CDK cloud assembly schema and records the schema version in `build/build.manifest.json`. Asset manifest files in `cdk.out` may contain file assets only for the first production contract; `dockerImages` entries are rejected.

The output `marketplace.product.json` is a sanitized deployment manifest derived from the source manifest. It keeps component identity, bundle type, stack ids, base path, requirements, and Lambda policy, but removes source-only fields such as `entrypoint` and rejects any command/lifecycle field.

`build/build.manifest.json`:

```ts
type BuildManifest = {
  schemaVersion: "build.manifest.v1";
  buildId: string;
  transactionId: string;
  componentId: string;
  componentName: string;
  bundleType: "SERVICE" | "DATA";
  artifactKind: "CDK_CLOUD_ASSEMBLY";
  deployerContractVersion: "1";
  sourceHash: string;              // SHA-256 of downloaded input bytes
  normalizedSourceHash: string;    // SHA-256 after denylist normalization
  assemblyHash: string;            // SHA-256 over normalized cdk.out contents
  assemblyManifestHash: string;    // SHA-256 of cdk.out/manifest.json
  artifactHash: string;            // SHA-256 of output zip bytes
  marketplaceManifestHash: string;
  lockfileHash: string;
  cdk: {
    stacks: string[];
    cdkVersion: string;
    awsCdkLibVersion: string;
    toolkitLibraryVersion?: string;
    cloudAssemblySchemaVersion: string;
    synthesizer: "DefaultStackSynthesizer" | "PlatformMarketplaceSynthesizer";
    bootstrapQualifier: string;
  };
  cloudAssembly: {
    manifestPath: "cdk.out/manifest.json";
    templateHashes: Record<string, string>;
    fileAssetHashes: Record<string, string>;
    dockerImageAssets: [];
  };
  deploymentParameters: {
    required: string[];
    optional: Record<string, string>;
    sources: Record<string, "request.custom_parameters" | "deployer.env" | "bootstrap.ssm" | "pseudo">;
  };
  lambdaAssetPolicy: {
    minified: true;
    obfuscated: true;
    sourceMaps: false;
    approvedConstructPackage: string;
    approvedConstructVersion: string;
    validatorVersion: string;
    checkedAssetHashes: string[];
    violations: [];
  };
  checks: {
    typecheck: CheckResult;
    lint: CheckResult;
    tests: CheckResult;
    openapi: CheckResult;
    synth: CheckResult;
    cloudAssemblyPortability: CheckResult;
    assessment?: CheckResult;
  };
  createdAt: string;
};
```

#### 3.2.1 Tenant portability constraints

Because Deployer no longer runs product CDK code, every value that varies by tenant/account/region must already be represented in the synthesized templates as a deploy-time input. The platform CDK package MUST provide Marketplace context helpers that create CloudFormation parameters/tokens for domain names, certificate ARNs, shared usage plan ids, tenant subdomain, regions, and `custom_parameters`.

Build rejects a cloud assembly when:

- any template or asset manifest contains the Build account id, Build region, local filesystem paths, source URL, or callback URL;
- a stack artifact targets a concrete environment that is not marked portable by the platform synthesizer;
- `cdk.out/manifest.json` or an asset manifest references file paths outside `cdk.out`;
- an asset manifest contains `dockerImages` entries;
- a template depends on CDK context lookup output instead of explicit parameters;
- required deployment parameters are not listed in `build/build.manifest.json`.

### 3.3 S3 metadata headers

Build uploads the output zip to `BuildArtifactsBucket` with JWT-shaped metadata headers. The JWTs are unsigned in the existing platform style (`<base64url header>.<base64url JSON payload>.`) and are decoded without signature verification by Marketplace/Deployer. Build holds no signing key.

Required `x-amz-meta-service-builder` token: header `{"alg":"none","typ":"JWT"}`, base64url JSON claims, empty signature segment, at most 1200 bytes (leaving room in S3's 2 KB metadata limit for `service-comply`). Claims, as Marketplace's `inspectBundle` reads them:

```ts
type ServiceBuilderClaims = {
  iss: "build";
  sub: string;                            // build_id
  iat: number;                            // epoch seconds
  artifact_kind: "CDK_CLOUD_ASSEMBLY";
  deployer_contract_version: "1";
  component_id: string;
  source_hash: `sha256:${string}`;        // uploaded/downloaded source zip bytes
  assembly_hash: `sha256:${string}`;      // Deploy's directory hash over cdk.out/
  artifact_hash: `sha256:${string}`;      // output zip bytes
  cloud_assembly: { stacks: string[] };
  deployment_parameters: Record<string, never>; // always {} today
  lambda_asset_policy: { minified: true; obfuscated: true; source_maps: false };
  // optional, added in this order while the token stays within 1200 bytes:
  service_comply_sha256?: string;         // binds an inbound service-comply
  bundle_type?: "SERVICE" | "DATA";
  build_manifest_sha256?: string;
  source_commit?: string;                 // from an inbound service-code token
  repository?: string;
  runner_version?: string;
  codebuild_build_id?: string;
};
```

`build/build.manifest.json` always carries every value, including ones that did not fit the token. Metadata on the artifact is written in priority order `service-builder`, `service-comply`, `service-code`, then other inbound `service-*` values while they fit.

Build preserves inbound `x-amz-meta-service-*` headers (for example `service-code`, `service-comply`) verbatim, from the source download or the `POST /sources` upload fields. It never creates or fabricates `service-comply`; without one the status reports `service_comply: "ABSENT"`. Marketplace pairs the two tokens by `service-comply.source_hash == service-builder.source_hash`.

### 3.4 Lambda asset minification and obfuscation

The platform standard for Node.js Lambda runtime code is:

- Use the approved platform construct package, not raw `aws_lambda.Function` for TypeScript/JavaScript handlers.
- Emit Node 24 ESM bundles with the `createRequire` banner used across the PRDs.
- Set `NodejsFunction` bundling options equivalent to:

```ts
{
  format: OutputFormat.ESM,
  target: "node24",
  minify: true,
  sourceMap: false,
  sourcesContent: false,
  keepNames: false,
  charset: Charset.ASCII,
  legalComments: "none",
  banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);"
}
```

- Run the Build-owned obfuscation post-process after esbuild emits the JavaScript bundle. The obfuscation profile must be deterministic for identical inputs, avoid runtime self-defending/debug traps, preserve public handler exports, preserve AWS Lambda handler names, and fail closed on syntax/runtime validation errors.
- Write a per-function obfuscation manifest into the synthesized asset directory before CDK asset publishing. The manifest includes the handler entry, bundle hash, obfuscator version/profile hash, minification flag, source-map flag, and source hash.
- Never include `.map` files, original `.ts` handler source, test fixtures, local env files, or unbundled implementation directories inside Lambda code assets.

The implementation does not require a specific construct package or obfuscation manifest: products bundle with any `NodejsFunction` setup that meets the bundling options above and then run `javascript-obfuscator` on each bundle (deterministic seed). Build's check of the final assets (§5.6) is the gate.

Build proves this policy by source validation and by inspecting the final staged Lambda assets in `cdk.out`. Deployer proves it again against the same built asset bytes immediately before publishing them. Marketplace stores the proof as artifact metadata but does not inspect Lambda bundles.

---

## 4. Synchronous APIs

### 4.0 `POST /sources`

For callers that do not host the archive. Body empty or `{}` (closed schema; unknown fields `400 UnknownField`). Returns `201`:

```json
{
  "source_id": "src_01J...",
  "upload": { "url": "https://<source-cache-bucket>.s3.<region>.amazonaws.com/", "fields": { "key": "uploads/...", "Content-Type": "application/zip", "Policy": "...", "X-Amz-Signature": "..." } },
  "expires_at": "2026-10-02T12:15:00.000Z"
}
```

The caller POSTs the fields plus `file` (last) as `multipart/form-data` within 15 minutes; S3 answers `204`. The policy requires `Content-Type: application/zip`, 1 byte to 256 MiB, and names two optional fields, `x-amz-meta-service-code` and `x-amz-meta-service-comply` (send both, empty when absent), which are forwarded like a `source_url`'s `x-amz-meta-service-*` headers. The form is a bearer secret and is never logged. The upload key embeds a hash of the API key id: an unknown, expired or other caller's `source_id` is `404 SourceNotFound` at `POST /builds`. Uploads expire after 1 day and may start several builds until then.

### 4.1 `POST /builds`

Request:

```ts
type StartBuildRequest = {
  source_url?: string;                   // exactly one of source_url | source_id
  source_id?: string;                    // from POST /sources
  component_id?: string;                 // optional; if present must match marketplace.product.json
  component_name?: string;
  bundle_type?: "SERVICE" | "DATA";      // optional when manifest declares it
  callback_url?: string;
  log_level?: "INFO" | "DEBUG";
  worker_size?: "STANDARD" | "LARGE";
  build_architecture?: "X86_64" | "ARM64";
  allow_docker_assets?: false;           // production contract rejects Docker image assets
  checks?: {
    typecheck?: boolean;                 // default true
    lint?: boolean;                      // default true
    test?: boolean;                      // default true
    synth?: boolean;                     // always true in production
    openapi?: boolean;                   // default true when requirements/swagger.yml exists
    assessment?: boolean;                // default from instance settings
  };
  synth_context?: Record<string, unknown>; // non-secret validation/build context for portable parameters only
};
```

Validation order:

1. Closed schema decode; unknown fields return `400 UnknownField`; both or neither of `source_url`/`source_id` is `400 BadRequest`. The implementation returns `400 InvalidBuildOption` for `checks`, `synth_context` and `allow_docker_assets`, which it does not support yet.
2. `source_url` SSRF-safe validation (skipped for `source_id`, which must name the caller's own upload) and streaming `HEAD`/`GET` probe with `Content-Length`.
3. Size guard: `Content-Length <= MAX_SOURCE_BYTES`.
4. `callback_url`, when present, must be HTTPS and pass the same SSRF-safe host checks.
5. `allow_docker_assets=true` is rejected in production until the platform defines a prebuilt image artifact contract.
6. Persist `QUEUED` row and start `BuildCloudAssembly` with `name = build_id`.

Response:

```json
{
  "build_id": "bld_01J...",
  "build_status": "QUEUED",
  "transaction_id": "01J..."
}
```

### 4.2 `POST /service` and `POST /data`

Aliases for CI compatibility:

- `/service` behaves like `/builds` with `bundle_type = "SERVICE"` unless the request explicitly sets the same value.
- `/data` behaves like `/builds` with `bundle_type = "DATA"` unless the request explicitly sets the same value.

If the source manifest declares a different `bundle_type`, Build returns `422 BundleTypeMismatch`.

Legacy routes `/frontend`, `/frontend-config`, `/chat`, and `/smart-contract` are not part of the target public API. If compatibility aliases are temporarily retained during migration, they MUST return `410 Gone` with remediation text directing callers to CDK `SERVICE`/`DATA` builds.

### 4.3 `GET /builds/{build_id}`

Reads `BuildRunsTable` and returns the status response. On `SUCCEEDED`, it mints a fresh presigned artifact URL for `s3://BuildArtifactsBucket/artifacts/<component_id>/<build_id>/cloud-assembly.zip`. On missing row, or a row created by another API key, returns `404 BuildNotFound`. The implementation stores artifacts at `assemblies/<build_id>/cloud-assembly.zip` and presigns for 15 minutes with a read-only role.

The response never returns the original `source_url`, API keys, or callback secrets.

### 4.4 `GET /builds/{build_id}/logs`

Returns bounded logs:

```ts
{
  build_id: string;
  events: Array<{ at: string; phase: string; level: "INFO" | "WARN" | "ERROR"; message: string }>;
  codebuild?: {
    build_id: string;
    log_group?: string;
    log_stream?: string;
    tail: string[];                     // newest safe lines, redacted
  };
}
```

The implementation serves the runner's CodeBuild log stream as `{ build_id, build_status, entries: [{ timestamp, message }], next_token? }`, oldest first, with `?limit=1..500&next_token=`; unknown query parameters are `400 UnknownField`.

The handler redacts `source_url`, `x-api-key`, `authorization`, `secret`, `token`, `access_key`, `secret_key`, and `session_token`.

### 4.5 `GET /builds/{build_id}/manifest`

Returns the stored `BuildManifest` when the build reached `SUCCEEDED` or `FAILED` after manifest creation. It does not mint an S3 artifact URL. Missing manifest returns `404 BuildManifestNotFound`. The implementation returns the stored bytes unchanged, so their SHA-256 equals `provenance.build_manifest_sha256`; a failed or expired build has none.

### 4.6 `GET /information`

API Gateway `MOCK` integration. Returns the deployer-supplied `ServiceInfo` JSON with standard CORS/HSTS headers. No API key required.

---

## 5. Build Runner Pipeline

The CodeBuild runner is a TypeScript program in the Build implementation repo. It is invoked by the Build-owned buildspec and runs these phases:

### 5.1 Download and normalize

1. Download `SOURCE_URL` with streaming `fetch`, no redirects.
2. Verify byte count and compute `sourceHash`.
3. Extract the zip with zip-slip protection, rejecting absolute paths, `..`, symlinks that escape the tree, device files, private keys, `.env*`, `.git`, `node_modules`, `cdk.out`, `.serverless`, and other denied paths.
4. Normalize file timestamps/order for deterministic zip output where possible.

### 5.2 Manifest and layout validation

1. Read `marketplace.product.json`.
2. Validate `component_id`, `component_name`, `bundle_type`, `entrypoint`, `context_schema_version`, `stacks[]`, `base_path`, and `requires`.
3. Assert `entrypoint === "marketplace/app.ts"`.
4. Assert `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, and `marketplace/app.ts` exist.
5. Assert no legacy `config.json`, `artifacts/<module>/update.json`, `serverless.yml` deployment package, Terraform/Pulumi/SAM config, or deploy-engine selector is present.
6. Assert the request's `component_id` / `bundle_type`, when provided, match the manifest.

### 5.3 Dependency install

Build runs:

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

Install scripts are disabled by default. If a future product line needs vetted install scripts for generated native binaries, that exception must be represented as a platform-approved Build setting, audited in the validation report, and never controlled by product source fields.

### 5.4 Golden Path checks

Build runs fixed checks using platform-owned invocations:

- Typecheck: `pnpm exec tsc -b`.
- Lint: `pnpm exec eslint .` with the repository config.
- Format check: `pnpm exec prettier --check .` when configured.
- Tests: `pnpm exec vitest run` unless `checks.test=false`.
- OpenAPI freshness: run the service's checked-in generator only when it is part of the Golden Path contract, then assert `requirements/swagger.yml` or `docs/openapi.json` is not stale.

Checks may be disabled only by request fields where the route contract permits it. `synth` cannot be disabled in production.

### 5.5 CDK synth and cloud assembly build

Build constructs a portable build-time `MarketplaceContext` whose tenant-varying fields resolve to CloudFormation parameters or pseudo parameters, not concrete Build-environment values:

```ts
{
  schemaVersion: "1",
  bundleId: "<build_id>",
  deployId: "build-cloud-assembly",
  transactionId: "<transaction_id>",
  componentId,
  componentName,
  bundleType,
  sourceHash,
  tenant: {
    accountId: Aws.ACCOUNT_ID,
    region: Aws.REGION,
    subdomain: new CfnParameter(...),
  },
  domain: { ...CfnParameter-backed non-secret domain handles... },
  basePath,
  sharedUsagePlanIdSsmParam: "/account/shared-usage-plan-id",
  serviceInfo: { build_id },
  customParameters: synth_context ?? {}
}
```

Then it imports `marketplace/app.ts`, asserts `createMarketplaceApp` is exported, creates a CDK `App`, invokes the factory, and synthesizes a cloud assembly to `cdk.out`. Build validates `cdk.out/manifest.json` and every referenced asset manifest through the CDK cloud assembly schema. Build rejects:

- AWS SDK calls at synth time;
- CDK context lookups that require credentials or an account environment lookup;
- calls to `app.synth()` from product code;
- shell command execution from product code during synth;
- stack ids that do not match `marketplace.product.json.stacks[]`;
- stack dependency ordering that contradicts the manifest order;
- templates or asset manifests containing the Build account id, Build region, local paths outside `cdk.out`, source URLs, callback URLs, or secrets;
- `dockerImages` entries in asset manifests;
- missing CloudFormation parameter declarations for tenant-varying values consumed by the templates.

The generated `cdk.out` directory is the primary deployment payload. Build removes source-only files, writes `build/synth-report.json`, and packages the cloud assembly into the final artifact.

### 5.6 Lambda asset policy validation

Build validates the staged cloud assembly:

- All TypeScript/JavaScript Lambda handlers are declared through the approved platform construct package.
- Raw `aws_lambda.Function` with `Code.fromAsset` is rejected for Node.js runtime code unless the staged file asset is generated, already-obfuscated, and has a valid Build obfuscation manifest.
- `NodejsFunction` bundling defaults from plain CDK are not enough; the approved construct must set minification/obfuscation explicitly.
- No staged Lambda asset includes source maps or original `.ts` handler sources.
- The approved construct version is at or above `MIN_MARKETPLACE_CDK_VERSION`.

The validation result is written to both `build/validation-report.json` and `service-builder.lambda_asset_policy`.

Implemented policy (`lambda-asset-policy.v2`, see §1.4): Build checks every `AWS::Lambda::Function` and `AWS::Lambda::LayerVersion` in every template and the asset each uses, without checking which construct produced it. Each Node.js function's entry file needs at least 20 `_0x[0-9a-f]{4,}` identifiers (`javascript-obfuscator` output); JS files must be minified and name-mangled; no `*.map`, `sourceMappingURL` or TypeScript sources; container images, inline `ZipFile`, pre-zipped assets and non-Node.js product runtimes are rejected. Assets byte-identical to files shipped by `aws-cdk-lib` / `@aws-cdk/*` are exempt (`framework: true`). Any finding fails the build with `LambdaAssetPolicyViolation`; findings appear on the status response's `asset_policy`, and `service-builder.lambda_asset_policy` is always `{minified: true, obfuscated: true, source_maps: false}` on a successful build.

### 5.7 Package and upload

1. Build writes sanitized `marketplace.product.json`, `build/build.manifest.json`, `build/validation-report.json`, and `build/synth-report.json`.
2. Build creates `cloud-assembly.zip` with deterministic ordering and no denied paths.
3. Build computes `artifactHash`.
4. Build uploads to `s3://BuildArtifactsBucket/artifacts/<component_id>/<build_id>/cloud-assembly.zip` with `x-amz-meta-service-builder` and any approved pass-through metadata.
5. Build persists the terminal row and emits Health/Finance metrics.

### 5.8 Terminal callback

If `callback_url` is supplied, Build POSTs exactly one terminal payload:

```ts
type BuildTerminalCallback = {
  status: "SUCCEEDED" | "FAILED";
  build_id: string;
  transaction_id: string;
  component_id?: string;
  bundle_type?: "SERVICE" | "DATA";
  artifact_url?: string;                 // SUCCEEDED only
  artifact_url_expires_at?: string;
  artifact_hash?: string;
  reason?: string;                       // FAILED only
};
```

Callbacks are best-effort with bounded retries. A callback outage never changes the Build run's terminal status. The implementation makes up to 3 attempts in one invocation (5 s each; network errors, `429` and `5xx` retried), claims the callback on the run row so it is sent at most once, and uses no queue, DLQ or signature. The payload's `artifact_url` is a bearer secret; neither it nor `callback_url` is logged.

---

## 6. Error Catalogue

Errors are tagged classes or objects with `_tag`:

| HTTP / Handling | Tag(s) |
| --- | --- |
| 400 | `BadRequest`, `InvalidJson`, `UnknownField`, `InvalidCallbackUrl`, `InvalidBuildOption` |
| 403 | `ApiKeyDenied` |
| 404 | `BuildNotFound`, `BuildManifestNotFound` |
| 409 | `BuildAlreadyRunningForSource`, `BuildRunConflict` |
| 410 | `LegacyBundleTypeGone` |
| 422 | `SourceUrlUnavailable`, `SourceTooLarge`, `ArtifactTooLarge`, `UnsafeSourceUrl`, `UnsafeArchivePath`, `MarketplaceManifestInvalid`, `BundleTypeMismatch`, `LegacyArtifactShape`, `ProductLifecycleCommandRejected`, `CdkSynthFailed`, `LambdaAssetPolicyViolation`, `OpenApiStale`, `AssessmentFailed` |
| 500 | `InternalServerError`, `CodeBuildRunnerFailed`, `ArtifactUploadFailed` |
| 504 | `SourceUrlTimeout`, `CallbackTimeout` |

Every HTTP error uses:

```json
{
  "error": {
    "message": "Unprocessable Entity",
    "reason": "Lambda asset policy violation: Function FooHandler did not use approved construct package."
  }
}
```

The implementation adds `error.tag`. It keeps two non-PRD tags because no PRD tag fits: `404 SourceNotFound` (unknown, expired or other caller's `POST /sources` upload) and the persisted `422 DependencyInstallFailed` (`pnpm install --frozen-lockfile` failed, a product error before synth). PRD tags it never emits: `BuildAlreadyRunningForSource`, `LegacyBundleTypeGone`, `ArtifactTooLarge`, `OpenApiStale`, `AssessmentFailed`, `ArtifactUploadFailed`, `CallbackTimeout`. A missing or rejected API key is API Gateway's `403 ApiKeyDenied`.

---

## 7. Cross-Cutting Concerns

### 7.1 Observability

- Structured logs include `build_id`, `transaction_id`, `component_id`, `bundle_type`, `source_hash`, and `phase`.
- Metrics namespace: `build`.
- Required counters: `build.started`, `build.succeeded`, `build.failed`, `build.validation_failed`, `build.duration_ms`, `build.artifact_bytes`.
- Health emission uses the Build product identifier `c72b3b7c-dc30-41d0-81d3-3d3889370ef2` and stable per-route `PRODUCT_API_IDENTIFIER` values.
- Logs redact source URLs and secrets.

### 7.2 Security

- Presigned source URLs are bearer secrets and are never written to logs or callback payloads.
- CodeBuild runs with the minimum AWS permissions needed to read/write Build-owned resources. It cannot deploy CloudFormation.
- Source extraction rejects zip-slip and symlink escape attacks.
- Build artifacts are encrypted, private, and distributed only via presigned URLs.
- The `service-builder` metadata is provenance metadata, not an authorization proof. Marketplace still performs review and Deployer still validates the artifact before deployment.
- Callback URLs are outbound-only HTTPS and SSRF-checked.

### 7.3 Service/module structure

Expected implementation modules:

- `lambda/handlers/{start-build,status,logs,manifest}/handler.ts`
- `lambda/workers/{validate-request,select-runner,load-runner-output,finalize-artifact,persist-failed-run,send-callback}/handler.ts`
- `src/domain/{build-run,manifest,service-builder-metadata,errors}.ts`
- `src/services/{build-runs-repository,artifact-store,source-url-validator,codebuild-client,health-metrics,callback-client}.ts`
- `runner/{build-cloud-assembly,source-downloader,archive-normalizer,manifest-validator,golden-path-checks,cdk-synth-runner,cloud-assembly-validator,lambda-asset-policy,artifact-packager}.ts`
- `lib/{data-stack,workflow-stack,build-stack}.ts`
- `lib/state-machines/build-cloud-assembly.asl.ts`
- `scripts/generate-openapi.ts`

### 7.4 Testing strategy

- Unit tests use Vitest.
- Required coverage:
  - source URL SSRF validation;
  - zip extraction safety;
  - `marketplace.product.json` schema;
  - legacy artifact shape rejection;
  - service-builder metadata encoding;
  - Lambda asset policy validation;
  - CDK synth and cloud assembly portability failure mapping;
  - artifact hash calculation;
  - status and callback routes;
  - CDK stack assertions for buckets/tables/CodeBuild projects/API routes/IAM.
- CodeBuild runner tests run locally against fixture zips.
- Integration tests may hit a deployed Build API with `BUILD_API_URL`, `SERVICE_API_KEY`, and a presigned fixture source archive.
- CI exposes `just check`, `just test`, `just cdk:synth`, and `just cdk:deploy`.

### 7.5 CI/CD

- `pnpm check` runs `tsc -b`.
- `pnpm lint` runs ESLint.
- `pnpm format` runs Prettier with import sorting.
- `pnpm test` runs Vitest.
- `pnpm api:spec` regenerates the OpenAPI spec from route definitions.
- `.github/workflows/ci-cd-dev.yml` and `ci-cd-prod.yml` call shared reusable workflows.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ locally; Lambda runtime is Node.js 24.
- pnpm.
- CDK bootstrap completed in the Build service account.
- API Gateway custom domain and shared Usage Plan created by Bootstrap/Account.
- S3/DynamoDB/KMS/CodeBuild/Step Functions/Lambda/API Gateway permissions for the Build stacks.
- Approved platform construct package published and available to product source repositories.
- Product source repositories follow the Marketplace CDK source input layout; Build output follows the Deployer cloud assembly artifact layout.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy
pnpm cdk:destroy
```

Stack outputs:

- `BuildApiUrl`
- `BuildCloudAssemblyStateMachineArn`
- `BuildArtifactsBucketName`
- `SourceCacheBucketName`
- `BuildRunsTableName`
- `BuildEventsTableName`
- `KmsKeyArn`

Implemented outputs: `BuildApi-<stage>` exports `BuildApiUrl`, `CallerAApiKeyId`, `CallerBApiKeyId`; `BuildWorkflow-<stage>` and `BuildData-<stage>` export the state machine, CodeBuild project, bucket, table and key names (see the Build README).

Build publishes itself to Prism Marketplace from its own repository, not through the Build or Comply services: `just pack` synthesizes `marketplace/app.ts` without AWS credentials and packs the zip with Build's own checks, `just publish-dry-run` adds the security scan and writes the tokens, and `just publish` uploads through Marketplace `bundle-uploads` (live stages are refused).

### 8.3 Smoke tests

After every deploy:

1. `GET https://<subdomain>/infra-builder/information` returns `ServiceInfo`.
2. Submit a minimal valid CDK source fixture to `POST /builds`; expect `202`.
3. Poll `GET /builds/{build_id}` until `SUCCEEDED`.
4. Download `artifact_url`; verify it is a zip containing `marketplace.product.json`, `cdk.out/manifest.json`, at least one stack template, asset manifests, staged file assets, and `build/build.manifest.json`, and that it does not contain product source directories.
5. Decode `x-amz-meta-service-builder`; verify `artifact_kind=CDK_CLOUD_ASSEMBLY`, `deployer_contract_version=1`, `lambda_asset_policy.minified=true`, `lambda_asset_policy.obfuscated=true`, `cloud_assembly.manifest_path="cdk.out/manifest.json"`, and `artifact_hash` matches bytes.
6. Submit a fixture whose Lambda is minified but not obfuscated; expect `FAILED` with `LambdaAssetPolicyViolation`.
7. Submit a fixture containing `config.json` + `artifacts/foo/update.json`; expect `FAILED` with `LegacyArtifactShape`.

In the implementation, `scripts/smoke.sh --skip-codebuild <stage>` runs the checks that start no build, `--one-build` adds one uploaded baseline build with provenance and download checks, and the full mode runs every fixture. `scripts/demo.sh <git-repo> [ref]` builds one product end to end through the API; with `BUILD_BASE_URL` and `BUILD_API_KEY` set it needs no AWS credentials.

### 8.4 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy`.
2. Re-run smoke tests.
3. Existing build artifacts remain in S3 and status rows remain in DynamoDB.
4. In-flight CodeBuild builds continue under the old project definition or fail terminally; status reconciliation must close rows rather than leave them `BUILDING`.

### 8.5 Common runbook items

- **`LambdaAssetPolicyViolation`**: read `asset_policy.findings`; bundle each Node.js Lambda minified without source maps, run `javascript-obfuscator` on it, and remove raw `Code.fromAsset` Node handlers.
- **`CdkSynthFailed`**: inspect `GET /builds/{build_id}/logs` and `build/synth-report.json`; common causes are missing parameter declarations, AWS lookups at synth time, or product code calling AWS SDK during synth.
- **`SourceUrlUnavailable`**: presigned URL expired before CodeBuild downloaded it; retry with a fresh URL.
- **`ArtifactTooLarge`**: remove generated files from the source tree or split static assets into CDK assets loaded from product-owned buckets.
- **Docker asset validation failed**: remove CDK Docker image assets or move the image to a managed prebuilt-image distribution path; Deployer must not build product Docker contexts from Marketplace artifacts.

---

## 9. Re-Creation Checklist

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier, Vitest, Husky/lint-staged, `justfile`, shared CI caller workflows.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,tracer,event-handler}`, `@aws-sdk/client-{s3,dynamodb,codebuild,sfn,kms,ssm,apigateway,cloudwatch-logs}`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/s3-request-presigner`, `ulid`, `zod`, zip reader/writer (`yauzl`/`yazl` or equivalent), `jose` or platform JWT helper. CDK: `aws-cdk-lib`, `constructs`, `aws-cdk`, and CDK Toolkit Library where used.
3. **Schemas**: `start-build`, `build-status`, `build-manifest`, `marketplace-product-manifest`, `service-builder-metadata`, `lambda-asset-policy`, `errors`.
4. **API handlers**: start/status/logs/manifest plus `/information` mock in CDK.
5. **State machine workers**: validation, runner selection, output loading, finalization, failed-run persistence, callback.
6. **CodeBuild runner**: source download, archive normalization, manifest validation, dependency install, Golden Path checks, CDK synth, cloud assembly portability validator, Lambda policy validator, artifact packager.
7. **Artifact store**: S3 upload/download/presign helpers with metadata encoding and hash verification.
8. **DynamoDB repositories**: build runs, events, reports.
9. **CDK stacks**: DataStack, WorkflowStack, BuildStack, with least-privilege IAM and shared usage-plan attachment.
10. **OpenAPI generator**: route definitions drive `scripts/generate-openapi.ts`; generated spec checked in.
11. **Fixtures**: valid CDK service, valid CDK data bundle, raw-lambda violation, legacy Serverless artifact, unsafe zip paths.
12. **Smoke/integration tests**: deployed Build API exercise happy path and the two failure fixtures.

---

## 10. Acceptance Criteria

A re-implementation is complete when:

- `POST /builds` accepts a valid CDK source archive and returns a `SUCCEEDED` Build artifact that Marketplace can ingest without manual transformation.
- The output artifact is a Deployer-compatible CDK cloud assembly with `marketplace.product.json`, `cdk.out/manifest.json`, stack templates, asset manifests, staged file assets, `build/build.manifest.json`, and JWT-shaped `x-amz-meta-service-builder` metadata.
- The output artifact contains no product source directories, legacy `config.json`, `artifacts/<module>/update.json`, Serverless Framework deployment package, product-owned deploy script, `.git`, `node_modules`, source maps, local env files, or secrets.
- `service-builder` metadata is the unsigned token of §3.3: `artifact_kind=CDK_CLOUD_ASSEMBLY`, `deployer_contract_version=1`, `component_id`, `sha256:` source/assembly/artifact hashes, `cloud_assembly`, deployment parameters, and `lambda_asset_policy` with `minified=true`, `obfuscated=true`, and `source_maps=false`; CDK versions and per-file hashes live in `build/build.manifest.json`.
- Build rejects source that declares product-supplied synth/deploy/build commands or any non-CDK deploy engine.
- Build rejects TypeScript/JavaScript Lambda assets that are not minified, obfuscated and source-map-free (the implementation checks the final assets, not the construct package; §1.4).
- Build's CDK synth succeeds without AWS credentials, AWS lookups, shell hooks, or product-side SDK effects.
- Build rejects cloud assemblies that contain concrete Build account/region values, Docker image assets, local source paths, or tenant-varying values not represented as CloudFormation parameters.
- Marketplace `PUT /bundles` validates Build provenance and stores the artifact without weakening the dependency or review pipeline.
- Deployer validates Build provenance and Lambda asset policy before asset publishing/deploy and refuses unproven, source-only, or legacy artifacts.
- All Lambdas in the Build service itself use `nodejs24.x`, ARM64, ESM bundling, minification, and the `createRequire` banner.
- IAM follows least privilege; CodeBuild cannot deploy CloudFormation and API handlers cannot mutate artifacts outside their route contracts.
- All structured logs and metrics include `build_id`, `transaction_id`, `component_id`, and `phase`, with secrets redacted.
