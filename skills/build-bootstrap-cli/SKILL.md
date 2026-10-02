---
name: build-bootstrap-cli
description: "Build or maintain the Environment HTTP API and its environment plans, Account manifest intake, shared API routing, initial Deploy installation, subscriber handoff and resumable readiness checks. Use Torterra; use Shaymin for existing-service configuration."
disable-model-invocation: true
---

# Build Environment

Use `torterra`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Environment capability map](../guide-product-work/reference/iterations/environment.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `shaymin` with [configure-environment-product](../configure-environment-product/SKILL.md)
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

Preserve the cold-start path: an operator-run Bootstrap adapter may perform the first Deploy install before any service endpoint exists. Make the Environment HTTP API the product surface for plan, submission, status and results; the CLI shares execution logic. Identify missing API capabilities as builder work, not an assumed deployed route. Never persist API keys, AWS credentials or signed bundle URLs in resume state.

Keep identity, underlying AWS account provisioning, DNS/certificate inventory and service keys with Account. Consume Marketplace bundles and let Deploy execute product installations after its first install. Treat Bootstrap as an Environment adapter, not another product. Install Deploy's Puller component and hand ongoing subscriptions, polling and recovery to Corviknight/Skarmory; Environment does not implement those subscriber capabilities.

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
