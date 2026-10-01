# Environment test data and dependency fakes

Use these synthetic scenario inputs, not a promised API payload. Map them to the
verified target contract; use its validators before invocation. Reserved names and
fake IDs must never select a real account, domain or certificate.

```json
{
  "scenario": "fresh-test-environment",
  "account_id": "fixture-account-a",
  "aws_account_id": "111111111111",
  "fqdn": "fixture-a.example.invalid",
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
| Plan | Account manifest and Marketplace bundle responders; complete, missing regional certificate, wrong caller and digest mismatch | Valid plan is pinned and scoped; invalid input has no AWS writes |
| Shared routing | Fake API Gateway/SSM and Account-owned domain inventory; fresh, existing and conflicting resources | Reuse correct resources; never create competing DNS/certificate ownership |
| First install | Fake AWS deploy adapter; unavailable, healthy, failed and interrupted Deploy install | Local adapter only closes cold start; API read-back identifies actual readiness |
| Subscriber handoff | Fake SigV4 Deploy and subscriber status; pending, complete and unhealthy | Environment waits for real completion/readiness; install history stays subscriber-side |
| Product endpoints | Two component IDs with distinct then identical paths | Correct owner can attach/read; conflict and unauthorized attempt preserve prior state |
| Resume | Non-secret interrupted state with a pinned plan; changed bundle and repeated request | Completed effects are not replayed silently; changed inputs follow supported conflict rules |

First record request/effect counts with local fakes. Then invoke the actual test
Environment API against controlled dependency adapters and inspect its AWS logs
and workflows. A local Bootstrap run alone is not HTTP acceptance. Leave missing
API/test adapters pending for Torterra. Live account provisioning, DNS, certificate
creation, credentials and stack changes are excluded from mocked evidence. Replace
fake identifiers only for an authorized live exercise, without committing secrets.
