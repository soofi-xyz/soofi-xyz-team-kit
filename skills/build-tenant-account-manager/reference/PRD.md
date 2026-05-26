# Account Service — Product Requirements Document (PRD)

Authoritative blueprint for building the **Account** service. Account is the serverless tenant-identity-and-bootstrap service: it mints customer / organization identities, manages the lifecycle of every API key (rotation, revocation, per-account service keys), provisions the **underlying AWS sub-account** that backs every Staircase tenant, configures the **DNS layer** (Route 53 hosted zone, ACM certificates, canonical domain metadata) that exposes that tenant under a `<subdomain>.staircaseapi.com` FQDN, and mints **maintenance access** sessions (short-lived, MFA-gated AWS console credentials) into any tenant on demand.

The implementation language is **TypeScript everywhere**; infrastructure is **AWS CDK only**, deployed to the installer-supplied control-plane AWS region, per the Golden Path engineering standards. Account is a **single product, single stack**, deployed once into the marketplace AWS account. Per-tenant operational concerns (configuration drift, quotas, costs, product-deployment inspection / deletion, partner credential vault, partner certificate vault, …) are **explicitly out of scope** — those responsibilities belong to other services and are listed under §1.4 Non-goals.

`Account` is the **only persistent entity** Account exposes. There is no separate "environment" / "tenant" / "workspace" concept; an account is **whatever the row in `AccountsTable` represents** at every stage of its life — from a freshly-signed-up identity awaiting email confirmation, through a provisioned AWS sub-account with a live DNS layer, all the way to a disabled tombstone.

---

## 1. Product Overview

### 1.1 Mission

Account owns five responsibilities that together make a tenant **exist** and stay **operable**:

1. **Identity issuance** — mint, confirm, and look up customer / organization identities. A `customer` is a single human owner with a self-service email-confirmation flow; an `organization` is a multi-user shared identity created by an existing operator.
2. **API key management** — manage the full lifecycle of every API key: account-bound keys (the public `x-api-key` value any caller uses to identify the originating account) and per-account **service keys** (used by Staircase products inside one account to call other products in the same account or across accounts). Keys are minted by Account, encrypted at rest, and rotatable via a dedicated workflow that never exposes plaintext to storage. Bootstrap owns the tenant's single shared API Gateway Usage Plan and binds the initial service key to it; Account rotation later updates that one shared Usage Plan binding.
3. **AWS sub-account provisioning** — for each account that asks to be activated, create (or accept a pre-provisioned) AWS sub-account inside the marketplace's AWS Organization, store the bootstrap admin material encrypted at rest, and publish the bootstrap manifest that a tenant operator uses to install the initial Deployer + Marketplace Puller. Account is the **only** place new tenant AWS sub-accounts are minted and the **only** place existing ones are torn down.
4. **DNS configuration** — for each provisioned account, create a Route 53 hosted zone for `<subdomain>.staircaseapi.com`, request the matching ACM main + wildcard certificates, perform DNS-validation, and publish the account's canonical domain inventory for downstream product deployments. Bootstrap uses that inventory to create the tenant's single API Gateway custom domain in the tenant account; individual service CDK stacks own only their own base-path mappings to that existing domain (`AWS::ApiGateway::BasePathMapping` for REST APIs, `AWS::ApiGatewayV2::ApiMapping` only for API Gateway v2 APIs).
5. **Maintenance access** — mint short-lived AWS console credentials into any provisioned account on demand for support / on-call engineers. The mint runs **from the marketplace** by `sts:AssumeRole`-ing into the tenant sub-account's `OrganizationAccountAccessRole`, then provisioning a temporary IAM user and login profile. MFA enrollment is an explicit manual operator step performed in AWS IAM after the temporary user exists; Account does not call `EnableMFADevice` automatically. Each session is owner-approved (via SES email callback), single-use, and TTL-bounded; subsequent requests by the same `username` against the same account supersede the prior session.

The outputs Account hands the rest of the platform are: (a) one `AccountsTable` row per tenant that records identity, AWS sub-account id, FQDN, hosted zone id, ACM certificates, encrypted service key, and lifecycle status; (b) `ApiKeysTable` rows that bind callable API key plaintexts (returned exactly once at mint, hashed at rest forever after) to their owning `account_id`; (c) on-demand `MaintenanceLoginsTable` rows that surface a one-time AWS console login URL. Everything else — what *products* get deployed into the AWS sub-account, what *partner configurations* get applied, what *partner credentials* get loaded — is **not** Account's job.

### 1.2 Primary user surface

A single **AWS API Gateway REST API** mounted at `https://<marketplace-subdomain>/account/`*, API-key authorised (`x-api-key` per Usage Plan), with the capability groups below (full mapping in §4):


| Group                       | Routes                                                                                                                                                                                                                  | Purpose                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Account identity**        | `POST /accounts`, `PUT /accounts/{account_id}`, `GET /accounts/{account_id}`, `GET /accounts`, `POST /accounts/confirm-email`, `GET /accounts/confirm-email-and-activate-key-in-documentation`                          | Self-service signup, profile update, email confirmation, post-confirmation key activation, search.      |
| **API key management**      | `GET /accounts/{account_id}/api-keys`, `POST /accounts/{account_id}/api-keys` (rotate-by-add), `DELETE /accounts/{account_id}/api-keys/{api_key_id}`, `POST /accounts/activate-key-in-documentation`                    | List / mint / revoke account-level API keys; activate a customer key against the documentation account. |
| **Account provisioning**    | `POST /accounts/{account_id}/provision`, `POST /accounts/{account_id}/provisionV2`, `GET /accounts/{account_id}/bootstrap-manifest`, `POST /accounts/{account_id}/disable`, `POST /accounts/{account_id}/delete-callback` | Provision the AWS sub-account + DNS layer for an existing identity; expose the bootstrap manifest; disable + finalise teardown. |
| **Service keys**            | `GET /accounts/{account_id}/service-key`, `POST /accounts/{account_id}/service-key/rotate`                                                                                                                              | Read or rotate the per-account service key bound to the Bootstrap-managed tenant Usage Plan.            |
| **DNS — custom domains**    | `PUT /accounts/{account_id}/custom-domains`, `GET /accounts/{account_id}/domain-config`                                                                                                                                 | Register and self-heal account domain/certificate metadata; expose standardized domain inputs for service deployments. |
| **Maintenance access**      | `POST /accounts/{account_id}/maintenance-access`, `GET /accounts/{account_id}/maintenance-access/temp-access`, `GET /accounts/{account_id}/access-permission` | Mint temporary AWS console credentials into the account; owner-approval webhook; manual MFA enrollment when required. |
| **Internal — service info** | `GET /information`                                                                                                                                                                                                      | Static service metadata (mocked through API Gateway).                                                   |


Each successful POST that mints async work returns `202 Accepted` with a server-generated correlation id (`account_id`, `api_key_id`, `temp_access_uuid`, or `task_token`). Every mutating route is `x-api-key`-gated against the Usage Plan bound to the deployer-supplied `ServiceApiKey`, plus CORS preflight; the only exceptions are `POST /accounts/confirm-email` (JWT-authenticated by the confirmation token), `POST /accounts` (anyone can sign up), `GET /accounts/{account_id}/access-permission` (HMAC-signed link from the owner-approval email), and `GET /information` (mock). Maintenance-access mutating routes additionally require **Comply Authentication** (`Authorization: Bearer <token>` issued by `https://compliance-auth.comply-authentication.staircaseapi.com`) so support engineers must be SSO-authenticated before any IAM material is minted into a tenant.

### 1.3 Conceptual entities

These four entities back every persistent table in §3. There is **no `Environment` entity** — the AWS sub-account, FQDN, and DNS layer are attributes of the `Account` itself, populated when the account transitions to `PROVISIONING` and onwards.

