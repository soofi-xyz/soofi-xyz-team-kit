---
name: build-tenant-account-manager
description: "Build or maintain the Account HTTP API, identity and key lifecycle, provisioning, domains and maintenance access. Use Kangaskhan for implementation and Blissey for existing-service configuration."
disable-model-invocation: true
---

# Build Account

Use `kangaskhan`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Account capability map](../guide-product-work/reference/iterations/account.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `blissey` with [configure-account-product](../configure-account-product/SKILL.md)
for account-specific operations through an existing deployment.

## Scope and contract

Read [the Account PRD](reference/PRD.md) for the relevant capability before coding.
Verify the target repository, revision, deployed contract and environment; the PRD
is a blueprint and does not prove shipped behavior. Preserve working caller
contracts and record discrepancies before changing them. Use the existing Account
entity model; do not add competing customer/environment APIs from older designs.

Deliver an HTTP API with authentication and per-account authorization. Validate
requests, errors and correlation at that boundary. Keep documented public signup
and signed confirmation/approval callbacks explicitly scoped; they do not permit
unauthenticated account administration. Expose async submission, status and results
through the service's supported contract; AWS workflows and CLIs support the API.

Own identity, confirmation, account keys, underlying AWS account provisioning,
DNS/certificate metadata, bootstrap-manifest output, service-key rotation,
maintenance access and guarded disable. Keep product installation and API Gateway
route mappings with Environment/Deploy and the owning product. Keep partner
credentials with Connect. Discover those products' current contracts rather than
copying older integration route examples from this PRD. No API-documentation
workstream is added by this skill.

## Build each feature piece

1. Select and order capabilities from the map. Include at least four increments
   for a full build; narrow fixes select only their relevant pieces. Bring the
   minimal HTTP handler, diagnostics and authorized test deployment into the
   first usable path; do not finish every internal module before the user tries it.
2. Use [synthetic test data and dependency fakes](reference/test-data.md). Show the
   next capability, then implement it with request/authorization checks and
   observable state transitions. Keep real account creation, mail, DNS, credential
   changes and account closure out of mocked acceptance.
3. Test the baseline, a supported variant, invalid/unauthorized input and relevant
   duplicate, timeout and recovery behavior inside the piece. Verify effects and
   secret redaction, not just successful HTTP status. Follow async runs to a
   terminal status and read back their results.
4. Have the user invoke the increment through the API. Provide actual account,
   region, resource names and at most three AWS inspection steps. Wait for their
   request ID and observation before implementing the next piece. Fix and repeat
   the current check if its evidence disagrees with the expected result.
5. Rerun cumulative acceptance for selected features, then use authorized real
   dependencies where requested. Discover deployment controls from the target
   repository; a reference command is not permission to create or close accounts.

Return changes, API/configuration examples, automated and human evidence,
mock-versus-live results, cleanup and the next checkpoint. Keep reusable product
code in its target repository; this kit contains instructions and test inputs.
