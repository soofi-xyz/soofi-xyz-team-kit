---
name: build-system-product
description: "Author versioned System configurations for the existing prismteam-ai/system runtime: schemas, flow templates, flows, waterfalls, invocations, and leaf-product references. Use with zygarde. Do not rebuild the System service."
---

# Build System Product

Use `zygarde` to author configurations for the existing **System** runtime at
[prismteam-ai/system](https://github.com/prismteam-ai/system). System is the
TypeScript/AWS CDK successor to the core orchestration behavior in
[StaircaseAPI/product](https://github.com/StaircaseAPI/product): named
Products, JSON Schemas, Product Flow Templates compiled to Step Functions,
template-backed Product Flows, waterfalls, and invocations.

Zygarde does not run inside System and does not build or change the service.
Staircase Product is behavioral evidence. Do not copy its Python/Serverless
packaging or its legacy default connector pipeline.

## Read by task

1. Read [the System contract](reference/PRD.md) before planning a configuration.
2. Read [runtime mapping](reference/product-runtime.md) and
   [implementation evidence](reference/implementation-evidence.md) before
   translating Staircase behavior.
3. Read [contracts](reference/contracts.md) and validate against
   [composition.manifest.schema.json](reference/composition.manifest.schema.json).
4. Follow [from-scratch](reference/from-scratch.md) for a configuration package
   and [emit-contracts](reference/emit-contracts.md) for configuration paths.
5. Use [worked-example-sale-availability](reference/worked-example-sale-availability.md)
   and [examples/sale-availability/](reference/examples/sale-availability/)
   (manifest + emits) as a skeleton only.
6. Check every manifest with
   `skills/build-system-product/scripts/validate-manifest.py` and
   `scripts/check-system-manifest.py` before handing emits to other agents.

## Build sequence

1. Confirm the runtime is the existing `prismteam-ai/system` deployment. Do
   not scaffold a second System service.
2. Write `configurations/<id>/composition.manifest.json` with
   `orchestration.mode` set to `system-service` and `invocationMode` set to
   `single_flow` or `waterfall`.
3. Add the Product definition, request and response schemas, Flow Templates,
   template-backed Product Flows, an optional waterfall, and the invocation
   contract.
4. Add leaf references for every product a template calls. Keep activation
   false.
5. Validate the manifest and resolve every path before handoff.

## Invariants

- **The runtime already exists.** Configurations load into
  `prismteam-ai/system`. Do not require a separate Product deployment and do
  not rebuild System stacks, the compiler, or the API in this skill.
- **Template-backed flows only** — every executable Product Flow references a
  Flow Template (`flow_template_name`). Do not revive the legacy default
  connector pipeline.
- **System composes; leaf Products execute.** Keep Connect adapters, Transform
  jobs, Lexicon publication, Persist storage, and Deploy control planes out of
  the configuration.
- **Pin configuration.** Fail unknown products, missing `configRefs`, or
  unversioned manifests. `contractVersion` is `1`. Config ref kinds and
  `invocationMode` match the runtime schema.
- **Cross-service calls** use relative platform URLs with correlation ids; do
  not embed hostnames, API keys, account ids, or developer AWS profiles.
- **Evidence is explicit.** Report spec, deployed, and live separately. Do not
  claim synth of the System stacks from a configuration package.

Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md). Use
[Lexicon](../build-lexicon-product/SKILL.md),
[Connect](../build-connect-product/SKILL.md), and
[Transform](../build-transform-product/SKILL.md) for leaf contracts. Use
[batch workflows](../build-batch-workflows/SKILL.md) only when capacity sits
outside System waterfalls. Use Regigigas only when Marketplace packaging is
explicitly requested.

Return changed paths, configuration ids, manifest validation, deferred leaf
work, and the achieved evidence level.
