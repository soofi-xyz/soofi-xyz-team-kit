# Bootstrap CLI - Product Requirements Document (PRD)

Authoritative blueprint for building the **Bootstrap CLI**. Bootstrap is the operator-run command line tool that turns a freshly provisioned Account tenant into a self-deploying tenant environment by installing the first **Deployer** and then using that Deployer to install **Marketplace Puller**.

The implementation language is **TypeScript**. Bootstrap is a CLI artifact, not a hosted service: it has no Lambda runtime, no API Gateway, no Step Functions state machine, and no persistent control-plane database. It talks to Account and Marketplace with the operator's tenant API key, uses the operator's configured AWS profile/SSO credentials to perform the one local Deployer install, then switches to the newly installed Deployer API for Puller and later product installs.

---

## 1. Product Overview

### 1.1 Mission

Bootstrap owns the initial "no Deployer exists yet" gap in the tenant lifecycle:

1. **Read tenant bootstrap state** from Account using `GET /accounts/{account_id}/bootstrap-manifest`.
2. **Resolve system-component bundles** from Marketplace for `Deployer` and `MarketplacePuller`.
3. **Install Deployer locally** into the new AWS sub-account using the operator's AWS credentials and the same bundle validation / parameter rendering rules used by normal Deployer product installs.
4. **Install Marketplace Puller through Deployer** by calling the newly live `/infra-deployer/deploy-by-token` route.
5. **Verify the tenant is self-deploying** by checking Deployer and Puller information endpoints and optionally creating initial Puller subscriptions.

Account remains the owner of tenant identity, AWS sub-account provisioning, DNS, and service keys. Marketplace remains the owner of catalog components and bundle URLs. Deployer remains the owner of CloudFormation deployment behavior after it exists. Puller remains the owner of subscription, webhook, and reconciliation behavior.

### 1.2 Primary User Surface

The CLI exposes these commands:

| Command | Purpose |
| --- | --- |
| `bootstrap environment` | Full initial bootstrap: manifest -> Deployer local install -> Deployer health -> Puller deploy -> Puller health. |
| `bootstrap plan` | Resolve manifest and bundles, validate AWS/account inputs, and print the deploy plan without side effects. |
| `bootstrap resume` | Resume an interrupted run from a local non-secret state file. |
| `bootstrap status` | Check Account manifest availability plus Deployer and Puller endpoint health. |
| `bootstrap version` | Print CLI version, build hash, and supported manifest schema versions. |

Canonical full-run shape:

```bash
bootstrap environment \
  --account-id acc_... \
  --api-key "$STAIRCASE_API_KEY" \
  --aws-profile tenant-bootstrap \
  --account-api-url https://marketplace.staircaseapi.com/account \
  --marketplace-api-url https://marketplace.staircaseapi.com/marketplace
```

The CLI must also accept `STAIRCASE_API_KEY`, `AWS_PROFILE`, `ACCOUNT_API_URL`, and `MARKETPLACE_API_URL` from the environment. Command-line flags take precedence.

### 1.3 Non-goals

- Bootstrap is **not** a serverless orchestrator. It does not create Lambdas, queues, schedules, or Step Functions outside the Deployer bundle it installs.
- Bootstrap does **not** provision AWS sub-accounts, DNS, ACM certificates, or service keys. Account owns those.
- Bootstrap does **not** publish, review, mutate, or re-host Marketplace bundles.
- Bootstrap does **not** deploy arbitrary products in local mode. Local mode is only for the `Deployer` system component before a Deployer API exists.
- Bootstrap does **not** persist plaintext API keys, service keys, AWS credentials, presigned bundle URLs, or subscription signing secrets.
- Bootstrap does **not** bypass Deployer after Deployer is live. Puller and all later products must go through `/infra-deployer/deploy-by-token`.

---

## 2. Inputs And Contracts

### 2.1 Required Inputs

| Input | Source | Purpose |
| --- | --- | --- |
| `account_id` | CLI flag | Account tenant to bootstrap. |
| Tenant API key | CLI flag or `STAIRCASE_API_KEY` | Authenticates to Account and Marketplace as the tenant owner. |
| AWS profile | CLI flag or `AWS_PROFILE` | Credentials used for the one local Deployer install. |
| Account API URL | CLI flag or `ACCOUNT_API_URL` | Base URL for Account routes. |
| Marketplace API URL | CLI flag or `MARKETPLACE_API_URL` | Base URL for Marketplace routes. |

