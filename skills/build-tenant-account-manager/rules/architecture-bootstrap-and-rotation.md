---
title: Bootstrap and Rotation
impact: CRITICAL
tags: [architecture, bootstrap, rotation, lifecycle]
---

# Bootstrap and Rotation

The product has two key-issuance paths and one key-replacement path. Do NOT add others.

## Bootstrap (provider → customer)

The only way a brand-new customer obtains its first credential.

```
provider operator
   │  (IAM SigV4 against the marketplace API, scope=provider)
   ▼
POST /customers
{ name, billing_email, first_env_name, region, external_id }
   │
   ▼
Account Manager (within one Step Function execution):
  1. CreateCustomer (idempotent on external_id)
  2. CreateEnvironment (idempotent on (customer_id, name))
  3. AccountFactory.CreateAccount → wait until in Tenants OU
  4. Subscribe Tenant Domain Router to env (await delegated)
  5. Subscribe Marketplace Puller to env (await ready)
  6. Mint bootstrap key (cleartext returned in response, hash stored)
  7. Emit customer.created, env.created, key.issued events
   │
   ▼
HTTP 201 with cleartext bootstrap key — provider relays once to customer
```

After this flow, the provider holds **no** customer-side credentials.

## Self-service environment creation (customer → customer)

A customer with an existing environment uses any `customer:write` key to create more environments. Same Step Function, but starting from step 2; the resulting key is returned to the **calling customer**, never the provider.

## Rotation (overlapping)

Rotation NEVER returns the same key. It mints a new one and schedules retirement of the old one.

```
POST /api-keys/{key_id}/rotate
{ "grace_seconds": 86400 }   // optional, default 24h, max 30d
   │
   ▼
Account Manager:
  1. Mint new key (same env_id, same scopes)
  2. Mark old key with retire_at = now + grace_seconds
  3. Emit key.rotated event (carries old_key_id, new_key_id, retire_at)
  4. Return new cleartext key once
   │
   ▼
After retire_at: scheduled Lambda revokes old key (status=revoked, revoked_at=now)
```

Reading the introspection cache:

- A key in `active` state introspects normally.
- A key in `retiring` state still introspects normally **until** `retire_at`, then introspection returns 401.
- A revoked key always returns 401.

## Rules

1. **There is exactly one provider-only endpoint** (`POST /customers`). Every other write is customer-initiated.
2. **Rotation MUST overlap.** Refusing to overlap (i.e. revoking the old key on rotation) is forbidden because deployed services hold the old key.
3. **Rotation is the only way to "change" a key.** There is no PUT on a key; keys are immutable except for `status` and `retire_at`.
4. **Bootstrap and rotation both pass through the same Step Function for env-account work** so the failure surface is small.
5. **Provider operator credentials are IAM, not API keys.** Provider operators authenticate with SigV4 against the marketplace API; they never hold a `sk_...` key.
