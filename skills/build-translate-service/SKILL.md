---
name: build-translate-service
description: "Use when implementing or changing the Translate service from its PRD: registered partner languages, versioned TypeScript mappings, validation, preview, asynchronous translation executions, mapping packs, and execution telemetry. Read reference/PRD.md first; combine with conkeldurr, machamp, and apply-engineering-guidelines."
---

# Build Translate Service

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read Marketplace and Deployer PRDs whenever Translate work touches runtime service bundles, mapping-pack `DATA` components, releases, subscriptions, or deployment context.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `machamp` for Step Functions workflows, execution telemetry, cost gates, throttling, idempotency, and workflow verification.
- Use `regigigas` only when Translate or mapping packs must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, language and mapping contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Translate deployment, integrate through the PRD's `/translate/*` API contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
