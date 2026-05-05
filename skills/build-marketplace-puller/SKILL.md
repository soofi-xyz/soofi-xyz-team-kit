---
name: build-marketplace-puller
description: "Guides building the Marketplace Puller — a standalone marketplace product that runs **inside every tenant environment** and continuously pulls released versions of the components that environment is subscribed to. Provides a tenant-side counterpart to the marketplace's push-based deploys: it polls the central marketplace catalog on a schedule, discovers newer released versions of subscribed components, fetches the synthesized artifacts, hands them to the Deployer running in the marketplace account (or to a tenant-local CFN executor when StackSets is unavailable), and reconciles drift. Triggers on: marketplace puller, tenant-side reconciler, pull-based deploys, drift reconciliation, version polling, autonomous tenant updater, edge environment updater."
---

# Building the Marketplace Puller

This skill builds **one** of the four standalone products in the marketplace ecosystem. It is the only product that runs **in the tenant account** rather than in the marketplace account, and is the second component subscribed during customer onboarding (right after the Tenant Domain Router). It is itself a marketplace component (`cdk synth` → register → release → subscribe).

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). Consult it for the current Puller service route map, webhook contracts, workflow requirements, and infrastructure topology before implementation.

Load this skill alongside `skills/build-saas-marketplace/` whenever you are working on tenant-side reconciliation, "should this customer have the latest version", drift detection, or "tenant is in an air-gapped network and can't be pushed to".

## Why a Puller in Addition to Push?

The default marketplace path is push: releasing a component triggers redeploys via the Deployer in the marketplace account. The Puller exists because:

1. **Drift reconciliation.** A tenant operator may modify the deployed stack manually (or another tool may). The puller detects the drift on its schedule and re-applies the released version.
2. **Eventual consistency for missed pushes.** If a release event was lost, the marketplace push will not retry forever. The puller closes the gap.
3. **Tenant-paced rollouts.** Some customers want to opt into updates on their own schedule (e.g., business-hours only). The puller exposes a per-environment update window.
4. **Edge / air-gapped tenants.** Tenants outside the AWS Organization (or with extra-restrictive networking) cannot accept inbound StackSet operations from the marketplace. The puller runs locally and pulls.
5. **Audit redundancy.** Two independent paths to the same desired state catch silent failures in either path.

The puller is not a replacement for push; it is a reconciliation loop that converges to the same desired state.

## What This Product Owns

1. **A scheduled Lambda** in each tenant environment (default: every 15 minutes) that polls the marketplace catalog API.
2. **A subscription cache** in the tenant: which components is this environment subscribed to, and what version is currently deployed (read from CloudFormation describe-stacks, not from a local DB).
3. **A pull request flow** that calls the marketplace `GET /environments/{env_id}/desired-state` to receive the authoritative `(component, released_version)` list for the environment.
4. **A reconciler** that, for each `(component, released_version)` where the live stack version != released, enqueues a deploy intent — either by calling the marketplace `POST /deploys` (preferred) or by executing CloudFormation locally via the tenant-local executor (fallback).
5. **An update-window policy** stored in tenant SSM `/marketplace/puller/window` (e.g. `mon-fri 02:00-06:00 UTC`) that the reconciler honors before enqueuing.

## Architecture

```
┌──────────────── Tenant account (per environment) ─────────────────┐
│                                                                   │
│   EventBridge schedule (rate(15 minutes))                         │
│         ▼                                                         │
│   Puller Lambda                                                   │
│     1. Read /marketplace/puller/window — gate by current time     │
│     2. Resolve introspection: who am I (env_id, customer_id)      │
│     3. GET https://api.<provider>/environments/{env_id}/desired-state
│     4. For each (component, version): describe-stacks tag check   │
│     5. If drift: POST https://api.<provider>/deploys              │
│     6. Write tenant-local /marketplace/puller/last-run SSM        │
│                                                                   │
│   Tenant-local CFN executor (fallback adapter):                   │
│     - SQS + Step Function inside the tenant                       │
│     - Used only when component manifest sets adapter=tenant-local │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                           │
                           │ (HTTPS, signed with the env's API key)
                           ▼
┌──────────────── Marketplace account (control plane) ──────────────┐
│   GET /environments/{env_id}/desired-state                        │
│   POST /deploys                                                   │
│   (auth via shared Lambda authorizer from build-tenant-account-mgr)│
└───────────────────────────────────────────────────────────────────┘
```

## Required Implementation Checklist

