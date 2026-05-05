---
name: build-tenant-account-manager
description: "Guides building the Tenant Account Manager — a standalone marketplace product that owns customer identity, environment lifecycle, and API-key issuance / rotation. Covers the bootstrap API key minted by the provider for a new customer, the customer-facing self-service surface for creating additional environments and rotating per-environment API keys, the relationship between a `customer`, its `environments`, and the per-environment AWS account, and the auth model used by every other marketplace endpoint. Triggers on: account management, customer onboarding, api key issuance, api key rotation, per-environment credentials, multi-environment customer, marketplace authentication, self-service tenant portal."
---

# Building the Tenant Account Manager

This skill builds **one** of the four standalone products in the marketplace ecosystem. It is the only product that owns the *customer identity* surface — every other product authenticates by calling this one. It is itself a marketplace component (`cdk synth` → register → release → subscribe), and it is the **first** component subscribed when a new customer is onboarded.

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). Consult it for the current Account service route map, data contracts, workflow requirements, and infrastructure topology before implementation.

Load this skill alongside `skills/build-saas-marketplace/` whenever you are working on customer accounts, API keys, environment creation, or "who is this caller and which environment are they acting on".

## What This Product Owns

1. **The `Customer` aggregate.** A customer is the top-level identity. They have a name, billing email, and one or more environments.
2. **The `Environment` aggregate.** An environment is the customer's deployable unit. Each environment maps 1:1 to a tenant AWS account in the `Tenants` OU. A customer can have many environments (`prod`, `staging`, `eu-prod`, ...).
3. **API keys, scoped per environment.** Each environment has at least one API key. Keys are the credential customers use to call the marketplace API; every key carries the `(customer_id, env_id)` scope.
4. **The bootstrap key flow.** When the provider onboards a new customer, the provider mints exactly one bootstrap API key for that customer's first environment. The customer uses it to log in, rotate it, and provision more environments.
5. **The auth introspection endpoint** that every other marketplace product calls to resolve `api_key → (customer_id, env_id, scopes)` on every request.

## Architecture

```
┌──────────────── Marketplace account (control plane) ────────────────┐
│                                                                     │
│   API Gateway → Lambda (Account Manager API)                        │
│   │                                                                 │
│   ├─ DynamoDB: Customers / Environments / ApiKeys                   │
│   ├─ Secrets Manager: hashed key material + per-env signing keys    │
│   ├─ EventBridge: customer.created, env.created, key.rotated, ...   │
│   └─ Lambda authorizer: shared by every marketplace API             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                ▼ (provisions)
┌──────────────── Tenant account (one per environment) ───────────────┐
│   AWS account in `Tenants` OU                                       │
│   `MarketplaceAdmin` role trusting marketplace account              │
│   SSM: /<env>/identity/{customer_id, env_id, env_slug}              │
└─────────────────────────────────────────────────────────────────────┘
```

## Required Implementation Checklist

- [ ] `Customers`, `Environments`, `ApiKeys` DynamoDB tables exist with the documented PK/SK shape
- [ ] API keys are stored as **hashes only**; cleartext is returned exactly once at issuance
- [ ] Provider-only `POST /customers` mints the customer + first environment + bootstrap key in one transaction
- [ ] Customer-facing `POST /environments` provisions a new tenant account via Account Factory + initial bootstrap stack, then issues a fresh API key for it
- [ ] `POST /environments/{env_id}/api-keys` issues an additional key; `DELETE` revokes; `POST /api-keys/{key_id}/rotate` performs a graceful overlap rotation
- [ ] Lambda authorizer resolves an inbound `Authorization: Bearer <api-key>` → `(customer_id, env_id, scopes)` with sub-millisecond P50
- [ ] Every state transition emits an EventBridge event consumed by the audit log
- [ ] Idempotent on every retry; replaying `POST /customers` with the same `external_id` returns the existing customer
- [ ] Every other marketplace product wires its API Gateway to this product's Lambda authorizer (no per-product auth code)

## Identity Model

```
Customer (1) ──< Environment (N) ──< ApiKey (M)
```

| Aggregate | Identifier | Notes |
| --- | --- | --- |
| Customer | `cus_<ulid>` | Provider-scoped; never recycled |
| Environment | `env_<ulid>` | Customer-scoped; mapped to one AWS account; carries the `env_slug` used by the Domain Router |
| ApiKey | `key_<ulid>` | Environment-scoped; one row per active key; revoked keys remain for audit |

