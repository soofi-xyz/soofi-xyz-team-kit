---
name: build-lexicon-product
description: "Use when implementing or changing the Lexicon product from its PRD: governed graph vocabulary, ruleset data, metric definitions, source-system mapping artifacts, S3/SSM artifact publication, and the read-only schema browser. Read reference/PRD.md first; combine with conkeldurr, unown, porygon, and apply-engineering-guidelines."
---

# Build Lexicon Product

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read lexicon, Rules, Persist, Translate, and metrics skills whenever Lexicon work touches graph ontology changes, ruleset artifacts, validation contracts, mapping artifacts, or CloudWatch metric registration.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `unown` when Lexicon work changes vertices, edges, properties, enums, formats, or immutability rules.
- Use `porygon` when Lexicon work changes metric definitions or dashboard-facing metric semantics.
- Use `regigigas` only when Lexicon must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for artifact contracts, S3 object shapes, SSM parameters, release metadata, resource shapes, IAM scopes, env vars, metrics, error tags, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Lexicon deployment, integrate through the PRD's S3/SSM artifact contract instead of provisioning a duplicate product.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
