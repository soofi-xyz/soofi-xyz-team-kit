# Environment test data and dependency fakes

Use these synthetic scenario inputs, not a promised API payload. Map them to the
verified target contract; use its validators before invocation. Reserved names and
fake IDs must never select a real account, domain or certificate.

```json
{
  "scenario": "fresh-test-environment",
  "account_id": "fixture-account-a",
  "aws_account_id": "111111111111",
  "account_access_ready": true,
  "requested_fqdn": "fixture-a.example.invalid",
  "domain_authority": "fixture-domain-authorization-a",
  "region": "us-east-1",
  "manifest_complete": true,
  "deploy_available": false,
  "bundle_version": "fixture-v1"
}
```

Make the variant `fixture-account-b`, `222222222222`,
`fixture-b.example.invalid`, `us-west-2`, an existing healthy Deploy service and
`fixture-v2`. Supply synthetic certificate and bundle records through fakes.

| Capability | Test data / fake behavior | Required observation |
| --- | --- | --- |
| Plan | Account manifest and Marketplace bundle responders; complete, access-not-ready, wrong caller and digest mismatch | Valid plan is pinned and scoped; invalid input has no AWS writes |
| Shared routing | Fake Route 53/ACM/API Gateway/SSM providers; fresh, compatible existing and conflicting domain resources | Environment creates or adopts only authorized compatible resources and never creates competing DNS/certificate ownership |
| First install | Fake AWS deploy adapter; unavailable, healthy, failed and interrupted Deploy install | Local adapter only closes cold start; API read-back identifies actual readiness |
| Subscriber handoff | Fake SigV4 Deploy and subscriber status; pending, complete and unhealthy | Environment waits for real completion/readiness; install history stays in the Deploy-owned Puller component |
| Product endpoints | Two component IDs with distinct then identical paths | Correct owner can attach/read; conflict and unauthorized attempt preserve prior state |
| Resume | Non-secret interrupted state with a pinned plan; changed bundle and repeated request | Completed effects are not replayed silently; changed inputs follow supported conflict rules |

First record request/effect counts with local fakes. Then invoke the actual test
Environment API against controlled dependency adapters and inspect its AWS logs
and workflows. A local Bootstrap run alone is not HTTP acceptance. Leave missing
API/test adapters pending for Torterra. Live Account provisioning, DNS/certificate
changes, credentials and stack changes are excluded from mocked evidence. Replace
fake identifiers only for a separately authorized live Environment exercise,
without committing secrets.

## Shared configuration provider

Use the [configuration-bundle contract](../../build-product-deployer/reference/configuration-bundles.md)
for provider readiness. Fake absent, compatible and incompatible providers, missing
Transform/Connect/System API access and an interrupted provider install. Verify
one shared provider per target account/region, no self-install dependency, scoped
discovery and truthful readiness through Environment/Deploy status. Do not call
business execution APIs to prove configuration-installation readiness.