Optional inputs:

| Input | Purpose |
| --- | --- |
| `--tenant-service-api-key` | Use an already known tenant service key for Deployer/Puller health and Puller deploy calls. |
| `--comply-token` | Allows the CLI to call Account `GET /service-key` when the service key is not provided. |
| `--deployer-component` / `--puller-component` | Override manifest system-component coordinates for development only. |
| `--dry-run` | Validate and print plan without writes. |
| `--state-file` | Path for non-secret resume metadata. |
| `--yes` | Disable interactive confirmation prompts. |

### 2.2 Account Contract

Bootstrap calls:

- `GET /accounts/{account_id}/bootstrap-manifest`
- `GET /accounts/{account_id}/service-key` only when it needs the tenant service-key plaintext and has Comply Authentication.

Manifest schema:

```ts
type BootstrapManifest = {
  schema_version: "bootstrap-manifest.v1";
  account_id: string;
  aws_account_id: string;
  subdomain: string;
  fqdn: string;
  hosted_zone_id: string;
  certificates: Array<{
    region: string;
    certificate_arn: string;
    kind: "MAIN" | "WILDCARD";
  }>;
  service_api_key_id: string;
  service_api_key_rotated_at?: string;
  marketplace_api_url: string;
  account_domain_config_ssm_param: string;
  deploy_regions: Array<{ RegionName: string; [key: string]: unknown }>;
  env_parameters?: Record<string, unknown>;
  system_components: {
    deployer: { product_id: string; component_id: string };
    marketplace_puller: { product_id: string; component_id: string };
  };
};
```

The manifest is non-secret. If Account cannot return `aws_account_id`, `subdomain`, `service_api_key_id`, or system-component coordinates, the CLI fails before any AWS write.

### 2.3 Marketplace Contract

Bootstrap calls:

- `GET /ontology/products/{product_id}/components/{component_id}/bundles?sort=desc&limit=1`
- `GET /ontology/products/{product_id}/components/{component_id}/bundles/{bundle_id}` when it needs a specific bundle during resume.

The returned bundle must include at least:

```ts
type BootstrapBundleRef = {
  product_id: string;
  component_id: string;
  bundle_id: string;
  bundle_url: string;
  type: "SERVICE";
  bundle_status: "Valid";
  dependency_layers?: Array<Array<{ product_id: string; component_id: string; type: "SERVICE" | "DATA" }>>;
};
```

Bootstrap refuses to install bundles that are not `Valid` or whose component does not match the manifest.

### 2.4 Deployer Contract

Before Deployer exists, Bootstrap locally executes only the Deployer bundle using the operator's AWS credentials. After Deployer exists, Bootstrap calls:

- `GET https://<subdomain>/infra-deployer/information`
- `POST https://<subdomain>/infra-deployer/deploy-by-token`
- `GET https://<subdomain>/infra-deployer/deploy/{bundle_id}`

The Puller deploy request uses the normal Deployer body:

```ts
type DeployByTokenRequest = {
  artifacts_url: string;
  bundle_id: string;
  callback_url?: string;
  custom_parameters: Record<string, unknown>;
};
```

For Bootstrap, Puller `custom_parameters` must include:

```ts
{
  Subdomain: string;
  MarketplaceHost: string;
  TenantAwsAccountId: string;
  TenantApiKeyID: string;
  AccountDomainConfigSsmParam: string;
}
```

---

## 3. Execution Flow

### 3.1 `bootstrap plan`

1. Load CLI config from flags and environment.
2. Fetch Account bootstrap manifest with `x-api-key`.
3. Verify the caller-selected AWS profile resolves to the manifest `aws_account_id` via STS `GetCallerIdentity`.
4. Resolve latest valid Deployer and Marketplace Puller bundles from Marketplace.
5. Download and inspect bundle headers and `config.json` without deploying.
6. Print a redacted plan: target account, subdomain, deploy regions, Deployer bundle id, Puller bundle id, and generated CFN parameter names.

### 3.2 `bootstrap environment`

