---
name: build-system-product
description: "Compose a business outcome as Product configuration (schemas, flow templates, flows, waterfall, invocations) plus Lexicon/Connect/Transform/Persist emits — aligned with StaircaseAPI/product. Use with zygarde; does not implement Product or Connect/Transform engines."
---

# Build System Product

Use `zygarde` for System composition. A System is a versioned business
outcome delivered primarily by configuring the **Product** orchestration
service (named Product + schemas + flow templates + flows + optional
waterfall + invocations) so it composes leaf Products such as Lexicon,
Connect, Transform, and Persist.

This skill contains instructions, contracts, and examples only. Implement
configs and any package code in the user's target repository when they
request that build. The reference implementation is
[StaircaseAPI/product](https://github.com/StaircaseAPI/product); the
platform rebuild contract is [`build-product-service`](../build-product-service/SKILL.md).

## Read by task

1. Read [the product contract](reference/PRD.md) for ownership, Prism
   placement, and non-goals.
2. Read [Product runtime mapping](reference/product-runtime.md) and
   [implementation evidence](reference/implementation-evidence.md) before
   inventing a custom serve path.
3. Read [contracts](reference/contracts.md) and validate against
   [composition.manifest.schema.json](reference/composition.manifest.schema.json).
4. For emits into a target repo, follow [from-scratch](reference/from-scratch.md)
   and [emit-contracts](reference/emit-contracts.md).
5. Use [worked-example-sale-availability](reference/worked-example-sale-availability.md)
   and [examples/sale-availability.system.manifest.json](reference/examples/sale-availability.system.manifest.json)
   as a skeleton only.

## Keep shared skills

- Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
- Use [Product service](../build-product-service/SKILL.md) via Conkeldurr
  (Machamp for flow-template / Step Functions / waterfall verification) for
  the orchestration runtime — integrate an existing deployment before
  provisioning a duplicate.
- Use [Lexicon](../build-lexicon-product/SKILL.md),
  [Connect ingestion](../build-connect-product/SKILL.md),
  [Transform](../build-transform-product/SKILL.md), and Persist skills for
  leaf Products the flow template calls.
- Use [batch workflows](../build-batch-workflows/SKILL.md) when capacity sits
  outside Product waterfalls.
- Use Regigigas only when Marketplace packaging/subscription is requested.

## Invariants

- **Outcome unit is a Product configuration**, not a new Spark job and not
  (by default) a one-off HTTP microservice.
- **Template-backed flows only** — every executable Product Flow references a
  Flow Template (`flow_template_name`). Do not revive the legacy default
  connector pipeline.
- **System composes; leaf Products execute.** Zygarde emits manifests and
  stubs; Conkeldurr/Lapras/Kecleon/Machamp implement engines and platform.
- **Pin configuration.** Fail unknown products, missing `configRefs`, or
  unversioned manifests. `contractVersion` is `1`.
- **Cross-service calls** in templates use relative platform URLs (Connect,
  Translate/Language, Persist, nested Product) with correlation ids — not
  inlined credentials.
- **Do not claim** live Product/System readiness from this skill alone.

Return composition artifacts and evidence levels separately: manifest
validity, Product emit completeness, leaf implementation status, and live
invocation status.
