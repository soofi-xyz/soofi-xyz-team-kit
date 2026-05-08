---
name: build-rules-product
description: "Use when implementing or changing the Rules product from its PRD: tenant-local batch decisioning, rule contracts, Persist graph reads, callable-population outputs, audit reports, metrics, Glue preparation jobs, and Step Functions workflows. Read reference/PRD.md first; combine with conkeldurr, machamp, and apply-engineering-guidelines."
---

# Build Rules Product

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read Persist, lexicon, batch workflow, and metrics skills whenever Rules work touches graph-read contracts, ruleset definitions, Glue preparation, output datasets, or CloudWatch metric registration.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `machamp` for Step Functions, Glue Python Shell preparation jobs, batch processing, cost gates, throttling, idempotency, and workflow verification.
- Use `porygon` when Rules work changes metric definitions, reconciliation, or dashboard-facing output semantics.
- Use `regigigas` only when Rules must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for workflow inputs, rule contracts, Persist query contracts, output artifact shapes, resource shapes, IAM scopes, env vars, metrics, error tags, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Rules deployment, integrate through the PRD's Step Functions and S3 output contracts instead of provisioning a duplicate product.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
