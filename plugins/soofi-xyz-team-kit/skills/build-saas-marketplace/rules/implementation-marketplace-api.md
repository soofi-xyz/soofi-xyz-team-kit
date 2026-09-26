---
title: Marketplace API
impact: CRITICAL
tags: [api-gateway, lambda, endpoints, idempotency, auth]
---

# Marketplace API

The marketplace exposes exactly six write operations plus one list operation. All run in the marketplace account as API Gateway + Lambda, backed by the registry tables (see `implementation-component-registry.md`).

## Endpoints

| # | Operation | Method | Path |
| - | --- | --- | --- |
| 1 | Register component version | `POST` | `/components/{name}/versions/{version}` |
| 2 | Release component | `POST` | `/components/{name}/release` |
| 3 | Rollback component | `POST` | `/components/{name}/rollback` |
| 4 | List components | `GET` | `/components` |
| 5 | Subscribe | `POST` | `/subscriptions` |
| 6 | Unsubscribe | `DELETE` | `/subscriptions/{tenant_account_id}/{component_name}` |

### 1. Register component version

Request: gzipped `tar.gz` archive of `cdk.out/` + `metadata.json` (see `integration-component-artifact-contract.md`).

```
POST /components/{name}/versions/{version}
Content-Type: application/gzip
Idempotency-Key: <opaque string>

<binary archive>
```

Response:
```json
{ "component": "analytics-api", "version": "1.2.0",
  "s3_prefix": "s3://component-artifacts/analytics-api/1.2.0/",
  "checksum_sha256": "..." }
```

- Returns `409 Conflict` if `(name, version)` already registered.
- Returns `400` if `metadata.json.version` disagrees with the path version.

### 2. Release component

```
POST /components/{name}/release
Content-Type: application/json
Idempotency-Key: <opaque string>

{ "version": "1.2.0" }
```

Response:
```json
{ "component": "analytics-api",
  "current_version": "1.2.0",
  "previous_version": "1.1.0",
  "affected_subscriptions": 17 }
```

Side-effect: enqueue one redeploy per active subscription of this component.

### 3. Rollback component

```
POST /components/{name}/rollback
Idempotency-Key: <opaque string>
```

No body. Swaps `current_version` ↔ `previous_version`. Enqueues one redeploy per active subscription. Returns `409` if `previous_version` is null.

### 4. List components

```
GET /components?limit=50&cursor=<opaque>
```

Response:
```json
{
  "components": [
    {
      "name": "analytics-api",
      "description": "...",
      "current_version": "1.2.0",
      "previous_version": "1.1.0",
      "subscribers": 17,
      "supported_regions": ["us-east-1", "us-west-2"]
    }
  ],
  "next_cursor": "..."
}
```

### 5. Subscribe

```
POST /subscriptions
Idempotency-Key: <opaque string>

{ "tenant_account_id": "123456789012",
  "component_name": "analytics-api",
  "region": "us-east-1",
  "parameters": { "PlanTier": "pro" }  // optional, CloudFormation parameter overrides
}
```

Response (immediate):
```json
{ "subscription_id": "123456789012#analytics-api",
  "status": "pending",
  "target_version": "1.2.0",
  "deployment_id": "..." }
```

Side-effect: enqueue a deploy of the current released version into the tenant.

### 6. Unsubscribe

```
DELETE /subscriptions/123456789012/analytics-api
Idempotency-Key: <opaque string>
```

Response:
```json
{ "subscription_id": "123456789012#analytics-api",
  "status": "deleting",
  "deployment_id": "..." }
```

Side-effect: enqueue a stack-delete in the tenant account. Once CloudFormation reports `DELETE_COMPLETE`, the subscription row is removed.

## Lambda Architecture

```
┌── API Gateway (REST, regional) ──┐
│                                  │
│   IAM SigV4 auth (operators)     │
│   Cognito / Identity Center (UI) │
└────────────┬─────────────────────┘
             ▼
┌──── Lambda: marketplace-api ─────┐
│   Router → per-op handler module │
│   Synchronous handlers for:      │
│     - validate + authorize       │
│     - DDB transact writes        │
│     - emit audit event           │
│     - enqueue deploy jobs        │
└────────────┬─────────────────────┘
             ▼
┌──── Step Functions: deploy-fsm ──┐
│   One execution per deploy       │
│   Waits on StackSet / CFN status │
│   Updates Subscriptions & Deployments
└──────────────────────────────────┘
```

Keep the API Lambda synchronous and fast (<1s). Long-running deploy orchestration belongs in Step Functions, not in the API Lambda.

## Rules

1. **Authenticate with IAM SigV4 or a managed identity provider.** No long-lived API keys.
2. **Authorize by component + tenant.** A component owner can register/release/rollback their components. A tenant-admin-on-behalf principal can subscribe/unsubscribe their tenant. List is read-scoped per caller.
3. **Every write endpoint requires an `Idempotency-Key` header.** The handler reads a DynamoDB idempotency table keyed by `Idempotency-Key + operation`. Second call returns the stored response verbatim.
4. **Validate inputs with a schema** (Zod / JSON Schema). Reject unknown fields; never forward a caller-provided payload into CloudFormation parameters without a schema check.
5. **Emit one structured log line per request** with `request_id`, `operation`, `caller_principal`, `component`, `version`, `tenant_account_id`, `result`, `duration_ms`.
6. **Audit event before response.** Write the `Deployments` row (or equivalent `Audit` row for register/release/rollback/list) before returning `200`. The caller's success response proves the audit row exists.
7. **Pagination uses opaque cursors.** Do not expose DynamoDB `LastEvaluatedKey` directly; encode + sign it.
8. **Rate-limit at API Gateway per caller.** Burst on list, tighter on register (large bodies).

## Error Model

| Code | When |
| --- | --- |
| 400 | Schema violation, path/body mismatch, unsupported region |
| 401 | Missing / invalid signature |
| 403 | Caller not authorized for this component or tenant |
| 404 | Component / version / subscription not found |
| 409 | Conflict (duplicate version, rollback with no previous, subscribe existing) |
| 429 | Rate limit |
| 500 | Unexpected — already alarmed |
| 503 | Dependency (DDB / S3 / CFN) throttled; caller should retry |

## ✅ Correct

- Subscribe returns `202`-style immediate response with a `deployment_id`; the caller polls `GET /subscriptions/{id}` or listens on EventBridge for completion.
- Rollback with no previous version returns `409 Conflict`, not silent success.
- Same `Idempotency-Key` replays the exact stored response, including the `deployment_id`.

## ❌ Incorrect

- Subscribe blocks the HTTP call on `CreateStack` completion (API Gateway 29s timeout breaks it; retries spawn duplicate stacks).
- Release accepts a `version` that was never registered (check `Versions` existence in the same transaction).
- API Lambda writes CloudFormation parameters directly from `req.body.parameters` without a per-component allowlist (lets callers override security-sensitive values).
