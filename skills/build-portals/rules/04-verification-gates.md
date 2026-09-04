---
title: Portal Verification Gates
impact: CRITICAL
tags: tests, coverage, browserstack, design, integration, latency
---

# Portal Verification Gates

Always run the repository's required gates: lint, typecheck, relevant tests,
build, and any CI checks required by its conventions. Then select
scope-appropriate gates below from `changeRequest.scopes`.

All five gates apply to a full `new_repository` portal delivery. For an
`existing_repository` change, run a gate only when the changed surface or an
acceptance criterion requires it. Mark unrelated gates **not applicable** with
a one-line reason; do not call them blocked or passed. A required gate must pass
and retain evidence before handoff. Do not replace failures with waivers or
mock results.

| Changed scope | Additional required gates |
| --- | --- |
| Backend behavior | API unit/contract tests; integration and latency when a live API path is changed or requested |
| Frontend behavior or appearance | Responsive design tests |
| User flow, auth, or preview deployment | BrowserStack full flow when credentials and a deployed target are required by acceptance criteria |
| Infrastructure | Synthesis/diff plus the repository's infrastructure tests |
| Code-only refactor | Repository gates and focused regression tests; live deployment gates are not applicable |

## Gate 1: API unit tests

Apply when backend code, API contracts, or backend infrastructure changes.

- Require a 100% test pass rate.
- For a new portal, require at least 80% statement, branch, function, and line
  coverage for the backend.
- For an existing project, require no coverage regression, preserve its
  existing threshold, and require at least 80% coverage for new backend modules
  unless the repository has a stricter rule.
- Exercise successful responses, validation failures, authorization behavior,
  upstream failures, and timeout/error mapping.
- Save the machine-readable coverage artifact path and summary.

Any failed applicable test or violated coverage threshold blocks handoff.

## Gate 2: Responsive design tests

Apply only when frontend behavior or appearance changes.

Use the portal spec's exact route and state inventory. Capture and compare all
required screens at the declared mobile, tablet, and desktop widths. Test at
least one authenticated and one unauthenticated state when the portal has auth.

Use deterministic data, disable incidental animation, and retain diff images.
An approved baseline update must be reviewable in the feature branch; never
update baselines merely to hide a mismatch.

## Gate 3: BrowserStack full flow

Apply when the change affects a user flow, authentication, browser integration,
or a deployed preview and the acceptance criteria require cross-browser proof.

Run Playwright user-behavior flows in BrowserStack against the deployed
Amplify preview URL. Cover the primary persona journey, auth boundaries,
validation errors, backend-dependent success, and logout/session expiration
when applicable.

The preview must call the real feature backend URL captured from its deployment
output. Before the run, fail if frontend runtime configuration points to
production, localhost, a mock server, or another environment. A local-only
Playwright result does not satisfy this gate.

Record:

- BrowserStack project and build URL
- commit SHA and feature branch
- preview URL
- feature API URL
- browser/device matrix
- pass/fail counts

All required flows must pass.

## Gate 4: Backend integration

Apply when a changed backend path must be exercised in a deployed feature/dev
environment or through a real upstream.

Seed or attach the user-supplied `datasetRef` in the approved development
environment. Run API contract and frontend integration tests against the
deployed backend. Do not use fixtures that bypass Lambda, API Gateway,
authorization, secrets retrieval, or required upstream calls.

Redact credentials and customer records from logs and evidence.

## Gate 5: API latency

Apply when the change creates or modifies a deployed API path, runtime,
upstream, memory/concurrency setting, or an explicit latency acceptance
criterion.

Measure deployed API responses with representative data from `datasetRef`.
This gate measures the complete API response, not page load, local handlers, or
mocks. Use `reference/measure-latency.mjs`:

```bash
API_URL="$FEATURE_API_URL" \
DATASET_PATH="$REPRESENTATIVE_DATASET_PATH" \
REQUEST_COUNT=100 \
LATENCY_OUTPUT_PATH="artifacts/latency.json" \
node skills/build-portals/reference/measure-latency.mjs
```

The dataset is a non-empty JSON array of request objects:

```json
[
  {
    "path": "/records/search",
    "method": "POST",
    "headerEnv": { "authorization": "TEST_AUTHORIZATION" },
    "body": { "query": "representative-input" }
  }
]
```

Store real test credentials outside the dataset file. `headerEnv` maps an HTTP
header to the environment variable containing its complete runtime value, such
as `Bearer <token>`. Never commit a populated authorization header. Run enough
requests to represent the accepted flow; increase `REQUEST_COUNT` when the
supplied dataset or performance plan requires it.

Sort measured durations and calculate the nearest-rank percentile. The p95
requirement is strictly `< 200` ms; p95 equal to or greater than 200 ms fails.
Any non-successful API response also fails.

## Required evidence

Keep applicable artifacts in the repository or approved CI store and attach
their links to the pull request and delivery task:

- unit-test result and coverage path
- responsive design baselines and diff report
- BrowserStack build URL
- Amplify preview URL
- real feature API URL
- latency JSON (`artifacts/latency.json`)
- integration test result

Evidence must identify the feature commit tested. Missing, stale, production,
or mock-backed evidence blocks handoff only when that gate applies. The handoff
must separately list passed, blocked, and not-applicable gates.
