---
name: build-product-deployer
description: "Build or maintain the stateless Deploy run service, Build artifact integration and run-status inspection. Read reference/PRD.md and verify the target service contract first."
disable-model-invocation: true
---

# Build Deploy

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Marketplace and Puller PRDs when work touches artifact publication or subscriber installation state. Verify their supported integration with the target Deploy service.

## Product ownership

Use the catalog in [guide-product-work](../guide-product-work/SKILL.md).
Deploy has no separately assigned agent in this kit. Execute this supporting
skill directly only within the requested scope. Do not assign this work to
Conkeldurr (Persist) or Zygarde (System).
Use relevant supporting skills directly. Use Registeel only for current
Marketplace publication and Regigigas for Marketplace implementation changes.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, bundle contracts, resource shapes, IAM scopes, env vars, error tags, workflows, callbacks, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Deploy service, verify and use its run/status contract instead of provisioning a duplicate service.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
