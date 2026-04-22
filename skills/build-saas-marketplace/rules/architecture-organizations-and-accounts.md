---
title: AWS Organizations & Accounts
impact: CRITICAL
tags: [aws-organizations, multi-tenancy, accounts, ous, scps]
---

# AWS Organizations & Accounts

Multi-tenancy in this marketplace is implemented at the AWS account boundary: **one AWS account per customer**. This is the strongest isolation AWS offers (separate IAM, separate quotas, separate billing namespace) and it removes an entire class of noisy-neighbor and privilege-escalation bugs.

## Rules

1. **Use AWS Organizations.** The marketplace account is the Organizations management account, or a delegated administrator for StackSets and (optionally) IAM Identity Center.
2. **One customer = one account.** Never co-locate two customers in the same account.
3. **Tenant accounts are created programmatically** via the Organizations `CreateAccount` API (directly, via Control Tower, or via Account Factory for Terraform/CDK). The marketplace's onboarding flow owns creation — do NOT let customers bring their own unmanaged accounts.
4. **OUs form a fixed skeleton.** Add tiers or regions as child OUs; do not re-shape the top level.

## Required OU Layout

```
Root
├── Marketplace OU
│   └── <marketplace-account>
├── Shared-Services OU (optional)
│   ├── <log-archive-account>
│   └── <security-tooling-account>
├── Tenants OU
│   ├── <tenant-123456789012>
│   ├── <tenant-234567890123>
│   └── ...
└── Suspended OU
    └── <offboarded or delinquent tenants, denied everything by SCP>
```

## Required SCPs

Apply at the `Tenants` OU (inherited by every tenant):

1. **Deny leaving the Org.**
   ```json
   { "Effect": "Deny", "Action": "organizations:LeaveOrganization", "Resource": "*" }
   ```
2. **Deny disabling guardrails.**
   ```json
   { "Effect": "Deny", "Action": [
       "cloudtrail:StopLogging",
       "cloudtrail:DeleteTrail",
       "config:DeleteConfigurationRecorder",
       "config:StopConfigurationRecorder"
     ], "Resource": "*" }
   ```
3. **Deny modifying the `MarketplaceAdmin` role** (the role the marketplace assumes into the tenant).
   ```json
   { "Effect": "Deny",
     "Action": ["iam:DeleteRole", "iam:UpdateAssumeRolePolicy", "iam:AttachRolePolicy",
                "iam:DetachRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"],
     "Resource": "arn:aws:iam::*:role/MarketplaceAdmin" }
   ```
4. **Deny root user access keys / sign-in widening**, per standard multi-account hygiene.

Apply at the `Suspended` OU:

- Deny all IAM, Compute, and Storage mutations (effectively freezing the account) while the business decides re-activation vs. close.

## StackSet Trust

If using CloudFormation StackSets with service-managed permissions (the default — see `implementation-cross-account-deploy.md`), enable trusted access for CloudFormation StackSets in the Organizations console or via:

```bash
aws organizations enable-aws-service-access \
  --service-principal member.org.stacksets.cloudformation.amazonaws.com
```

This lets the management account provision the `AWSCloudFormationStackSetExecutionRole` in every tenant account automatically.

## ✅ Correct

- Tenant accounts live under `Tenants` OU, SCPs applied at the OU, `MarketplaceAdmin` role provisioned via a tenant-bootstrap StackSet.
- New customers trigger a Step Function that calls `CreateAccount`, waits for success, moves the account into `Tenants` OU, and deploys the tenant-bootstrap StackSet.

## ❌ Incorrect

- A single "shared-tenant" account with per-customer IAM roles (weaker isolation, billing nightmare).
- Customers bringing pre-existing accounts outside the Org and the marketplace deploying into them by assume-role only (no SCP protection, no guaranteed guardrails).
- `MarketplaceAdmin` role with a wildcard principal in its trust policy (any AWS account can assume).
