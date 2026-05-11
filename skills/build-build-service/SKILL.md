---
name: build-build-service
description: "Use when implementing or changing the Build service from its PRD: TypeScript CDK source intake, CodeBuild synth and validation, CDK cloud assembly artifacts, artifact provenance, build manifests, and marketplace-ready bundle outputs. Read reference/PRD.md first; combine with conkeldurr, regigigas, machamp, and apply-engineering-guidelines."
---

# Build Build Service

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read Marketplace and Deployer PRDs whenever Build work touches bundle provenance, release review, artifact consumption, deployer contracts, or CDK cloud assembly deployment.

## Use With Plugin Agents

- Use `conkeldurr` first for platform product classification, existing-deployment checks, and build-vs-integrate decisions.
- Use `regigigas` when Build artifacts must be registered, reviewed, released, subscribed, or deployed through the marketplace ecosystem.
- Use `machamp` for CodeBuild workflows, validation gates, artifact publishing, cost controls, throttling, idempotency, and workflow verification.

## Implementation Rules

- Treat the PRD as the single source of truth for source intake, build jobs, artifact contracts, manifest fields, validation rules, resource shapes, IAM scopes, env vars, error tags, workflows, and verification.
- Do not implement from this `SKILL.md` alone.
- For an existing Build deployment, integrate through the PRD's public API and artifact contracts instead of provisioning a duplicate service.
- If any old skill or rule file conflicts with the PRD, the PRD wins; update stale guidance instead of layering compatibility shims.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
