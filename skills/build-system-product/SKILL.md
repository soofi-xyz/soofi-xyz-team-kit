---
name: build-system-product
description: "Build or extend the Product-derived TypeScript/AWS CDK System service and its versioned configurations: schemas, flow templates, flows, waterfalls, invocations, and leaf-product references. Use with zygarde."
---

# Build System Product

Use `zygarde` to build the **System service** and author configurations hosted
by it. System is the TypeScript/AWS CDK successor to the core orchestration
behavior in [StaircaseAPI/product](https://github.com/StaircaseAPI/product):
named Products, JSON Schemas, Product Flow Templates compiled to Step
Functions, template-backed Product Flows, waterfalls, and invocations.

Staircase Product is behavioral evidence. Do not copy its Python/Serverless
packaging or its legacy default connector pipeline. Build the target with
TypeScript, AWS CDK v2, Node.js Lambda, and a `/system` API.

## Read by task

1. Read [the System contract](reference/PRD.md) before planning service code.
2. Read [runtime mapping](reference/product-runtime.md) and
   [implementation evidence](reference/implementation-evidence.md) before
   translating Staircase behavior.
3. Read [contracts](reference/contracts.md) and validate against
   [composition.manifest.schema.json](reference/composition.manifest.schema.json).
4. Follow [from-scratch](reference/from-scratch.md) for repository scaffolding
   and [emit-contracts](reference/emit-contracts.md) for configuration paths.
5. Use [worked-example-sale-availability](reference/worked-example-sale-availability.md)
   and [examples/sale-availability/](reference/examples/sale-availability/)
   (manifest + emits) as a skeleton only.
6. Check every manifest with
   `skills/build-system-product/scripts/validate-manifest.py` and
   `scripts/check-system-manifest.py` before handing emits to other agents.

## Build sequence

1. Classify the task as base service, configuration, or both.
2. For base service work, create ordered `SystemDataStack`,
   `SystemWorkflowStack`, and `SystemApiStack`.
3. Implement Product definitions/schemas, Flow Template upsert and compile,
   template-backed Product Flows, waterfall ordering, invocation start/status,
   correlation, and callbacks.
4. Load checked-in `configurations/<id>/` bundles, validate them before synth,
   seed them idempotently, and keep activation false by default.
5. Verify format, lint, types, tests, strict CDK synth, and manifest validation.

## Invariants

- **System is the runtime.** Do not require a separate Product deployment and
  do not delegate System platform internals to another agent.
- **Template-backed flows only** — every executable Product Flow references a
  Flow Template (`flow_template_name`). Do not revive the legacy default
  connector pipeline.
- **Three-stack boundary** — data first, workflows second, API last. Keep stack
  dependencies explicit and keep unrelated optional routes isolated.
- **System composes; leaf Products execute.** Keep Connect adapters, Transform
  jobs, Lexicon publication, Persist storage, and Deploy control planes out of
  System.
- **Pin configuration.** Fail unknown products, missing `configRefs`, or
  unversioned manifests. `contractVersion` is `1`.
- **Secure defaults.** Encrypt retained data, enable PITR, use TTL for
  idempotency/status records, require API keys, and grant least privilege.
- **Cross-service calls** use relative platform URLs with correlation ids; do
  not embed hostnames, API keys, account ids, or developer AWS profiles.
- **Evidence is explicit.** Report spec, synth, deployed, and live separately.

Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md). Use
[Lexicon](../build-lexicon-product/SKILL.md),
[Connect](../build-connect-product/SKILL.md), and
[Transform](../build-transform-product/SKILL.md) for leaf contracts. Use
[batch workflows](../build-batch-workflows/SKILL.md) only when capacity sits
outside System waterfalls. Use Regigigas only when Marketplace packaging is
explicitly requested.

Return changed paths, stack topology, configuration ids, manifest validation,
test/synth results, deferred leaf work, and the achieved evidence level.
