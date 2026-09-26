---
title: Domain API
impact: CRITICAL
tags: [implementation, api, route53, lambda]
---

# Domain API

The Tenant Domain Router extends the Marketplace API with three idempotent endpoints. They live in the marketplace account and are deployed by the parent-zone stack.

## Endpoints

| Operation | Method | Path | Idempotency key |
| --- | --- | --- | --- |
| Provision env subdomain | `POST` | `/environments/{env_slug}/domain` | `env_slug` |
| Reserve base path | `POST` | `/environments/{env_slug}/base-paths` | `(env_slug, base_path)` |
| Release env subdomain | `DELETE` | `/environments/{env_slug}/domain` | `env_slug` |

## Provision

Request:

```json
{
  "tenant_account_id": "123456789012",
  "region": "us-east-1"
}
```

Behavior:

1. Validate `env_slug` is unused (conditional write to `Environments` table).
2. Trigger the deploy product to launch `tenant-subdomain.template.json` in the tenant account with parameters `{ envSlug, region, parentZoneId }`.
3. The tenant stack creates the child hosted zone, ACM cert, and API Gateway custom domain. Its custom-resource Lambda calls the parent-zone Lambda in the marketplace account with the four NS values.
4. Parent-zone Lambda performs an `UPSERT` of the `NS` record set for `<env-slug>.provider.xyz` in the parent zone.
5. Write `Deployments` audit row with `status=delegated` and the NS values.

Response (sync, returns immediately after registration; full delegation completes asynchronously):

```json
{
  "env_slug": "acme-prod",
  "subdomain": "acme-prod.provider.xyz",
  "status": "provisioning"
}
```

## Reserve Base Path

Request:

```json
{
  "base_path": "billing",
  "component_name": "billing-worker"
}
```

Behavior — single conditional write to `BasePaths` (PK `env_slug`, SK `base_path`). On collision return HTTP 409. On success return:

```json
{
  "env_slug": "acme-prod",
  "base_path": "billing",
  "url": "https://acme-prod.provider.xyz/billing"
}
```

The reservation MUST exist before the deploy product schedules the component's deploy. Producers call this during `register` (it is part of the artifact contract).

## Release

`DELETE /environments/{env_slug}/domain?force=true|false`

1. Refuse if any base paths are still reserved unless `force=true`.
2. Trigger stack deletion of `tenant-subdomain.template.json` in the tenant.
3. After tenant stack is `DELETE_COMPLETE`, parent-zone Lambda removes the `NS` record set.
4. Drop the `Environments` and `BasePaths` rows.
5. Write `Deployments` audit with `status=released`.

## Tables

| Table | PK | SK | Notes |
| --- | --- | --- | --- |
| `Environments` | `env_slug` | — | one row per environment, holds `tenant_account_id`, `region`, `subdomain`, `parent_ns_record_id` |
| `BasePaths` | `env_slug` | `base_path` | one row per reservation, holds `component_name`, `reserved_at` |

## Rules

1. **Idempotency keys are natural.** No client-supplied `Idempotency-Key` header needed for these endpoints.
2. **Every write goes through a conditional expression** — `attribute_not_exists` on create, `attribute_exists` on delete.
3. **Audit rows are written before the API returns success**, never after, so a crashed Lambda still produces an audit trail.
4. **The parent-zone Lambda is the only writer to the parent zone.** Operators MUST NOT click around in the Route 53 console to add per-tenant `NS` records — automation will drift.
