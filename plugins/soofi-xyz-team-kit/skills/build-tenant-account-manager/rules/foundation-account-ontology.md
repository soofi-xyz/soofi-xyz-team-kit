---
title: Account Ontology
impact: HIGH
tags: [ontology, terminology, foundation, identity]
---

# Account Ontology

| Term | Definition |
| --- | --- |
| **Customer** | The top-level identity that buys the product. Owns one or more environments. ID prefix `cus_`. |
| **Environment** | A deployable unit owned by a customer (e.g. `prod`, `staging`). 1:1 with a tenant AWS account. ID prefix `env_`. |
| **Env slug** | The lowercase, dash-separated string used by the Domain Router as the environment subdomain leftmost label. Derived from `(customer.short_name, environment.name)`. Immutable. |
| **API key** | Credential string of the shape `sk_<env-prefix>_<random>`. Scoped to exactly one environment. ID prefix `key_`. |
| **Bootstrap key** | The very first API key issued for an environment. Created by the provider at customer onboarding (or by the customer at additional-environment creation). |
| **Scopes** | A small enumerated set: `customer:read`, `customer:write`, `env:read`, `env:admin`. Carried by every key. |
| **Whoami** | The introspection result for a key: `(customer_id, env_id, env_slug, tenant_account_id, scopes)`. |

## Rules

1. **IDs are ULIDs prefixed by aggregate type** — `cus_`, `env_`, `key_`. Never raw UUIDs in URLs.
2. **One environment = one AWS account.** No environment-without-account state lasts longer than the account-creation window.
3. **A key belongs to exactly one environment.** Cross-env keys are impossible by construction.
4. **Customer name is mutable; customer ID is not.** Same for environment.
5. **Env slug is immutable** because the Domain Router cements it into DNS.
