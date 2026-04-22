---
title: Centralized Control Plane
impact: CRITICAL
tags: [architecture, control-plane, data-plane, separation-of-concerns]
---

# Centralized Control Plane

The marketplace is a **control plane** in the marketplace account. Tenant accounts are **data planes**. The boundary is strict and one-directional.

## Responsibilities

### Marketplace account (control plane)

- Authenticates operator / CI callers.
- Owns the canonical state: which components exist, which versions are registered, which version is released, which tenants are subscribed.
- Owns artifact storage (S3) and registry metadata (DynamoDB).
- Initiates all cross-account deploys.
- Produces all audit events.

### Tenant account (data plane)

- Hosts the deployed stacks, one per subscribed component.
- Hosts the `MarketplaceAdmin` role the marketplace assumes into.
- Hosts nothing the marketplace reads from for state — state lives only in the marketplace account.

## Rules

1. **Traffic is one-way.** Marketplace → tenant. Tenants MUST NOT call any marketplace write API. Read-only status endpoints may exist, but they are not part of the six operations.
2. **State lives only in the marketplace account.** The marketplace's source of truth for `Components`, `Versions`, `Releases`, `Subscriptions`, `Deployments` is in the marketplace account's DynamoDB tables and S3 bucket. Tenant accounts may hold derived state (a stack exists, a parameter has a value), but that state is reconstructable from the marketplace's records.
3. **No shared mutable state across tenants.** A deploy into tenant A MUST NOT observe or modify state in tenant B. This rules out "shared bucket with per-tenant prefix" patterns for anything on the tenant-workload path.
4. **The marketplace can upgrade itself.** The Marketplace product is a component. The same API that ships `analytics-api` v2.0.0 to a tenant also ships `marketplace` v2.0.0 to the marketplace account. This forces you to keep the artifact contract, the deploy mechanism, and the rollback path solid.

## Component vs. Stack Mapping

```
Component "analytics-api"
 ├── Version 1.0.0 ─── (registered, previous release)
 ├── Version 1.1.0 ─── (registered, current release)
 └── Version 1.2.0-rc.1 (registered, not released)

Subscriptions:
 ├── tenant 111111111111 → stack "analytics-api" @ 1.1.0
 ├── tenant 222222222222 → stack "analytics-api" @ 1.1.0
 └── tenant 333333333333 → stack "analytics-api" @ 1.1.0
```

Each subscription yields exactly one CloudFormation stack in the tenant account, named after the component (`analytics-api` above). The stack name is the component name; the version is tracked in DynamoDB and echoed into the stack's tags (`marketplace:component`, `marketplace:version`).

## ✅ Correct

- The Marketplace API is the only writer of `Components`, `Versions`, `Releases`, `Subscriptions`.
- The marketplace Lambda holds an IAM role with `sts:AssumeRole` on `arn:aws:iam::*:role/MarketplaceAdmin` and nothing tenant-side.
- Rollback for tenant X reads `Releases.rollback_target` in the marketplace DynamoDB, not tenant X's stack history.

## ❌ Incorrect

- Tenant accounts call a `/subscriptions` endpoint to self-enroll (broken trust boundary, tenants should not mutate marketplace state).
- "Source of truth" for what version a tenant is running is inferred from tenant CloudFormation drift (slow, racy, wrong).
- Marketplace Lambda has `iam:*` on tenant accounts instead of a scoped `MarketplaceAdmin` role (too much blast radius, SCP circumvention risk).
