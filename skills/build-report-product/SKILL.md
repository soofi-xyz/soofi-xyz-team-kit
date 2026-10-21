---
name: build-report-product
description: "Build or maintain the Report product: its configuration API, the refresh state machine (cost gate, Persist and Athena sources appending to a ledger, Athena datasets, JSON outputs), schedules, alarms and packaging. Use Bronzong; use Bronzor to configure reports on an existing deployment."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Build Report

Use `bronzong`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Report capability map](../guide-product-work/reference/iterations/report.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `bronzor` with [configure-report-product](../configure-report-product/SKILL.md)
for reports on an existing deployment.

The implementation is [`prismteam-ai/report`](https://github.com/prismteam-ai/report).
Its `README.md`, `docs/configuration-contract.md`, `docs/outputs.md`,
`requirements/swagger.yml` and `schemas/report-configuration.schema.json` are
authoritative over this skill. Read [the architecture notes](reference/architecture.md)
for where things are and how a refresh runs.

## Rules

- Keep Report generic. Never add code, branches, tables or tests that name one report.
  A report is a configuration (contract `report-1`) stored through the API; a new kind of
  report needs a contract change that every report can use, documented in
  `docs/configuration-contract.md` and the schema.
- Report computes and writes JSON; it shows nothing. Do not add pages, HTML, charts or
  page settings: Console draws reports from `docs/outputs.md`. Changing an output file's
  shape is a breaking change for Console: keep `report-output-1` compatible or add a new
  version and say so.
- Keep secrets out of configurations, examples, fixtures, bundles and Git. Reports carry no
  credentials; sources reach Persist and Athena with the stack's own IAM roles. The only
  secret Report reads is the optional PagerDuty routing key `report/pagerduty`.
- Keep the ledger append-only: files under `ledger/` are written once and never replaced or
  deleted, including when a report is deleted.
- Keep queries read-only and bounded: Gremlin through Persist's async API, one `SELECT`
  per Athena source with `maxScanGiB`, datasets as one statement, a metadata-only cost
  estimate before any data is read, `maxRows` on sources and datasets.
- Keep one stack, `Report`, with no stage suffix, the `report` base path on the shared
  domain, every route behind the shared `x-api-key`, arm64 Lambdas and minified, obfuscated
  assets (Build's asset policy).

## Build each feature piece

1. Select and order the capability map's pieces. Use at least four increments for a
   full-product build; scope a fix to the pieces it touches.
2. Implement only that piece. Test it locally first: `npm run check` (format, lint,
   types, Vitest with AWS SDK mocks and the in-memory store). When datasets or their SQL
   change, run the Trino comparison over the 3,000-row portal fixture
   (`tests/athena-sql.test.ts`; `docker run -d -p 8090:8080 trinodb/trino:484` and
   `TRINO_URL=http://localhost:8090`). CI runs it in a service container.
3. Synthesize with cdk-nag: `just synth`. When `src/api/routes.ts` or `scripts/api-spec.ts`
   change, regenerate `requirements/swagger.yml` with `npx tsx scripts/api-spec.ts`; a test
   fails when it drifts.
4. Deploy to the user's test account with `just deploy` (it reads the shared domain from
   `/account/env-parameters`). Preview with `npx cdk diff` first and list resources that
   would be replaced or destroyed; never replace the bucket, the table or the Glue database.
   Removing API routes leaves them in the current stage deployment until the API is
   deployed again; check them afterwards.
5. Give one API invocation (`just call …` with `REPORT_API_KEY` set in the user's
   terminal), the expected result and at most three AWS inspection steps from the
   capability map. Have the user run the baseline and the variant and report redacted
   refresh ids and observations; wait before the next piece.
6. Open the PR and work it until checks and reviews are clean; the user merges. Merging to
   `main` publishes the product to Marketplace (`.github/workflows/marketplace.yml`);
   Registeel owns publication and review.

Return changes, API examples, automated results (local, Trino, synth), deployed refresh
evidence, AWS observations, cleanup and remaining gaps. Keep the difference between a
local test, a deployed refresh over test data and a refresh over live data explicit.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md)
when a change affects how bundles install reports. Deploy's installer saves each report
with `PUT /reports/{id}` and expects 201 created, 200 updated or unchanged (with the same
read-back when unchanged); keep those semantics.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Report maps `report` with `SharedApiMapping`, attaches its stage to the shared usage plan
from `/account/shared-usage-plan-id` and declares no public routes in
`marketplace.shared-api.json`.
