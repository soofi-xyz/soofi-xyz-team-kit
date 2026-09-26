---
title: Marketplace Ontology
impact: HIGH
tags: [ontology, terminology, foundation]
---

# Marketplace Ontology

The marketplace has a small, non-negotiable vocabulary. Do NOT reuse these terms for anything else, and do NOT invent synonyms.

## Terms

| Term | Definition |
| --- | --- |
| **Marketplace** | The system that distributes SaaS products to customer AWS accounts. Lives in the marketplace account. |
| **Marketplace account** | The single AWS account that hosts the marketplace control plane (APIs, registry, audit). Also the AWS Organizations management account (or a delegated admin). |
| **Tenant account** | An AWS account that belongs to exactly one customer. One account per customer. Lives under the `Tenants` OU. |
| **Component** | A named, versioned deployable unit. The artifact is a synthesized CloudFormation bundle produced by `cdk synth`. |
| **Version** | An immutable `(component, version)` tuple. Re-registering the same version is rejected. |
| **Release** | The pointer to the currently "released" version of a component. Releasing a new version triggers redeploys to all subscribers. |
| **Rollback** | Restoring the previously released version as the current release. Triggers redeploys to all subscribers. |
| **Subscription** | A link from a tenant account to a component. While the subscription exists, the current released version of the component is deployed in the tenant. |
| **Deployment** | A single applied state transition in a tenant account: create / update / delete of a component's CloudFormation stack. |
| **Marketplace product** | The marketplace itself, built as a component, registered in its own registry, and deployed into its own account. |

## Rules

1. **Do NOT conflate "component" with "stack".** A component is the artifact + metadata. A stack is the live CloudFormation resource in a tenant account. One component produces one stack per subscribed tenant.
2. **Do NOT conflate "version" with "release".** Versions are write-once; releases are mutable pointers.
3. **Do NOT reuse "tenant" to mean anything other than an AWS account.** If a product has its own notion of tenants inside a tenant account, use a different word (e.g., "end user", "workspace") and document it.
4. **Every identifier is lowercase kebab-case** for component names, and semver `MAJOR.MINOR.PATCH` for versions. AWS account IDs are 12-digit strings.

## Identifier Examples

| Thing | Example |
| --- | --- |
| Component name | `analytics-api`, `billing-worker`, `marketplace` |
| Version | `1.0.0`, `2.3.1-rc.4` |
| Tenant account ID | `123456789012` |
| Subscription key | `(123456789012, analytics-api)` |
| Artifact S3 key | `s3://component-artifacts/analytics-api/1.0.0/template.json` |