1. **Account** — the unified per-tenant row. Carries identity (`account_id`, `kind`, `email`, `first_name`, `last_name`, `company_name?`, `parent_account_id?`), lifecycle (`status`, `version`, `required_actions[]`, `confirmed_email_at?`), and — once provisioned — the AWS sub-account handle and DNS layer (`aws_account_id`, `subdomain`, `fqdn`, `hosted_zone_id`, `certificates[]`, `account_token?`, `admin_enc?`, `service_api_key_id?`, `service_api_key_encrypted?`, `service_api_key_hash?`, `service_api_key_rotated_at?`). One account, one AWS sub-account, one FQDN. Sub-accounts can reference a parent (an `organization` account that owns one or more `customer` accounts under it) via `parent_account_id`, but the entity name is the same in every case.
2. **API Key** — the `(account_id, api_key)` pair representing one usable `x-api-key` value. Carries `api_key_id` (the API Gateway-assigned id; immutable per row), `api_key_hash` (HMAC-SHA256 of the plaintext for fast lookup), `account_id` (FK), `kind` (`account` for account-bound keys, `service` for service keys minted into the tenant sub-account), `status` (`PENDING_CONFIRMATION` / `ACTIVE` / `REVOKED`), `usage_plan_key_id?` (for the tenant's single Bootstrap-managed shared Usage Plan), `created_at`, `revoked_at?`. Multiple `ACTIVE` rows per `account_id` are allowed during rotation. **API keys are stored on a separate row** so an `account_id` can have many keys at once and rotation never touches the `Account` row.
3. **Custom domain configuration** — the per-account list of canonical and alias FQDNs plus hosted-zone / certificate metadata that Bootstrap uses to create the tenant API Gateway custom domain and downstream service stacks use to create their own base-path mappings. Account stores and self-heals the DNS/certificate facts, but does not create or delete tenant API Gateway `DomainName`, `BasePathMapping`, or `ApiMapping` resources.
4. **Maintenance Session** — a single short-lived AWS console grant minted into a tenant sub-account. Carries `username` (the SSO identity of the requester), `iso8601_logged_in_at` (RANGE key), `account_id` (FK), `temp_access_uuid` (single-use 30-char URL token), `temp_access_credentials_enc` (KMS-encrypted `{ aws_console_username, account_alias, password }`), `iam_user_arn`, `mfa_device_arn?`, `user_type` (`MAINTENANCE` / `QUICKSIGHT`), `expiration_minutes`, `approval_state` (`PENDING` / `APPROVED` / `DENIED` / `EXPIRED`), `approver_email?`, `expires_at`, `iam_cleanup_at?`, `ttl_epoch_seconds` (= `iso8601_logged_in_at + 24h` for audit-row retention only).

### 1.4 Non-goals (explicit)

These responsibilities lived in the legacy `customer-account-manager` and `environment-manager-service` codebases but are **not** in Account's scope. Each one is owned by another service or marked as future work:

- **No partner credential vault.** `POST/GET /credentials`, `GET /retrieve-credentials`, `GET /retrieve-all-credentials`, `GET /retrieve-list-credentials` are **not** part of Account. Connect owns the partner credential vault through its `/connector-jobs/vendors/{vendor_name}/credentials` and `/passed-credentials` routes; Account never stores or retrieves partner credentials.
- **No partner certificate vault.** `POST /upload-certificate/{partner+}`, `GET /retrieve-certificate/{partner+}` are **not** Account. (Account's certificates are ACM TLS certs for the account FQDN, not partner-supplied PKI bundles.)
- **No configuration registry.** Per-product configuration documents are owned by the products that consume them.
- **No master-data bootstrap.** `POST /master-data`, `POST /master-data-partner`, `GET /retrieve-environment-records` are **not** Account.
- **No tenant-plane self-management.** Account does **not** ship a Lambda surface that runs **inside** each tenant AWS sub-account. The legacy `environment-manager-service` capabilities that **are** absorbed by Account (API key management, service-key rotation, MFA maintenance access) are exposed via the **marketplace** REST API and execute against the tenant sub-account exclusively through `sts:AssumeRole`. The remaining legacy capabilities (configuration drift checks, AWS Service Quotas requests, product-deployment inspection / deletion, account tagging, per-account budgets, cleanup CodeBuild) are **deferred to a separate service** and not built here.
- **No product bootstrap execution.** Account does **not** install Deployer, Puller, or any other product stack. It only returns the data needed by the operator-run bootstrap CLI defined in `Bootstrap.md`; the CLI downloads system-component bundles from Marketplace and deploys them into the newly provisioned tenant account.
- **No marketplace cost / budget aggregation.** `GET /costs`, `GET /product-deployments`, `PUT /budgets`, `POST /alerts` are **not** Account. Marketplace-side cost aggregation is a separate product.
- **No SES customer-email beyond the confirmation and maintenance flows.** Account sends two templated email families — the email-confirmation message and the maintenance-access owner-approval / link emails — and nothing else.
- **No tenant service routing ownership.** Account stops at DNS, certificates, and domain metadata. API Gateway base-path mappings for product routes are defined in each service's CDK infrastructure and deployed by Deployer as part of that service stack.
- **No IAM Identity Center / SSO orchestration.** The bootstrap IAM user inside a new tenant sub-account is short-lived and rotated as soon as `OrganizationAccountAccessRole` is assumable.

---

## 2. Architecture

### 2.0 Architectural principles (non-negotiable)

These principles anchor every other section and override any conflicting design choice elsewhere in the codebase.

1. **Single source tree, single CDK stack.** The repository ships **one** TypeScript application with **one** `bin/app.ts` and **one** deployable stack (`AccountStack`, plus a thin `AccountSharedStack` that owns the KMS CMK). There is no second CDK app, no per-tenant in-account Lambda surface, no Serverless Framework parallel.
2. **One abstraction: Account.** `Account` is the only persistent entity name surfaced in routes, payloads, logs, metrics, and tables. There is no `Environment`, no `Tenant`, no `Workspace`. An account at signup is the same row as the same account once its AWS sub-account and DNS are live; only `status` changes.
3. **Step Functions is the workflow implementation layer for every async workflow.** Email confirmation, account provisioning (AWS sub-account + DNS), account teardown, custom-domain configuration, service-key rotation, and maintenance access all compile to AWS Step Functions state machines. There is no Lambda-only orchestrator, no in-process workflow engine, no chained-SQS workflow worker. Branching, looping, retries, catches, waits, parallelism, and human-in-the-loop pauses are expressed exclusively as native ASL constructs (`Choice`, `Map`, `Parallel`, `Retry`, `Catch`, `Wait`, `Wait For Task Token`).
4. **Cross-account access is STS, not embedded credentials.** When Account has to reach into a tenant sub-account (DNS-record changes, ACM certificate management, teardown, **per-account service key rotation, maintenance access IAM minting**), it `sts:AssumeRole`s `arn:aws:iam::<aws_account_id>:role/OrganizationAccountAccessRole`. Long-lived IAM users in tenant sub-accounts are forbidden — the **only** exceptions are (a) the short-lived bootstrap IAM user on `admin_enc` rotated/deleted immediately after `OrganizationAccountAccessRole` is assumable, and (b) the per-maintenance-session IAM user that lives at most `MAINTENANCE_ACCESS_TTL_MINUTES` (default 30) and is garbage-collected by `IamUserGarbageCollector` on a `rate(1 hour)` schedule.
5. **AWS-native integrations beat custom code.** Where Step Functions has a first-class service integration (`organizations:CreateAccount`, `acm:RequestCertificate`, `route53:ChangeResourceRecordSets` via `aws-sdk` task), the orchestrators use it directly. Custom Lambdas exist only when no AWS-native integration suffices.
6. **No in-process workflow engine, no in-process SSH client, no in-process code sandbox.** `vm2`, `isolated-vm`, dynamic `eval`, `node:vm`, `ssh2`, `ssh2-sftp-client`, and `node-ssh` are forbidden.
7. **API keys are decoupled from the Account row.** Every API key lives in `ApiKeysTable` keyed by `api_key_hash`; the `Account` row never carries an `api_key` column on its primary key or on any GSI. Rotation writes a new `ApiKeysTable` row at `ACTIVE` with the same `account_id`, publishes the new plaintext to Account-managed tenant-side consumers, then flips the prior row to `REVOKED` after a configurable grace window. Resolving `x-api-key` → owning account is always `hash(x-api-key) → ApiKeysTable.GetItem → account_id → AccountsTable`. No DDB primary key or GSI key has ever held a plaintext or hashed `account_key`.
8. **Plaintext API keys are returned exactly once.** `ApiKeysTable` stores `api_key_hash = HMAC-SHA256(API_KEY_HMAC_SECRET, api_key)`. The plaintext value is surfaced only in the response of the mint operation that created it; thereafter Account cannot recover it. Lookups from a caller-supplied `x-api-key` always hash the input first.
9. **Maintenance MFA is manually enrolled.** Account does not store or generate TOTP seeds and does not expose maintenance passcode APIs. If the tenant's IAM policy requires MFA for the maintenance user, the operator enrolls the temporary user's MFA device manually before using the console credentials. Account's responsibility is to mint, approve, expose once, and clean up the short-lived IAM user.

### 2.1 Stacks (AWS CDK)

The CDK app is composed of two stacks, deployed in order, both in the installer-supplied control-plane region:

```
bin/app.ts
├── AccountSharedStack       # KMS CMK (DataKey), Logging bucket
└── AccountStack             # REST API + Lambdas + Step Functions + AccountsTable +
                             # ApiKeysTable + CustomDomainsTable + MaintenanceLoginsTable +
                             # AccountRecordBucket + ConfirmationEmailQueue +
                             # MaintenanceApprovalQueue + IamGarbageCollectionQueue +
                             # SES templates + ConfirmEmail SFN + AccountProvisioning SFN +
                             # AccountTeardown SFN + DomainConfig SFN +
                             # ServiceKeyRotation SFN + MaintenanceAccess SFN +
                             # DDB-stream listener for confirmation emails +
                             # Scheduled IAM user / maintenance-session GC
```

`AccountStack.addDependency(sharedStack)` ensures the shared resources deploy first. Both stacks are declared in **TypeScript** with AWS CDK v2 and deployed exclusively via `cdk deploy`. The deploy region is provided by CDK env/context; any AWS feature with a service-mandated regional constraint must derive that region from named installer configuration instead of a literal in source or PRD text. No Serverless Framework, SAM, Terraform, Pulumi, raw CloudFormation, or other IaC tools are permitted (per `cloud-aws-primary`).

### 2.2 AccountSharedStack contents

- **AWS-KMS Customer-Managed Key** (`DataKey`, alias `alias/account-data-key-<accountId>`) used by every DDB table for SSE, by Secrets Manager for the per-account bootstrap secret, and by the `EncryptionService` Lambda helpers. Key policy grants `kms:Encrypt|Decrypt|GenerateDataKey|DescribeKey` to the runtime Lambda role and `kms:CreateGrant` for AWS-managed-resource grants.
- `**LoggingBucket`** (S3-managed encryption, `LogDeliveryWrite` ACL, `BLOCK_ALL` public access, SSL-only) — S3 access log target for all other Account-owned buckets.

Stack outputs (re-exported at the application level): `DataKeyArn`, `LoggingBucketName`.

### 2.3 AccountStack contents

#### 2.3.1 Storage


| Bucket                | Encryption / ACL                                                                                         | Lifecycle                                                                 | Purpose                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccountRecordBucket` | S3-managed encryption, `BLOCK_ALL`, `BUCKET_OWNER_ENFORCED`, SSL-only, S3 access logs to `LoggingBucket` | 90-day expiry on `commit-files/`; 30-day expiry on `provisioning-traces/` | Per-account bootstrap snapshots (`commit-files/<account_fqdn>/<file_name>.json`) and step-by-step provisioning traces written by `AccountProvisioningStateMachine`. |


The bucket enforces `BLOCK_ALL` public access, SSL-only, and `BUCKET_OWNER_ENFORCED` ownership.

#### 2.3.2 Queues


| Queue                       | Retention | VT     | DLQ + maxReceiveCount        | Purpose                                                                                                                                                      |
| --------------------------- | --------- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AccountsProcessingQueue`   | 4 d       | 15 min | `AccountsProcessingDlq`, 5   | Out-of-band post-provisioning work (notify other services that a new account is `ACTIVE`).                                                         |
| `ConfirmationEmailQueue`    | 2 d       | 5 min  | `ConfirmationEmailDlq`, 5    | Decouple DDB stream → SES throughput so a burst of signups never throttles the stream listener.                                                              |
| `MaintenanceApprovalQueue`  | 1 d       | 5 min  | `MaintenanceApprovalDlq`, 5  | Owner-approval webhooks from the SES email callback are queued and matched against pending `MaintenanceLoginsTable` rows by `MaintenanceApprovalApplier`.    |
| `IamGarbageCollectionQueue` | 2 d       | 5 min  | `IamGarbageCollectionDlq`, 5 | Session-expiry events, explicit revoke calls, and final TTL deletion signals from `MaintenanceLoginsTable` land here; `IamUserGarbageCollector` consumes and assumes into the tenant sub-account. |


Each DLQ has a 14-day retention. SQS-managed encryption, `enforceSSL: true` everywhere.

#### 2.3.3 DynamoDB

All tables use `PAY_PER_REQUEST`, KMS-CMK SSE (`DataKey`), Point-In-Time Recovery enabled, and TTL on `ttl_epoch_seconds` for transient rows where annotated.


| Table                    | Keys                                              | Indexes                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AccountsTable`          | PK `account_id` (S) + SK `version` (N)            | `parent_account_id_index` (PK `parent_account_id`, SK `version`, ALL), `subdomain_index` (PK `subdomain`, SK `subdomain_status`, ALL), `subdomain_status_index` (PK `subdomain`, SK `status`, ALL), `fqdn_index` (PK `fqdn`, SK `status`, ALL), `status_index` (PK `status`, SK `version`, ALL); `StreamViewType: NEW_IMAGE` | The single source of truth. Every tenant — whether it's still pending email confirmation, fully provisioned, or disabled — is one row family here. PK is **stable for the life of the tenant** (`account_id` is a UUID v4 minted at signup) so API key rotation never invalidates it. The stream feeds `ConfirmationEmailEnqueuer`. Item shape mirrors §3.2. |
| `ApiKeysTable`           | PK `api_key_hash` (S)                             | `account_id_index` (PK `account_id`, SK `created_at`, ALL), `api_key_id_index` (PK `api_key_id`, ALL), `status_index` (PK `status`, SK `created_at`, ALL)                                                                                                                                                                    | API key registry. `api_key_hash = HMAC-SHA256(API_KEY_HMAC_SECRET, api_key)`; the plaintext is **never** stored. `api_key_id` is the API Gateway-assigned id (deterministic handle for unbind / delete operations even after the row is `REVOKED`). Item shape mirrors §3.3.                                                                                 |
| `CustomDomainsTable`     | PK `account_fqdn` (S) + SK `domain_name` (S)      | `target_index` (PK `target_fqdn`, ALL)                                                                                                                                                                                                                                                                                       | One row per canonical or alias domain available to the account; reconciled by the domain-configuration workflow. Service-specific base paths are not stored here because service CDK stacks own their own API mappings.                                                                                                                                      |
| `MaintenanceLoginsTable` | PK `username` (S) + SK `iso8601_logged_in_at` (S) | `temp_access_uuid_index` (PK `temp_access_uuid`, ALL), `account_id_index` (PK `account_id`, SK `iso8601_logged_in_at`, ALL); TTL on `ttl_epoch_seconds`; `StreamViewType: OLD_IMAGE`                                                                                                                                         | Maintenance session and audit records; rows TTL 24 hours after `iso8601_logged_in_at`, but row presence never extends IAM-user lifetime. `expires_at` drives temp-link/passcode expiry, and `iam_cleanup_at` records when the tenant IAM user was deleted. The TTL deletion stream is a final best-effort cleanup signal, not the primary safety net. Item shape mirrors §3.5. |


Table encryption uses the shared `DataKey` granted `kms:{Decrypt,Encrypt}` for the runtime Lambda role, scoped via `kms:ViaService=dynamodb.<region>.amazonaws.com`.

**Resolving `x-api-key` → account is always a fixed three-step lookup:**

```
hash      = HmacFingerprintService.hash(x-api-key)        # in-process
keyRow    = ApiKeysTable.GetItem({ api_key_hash: hash })  # 1× RCU
accountId = keyRow.account_id                              # constant-time
account   = AccountsTable.Query({ account_id, latest version }) # 1× RCU
```

Because `AccountsTable.PK` is the immutable `account_id` and is **never** the API key hash, every existing handle (SFN execution names, S3 prefixes, SQS messages, log lines, downstream service references) keeps working across an arbitrary number of API key rotations.

#### 2.3.4 Compute

All Lambdas are `NodejsFunction` with `runtime=NODEJS_24_X`, `architecture=ARM_64`, ESM bundling (`format: ESM`, `target: node24`, `mainFields: ["module", "main"]`, `--conditions module`), and the standard ESM `createRequire` banner so any CommonJS dependency (e.g. JWT libraries, `aws4`) can satisfy dynamic built-in `require`s. Logging format is JSON with three-month CloudWatch log-group retention. Handlers use `@aws-lambda-powertools/{logger,tracer,metrics}` with `POWERTOOLS_SERVICE_NAME=account-`*, `POWERTOOLS_LOG_LEVEL=INFO`, `POWERTOOLS_METRICS_NAMESPACE=account` (per `observability-logging-tracing`).

There are seven cohorts; the route-to-handler matrix lives in §4.


| Cohort                      | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Memory     | Timeout  | VPC | Trigger                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --- | --------------------------------------------------------------------- |
| **Public API router**       | `AccountHandler`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 512 MB     | 30 s     | —   | API Gateway REST API                                                  |
| **Provisioning workers**    | `ValidateProvisionRequest`, `EnsureSubdomainAvailable`, `BootstrapAwsSubAccount` (`organizations:CreateAccount` + bootstrap IAM-user mint), `RequestAcmCertificates`, `WaitForCertificateValidation`, `CreateRoute53HostedZone`, `MintInitialServiceApiKey` (cross-account; provisions the account's first `service_api_key` and stores `service_api_key_id` + `service_api_key_encrypted` on the row), `WriteProvisionedAccountRow` (writes the next `version` of the account at `status = ACTIVE`), `EmitProvisioningCallback`                                                                                                                                                                 | 1024 MB    | 15 min   | —   | Step Functions task                                                   |
| **Teardown workers**        | `MarkAccountDisabling`, `AssertNoTenantApiGatewayDomainConsumers`, `DeleteRoute53Records`, `DeleteAcmCertificates`, `RevokeAllApiKeysForAccount`, `WriteDisabledAccountRow`, `EmitDeletionCallback`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 1024 MB    | 15 min   | —   | Step Functions task                                                   |
| **DNS / domain workers**    | `RegisterDomainConfig`, `ValidateDomainCertificate`, `PublishDomainConfig`, `RecordCustomDomainCollection`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 512 MB     | 200 s    | —   | Step Functions task in `DomainConfigStateMachine`                     |
| **API key workers**         | `MintAccountApiKey` (UUID v4 + `apigateway:CreateApiKey` for account keys), `RevokeApiKey` (`apigateway:DeleteApiKey` + row → `REVOKED`), `RotateServiceApiKey` (cross-account `sts:AssumeRole` + tenant-side `apigateway:CreateApiKey` + shared Usage Plan rebind + KMS-encrypt → Account row + tenant-side consumer publish, then `RevokeApiKey` of the prior key after a configurable grace), `PublishTenantServiceKeyConsumers` (updates Account-managed SSM parameters and EventBridge Connections inside the tenant account), `SharedUsagePlanBinder` (binds the current service key to the Bootstrap-managed tenant Usage Plan)                                                                                                                        | 512 MB     | 60–300 s | —   | API Gateway / Step Functions task                                     |
| **Maintenance workers**     | `MaintenanceAccessIssuer` (cross-account `iam:CreateUser` + `iam:CreateLoginProfile`, writes the `MaintenanceLoginsTable` row, kicks off the SES owner-approval email when configured), `MaintenanceApprovalApplier` (consumes `MaintenanceApprovalQueue`, releases the SFN task token), `TempAccessConsumer` (one-shot `GET /…/temp-access` that decrypts and burns the row), `IamUserGarbageCollector` (consumes `IamGarbageCollectionQueue` + DDB-stream TTL deletes; `sts:AssumeRole`s into the tenant sub-account and deletes the user and login profile) | 512 MB     | 60–600 s | —   | API Gateway + SQS + DDB Streams + scheduled `rate(1 hour)` self-audit |
| **Account / email workers** | `EmailDispatcher` (SES `send_templated_email`), `ConfirmEmailSendAndWait` (`waitForTaskToken`), `ConfirmEmailFinalise`, `AccountsProcessor` (SQS-triggered, `batchSize=1`), `ConfirmationEmailEnqueuer` (DDB-stream-triggered), `MaintenanceApprovalEmailDispatcher`                                                                                                                                                                                                                                                                                                                                                                                                                                  | 256–512 MB | 30–120 s | —   | Step Functions task / SQS / DDB Streams                               |
| **Custom resources**        | `ApiGatewayLogCustomResource` (installs the access log group), `KmsKeyPolicyApplier` (sets the KMS key policy across both Lambda roles)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 256–512 MB | 30–600 s | —   | CloudFormation custom resources                                       |


#### 2.3.5 Routing fabric

- **REST API** (`RestApi` `AccountApi`) with default stage `${stage}`, regional endpoint type, CORS pre-flight for `*`, dedicated access log group, `DisableExecuteApiEndpoint: true`. Routes:
  - All public paths in §1.2 → `LambdaIntegration(AccountHandler)` with `apiKeyRequired: true`.
  - `POST /accounts/confirm-email` → `LambdaIntegration(AccountHandler)` with `apiKeyRequired: false` (JWT-authenticated by `confirmation_token`).
  - `POST /accounts` → `LambdaIntegration(AccountHandler)` with `apiKeyRequired: false` (anyone can sign up).
  - `GET /information` → `MOCK` integration returning the deployer-supplied `ServiceInfo` JSON.
  - `GatewayResponse` rules normalise `INVALID_API_KEY`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, and `DEFAULT_4XX` per §3.6 (mirrors the rules used by Connect / Persist).
- **API Gateway custom domain mapping** under base path `account` against the deployer-supplied `Subdomain` (`AWS::ApiGateway::BasePathMapping` for the REST API). The shared API Gateway custom domain itself is created during Bootstrap, not by Account.
- **Step Functions** state machines (six, all `tracingEnabled: true`):
  - `ConfirmEmailStateMachine` (`STANDARD`) — `waitForTaskToken` paired with the JWT confirmation handler.
  - `AccountProvisioningStateMachine` (`STANDARD`) — provision the AWS sub-account + DNS layer + initial service key end-to-end (see §5.2).
  - `AccountTeardownStateMachine` (`STANDARD`) — revoke all bound API keys, then disable + delete the DNS layer and detach the AWS sub-account (see §5.3).
  - `DomainConfigStateMachine` (`STANDARD`) — registers and self-heals account domain / certificate metadata exposed to Deployer and service CDK stacks (see §5.4).
  - `ServiceKeyRotationStateMachine` (`STANDARD`) — atomic rotate-by-add for the per-account `service_api_key` (see §5.5).
  - `MaintenanceAccessStateMachine` (`STANDARD`, total timeout 24 h) — mint IAM material in the tenant sub-account, optionally pause for owner approval (`waitForTaskToken`), surface the temp-access link, schedule IAM-user teardown at the row's absolute `expires_at` timestamp (see §5.6).
- **EventBridge Scheduler** group `account-schedules` hosts a `rate(1 hour)` schedule that targets `IamUserGarbageCollector` for self-audit so known maintenance sessions whose `expires_at <= now` are cleaned up even if the SFN expiry wait fails. Orphaned users without a matching DDB row are deleted when their IAM `CreateDate < now - MAINTENANCE_ACCESS_TTL_MINUTES`.
- **SES configuration**: a single sending identity `welcome@<DnsEnv>` (auto-verified at deploy) and three templated emails registered as `AWS::SES::Template`:
  - `account_send_user_key_and_confirm_email_v1` — the customer-account confirmation email (legacy template byte-for-byte).
  - `account_maintenance_access_owner_approval_v1` — owner approval email for a maintenance request, carrying the HMAC-signed `Approve` and `Deny` callback URLs.
  - `account_maintenance_access_link_v1` — direct-delivery alternative when the owner is also the requester (skips the approval gate).

#### 2.3.6 IAM (high-level)

- The provider role is **never** wildcarded. Per-Lambda roles use `cdk.aws_iam.Grant.addToPrincipal` so each worker holds only the permissions it needs.
- The `AccountHandler` role has: `dynamodb:{Get,Put,Update,Delete,Query,DescribeTable}Item` on `AccountsTable`, `ApiKeysTable`, `CustomDomainsTable`, `MaintenanceLoginsTable`; `kms:{Encrypt,Decrypt,GenerateDataKey,DescribeKey}` on `DataKey`; `sqs:SendMessage` on `AccountsProcessingQueue`, `ConfirmationEmailQueue`, `MaintenanceApprovalQueue`, `IamGarbageCollectionQueue`; `s3:{PutObject,GetObject,ListObjectsV2,ListBucket}` on `AccountRecordBucket`; `states:{StartExecution,DescribeExecution,GetExecutionHistory,StopExecution,SendTaskSuccess,SendTaskFailure}` on the SFN ARN prefixes; `ses:SendTemplatedEmail`; `apigateway:{GET,POST,DELETE,PATCH}` scoped to the marketplace REST API id (for marketplace-side Usage Plan key minting); and `secretsmanager:{Get,Update,Delete}SecretValue` on `arn:aws:secretsmanager:<region>:<account>:secret:account/`* for the per-account bootstrap secret.
- The provisioning workers add `sts:AssumeRole` on `arn:aws:iam::*:role/OrganizationAccountAccessRole` (constrained at deploy time to the AWS Organizations OU IDs the deployer enumerates), `route53:{ChangeResourceRecordSets,ListHostedZonesByName,CreateHostedZone}`, `acm:{Request,Describe,List,Delete}Certificate`, and `organizations:{CreateAccount,DescribeCreateAccountStatus,DescribeAccount,ListAccounts}` (only when the OU bootstrap mode is enabled — Account can also operate against a pre-provisioned tenant sub-account by passing its `aws_account_id` directly via `POST /accounts/{account_id}/provisionV2`).
- The teardown workers add `route53:{ChangeResourceRecordSets,DeleteHostedZone}` and `acm:DeleteCertificate` for tearing down Account-owned DNS/certificates. Service API mappings are removed by the service stacks that created them.
- The **API key workers** add `apigateway:{POST,DELETE}` on `/apikeys` for account keys. `RotateServiceApiKey` adds `sts:AssumeRole` against the tenant `OrganizationAccountAccessRole`; inside that assumed tenant session it reads `/account/shared-usage-plan-id`, creates the replacement service API key, creates the single `UsagePlanKey` binding on that shared Usage Plan, waits through the grace window, then deletes the prior binding and prior key. Product stacks attach API stages to this shared plan; Account never discovers or mutates per-product plans.
- The **maintenance workers** add `sts:AssumeRole` against the tenant `OrganizationAccountAccessRole` (constrained to the configured Organizations OU IDs); the assumed session is then used to call `iam:{CreateUser,DeleteUser,CreateLoginProfile,DeleteLoginProfile,CreateAccessKey,DeleteAccessKey,ListAttachedUserPolicies,AttachUserPolicy}` against `arn:aws:iam::<tenant>:user/account-maintenance/`*. Account does not create or enable virtual MFA devices. The marketplace side additionally has `iam:GetAccountSummary` for the self-audit cron.
- The `EmailDispatcher` and `MaintenanceApprovalEmailDispatcher` roles add `ses:SendTemplatedEmail` and `ses:GetTemplate`.
- The `AccountsProcessor` role adds the same DDB / SQS verbs as `AccountHandler` plus `events:PutEvents` for downstream cross-service notifications.

#### 2.3.7 Cross-account credential exchange

- For each tenant sub-account Account provisions, the bootstrap step creates a **short-lived** IAM user inside the new sub-account, retrieves its access key + secret key, encrypts them with `DataKey`, and stores the result on the Account row's `admin_enc` field. This IAM user is **rotated and deleted** as soon as `OrganizationAccountAccessRole` becomes assumable.
- Post-bootstrap, every operation that has to touch the tenant sub-account (DNS record changes, ACM certificate issuance/deletion, teardown, service-key rotation, maintenance access IAM minting) calls `sts:AssumeRole` against `arn:aws:iam::<aws_account_id>:role/OrganizationAccountAccessRole`, then constructs the per-resource SDK client with the resulting session credentials. The session token TTL defaults to 60 minutes; the helper opportunistically reuses an in-memory session within a single Lambda invocation only.

### 2.4 Configuration surface (env vars)

The runtime is configured exclusively via env vars (read once on cold start; missing required values must fail closed via `process.exit(1)` at module load). Notable keys:


| Key                                                                                 | Default                                  | Used by                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ACCOUNTS_TABLE_NAME`                                                               | from CDK                                 | Account registry.                                                                                |
| `API_KEYS_TABLE_NAME`                                                               | from CDK                                 | API key registry.                                                                                |
| `CUSTOM_DOMAINS_TABLE_NAME`                                                         | from CDK                                 | Account domain configuration registry.                                                           |
| `MAINTENANCE_LOGINS_TABLE_NAME`                                                     | from CDK                                 | Maintenance session registry.                                                                    |
| `DATA_KMS_KEY_ARN`                                                                  | from CDK                                 | Encryption helpers.                                                                              |
| `API_KEY_HMAC_SECRET_ARN`                                                           | Secrets Manager `account/api-key-hmac`   | HMAC-SHA256 secret used to derive `api_key_hash` row PKs. Rotated independently.                 |
| `SERVICE_API_KEY_ID`                                                                | provided by deployer                     | Usage plan binding (Account's own marketplace key).                                              |
| `MARKETPLACE_USAGE_PLAN_ID`                                                         | from CDK                                 | Usage Plan id account-level keys are bound to via `ApiKeyBinder`.                                |
| `SUBDOMAIN`                                                                         | provided by deployer                     | API Gateway custom-domain mapping for Account itself.                                            |
| `DOMAIN_ROOT`                                                                       | `staircaseapi.com`                       | Used to construct `<subdomain>.<DOMAIN_ROOT>` defaults.                                          |
| `MARKETPLACE_DOMAIN`                                                                | `marketplace.staircaseapi.com`           | Self-reference in confirmation email URLs and maintenance-approval callback URLs.                |
| `JWT_CONFIRM_EMAIL_SECRET`                                                          | Secrets Manager `account/jwt-confirm`    | HS256 signing for confirmation tokens. Rotated independently.                                    |
| `MAINTENANCE_APPROVAL_HMAC_SECRET_ARN`                                              | Secrets Manager `account/maint-approval` | HMAC-SHA256 secret signing the `Approve` / `Deny` callback URLs in the SES email.                |
| `EMAIL_SOURCE_NAME`                                                                 | `welcome`                                | SES sender alias (full address = `<EMAIL_SOURCE_NAME>@<DOMAIN_ROOT>`).                           |
| `CONFIRM_EMAIL_STATE_MACHINE_ARN`                                                   | from CDK                                 | DDB stream → SFN dispatcher.                                                                     |
| `ACCOUNT_PROVISIONING_STATE_MACHINE_ARN`                                            | from CDK                                 | `POST /accounts/{account_id}/provision` async kickoff.                                           |
| `ACCOUNT_TEARDOWN_STATE_MACHINE_ARN`                                                | from CDK                                 | `POST /accounts/{account_id}/disable` async kickoff.                                             |
| `DOMAIN_CONFIG_STATE_MACHINE_ARN`                                                   | from CDK                                 | Domain configuration orchestrator.                                                               |
| `SERVICE_KEY_ROTATION_STATE_MACHINE_ARN`                                            | from CDK                                 | `POST /accounts/{account_id}/service-key/rotate` async kickoff.                                  |
| `MAINTENANCE_ACCESS_STATE_MACHINE_ARN`                                              | from CDK                                 | `POST /accounts/{account_id}/maintenance-access` async kickoff.                                  |
| `ORGANIZATIONS_OU_ID` / `ORGANIZATIONS_PARENT_ROLE_ARN`                             | from CDK context                         | OU under which new tenant sub-accounts are created; cross-account assume role.                   |
| `ORG_ACCOUNT_ACCESS_ROLE_NAME`                                                      | `OrganizationAccountAccessRole`          | Default role name to assume in the tenant sub-account.                                           |
| `MAINTENANCE_ACCESS_TTL_MINUTES`                                                    | `30`                                     | Max console session lifetime; also bounds the IAM-user GC sweep.                                 |
| `MAINTENANCE_APPROVAL_TIMEOUT_MINUTES`                                              | `15`                                     | How long `MaintenanceAccessStateMachine` waits for the owner-approval task token before failing. |
| `MAINTENANCE_USERNAME_PREFIX`                                                       | `account-maintenance/`                   | IAM-user path prefix used so the GC scope is unambiguous.                                        |
| `SERVICE_KEY_ROTATION_GRACE_SECONDS`                                                | `60`                                     | Window during which the old service key stays `ACTIVE` before being moved to `REVOKED`.          |
| `CONFIRMATION_LINK_EXPIRY_HOURS`                                                    | `1`                                      | After which a `confirmed_email_at` row may be re-confirmed.                                      |
| `JOB_INPUT_MAX_BYTES`                                                               | `262144` (256 KiB)                       | Body size cap before SFN start.                                                                  |
| `POWERTOOLS_SERVICE_NAME` / `POWERTOOLS_LOG_LEVEL` / `POWERTOOLS_METRICS_NAMESPACE` | `account-`* / `INFO` / `account`         | Logging + metrics                                                                                |


### 2.5 Library / dependency policy

The implementation is **TypeScript-only** and consumes only the libraries listed below (per `stack-typescript-for-apis`):

- `aws-cdk-lib`, `constructs`, `aws-cdk` for IaC; scaffold with the current Golden Path CDK v2 release.
- `@aws-sdk/client-{dynamodb,s3,sfn,sqs,apigateway,kms,lambda,ssm,sts,secrets-manager,ses,sesv2,iam,acm,route53,organizations,events,scheduler}` and `@aws-sdk/credential-providers` for AWS calls.
- `@aws-sdk/lib-dynamodb` for typed DynamoDB document mappings.
- `@aws-lambda-powertools/{logger,tracer,metrics,parameters}` for observability and SSM parameter caching.
- `aws4` for SigV4-signed cross-service HTTPS calls (e.g. provisioning callback POSTs).
- `zod` for **all** request / response / SFN-input schemas (no `marshmallow`, `jsonschema`, `joi`, `ajv`).
- `jose` for JWT (HS256) signing / verification of confirmation tokens; **never** `jsonwebtoken` (Node 24 ESM friction).
- `undici` for outbound HTTP (or native `fetch` in Node 24); never `axios` or `node-fetch`.
- `vitest` + `@vitest/coverage-v8` for tests; `aws-sdk-client-mock` for AWS SDK doubles.
- **No SSH client**, **no in-process code sandbox**, **no Python** anywhere in this repository.
- **LLM use** (none required today, but if added) **MUST** route through the **[Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) with strict TypeScript and Zod tool schemas** — direct `openai`, `@anthropic-ai/sdk`, or `@aws-sdk/client-bedrock-runtime` usage is forbidden.

---

## 3. Data Model & Contracts

### 3.1 Response envelope

All HTTP responses share a uniform JSON envelope. Success bodies are route-specific (see §4):

```json
{ "ok": true, "data": <route-specific> }
```

Error responses (HTTP status mapped per error tag — see §3.6):

```json
{
  "ok": false,
  "error": {
    "type": "AccountNotFound",
    "message": "no account found for that account_id",
    "details": { "account_id": "..." }
  }
}
```

Async submissions return `202 Accepted` with one of `{ account_id }`, `{ account_id, status_url }`, `{ api_key_id }`, `{ temp_access_uuid }`, or `{ task_token }`. Synchronous lookups return `200 OK`. `204 No Content` is used for deletes. Every non-mock response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` and `x-sc-trace-id` (per-request UUID propagated downstream into logs and outbound headers).

API Gateway-level errors are normalised by configured `GatewayResponse` rules (mirrors Connect / Persist):

- `INVALID_API_KEY` → `{ "url": "https://api.staircase.co/get-started#root", "message": "This key is not valid for this service." }`
- `BAD_REQUEST_BODY` → `{ "message": $context.error.messageString, "error": $context.error.validationErrorString }`
- `BAD_REQUEST_PARAMETERS` → `{ "message": $context.error.messageString }`
- `DEFAULT_4XX` → `{ "message": "Request has been declined." }`

### 3.2 Account entity

```ts
type AccountKind = "customer" | "organization";

type RequiredAction = "send_email" | "confirm_email";

type AccountStatus =
  | "PENDING_CONFIRMATION"          // signup just landed, awaiting email confirmation
  | "CONFIRMED"                     // identity confirmed; no AWS sub-account yet
  | "PROVISIONING"                  // AccountProvisioningStateMachine in flight
  | "ACTIVE"                        // AWS sub-account + DNS live
  | "DISABLING"                     // AccountTeardownStateMachine in flight
  | "DELETING_DNS"
  | "DISABLED"
  | "ERROR";

type SubdomainStatus = "AVAILABLE" | "TEMPORARY_BLOCKED" | "PERMANENTLY_BLOCKED";

type AccountCertificate = {
  certificate: string;                       // ACM ARN
  certificate_type: "Public" | "Private";
  certificate_status: "PENDING_VALIDATION" | "ISSUED" | "FAILED" | "REVOKED";
  domain_name: string;
  in_use: boolean;
};

type Account = {
  // Stable handle
  account_id: string;                        // PK; UUID v4 minted at signup, NEVER reused
  version: number;                           // SK; monotonic per account, latest is live
  kind: AccountKind;
  status: AccountStatus;                     // GSI (status_index)
  parent_account_id?: string;                // GSI (parent_account_id_index); set when an organization owns this account

  // Identity
  email?: string;                            // required when kind = "customer"
  first_name?: string;
  last_name?: string;
  company_name?: string;                     // required for customer when no parent_account_id
  required_actions: RequiredAction[];        // [] once fully active
  after_confirm_callback_url?: string;       // optional URL the confirmation flow redirects to
  confirmed_email_at?: string;               // ISO 8601 UTC; absent until /confirm-email succeeds

  // AWS sub-account + DNS layer (set during PROVISIONING, retained through DISABLED for audit)
  aws_account_id?: string;                   // The AWS account id of the provisioned sub-account
  subdomain?: string;                        // GSI (subdomain_index)
  subdomain_status?: SubdomainStatus;
  fqdn?: string;                             // GSI (fqdn_index); = "<subdomain>.staircaseapi.com" by default
  hosted_zone_id?: string;
  certificates?: AccountCertificate[];
  account_token?: string;                    // one-shot activation token (cleared after first use)
  admin_enc?: string;                        // KMS-encrypted bootstrap IAM-user secret (rotated/deleted post-bootstrap)

  // Per-account service key (the API key used by Staircase products inside this tenant)
  service_api_key_id?: string;               // API Gateway key id bound to this tenant's product Usage Plans
  service_api_key_encrypted?: string;        // KMS-encrypted current per-account service key plaintext
  service_api_key_hash?: string;             // HMAC of the active per-account service key
  service_api_key_rotated_at?: string;       // ISO 8601 UTC of the last successful rotation

  last_update_datetime: string;              // ISO 8601 UTC
  created_at: string;                        // ISO 8601 UTC
};
```

`POST /accounts` requires `(first_name, last_name, email, kind: "customer")` plus exactly one of `company_name` or `parent_account_id` (XOR). For `kind: "organization"`, `parent_account_id` is forbidden and `email` / `first_name` / `last_name` are optional. Both flavours return `201 Created` and the account row plus the **just-minted** `account_key` (the only time the plaintext key is ever returned). For `customer` accounts the key is held in the SFN-task-token closure and only surfaced once `POST /accounts/confirm-email` succeeds; for `organization` accounts the key is returned in the `201` body directly.

The signup writes an `AccountsTable` row at `version = 1`, `status = PENDING_CONFIRMATION` (customer) or `status = CONFIRMED` (organization), with `required_actions = ["send_email", "confirm_email"]` for customer (or `[]` when `company_name === "AccessSelfServe"`, the legacy bypass for internal staff). The DDB write triggers `ConfirmEmailStateMachine` via the table's stream.

**Versioning invariants.** Every mutation writes a new row with `version = max(version) + 1`; the prior row stays for audit. Read paths target the row with the highest `version` via a small wrapper service. The `subdomain` index pair (`subdomain`, `subdomain_status`) doubles as the uniqueness guard for new provisioning — a `TEMPORARY_BLOCKED` row blocks immediate re-creation of the same subdomain. Because the PK is the immutable `account_id`, no API key rotation, ownership change, or subdomain change ever invalidates a stored handle.

### 3.3 ApiKey entity

```ts
type ApiKeyKind = "account" | "service";

type ApiKeyStatus = "PENDING_CONFIRMATION" | "ACTIVE" | "REVOKED";

type ApiKey = {
  api_key_hash: string;                      // PK; HMAC-SHA256(API_KEY_HMAC_SECRET, api_key)
  api_key_id: string;                        // GSI (api_key_id_index); the API Gateway-assigned id
  account_id: string;                        // GSI (account_id_index); FK → AccountsTable
  kind: ApiKeyKind;                          // "account" or "service"
  status: ApiKeyStatus;                      // GSI (status_index)
  usage_plan_key_id?: string;                // API Gateway Usage Plan key id once bound
  label?: string;                            // free-form caller annotation ("ci-bot", "billing", …)
  created_at: string;                        // ISO 8601 UTC
  activated_at?: string;                     // ISO 8601 UTC; set when status = ACTIVE
  revoked_at?: string;                       // ISO 8601 UTC; set when status = REVOKED
  revoked_by?: string;                       // optional caller identity
};
```

Multiple `ACTIVE` rows per `account_id` are allowed during rotation. The plaintext `api_key` value is **only** returned to the caller in the response of the mint operation that created it (`POST /accounts`, `POST /accounts/{account_id}/api-keys`, `POST /accounts/{account_id}/service-key/rotate`); after that, only the `api_key_hash` and the API Gateway-assigned `api_key_id` are persisted. Lookups by plaintext key go through `HmacFingerprintService.hash(value)` first; lookups by `api_key_id` (e.g. `DELETE /accounts/{account_id}/api-keys/{api_key_id}`) go through the `api_key_id_index` GSI.

### 3.4 Custom domain configuration entity

```ts
type CustomDomainConfig = {
  account_fqdn: string;                      // PK
  domain_name: string;                       // SK
  kind: "CANONICAL" | "ALIAS";
  target_fqdn?: string;                      // GSI (target_index), when aliasing another FQDN
  hosted_zone_id: string;
  certificate_arn: string;
  regional_certificates?: Record<string, string>;
  status: "PENDING" | "ACTIVE" | "FAILED" | "DELETING";
  created_at: string;
  updated_at: string;
};
```

`PUT /accounts/{account_id}/custom-domains` upserts these rows in a Distributed-Map iterator and triggers `DomainConfigStateMachine` to validate / publish the domain configuration. No service base path is represented in this entity.

### 3.5 Maintenance Session entity

```ts
type MaintenanceUserType = "MAINTENANCE" | "QUICKSIGHT";

type MaintenanceApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";

type MaintenanceSession = {
  username: string;                          // PK; raw SSO identity of the requester; never used directly as IAM user name
  iso8601_logged_in_at: string;              // SK (ISO 8601 UTC)
  account_id: string;                        // GSI (account_id_index); FK → AccountsTable.account_id
  temp_access_uuid: string;                  // GSI (temp_access_uuid_index); 30-char alphanumeric one-time URL token
  temp_access_credentials_enc: string;       // KMS-encrypted { aws_console_username, account_alias, password }
  iam_username: string;                      // IAM-safe generated user name under MAINTENANCE_USERNAME_PREFIX
  iam_user_arn: string;                      // The IAM user minted in the tenant sub-account
  mfa_enrollment_state?: "NOT_REQUIRED" | "MANUAL_REQUIRED" | "MANUAL_COMPLETED";
  user_type: MaintenanceUserType;            // default MAINTENANCE
  expiration_minutes: number;                // bounded by MAINTENANCE_ACCESS_TTL_MINUTES
  approval_state: MaintenanceApprovalState;
  approver_email?: string;                   // SET by the owner via the SES callback
  approval_task_token?: string;              // SFN task token for the WaitForTaskToken state in MaintenanceAccessStateMachine
  consumed_at?: string;                      // ISO 8601 UTC of GET /…/temp-access (single-use marker)
  expires_at: string;                        // ISO 8601 UTC; = iso8601_logged_in_at + expiration_minutes
  iam_cleanup_at?: string;                   // ISO 8601 UTC when IamUserGarbageCollector deleted the tenant IAM user
  ttl_epoch_seconds: number;                 // = iso8601_logged_in_at + 24h; audit-row retention, not IAM lifetime
};
```

`POST /accounts/{account_id}/maintenance-access` deletes any prior session for the same `(username, account_id)` (cascades to `IamGarbageCollectionQueue` to tear down the prior IAM user) before minting a new row at `approval_state = "PENDING"`.

### 3.6 Error catalogue → HTTP status

The HTTP layer is the authoritative tag-to-status mapper. Each error type is a structured tagged class with a discriminator (`type` / `_tag`), a `message`, and an optional `details` object. Tags map to:


| HTTP    | Tag(s)                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400     | `BadRequest`, `BAD_REQUEST_BODY`, `BAD_REQUEST_PARAMETERS`, `ZodValidationError`, `InvalidConfirmationToken`, `InvalidApiKey`, `InvalidSubdomain`, `InvalidMaintenanceUserType`, `InvalidApprovalSignature`, `CustomSchemaException`     |
| 401/403 | `Unauthorized` (missing header), `AccessDenied` (Comply Authentication failure), `MaintenanceApprovalDenied`, `INVALID_API_KEY`                                                                                                          |
| 404     | `AccountNotFound`, `OrganizationNotFound`, `ApiKeyNotFound`, `CustomDomainConfigNotFound`, `MaintenanceSessionNotFound`                                                                                                                    |
| 409     | `EmailAlreadyRegistered`, `AccountWasAlreadyConfirmed`, `SubdomainTaken`, `ApiKeyAlreadyRevoked`, `ServiceKeyRotationInProgress`, `MaintenanceSessionAlreadyConsumed`, `AccountNotProvisionable` (already in `PROVISIONING` or `ACTIVE`) |
| 410     | `MaintenanceSessionExpired`, `TempAccessLinkExpired`                                                                                                                                                                                     |
| 413     | `JobInputTooLarge`                                                                                                                                                                                                                       |
| 422     | `OutdatedAccount`, `EmailServiceException`, `MaintenanceApprovalTimeout`                                                                                                                                                                 |
| 429     | `ThrottlingException` → `TooManyRequests`                                                                                                                                                                                                |
| 500     | `UnexpectedResourceState`, `InternalServerError`, `AccountProvisioningError`, `AccountTeardownError`, `ServiceKeyRotationError`, `MaintenanceAccessIssuanceError`                                                                        |
| 502     | `UpstreamServiceError` (e.g. callback POST failures)                                                                                                                                                                                     |
| 503     | `S3StoreError`, `SqsEnqueueError`, `DynamoDbError`, `StepFunctionsTransientError`, `KmsTransientError`, `SesSendError`, `IamTransientError`                                                                                              |


---

## 4. Synchronous APIs

All public routes are mounted under the API Gateway base path `/account/`. The single `AccountHandler` Lambda hosts a thin `lambda/http/router.ts` that dispatches by `httpMethod` + `resource` to the per-route service. Each route is wrapped in a shared decorator that (a) binds a per-request structured logger keyed by `x-sc-trace-id`, (b) parses the body (or rejects via a Zod-driven `BadRequest`), (c) emits a CloudWatch Logs JSON record on entry/exit, and (d) maps unhandled exceptions to `500 InternalServerError`.

`**x-api-key` resolution.** Every route that accepts an `x-api-key` header runs the three-step lookup defined in §2.3.3 to map it to an owning `account_id`. Routes that take `{account_id}` as a path parameter then assert that the resolved `account_id` equals the path parameter (or that the resolved account is the parent of the path parameter, for organization → child operations). A mismatch returns `401 InvalidApiKey`.

### 4.1 Account identity (`/accounts`, `/accounts/confirm-email`)

- `POST /accounts` — body validated by `accountCreateSchema`. Required: `kind: "customer" | "organization"`. For customer: `(first_name, last_name, email)` plus exactly one of `company_name` or `parent_account_id`. For organization: `(organization_name)` plus optional contact fields. Generates `account_id` (UUID v4), mints the initial `account_key` (UUID v4), and immediately writes its `api_key_hash` row to `ApiKeysTable` at `status = "PENDING_CONFIRMATION"` (customer) or `status = "ACTIVE"` (organization, bound to the marketplace Usage Plan synchronously). 201/400/409. The DDB write to `AccountsTable` triggers the `ConfirmEmailStateMachine` via the table's stream (customer only).
- `PUT /accounts/{account_id}` — partial update of identity fields (`first_name`, `last_name`, `email`, `company_name`, `parent_account_id`). Writes a new `version` row. 200/400/404.
- `GET /accounts/{account_id}` — returns the latest `AccountsTable` row at the requested `account_id`, decorated with live ACM / API Gateway state when `status = ACTIVE` (the handler `sts:AssumeRole`s into the tenant sub-account to fetch certificate state via `acm:DescribeCertificate`). 200 / 404 / 401.
- `GET /accounts?email=&fqdn=&parent_account_id=&status=` — search by any single index. Returns a paginated list of account headers (`{ account_id, kind, status, fqdn?, parent_account_id?, created_at }`).
- `POST /accounts/confirm-email` — body `{ confirmation_token }`; verifies the JWT (HS256, secret `JWT_CONFIRM_EMAIL_SECRET`), looks up `account_id`, flips the matching `ApiKeysTable` row to `ACTIVE` and binds it to the marketplace Usage Plan via `ApiKeyBinder`, writes a new `AccountsTable` version at `status = CONFIRMED`, releases the SFN task token via `states:SendTaskSuccess`, and returns `{ account_id, account_key }`. 201/400/404; if the email was previously confirmed within `CONFIRMATION_LINK_EXPIRY_HOURS`, returns 200 with a friendly message instead of 409.
- `GET /accounts/confirm-email-and-activate-key-in-documentation` — performs `POST /accounts/confirm-email` plus the documentation Usage Plan binding in a single call so the email link can be a `GET`. 200 / 400.

### 4.2 API key management (`/accounts/{account_id}/api-keys`, `/accounts/activate-key-in-documentation`)

- `GET /accounts/{account_id}/api-keys` — lists the `ApiKeysTable` rows for the account (filters via `account_id_index`); returns metadata only (`api_key_id`, `kind`, `status`, `label?`, `created_at`, `activated_at?`, `revoked_at?`). 200 / 404.
- `POST /accounts/{account_id}/api-keys` — body `{ label?: string }`. Mints a new account-level `account_key` (UUID v4), writes a row at `ACTIVE`, and binds it to the marketplace Usage Plan synchronously via `ApiKeyBinder`. Returns 201 with `{ api_key, api_key_id, label, created_at }`. **The plaintext `api_key` is returned exactly once and never persisted in plaintext.** Use this to pre-mint a replacement key before revoking the old one (rotate-by-add).
- `DELETE /accounts/{account_id}/api-keys/{api_key_id}` — resolves to the `ApiKeysTable` row via `api_key_id_index`, unbinds it from the Usage Plan, deletes the API Gateway API key, and flips the row to `REVOKED`. 204 / 404 / 409 (already revoked). The handler asserts the row's `account_id` equals the path parameter so an authorised caller cannot revoke another account's keys by guessing `api_key_id`s.
- `POST /accounts/activate-key-in-documentation` — body `{ api_key }`. Activates an existing customer `account_key` against the **documentation account's** API Gateway Usage Plan (a separate Usage Plan id passed in via CDK context); 200 with `{ status: "SUCCESS", fqdn: "documentation.staircaseapi.com", message }`. Mirrors the legacy environment-manager-service endpoint.

### 4.3 Account provisioning (`/accounts/{account_id}/provision`, `/disable`, `/delete-callback`)

- `POST /accounts/{account_id}/provision` — body `{ subdomain, callback_url?, callback_payload? }`. The handler verifies the account exists at `status = CONFIRMED` (rejects with `409 AccountNotProvisionable` if already `PROVISIONING` / `ACTIVE`), checks the `subdomain` against the `subdomain_index` (rejects if `subdomain_status = TEMPORARY_BLOCKED` or `PERMANENTLY_BLOCKED`), writes a new account version at `status = PROVISIONING`, and starts `AccountProvisioningStateMachine` with the row's `account_id` as the SFN execution name. 202 with `{ account_id, status: "PROVISIONING", status_url }`.
- `POST /accounts/{account_id}/provisionV2` — backwards-compatible variant that accepts the V1 body and additionally allows `aws_account_id` to skip the AWS Organizations CreateAccount step (the deployer passes a pre-provisioned sub-account).
- `GET /accounts/{account_id}/bootstrap-manifest` — API-key gated against the account owner key. Returns the non-secret bootstrap inputs for a provisioned tenant: `{ account_id, aws_account_id, subdomain, fqdn, hosted_zone_id, certificates, service_api_key_id, service_api_key_rotated_at, marketplace_api_url, account_domain_config_ssm_param, service_usage_plan_ssm_param?, env_parameters_ssm_param?, deploy_regions, system_components: { deployer: { product_id, component_id }, marketplace_puller: { product_id, component_id } } }`. The `account_domain_config_ssm_param` names the tenant-account SSM parameter that Bootstrap writes after it creates the shared API Gateway custom domain. `service_usage_plan_ssm_param` defaults to `/account/shared-usage-plan-id` and names the tenant-account SSM parameter where Bootstrap writes the single shared Usage Plan id. `env_parameters_ssm_param` defaults to `/account/env-parameters`; Bootstrap, not Account, writes the JSON environment defaults there after it creates/discovers shared tenant resources. The manifest never returns plaintext API keys or AWS credentials; the bootstrap CLI obtains the tenant service-key plaintext through `GET /accounts/{account_id}/service-key` when the caller also has Comply Authentication, and obtains AWS credentials from the operator's configured AWS SSO/profile.
- `POST /accounts/{account_id}/disable` — body `{ subdomain }` (echoed back as a defensive double-check). Verifies the account is `ACTIVE`; writes a new version at `status = DISABLING`, sets `subdomain_status = TEMPORARY_BLOCKED`, and starts `AccountTeardownStateMachine`. 202 / 400 / 404 / 401.
- `POST /accounts/{account_id}/delete-callback` — internal-use callback the teardown SFN posts back to confirm DELETE_COMPLETE; writes a new version at `status = DISABLED` and forwards a notification to `AccountsProcessingQueue`.

### 4.4 Service keys (`/accounts/{account_id}/service-key`)

- `GET /accounts/{account_id}/service-key` — Comply Authentication required. Decrypts `service_api_key_encrypted` from the latest `AccountsTable` row and returns `{ service_api_key, service_api_key_id, service_api_key_rotated_at }`. 200 / 404 / 401 / 403.
- `POST /accounts/{account_id}/service-key/rotate` — Comply Authentication required. Asynchronously starts `ServiceKeyRotationStateMachine`. Returns 202 with `{ status: "ROTATING", execution_arn, started_at }`. The state machine performs the rotate-by-add described in §5.5.

### 4.5 DNS — custom domains (`/accounts/{account_id}/custom-domains`, `/domain-config`)

- `PUT /accounts/{account_id}/custom-domains` — body `{ domains: [{ domain_name, kind: "CANONICAL" | "ALIAS", certificate_arn?, hosted_zone_id? }], target_fqdn? }`. Upserts rows in `CustomDomainsTable` and starts `DomainConfigStateMachine` to validate / self-heal the Route 53 and ACM metadata Account owns. It does **not** create the tenant API Gateway custom domain or any service base-path mappings. Returns `{ status: "STARTED", execution_arn }`.
- `GET /accounts/{account_id}/domain-config` — returns the standardized DNS/certificate input Bootstrap and Deployer use: `{ domain_name, custom_domains, hosted_zone_id, certificate_arn, regional_certificates? }`. Bootstrap uses these values to create the tenant API Gateway custom domain; Deployer passes the resolved tenant-domain name to service CDK stacks, which define only their own base-path mappings.

### 4.6 Maintenance access (`/accounts/{account_id}/maintenance-access`)

- `POST /accounts/{account_id}/maintenance-access` — Comply Authentication required (the SSO-bound `username` flows into the `MaintenanceLoginsTable` row). Body `{ user_type?: "MAINTENANCE" | "QUICKSIGHT", expiration_minutes?: number, skip_owner_approval?: boolean }`. Inserts a row at `approval_state = "PENDING"` and starts `MaintenanceAccessStateMachine` with the row's `temp_access_uuid` as the SFN execution name. Returns 202 with `{ temp_access_uuid, status_url, approval_state: "PENDING" | "APPROVED" }`. If `skip_owner_approval` is set **and** the requester is the account's registered owner email, the SFN bypasses the `WaitForTaskToken` step and the response is `{ approval_state: "APPROVED", temp_access_link }` directly.
- `GET /accounts/{account_id}/maintenance-access/temp-access?temp_access_uuid=` — single-use endpoint that decrypts `temp_access_credentials_enc` from the matching row, atomically sets `consumed_at`, and returns `{ aws_console_username, account_alias, password, console_login_url }` only while `now < expires_at` and `iam_cleanup_at` is absent. 200 / 404 / 410 (expired, already consumed, or cleaned up). The marketplace `x-api-key` is required so an attacker who steals the `temp_access_uuid` from logs cannot redeem it without also having the service key.
- `GET /accounts/{account_id}/access-permission?temp_uuid=&username=&approver_email=&approved=&signature=` — owner approval webhook reachable directly from the SES email (HMAC-signed `signature` over the other query params using `MAINTENANCE_APPROVAL_HMAC_SECRET_ARN`). Verifies the signature, enqueues the result on `MaintenanceApprovalQueue`, and 302s back to a friendly confirmation page. The actual SFN release happens asynchronously via `MaintenanceApprovalApplier` so the owner sees a fast response.

### 4.7 Service composition / dependency wiring

Each router scopes its own dependency container so that a config error in an unrelated router cannot break this one. The five composition groups are:

- **Identity router** depends on: `AccountsRepository`, `JwtConfirmationService`, `SesEmailService`, `ConfirmEmailStateMachineClient`, `HmacFingerprintService`, `ApiKeyMintService`, `ApiKeyBinder`.
- **API key router** depends on: `ApiKeysRepository`, `ApiKeyMintService`, `ApiKeyBinder`, `HmacFingerprintService`, `ApiGatewayKeysClient`.
- **Provisioning router** depends on: `AccountsRepository`, `AccountProvisioningStateMachineClient`, `AccountTeardownStateMachineClient`, `ServiceKeyRotationStateMachineClient`, `OrganizationsClient` (for `CreateAccount`), `StsAssumeRoleService`, `EncryptionService`.
- **DNS router** depends on: `CustomDomainsRepository`, `DomainConfigStateMachineClient`, `Route53Client`, `AcmClient`.
- **Maintenance access router** depends on: `MaintenanceLoginsRepository`, `MaintenanceAccessStateMachineClient`, `ComplyAuthenticationService`, `MaintenanceApprovalSigner`, `EncryptionService`, `TotpService`, `StsAssumeRoleService`.

The container is constructed **once per router**, not per request, so cached SDK clients survive across invocations within the same Lambda warm container.

---

## 5. Asynchronous Pipelines & Step Functions

### 5.1 ConfirmEmail pipeline

- **Trigger**: `AccountsTable` DDB stream (`StreamViewType: NEW_IMAGE`); the `ConfirmationEmailEnqueuer` Lambda inspects each `INSERT`/`MODIFY` record and starts the SFN when `RequiredAction.SEND_EMAIL ∈ required_actions`.
- **State machine** (`ConfirmEmailStateMachine`, STANDARD, total timeout 86400 s = 1 day):
  ```
  ConfirmEmailStepOneWaits (Lambda: waitForTaskToken, heartbeat 86400 s)
    → ConfirmEmailStepTwo (Lambda)
  ```
- **Step One** (`ConfirmEmailSendAndWait`): looks up the account, signs a JWT (`{ task_token, account_id }` + HS256 secret `JWT_CONFIRM_EMAIL_SECRET`), constructs the confirm URL (`<after_confirm_callback_url || default>?account_id=&confirmation_token=`), sends `account_send_user_key_and_confirm_email_v1` SES template, removes `RequiredAction.SEND_EMAIL` from the latest version, emits the success metric. Errors are reported via Powertools; a missing account (DDB race) silently succeeds (token stays parked).
- **Step Two** (`ConfirmEmailFinalise`): runs after `POST /accounts/confirm-email` releases the token via `states:SendTaskSuccess`; writes a new `AccountsTable` version with `RequiredAction.CONFIRM_EMAIL` removed, sets `confirmed_email_at`, flips `status = CONFIRMED`, emits the confirmation metric.

### 5.2 Account provisioning pipeline

- **Trigger**: `POST /accounts/{account_id}/provision` synchronously starts `AccountProvisioningStateMachine` with `executionName = account_id`.
- **State machine** (STANDARD, total timeout 7200 s = 2 h):
  ```
  ValidateRequest               → ChooseAccountStrategy (Choice)
                                    ├── new sub-account → CreateAwsSubAccount (organizations:CreateAccount, then PollCreateAccountStatus)
                                    └── existing       → AssumeBootstrapRole
  ResolveBootstrapCredentials   → CreateRoute53HostedZone
                                → RequestAcmCertificates (Map: main + wildcard)
                                → WaitForCertificateValidation (Wait, polls acm:DescribeCertificate)
                                → MintInitialServiceApiKey (cross-account apigateway:CreateApiKey + UsagePlan binding)
                                → WriteProvisionedAccountRow (new version; status = ACTIVE; aws_account_id, fqdn, hosted_zone_id, certificates, service_api_key_id, service_api_key_encrypted populated)
                                → EmitProvisioningCallback (POST callback_url with callback_payload + bootstrap_manifest_url)
                                → Success
  Catch → WriteErrorAccountRow (new version; status = ERROR, write trace to AccountRecordBucket) → EmitProvisioningCallback → Fail
  ```
- All state machine roles use `states:SendTaskSuccess`/`SendTaskFailure` on `*` (Step Functions does not support resource-level scoping on these).
- The Choice node lets the deployer pre-create AWS sub-accounts (e.g. via Control Tower) and have Account skip directly to DNS provisioning by passing `{ aws_account_id }` on the request body (the `POST /accounts/{account_id}/provisionV2` shape).
- **Account does not deploy product CloudFormation stacks into the new sub-account.** Initial tenant bootstrap is performed by the operator-run bootstrap CLI: it calls `GET /accounts/{account_id}/bootstrap-manifest` with the owner's API key, pulls the latest Deployer and Marketplace Puller bundles from Marketplace, locally installs Deployer into the new AWS account using the operator's AWS credentials, then uses that Deployer to install Puller. `EmitProvisioningCallback` only notifies the caller that the account is ready to bootstrap and includes `bootstrap_manifest_url` when a callback URL was supplied.

### 5.3 Account teardown pipeline

- **Trigger**: `POST /accounts/{account_id}/disable` synchronously starts `AccountTeardownStateMachine` with `executionName = account_id-disable-<timestamp>`.
- **State machine** (STANDARD, total timeout 3600 s):
  ```
  AssumeTenantRole → RevokeAllApiKeysForAccount (Distributed Map over ApiKeysTable.account_id_index rows; each row → Usage Plan unbind + apigateway:DeleteApiKey + status = REVOKED)
                    → AssertNoTenantApiGatewayDomainConsumers (fail if the bootstrap-created domain or product base-path mappings still exist)
                    → DeleteRoute53Records
                    → DeleteAcmCertificates
                    → WriteDisabledAccountRow (new version; status = DISABLED, subdomain_status = TEMPORARY_BLOCKED)
                    → EmitDeletionCallback (POST /accounts/{account_id}/delete-callback)
                    → Success
  Catch → WriteErrorAccountRow (status = ERROR) → EmitDeletionCallback → Fail
  ```
- Account **does not** delete product CloudFormation stacks, the Bootstrap-created API Gateway custom domain, or product base-path mappings inside the tenant sub-account. The required pre-disable path is Puller's `POST /marketplace-puller/uninstall { confirm: true }`, which drains Marketplace subscriptions and invokes the local Deployer delete routes for every live component until Puller reports `safe_for_account_disable=true`. Operators then remove remaining system resources (Puller / Deployer / Bootstrap stacks) before calling `POST /accounts/{account_id}/disable`. `AssertNoTenantApiGatewayDomainConsumers` is a guardrail: it detects remaining API Gateway domain/mapping consumers and fails with an operator-actionable error instead of force-deleting resources that CloudFormation stacks own. If product or bootstrap stacks remain when DNS deletion runs, ACM certificate deletion will fail (because they're still in use) and the teardown SFN flips the row to `ERROR`.

### 5.4 DomainConfig pipeline

- **Trigger**: `PUT /accounts/{account_id}/custom-domains` synchronously starts `DomainConfigStateMachine` with `{ domains, target_fqdn?, account_fqdn }`.
- **State machine** (STANDARD):
  ```
  ProcessDomains (Map, MaxConcurrency 5)
    → ValidateHostedZoneAndCertificate (Lambda, 200 s timeout)
    → UpsertDomainConfigRow
  PublishDomainConfig (Lambda — writes Account-managed SSM cache for tenant deployers)
  RecordCustomDomainCollection (Lambda — writes the final state into CustomDomainsTable)
  GracefulExit (Succeed)
  ```
- The workflow validates only Account-owned DNS and certificate facts. It never calls API Gateway domain or mapping mutation APIs; Bootstrap creates the shared tenant API Gateway custom domain, and product route mappings are created by the service CDK stacks that Deployer runs.

### 5.5 ServiceKeyRotation pipeline

- **Trigger**: `POST /accounts/{account_id}/service-key/rotate` synchronously starts `ServiceKeyRotationStateMachine` with `{ account_id, requested_by }`.
- **State machine** (STANDARD, total timeout 600 s):
  ```
  AssertNoRotationInFlight (DDB conditional update on AccountsTable row at latest version: service_api_key_rotation_in_progress = false → true)
    → AssumeTenantRole (sts:AssumeRole)
    → LoadSharedUsagePlanId (Lambda — reads tenant SSM `/account/shared-usage-plan-id`, written by Bootstrap)
    → MintNewServiceKey (Lambda — apigateway:CreateApiKey + apigateway:CreateUsagePlanKey against the shared Usage Plan inside the tenant sub-account; writes a new ApiKeysTable row at kind = "service", ACTIVE)
    → KmsEncryptAndStash (Lambda — writes a NEW AccountsTable version; service_api_key_id, service_api_key_encrypted, service_api_key_hash, service_api_key_rotated_at populated; status stays ACTIVE)
    → PublishTenantServiceKeyConsumers (Lambda — using the tenant STS session, writes the current plaintext key to Account-managed SecureString parameters, reads stable connection-ARN pointers such as `/marketplace-puller/<stage>/marketplace-api-key-connection-arn`, and updates known EventBridge Connections such as Puller's MarketplaceApiKeyConnection)
    → VerifyTenantServiceKeyConsumers (Lambda — smoke-checks that Account-managed consumers now resolve the new key version)
    → WaitGracePeriod (Wait SERVICE_KEY_ROTATION_GRACE_SECONDS = 60 s; lets in-flight callers cut over)
    → RevokePriorServiceKey (Lambda — delete the prior shared UsagePlanKey + apigateway:DeleteApiKey of the prior service key inside the tenant sub-account; flips the prior ApiKeysTable row to REVOKED)
    → ClearRotationFlag (DDB update; service_api_key_rotation_in_progress = false)
    → Success
  Catch → ClearRotationFlag → WriteErrorAccountRow (writes a ServiceKeyRotationError trace) → Fail
  ```
- The rotation flag is a single boolean on the Account row that prevents two concurrent rotations from racing; concurrent attempts return `409 ServiceKeyRotationInProgress`.
- The new key is `ACTIVE` for the full 60 s grace window before the old one is revoked, so callers who held the old key in cache for less than 60 s see no broken auth.
- Account is the source of truth for the current valid service key. Any tenant-side storage of the plaintext is Account-managed, not product-managed: `PublishTenantServiceKeyConsumers` updates the canonical `/account/current-service-api-key` SecureString and only those product-specific aliases that target a distinct remote API key, such as `/marketplace-puller/<stage>/marketplace-api-key` for the central Marketplace connection. Puller local Deployer calls read `/account/current-service-api-key` directly; there is no separate `/marketplace-puller/<stage>/local-deployer-api-key` alias to rotate. Account discovers EventBridge Connections through stable tenant-side SSM pointers published by the owning product, for example `/marketplace-puller/<stage>/marketplace-api-key-connection-arn`; it must not scrape CloudFormation outputs or derive ARNs from naming conventions. Marketplace subscriptions are not keyed by API Gateway key id, so service-key rotation never rewrites subscription ownership. The old key is not revoked until these updates and the verification step succeed.
- Products may read the Account-managed SSM parameter or use an Account-updated EventBridge Connection, but they MUST NOT mint or rotate the service key independently. A failed tenant-consumer publish aborts rotation and leaves the prior key active.

### 5.6 MaintenanceAccess pipeline

- **Trigger**: `POST /accounts/{account_id}/maintenance-access` synchronously starts `MaintenanceAccessStateMachine` with `{ account_id, username, user_type, expiration_minutes, skip_owner_approval, requester_email }` and `executionName = temp_access_uuid`.
- **State machine** (STANDARD, total timeout = `MAINTENANCE_ACCESS_TTL_MINUTES + 5 min` execution slack; the slack is for cleanup retries only and does not extend the IAM user's usable lifetime):
  ```
  PurgePriorSession           (Lambda — looks up any prior MaintenanceLoginsTable row for (username, account_id),
                                       writes its iam_user_arn to IamGarbageCollectionQueue, deletes the row)
    → AssumeTenantRole         (sts:AssumeRole into the account's OrganizationAccountAccessRole)
    → DeriveIamUsername        (Lambda — builds an IAM-safe name from raw SSO username; see below)
    → MintIamUser              (iam:CreateUser at /MAINTENANCE_USERNAME_PREFIX/<iam_username>,
                                 iam:CreateLoginProfile with random one-time password)
    → KmsWrapCredentials       (Lambda — KMS-encrypts the {console-username, account-alias, password}
                                  and writes the MaintenanceLoginsTable row at approval_state="PENDING";
                                  mfa_enrollment_state is MANUAL_REQUIRED when tenant policy requires MFA)
    → ChooseApprovalPath (Choice)
        ├── skip_owner_approval=true AND requester is account owner → BypassApproval
        └── otherwise                                               → AwaitOwnerApproval (waitForTaskToken,
                                                                       timeout = min(MAINTENANCE_APPROVAL_TIMEOUT_MINUTES, seconds_until_expires_at))
    AwaitOwnerApproval → Choice on approval payload
        ├── APPROVED → SendMaintenanceLinkEmail (Lambda — emails the requester the temp_access_link)
        ├── DENIED   → MarkDenied (approval_state="DENIED") → CleanupIamUser (enqueue) → Fail "MaintenanceApprovalDenied"
        └── timeout   → MarkExpired → CleanupIamUser → Fail "MaintenanceApprovalTimeout"
    BypassApproval → SendMaintenanceLinkEmail
    SendMaintenanceLinkEmail → WaitUntilExpiresAt (absolute wait until MaintenanceSession.expires_at)
                             → CleanupIamUser (enqueue) → Success
  Catch → MarkSessionError → CleanupIamUser → Fail
  ```
- The owner approval email contains two HMAC-signed URLs (`Approve` / `Deny`); the public callback `GET /accounts/{account_id}/access-permission?...&signature=` verifies the HMAC, enqueues the verdict on `MaintenanceApprovalQueue`, and `MaintenanceApprovalApplier` releases the SFN task token via `states:SendTaskSuccess` with `{ approval_state }`.
- Approval does not extend IAM-user lifetime. `KmsWrapCredentials` sets `expires_at = iso8601_logged_in_at + expiration_minutes`, `AwaitOwnerApproval` is bounded by the earlier of `MAINTENANCE_APPROVAL_TIMEOUT_MINUTES` and `expires_at`, and an approval that arrives at or after `expires_at` is treated as expired: the workflow marks the row `approval_state="EXPIRED"`, enqueues cleanup, and does not send a temp-access link.
- Account does not call `iam:CreateVirtualMFADevice` or `iam:EnableMFADevice`. When MFA is required by tenant policy, the maintenance email/link instructs the operator to enroll MFA manually in IAM for the temporary username before using the console credentials. The Account API does not expose TOTP seeds or passcode generation.
- `IamUserGarbageCollector` is the single chokepoint for tenant-side IAM teardown. It consumes from `IamGarbageCollectionQueue` (explicit revoke + expiry wait + TTL stream) and runs on a `rate(1 hour)` self-audit schedule that cleans up matching maintenance rows whose `expires_at <= now` and `iam_cleanup_at` is absent, plus orphaned IAM users under `MAINTENANCE_USERNAME_PREFIX` whose `CreateDate < now - MAINTENANCE_ACCESS_TTL_MINUTES`. For each expired user it deletes the login profile, deletes the IAM user, and idempotently updates any matching `MaintenanceLoginsTable` row with `approval_state="EXPIRED"` when still non-terminal plus `iam_cleanup_at=now`. A matching DDB row is an audit record, not a deletion guard. The SFN absolute expiry wait is the primary lifetime control; the hourly audit is only a fallback for missed or failed cleanup.

**IAM username derivation.** The raw SSO `username` is retained only in `MaintenanceLoginsTable` and logs/audit fields. It is never concatenated directly into IAM `UserName` or `Path`. `DeriveIamUsername` lowercases the SSO identity, replaces every character outside `[a-z0-9+=,.@_-]` with `-`, collapses repeated `-`, trims leading/trailing punctuation, truncates the slug to 32 characters, appends `-<sha256(username).slice(0,12)>-<short-ulid>`, and stores the final value as `iam_username`. The IAM path remains the fixed `MAINTENANCE_USERNAME_PREFIX` (`account-maintenance/` by default), and the final IAM `UserName` must be at most 64 characters. This preserves operator readability while avoiding invalid characters and collisions.

---

## 6. Internal Data Schemas

### 6.1 ConfirmEmail SFN input / output

```ts
type ConfirmEmailInput  = { account_id: string };
type ConfirmEmailEvent  = { input: { account_id: string }; task_token: string }; // Step One Lambda
type ConfirmEmailOutput = { confirmed_email_at: string };
```

### 6.2 Account provisioning SFN input / output

```ts
type AccountProvisioningInput = {
  account_id: string;
  subdomain: string;
  aws_account_id?: string;            // skip Organizations:CreateAccount when present
  callback_url?: string;
  callback_payload?: string;
};

type AccountProvisioningOutput = {
  account_id: string;
  status: "ACTIVE" | "ERROR";
  fqdn: string;
  hosted_zone_id?: string;
  certificates?: AccountCertificate[];
  account_token?: string;
  error?: { type: string; message: string; details?: Record<string, unknown> };
};
```

### 6.3 DomainConfig SFN input / output

```ts
type DomainConfigInput = {
  account_fqdn: string;
  target_fqdn?: string;
  domains: Array<{
    domain_name: string;
    kind: "CANONICAL" | "ALIAS";
    hosted_zone_id?: string;
    certificate_arn?: string;
    regional_certificates?: Record<string, string>;
  }>;
};

type DomainConfigOutput = {
  account_fqdn: string;
  domain_name: string;
  custom_domains: string[];
  hosted_zone_id: string;
  certificate_arn: string;
  regional_certificates?: Record<string, string>;
  failed: Array<{ domain_name: string; reason: string }>;
};
```

### 6.4 ServiceKeyRotation SFN input / output

```ts
type ServiceKeyRotationInput = {
  account_id: string;
  requested_by: string;                      // SSO identity that started the rotation
};

type ServiceKeyRotationOutput = {
  account_id: string;
  status: "ROTATED" | "ERROR";
  new_api_key_id?: string;
  prior_api_key_id?: string;
  rotated_at?: string;                       // ISO 8601 UTC
  error?: { type: string; message: string };
};
```

### 6.5 MaintenanceAccess SFN input / output

```ts
type MaintenanceAccessInput = {
  account_id: string;
  username: string;                          // SSO identity of the requester
  user_type: "MAINTENANCE" | "QUICKSIGHT";
  expiration_minutes: number;
  skip_owner_approval: boolean;
  requester_email?: string;
};

type MaintenanceAccessOutput = {
  temp_access_uuid: string;
  approval_state: "APPROVED" | "DENIED" | "EXPIRED";
  iam_user_arn: string;
  consumed_at?: string;
  error?: { type: string; message: string };
};

// Owner-approval payload sent into states:SendTaskSuccess by MaintenanceApprovalApplier
type MaintenanceApprovalCallback = {
  temp_access_uuid: string;
  approval_state: "APPROVED" | "DENIED";
  approver_email: string;
  signature_verified_at: string;             // ISO 8601 UTC
};
```

---

## 7. Cross-cutting Concerns

### 7.1 Authentication & authorisation

- **Public sign-up** (`POST /accounts`, `POST /accounts/confirm-email`) is API-key-free. Bot abuse is mitigated via API Gateway throttling (`burstLimit=20`, `rateLimit=10/s`) and CAPTCHA at the upstream front-door (out of scope here).
- **Inter-service** calls (Connect, Persist, deployer, operator UI → Account) use the Account `ServiceApiKey` bound to the Usage Plan as `x-api-key`.
- **Comply Authentication** (`Authorization: Bearer <token>` issued by `https://compliance-auth.comply-authentication.staircaseapi.com`) is required for **API key revocation, service key reads / rotation, and every maintenance-access endpoint**. The bearer token's `username` claim is what gets persisted on the `MaintenanceLoginsTable.username` field, so audit trails are SSO-bound.
- **Owner approval webhooks** (`GET /accounts/{account_id}/access-permission`) authenticate via HMAC-SHA256 signature over the query string using `MAINTENANCE_APPROVAL_HMAC_SECRET_ARN`. No bearer token is required because the link must be clickable directly from the email client.
- **Public temp-access claim** (`GET /accounts/{account_id}/maintenance-access/temp-access`) is `x-api-key`-gated (the marketplace `ServiceApiKey`) **and** requires possession of the unguessable `temp_access_uuid` — it is single-use and atomically marks the row consumed.

### 7.2 Encryption

- All DDB tables encrypt at rest with the shared `DataKey` (KMS CMK).
- API key plaintexts are **never** persisted. Each row stores `api_key_hash = HMAC-SHA256(API_KEY_HMAC_SECRET, api_key)`; the plaintext is returned to the caller exactly once at mint time and discarded by Account thereafter. Lookups by plaintext hash the input first.
- Sensitive fields are application-level encrypted via `EncryptionService.encrypt(key, plaintext)` (AES-256-GCM, key derived from `DataKey` via `kms:GenerateDataKey`):
  - `Account.admin_enc` — bootstrap IAM-user secret (`{ access_key_id, secret_access_key }`).
  - `Account.service_api_key_encrypted` — the per-account service key plaintext, decrypted on demand by `GET /accounts/{account_id}/service-key`.
  - `MaintenanceSession.temp_access_credentials_enc` — the `{ aws_console_username, account_alias, password }` blob, decrypted on the single-use `GET /…/temp-access` call.
- Secrets Manager backs three rotation-independent secrets, all encrypted with `DataKey`:
  - `account/jwt-confirm` — JWT confirmation HS256 secret.
  - `account/api-key-hmac` — HMAC secret for `api_key_hash` derivation. Rotation requires a coordinated dual-write (re-hash every row under the new secret) so it is treated as a yearly maintenance event.
  - `account/maint-approval` — HMAC secret signing the maintenance-approval URLs.

### 7.3 Cross-account assume-role discipline

- Every cross-account call routes through a single helper `withTenantClient(accountRow, factory)` that:
  1. Resolves the tenant sub-account id from `accountRow.aws_account_id`.
  2. `sts:AssumeRole`s into `arn:aws:iam::<aws_account_id>:role/OrganizationAccountAccessRole`.
  3. Constructs the requested SDK client with the resulting `Credentials` and a 60-minute session.
- Errors from the role assume (`AccessDenied`, `MalformedPolicy`, `ExpiredToken`) are mapped to `OutdatedAccount` (422) so the caller is told the account is in a broken state.
- Maintenance-access mints additionally constrain the assumed-role session to a `Policy` parameter that scopes the inline session to `iam:`* against `arn:aws:iam::<tenant>:user/account-maintenance/`* only — even though `OrganizationAccountAccessRole` itself has wider permissions, the Account session token cannot exercise them.

### 7.4 Observability

- **Logger**: AWS Lambda Powertools logger (`POWERTOOLS_SERVICE_NAME=account-`*, `POWERTOOLS_LOG_LEVEL=INFO`). Each handler binds Lambda context once, appends a request-scoped key (`accountId`, `apiKeyId`, `tempAccessUuid`, `requestId`), and resets the keys in `finally`.
- **Structured logging**: every service emits start/progress/end logs with the same shape — a span name (`ServiceName.method`), structured annotations, and a level (`info|warn|error`). The legacy "log_message_with_sequence_token" CloudWatch sequence-token dance (a Python idiom) is **explicitly removed** — Powertools handles streams natively.
- **Metrics**: AWS Lambda Powertools metrics, namespace `account`. Counters: `accounts_created`, `confirmation_emails_sent`, `accounts_confirmed`, `api_keys_minted`, `api_keys_revoked`, `service_keys_rotated`, `accounts_provisioned`, `accounts_disabled`, `custom_domain_mappings_created`, `maintenance_sessions_minted`, `maintenance_sessions_approved`, `maintenance_sessions_denied`, `maintenance_sessions_consumed`, `maintenance_iam_users_garbage_collected`, with dimensions `kind|status|user_type`.
- **Tracing**: every Step Functions state machine sets `tracingEnabled: true`; AWS X-Ray traces are emitted from each Lambda via Powertools `Tracer` (`captureLambdaHandler`).

### 7.5 Long-running command discipline

Every external call (ACM, Route 53, CloudFormation, SES, IAM, Organizations, API Gateway, STS) is wrapped in a promise-with-timeout helper that maps timeouts and SDK errors to the appropriate tagged error. Polling loops emit progress logs before/after each poll with elapsed counters and structured annotations so a stalled run is observable from CloudWatch alone. Maintenance-session timers (approval pending, session-expiry GC) are exclusively driven by Step Functions `Wait` states + EventBridge Scheduler — no in-Lambda `setTimeout` is used.

### 7.6 Service / module structure

The implementation organises behaviour as small services with a clear interface and a swap-in test double:

- Each service has a **typed API** (a TypeScript interface), a **runtime factory** that closes over its dependencies (clients, configs, clocks, ID generators), and a **live binding** that wires real AWS SDK clients + env-var-derived config.
- Errors are **structured tagged classes** with a discriminator (`type` / `_tag`) so the HTTP layer can `switch` on them when mapping to status codes.
- Composition is split per router (§4.7) to keep config requirements minimal — a missing env var for an unrelated router must never fail this router.

### 7.7 Testing strategy

- Unit tests live in `test/services/**/*.ts`, `test/schemas/**/*.ts`, `test/handlers/**/*.ts`, `test/routes/**/*.ts`, `test/http/responses.test.ts`, and `test/cdk/account-stack.test.ts`.
- Vitest is the test runner. `setupTests.ts` wires the metric-buffer reset/flush before/after each test and stubs `STSClient` / `OrganizationsClient` via `aws-sdk-client-mock`.
- Step Functions Local is the canonical SFN integration runner. `just test` (per CI contract) starts the Step Functions Local docker container automatically using `scripts/start-step-functions-local.sh` and runs the SFN test suite under `test/sfn/**/*.ts`.
- Integration tests live in `test/integration/account-api.test.ts`; they SigV4-sign requests via `aws4` and target a deployed stage (`ACCOUNT_API_URL`, `AWS_PROFILE`).
- The OpenAPI spec at `docs/openapi.json` is regenerated by `scripts/generate-openapi.ts` from the route-definition module.

### 7.8 CI/CD

- `.github/workflows/ci-cd-dev.yml` (PRs to `main`, `TARGET_ENV=dev`) and `.github/workflows/ci-cd-prod.yml` (push to `main`, `TARGET_ENV=prod`) call the shared reusable workflows. The repo `justfile` exposes the contract recipes (`just check`, `just test`, `just cdk:synth`, `just cdk:deploy`).
- `pnpm` is the package manager. `pnpm check` runs the TypeScript compiler in build mode (`tsc -b`). `pnpm lint` uses ESLint; `pnpm format` uses Prettier with import sort.
- Husky hooks run `lint-staged` on commit.

---

## 8. Operational Playbook

### 8.1 Prerequisites

- Node.js 22+ (Lambda runtime is 24).
- pnpm.
- AWS CLI/CDK with permissions for KMS, S3, SQS, DynamoDB, Step Functions, IAM, API Gateway, Lambda, CloudWatch Logs, SSM, SES, ACM, Route 53, Organizations, Secrets Manager, EventBridge Scheduler.
- Three pre-populated Secrets Manager secrets, all referenced by the env vars in §2.4 and encrypted with `DataKey`:
  - `account/jwt-confirm` (JWT confirmation HS256 secret).
  - `account/api-key-hmac` (HMAC-SHA256 secret used for `api_key_hash` derivation).
  - `account/maint-approval` (HMAC-SHA256 secret signing the maintenance-approval URLs).
- A reachable Comply Authentication issuer URL (`/account/comply-auth-issuer` SSM parameter, defaults to `https://compliance-auth.comply-authentication.staircaseapi.com`).
- Pre-provisioned `Subdomain` (e.g. `marketplace.staircaseapi.com`), `MainCertificate`, `WildCertificate`, and `OrganizationsParentRoleArn` parameters.

### 8.2 Deploy / destroy

```bash
pnpm install
pnpm cdk:synth
pnpm cdk:deploy            # AccountSharedStack first, then AccountStack
pnpm cdk:destroy           # only when AccountsTable contains no ACTIVE / PROVISIONING / DISABLING rows
```

Stack outputs: `AccountApiUrl`, `AccountProvisioningStateMachineArn`, `AccountTeardownStateMachineArn`, `ConfirmEmailStateMachineArn`, `DomainConfigStateMachineArn`, `ServiceKeyRotationStateMachineArn`, `MaintenanceAccessStateMachineArn`, `AccountsTableName`, `ApiKeysTableName`, `MaintenanceLoginsTableName`. The stack writes `/account/api-url` and Account-managed domain config cache parameters to SSM for downstream service discovery.

### 8.3 Smoke tests

After every deploy, run the seven release-validation calls listed in `README.md`:

1. `POST /accounts` (kind=customer) with a fresh email; verify the row lands in `AccountsTable` at `status = PENDING_CONFIRMATION`, the matching `ApiKeysTable` row is at `PENDING_CONFIRMATION`, the SES log shows the templated send, and the SFN execution is in `WAIT_FOR_TASK_TOKEN`.
2. `POST /accounts/confirm-email` with the JWT minted by the SES link; verify the `account_key` is returned, the `ApiKeysTable` row flips to `ACTIVE`, the Usage Plan key binding succeeds, the `AccountsTable` row gets a new version at `status = CONFIRMED`, and the SFN moves to `Succeeded`.
3. `POST /accounts/{account_id}/api-keys` to mint a second key; `GET /accounts/{account_id}/api-keys` returns both rows; `DELETE /accounts/{account_id}/api-keys/{api_key_id}` flips the old row to `REVOKED` and unbinds it from the Usage Plan.
4. `POST /accounts/{account_id}/provision` with a unique subdomain; verify the SFN provisions the AWS sub-account (or assumes the existing one), creates the Route 53 hosted zone, issues both ACM certificates, mints the initial `service_api_key`, and the latest `AccountsTable` version is at `status = ACTIVE`.
5. `POST /accounts/{account_id}/service-key/rotate` and confirm `ServiceKeyRotationStateMachine` succeeds; the new `service_api_key_rotated_at` is within the last minute and the prior key is `REVOKED` after the 60 s grace.
6. `POST /accounts/{account_id}/maintenance-access` (with a valid Comply Authentication bearer); confirm the SES owner-approval email arrives, click `Approve`, then `GET /…/temp-access?temp_access_uuid=…` returns valid console credentials exactly once (and 410 on the second call). If tenant policy requires MFA, confirm the response/email instructs the operator to complete manual MFA enrollment in IAM; Account does not return TOTP passcodes.
7. `POST /accounts/{account_id}/disable` for a stage account; verify the SFN revokes any remaining API keys, tears down the DNS layer, and the latest `AccountsTable` version flips to `DISABLED`. The hourly `IamUserGarbageCollector` self-audit clears any leftover maintenance IAM user within 1 h.

### 8.4 Rollback

1. `git checkout <last-known-good>` and `pnpm cdk:deploy` — keeps DynamoDB / SQS / S3 in place.
2. Re-run the smoke checks.
3. Confirm no accounts are stuck in `PROVISIONING` / `DISABLING` longer than 30 minutes (audit DynamoDB scan filtered by `status` and `last_update_datetime < now - 30m`); manually re-drive via `aws stepfunctions start-execution` with the saved `executionName`.
4. Confirm no maintenance sessions are stuck in `approval_state = PENDING` longer than `MAINTENANCE_APPROVAL_TIMEOUT_MINUTES + 5 min` (scan `MaintenanceLoginsTable` filtered by `approval_state` and the timestamp).

### 8.5 Common runbook items

- **Account stuck in `PROVISIONING`**: inspect the SFN execution history. If the execution failed at `WaitForCertificateValidation`, ACM has DNS-validation pending — verify the validation `CNAME` records in Route 53 and re-drive.
- **Confirmation email never delivered**: check the `ConfirmationEmailDlq` and SES bounce notifications. If the recipient is a known transactional sandbox, re-mint the row via `PUT /accounts/{account_id}` to retrigger the stream.
- **Teardown stuck on ACM delete**: a tenant product has not yet deleted its API Gateway / CloudFront usage of the certificate. Whoever owns that product must delete its stack before Account can complete teardown — Account intentionally does **not** force-delete product stacks.
- **API key revoke leaves stale Usage Plan binding**: re-drive `RevokeApiKey` for the row's `api_key_id`. The handler is idempotent (`apigateway:DeleteUsagePlanKey` returns 404 silently when already removed).
- **Maintenance session stuck pending approval**: the SFN times out automatically after `MAINTENANCE_APPROVAL_TIMEOUT_MINUTES` and `IamUserGarbageCollector` cleans up the IAM user. If the requester needs faster turnaround, re-issue the request after the timeout — the new request supersedes any prior one for the same `(username, account_id)`.
- **Orphaned tenant IAM user**: the hourly `IamUserGarbageCollector` cron lists IAM users under `MAINTENANCE_USERNAME_PREFIX` with `CreateDate < now - MAINTENANCE_ACCESS_TTL_MINUTES`, deletes them even when a matching `MaintenanceLoginsTable` audit row still exists, and stamps that row with `iam_cleanup_at`. Manual cleanup is rarely needed; if the cron itself fails, inspect `IamGarbageCollectionDlq`.

---

## 9. Re-creation Checklist (in order)

1. **Repo skeleton**: pnpm workspace, TypeScript, `tsconfig.{base,build,app,src,test}.json`, ESLint, Prettier (with import sort), husky + lint-staged, Vitest. Package name is internal.
2. **Runtime dependencies**: `@aws-lambda-powertools/{logger,metrics,event-handler,tracer,parameters}`, `@aws-sdk/client-{dynamodb,s3,sfn,sqs,apigateway,kms,lambda,ssm,sts,secrets-manager,ses,sesv2,iam,acm,route53,organizations,events,scheduler}`, `@aws-sdk/credential-providers`, `@aws-sdk/lib-dynamodb`, `aws4`, `jose`, `undici`, `zod`. CDK: `aws-cdk-lib`, `constructs`, `aws-cdk`.
3. **Schemas / contracts**: one module per group in `lambda/schemas/` — `account/{create,update,confirm-email}`, `api-key/{mint,revoke,rotate-service}`, `provision/{provision,disable,certificate}`, `custom-domain`, `maintenance-access/{request,approve,temp-access}`, `http`, `errors`. Errors are tagged classes; everything else is type+validator pairs.
4. **Utils**: `lambda/utils/{encryption,hmac-fingerprint,jwt,approval-signer,jsonResponse,strict-transport-security,trace,date,sigv4}.ts`.
5. **Configuration**: `lambda/config/account.ts` (region, env table names, KMS arn, JWT secret, HMAC secrets, TTLs, SES sender) plus per-service config readers tied to the env vars in §2.4. Required vars must throw at startup; optional vars must default per §2.4.
6. **Services** (one file each in `lambda/services/`): Identity (`AccountsRepository`, `JwtConfirmationService`, `EmailService`, `ConfirmEmailStateMachineClient`, `HmacFingerprintService`); API key (`ApiKeysRepository`, `ApiKeyMintService`, `ApiKeyBinder`, `ApiGatewayKeysClient`); Provisioning (`AccountProvisioningClient`, `AccountTeardownClient`, `ServiceKeyRotationClient`, `OrganizationsClient`, `StsAssumeRoleService`, `withTenantClient` helper, `EncryptionService`); DNS (`CustomDomainsRepository`, `DomainConfigClient`, `Route53Client`, `AcmClient`); Maintenance access (`MaintenanceLoginsRepository`, `MaintenanceAccessClient`, `ComplyAuthenticationService`, `MaintenanceApprovalSigner`, `TotpService`, `IamUserManager`); Metrics (`AccountMetrics`); plus a composition module `services/index.ts` that exports per-router and per-handler dependency containers.
7. **HTTP layer**: `lambda/http/{request-context.ts, responses.ts}`, `lambda/logging/{powertools.ts, runtime.ts}`, the routers (`identity`, `api-keys`, `provisioning`, `service-keys`, `custom-domains`, `maintenance-access`) and `router.ts` mounting them with `prefix="/account"`, then `handler.ts`.
8. **Worker handlers** + **Workflow handlers** in `lambda/{provisioning, teardown, confirm-email, domain-config, service-key-rotation, maintenance-access, accounts-processor, iam-user-gc, maintenance-approval-applier, ...}/`.
9. **OpenAPI generator**: `lambda/api/definitions.ts` and `scripts/generate-openapi.ts`. `pnpm api:spec` writes `docs/openapi.json` (the generated spec is checked in).
10. **CDK stacks**: `lib/account-shared-stack.ts`, `lib/account-stack.ts`, then `bin/app.ts`.
11. **Local Step Functions Local**: `scripts/start-step-functions-local.sh`, `setupTests.ts`, `vitest.config.ts`, `justfile` (`just test` orchestrates docker + vitest), and a CI caller wired to the shared workflows.
12. **Smoke tests**: replicate the seven release-validation steps from §8.3 in the integration suite under `test/integration`.

---

## 10. Acceptance Criteria

A re-implementation is considered functionally complete when:

- All endpoints in §1.2 return the documented success / error envelopes for the example payloads in `README.md` and the OpenAPI spec.
- `Account` is the only entity name surfaced anywhere in routes, payloads, logs, metrics, OpenAPI, and source code. The strings `Environment`, `Tenant`, `Workspace`, `Customer Account`, and `Organization Account` (as standalone entity names; `kind: "customer" | "organization"` is allowed because it is an attribute of `Account`) do **not** appear as type names, table names, route segments, or class names.
- `POST /accounts` triggers the `ConfirmEmailStateMachine` for `kind=customer`, mints the `account_key` row at `PENDING_CONFIRMATION`, and the JWT confirmation token released by `POST /accounts/confirm-email` returns the `account_key`, binds it to the marketplace Usage Plan, and writes a new `AccountsTable` version at `status = CONFIRMED` (idempotent within `CONFIRMATION_LINK_EXPIRY_HOURS`).
- `POST /accounts/{account_id}/api-keys` mints an additional `ACTIVE` key bound to the Usage Plan and returns the plaintext value exactly once. `DELETE /accounts/{account_id}/api-keys/{api_key_id}` unbinds and revokes it idempotently.
- API key rotation never invalidates a stored handle: rotating an account's keys (mint new, revoke old) leaves every previously-recorded `account_id`, every SFN execution name, every S3 prefix, every log line, and every downstream service reference still valid. `AccountsTable.PK = account_id` (immutable) is the guarantee.
- `POST /accounts/{account_id}/provision` provisions a new tenant AWS sub-account (or assumes a deployer-supplied one), creates the Route 53 hosted zone, issues both ACM certificates, mints the initial per-account `service_api_key`, writes a new `AccountsTable` version at `status = ACTIVE`, and POSTs the optional `callback_url` exactly once within 30 minutes for the happy path.
- `POST /accounts/{account_id}/service-key/rotate` performs an atomic rotate-by-add: the new key is `ACTIVE` and visible via `GET /accounts/{account_id}/service-key` for at least `SERVICE_KEY_ROTATION_GRACE_SECONDS` before the prior key is moved to `REVOKED`. Concurrent rotations on the same account return `409 ServiceKeyRotationInProgress`.
- `POST /accounts/{account_id}/disable` revokes every API key bound to the account, asserts that tenant API Gateway domain/mapping consumers have already been removed, deletes Account-owned Route 53 records and ACM certificates, writes a new version at `status = DISABLED`, and POSTs `/accounts/{account_id}/delete-callback` exactly once. It does **not** attempt to delete product CloudFormation stacks, the Bootstrap-created API Gateway custom domain, or product base-path mappings (out of scope).
- `PUT /accounts/{account_id}/custom-domains` is idempotent: re-running the same body does not create duplicate DNS/certificate rows, and previously-failed DNS/certificate validations are healed by the DomainConfig SFN.
- `POST /accounts/{account_id}/maintenance-access` mints a fresh row at `approval_state=PENDING`, supersedes any prior session for the same `(username, account_id)` (the prior IAM user is queued for GC), and either pauses for the owner-approval task token or proceeds immediately when `skip_owner_approval=true` and the requester is the account owner.
- `GET /accounts/{account_id}/maintenance-access/temp-access` is **single-use**: a second call against the same `temp_access_uuid` returns `410 MaintenanceSessionAlreadyConsumed`. Account does not expose a TOTP passcode endpoint; MFA enrollment, when required, is manual.
- The `IamUserGarbageCollector` cron deletes any tenant IAM user under `MAINTENANCE_USERNAME_PREFIX` older than `MAINTENANCE_ACCESS_TTL_MINUTES` regardless of whether the 24-hour `MaintenanceLoginsTable` audit row still exists. Matching rows are stamped with `iam_cleanup_at`, and no orphaned tenant IAM user lives beyond ~1 h.
- Versioning invariants: every mutation on `AccountsTable` writes a new `version` row (the previous live row is preserved); reads always return the highest-`version` row. `ApiKeysTable` rows are never deleted — `REVOKED` is a terminal state, not an absence.
- API key plaintexts are **never** persisted; `ApiKeysTable.api_key_hash` is HMAC-SHA256 of the plaintext under `API_KEY_HMAC_SECRET`. A DDB scan reveals zero usable API keys, and no DDB primary key or GSI partition key has ever held the plaintext or hashed `account_key` of an Account row.
- All Lambdas use `nodejs24.x`, ARM64, ESM bundling, and the `createRequire` banner so all CommonJS-only dependencies work at runtime.
- IAM permissions follow least-privilege per §2.3.6; no wildcard `*` actions remain in the deployed roles, and `sts:AssumeRole` is constrained to the configured Organizations OU IDs. Maintenance-access assumed-role sessions additionally apply an inline session policy that scopes them to `iam:`* on `arn:aws:iam::<tenant>:user/account-maintenance/`* only.
- All structured logs include the relevant `accountId` / `apiKeyId` / `tempAccessUuid` / `requestId` so an operator can trace a single signup-to-active-account journey, a key rotation, or a maintenance session end-to-end via CloudWatch Logs Insights.
- No tenant-plane Lambda surface ships from this repository — every cross-account effect is performed via `sts:AssumeRole` from the marketplace.