1. Run the `plan` validations.
2. Obtain tenant service API key, either from `--tenant-service-api-key` or Account `GET /service-key` with Comply Authentication.
3. Download the Deployer bundle to a temp directory.
4. Validate the bundle:
   - zip is reachable and size is within local deploy limits;
   - `config.json` decodes;
   - `bundle_type = "SERVICE"`;
   - component id equals manifest `system_components.deployer.component_id`;
   - no `environment_token`, raw AWS credentials, or unknown credential-token fields are present.
5. Render Deployer CFN parameters from the manifest:
   - `Subdomain = manifest.subdomain`;
   - `Regions = JSON.stringify(manifest.deploy_regions)`;
   - `AccountDomainConfigSsmParam = manifest.account_domain_config_ssm_param`;
   - `EnvParameters = JSON.stringify(manifest.env_parameters ?? {})`;
   - `ServiceApiKeyID = manifest.service_api_key_id`;
   - `ServiceInfo` identifies the Deployer component and bundle.
6. Locally deploy Deployer stacks using CDK/CloudFormation against the AWS profile's account.
7. Poll `GET /infra-deployer/information` until healthy or timeout.
8. Resolve/download Marketplace Puller bundle metadata.
9. Call Deployer `POST /deploy-by-token` for the Puller bundle.
10. Poll Deployer status until Puller deploy succeeds or fails.
11. Poll `GET /marketplace-puller/information` until healthy.
12. Write final non-secret state and print the tenant endpoints.

### 3.3 `bootstrap resume`

The resume file contains only non-secret metadata:

```ts
type BootstrapState = {
  schema_version: "bootstrap-state.v1";
  account_id: string;
  aws_account_id: string;
  subdomain: string;
  deployer_bundle_id?: string;
  puller_bundle_id?: string;
  deployer_stack_names?: string[];
  puller_deploy_id?: string;
  completed_steps: string[];
  updated_at: string;
};
```

Resume recomputes all secrets and presigned URLs from Account and Marketplace. It never trusts stored bundle URLs.

---

## 4. Local Deployer Install Semantics

The local Deployer install is a bootstrap-only mirror of Deployer product deployment. The implementation should share code with Deployer where possible:

- bundle download and validation;
- config parsing;
- CFN parameter rendering;
- stack naming;
- tag rendering;
- CloudFormation create/update behavior;
- deploy result formatting.

Differences from normal Deployer:

- there is no Deployer API yet, so the CLI calls AWS SDK/CDK directly;
- the only allowed component is the manifest Deployer component;
- the CLI must verify STS account id before any write;
- the CLI must print every stack it plans to create/update before applying;
- rollback behavior is explicit: failed create rolls back through CloudFormation defaults; failed update requires the same recovery guidance as Deployer.

Bootstrap must not support arbitrary local product deployment flags. If the user asks to install any component other than Deployer in local mode, the CLI exits with `LocalDeployOnlySupportsDeployer`.

---

## 5. Security

- API keys may be read from flags, environment variables, or interactive prompt. They are never written to disk.
- The state file is non-secret and must be safe to commit by accident.
- Logs redact `api_key`, `x-api-key`, `authorization`, `service_api_key`, `bundle_url`, `signing_secret`, `access_key`, `secret_key`, and `session_token`.
- The CLI validates `aws sts get-caller-identity` account id equals manifest `aws_account_id` before CloudFormation writes.
- Marketplace bundle URLs are treated as bearer secrets and never printed unless `--debug-unsafe-print-urls` is set. That flag is forbidden in CI.
- `--yes` suppresses prompts but does not suppress account-id and bundle-component validations.
- The CLI exits non-zero if Deployer is already present but points to a different account or subdomain.

---

## 6. Errors

Errors are tagged objects/classes with `_tag`:

| Tag | Meaning |
| --- | --- |
| `MissingRequiredInput` | Required flag/env var absent. |
| `AccountManifestNotReady` | Account exists but is not provisioned enough to bootstrap. |
| `AwsAccountMismatch` | AWS profile account id does not equal manifest `aws_account_id`. |
| `SystemComponentNotFound` | Manifest component coordinates do not resolve in Marketplace. |
| `InvalidSystemBundle` | Bundle is not valid, wrong type, wrong component, or malformed. |
| `LocalDeployOnlySupportsDeployer` | Caller attempted local install for a non-Deployer component. |
| `DeployerHealthTimeout` | Deployer information endpoint did not become healthy. |
| `PullerDeployFailed` | Deployer returned terminal failure for Puller. |
| `PullerHealthTimeout` | Puller information endpoint did not become healthy. |
| `SecretPersistenceRefused` | A requested state/log path would persist secret material. |

