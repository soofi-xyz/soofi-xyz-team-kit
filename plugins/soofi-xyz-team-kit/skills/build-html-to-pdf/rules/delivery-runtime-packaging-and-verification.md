---
title: Runtime Packaging And Verification
impact: HIGH
tags: packaging, fonts, assets, tmp, timeout, testing, verification
---

## Runtime Packaging And Verification

Treat PDF generation as a production Lambda workload.

### Package The Runtime Deliberately

Package all required pieces explicitly:

- Chromium compatible with the Lambda runtime
- Playwright runtime code
- document fonts
- template-owned static assets

Prefer one runtime pattern per implementation:

1. container-image Lambda with Chromium installed
2. zipped Lambda plus a packaged Chromium distribution

Container images are usually easier once fonts and native browser dependencies matter.

### Fonts And Assets

- Package the exact fonts you expect to use
- Keep the same fonts in local development, CI, and Lambda
- Prefer embedded or packaged assets over remote URLs
- Fail loudly when a critical asset or font is missing

Do not rely on unknown system font fallbacks.

### Lambda Sizing

- Set memory from real multi-page render behavior
- Leave timeout headroom for cold start plus render time
- Treat large images, long tables, and legal disclosures as first-class test cases

### `/tmp` Usage

Use `/tmp` only when necessary for browser data, validation artifacts, or tools that require files.

Do not add unnecessary disk I/O when string HTML and in-memory PDF buffers are enough.

### Verification Loop

Use layered checks:

1. schema tests for request shape
2. HTML render tests for template binding
3. PDF smoke tests
4. regression checks on representative multi-page samples

Do not treat a one-page happy path as production readiness.

### Failure Handling

Fail loudly on:

- missing template
- schema mismatch
- missing Chromium runtime
- missing critical font or asset
- timeout during render

Return warnings only for optional checks skipped safely.
