---
title: Key Storage and Hardening
impact: CRITICAL
tags: [implementation, security, secrets, hashing]
---

# Key Storage and Hardening

API keys are bearer credentials. Treat them like passwords.

## Issuance

```
random  = 32 bytes from CSPRNG
key     = "sk_" + env_prefix + "_" + base32(random)   // ~52 chars
hash    = sha256(key)
last_four = key[-4:]
```

Store `{ key_id, env_id, key_hash, last_four, scopes, status, created_at }` in `ApiKeys`. Return cleartext `key` exactly once in the HTTP response. Never write cleartext to logs, traces, or DynamoDB.

## Hashing

- Use SHA-256, not bcrypt/argon2. Keys are 256-bit random; brute force is infeasible. SHA-256 is fast enough for sub-ms authorizer latency.
- The `key_hash` GSI uses the raw hash as the partition key for O(1) lookup.

## Storage Hardening

1. **DynamoDB tables encrypted with a customer-managed KMS key** owned by this product's stack.
2. **`ApiKeys` access is allowed only to** the API Lambda role and the authorizer Lambda role. No human IAM identities have access; break-glass is via STS with MFA + audit.
3. **No key is ever exported to CloudWatch Logs.** API handlers redact `Authorization`, request bodies on `POST /api-keys`, and response bodies on `POST /api-keys`, `POST /rotate`, `POST /environments`.
4. **Rate-limit introspection** to prevent enumeration: 100 req/s per source per minute, with exponential backoff on 401.
5. **Mark revoked keys with `revoked_at`** instead of deleting the row, so audit can resolve old `key_id` references.

## Rules

1. **No plaintext storage, anywhere.** If the cleartext is not in the response body, it is gone.
2. **No editing keys.** Mutations allowed: `revoke` (status → `revoked`), `rotate` (creates new, marks old `retiring`), `expire` (TTL).
3. **Constant-time comparison** is unnecessary because lookups are by hash equality, not by comparing the secret. Do NOT introduce a code path that compares cleartext.
4. **The bootstrap key is no different from any other key** in storage. The "bootstrap" attribute is just a flag on the row for first-issued.
