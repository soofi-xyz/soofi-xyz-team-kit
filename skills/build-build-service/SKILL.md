---
name: build-build-service
description: "Build or maintain the Build HTTP API and its source intake, isolated build jobs, CDK synthesis, runtime asset policy, provenance, observable results and delivery. Use Tinkaton; use Metang for existing-service configuration."
disable-model-invocation: true
---

# Build Build

Use `tinkaton`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Build capability map](../guide-product-work/reference/iterations/build.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `metang` with [configure-build-product](../configure-build-product/SKILL.md)
for operations through an existing deployment.

## Scope and contract

Read [the product contract](reference/PRD.md) and
[synthetic test data and dependency fakes](reference/test-data.md) before coding.
Discover the target repository/revision, supported contract, deployment and
selected AWS profile; verify the account and region. Record discrepancies between
the specification and observed implementation without inventing deployed routes.

Deliver an HTTP API with explicit authentication, caller/resource authorization,
request validation, correlated errors and observable results. Expose submission,
status and results for async capabilities. Reuse execution logic behind CLI,
workflow and API adapters; a direct workflow call does not complete API acceptance.
No separate API-documentation workstream is added.

Preserve Build-owned runner commands, isolated source execution and credentialless synthesis. Reject product-controlled lifecycle hooks, unsafe archive paths, forbidden lookups and leaked secrets. Emit portable CDK cloud assemblies with verified template/asset digests and minified, obfuscated, source-map-free Lambda assets as required by the verified contract.

Keep Marketplace publication/review with Regigigas/Registeel and deployment execution with Corviknight/Skarmory. A successful build proves artifact creation, not publication or installation.

## Build each feature piece

1. Select and order the capability map's logical features. Use at least four
   increments for a full-product build; scope narrow fixes to relevant pieces.
   Bring the minimal API and authorized test deployment into the first usable
   increment so the person can try it before further implementation.
2. Show the next feature with synthetic data, then implement only that piece.
   Mock external dependencies and effects first. Use the linked fixture matrix
   to test baseline, a supported variant, invalid/unauthorized input and relevant
   replay, timeout and recovery paths. Verify effects, redaction and HTTP results.
3. Make the piece runnable through the API in the authorized test environment.
   Give one invocation, expected output and at most three AWS inspection steps
   using actual resource names. Have the user run the baseline and variant and
   return request/execution IDs and observations. Wait for their evidence before
   implementing the next piece; fix a failed current check before advancing.
4. Finish selected pieces with cumulative acceptance and requested, authorized
   live dependencies. Keep local unit tests, synthesis, deployed mocked runs and
   real effects distinct. Never claim a mock dependency proves its live service.

Return changes, supported API/configuration examples, automated and user evidence,
AWS observations, cleanup and remaining gaps. Keep reusable product code in its
target repository; this kit contains guidance and synthetic inputs.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Package configuration assets and shared-provider declarations; verify digests without calling target APIs or adding per-bundle Lambdas.
