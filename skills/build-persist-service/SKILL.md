---
name: build-persist-service
description: "Use when implementing or changing the Persist service from its PRD: Neptune-backed graph persistence, Persist Blobs, GraphSON ingest, lexicon validation, deterministic IDs, Neptune CSV bulk load, and Gremlin query APIs. Read reference/PRD.md first; combine with conkeldurr, machamp, and apply-engineering-guidelines."
---

# Build Persist Service

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read lexicon skills when the PRD task changes graph schema validation, vertex/edge contracts, properties, enums, or immutability rules.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `machamp` for the Neptune CSV workflow, async processing, cost gates, throttling, idempotency, and workflow verification.
- Use `regigigas` only when Persist must be packaged, released, subscribed, or deployed through the marketplace ecosystem.

## Implementation Rules

- Treat the PRD as the single source of truth for routes, GraphSON contracts, Persist Blob handling, data contracts, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Persist deployment, integrate through the PRD's `/persist/*` API contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
