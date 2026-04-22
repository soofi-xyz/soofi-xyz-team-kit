---
title: Bootstrap & Testing
impact: HIGH
tags: [bootstrap, onboarding, testing, smoke-test, self-hosting]
---

# Bootstrap & Testing

Before the marketplace can ship anything, its account, its Organizations layout, and its tenants must be bootstrapped. Before it can be trusted, it must pass an end-to-end smoke test and a self-hosting test.

## Bootstrap Order

Run these in order. Later steps depend on earlier steps.

### Step 1 — AWS Organizations

1. Enable AWS Organizations in the marketplace (management) account.
2. Create OUs: `Marketplace`, `Tenants`, `Suspended` (and `Shared-Services` if used).
3. Move the marketplace account into `Marketplace` OU.
4. Enable service-managed StackSets trust:
   ```bash
   aws organizations enable-aws-service-access \
     --service-principal member.org.stacksets.cloudformation.amazonaws.com
   ```
5. Attach SCPs (see `architecture-organizations-and-accounts.md`) to `Tenants` and `Suspended` OUs.

### Step 2 — Marketplace control plane

Deploy the marketplace's own CDK stack into the marketplace account. The stack provisions:

- DynamoDB tables: `Components`, `Versions`, `Releases`, `Subscriptions`, `Deployments`, `Idempotency`.
- S3 bucket: `component-artifacts`, versioned, KMS-encrypted, bucket policy locking writes to the marketplace API Lambda role.
- API Gateway REST API with IAM auth and the six routes.
- Lambda `marketplace-api` with the per-operation handler.
- Step Functions state machine `deploy-fsm`.
- EventBridge rule on CloudFormation StackSet status changes.
- IAM role `marketplace-api-lambda` with `sts:AssumeRole` on `arn:aws:iam::*:role/MarketplaceAdmin` and the StackSet administration role.
- CloudFormation StackSet **administration role** (`AWSCloudFormationStackSetAdministrationRole`) in the marketplace account.

### Step 3 — Tenant-bootstrap StackSet

Create a StackSet in the marketplace account targeting the `Tenants` OU that provisions in every tenant:

- `MarketplaceAdmin` IAM role with the trust policy from `implementation-cross-account-deploy.md`.
- `AWSCloudFormationStackSetExecutionRole` (automatic with service-managed StackSets, but verify).
- CloudTrail trail forwarding to the central log account (if using Shared-Services).

Every new tenant account that joins `Tenants` OU automatically receives this StackSet — no per-tenant manual work.

### Step 4 — Onboard a throwaway tenant

1. Call `organizations:CreateAccount` with `RoleName=MarketplaceAdmin`, which creates the account and a bootstrap admin role.
2. Move the new account into `Tenants` OU.
3. Wait for tenant-bootstrap StackSet to converge (check `DescribeStackInstance`).
4. Record the tenant account ID for smoke tests.

### Step 5 — Register the Marketplace as a component

Bootstrapping complete. The marketplace control plane is now deployed directly via CDK, but to prove the self-hosting invariant:

1. `cd cdk/marketplace-product && cdk synth -o cdk.out`
2. Tar + upload the output as component `marketplace`, version `1.0.0`.
3. Release it.
4. Subscribe the marketplace account itself (yes, the marketplace account is also a tenant of one component: `marketplace`).
5. Observe the deploy overlay onto the already-running stack — version should be stamped in tags.

From this point forward, every upgrade of the marketplace goes through the marketplace API.

## End-to-End Smoke Test

Run this on every PR that touches the marketplace. Uses a single throwaway tenant account provisioned in Step 4.

```
1. register "smoke-test" version 0.1.0   → assert Versions row + S3 artifact
2. release  "smoke-test" version 0.1.0   → assert Releases.current_version = 0.1.0
3. subscribe tenant → "smoke-test"        → assert Subscriptions row + stack created in tenant
4. register "smoke-test" version 0.2.0
5. release  "smoke-test" version 0.2.0   → assert tenant stack updated, tag marketplace:version=0.2.0
6. rollback "smoke-test"                  → assert tenant stack back to 0.1.0
7. unsubscribe tenant from "smoke-test"   → assert stack deleted + Subscriptions row removed
8. list components                         → assert "smoke-test" still listed (component persists, subscription did not)
```

The smoke-test component is a minimal CDK stack with one SSM parameter — fast to deploy, cheap to delete, easy to assert on.

## Self-Hosting Test

Run this quarterly or on any breaking change to the marketplace's own schema:

```
1. build latest marketplace from main
2. cdk synth → package → register "marketplace" version X.Y.Z via the current marketplace API
3. release "marketplace" version X.Y.Z
4. observe the StackSet / assume-role deploy update the marketplace's own stack
5. verify the API still answers and DynamoDB reads are consistent
6. rollback "marketplace"; verify rollback succeeds
```

If the self-hosting test fails, the marketplace is not shippable.

## Rules

1. **Every bootstrap step is idempotent.** Re-running the bootstrap CDK stack, the tenant-bootstrap StackSet, or the onboarding Step Function MUST be safe.
2. **Do NOT hand-edit tenant accounts.** Everything tenant-side is StackSet-managed or marketplace-deployed. Manual IAM edits in tenant accounts are blocked by SCP.
3. **Smoke test runs against real AWS**, not LocalStack. Cross-account IAM, StackSets, and Step Functions behaviors do not mock correctly. Keep a dedicated `marketplace-test` Org with a rotating pool of throwaway tenant accounts.
4. **Tear down test tenants after N days.** A scheduled Lambda closes accounts whose tag `marketplace:lifecycle=test-tenant` is older than N days, to avoid per-month account sprawl and cost.
5. **Observability is part of delivery.** Before shipping: CloudWatch dashboards for API latency per endpoint, deploy Step Function success rate, StackSet operation error rate, and age of the oldest `in_progress` deployment.

## ✅ Correct

- Onboarding a new real customer runs the exact same Step Function as the test onboarding — no manual steps.
- The marketplace upgrades itself via `POST /components/marketplace/release`.
- The smoke test CI job runs full register → release → subscribe → rollback → unsubscribe against a real throwaway tenant.

## ❌ Incorrect

- Tenant-bootstrap role created by a manual `aws iam create-role` in every new tenant account.
- Marketplace upgraded by running `cdk deploy` from an engineer's laptop (bypasses the registry, breaks self-hosting guarantee).
- Smoke test passes against a mocked CloudFormation — real bugs hide.
