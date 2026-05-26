---
name: build-connect-service
description: "Use when implementing or changing the Connect service from its PRD: partner integrations, flow specs, credentials and tokens, webhooks, static IP, SFTP, batch executions, and connector job APIs. Read reference/PRD.md first; combine with conkeldurr, machamp, and apply-engineering-guidelines."
---

# Build Connect Service

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read [`../build-inbound-sftp-workflows/SKILL.md`](../build-inbound-sftp-workflows/SKILL.md) whenever the PRD task touches SFTP polling, Transfer Family connectors, or partner file intake.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `machamp` for Step Functions, Distributed Map, batch executions, cost gates, throttling, idempotency, and workflow verification.
- Use `regigigas` only when Connect must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, flow-spec primitives, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Connect deployment, author flows or integrate through the PRD's public API and webhook contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