Every error response printed to the terminal includes a short remediation line and the last safe correlation id.

---

## 7. Implementation Plan

### 7.1 Repository Shape

Bootstrap should be implemented as a TypeScript package in the Deployer implementation repo unless the team creates a dedicated `bootstrap` repo. Either shape must expose the same command contract.

Expected files:

```text
cli/bootstrap.ts
src/bootstrap/commands/{environment,plan,resume,status}.ts
src/bootstrap/services/{account-client,marketplace-client,deployer-client,bundle-cache,local-deployer-installer}.ts
src/bootstrap/domain/{manifest,bundle,plan,state,errors}.ts
src/bootstrap/security/redaction.ts
test/bootstrap/**/*.test.ts
```

### 7.2 Dependencies

Runtime dependencies:

- `@aws-sdk/client-sts`
- `@aws-sdk/client-cloudformation`
- `@aws-sdk/client-s3`
- `@aws-sdk/client-ssm`
- `@aws-sdk/credential-providers`
- `commander` or `clipanion`
- `zod`
- `yauzl` or the same zip reader used by Deployer

Dev/test dependencies follow the SOCAPITAL TypeScript standard: Vitest, ESLint, Prettier, `tsc -b`.

### 7.3 Tests

Required test coverage:

- manifest schema validation;
- Account and Marketplace client auth headers;
- AWS account mismatch guard;
- bundle validation rejects wrong component/type/status;
- local deploy plan renders expected Deployer CFN parameters;
- no secrets are written to state file or logs;
- resume refreshes bundle URLs instead of reusing stored URLs;
- Puller handoff uses Deployer `/deploy-by-token`;
- dry-run performs no AWS writes.

Integration tests may use mocked Account/Marketplace HTTP servers and AWS SDK mocks. A real AWS integration smoke test is optional and must be explicitly gated by env vars.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Account tenant is `ACTIVE`.
- `GET /accounts/{account_id}/bootstrap-manifest` returns `schema_version = bootstrap-manifest.v1`.
- Marketplace has valid released bundles for the manifest Deployer and Marketplace Puller components.
- Operator has an AWS profile/SSO role in the target tenant account with permissions needed by the Deployer bundle's CDK/CloudFormation stacks.
- Operator has the tenant owner's API key.
- Operator has either the tenant service API key or Comply Authentication permission to read it from Account.

### 8.2 Happy Path

```bash
bootstrap plan \
  --account-id acc_... \
  --api-key "$STAIRCASE_API_KEY" \
  --aws-profile tenant-bootstrap

bootstrap environment \
  --account-id acc_... \
  --api-key "$STAIRCASE_API_KEY" \
  --aws-profile tenant-bootstrap \
  --yes
```

Expected result:

- Deployer information endpoint returns 200.
- Puller information endpoint returns 200.
- Bootstrap state file records completed steps without secrets.
- Future product installs can be performed by Puller/Deployer without local mode.

### 8.3 Recovery

- If local Deployer install fails before stack creation, fix inputs and rerun `bootstrap environment`.
- If CloudFormation create fails, inspect the failed Deployer stack events, fix the cause, and run `bootstrap resume`.
- If Deployer is healthy but Puller deploy fails, use `GET /infra-deployer/deploy/{bundle_id}` to inspect the failure and rerun `bootstrap resume`.
- If service API key was rotated during bootstrap, rerun with a fresh `--tenant-service-api-key` or Comply token.

---

## 9. Acceptance Criteria

- A newly provisioned Account tenant can be bootstrapped with one CLI command after AWS SSO login.
- The CLI installs Deployer locally exactly once and installs Puller through Deployer.
- The CLI refuses to deploy when AWS profile account id differs from the Account manifest.
- No plaintext API key, service key, AWS credential, presigned URL, or signing secret is written to disk.
- All command outputs are actionable and include safe correlation ids.
- `bootstrap plan` is side-effect free.
- `bootstrap resume` can recover from interruption after Deployer install and after Puller deploy start.
- Existing Account, Marketplace, Deployer, and Puller PRDs point to this document for bootstrap CLI ownership.
