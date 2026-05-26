---
name: build-marketplace-puller
description: "Use when implementing or changing the Marketplace Puller service from its PRD: tenant-side subscription intake, marketplace webhooks, desired-state reconciliation, dependency subscriptions, drift repair, and deployer handoff. Read reference/PRD.md first; combine with conkeldurr, regigigas, and apply-engineering-guidelines."
---

# Build Marketplace Puller

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Marketplace and Deployer PRDs whenever Puller work touches subscriptions, bundle discovery, deployment callbacks, dependency deployment, or reconciliation.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` for marketplace ecosystem sequencing, tenant rollout, subscription semantics, and cross-product responsibilities.
- Use `machamp` only when the PRD work adds or changes batch, scheduler, or workflow orchestration concerns.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, data contracts, resource shapes, IAM scopes, env vars, error tags, webhook handling, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Puller deployment, integrate through the PRD's public API, webhook, and reconciliation contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
