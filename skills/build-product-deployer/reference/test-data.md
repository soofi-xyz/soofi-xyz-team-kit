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
Keep subscription/install state in the Deploy-owned Puller component; assert the
run service does not acquire that state. Fake Marketplace and the run service
when testing Puller itself; exercise the actual Puller implementation and API.

Use `AWS_PROFILE=<selected-profile>` only after verifying account/region. Keep
credentials, signed URLs and secret parameter values out of fixtures and evidence.
Clean up only owned test resources using the authorized supported path; do not
add a destroy/rollback endpoint to make cleanup convenient.


## Puller scenarios

Materialize these synthetic scenario values in the target test suite's supported
schemas. This JSON describes test state, not an asserted API request payload.
`fixture-*` identities are local test data; no published or live resources are claimed.

```json
{
  "subscriptions": [
    {"component": "fixture-app", "mode": "AUTO", "installed": "app-v1", "desired": "app-v2", "dependencies": ["fixture-shared"]},
    {"component": "fixture-other", "mode": "PAUSED", "installed": "other-v1", "desired": "other-v2", "dependencies": ["fixture-shared"]}
  ],
  "dependency": {"component": "fixture-shared", "installed": "shared-v1", "desired": "shared-v2"},
  "runResponses": ["accepted", "running", "succeeded"]
}
```

| Feature | Variant / dependency fake | Required observation |
| --- | --- | --- |
| Subscriptions | Two callers and root/dependency overlap; duplicate or unauthorized create/read | Tenant isolation, expected conflicts and secret references only; no invented remote subscription API |
| Polling | In-sync, new approved, unreviewed and missing release; two supported schedules; transient 429; no webhooks | Effective schedule/read-back, per-component errors and eligible update decisions; no installed-state change on poll alone |
| Updates | Shared dependency first; failed predecessor; expired URL; simultaneous manual/scheduled triggers | Supported dependency order, pinned identity and one pending intent; actual run/status handoff, not direct stack calls |
| Notifications | Supported signed event, altered raw bytes, repeated/older event and total event loss | Rejection/deduplication where supported; periodic polling catches up without webhook support |
| Recovery | Run accepted but response lost, worker restart, delayed status and contradictory terminal response | Reconcile before resubmission; preserve uncertainty if the API cannot resolve it; advance installed identity only for its successful current claim |
| Controls | Pause before polling, pause during active run, resume after a newer release, failed-bundle repetition and explicit retry | No new automatic work while paused; running work stays visible; no endless failed-bundle retry loop |
| Retirement | Retire one root sharing a dependency, then last root; pending run and unsupported resource removal | Preserve still-needed dependency and installed resources; separate subscription retirement from verified uninstall |

Fake catalog reads and run outcomes first; capture outbound request counts and
subscription/desired/pending/installed records. Then run the real test Puller API,
scheduler and workflows with those fakes. Have the user compare baseline and
variant through the API and inspect correlated AWS evidence before advancing.
A simulated response is not a deployed Puller, and an observed poll is not a
successful product installation. Record cleanup and all deferred live effects.

## Configuration bundles

Use the [shared synthetic acceptance matrix](configuration-bundles.md#synthetic-acceptance)
for provider sharing, configuration-only updates, preflight, replay/conflict,
partial failure, completion, activation and retirement. Materialize a synthetic
Transform/Connect/System integration against controlled API adapters, not a Model
pilot. Verify zero bundle-specific Lambdas and zero business execution calls.
Exercise it through Deploy run/status/results and Puller; local fixtures alone
establish neither installed configuration nor domain readiness.
