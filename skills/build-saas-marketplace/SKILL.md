---
name: build-saas-marketplace
description: "Use when implementing or changing the Marketplace service from its PRD: catalog, component bundles, releases, rollbacks, subscriptions, signed webhooks, review/status flows, and marketplace settings. Read reference/PRD.md first; combine with conkeldurr, regigigas, and apply-engineering-guidelines."
---

# Build SaaS Marketplace

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. If the request touches Account, Bootstrap, Deployer, Puller, Persist, or Connect, read that product's skill and PRD too.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` for marketplace architecture, tenant account boundaries, component distribution, subscription flows, and cross-product sequencing.
- Use `machamp` only when the PRD work adds or changes batch, Distributed Map, or Glue-style workflows.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Marketplace deployment, integrate through the PRD's public API and webhook contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
