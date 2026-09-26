---
title: Domain Ontology
impact: HIGH
tags: [ontology, terminology, foundation, dns]
---

# Domain Ontology

Use these terms exactly. Do NOT introduce synonyms.

## Terms

| Term | Definition |
| --- | --- |
| **Root domain** | The single apex domain (e.g. `provider.xyz`) registered at the registrar and hosted in the marketplace account. |
| **Parent hosted zone** | The Route 53 hosted zone for the root domain. Lives in the marketplace account. There is exactly one. |
| **Environment subdomain** | A subdomain of the form `<env-slug>.provider.xyz` assigned to one tenant environment. |
| **Env slug** | A lowercase, dash-separated, immutable identifier derived from `(tenant, environment)` (e.g. `acme-prod`). Becomes the leftmost label of the environment subdomain. |
| **Child hosted zone** | The Route 53 hosted zone for an environment subdomain. Lives in the **tenant** account. One per environment. |
| **NS delegation** | The `NS` record set in the parent zone for `<env-slug>.provider.xyz` whose values are the four nameservers of the child zone. Constitutes transfer of authority. |
| **Tenant certificate** | The ACM certificate for `<env-slug>.provider.xyz` (and `*.<env-slug>.provider.xyz`) issued in the tenant account. |
| **Base path** | A first-segment path under the environment subdomain (e.g. `billing` in `https://acme-prod.provider.xyz/billing`) reserved by exactly one component. |
| **Domain handle** | An SSM Parameter Store entry under `/<env>/domain/...` that other products read to discover the environment's domain resources. |

## Rules

1. **One root domain per marketplace deployment.** Multiple roots are out of scope.
2. **Env slug is immutable.** Renaming a tenant or environment never changes the existing slug. Add an alias if needed.
3. **One environment = one subdomain = one child zone.** No sharing of subdomains across environments.
4. **`NS` delegation is the boundary of authority.** Once written, the marketplace MUST NOT create any other record under `<env-slug>.provider.xyz` in the parent zone.
5. **Base paths are flat.** Reserve `billing`, not `billing/v1`. Sub-paths are owned by the component that holds the base path.

## Identifier Examples

| Thing | Example |
| --- | --- |
| Root domain | `provider.xyz` |
| Env slug | `acme-prod`, `globex-staging` |
| Environment subdomain | `acme-prod.provider.xyz` |
| Base path | `billing`, `analytics`, `app` |
| Domain handle key | `/acme-prod/domain/subdomain` |
