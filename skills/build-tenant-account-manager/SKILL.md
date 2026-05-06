---
name: build-tenant-account-manager
description: "Use when implementing or changing the Account service from its PRD: customer and organization identity, API keys, AWS sub-account provisioning, DNS configuration, bootstrap manifest, and maintenance access. Read reference/PRD.md first; combine with conkeldurr, regigigas, and apply-engineering-guidelines."
---

# Build Tenant Account Manager

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Bootstrap, Marketplace, Deployer, and Puller PRDs whenever Account work touches tenant activation, bootstrap manifests, service keys, or downstream product installation.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` for marketplace tenant lifecycle, account-per-environment architecture, bootstrap sequencing, and cross-product responsibilities.
- Use `machamp` only when the PRD work adds or changes long-running account-provisioning workflows or batch-style orchestration.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Account deployment, integrate through the PRD's public API, auth, and bootstrap-manifest contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
