# Marketplace implementation scope

Use Regigigas to build or maintain Marketplace and Registeel to configure it.
The current Prism reference is `prismteam-ai/marketplace`. Inspect the target
revision before changing code; the kit does not prove a deployment exists.

## Current product boundary

Own the catalog hierarchy, registration, reviewed Build-bundle publication,
review status, rollback and supported publication notifications. Reuse the
current [operation contract](../../operate-marketplace/reference/api-contract.md)
for compatibility with the configurer. Preserve immutable bundle provenance,
review status transitions and idempotency.

Marketplace does not execute subscriber deployments or mint tenant keys. Do not
add subscription endpoints, StackSets, central-account tenant administration or
customer/environment APIs merely because historical instructions prescribed them.
Deploy owns the Puller subscriber component: Corviknight builds it and Skarmory
configures its subscriptions, polling, installation history and update execution.
Physical distribution with Marketplace does not change product ownership. Serve
existing catalog/publication interfaces to Puller; add notifications only under a
verified supported contract. Puller polling must not require invented Marketplace
subscription endpoints.

## Build and verify

Follow `guide-product-work`: explain registration and publication using a small
bundle, demonstrate the review lifecycle, implement one increment, and verify
with the person. Test registration conflicts, invalid artifacts, review failure,
success, duplicate publication, rollback and notification delivery as applicable.
Keep catalog acceptance separate from installation in a subscriber environment.

## Configuration bundles

Follow [the shared configuration-bundle contract](../../build-product-deployer/reference/configuration-bundles.md).
Verify supported component types, immutable publication and compatible shared-provider/API prerequisites in review. Keep publication, review installation and subscriber installation distinct; selecting a previous catalog release does not undo configuration API effects.
Treat these additions as required scope to verify in the target revision, not as
proof that provider support or the target API lifecycle is already deployed.
