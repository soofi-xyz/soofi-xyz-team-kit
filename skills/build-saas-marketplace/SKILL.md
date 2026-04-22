---
name: build-saas-marketplace
description: "Guides creation of a multi-tenant SaaS distribution marketplace on AWS. Covers AWS Organizations-backed per-customer account isolation, a centralized marketplace control plane that governs tenant accounts, a component registry for CloudFormation bundles produced by `cdk synth`, the six marketplace operations (register, release, rollback, list, subscribe, unsubscribe), cross-account deployment via CloudFormation StackSets or assume-role, and tenant bootstrap. Triggers on: saas marketplace, multi-tenant aws, account-per-tenant, cross-account deploy, cloudformation stacksets, component registry, release rollback subscribe, aws organizations tenants, cdk synth distribution, marketplace product."
---

# Building a SaaS Marketplace

Step-by-step guide for designing and deploying a multi-tenant SaaS distribution marketplace on AWS. The marketplace is the system that ships **components** (CloudFormation bundles) into **tenant AWS accounts** (one account per customer) and keeps their lifecycle (register, release, rollback, subscribe, unsubscribe) under a central control plane.

## Core Model

Three objects, kept strictly separate:

- **Component** — a named, versioned CloudFormation bundle produced by `cdk synth`. The registered artifact is the *synthesized* output (`template.json` + `cdk.out/` assets), NOT the source code.
- **Release** — a pointer to exactly one `(component, version)` that is currently "released". Releasing triggers re-deploy to all subscribers of that component.
- **Subscription** — a link from a tenant account to a component. When a tenant is subscribed, the currently released version of that component is deployed into the tenant account.

The marketplace itself is a component too — it is built with CDK, synthesized, registered, and deployed like any other component. This is how the marketplace upgrades and rolls back itself.

## Architecture: Centralized Control Plane, Per-Tenant Data Plane

```
┌─────────────────────────────── AWS Organizations ───────────────────────────────┐
│                                                                                 │
│   ┌──────────────────── Marketplace account (control plane) ────────────────┐   │
│   │                                                                         │   │
│   │   API Gateway → Lambda (Marketplace API)                                │   │
│   │   │                                                                     │   │
│   │   ├─ DynamoDB: Components / Versions / Releases / Subscriptions         │   │
│   │   ├─ S3:       component-artifacts/<component>/<version>/{template,assets}
│   │   ├─ CloudFormation StackSets (service-managed)                         │   │
│   │   └─ EventBridge + audit log (DynamoDB stream → S3)                     │   │
│   │                                                                         │   │
│   └───────────────────────────── assume role / StackSet target ─────────────┘   │
│                                    ▼                                             │
│   ┌──────────────────── Tenant account (data plane, per-customer) ─────────┐   │
│   │                                                                         │   │
│   │   IAM role: MarketplaceAdmin (trust: marketplace account only)          │   │
│   │   CloudFormation stacks, one per subscribed component                   │   │
│   │   Customer workloads deployed by each stack                             │   │
│   │                                                                         │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

The control plane owns state, APIs, and orchestration. The data plane owns nothing the marketplace cares about except the deployed stacks themselves — tenant workloads are inside those stacks.

Read `rules/architecture-organizations-and-accounts.md` and `rules/architecture-centralized-control-plane.md`.

## Required Implementation Checklist

Copy this into the working todo list and keep it updated. Do NOT mark the marketplace complete while any required item is still unchecked.

- [ ] AWS Organizations enabled in the marketplace (management) account
- [ ] Core OUs created: `Marketplace`, `Tenants`, `Suspended`
- [ ] SCPs deny tenant accounts from leaving the Org, disabling CloudTrail, or creating new Organizations
- [ ] Service-managed CloudFormation StackSets trust enabled (or explicit assume-role plan documented if StackSets is not used)
- [ ] `MarketplaceAdmin` role exists in every tenant account, trusting only the marketplace account
- [ ] DynamoDB tables: `Components`, `Versions`, `Releases`, `Subscriptions`, `Deployments` (or their documented equivalents)
- [ ] S3 bucket for component artifacts, with bucket policy denying writes except from the Marketplace API Lambda role
- [ ] Marketplace API exposes the six endpoints with documented request/response schemas and idempotency keys
- [ ] Artifact contract is enforced on registration: only accept output of `cdk synth`; reject source uploads
- [ ] Release triggers redeploy to all subscribers; rollback restores the previous released version and redeploys
- [ ] Subscribe deploys the current released version; unsubscribe deletes the stack in the tenant
- [ ] Every write path is idempotent (idempotency key or conditional write)
- [ ] Every state transition produces a durable audit event (who, what, when, result)
- [ ] Marketplace can register, release, and roll back *itself* using the same API (self-hosting test passes)
- [ ] End-to-end smoke test against a throwaway tenant account: register → release → subscribe → rollback → unsubscribe

## Workflow: Six Phases

Follow these phases in order. Each phase gates the next — do NOT skip ahead.

### Phase 1 — Tenancy & Organizations

Confirm the tenancy model before any code:

1. **One AWS account per customer.** Accounts are created inside AWS Organizations, under the `Tenants` OU. Shared-account multi-tenancy is out of scope for this skill.
2. **Marketplace account is the Organizations management account** (or a delegated administrator for StackSets and IAM Identity Center). The marketplace account holds the control plane and billing surface for the platform itself.
3. **OUs:**
   - `Marketplace` — contains the marketplace account (+ any supporting shared-services accounts).
   - `Tenants` — contains one child OU per customer tier if needed, otherwise a flat list of tenant accounts.
   - `Suspended` — quarantine OU for offboarded or delinquent tenants.
4. **SCPs** applied at the `Tenants` OU:
   - Deny `organizations:LeaveOrganization`.
   - Deny disabling CloudTrail / Config.
   - Deny IAM user creation with `*` privileges if that matches your policy.
   - Deny modifying the `MarketplaceAdmin` role or its trust policy.

Read `rules/architecture-organizations-and-accounts.md` and `rules/foundation-marketplace-ontology.md`.

### Phase 2 — Component Artifact Contract

Define exactly what a producer uploads to register a component:

1. The producer runs `cdk synth` locally or in CI. The output is `cdk.out/`.
2. The registration payload is a single archive containing:
   - `template.json` (or `<stack-name>.template.json`) — the root CloudFormation template.
   - `assets/` — every file referenced by `asset.*` in the template (lambda zips, container image digests, nested templates).
   - `manifest.json` — the CDK manifest, used to resolve which file maps to which `asset.*` parameter.
3. The marketplace stores the artifact at `s3://component-artifacts/<component>/<version>/` and records metadata (checksum, registered-by, registered-at, `cdk` version, synthesized-at) in DynamoDB.
4. Artifacts are **immutable**. Re-uploading the same `(component, version)` is rejected; producers must bump the version.
5. The marketplace NEVER runs `cdk synth` at deploy time. It deploys the stored template as-is, with StackSet parameters or CloudFormation `Parameters` overriding tenant-specific values.

