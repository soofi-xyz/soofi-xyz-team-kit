# Schedule capability map

Apply [stable stack identity](../../../build-product-deployer/reference/stack-identity.md)
to synthesis, review and installation: one stack, `Schedule`, with no deployment stage,
updated in place whether it was deployed directly or installed from Marketplace.

Use Klinklang to implement Schedule and Klink to configure schedules on an existing
deployment. Follow the [shared workflow](../../SKILL.md). These 8 areas are a starting
inventory, not a fixed iteration count. Order dependencies and split independently
useful features further. Use at least four pieces for a full-product build; narrow work
selects only relevant pieces. Keep automated tests and user/AWS feedback inside each
piece, not as a final testing phase.

Schedule decides who to contact each run date, through which contact and optionally in
which hour. It holds no schedule: every schedule is a configuration (contract
`schedule-1`, seeded in
[the build skill's contract](../../../build-schedule-product/reference/configuration-contract.md)).
Business meaning comes from data through queries and column roles. It contacts nobody:
downstream products send, dial or render its outputs.

The first acceptance case is a fixed daily count from one cohort query with a one-day
cooldown and least-recently-reached rotation, produced as a daily list. Areas 1–5
deliver it; 6–8 extend the same contract.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `configuration` — validate, save and version a schedule | Shared API domain and key | Deliver `POST /schedules/validate`, `PUT`/`GET`/`DELETE /schedules/{id}` and `/versions` against the schema. Exercise a valid schedule, an unchanged save (no new version), and refused ones (unknown source in a selection, missing `subject` role, both `count` and `weeklyTarget`). | Read the stored schedule and version items; confirm a refused save writes nothing. |
| `sources` — cost-gated, bounded queries | Saved configuration | Deliver the plan step (lock, metadata-only estimate, stop above `costLimitUsd`) and `athena-sql`, `persist-gremlin` and `s3-json` sources with `maxScanGiB`/`maxRows` and `{{run.date}}`. Compare a cheap schedule with one whose limit is below its estimate. | Inspect the run execution's plan output and the source query executions; confirm an over-limit run fails before any source query runs. |
| `selection` — count, rank, exclusions, precedence | Sources | Deliver set-based selection: `count`, `rank`, `exclude`, first match across ordered selections, contact choice and the deterministic hash tie-break. Compare one selection with two overlapping ones, and a count above the candidates (`shortfall`). | Read the selection query and `summary.json`; confirm repeat simulations of the same date produce identical `selected.jsonl` checksums. |
| `outputs` — runs, results and simulation | Selection | Deliver `POST /schedules/{id}/runs` (`202`), run status, `/results`, `schedule-output-1` files with the manifest last, `latest/`, and `mode: simulate`. Exercise a live run, a simulation and a retried publish. | List `outputs/<schedule>/runs/<date>/<run>/` and `simulations/`; check manifest checksums and that a simulation wrote no ledger rows. |
| `rotation` — ledger, cooldown and least-recently-reached | Outputs | Deliver the append-only ledger, the published-run pointer per date, `{{ledger.actions}}`, `rotation.history` (ledger or source) and `cooldown`. Run date D live, then simulate D+1; re-run D and check it supersedes the first D run. | Read ledger rows for D; confirm D+1 excludes D's subjects, never-reached subjects lead, and the superseded run's rows are ignored but not deleted. |
| `delivery` — legal hours, capacity and allocation | Selection | Deliver the pure planner: campaign clock, recipient-local window from `utcOffset`, `allowedHours`, `ambiguousOffset`, hourly/daily capacity, `earliest_deadline`, typed overflow (`NO_LEGAL_HOUR`, `HOURLY_CAPACITY`, `DAILY_CAPACITY`, `HOUR_PASSED`). Compare a daily list with the same schedule plus delivery. | Read per-hour counts in `summary.json` and `overflow.jsonl` reasons; confirm no hour exceeds capacity and no configured hour was dropped. |
| `frequency` — weekly targets and optimized allocation | Rotation, delivery | Deliver `weeklyTarget` from history counts and `allocation: min_cost_flow` with a bounded rank score. Compare a schedule at target 1 and 3 over the same history. | Read target attainment per selection in the summary; confirm subjects at target are not selected. |
| `schedule-recovery` — timed runs and recovery | Outputs | Deliver per-schedule timers (`rate`, `cron`, `manual`), timeouts, the reconciler for timed-out or aborted runs and alarms. Exercise a timer change, a timed-out run and deleting a schedule. | Inspect the timer, the failed run record and the run-failure alarm; confirm delete keeps the ledger. |

Discover actual routes, statuses and resource names from the target revision and stack
outputs. Exercise each piece through the HTTP API, including submission (`POST
/schedules/{id}/runs`, `202`), status and results for runs. Direct AWS inspection
supports evidence; it does not replace API use. Give one invocation and at most three AWS
inspection steps, collect the person's redacted run id and observation, and wait for
that feedback before implementing or configuring the next piece. Keep local tests,
simulations, live runs over test data and live runs over production data distinct.

Keep publication with Registeel and installation with Skarmory. Sending, dialing and
rendering belong to the consuming workflow; a succeeded run proves its outputs were
written, not that anyone was contacted.

Apply [the configuration-bundle contract](../../../build-product-deployer/reference/configuration-bundles.md)
when a schedule is installed from a bundle: Deploy saves it through
`PUT /schedules/{id}` (201 created, 200 updated or unchanged).

Apply [the shared API domain contract](../shared-api-domain.md) within the relevant
pieces: base path `schedule`, the shared usage plan, no public routes.
