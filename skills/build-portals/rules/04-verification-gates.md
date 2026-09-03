---
title: Portal Verification Gates
impact: CRITICAL
tags: tests, coverage, browserstack, design, integration, latency
---

# Portal Verification Gates

Run every gate against the `feat/portal-v1` preview and its real feature
backend. A portal is not ready for handoff until every required gate passes and
its evidence is recorded. Do not replace failures with waivers or mock results.

## Gate 1: API unit tests

- Require a 100% test pass rate.
- Require at least 80% statement, branch, function, and line coverage for the
  backend.
- Exercise successful responses, validation failures, authorization behavior,
  upstream failures, and timeout/error mapping.
- Save the machine-readable coverage artifact path and summary.

Any failed test or coverage metric below 80% blocks handoff.

## Gate 2: Responsive design tests

Use the portal spec's exact route and state inventory. Capture and compare all
required screens at the declared mobile, tablet, and desktop widths. Test at
least one authenticated and one unauthenticated state when the portal has auth.

Use deterministic data, disable incidental animation, and retain diff images.
An approved baseline update must be reviewable in the feature branch; never
update baselines merely to hide a mismatch.

## Gate 3: BrowserStack full flow

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

Seed or attach the user-supplied `datasetRef` in the approved development
environment. Run API contract and frontend integration tests against the
deployed backend. Do not use fixtures that bypass Lambda, API Gateway,
authorization, secrets retrieval, or required upstream calls.

Redact credentials and customer records from logs and evidence.

## Gate 5: API latency

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

Keep these artifacts in the generated portal repository or approved CI store
and attach their links to the delivery task:

- unit-test result and coverage path
- responsive design baselines and diff report
- BrowserStack build URL
- Amplify preview URL
- real feature API URL
- latency JSON (`artifacts/latency.json`)
- integration test result

Evidence must identify the feature commit tested. Missing, stale, production,
or mock-backed evidence blocks handoff.
