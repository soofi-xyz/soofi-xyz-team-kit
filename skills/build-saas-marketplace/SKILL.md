---
name: build-saas-marketplace
description: "Build or maintain Prism Marketplace catalog registration, bundle publication, review and rollback. Use Regigigas; use Registeel for catalog operations."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

Use [the Marketplace capability map](../guide-product-work/reference/iterations/marketplace.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Build Marketplace

Use `regigigas` for the reusable product implementation and `registeel` for
configuration on an existing deployment. Follow
[guide-product-work](../guide-product-work/SKILL.md) and
[engineering guidelines](../apply-engineering-guidelines/SKILL.md).


Read [the current scope](reference/PRD.md) before implementation. Discover the
target repository, revision and environment. Reuse an existing service when
appropriate; agent availability does not prove deployment or feature support.

Separate historical requirements, current implementation and live evidence.
Where references conflict, inspect the target contract and tests and record the
resolution. Do not silently restore obsolete features or remove working behavior.

Use supporting skills directly for workflow capacity, metrics and model reasoning.
Resolve other products through the catalog. Do not use a general platform owner.
Use Registeel for Marketplace publication; keep deployment prerequisites explicit.

Derive the scoped feature plan from the shared workflow and product capability
map. Require a user-run configuration and AWS inspection after every piece. Return the
implementation changes, verification results, human observations, current stage
and any remaining runtime or integration gaps.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Verify configuration-bundle publication and review with compatible provider/API prerequisites; keep catalog rollback distinct from API compensation.

## API description

For review, publication or Documentation work, read and apply
[the API description contract](../guide-product-work/reference/api-description.md).
Marketplace checks the packed `requirements/swagger.yml` under `API_SPEC_POLICY`
and sends each VALID SERVICE bundle's spec to Documentation without ever changing
the review or bundle status. Pass `REVIEW_ACCOUNT_ID` on every deploy with a
separate review environment, and preview the review function's environment first:
without it every review targets the Marketplace account and fails.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Require the API Gateway domain and product-owned mappings; keep DNS traffic
records optional. Publish `base_path` and `requires.domain: true` only;
`endpoints`/`endpoint_contract_version` need a Build schema change first. Read
domain metadata from `/account/env-parameters`. Verify support in the target
revision and route missing behavior to the responsible builder.