API key cleartext format: `sk_<env-prefix>_<random>` where `env-prefix` is the first 6 chars of the env slug. Cleartext is **only** returned in the response that creates or rotates the key. The DB stores `sha256(key)` plus a 4-character last-four hint for UI display.

Read `rules/foundation-account-ontology.md` and `rules/integration-auth-introspection-contract.md`.

## Bootstrap Key Flow

Onboarding a brand-new customer is the only time a key is minted by the provider, not the customer.

```
1. Provider operator (or automation) calls POST /customers with provider IAM SigV4 auth:
     { name, billing_email, first_env_name, region, external_id }
2. Account Manager:
     - creates Customer row
     - creates Environment row (status=provisioning)
     - calls Account Factory to create the AWS tenant account
     - waits for the account to land in the Tenants OU
     - subscribes the Tenant Domain Router to the new env (via Marketplace API)
     - issues bootstrap api key, returns cleartext exactly once in the response
3. Provider hands the cleartext bootstrap key to the customer over a secure channel
4. Customer's first call rotates the bootstrap key (recommended) and creates additional keys for tooling
```

After step 4 the provider has zero credentials into the customer's environment.

Read `rules/architecture-bootstrap-and-rotation.md`.

## Customer Self-Service API

| Operation | Method | Path | Auth scope |
| --- | --- | --- | --- |
| Create environment | `POST` | `/environments` | `customer:write` |
| List environments | `GET` | `/environments` | `customer:read` |
| Delete environment | `DELETE` | `/environments/{env_id}` | `customer:write` (requires `confirm=true`) |
| Issue api key | `POST` | `/environments/{env_id}/api-keys` | `env:admin` |
| List api keys | `GET` | `/environments/{env_id}/api-keys` | `env:read` |
| Revoke api key | `DELETE` | `/api-keys/{key_id}` | `env:admin` |
| Rotate api key | `POST` | `/api-keys/{key_id}/rotate` | `env:admin` |
| Whoami | `GET` | `/whoami` | any valid key |

Read `rules/implementation-account-api.md`.

## Auth Introspection

Every other marketplace API uses a Lambda authorizer that delegates to this product's `POST /internal/introspect` endpoint:

```json
// request
{ "api_key": "sk_acmepd_..." }

// response (HTTP 200)
{
  "customer_id": "cus_01H...",
  "env_id": "env_01H...",
  "env_slug": "acme-prod",
  "tenant_account_id": "123456789012",
  "scopes": ["env:admin", "env:read", "customer:read"]
}
```

Caching: results MAY be cached for 60 seconds, keyed by the SHA-256 of the API key. Revocation events fan out to caches via EventBridge so revocation propagates within one minute.

Read `rules/integration-auth-introspection-contract.md`.

## Non-Negotiable Principles

1. **Cleartext keys leave the system exactly once** — at issuance / rotation. Storage is hash-only.
2. **Bootstrap keys are minted by the provider, never by self-service.** All other keys are minted by the authenticated customer.
3. **Keys are scoped to one environment.** A `prod` key cannot read or mutate `staging`. Cross-environment operations require multiple keys.
4. **Rotation is overlapping, not destructive.** Rotating a key issues a new key, returns it once, and gives the old key a configurable grace window (default 24 h) before automatic revocation.
5. **Every other product authenticates through this one.** No product implements its own API-key store.
6. **One environment = one AWS account.** Creating an environment provisions a real account via Account Factory; deleting an environment closes it.
7. **Self-hosting.** This product is itself a component subscribed by the marketplace bootstrap before any tenant exists.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Account Ontology | `rules/foundation-account-ontology.md` | HIGH |
| Bootstrap and Rotation | `rules/architecture-bootstrap-and-rotation.md` | CRITICAL |
| Auth Introspection Contract | `rules/integration-auth-introspection-contract.md` | CRITICAL |
| Account API | `rules/implementation-account-api.md` | CRITICAL |
| Key Storage and Hardening | `rules/implementation-key-storage.md` | CRITICAL |
| Onboarding Smoke Test | `rules/delivery-onboarding-smoke-test.md` | HIGH |
