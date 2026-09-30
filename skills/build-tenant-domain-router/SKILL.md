---
name: build-tenant-domain-router
description: "Reconcile shared domain and endpoint wiring across Account, Environment and Deploy. Use for DNS/certificate inventory, shared API domains, product base paths and routing conflicts."
disable-model-invocation: true
---

# Shared domain and endpoint integration

Use this supporting procedure within the owning product's feature increment.
Domain Router is not another catalog product or a Marketplace deployment service.
Load [guide-product-work](../guide-product-work/SKILL.md) and its catalog first.

## Ownership

- Use Kangaskhan/Blissey and the [Account contract](../build-tenant-account-manager/reference/PRD.md)
  for account domain, zone and certificate inventory or lifecycle.
- Use Torterra/Shaymin and the [Environment contract](../build-bootstrap-cli/reference/PRD.md)
  for shared API Gateway domain/usage-plan resources, non-secret routing handles,
  setup readiness and endpoint coordination.
- Use Corviknight/Skarmory and the [Deploy contract](../build-product-deployer/reference/PRD.md)
  to execute validated product stacks against existing shared handles.
- Keep individual base-path mappings with the owning product stack and shared path
  coordination with Environment. Keep Marketplace on catalog/review/publication.

## Work

1. Discover the target revision and actual resource ownership. Verify selected AWS
   profile, account and region. Read Account inventory and Environment outputs;
   do not create a second root/child zone, certificate or shared API domain.
2. Reuse verified SSM/output handles and actual attachment contracts. Do not assume
   old `/environments/.../domain` or `/base-paths` routes exist in Marketplace.
   Missing operations go to the owning builder; a configurer uses existing APIs.
3. Validate certificate region, domain identity, endpoint type, route ownership
   and path uniqueness before mutation. Define conflict/retry behavior inside
   the owning product's contract rather than inventing a parallel router service.
4. Test fake Account inventory and AWS responses first: valid handles, missing
   certificate, wrong account/region, duplicate route and repeated attachment.
   In an authorized test environment, invoke the owning API and inspect its
   correlated workflow/logs and API Gateway mapping, then make a test HTTP request.
5. Give at most three AWS inspection steps and wait for the user's observation
   before the next feature. Keep local mock, deployed mock and live DNS/TLS evidence
   distinct. Cleanup only owned test mappings; preserve shared domains and zones.

Return the owning product, verified contracts/handles, API result, user/AWS
observations and any builder gap. Do not claim working DNS/TLS from synthesis.
