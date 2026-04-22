---
title: Component Registry
impact: CRITICAL
tags: [dynamodb, s3, registry, schema, versioning]
---

# Component Registry

The registry is the marketplace's persistent state. S3 holds bytes; DynamoDB holds pointers and transitions. Together they answer "what components exist?", "which versions are registered?", "what is currently released?", and "who is subscribed to what?"

## Storage Layout

### S3: `component-artifacts`

Bucket policy denies writes from any principal other than the Marketplace API Lambda role. Versioning enabled. Server-side encryption with KMS.

```
s3://component-artifacts/
├── analytics-api/
│   ├── 1.0.0/
│   │   ├── archive.tgz                     # raw uploaded archive (immutable)
│   │   ├── template.json                   # unpacked root template
│   │   ├── manifest.json
│   │   ├── metadata.json
│   │   └── assets/asset.<hash>.zip
│   └── 1.1.0/
│       └── ...
└── marketplace/
    └── 1.0.0/
        └── ...
```

### DynamoDB Tables

All tables: on-demand billing, point-in-time recovery ON, KMS-encrypted, streams enabled (for audit fan-out).

**`Components`**

| Attribute | Type | Notes |
| --- | --- | --- |
| `component_name` (PK) | S | kebab-case |
| `description` | S | |
| `owner` | S | team / email |
| `supported_regions` | SS | e.g., `["us-east-1","us-west-2"]` |
| `created_at` | S | ISO-8601 |
| `created_by` | S | caller principal |

**`Versions`**

| Attribute | Type | Notes |
| --- | --- | --- |
| `component_name` (PK) | S | |
| `version` (SK) | S | semver |
| `s3_prefix` | S | `s3://component-artifacts/<component>/<version>/` |
| `checksum_sha256` | S | |
| `cdk_version` | S | from `metadata.json` |
| `source_commit` | S | |
| `synthesized_at` | S | |
| `registered_at` | S | |
| `registered_by` | S | |

**`Releases`**

| Attribute | Type | Notes |
| --- | --- | --- |
| `component_name` (PK) | S | |
| `current_version` | S | |
| `previous_version` | S | populated on release so rollback can swap atomically; `null` before first release |
| `released_at` | S | |
| `released_by` | S | |

**`Subscriptions`**

| Attribute | Type | Notes |
| --- | --- | --- |
| `tenant_account_id` (PK) | S | 12-digit string |
| `component_name` (SK) | S | |
| `subscribed_version` | S | the version currently deployed in the tenant |
| `subscribed_at` | S | |
| `subscribed_by` | S | |
| `status` | S | `active` \| `pending` \| `deleting` |
| `stack_id` | S | CloudFormation stack ARN in the tenant |

Secondary index `GSI_component` on `component_name` → list all subscribers of a component without scanning.

**`Deployments`** (append-only audit)

| Attribute | Type | Notes |
| --- | --- | --- |
| `subscription_id` (PK) | S | `<tenant_account_id>#<component_name>` |
| `deployed_at` (SK) | S | ISO-8601 with monotonic suffix |
| `action` | S | `deploy` \| `redeploy` \| `rollback` \| `delete` |
| `from_version` | S | previous version (or `null`) |
| `to_version` | S | target version (or `null` for delete) |
| `status` | S | `in_progress` \| `succeeded` \| `failed` |
| `error` | S | optional |
| `initiated_by` | S | caller principal |

## Access Patterns

| Operation | Read / Write |
| --- | --- |
| Register version | Conditional `PutItem` on `Versions` with `attribute_not_exists(version)`; upload to S3 must precede the DynamoDB write so readers never see a pointer to absent bytes. |
| Release version | `TransactWrite`: check target version exists, swap `Releases.current_version` / `previous_version`. |
| Rollback | `TransactWrite`: swap `current_version` ↔ `previous_version` (idempotent if `previous_version` is `null`). |
| List components | `Scan` on `Components` joined in-app to `Releases` + count from `Subscriptions GSI_component`. Small scale; add ElastiCache cache if table grows past a few thousand entries. |
| Subscribe | `TransactWrite`: insert `Subscriptions` row with `status=pending`, insert `Deployments` row with `action=deploy, status=in_progress`. |
| Unsubscribe | Update `Subscriptions.status=deleting`, insert `Deployments` row with `action=delete, status=in_progress`. |

## Rules

1. **S3-before-DynamoDB on write.** Upload the archive and unpacked files first, then write the `Versions` row. If the DynamoDB write fails, a janitor job deletes orphaned S3 prefixes by scanning for prefixes without a matching row older than N hours.
2. **TransactWrite for every state transition.** Release, rollback, subscribe, unsubscribe all touch two tables minimum; use DynamoDB transactions so `Releases` and the queued deploy are coupled.
3. **No cross-region replication for artifacts unless required.** If you need multi-region serving, store in one region and use CloudFront / S3 Access Points; do not fork state.
4. **Audit via DynamoDB Streams.** Fan `Deployments` stream records into EventBridge → S3 for long-term audit. The API response does not include audit acknowledgement — it's fire-and-forget from the caller's perspective.
5. **TTL for nothing.** Registry rows are permanent. Use lifecycle policies on the S3 audit bucket if needed, not TTL on the registry tables themselves.

## ✅ Correct

```typescript
// Register version
await s3.putObject({ Bucket: 'component-artifacts', Key: `${name}/${version}/archive.tgz`, Body: archive });
// ... unpack + put each file ...
await ddb.send(new PutItemCommand({
  TableName: 'Versions',
  Item: marshall({ component_name: name, version, s3_prefix, checksum_sha256, ... }),
  ConditionExpression: 'attribute_not_exists(version)',
}));
```

## ❌ Incorrect

- Writing the `Versions` row before uploading the S3 artifact (races let a release reference missing bytes).
- Mutating `Versions` rows after registration (breaks immutability).
- Storing the `current_version` as a field on each `Versions` row (de-normalized, many writers, gets stale).
- Using a single table with nested maps for components + versions + releases (hides the access patterns and blocks conditional writes).
