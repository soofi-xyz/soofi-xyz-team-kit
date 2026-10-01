---
name: build-marketplace-puller
description: "Implementing or changing the Marketplace Puller from its PRD — subscription intake, desired-state reconciliation, drift repair, deployer handoff. Read reference/PRD.md first."
disable-model-invocation: true
---

# Build Marketplace Puller

This skill is intentionally thin. Use it as a loader for [`reference/PRD.md`](./reference/PRD.md), not as a requirements copy.

Treat Puller as the separate subscriber-side implementation in the Marketplace/Deploy integration, not another catalog product. Preserve its installation history, desired state and keys outside the stateless Deploy run service. Verify the current subscriber contract before using detailed reference mechanics.

## Required Reading

1. Read [`reference/PRD.md`](./reference/PRD.md) before planning or coding.
2. Read [`../apply-engineering-guidelines/SKILL.md`](../apply-engineering-guidelines/SKILL.md) for Golden Path constraints.
3. Read the Marketplace and Deployer PRDs whenever Puller work touches subscriptions, bundle discovery, deployment callbacks, dependency deployment, or reconciliation.

## Product ownership

Use the catalog in [guide-product-work](../guide-product-work/SKILL.md).
Route Marketplace catalog/publication contracts to Regigigas/Registeel and Deploy
run integration to Corviknight/Skarmory. Use Torterra/Shaymin for the Environment
first-install handoff. These assignments do not move subscriber state into Deploy
or Marketplace. Resolve subscriber package changes within the requested integration
scope; do not create a new product agent or assign them to Persist/System.

## Implementation Rules

- Use the PRD for subscriber state, webhook, reconciliation and recovery mechanics. Verify actual routes/auth against the target revision and the [current Deploy contract](../build-product-deployer/reference/PRD.md); old token-deploy examples do not override its SigV4 run API.
- Do not implement from this `SKILL.md` alone.
- For an existing Puller deployment, integrate through the PRD's public API, webhook, and reconciliation contracts instead of provisioning a duplicate service.
- Preserve verified subscriber contracts while updating stale integration guidance. Do not add token-deploy, review or rollback operations to stateless Deploy to satisfy an old example.

## Expected Output

Return the product fit, existing-vs-new deployment verdict, PRD sections used, files/stacks/contracts to change, companion agents/skills loaded, and the PRD verification path.
