---
name: build-product-deployer
description: "Use when implementing or changing the Deployer service from its PRD: tenant-local CloudFormation/CDK deployment execution, bundle contracts, regional stack orchestration, Docker image handling, callbacks, and status inspection. Read reference/PRD.md first; combine with conkeldurr, regigigas, and apply-engineering-guidelines."
---

# Build Product Deployer

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Bootstrap, Marketplace, and Puller PRDs whenever Deployer work touches first install, deploy-by-token, subscription-triggered deploys, or terminal callbacks.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` for marketplace deployment architecture, bundle distribution, tenant rollout, and cross-product sequencing.
- Use `machamp` when the PRD work changes Step Functions orchestration, long-running operations, retries, or concurrency controls.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, bundle contracts, resource shapes, IAM scopes, env vars, error tags, workflows, callbacks, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Deployer deployment, integrate through the PRD's public API and callback/status contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
