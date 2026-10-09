---
name: build-product-deployer
description: "Build or maintain Deploy run APIs and its Puller subscriptions, polling, dependency updates, installation history and recovery. Use Corviknight; use Skarmory for existing-service configuration."
disable-model-invocation: true
---

# Build Deploy

Use `corviknight`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Deploy capability map](../guide-product-work/reference/iterations/deploy.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `skarmory` with [configure-deploy-product](../configure-deploy-product/SKILL.md)
for operations through an existing deployment.

Load [build-marketplace-puller](../build-marketplace-puller/SKILL.md) and its
[subscriber contract](../build-marketplace-puller/reference/PRD.md) for Puller work.
Include the Puller capability areas in full-product discovery and implementation;
loading only the run API contract is not a complete Deploy product plan.

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

Verify the current IAM SigV4 POST /deploy/run and status contract. Do not resurrect historical API-key token deploy, review or rollback routes. Validate artifact identity, digest, parameters and target account/region before writes. Keep bounded run diagnostics separate from subscriber installation state; do not add a deployment database merely to imitate old instructions.

Own Puller as a subscriber component of Deploy. Keep its subscriptions, polling schedules, desired state, installation history and subscription secrets separate from the stateless SigV4 run API. Packages or stacks may remain separate; both belong to Corviknight/Skarmory. Keep Marketplace on catalog/publication and Environment on first installation.

Implement Puller HTTP operations for local subscriptions, scheduled/manual
reconciliation, update control and observable installation history. Keep polling
functional with Marketplace catalog reads alone. Add publication notifications
only against a verified supported contract. Use the current run API for deployment
and status; do not implement a second CloudFormation executor in Puller.

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

Read [the shared configuration-bundle contract](reference/configuration-bundles.md) when this work involves configuration bundles.
Implement the shared provider, typed adapters and observable lifecycle; keep operation receipts separate from subscriber state.
