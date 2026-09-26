---
title: Parent and Child Zones
impact: CRITICAL
tags: [route53, dns, delegation, architecture]
---

# Parent and Child Zones

The DNS surface is split across two AWS accounts on purpose. Do NOT collapse them into a single zone.

## Layout

| Concern | Account | Resource |
| --- | --- | --- |
| Apex `provider.xyz` SOA / NS / apex records | Marketplace | Parent hosted zone |
| Per-environment `NS` delegation records | Marketplace | Record sets in the parent zone |
| All records under `<env>.provider.xyz` | Tenant | Child hosted zone in the tenant's Route 53 |
| TLS certificate for the environment subdomain | Tenant | ACM in the tenant account (region of the consuming service + `us-east-1` for CloudFront) |

## Why split

1. **Blast radius.** A misbehaving tenant cannot break the apex. The marketplace cannot accidentally rewrite tenant records.
2. **Least privilege.** The marketplace's cross-account role only needs `route53:ChangeResourceRecordSets` on the parent zone for one record set per tenant — the `NS` delegation. It never needs write access into tenant zones.
3. **Tenant autonomy.** The tenant account owns its DNS surface end-to-end and can self-service additional records under its subdomain via its own IaC.

## Delegation Flow

```
1. Marketplace API receives `POST /environments/{env_slug}/domain`
2. Deploy product launches `tenant-subdomain.template.json` in the tenant account
3. Tenant stack creates child hosted zone, returns the 4 NS records as a stack output
4. CloudFormation custom resource calls a Lambda in the marketplace account
5. Marketplace Lambda writes the `NS` record set into the parent zone (idempotent UPSERT)
6. Marketplace Lambda writes the `Deployments` audit row (status=delegated)
```

## Rules

1. **The parent zone is created by the marketplace bootstrap, not by tenant subscriptions.** It is provisioned exactly once when the marketplace itself is bootstrapped. Tenant operations only add `NS` record sets, never the SOA.
2. **`NS` records are written via a CloudFormation custom resource that calls a Lambda in the marketplace account.** Do NOT try to cross-account-write Route 53 records via assume-role from the tenant stack — that requires an extra trust path and breaks the rule that the tenant never holds a role into the marketplace.
3. **The custom resource MUST be idempotent.** Re-applying the tenant stack with the same NS values is a no-op; changing NS values updates the record set in place.
4. **Use Route 53 `UPSERT` semantics.** Never `CREATE` — that fails on retry.
5. **TTL on the `NS` record set is 300 seconds** by default. Lower it temporarily during a planned re-delegation, restore after.

## Anti-patterns

- ❌ Creating per-tenant records (e.g. `api.acme-prod.provider.xyz`) directly in the parent zone.
- ❌ Sharing one child hosted zone across multiple tenants.
- ❌ Using `aws:SourceAccount` conditions on the parent-zone Lambda but allowing arbitrary Account IDs to invoke it. The Lambda's resource policy MUST require the call to originate from a tenant in the `Tenants` OU.