- [ ] EventBridge schedule installed in every tenant subscribed to this product (default: 15 min)
- [ ] Puller Lambda authenticates to marketplace using a per-environment API key stored in tenant Secrets Manager (`/<env>/puller/marketplace-api-key`)
- [ ] API key for the puller is itself rotated by the Account Manager; the puller reads the current value via Secrets Manager every invocation
- [ ] `GET /environments/{env_id}/desired-state` endpoint exists in the marketplace and returns the canonical list
- [ ] Drift detection compares live stack tag `marketplace:version` to desired version, plus stack drift detection on supported resource types
- [ ] Reconcile path defaults to enqueueing through the marketplace `POST /deploys`; falls back to tenant-local executor only when configured
- [ ] Update window honored: reconciler logs and exits without enqueueing outside the window
- [ ] `/marketplace/puller/last-run` SSM parameter updated every successful run
- [ ] CloudWatch alarm on no-successful-run-in-2h
- [ ] Idempotent against concurrent invocations (single-execution lock via DynamoDB conditional write)

## Desired-State API (server side)

The marketplace exposes a single read endpoint the puller calls:

```
GET /environments/{env_id}/desired-state
Authorization: Bearer sk_<env-prefix>_...

200 OK
{
  "env_id": "env_01H...",
  "env_slug": "acme-prod",
  "tenant_account_id": "123456789012",
  "subscriptions": [
    { "component": "billing-worker",  "released_version": "1.4.2", "release_id": "rel_01H...", "adapter": "stackset" },
    { "component": "analytics-api",   "released_version": "0.9.0", "release_id": "rel_01H...", "adapter": "stackset" },
    { "component": "tenant-domain-router", "released_version": "2.0.0", "release_id": "rel_01H...", "adapter": "stackset" }
  ],
  "computed_at": "2026-04-29T12:34:56Z",
  "etag": "W/\"..\""
}
```

The puller MAY send `If-None-Match` to skip processing on `304 Not Modified`.

Read `rules/integration-desired-state-contract.md`.

## Reconciler Logic

```
for sub in desired_state.subscriptions:
    stack_name = f"{sub.component}-{env_slug}"
    live = describe_stack(stack_name)
    live_version = live.tags.get("marketplace:version") if live else None

    if live_version == sub.released_version:
        continue  # in sync

    if not in_update_window(now):
        log("drift_skipped_outside_window", sub.component, live_version, sub.released_version)
        continue

    POST /deploys {
        component: sub.component,
        version: sub.released_version,
        env_slug: env_slug,
        intent_source: "puller",
        intent_id: f"puller-{env_slug}-{sub.component}-{sub.released_version}"
    }
```

`intent_id` makes the `POST /deploys` idempotent against the marketplace's existing dedup window — re-enqueuing the same intent within minutes is a no-op.

Read `rules/implementation-reconciler.md`.

## Modes

| Mode | When | Adapter |
| --- | --- | --- |
| **push-primary, pull-reconcile** | Default. Marketplace push handles releases; puller closes drift. | Reconciler calls `POST /deploys` → marketplace executes via Deployer. |
| **pull-only** | Tenants outside the AWS Org or with no inbound trust to marketplace. | Reconciler runs the **tenant-local CFN executor** stack, which the puller installs as part of its own component. |
| **disabled** | Tenant explicitly requests no pull (paused for incident). | Schedule disabled; SSM `/marketplace/puller/enabled=false`. |

Read `rules/architecture-modes.md`.

## Non-Negotiable Principles

1. **Desired state is the marketplace's truth.** The puller never decides what version to run; it only converges to whatever the marketplace says.
2. **Authentication is the shared auth model.** The puller carries an env-scoped API key minted by the Account Manager. There is no special "puller key" type.
3. **Single instance per environment.** Concurrent puller invocations are gated by a DynamoDB conditional write so two schedule overlaps cannot both reconcile.
4. **Update windows are respected.** Drift detected outside the window is logged but not acted on.
5. **The puller is a marketplace component, deployed by the Deployer like any other.** No special bootstrap.
6. **No business-state writes to the marketplace.** The puller can `GET` desired-state and `POST` deploy intents — nothing else.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Puller Ontology | `rules/foundation-puller-ontology.md` | HIGH |
| Modes | `rules/architecture-modes.md` | CRITICAL |
| Desired-State Contract | `rules/integration-desired-state-contract.md` | CRITICAL |
| Reconciler | `rules/implementation-reconciler.md` | CRITICAL |
| Drift Detection and Verification | `rules/delivery-drift-and-verification.md` | HIGH |