Read `rules/integration-component-artifact-contract.md`.

### Phase 3 — Component Registry

Implement the state store. Default shape:

| Table | Partition key | Sort key | Purpose |
| --- | --- | --- | --- |
| `Components` | `component_name` | — | one row per registered component (owner, description, created_at) |
| `Versions` | `component_name` | `version` | one row per `(component, version)` with S3 artifact pointer + checksum |
| `Releases` | `component_name` | — | pointer to the currently released version + previous version (for rollback) |
| `Subscriptions` | `tenant_account_id` | `component_name` | one row per (tenant, component) with currently-deployed version |
| `Deployments` | `subscription_id` | `deployed_at` | append-only audit of every deploy/rollback/redeploy action |

The S3 artifact bucket is the source of truth for bytes; DynamoDB is the source of truth for pointers and state transitions.

Read `rules/implementation-component-registry.md`.

### Phase 4 — Marketplace API (The Six Operations)

All six operations are backed by a single API Gateway + Lambda stack in the marketplace account. Authenticate with IAM SigV4 (or a Cognito / Identity Center identity store) — never with long-lived API keys.

| Operation | Method | Path | Effect |
| --- | --- | --- | --- |
| Register component | `POST` | `/components/{name}/versions` | Upload `cdk synth` artifact; create immutable `(component, version)`. |
| Release component | `POST` | `/components/{name}/release` | Promote a version to current release; enqueue redeploy to all subscribers. |
| Rollback component | `POST` | `/components/{name}/rollback` | Restore previous released version; enqueue redeploy to all subscribers. |
| List components | `GET` | `/components` | Paginated list of components, released version, subscriber count. |
| Subscribe | `POST` | `/subscriptions` | Body: `{ tenant_account_id, component_name }`. Deploy current released version into the tenant. |
| Unsubscribe | `DELETE` | `/subscriptions/{tenant_account_id}/{component_name}` | Delete the stack in the tenant account; remove the row. |

Every write path MUST:

- Accept an `Idempotency-Key` header (or use a natural idempotency key such as `(component, version)` or `(tenant, component)`).
- Emit a structured audit event before returning success.
- Be safe to retry.

