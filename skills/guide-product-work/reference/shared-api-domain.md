# Shared API domain attachment contract

Apply this contract to every assigned product that exposes an API, including
Environment, Build, Deploy and Marketplace. Require an API Gateway **Custom
Domain Name resource** and a product-owned CDK mapping under the assigned base
path. Keep DNS traffic records optional. Do not make API endpoints mandatory for
configuration-only bundles or components that expose no API.

Treat this as required behavior to implement and verify in product repositories,
not evidence of deployed support. Discover the actual Environment, Build,
Marketplace and Deploy schemas before calling APIs. Implement missing behavior
with the responsible builder; configurers must not bypass unsupported APIs.
Preserve [stable stack identity](../../build-product-deployer/reference/stack-identity.md).

## Ownership and prerequisites

- Environment/Torterra owns create/adopt, certificate lifecycle and shared-domain
  metadata. Require a compatible Regional domain with TLS 1.2 and an issued,
  valid certificate in the target region for REST/HTTP API attachment. Verify
  domain/API account and region compatibility. Route unsupported protocol types
  to an explicit supported design; do not silently attach WebSocket APIs to the
  REST/HTTP shared domain.
- Environment/Shaymin configures existing capabilities through its HTTP API.
  Make hosted-zone management and traffic-routing DNS records opt-in. Accept a
  compatible existing certificate; optional traffic DNS does not waive certificate
  validation. Do not create Route 53 resources merely to satisfy attachment.
- Product stacks own APIs, API Gateway stages and mappings. Never create or delete
  the Environment-owned domain, certificate or DNS from an ordinary product stack.
  Keep Environment's shared resources in its own stable infrastructure boundary.
- Publish versioned non-secret metadata through the verified source below. Expose
  supported API read-back without changing its shape. Mappings need the domain
  name, not certificate management permissions.
- Prepare shared-domain resources before the first API product installation.
  Before service APIs exist, use Environment's authorized Bootstrap adapter and
  shared execution logic to create/adopt prerequisites and pass the same resolved
  parameters into the first Deploy install. Adopt/read back non-secret results
  through Environment once available. Do not require Environment's own API to be
  running before creating its domain or introduce a second deployment engine.

## Shared domain metadata source

Environment shared-routing writes SSM `/account/env-parameters` in the customer
account/region with schema `environment.shared-routing.outputs.v1`, plus
`/account/shared-usage-plan-id`:

```json
{
  "schema_version": "environment.shared-routing.outputs.v1",
  "account_id": "<account-id>",
  "aws_account_id": "<aws-account-id>",
  "region": "<region>",
  "domain": {
    "fqdn": "api.example.com",
    "certificate_arn": "arn:aws:acm:...",
    "regional_domain_name": "d-xxxx.execute-api.<region>.amazonaws.com",
    "regional_hosted_zone_id": "<zone-id>",
    "additional_fqdns": ["optional"]
  },
  "usage_plan": { "id": "<id>", "name": "<name>" },
  "dns": { "mode": "EXTERNAL" }
}
```

`dns.mode` is `EXTERNAL` or `MANAGED_ALIAS`; `additional_fqdns` is optional.
Build reads this parameter and maps it conditionally; Deploy's reader is being
wired to the same parameter. Read this parameter; do not invent another name,
route or shape. Reject unsupported `schema_version` values.

## Bundle and CDK boundary

Use CloudFormation parameters for environment-dependent attachment values. Require
`SharedApiDomainName` as a nonempty string without a default for new integrations.
Preserve existing parameter names through an explicit verified binding when
migrating; do not rename stack resources or rewrite an immutable assembly.
Keep the base path a stable product declaration without a leading/trailing slash;
reject empty/root claims and duplicate paths. Do not derive it from bundle version
or a deployment-stage selector. Preserve an existing verified path during adoption.

Publish only `base_path` and `requires.domain: true` for the shared domain in
`marketplace.product.json`, keeping other existing fields:

```json
{
  "base_path": "persist",
  "requires": { "domain": true }
}
```

Build's manifest schema is closed and rejects unknown fields. Do not add
`endpoint_contract_version`, `endpoints` or other undeclared fields; Marketplace
publish fails with `MarketplaceManifestInvalid … unknown field(s)`. A versioned
`endpoints[]` binding (stack artifact, domain parameter, base path, mapping
logical ID, URL output) is a future target that first requires a Build schema
change, then coordinated Marketplace and Deploy migration.

