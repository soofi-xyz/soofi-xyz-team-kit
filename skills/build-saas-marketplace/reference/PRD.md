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
Treat a subscriber-side puller as implementation belonging to Marketplace/Deploy;
physical distribution does not create another product. Any change to the supported
subscription boundary requires an explicit product decision, not an invented API.

## Build and verify

Follow `guide-product-work`: explain registration and publication using a small
bundle, demonstrate the review lifecycle, implement one increment, and verify
with the person. Test registration conflicts, invalid artifacts, review failure,
success, duplicate publication, rollback and notification delivery as applicable.
Keep catalog acceptance separate from installation in a subscriber environment.
