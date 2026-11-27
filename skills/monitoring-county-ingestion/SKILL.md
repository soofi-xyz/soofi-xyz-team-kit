---
name: monitoring-county-ingestion
description: "Monitor a running county ingestion - Restate queue progress per source scope (npm run status) and ETA, workflow progress, in-flight and paused invocation counts, artifact file counts under data/, CountyLedger status counts and the run manifest, and stall diagnosis - for any county. Use when asked for ingestion status, ETA, backlog, permit harvest progress, appraisal progress, or why ingestion stalled."
metadata: {"author":"elephant-xyz"}
---
# Monitoring County Ingestion

## Live Zero-Overhead 9-Stage Dashboard

For visual monitoring without CPU or memory overhead on the ingestion workers, launch the independent dashboard server:

```bash
node scripts/<county>/serve-dashboard.mjs --port=3888
```

### Dashboard Architecture & Best Practices

1. **Out-of-Process Polling**:
   - The dashboard runs on its own isolated Node HTTP process (`http://localhost:3888`).
   - It reads small JSON progress markers (`progress.json`, `enrichment-progress.json`, `appraisal-bulk-checkpoint.json`) emitted periodically by workers.
   - Workers use 500ms debounced async writes to eliminate disk write contention.
2. **9-Stage Lifecycle Tracker**:
   - Tracks: **Overview**, **Discovery**, **Seed Roll**, **Appraisal Harvest**, **Permits & Trade**, **Sunbiz Corporate**, **BBB Roofer CRM**, **Reconcile**, **Publish & IPFS**.
   - Highlights the current stage, displays completion percentage, and provides contextual "Next Step" action recommendations.
3. **Deep-Link URL Routing**:
   - Implements `history.pushState` client-side navigation (`/overview`, `/permits`, `/crm`, `/reconcile`, `/publish`).
   - Preserves active tab state across page refreshes and browser reloads.
4. **Accurate Rolling Rate & ETA Windowing**:
   - Calculates throughput and ETA exclusively over the most recent 30–60 second sliding window.
   - Uses active delta counts (`Δsucceeded + Δfailed`), excluding skipped/resumed parcels to prevent distorted 1000+ parcels/min initial spikes.
   - Formats ETA clearly: `2h 15m remaining • Today at 4:30 PM • 14,200 parcels`.

---

## Command-Line & Durable State Monitoring

Run state lives in Restate and data lives under `data/` — inspect them directly. There is
no SQL database. `reconcile-county.mjs` (below) is the only reconciliation helper.

## Enqueue-path progress (default full run)

A run started with `npm run enqueue` (`county-ingest-run` §3) has no feeder workflow: the
backlog is Restate's queue per scope. Start every check with the status command (from
`skills/use-oracle/runtime`):

```bash
npm run status -- --county <county> --job <jobId>            # --minutes 15 (rate window), --json
```

It prints the queue per scope, the cap in use and its waiters, `backing-off`/`paused`
Parcel and PermitHarvest counts, ready/dead/seed file counts, the rate over the last N
minutes, the ETA, and the hand-off block. The same numbers by SQL (Restate UI → SQL, or
`curl -s localhost:9070/query -H 'accept: application/json' --json '{"query":"…"}'`):

```sql
-- parcels left in the appraisal scope (paused and suspended are not done either)
SELECT num_inbox AS queued, num_running AS running, num_suspended AS suspended,
       num_paused AS paused, num_finished AS done,
       num_inbox + num_running + num_suspended + num_paused AS parcels_left
FROM sys_vqueue_meta WHERE service_name = 'Parcel' AND scope = '<scope>';
-- permit scopes
SELECT scope, num_inbox, num_running, num_paused, num_finished
FROM sys_vqueue_meta WHERE service_name = 'PermitHarvest';
-- cap and usage (GET /limits/rules answers 405; read the rule book here)
SELECT * FROM sys_rules;
SELECT scope, usage, concurrency_limit, available, num_waiters FROM sys_user_limits WHERE level = 'Scope';
-- per job, through the idempotency key
SELECT status, count(*) FROM sys_invocation
WHERE target_service_name = 'Parcel' AND idempotency_key LIKE '<county>-<jobId>-%' GROUP BY status;
```

