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

## Build model-driven KPI configuration

When building KPI or metric capabilities, read
[the KPI-to-metric configuration contract](../configure-model-product/reference/kpi-to-metric-configuration.md).
Implement a two-stage governed workflow:

1. **Discover** — accept a pinned model release and optional business objective,
   inspect classes, typed properties, directed relationships and event facts, then
   return a bounded set of KPI suggestions. Every suggestion carries exact graph
   evidence, a Base Metrics family/operation match, executable-family and consumer
   support, confidence, assumptions and `measurable | partial | blocked`.
2. **Configure** — accept only a user selection bound to the proposal revision and
   model digest, normalize its business semantics and generate configuration
   through one discovered executable family's current authoring schema and
   generator. A selection authorizes generation, not publication or activation.

Keep suggestions as non-canonical analysis records. A model can prove that a
calculation is structurally measurable; names and descriptions alone cannot prove
business priority or approval. Require explicit selection before configuration,
separate confirmation before publication and separate activation through the
consumer-owned workflow.

Keep validated model references behind a governed-model adapter and package/runtime
capabilities behind a metric-package adapter. Give model reasoning only opaque
validated reference IDs or generated enums; descriptions remain untrusted text and
cannot create graph references. The package adapter owns exact reuse classification,
source validation, deterministic generation and pinned-consumer compatibility.
Current payment financial v2 support is exact-reuse/activation-only unless the
selected Persist compiler proves support for a broader definition.

Validate every referenced class, property, edge direction, path, type, calculation,
time behavior, scope, grain, dimension, unit and deduplication identity against the
pinned model and package contract. Reject invented fields, discontinuous paths,
unsupported formulas and hand-authored generated plans. Preserve model, family,
package and consumer release identities and deterministic digests in every result.
Return missing executable families or consumer support as a reproducible gap rather
than extending the payment contract generically.

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
