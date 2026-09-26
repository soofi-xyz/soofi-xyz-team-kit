---
title: Cross-Account Deployment
impact: CRITICAL
tags: [cloudformation, stacksets, assume-role, iam, cross-account]
---

# Cross-Account Deployment

The marketplace account must deploy CloudFormation stacks into tenant accounts. Pick one of two mechanisms and stick with it per component.

## Default: CloudFormation StackSets (Service-Managed)

Use when:
- Tenants all live under the same AWS Organization (they do, by `architecture-organizations-and-accounts.md`).
- Per-tenant parameter overrides fit in CloudFormation `Parameters` and StackSet overrides.
- You want AWS to manage the execution role provisioning in tenant accounts.

### Shape

- One StackSet per component (`marketplace-{component}`) in the marketplace account.
- Stack instances are created per tenant when they subscribe, and deleted when they unsubscribe.
- The marketplace Lambda calls `CreateStackInstances` / `DeleteStackInstances` / `UpdateStackSet`.

### Rollout flow

```
Subscribe(tenant, component)
  ↓
marketplace-api Lambda:
  ├── Upsert StackSet marketplace-<component> @ current_version (idempotent)
  │     - template body = S3 HTTP URL for current version's template.json
  │     - administration role = arn:aws:iam::<marketplace>:role/AWSCloudFormationStackSetAdministrationRole
  │     - execution role = AWSCloudFormationStackSetExecutionRole (service-managed)
  └── Create stack instance in the tenant account + region
        - parameter overrides from subscription.parameters
```

Release a new version:
```
Release(component, version)
  ↓
marketplace-api Lambda:
  ├── UpdateStackSet marketplace-<component> → new template_url (current version)
  └── Invoke UpdateStackInstances with operation-preferences
        - RegionConcurrencyType=SEQUENTIAL
        - FailureToleranceCount=0 (or tenant cohort size)
        - MaxConcurrentCount per cohort
```

Rollback:
```
Rollback(component)
  ↓
marketplace-api Lambda:
  └── UpdateStackSet marketplace-<component> → previous version's template_url
      (StackSet re-applies to all existing instances)
```

## Fallback: Assume-role + Raw CloudFormation

Use only when StackSets cannot express the target set:
- Tenants outside the Organization (rare, but possible for pilot customers).
- Per-tenant overrides that StackSet parameter overrides cannot model (e.g., tenant-specific nested stacks or templates that differ entirely).
- You need a deploy strategy StackSets does not offer (canary to N tenants then gate on a metric, etc.).

### Shape

- Marketplace Lambda calls `sts:AssumeRole` into `arn:aws:iam::{tenant}:role/MarketplaceAdmin`.
- Using the scoped credentials, it calls `CreateStack` / `UpdateStack` / `DeleteStack` directly with the S3 template URL.
- Status is polled via Step Functions or EventBridge rule on the tenant-side `CloudFormation StackStatusChange` event (requires a cross-account EventBridge bus).

## `MarketplaceAdmin` Role (both mechanisms)

Every tenant account has an IAM role named `MarketplaceAdmin` with:

**Trust policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::<MARKETPLACE_ACCOUNT_ID>:root" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:PrincipalArn": "arn:aws:iam::<MARKETPLACE_ACCOUNT_ID>:role/marketplace-api-lambda" },
      "StringEqualsIfExists": { "sts:ExternalId": "marketplace-v1" }
    }
  }]
}
```

**Permissions:**
- `cloudformation:*` on `arn:aws:cloudformation:*:*:stack/marketplace-*/*` (scoped to marketplace-managed stacks).
- `iam:PassRole` on tenant-scoped CloudFormation service roles.
- Enough privileges to create the resources the components actually need — keep this policy tight and generated from the union of what registered components declare they need (per-component capability contract is a future extension; start with `PowerUserAccess` if you must, but track the todo to tighten it).

The role is provisioned via a **tenant-bootstrap StackSet** that targets the `Tenants` OU. New tenant accounts automatically get the role when they join the OU.

## Rules

1. **Pick one mechanism per component.** Do not mix StackSets and assume-role for the same component — the state machine gets confusing and drift detection breaks.
2. **Never embed tenant-specific values in the template.** Use CloudFormation `Parameters`. Pass them via StackSet parameter overrides or `CreateStack` parameters.
3. **Trust policy must restrict by source principal.** Use `aws:PrincipalArn` or `aws:SourceArn` conditions so only the marketplace Lambda — not any role in the marketplace account — can assume `MarketplaceAdmin`.
4. **Use a StackSet administration role in the marketplace account** (`AWSCloudFormationStackSetAdministrationRole`) — do not give the marketplace Lambda direct trust into the tenant's StackSet execution role.
5. **Scope cloudformation permissions to `stack/marketplace-*`.** Prevents the marketplace from touching tenant-owned stacks it didn't create.
6. **Deploy is asynchronous end-to-end.** The API handler enqueues; a Step Function or event-driven Lambda observes completion and updates `Deployments.status`.
7. **Store the template as an S3 HTTPS URL**, not inline. Large templates exceed the 51,200-byte inline limit, and a URL lets CloudFormation fetch assets by reference.
8. **Deploy cohorts have explicit failure tolerance.** First cohort: 10% of subscribers, fail on any failure. Second cohort: the rest. Log the cohort plan; do not default to all-tenants-at-once.
9. **Idempotency: the StackSet operation name / CloudFormation `ClientRequestToken` MUST come from the `Idempotency-Key`** of the triggering API call. This prevents double deploys when the API Lambda retries.

## ✅ Correct

- `MarketplaceAdmin` trust policy restricts to the marketplace Lambda's exact role ARN via `aws:PrincipalArn`.
- StackSet operation name = `release-<component>-<version>-<idempotency-key>`.
- A release of component `analytics-api` updates the StackSet template URL and invokes `UpdateStackInstances` with a cohort plan.

## ❌ Incorrect

- Lambda has `AdministratorAccess` on the tenant account via a role that trusts the entire marketplace account.
- Deploys use inline CloudFormation `TemplateBody` without the S3 asset bundle.
- Unsubscribe deletes the DynamoDB subscription row before CloudFormation confirms `DELETE_COMPLETE` (leaves orphan stacks).
- Release updates the StackSet but never invokes `UpdateStackInstances` (existing subscribers stay on the old version).
