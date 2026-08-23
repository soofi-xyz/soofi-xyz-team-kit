---
name: build-product-service
description: "Implement or change the Product service from its PRD — products, schemas, flows, invocations, waterfalls, reports, widgets, telemetry. Read reference/PRD.md first."
disable-model-invocation: true
---

# Build Product Service

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read Connect, Translate, Persist, Marketplace, and Deployer PRDs whenever Product work touches partner flow calls, translation, graph persistence, catalog validation, or marketplace deployment.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `machamp` for Product Flow Template compilation, Step Functions workflows, reports, waterfalls, retries, idempotency, and workflow verification.
- Use `regigigas` only when Product must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, template contracts, product-flow contracts, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Product deployment, integrate through the PRD's public API, webhook, widget, report, SMS, email, and invocation contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
