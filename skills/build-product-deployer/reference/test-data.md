# Deploy test data and dependency fakes

Use synthetic Build-contract fixtures prepared by the target test suite. These
are fixture recipes, not current run payloads. Discover the exact SigV4 request,
artifact reference, parameter and status shapes before sending a request.

| Fixture | Baseline / alternative | Required observation |
| --- | --- | --- |
| Simple assembly | One no-asset stack; alternate supported non-secret parameter | Signed run reaches terminal result; status matches fake or actual stack outcome |
| File asset assembly | Small test Lambda asset with manifest hashes; altered byte variant | Publish only verified bytes; reject mismatch before resource mutation |
| Ordered assembly | Two dependent stacks and two parameter sets | Dependencies run in order; missing parameter or predecessor failure blocks successors |
| Unauthorized caller | Different account/role and wrong signing region | Auth/scope check rejects before artifact publication or CloudFormation writes |
| Failed execution | Fake upload failure, stack failure, rollback and timeout | API status exposes the supported failure result and correlated diagnostics |
| Interrupted/duplicate run | Same artifact twice, then changed artifact; worker interrupted after accepted stack operation | Follow the actual retry/idempotency contract; never infer successful deduplication or blindly resubmit |

Fake S3/artifact downloads and CloudFormation calls first; record effect counts.
Use valid test digests computed from fixture bytes, not invented hash strings.
Run the real test API/worker with fakes next. When authorized, deploy a disposable
minimal stack and inspect CloudFormation events/status alongside the API result.
Keep subscriber install history, subscriptions and keys in a fake subscriber
component; assert Deploy does not acquire that ownership.

Use `AWS_PROFILE=<selected-profile>` only after verifying account/region. Keep
credentials, signed URLs and secret parameter values out of fixtures and evidence.
Clean up only owned test resources using the authorized supported path; do not
add a destroy/rollback endpoint to make cleanup convenient.
