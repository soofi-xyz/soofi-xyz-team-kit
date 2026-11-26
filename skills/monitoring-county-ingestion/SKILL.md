---
name: monitoring-county-ingestion
description: "Monitor a running county ingestion - workflow progress and ETA, in-flight and paused invocation counts, artifact file counts under data/, CountyLedger status counts and the run manifest, and stall diagnosis - for any county. Use when asked for ingestion status, ETA, backlog, permit harvest progress, appraisal progress, or why ingestion stalled."
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

## Run progress

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
under `stage: "permits"`, where `blocked` is a blocked source — captcha, login,
custodian-only — counted apart from `dead`). Read its shared handlers through ingress:

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

Every status report also names:

- the county's Pipeline stage (1–6) and the Local % on the Console's Pipeline tab
  (`county-coverage-persist`), per
  [`pipeline-reporting.md`](../use-oracle/reference/pipeline-reporting.md);
- `chunksDone` of `chunks` from `CountyIngest/<county>-<jobId>/status`;
- a lag flag when the Console's mined count is behind the Restate status or the file
  counts by more than one push: push by hand, and say when the exporter cannot see the run
  yet.
