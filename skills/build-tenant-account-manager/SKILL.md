---
name: build-tenant-account-manager
description: "Implementing or changing the Account service from its PRD — customer identity, credentials, tenant provisioning, domains, bootstrap manifest. Read reference/PRD.md first."
disable-model-invocation: true
---

# Build Tenant Account Manager

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Bootstrap, Marketplace, Deployer, and Puller PRDs whenever Account work touches tenant activation, bootstrap manifests, service keys, or downstream product installation.

## Product ownership

Use the catalog in [guide-product-work](../guide-product-work/SKILL.md).
Account implementation has no separately assigned agent in this kit. Execute this supporting
skill directly only within the requested scope. Do not assign this work to
Conkeldurr (Persist) or Zygarde (System), and do not call retired specialists.
Use relevant supporting skills directly. Use Registeel only for current
Marketplace publication and Regigigas for Marketplace implementation changes.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Account deployment, integrate through the PRD's public API, auth, and bootstrap-manifest contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
