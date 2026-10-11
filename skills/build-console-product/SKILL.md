---
name: build-console-product
description: "Build Console Figma-to-HTML/React creation and editing with MCP, Bedrock AgentCore and the pi harness, plus its runtime and API: versioned UI schemas, safe reusable components, typed product bindings, access enforcement, independent configuration delivery and observable deployments. Use Chandelure; use Vivillon for existing-service configuration."
disable-model-invocation: true
---

# Build Console

Use `chandelure`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Console capability map](../guide-product-work/reference/iterations/console.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `vivillon` with [configure-console-product](../configure-console-product/SKILL.md)
for applications built on an existing Console deployment.

Read [component authoring and agent architecture](reference/component-authoring.md)
for every generation/editing feature. It defines the Console-specific override to
Ash, the shared Figma MCP intake and responsive verification contract.
Read [project configuration and component lifecycle](reference/product-lifecycle.md)
for persisted projects, the review workspace, asset/version management, export/PR
application, renderer promotion and production operations. Implement its HTTP
contracts and cumulative acceptance alongside the capability map.

## First step: Figma client registration

For a full build or first Figma integration, complete the [registration checkpoint](reference/component-authoring.md#first-step-register-and-verify-the-console-figma-client)
before downstream authoring work. Keep the official remote Figma MCP approach.
Reuse verified client registration on later tasks; an existing editor login is
not Console registration. If approval is pending, return the prepared registration
details and exact external dependency rather than silently switching providers.

## Scope and contract

Read [the product contract](reference/PRD.md) and
[synthetic test data and dependency fakes](reference/test-data.md) before coding.
Discover the target repository/revision, supported schema and API, deployment and
selected AWS profile; verify the account and region. Record discrepancies between
the specification and observed implementation without inventing deployed routes.

Deliver Figma-driven creation and modification of HTML or React components through
an authenticated HTTP job API, backed by Bedrock AgentCore Runtime and the pi
harness. Return reviewable source, patches, previews and test evidence. Also
deliver a reusable web runtime and authenticated configuration API. Own the
application schema, renderer shell, safe component registry, typed data/action
bindings, access enforcement, compatibility rules, independent runtime/configuration
selection, refresh/rollback behavior and telemetry. Reject arbitrary executable
configuration and fail unsupported schemas, components and bindings explicitly.

Keep Account identity and authorization, Model definitions/composition, Persist
facts/queries and System workflows with their owning products. Integrate only
through verified public contracts. Keep Build artifact creation, Marketplace
publication and Deploy installation with those products. A bespoke Model UI is a
candidate Console configuration, not the reusable Console implementation.

## Build each feature piece

1. Select and order the capability map's logical features. Use at least four
   increments for a full-product build; scope narrow fixes to relevant pieces.
   Put Figma registration first for full builds. After that checkpoint, bring
   the minimal API and authorized test runtime needed for each usable feature.
   For renderer-only work, start with a minimal schema and renderer.
2. Show the next feature with synthetic data, then implement only that piece.
   Mock upstream product APIs first. Test a baseline, a materially different
   application, invalid/unauthorized input and relevant refresh, rollback and
   recovery paths. Verify rendered behavior, API results and telemetry together.
3. Make the piece runnable in the authorized test environment. Give one invocation,
   expected output and at most three AWS inspection steps using actual resource
   names. Have the user run the baseline and variant and return redacted request
   IDs and observations. Wait for their evidence before implementing the next piece.
4. Finish selected pieces with cumulative acceptance and requested, authorized
   live dependencies. Keep local component tests, synthesis, deployed mocked
   applications and real upstream integrations as distinct evidence levels.

Return changes, supported application examples, automated and user evidence,
AWS observations, cleanup and remaining gaps. Keep reusable product code in its
target repository; this kit contains guidance, contracts and synthetic inputs.
