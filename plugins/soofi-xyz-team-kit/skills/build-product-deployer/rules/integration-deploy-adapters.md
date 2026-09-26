---
title: Deploy Adapters
impact: CRITICAL
tags: [integration, adapters, stackset, assume-role]
---

# Deploy Adapters

The Deployer chooses one adapter per deploy intent based on the component manifest. Three exist; do NOT add others without an architecture review.

## `stackset` (default)

- Mechanism: CloudFormation **StackSets** with service-managed permissions across the AWS Organization.
- One StackSet per `(component, region)` lives in the marketplace account.
- Subscribing creates a stack instance targeting the tenant account; the StackSet template is the synthesized template.
- Per-tenant overrides expressed via StackSet `ParameterOverrides`.
- Releasing a new version updates the StackSet template; AWS rolls out to all stack instances in waves.

Use whenever StackSet overrides can express the per-tenant parameterization.

## `assume-role-cfn`

- Mechanism: STS `AssumeRole` into the tenant's `MarketplaceAdmin` role from the Deployer Lambda; raw `cloudformation:CreateStack` / `UpdateStack`.
- One stack per `(component, env)` in the tenant account, named `<componentName>-<envSlug>`.
- Per-tenant overrides expressed as `Parameters` on the stack call directly.

Use only when:

- StackSet overrides cannot express the parameterization (rich JSON parameter blobs, per-region asset hashes, etc.), OR
- The target tenant account is outside the AWS Organization (acquired account, partner integration), OR
- The release cadence requires per-tenant rollout control beyond what StackSet deploy options provide.

## `cdk-pipelines-bootstrap` (bootstrap-only)

- Mechanism: A CodeBuild project in the marketplace account runs `cdk deploy` directly against the marketplace account.
- Used **only** to bring up the Deployer itself before the Deployer's Step Function exists.
- Forbidden for any normal subscribe / release / rollback after bootstrap.

## Per-Adapter Requirements

| Concern | `stackset` | `assume-role-cfn` |
| --- | --- | --- |
| Permissions in marketplace | `cloudformation:*StackSet*`, `cloudformation:*StackInstances*` | `sts:AssumeRole` on `MarketplaceAdmin` |
| Permissions in tenant | service-managed (no role to maintain) | `MarketplaceAdmin` role with `cloudformation:*` and product-required scopes |
| Status polling | `DescribeStackSetOperation` + `ListStackInstances` | `DescribeStacks` |
| Failure rollback | StackSet rollback configuration | `OnFailure=ROLLBACK` |
| Asset upload | StackSet asset bucket replicated per region | Direct upload to tenant CDK asset bucket via assumed role |

## Rules

1. **Choose the adapter at register time, not at deploy time.** The component manifest is the single source of truth.
2. **`stackset` is the default.** Switching to `assume-role-cfn` requires a written justification in the component README.
3. **Asset handling MUST mirror the adapter.** A `stackset` adapter MUST publish assets through the marketplace's StackSet asset bucket; an `assume-role-cfn` adapter publishes through the tenant's CDK asset bucket.
4. **`cdk-pipelines-bootstrap` is reserved for the marketplace bootstrap only.** Operators MUST NOT use it for ad-hoc deploys.