Use `sys_vqueue_meta.num_running` or `sys_user_limits.usage` for "running": under fast
churn `sys_invocation` over-counts `invoked`. The ramp's samples are in
`data/runs/<county>/<jobId>/ramp.jsonl` (cap, verdict, reasons, action). The rate and ETA
come from `ready.json`/`dead.json` written in the window, so they ignore skipped parcels.

Stall checks for this path, before the general list below: usage below the cap with
queued work (services process down or not registered); `usage == cap` but nothing
finishing (source slow or hanging: probe it unloaded); `num_paused > 0` (classify the
journal, then resume); no rule on the scope (`npm run scope-cap -- --scope <scope>`); a
capture gate at or below the cap (`CONCURRENCY_PREPARE_<COUNTY>`), which makes the cap
look unused.

**Hand-off block, required in every status report and every hand-off:**

- Restate UI: `http://127.0.0.1:<RESTATE_ADMIN_PORT>/ui` (default 9070);
- from another machine: `ssh -N -L <port>:127.0.0.1:<port> <user>@<host>`, then open the
  same URL;
- the parcels-left query above, with the run's scope;
- the Console Pipeline tab (shared view, refreshed hourly):
  <https://soofi-safavi.account.prismteam.ai/console/app/?app=meet-backfill-progress&tab.data-mining-tabs=data-mining-pipeline-table#/data-mining>.

## Run progress (chunk mode)

The `CountyIngest` workflow (key `<county>-<jobId>`) fans the seed into per-chunk
`IngestChunk` child workflows (keys `<county>-<jobId>-c<N>`) and tracks `phase`
(`indexing`, `appraisal`, `permits` while it awaits its `PermitFeed`, then `done`; or
`appraisal-done` with `startPermits: false`), `chunksDone` (of `chunks` total),
per-status `counts`, `permitFeed`, and the final `permits` counts as parent state. Child keys derive from the parent workflow key, so a
redrive pass's chunks are keyed `<county>-<jobId>-r2-c<N>`. Read it in the Web UI at `http://localhost:9070`
(invocation → state), or via SQL:

```bash
restate sql "SELECT * FROM state WHERE service_name = 'CountyIngest' AND service_key = '<county>-<jobId>'"
restate sql "SELECT status, created_at, modified_at FROM sys_invocation WHERE target_service_name = 'CountyIngest'"
curl -s -X POST localhost:8080/CountyIngest/<county>-<jobId>/status
curl -s -X POST localhost:8080/IngestChunk/<county>-<jobId>-c<N>/status   # rows, done, counts
curl -s -X POST localhost:8080/PermitFeed/<county>-<jobId>-permits/status # phase, eligible, chunksDone
```

Coarse percent complete = `chunksDone` ÷ `chunks`. For finer-grain progress use the
artifact counts below (`find … | wc -l` vs the seed total). The in-flight `IngestChunk`
invocations themselves are visible in `restate invocations list`.

## In-flight and backlog

```bash
restate invocations list          # filter by service: Parcel, PermitHarvest, PermitFeed, IngestChunk, CountyIngest, PublishGroup
```

Counts of running / paused / retrying invocations per service replace queue-depth and
in-flight metrics — and they are exact, not approximate. Bounded windows within the
per-chunk `IngestChunk` child workflows bound in-flight work, so "backlog" = chunks not
yet done (`chunks − chunksDone`), refined by the artifact counts below.

## Artifact counts

