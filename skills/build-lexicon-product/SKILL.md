---
name: build-lexicon-product
description: "Build or maintain the Model HTTP API and its vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations, metric definitions and versioned releases. Use Dialga; use Jirachi for existing-service configuration."
disable-model-invocation: true
---

# Build Model

Use `dialga`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Model capability map](../guide-product-work/reference/iterations/model.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `jirachi` with [configure-model-product](../configure-model-product/SKILL.md)
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

Deliver the Model HTTP API while preserving verified Lexicon S3/SSM consumer contracts and release identifiers. Existing artifact/UI surfaces do not prove an API exists. Keep canonical changes reviewed and versioned: API operations may submit/validate candidates and initiate approved publication but must not silently mutate canonical artifacts or bypass source review. Preserve immutable facts, property/index distinctions and consumer compatibility.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

## Own business and financial metric contracts

Dialga owns the detailed Model architecture for business-metric definitions and
catalogs. Read and maintain
[the business and financial metric catalog contract](reference/business-financial-metric-catalogs.md)
before changing metric support. Keep it aligned with pinned, inspected revisions
of `prismteam-ai/model`, `Spring-Oaks-Capital-LLC/lexicon` and
`Spring-Oaks-Capital-LLC/persist`; never promote a revision-specific count,
release ID or digest into a durable contract.

Implement Model API, composition validation, lifecycle and catalog-reference
support in `prismteam-ai/model`. When a definition or family needs semantics that
the current payment package does not express, coordinate its canonical source,
validator/generator and immutable release changes in Lexicon. When execution
requires consumer support, coordinate Persist's closed definitions, compiler,
materialization and activation compatibility. Do not move these architecture
decisions into Jirachi prompts or confuse business definitions with platform
telemetry.

Jirachi receives KPI intent, suggests metrics derived from the governed Model
vocabulary, reads the contracts Dialga defines, classifies reuse versus supported
configuration versus a product gap, and applies only existing
supported configuration through a discovered Model adapter. A new shape,
family or runtime behavior, including a Model-derived new-family proposal,
returns to Dialga.

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
