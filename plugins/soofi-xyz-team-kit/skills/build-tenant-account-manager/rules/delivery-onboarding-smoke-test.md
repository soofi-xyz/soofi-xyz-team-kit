---
title: Onboarding Smoke Test
impact: HIGH
tags: [delivery, verification, smoke-test]
---

# Onboarding Smoke Test

Run end-to-end against a throwaway customer in a non-production marketplace deployment. Mark the product unfit for release until every step passes.

## Steps

1. **Provider creates customer** — `POST /customers` with provider IAM. Expect HTTP 201 with cleartext bootstrap key. Save the key.
2. **Whoami with bootstrap key** — `GET /whoami` returns the new `customer_id`, `env_id`, `env_slug`, scopes including `env:admin` and `customer:write`.
3. **Tenant account exists** — confirm via Organizations API that the new account is in the `Tenants` OU with the correct alias.
4. **Domain Router subscribed** — confirm `Subscriptions` row in marketplace registry, NS delegation resolves (re-use the smoke test from `build-tenant-domain-router`).
5. **Marketplace Puller subscribed** — confirm the puller stack exists in the tenant.
6. **Customer rotates the bootstrap key** — `POST /api-keys/{key_id}/rotate` with `grace_seconds=60`. Expect HTTP 200 with new cleartext key. Old key still works for 60 s.
7. **After grace** — old key returns 401, new key still returns 200.
8. **Customer creates additional environment** — `POST /environments { name: "staging", region: ... }`. Expect a new env_id, new tenant account, new bootstrap key.
9. **Cross-env isolation** — call any env-scoped endpoint with the staging key against `prod`'s `env_id` → expect 403.
10. **Provider deletes customer** — `DELETE /customers/{customer_id}?confirm=true`. All envs unsubscribe, accounts move to `Suspended` OU, all keys revoked.

## Rules

1. **Run this test on every release of the product.** It exercises every other product (Domain Router, Puller, Deploy product) in one shot.
2. **Capture timing.** Step 1 P95 SHOULD be under 5 minutes (account creation dominates).
3. **Audit log MUST contain one row per state transition** in steps 1, 6, 7, 8, 10.