```bash
find data/artifacts/appraisal/<county>/<jobId> -name transformed.zip | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name ready.json | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name capture.zip | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name eligibility.json | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name failed.json | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name dead.json | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name invalid.json | wc -l
find data/artifacts/permits/<county>/<jobId> -type f | wc -l
```

During a run: `pending = seed − ready − dead − current-invalid`. At appraisal terminal
state: `seed = ready + dead + current-invalid` (a stale `invalid.json` is cleared when
a later validation passes, so counts reflect current state). The `CountyLedger` counts
must agree with these file counts; any difference is a ledger-vs-file mismatch.
`ready.json` = the publishable set (what group assembly reads); `transformed.zip` −
`ready.json` = the invalid/dead tail pending classification.

Note: `CountyIngest` completing means the appraisal dispatch finished — permit work
drains separately. Measure permit completion exactly: count the per-parcel status
artifacts (one per eligible parcel, written by the harvester),
`find data/artifacts/permits/<county>/<jobId>/status -maxdepth 1 -name '*.json' | wc -l`
(the per-parcel `status/<parcelKey>.json`; adapter files sit one level deeper under
`status/<jurisdiction>/`), and
reconcile against the eligible-parcel count (the `eligibility.json` files with
`eligible: true`); `find … -type f | wc -l` alone is not a completion measure.

One `find` sweep over the prefix beats per-parcel checks in a loop ~80× at county
scale — always sweep once, then count/filter locally. Reconcile distinct parcel
directories vs the seed count before assembling groups:
`find data/artifacts/appraisal/<county>/<jobId> -mindepth 1 -maxdepth 1 -type d | wc -l`.

## Permit backfill coverage (Accela date-window)

Scan the permit-list `links.json`/summary files under
`data/artifacts/permits/<county>/<jobId>/permit-lists/`. Terminal predicate: a window
whose reported total is below the cap is terminal at any span; an at-cap window with
span > 1 day splits; a 1-day at-cap window becomes terminal only after complete
pagination/exhaustion; a window whose reported total is UNAVAILABLE is treated as
at-cap (split if span > 1 day, else paginate to exhaustion). Coverage = the union of
DAYS covered by terminal windows ÷ total days since the portal's history start
(Lee: 1990-01-01). Windows still pending a binary split are NOT coverage. Report missing
date-range gaps, and ETA = remaining uncovered days ÷ recent rate of NEWLY COVERED
terminal days (not window count). `2×days − roots` is a worst-case node-count bound, not
an expected total (see `county-permit-adapter` for the split-tree semantics).

## Ledger counts and the run manifest

`CountyLedger` (virtual object keyed `<county>-<jobId>`) is the single writer of
per-parcel status (`pending`, `ready`, `dead`, `invalid`, `failed`; permit link results
under `stage: "permits"`, where `blocked` is a source not yet harvested — a login or
terms gate awaiting approval, or custodian-only — counted apart from `dead`; bot checks and
IP blocks are worked around, not left `blocked`). Read its shared handlers through ingress:

```bash
curl -s -X POST localhost:8080/CountyLedger/<county>-<jobId>/summary   # counts, tombstones, permits
curl -s localhost:8080/CountyLedger/<county>-<jobId>/list --json '{"status":"failed","limit":100}'
curl -s localhost:8080/CountyLedger/<county>-<jobId>/list --json '{"stage":"permits","status":"dead"}'
curl -s localhost:8080/CountyLedger/<county>-<jobId>/list --json '{"stage":"permits","status":"blocked"}'
curl -s localhost:8080/CountyLedger/<county>-<jobId>/get --json '{"parcel_id":"<parcel_id>"}'
```

`list` pages in `parcel_id` order (pass the returned `cursor` back). `get` returns the
`parcel` entry and the `permits` entry; each carries `stage`, `status`, `reason`,
`artifactHash`, `transformVersion`, `detail`, and `tombstoned`.

For a full reconciliation, run the reconcile command; without `--strict` it reports
without failing, so it is safe mid-run:

