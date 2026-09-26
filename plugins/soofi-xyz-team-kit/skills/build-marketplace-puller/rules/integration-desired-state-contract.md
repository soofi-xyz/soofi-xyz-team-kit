---
title: Desired-State Contract
impact: CRITICAL
tags: [integration, api, etag, caching]
---

# Desired-State Contract

A single read endpoint is the only contract between the marketplace and any puller. Do NOT add side channels.

## Endpoint

```
GET /environments/{env_id}/desired-state
Authorization: Bearer sk_<env-prefix>_...
If-None-Match: W/"<etag>"     (optional)
Accept: application/json
```

Response:

```json
{
  "env_id": "env_01H...",
  "env_slug": "acme-prod",
  "tenant_account_id": "123456789012",
  "computed_at": "2026-04-29T12:34:56Z",
  "subscriptions": [
    {
      "component": "billing-worker",
      "released_version": "1.4.2",
      "release_id": "rel_01H...",
      "adapter": "stackset",
      "artifact_url": "https://component-artifacts.s3.amazonaws.com/billing-worker/1.4.2/?X-Amz-...",  // pull-only mode only
      "context_schema_version": "1"
    }
  ],
  "etag": "W/\"abcd1234\""
}
```

| Status | Meaning |
| --- | --- |
| `200` | Fresh state returned |
| `304` | Caller's `If-None-Match` matches; no body |
| `401` | Key invalid / revoked |
| `403` | Key valid but not for this `env_id` |
| `404` | Environment not found |

## Etag Semantics

- ETag is `W/"<hash>"` where `<hash>` = sha256 of the canonical-JSON of `subscriptions`.
- Reorders / formatting do not change the etag; substantive changes do.
- The puller stores the last-seen etag in SSM `/marketplace/puller/last-etag` and sends it on the next request.

## Authentication

The puller authenticates with the **same** API-key model used by every other product (see `build-tenant-account-manager`). The puller's Lambda role has read on the SSM parameter `/<env>/puller/marketplace-api-key` whose value is the cleartext key. Account Manager rotation rotates this parameter as part of `POST /api-keys/{key_id}/rotate` when `purpose=puller` is set on the key.

## Presigned Artifact URLs (pull-only mode only)

When the calling environment is in `pull-only` mode, each `subscriptions[i].artifact_url` is a presigned S3 URL valid for 15 minutes that downloads the component's artifact tarball. In other modes this field is omitted (push handles artifact movement).

## Rules

1. **The puller never POSTs to the marketplace except `/deploys`.** Reading desired state is the only state transfer.
2. **The marketplace MUST compute desired state from `Subscriptions` ⨯ `Releases.current_version`** at request time — no caching server-side beyond a 60-second stale-while-revalidate.
3. **`artifact_url` is per-request**, not per-version. Don't cache it.
4. **Backwards-compatible additions are fine**, but never remove or rename a field without bumping a `desired_state_schema_version`.
