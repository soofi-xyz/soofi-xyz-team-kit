---
title: Delegation and Verification
impact: HIGH
tags: [delivery, verification, dns, smoke-test]
---

# Delegation and Verification

A subdomain is not "live" because the API returned 200. Always verify the delegation actually resolves before declaring success.

## Smoke Test (per environment)

Run after `POST /environments/{env_slug}/domain` returns:

1. **Authoritative NS check** — `dig +short NS <env-slug>.provider.xyz @<parent-zone-ns>`. Expect the four NS values reported by the tenant child zone.
2. **Recursive resolution** — `dig +short NS <env-slug>.provider.xyz` (against a public resolver). Expect the same set, after up to 5 minutes for propagation.
3. **Certificate validation** — confirm the ACM certificate in the tenant account is `ISSUED`. DNS-validation records live in the child zone, so this only succeeds after delegation completes.
4. **Reserved base path round-trip** — reserve `__smoke`, deploy a trivial echo component into the tenant claiming that base path, `curl https://<env-slug>.provider.xyz/__smoke/health`, expect HTTP 200.
5. **Audit log** — confirm a `Deployments` row exists with `component=tenant-domain-router`, `env_slug=<...>`, `status=delegated` and a matching `NS` record-set ID.

## Re-delegation

Updating the tenant child-zone NS values (e.g. after re-creating the zone) MUST flow through the same custom resource → parent-zone Lambda path. Manual edits in the parent-zone console are forbidden.

## Tear-down

After `DELETE /environments/{env_slug}/domain`:

1. `dig +short NS <env-slug>.provider.xyz` returns `NXDOMAIN` (after TTL expires).
2. `Environments` and `BasePaths` rows are gone.
3. `Deployments` audit row with `status=released` exists.

## Rules

1. **Always verify NS resolution before reporting success to the customer.** A 200 from the API only means the records were written; propagation can take a few minutes.
2. **Block subscribe of any other product** to an environment whose `domain/status` SSM parameter is not `ready`. The deploy product enforces this gate.
3. **Run the smoke test in CI** as part of the marketplace release pipeline against a throwaway environment.
