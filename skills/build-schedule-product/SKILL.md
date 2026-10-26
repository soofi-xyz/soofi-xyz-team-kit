---
name: build-schedule-product
description: "Build or maintain the Schedule product: configured selection of who to contact each day, cohort queries, rotation and cooldowns over contact history, optional hour and capacity planning, runs, results and recovery. Use Klinklang; use Klink to configure schedules on an existing deployment."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Build Schedule

Use `klinklang`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Schedule capability map](../guide-product-work/reference/iterations/schedule.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `klink` with [configure-schedule-product](../configure-schedule-product/SKILL.md)
for schedules on an existing deployment.

The implementation is `prismteam-ai/schedule`. When it does not exist yet, the first
piece creates it; confirm the repository name with the user before creating it. Once it
exists, its `README.md`, `docs/configuration-contract.md`, `docs/outputs.md`,
`requirements/swagger.yml` and `schemas/schedule-configuration.schema.json` are
authoritative over this skill. Until then, [the seed contract](reference/configuration-contract.md)
is the requirement: copy it into the repository as the first contract and keep both in
step until the repository owns it.

## What Schedule is

Schedule turns data into a daily contact plan. A schedule configuration names queries
(who is a candidate, who was reached and when, who to exclude), selections over them
(how many, in which precedence, with which rotation and cooldown, ranked how) and an
optional delivery block (campaign clock, recipient-local window, hourly and daily
capacity). A run produces selected actions, overflow with typed reasons, a summary and a
manifest. Downstream products send, dial or render; Schedule never contacts anyone.

The first supported use case is a fixed daily count from one cohort, rotating so that
anyone reached within the cooldown is skipped and never-reached subjects go first. Build
it as configuration over generic features; never as a voicemail, cohort or client branch.

## Rules

- Keep Schedule generic. Never add code, branches, tables or tests that name one schedule,
  channel, cohort, campaign or client. A new need becomes a `schedule-1` contract change
  every schedule can use, documented in the contract and the schema.
- Take business meaning from data. Cohort membership, "reached", legal hours, offsets,
  scores and categories arrive as source rows and column roles. Do not hardcode time
  zones, hours, caps, weights or state tables in the engine.
- Keep selection deterministic: total ordering ending in
  `sha256(schedule, run.date, subject)`, and action ids derived from schedule, run date,
  selection, subject and contact. Same version, data and date give the same output.
- Keep the ledger append-only and only count published live runs. A re-run of a date
  supersedes the earlier run for rotation without deleting ledger rows. Simulations and
  failed runs never count.
- Never silently change configured hours, counts or capacities. Anything not delivered is
  overflow with a reason and a `shortfall` in the summary.
- Keep sources read-only and bounded (`maxScanGiB`, `maxRows`) behind a metadata-only cost
  estimate that stops the run above `costLimitUsd` before any data is read.
- Keep secrets out of configurations, examples, fixtures, bundles and Git. Sources use the
  stack's IAM roles.
- Keep one stack, `Schedule`, with no stage suffix, the `schedule` base path on the shared
  domain and every route behind the shared `x-api-key`.

## Architecture

Follow the Report product's shape for the API and run orchestration, so configurers meet
the same patterns: a configuration API with validate, versioned save and delete; a run
state machine with plan (lock, cost gate), sources, selection, optional delivery and
publish steps; a store for schedules, versions, runs and the publish pointer; per-schedule
timed triggers; a reconciler and alarms.

- **Selection** is set-based: rotation order, cooldown, exclusions, first-match across
  selections and counts are window functions over source rows and the ledger view. Run
  it in the query engine, not in a driver loop.
- **Delivery** is a pure planner package with no I/O: input actions with legal hours,
  capacities and allocation mode; output hours and overflow. `earliest_deadline` is the
  default; `min_cost_flow` follows [build-solver-services](../build-solver-services/SKILL.md)
  for the pure solver and its tests. Run it only when a configuration has `delivery`.
- **Outputs** follow `schedule-output-1` in the seed contract: per-run copies, `latest/`
  with the manifest last, idempotent publish.

## Lessons from earlier single-channel solvers

Earlier calling, text and email solvers each hardcoded what Schedule must configure.
Carry their behavior forward as contract features, not code:

- Hardcoded campaign time zone, hours, caps and score weights became hidden policy and
  drifted from their documentation. Make each one a validated configuration value.
- A priority flag that bypassed capacity left caps unenforced in production. Express
  priority only as selection precedence; never as a cap bypass.
- Random message ids broke retries and reconciliation. Derive action ids.
- Mixing data access and planning in one large job made the planner untestable without a
  cluster. Keep the planner pure and test it with plain unit tests.
- Ambiguous postal offsets were handled three different ways. Make the policy explicit
  (`ambiguousOffset`).
- Separate ordered pools that share remaining capacity, a dominant score rung plus
  bounded signals, post-solve tiers and a weekly replay simulator worked well; keep them
  as later contract features when a configuration needs them.

## Build each feature piece

1. Select and order the capability map's pieces. Use at least four increments for a
   full-product build; scope a fix to the pieces it touches. Deliver the first use case
   (count + rotation + cooldown, daily list) end to end before delivery planning.
2. Implement only that piece. Test it locally first: the repository's check command
   (format, lint, types, unit tests with mocked AWS clients), plus SQL tests of
   selection over a fixture with known expected rows when selection SQL changes.
3. Synthesize with cdk-nag. Regenerate `requirements/swagger.yml` when routes change.
4. Deploy to the user's test account after a diff preview; list any resource that would
   be replaced and never replace the bucket, ledger tables or store.
5. Give one API invocation, the expected result and at most three AWS inspection steps
   from the capability map. Have the user run the baseline and the variant and report
   redacted run ids and observations; wait before the next piece.
6. Open the PR and work it until checks and reviews are clean; the user merges. Registeel
   owns publication and review.

Return changes, API examples, automated results, deployed run evidence, AWS observations,
cleanup and remaining gaps. Keep a local test, a simulated run, a live run over test data
and a live run over production data distinct.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md)
when a change affects how bundles install schedules. Deploy's installer saves each
schedule with `PUT /schedules/{id}` and expects 201 created, 200 updated or unchanged
(with the same read-back when unchanged); keep those semantics.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Schedule maps `schedule` with `SharedApiMapping`, attaches its stage to the shared usage
plan from `/account/shared-usage-plan-id` and declares no public routes in
`marketplace.shared-api.json`.
