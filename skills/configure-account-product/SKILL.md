---
name: configure-account-product
description: "Configure and test a particular account's identity, keys, provisioning, domains or maintenance access through an existing Account API. Use Blissey; route missing service capabilities to Kangaskhan."
---

# Configure Account

Use `blissey`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Account capability map](../guide-product-work/reference/iterations/account.md).
Read the relevant [Account contract](../build-tenant-account-manager/reference/PRD.md)
and [synthetic test data](../build-tenant-account-manager/reference/test-data.md).

1. Discover the existing API, target revision, auth and per-account permissions,
   lifecycle state, selected AWS profile, account and region. Confirm supported
   request/response shapes from that revision. Keep requirements separate from
   implemented and observed capabilities.
2. Select the requested feature pieces and dependencies. Explain each change
   with a synthetic fixture before the person applies it. Use a baseline,
   materially different supported configuration and relevant negative/recovery
   cases inside each piece; a retry is not a new implementation increment.
3. Author payloads for the supported identity, key, provisioning, domain,
   bootstrap or maintenance operations. Use the HTTP API and discover its async
   status/result surface. Preserve stable identifiers, ownership checks,
   confirmation/approval requirements and supported idempotency behavior.
4. Use a discovered mock-enabled test deployment first. Where it is unavailable,
   ask `kangaskhan` to supply the missing test capability and leave the affected
   checkpoint pending. Do not claim local fixture checks are live verification.
5. Give one copyable API invocation with its small fixture, expected result and
   at most three steps to inspect the correlated AWS logs/workflow. Have the user
   run the baseline and variant, read back state and report their observation.
   Wait for that evidence before advancing. Verify async completion separately
   from a `202` response and distinguish mocked resources from actual readiness.
6. Keep secrets in the approved local credential store, never in chat, committed
   payloads or evidence. For real provisioning, key rotation/revocation or account
   disable, verify authorization covers the target and effects. Do not bypass
   the API with database, IAM or DNS edits. Record cleanup without automatically
   disabling an account or revoking shared credentials used outside the test.
7. Hand missing API operations or engine defects to `kangaskhan` with a redacted
   reproducer. Keep product installation with Environment/Deploy; emitting a
   bootstrap manifest does not mean the product stacks have been installed.

Return configured state, redacted IDs, expected/actual results, user/AWS evidence,
mocked/live status, cleanup and unresolved dependencies.
