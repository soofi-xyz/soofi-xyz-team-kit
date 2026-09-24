---
name: build-system-product
description: "Compose Products into a Prism System via a versioned composition manifest and reviewable Lexicon/Connect/Transform/Deploy emit artifacts. Use with zygarde for business outcomes; does not implement Connect or Transform engines or ship a System runtime."
---

# Build System Product

Use `zygarde` for System composition. A System is a versioned composition of
Products that delivers one business outcome. Agents configure; Products execute.
This skill contains instructions, contracts, and examples only. Implement any
System package code in the user's target repository when they request that build.

## Read by task

1. Read [the product contract](reference/PRD.md) for ownership, Priority 4
   placement, and non-goals.
2. Read [contracts](reference/contracts.md) and validate against
   [composition.manifest.schema.json](reference/composition.manifest.schema.json).
3. For a new System package in a target repo, follow
   [from-scratch](reference/from-scratch.md) and
   [emit-contracts](reference/emit-contracts.md).
4. Use [worked-example-sale-availability](reference/worked-example-sale-availability.md)
   and [examples/sale-availability.system.manifest.json](reference/examples/sale-availability.system.manifest.json)
   as a skeleton only — not a claim that `elephant-xyz/system` exists.

## Keep shared skills

- Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md) for
  TypeScript control planes, CDK posture, quality checks, and telemetry.
- Use [Lexicon](../build-lexicon-product/SKILL.md) via Conkeldurr for governed
  language/mapping publication (Unown in Elephant AGENTS naming).
- Use [Connect ingestion](../build-connect-product/SKILL.md) via Lapras for
  registered source acquisition and checkpoints.
- Use [Transform](../build-transform-product/SKILL.md) via Kecleon for
  from/to language translation.
- Use Conkeldurr platform skills for Deploy / inactive activation defaults.
- Use [batch workflows](../build-batch-workflows/SKILL.md) when admission and
  distributed map capacity are part of the composition.

## Invariants

- **System composes; it does not replace Products.** Never reimplement Connect
  adapters or Transform Glue engines inside a System package.
- **Agents configure; runtimes are Product or System.** Zygarde emits manifests
  and config refs; Lapras/Kecleon/Conkeldurr implement product code.
- **Pin configuration.** Fail unknown products, missing `configRefs`, or
  unversioned manifests. Default `contractVersion` is `1` for this skill.
- **Prefer curated artifacts over scrape-on-request** for lookup outcomes unless
  an implemented Connect adapter and explicit requirement say otherwise.
- **Do not claim** a live System product, marketplace registration, or AWS pilot
  readiness from this skill alone.

Return composition artifacts and evidence levels separately: manifest validity,
emit completeness, product implementation status, and deployment status.
