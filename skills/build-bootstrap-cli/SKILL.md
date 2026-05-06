---
name: build-bootstrap-cli
description: "Use when implementing or changing the Bootstrap CLI from its PRD: initial tenant bootstrap, Account bootstrap manifest intake, local first-Deployer install, Marketplace Puller install through Deployer, resume state, and status checks. Read reference/PRD.md first; combine with conkeldurr, regigigas, and apply-engineering-guidelines."
---

# Build Bootstrap CLI

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Account, Marketplace, Deployer, and Puller PRDs whenever Bootstrap work touches their APIs, bundles, installation handoffs, or health checks.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` for marketplace bootstrap sequencing, tenant onboarding, system-component installation order, and cross-product responsibilities.
- Use `machamp` only when the PRD work adds or changes long-running workflow orchestration outside the CLI's local resume-state model.

## Implementation Rules

- Treat the PRD as the single source of truth for commands, Account and Marketplace contracts, local install rules, state files, error tags, and verification.
- Do not implement from this `SKILL.md` alone.
- Bootstrap is a CLI artifact. Do not add hosted infrastructure unless the PRD explicitly requires it.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/contracts to change, companion agents/skills loaded, and the PRD verification path.