Read `rules/implementation-marketplace-api.md`.

### Phase 5 — Cross-Account Deployment

Default mechanism: **CloudFormation StackSets with service-managed permissions**. Each component is represented by a StackSet in the marketplace account; subscriptions become stack-instance target account IDs.

Fallback mechanism: **assume-role + raw CloudFormation** from the marketplace Lambda into the tenant account's `MarketplaceAdmin` role. Use this only when StackSet overrides cannot express the per-tenant parameterization you need, or when you must deploy into accounts outside the Organization.

In both mechanisms:

- The marketplace account has `cloudformation:CreateStackSet`, `cloudformation:CreateStackInstances`, `sts:AssumeRole` on `arn:aws:iam::*:role/MarketplaceAdmin`.
- The `MarketplaceAdmin` role in each tenant account trusts the marketplace account ONLY, with an `aws:SourceAccount` condition.
- Deploys are launched asynchronously. The Lambda writes a `Deployments` audit row with `status=in_progress`, then a follow-up completion event (via EventBridge rule on StackSet status change or Step Functions wait) flips it to `succeeded` / `failed`.

Read `rules/implementation-cross-account-deploy.md`.

### Phase 6 — Subscription & Release Lifecycle

Tie it all together with deterministic state transitions:

1. **Register** — immutable write to `Versions`. No deploy.
2. **Release** — conditional write to `Releases` (new current version, save previous as `rollback_target`). Enqueue one deploy per active subscription of this component.
3. **Rollback** — conditional write to `Releases` (swap `current` ↔ `rollback_target`). Enqueue redeploy per active subscription.
4. **Subscribe** — insert `Subscriptions` row. Look up current `Releases.current_version`. Enqueue deploy of that version into the tenant.
5. **Unsubscribe** — enqueue stack-delete in the tenant. On success, delete the `Subscriptions` row.
6. **List** — read-only aggregation over `Components` + `Releases` + `Subscriptions`.

Read `rules/implementation-subscription-lifecycle.md`.

## Bootstrap & Testing

Before anything works end-to-end you must:

1. Bootstrap AWS Organizations, OUs, SCPs, and enable service-managed StackSets trust.
2. Deploy the Marketplace stack into the marketplace account (API Gateway, Lambda, DynamoDB, S3, EventBridge).
3. Provision at least one throwaway tenant account under `Tenants` OU with the `MarketplaceAdmin` role baked in (automated via Account Factory + a tenant-bootstrap StackSet).
4. Run the end-to-end smoke test: register a trivial component, release it, subscribe the tenant, verify the stack appears in the tenant, roll back, verify, unsubscribe, verify stack deletion.
5. Run the self-hosting test: build the Marketplace product itself with CDK, `cdk synth`, register it, release it, and confirm the marketplace can deploy an updated version of itself into its own account via the same API.

Read `rules/delivery-bootstrap-and-testing.md`.

## Non-Negotiable Principles

1. **One AWS account per customer.** The marketplace does not do shared-account multi-tenancy.
2. **Synthesized artifacts only.** The registry stores `cdk synth` output, not source. The marketplace never re-synthesizes at deploy time.
3. **Immutable versions.** `(component, version)` is write-once. To change code, bump the version.
4. **One-way trust.** Marketplace assumes into tenants; tenants never call the marketplace's write APIs.
5. **Idempotent + audited writes.** Every register / release / rollback / subscribe / unsubscribe is retry-safe and produces a durable audit row.
6. **Marketplace hosts itself.** The Marketplace product is a component built and released through its own API.
7. **CDK is the only IaC source.** The marketplace deploys CloudFormation, but producers author CDK.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Marketplace Ontology | `rules/foundation-marketplace-ontology.md` | HIGH |
| Organizations & Accounts | `rules/architecture-organizations-and-accounts.md` | CRITICAL |
| Centralized Control Plane | `rules/architecture-centralized-control-plane.md` | CRITICAL |
| Component Artifact Contract | `rules/integration-component-artifact-contract.md` | CRITICAL |
| Component Registry | `rules/implementation-component-registry.md` | CRITICAL |
| Marketplace API | `rules/implementation-marketplace-api.md` | CRITICAL |
| Cross-Account Deployment | `rules/implementation-cross-account-deploy.md` | CRITICAL |
| Subscription & Release Lifecycle | `rules/implementation-subscription-lifecycle.md` | CRITICAL |
| Bootstrap & Testing | `rules/delivery-bootstrap-and-testing.md` | HIGH |
