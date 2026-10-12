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
- Publish versioned non-secret metadata: contract version, account ID, region,
  domain name, endpoint type, domain status and DNS configuration status. Expose
  supported API read-back and preserve verified SSM compatibility outputs. Include
  alias target/hosted-zone data only where DNS configuration needs it; mappings
  need the domain name, not certificate management permissions.
- Prepare shared-domain resources before the first API product installation.
  Before service APIs exist, use Environment's authorized Bootstrap adapter and
  shared execution logic to create/adopt prerequisites and pass the same resolved
  parameters into the first Deploy install. Adopt/read back non-secret results
  through Environment once available. Do not require Environment's own API to be
  running before creating its domain or introduce a second deployment engine.

## Bundle and CDK boundary

Use CloudFormation parameters for environment-dependent attachment values. Require
`SharedApiDomainName` as a nonempty string without a default for new integrations.
Preserve existing parameter names through an explicit verified binding when
migrating; do not rename stack resources or rewrite an immutable assembly.
Keep the base path a stable product declaration without a leading/trailing slash;
reject empty/root claims and duplicate paths. Do not derive it from bundle version
or a deployment-stage selector. Preserve an existing verified path during adoption.

Extend the existing `marketplace.product.json` declarative manifest, retaining
`base_path` and `requires.domain: true`. Use the following versioned endpoint
binding shape as the target contract; migrate consumers together before use:

```json
{
  "base_path": "persist",
  "requires": { "domain": true },
  "endpoint_contract_version": "1",
  "endpoints": [
    {
      "stack_artifact_id": "PersistApi",
      "domain_parameter": "SharedApiDomainName",
      "base_path": "persist",
      "mapping_logical_id": "SharedApiMapping",
      "url_output": "ProductApiUrl"
    }
  ]
}
```

Keep other existing manifest fields. For multiple endpoints, declare every mapping
and its unique path; keep the legacy `base_path` consistent with the primary
endpoint. Validate that stack artifact, parameter, mapping logical ID and output
exist and agree with the template. Reject conditional attachment bypasses and
API-bearing bundles that omit endpoint declarations. Do not infer that an API is
absent solely because its manifest omitted `base_path`.

Reuse or implement a shared CDK attachment helper that accepts the domain token,
product base path and product API/stage, creates the native mapping and emits the
endpoint binding/output. Keep the helper in the verified shared CDK package;
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

1. Build/Tinkaton validates manifest/template agreement and required mappings
   during credentialless synthesis/assembly validation. Preserve endpoint bindings
   in the sanitized deployment manifest and cover them with artifact integrity
   checks. Do not resolve target domains or call configuration APIs during builds.
2. Marketplace/Regigigas preserves and reviews the exact immutable artifact with
   compatible review-owned domain prerequisites. Supply review parameter values;
   do not rewrite bundles or borrow production domains for review.
3. Deploy/Corviknight resolves authenticated Environment metadata for the verified
   target account/region and passes the bound domain as a CloudFormation parameter.
   Keep caller values from overriding the verified domain. Reject unavailable or
   incompatible domains and unsupported contract versions before product writes.
   Resolve existing stack ownership before accepting an existing mapping as its own.
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
   observed reachability separately. Missing optional DNS traffic records must not
   fail domain or mapping acceptance. A URL output is a declared address, not proof
   of public reachability. Test API behavior through a supported reachable endpoint
   and test custom-domain traffic when routing exists; preserve API authentication.
7. Delete only the product-owned mapping on product retirement. Preserve the shared
   domain, certificate, DNS and sibling mappings. Do not silently disable the direct
   execute-api endpoint as part of this contract.

Use Metang, Registeel and Skarmory to exercise their existing service capabilities;
route schema, validation or execution gaps to their respective builders. Do not
claim older deployed behavior or deferred custom-domain work meets this contract.

## Acceptance within the relevant feature

- Install two products with distinct paths against one domain with no traffic DNS;
  require both mappings and explicit unverified public reachability.
- Reject missing/unavailable domain, wrong account/region, inconsistent endpoint
  metadata and a missing or conditional mapping before successful installation.
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
