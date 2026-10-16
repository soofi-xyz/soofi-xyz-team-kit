---
name: build-system-product
description: "Build or maintain the System orchestration framework with TypeScript, CDK and Step Functions. Use Zygarde for runtime changes and a guided mock-first build; use Celebi for outcome configuration."
---

Use [the System capability map](../guide-product-work/reference/iterations/system.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Build System

Use `zygarde` to build the reusable **System** service. Use `celebi` with
[configure-system-product](../configure-system-product/SKILL.md) for a business
outcome on an existing deployment. Follow
[guide-product-work](../guide-product-work/SKILL.md) for interactive stages.

## Read by task

1. Read [current scope](reference/PRD.md) and [runtime mapping](reference/product-runtime.md).
2. For a new build, follow [the staged build](reference/from-scratch.md) and
   [three mock scenarios](reference/mock-scenarios.md).
3. For fixtures and configurations, use [contracts](reference/contracts.md),
   [emit shapes](reference/emit-contracts.md) and the version 2
   [manifest schema](reference/composition.manifest.schema.json).
4. Use [sale availability](reference/worked-example-sale-availability.md) as a
   configuration example, not a statement of deployment or product readiness.
5. Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md).

## Ownership

Build System's definitions, schemas, flow-template compiler, template-backed
flows, waterfalls, invocations, correlation, retries and telemetry. Use the
current `/system` runtime; do not require a second historical Product service.
Every executable flow names a template. Do not port the historical reports,
SMS/email, blobs, widgets, short links, partner ordering or marketplace packaging.

Compose leaf products through their supported boundaries. Keep Connect with
Lapras/Wingull, Transform with Kecleon/Silvally, Persist with Conkeldurr/Uxie and
Rule with Gallade/Meditite. Resolve other ownership from the product catalog.
Use retained specialists for supporting work without reassigning product ownership.
Never invent leaf engines inside System.

## Acceptance

Derive usable feature increments from the System capability map and the requested
scope. Keep template invocation, binding reuse, sequencing, branching, retry
policy, waterfalls and lifecycle behavior separately inspectable where selected.
Split further by complexity; do not force every outcome into the same count.
For each piece, demonstrate relevant mock behavior, implement only that increment,
and have the person run its framework configuration and inspect execution/logs.
Wait for their observation before implementing the next piece. Use the scenario
pack where applicable and add tests for uncovered capabilities. Four fixture
configurations are examples, not four implementation stages or full coverage of
all System features. Rerun cumulative acceptance for the entire selected scope.
Add real integrations only after mock acceptance within scope.

Run `python3 scripts/check-system-manifest.py` for artifact validation. This
checks configuration structure only. Do not treat it as a runtime test or count
unexecuted/deferred scenarios as acceptance. Build product code in the target
repository; this kit supplies the workflow, contracts and test scenarios.

Return framework changes, test results, progress through the shared stages,
observed mock acceptance, real-integration evidence and remaining gaps.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Own configuration lifecycle APIs and pinned leaf-reference validation; installing definitions must not invoke business flows.
