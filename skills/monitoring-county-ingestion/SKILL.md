---
name: monitoring-county-ingestion
description: "Monitor a running county ingestion - workflow progress and ETA, in-flight and paused invocation counts, artifact file counts under data/, query-DB row counts, and stall diagnosis - for any county. Use when asked for ingestion status, ETA, backlog, permit harvest progress, appraisal progress, or why ingestion stalled."
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
   - Tracks: **Overview**, **Discovery**, **Seed Roll**, **Appraisal Harvest**, **Permits & Trade**, **Sunbiz Corporate**, **BBB Roofer CRM**, **Warehouse**, **Publish & IPFS**.
   - Highlights the current stage, displays completion percentage, and provides contextual "Next Step" action recommendations.
3. **Deep-Link URL Routing**:
   - Implements `history.pushState` client-side navigation (`/overview`, `/permits`, `/crm`, `/warehouse`, `/publish`).
   - Preserves active tab state across page refreshes and browser reloads.
4. **Accurate Rolling Rate & ETA Windowing**:
   - Calculates throughput and ETA exclusively over the most recent 30–60 second sliding window.
   - Uses active delta counts (`Δsucceeded + Δfailed`), excluding skipped/resumed parcels to prevent distorted 1000+ parcels/min initial spikes.
   - Formats ETA clearly: `2h 15m remaining • Today at 4:30 PM • 14,200 parcels`.

---

## Command-Line & Durable State Monitoring

All state lives in Restate, the `data/` directory, and Postgres — inspect them directly;
there are no helper scripts.

## Run progress

The `CountyIngest` workflow (key `<county>-<jobId>`) fans the seed into per-chunk
`IngestChunk` child workflows (keys `<county>-<jobId>-c<N>`) and tracks `chunksDone` (of
`chunks` total) as parent state. Child keys derive from the parent workflow key, so a
redrive pass's chunks are keyed `<county>-<jobId>-r2-c<N>`. Read it in the Web UI at `http://localhost:9070`
(invocation → state), or via SQL:

```bash
restate sql "SELECT * FROM state WHERE service_name = 'CountyIngest' AND service_key = '<county>-<jobId>'"
restate sql "SELECT status, created_at, modified_at FROM sys_invocation WHERE target_service_name = 'CountyIngest'"
```

Coarse percent complete = `chunksDone` ÷ `chunks`. For finer-grain progress use the
artifact counts below (`find … | wc -l` vs the seed total). The in-flight `IngestChunk`
invocations themselves are visible in `restate invocations list`.

## In-flight and backlog

```bash
restate invocations list          # filter by service: Parcel, PermitHarvest, PermitFeed, PermitFeedChunk, IngestChunk, CountyIngest
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
find data/artifacts/appraisal/<county>/<jobId> -name dead.json | wc -l
find data/artifacts/appraisal/<county>/<jobId> -name invalid.json | wc -l
find data/artifacts/permits/<county>/<jobId> -type f | wc -l
```

During a run: `pending = seed − ready − dead − current-invalid`. At appraisal terminal
state: `seed = ready + dead + current-invalid` (a stale `invalid.json` is cleared when
a later validation passes, so counts reflect current state). DB completion is separate:
the `Loader` watermark plus the distinct DB folio count must cover `ready`.
`ready.json` = the loadable set (what the `Loader` reads); `transformed.zip` −
`ready.json` = the invalid/dead tail pending classification.

Note: `CountyIngest` completing means the appraisal dispatch finished — permit work
drains separately. Measure permit completion exactly: count the per-parcel status
artifacts (one per eligible parcel, written by the harvester),
`find data/artifacts/permits/<county>/<jobId>/status -name '*.json' | wc -l`, and
reconcile against the eligible-parcel count (the `eligibility.json` files with
`eligible: true`); `find … -type f | wc -l` alone is not a completion measure.

One `find` sweep over the prefix beats per-parcel checks in a loop ~80× at county
scale — always sweep once, then count/filter locally. Reconcile distinct folios vs seed
count BEFORE any bulk load: count folio directories,
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

## DB counts

```bash
docker compose exec postgres psql -U postgres elephant \
  -c "SELECT jurisdiction_key, count(*), count(DISTINCT request_identifier) FROM parcels GROUP BY jurisdiction_key"
```

Property counts come via the parcel join, not a `properties.source_system` group-by.
DB counts complement artifact counts; only reconciling both against the seed tells you
the true missing set (see `county-ingest-run` wrap-up).

## Wrap-up gate verification (state reads)

The `county-ingest-run` wrap-up gates are verified from persisted service state, not
logs. The `Loader` object keeps per-track watermarks (`watermark_<track>`) and the
`Publish` object keeps `approved` / `tickScheduled` / `lastTickAt`:

```bash
restate sql "SELECT * FROM state WHERE service_name = 'Loader' AND service_key = '<county>'"
restate sql "SELECT * FROM state WHERE service_name = 'Publish' AND service_key = '<county>'"
```

Gate checks: the watermark covers the final artifacts, and `lastTickAt` shows a publish
tick after the last load.

## ETA

Backlog ÷ recent completion rate. Get the rate from `sys_invocation` completion
timestamps over a recent window, or from the delta between two artifact counts taken a
few minutes apart. If the county's feeder is paused, report the track as paused — no
live ETA. Note a 0/empty `CONCURRENCY_*` cap cannot pause a track (the gate falls back
to its stage default); to stop a track, pause its invocations
(`restate invocations pause`) or stop the services process.

## Stall diagnosis (in order)

1. Services process running? (`npm run dev` on :9080; check the terminal / process.)
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
on retry, which is why file/DB/API writes must stay idempotent. Quantify data loss by
reconciling counts (seed vs artifacts vs DB rows), never by counting error events —
error counts over- and under-report in both directions.

## Reporting guidance

Keep updates concise: status (running/paused/complete/blocked), backlog count,
throughput window used, ETA or why ETA is not meaningful, and a caveat when a track is
still discovering more work.
