---
name: configure-system-product
description: "Compose and test a business outcome as configuration of the existing System framework. Use Celebi for definitions, templates, flows, waterfalls and invocations; use Zygarde for framework changes."
---

Use [the System capability map](../guide-product-work/reference/iterations/system.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure System

Use `celebi`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Read [the System scope](../build-system-product/reference/PRD.md),
[composition contracts](../build-system-product/reference/contracts.md) and
[emit shapes](../build-system-product/reference/emit-contracts.md).

1. Discover the System deployment, target revision, outcome and available leaf
   products. System is the current product; historical Product names in wire
   fields are compatibility details. Do not default to a separate Product service.
2. Explain the composition with a small diagram and input/output example. Use
   [mock scenarios](../build-system-product/reference/mock-scenarios.md) to guide
   the person through invocation and Step Functions inspection.
3. Emit definition, schemas, reusable template, template-backed flow, optional
   waterfall and invocation fixtures. Produce a version 2 composition manifest
   and pin referenced artifacts. Use the target service's supported payloads.
4. Use `wingull`, `silvally`, `uxie` and `meditite` for leaf configuration. An
   unassigned product is a dependency gap, not permission to invent an owner.
5. Run `python3 scripts/check-system-manifest.py <manifest>` from the kit, then
   exercise the configuration on the actual System framework with mocked leaves.
   Keep schema validity, local fixture checks and AWS execution evidence separate.
6. Record the person's observations and expected/actual results. Introduce real
   leaf services only after mock acceptance and within existing authorization.
   Route framework gaps to `zygarde`; do not build an alternative pipeline.

Return the composition, versions, validated files, actual scenario results,
learning stage, unresolved dependencies and readiness for real integration.