```bash
cd skills/use-oracle/runtime
npm run reconcile -- --county <county> --job <jobId> --no-rehash   # quick; drop --no-rehash for the full check
```

It writes `data/runs/<county>/<jobId>/manifest.json` and prints the gates
(`seed_accounted`, `seed_complete`, `no_duplicate_keys`, `ready_hash_coverage`,
`ledger_files_agree`, `permits_linked`, `permits_complete`, `tombstones_excluded`; each
`pass`, `fail`, or `not_started`), counts by status, dead/invalid/failed reasons, permits
linked/unlinked by reason, ready-marker hash coverage, and ledger-vs-file mismatches.
Mid-run, `seed_complete` and `permits_complete` fail by design. Ledger counts complement artifact counts; only reconciling
both against the seed tells you the true missing set (see `county-ingest-run` §6).

## Wrap-up gate verification

The `county-ingest-run` wrap-up gates are verified by `reconcile-county.mjs --strict`
(exit 0) and the manifest it writes, not by logs. Publication progress for one group is
the `PublishGroup` workflow state:

```bash
curl -s -X POST localhost:8080/PublishGroup/<county>-<group>-<jobId>/status
```

A `PublishGroup` in phase `awaiting-approval` is healthy, not stalled; it stops before the
Atlas PR, which stays a `gh` step per `use-oracle`.

## ETA

Backlog ÷ recent completion rate. Get the rate from `sys_invocation` completion
timestamps over a recent window, or from the delta between two artifact counts taken a
few minutes apart. If the county's feeder is paused, report the track as paused — no
live ETA. Note a 0/empty `CONCURRENCY_*` cap cannot pause a track (the gate falls back
to its stage default); to stop a track, pause its invocations
(`restate invocations pause`) or stop the services process.

## Stall diagnosis (in order)

1. Services process running? (`npm run services` on :9080; check the terminal /
   process.) After a restart, `npm run register` must report no `missing` services.
2. Invocations paused at max attempts? (Web UI → invocations; journal shows the error.)
3. A `CONCURRENCY_*` cap in `.env` set too low? (Check the services process env;
   empty/0/garbage values fall back to the stage default, so a missing cap shows up as
   unexpectedly HIGH concurrency, not a stall; a genuinely too-low cap shows as
   slow-crawl, not zero throughput.)
4. Egress still US? `curl -s ipinfo.io/country` must return `US`.
5. Portal health: probe the source with a single unloaded request.

A paused invocation whose journal shows repeated identical failures needs classifying as
DEAD vs RETRYABLE per `durable-workflow-builder` pattern 5 — resume retryables, record
dead ones and subtract them from the achievable count.

Duplicate-delivery errors (the old dead-token class) are structurally impossible at the
Restate invocation-dispatch layer — exactly-once invocation keys removed that failure
mode there. An interrupted `ctx.run` step can still re-execute its external side effect
on retry, which is why file and API writes must stay idempotent. Quantify data loss by
reconciling counts (seed vs ledger vs artifacts), never by counting error events —
error counts over- and under-report in both directions.

## Reporting guidance

Keep updates concise: status (running/paused/complete/blocked), backlog count,
throughput window used, ETA or why ETA is not meaningful, and a caveat when a track is
still discovering more work.

Every status report also names, beside the hand-off block above:

- the county's Pipeline stage (1–6) and the Local % on the Console's Pipeline tab
  (`county-coverage-persist`), per
  [`pipeline-reporting.md`](../use-oracle/reference/pipeline-reporting.md); while the run
  mines, Local is the validated count with stage "Mining (in progress)";
- parcels left from `npm run status` (enqueue path), or `chunksDone` of `chunks` from
  `CountyIngest/<county>-<jobId>/status` (chunk mode);
- a lag flag when the Console's count is behind the Restate status or the file counts by
  more than about an hour (a push reaches the Console about an hour later): push by hand
  and run the County coverage workflow.