Until then, validate endpoint agreement in product tests and the stack: the
`SharedApiDomainName` parameter, the mapping logical ID, its base path matching
the manifest `base_path`, and the URL output. Reject conditional attachment
bypasses. Do not infer that an API is absent solely because its manifest omitted
`base_path`.

Reuse or implement a shared CDK attachment helper that accepts the domain token,
product base path and product API/stage, creates the native mapping and emits the
URL output. Keep the helper in the verified shared CDK package;
do not invent a published package or require synth-time AWS lookups. Use native
CloudFormation mappings rather than per-product custom-resource Lambdas.

For an HTTP API, use this pattern inside the product stack (with product-owned
`api` and `apiStage` already defined):

```ts
import { CfnOutput, CfnParameter } from "aws-cdk-lib";
import { CfnApiMapping } from "aws-cdk-lib/aws-apigatewayv2";

const domain = new CfnParameter(this, "SharedApiDomainName", {
  type: "String",
  minLength: 1,
});
const mapping = new CfnApiMapping(this, "SharedApiMapping", {
  domainName: domain.valueAsString,
  apiId: api.apiId,
  stage: apiStage.stageName,
  apiMappingKey: "persist",
});
mapping.node.addDependency(apiStage);
new CfnOutput(this, "ProductApiUrl", {
  value: `https://${domain.valueAsString}/persist`,
});
```

For a REST API, use `aws_apigateway.CfnBasePathMapping` with `domainName`,
`basePath`, `restApiId` and the product stage, including its creation dependency.
An API Gateway stage is an AWS resource, not a kit deployment-stage selector.
Use the same templates, parameters and logical IDs for direct and bundle installs.

## Build, review and installation

1. Build/Tinkaton validates the closed manifest schema, `base_path` and
   `requires.domain` during credentialless synthesis/assembly validation and
   covers them with artifact integrity checks. Do not resolve target domains or
   call configuration APIs during builds.
2. Marketplace/Regigigas preserves and reviews the exact immutable artifact in
   its review environment (below). Do not rewrite bundles or borrow production
   domains for review.
3. Deploy/Corviknight reads `/account/env-parameters` for the verified target
   account/region and binds `domain.fqdn` to `SharedApiDomainName`. Reject caller
   overrides of `SharedApiDomainName`. Reject unavailable or incompatible domains
   and unsupported schema versions before product writes. Resolve existing stack
   ownership before accepting an existing mapping as its own.
4. Check path claims and serialize competing attachment operations using supported
   orchestration. Do not treat a preflight read as an atomic reservation. Preserve
   existing foreign mappings; reconcile concurrent CloudFormation conflicts without
   deleting or adopting the winner. Keep durable subscriptions/installation state
   in Puller, not a new deployment database in the stateless run API.
5. Deploy the unchanged assembly and read back mapping domain, base path, API and
   stage after terminal stack success. Only then report `attachmentReady` and let
   Puller advance installed identity. Preserve previous identity on failed updates
   and reconcile partial effects before retrying.
6. Report domain-resource readiness, attachment readiness, DNS configuration and
   observed reachability separately; report reachability `UNVERIFIED` until
   traffic is tested. Missing optional DNS traffic records must not fail domain or
   mapping acceptance. Neither a URL output nor mapping read-back proves public
   reachability. Test API behavior through a supported reachable endpoint
   and test custom-domain traffic when routing exists; preserve API authentication.
7. Delete only the product-owned mapping on product retirement. Preserve the shared
   domain, certificate, DNS and sibling mappings. Do not silently disable the direct
   execute-api endpoint as part of this contract.

Use Metang, Registeel and Skarmory to exercise their existing service capabilities;
route schema, validation or execution gaps to their respective builders. Do not
claim older deployed behavior or deferred custom-domain work meets this contract.

## Review environment

Marketplace review installs products in sandbox account `257779860257` and sends
only `product`, `artifact_url` and `target`, with no CloudFormation parameters.
A product requiring `SharedApiDomainName` fails review (`The following
CloudFormation Parameters are missing a value: SharedApiDomainName`) unless the
sandbox has an Environment-owned shared domain and `/account/env-parameters` and
the installing Deploy binds it. Bootstrap the shared domain in the review sandbox
through Environment shared-routing before publishing domain-required products.
Do not pass `SharedApiDomainName` from Marketplace; Deploy rejects caller overrides.
The review sandbox is registered as Account identity
`413b7b04-db48-49f2-a044-408170dc5976`. Verified 2026-10-13: it has the
Environment shared domain `review-sandbox.account.prismteam.ai` (REGIONAL,
TLS 1.2, AVAILABLE), populated `/account/env-parameters` and shared usage plan
`rpx73d` (`/account/shared-usage-plan-id`).

Before publishing a domain-required product, require both: the sandbox has the
Environment shared domain and `/account/env-parameters`, and the sandbox Deploy
host (`deploy-dev-*`) runs a Deploy whose TakeSource binds `SharedApiDomainName`
(prismteam-ai/deploy PR #18). Deploy's own publish then succeeded (review
`9e0a0dd0-4827-48ca-bd05-7f47a80e27bb`; mapping `/deploy` to `deploy-review-api`
stage `review`).

The sandbox holds two Deploys: the host `deploy-dev-*` and the review install
`deploy-review-*`. Do not deploy the host's deploy-api stack there directly; it
would claim the same `/deploy` path on the review domain. Update only the host's
workflow stack. Moving the host out of the sandbox is an open design decision.

## Shared API key status

API Gateway API keys and usage plans work only on REST APIs. Current state:

- Build and Marketplace require API keys on the shared usage plan.
- Environment and Model use Account's request authorizer on `x-api-key`; some
  Model routes are IAM-only.
- Deploy serves its run/Puller routes on a key API mapped at `/deploy` on the
  shared domain (prismteam-ai/deploy PR #20); Marketplace review calls it with
  `review_api_key`. Its IAM APIs remain for SigV4 callers.
- Transform, Connect and System are IAM SigV4 only.
- Persist is an HTTP API with an IAM authorizer. HTTP APIs have no usage plans;
  add a Lambda authorizer on `x-api-key` via Account.
- Configuration bundles (SmsSendFlow, SmsInterproseFork, TransformConfiguration)
  expose no API and are exempt.

Verify the target revision before assuming key support.

### Publish readiness gate

An API product is not publish-ready unless every customer-facing API method
accepts the environment's single shared key on the `x-api-key` header through:

1. REST methods with `apiKeyRequired: true` and the stage attached to the shared
   usage plan read from `/account/shared-usage-plan-id` (deploy-time or runtime
   attachment, like Build/Marketplace), or
2. Account's request authorizer on `x-api-key` (like Environment/Model).

HTTP APIs need a Lambda authorizer that validates `x-api-key` with Account. Keep
IAM SigV4 only for service-to-service/internal routes, never as the only customer
path. Configuration bundles are exempt. Registeel checks this with the shared-domain
readiness (`base_path`, `requires.domain: true`, `SharedApiMapping`) from the
synthesized template/source revision and reports failures as not ready. Route
implementation to the product builder (Corviknight, Kecleon, Lapras, Zygarde,
Conkeldurr, or Dialga for IAM-only Model routes); never publish anyway.

## Acceptance within the relevant feature

- Install two products with distinct paths against one domain with no traffic DNS;
  require both mappings and explicit unverified public reachability.
- Reject missing/unavailable domain, wrong account/region, a caller
  `SharedApiDomainName` override, a base path disagreeing with the mapping and a
  missing or conditional mapping before successful installation.
- Reject duplicate/unauthorized path claims; exercise concurrent claims and preserve
  the successful owner without overwriting its mapping.
- Repeat installation and update a directly deployed product through Deploy;
  preserve stack identity, stable mapping identity and sibling resources.
- Exercise failed update, interrupted response and retry without false readiness
  or advancing installed identity prematurely.
- Remove one product and verify its mapping is gone while shared resources and
  the other product's mapping remain. Then configure optional DNS and verify
  custom-domain traffic separately.
- Exercise first-install Bootstrap with no Environment/Deploy endpoint and verify
  the resulting metadata/API read-back after startup.

Keep local fixture checks, CDK synthesis, deployed mapping inspection and actual
HTTP reachability as separate evidence. Verify native mapping details against
[AWS API mappings](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-mappings.html)
and [CDK REST mapping properties](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.CfnBasePathMappingProps.html).
