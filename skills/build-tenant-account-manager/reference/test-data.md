# Account test data and dependency fakes

Use these synthetic inputs with the [capability map](../../guide-product-work/reference/iterations/account.md).
They follow the bundled PRD's create-account shape; verify the target schema before
invoking it. Capture generated IDs from responses instead of inventing production
account IDs or reusing an unrelated account. Keep fixtures in the target test suite.

Customer baseline:

```json
{
  "kind": "customer",
  "first_name": "Casey",
  "last_name": "Example",
  "email": "casey@example.invalid",
  "company_name": "Fixture Company"
}
```

Organization variant:

```json
{
  "kind": "organization",
  "organization_name": "Fixture Organization"
}
```

For the parent-account variant, replace `company_name` with the organization ID
returned by the API as `parent_account_id`. Test both fields together and neither
field as invalid customer requests. Prepare a second account/caller fixture for
ownership checks, and ensure rejected requests cause no downstream effects.

## Mock external effects within each feature

| Dependency | Fake behavior to control | Observable acceptance |
| --- | --- | --- |
| Confirmation/approval mail | Capture outgoing messages without sending mail; generate signed test callbacks using an isolated fixture secret. | Valid, tampered, expired and replayed callbacks cause the expected account/session transition; no token or link enters evidence. |
| Organizations and STS | Simulate new/adopted account IDs, pending/success/failure responses and role-readiness retries. | API status agrees with workflow completion; duplicate requests do not create another resource. Never send fake IDs to real AWS providers. |
| Route 53 and ACM | Use `.test` domains and fake zones/certificates; control validation, in-use and deletion responses. | Provisioning waits for readiness; invalid configuration and in-use resources fail at the correct state without claiming live DNS. |
| API Gateway key bindings | Track synthetic keys, usage-plan bindings, grace expiry and injected binding errors in an isolated fake. | Revoked/retired keys are rejected; concurrent rotation is bounded and failed rotation reports its supported recovery state. |
| Maintenance identity and IAM | Simulate authorized/unauthorized callers, approval, one-time redemption, expiry and cleanup. | Approval/identity checks cannot be bypassed; repeated redemption and expired sessions fail; cleanup and audit state agree. |
| Bootstrap/consumer inventory | Return ready, incomplete and still-in-use account states. | Manifest access preserves ownership; disable refuses remaining consumers before destructive steps. |

Implement these as target-repository dependency adapters and focused test fixtures;
this file does not supply a mock runtime. Preserve API auth/validation, workflow
transitions and correlation while faking the external effects. Record adapter mode
in test evidence. Keep live-resource configuration separate and fail closed when a
test run lacks its fakes. A configurer uses existing adapters; a missing adapter is
a builder dependency, not permission to make the real provider call.

For every selected feature, record input/configuration identity, redacted HTTP
result, request/execution ID, expected versus actual state, user observation and
cleanup. Verify the HTTP response, terminal async result and side-effect count.
Never treat local fake results as deployed mock execution or real provisioning.
