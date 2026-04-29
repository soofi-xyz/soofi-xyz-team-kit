---
title: Puller Ontology
impact: HIGH
tags: [ontology, terminology, foundation]
---

# Puller Ontology

| Term | Definition |
| --- | --- |
| **Puller** | The Lambda-on-schedule running in a tenant account that polls marketplace desired state. |
| **Desired state** | The marketplace-authoritative list of `(component, released_version)` for an environment. |
| **Live version** | The version currently deployed in the tenant, read from CloudFormation stack tag `marketplace:version`. |
| **Drift** | Any `(component)` where `live_version != released_version`, OR any stack drift reported by CloudFormation drift detection. |
| **Reconcile** | The act of converging live state to desired state — by enqueuing a deploy intent. |
| **Update window** | A cron-style schedule per environment defining when reconciliation may execute. |
| **Mode** | One of `push-primary`, `pull-only`, `disabled`. |
| **Tenant-local executor** | An optional in-tenant Step Function + SQS that the puller uses when mode is `pull-only`. |
| **Single-execution lock** | DynamoDB conditional write the puller uses to serialize concurrent invocations of itself. |

## Rules

1. **The puller never holds desired state locally.** It re-reads from the marketplace every tick.
2. **The puller never decides versions.** It only enqueues converging deploys.
3. **Drift detection is read-only.** The puller never repairs drift inside a stack; it always re-applies the released template via the deploy path.
4. **Modes are environment-scoped**, not tenant-wide. A customer may run `prod` in `push-primary` and `staging` in `pull-only`.
