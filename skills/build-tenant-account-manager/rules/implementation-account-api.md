---
title: Account API
impact: CRITICAL
tags: [implementation, api, ddb, lambda]
---

# Account API

API Gateway → Lambda. Single Lambda function (or one per route group) backed by DynamoDB and the Step Function described in the Bootstrap rule.

## Tables

| Table | PK | SK | Notes |
| --- | --- | --- | --- |
| `Customers` | `customer_id` | — | `name`, `billing_email`, `external_id` (GSI), `status`, `created_at` |
| `Environments` | `customer_id` | `env_id` | also GSI on `env_id`, GSI on `env_slug`, `tenant_account_id`, `region`, `status` |
| `ApiKeys` | `key_id` | — | GSI `key_hash` (unique), GSI `(env_id, status)`, `scopes`, `last_four`, `retire_at`, `created_at`, `revoked_at` |

## Endpoints (public)

| Operation | Method | Path | Auth | Idempotency key |
| --- | --- | --- | --- | --- |
| Create customer | `POST` | `/customers` | provider IAM | `external_id` |
| Get customer | `GET` | `/customers/{customer_id}` | provider IAM or `customer:read` | — |
| Create environment | `POST` | `/environments` | `customer:write` | `(customer_id, name)` |
| List environments | `GET` | `/environments` | `customer:read` | — |
| Delete environment | `DELETE` | `/environments/{env_id}?confirm=true` | `customer:write` | `env_id` |
| Issue api key | `POST` | `/environments/{env_id}/api-keys` | `env:admin` | `Idempotency-Key` header |
| List api keys | `GET` | `/environments/{env_id}/api-keys` | `env:read` | — |
| Revoke api key | `DELETE` | `/api-keys/{key_id}` | `env:admin` | `key_id` |
| Rotate api key | `POST` | `/api-keys/{key_id}/rotate` | `env:admin` | `Idempotency-Key` header |
| Whoami | `GET` | `/whoami` | any valid key | — |

## Endpoints (internal, marketplace-only)

| Operation | Method | Path | Auth |
| --- | --- | --- | --- |
| Introspect key | `POST` | `/internal/introspect` | IAM SigV4 from marketplace-internal callers only |

## Rules

1. **All writes are conditional.** `attribute_not_exists` on create, `attribute_exists` and version-check on update.
2. **All long-running operations** (create env, delete env) start a Step Function and return `202 Accepted` with a `status_url`. The body of the GET on that URL reads `Environments.status`.
3. **`POST /environments` returns the bootstrap key for the new environment in the same response** so the caller never has to poll for it.
4. **Audit events** are written via DynamoDB Streams → Lambda → S3 audit log, not by the API handler.
