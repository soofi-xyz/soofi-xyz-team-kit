---
name: county-ingest-run
description: "Operate the end-to-end property-first ingestion run for an onboarded county on the local durable stack - pilot batch first, source-feasibility gate, then the full backpressure-aware run with stepwise concurrency ramp-up, plus the streamed incremental load+publish that lands the county in the query DB and re-publishes the query-table as the run ingests. Use when starting, scaling, resuming, monitoring failure classes, streaming load+publish, or wrapping up a county ingestion run."
metadata: {"author":"elephant-xyz"}
---
# County Ingest Run

Prerequisites: `bootstrap-oracle-infra` checks pass; appraisal onboarding, transform
validation, and the permit adapter are done for the county.

Run parameters (county slug, jobId, pilot vs full scope, seed CSV) come from the
`onboard-county` intake — don't re-ask what's already established. If entered directly
without that context, ask for the missing parameters once before starting: a run sends
sustained traffic to county websites and should never start on guessed inputs.

## Run shape

Property-first: each parcel flows prepare → transform → validate (fail-closed) →
eligibility branch → permit harvest → query DB, individually. Input is ONLY the seed CSV
at `data/seeds/<county>.csv` (never re-derive work from the DB). The `CountyIngest`
workflow (keyed `<county>-<jobId>`) fans into per-chunk `IngestChunk` children (~10k
rows each, keyed `<county>-<jobId>-c<N>`) that dispatch `Parcel.process` in bounded
windows; when appraisal dispatch completes it starts the `PermitFeed` workflow
(keyed `<parent key>-permits`, so a redrive pass feeds its own `…-r2-permits`),
which walks eligibility artifacts and dispatches permit
harvests in its OWN bounded windows — neither side ever queues the whole county.
Journal replay is the only checkpoint. See `durable-workflow-builder` patterns
1 (backpressure feeder), 2 (layered concurrency), and 11 (chunked fan-out).

Everything runs locally: `docker compose up -d` (Restate + Postgres), services
process on :9080 (`npm run dev`), registered via
`restate deployments register http://host.docker.internal:9080`. Egress must be US
(`curl -s ipinfo.io/country` → `US`) — county portals geo-block.

## 1. Pilot (always first)

1. Pick ~25 parcels from the seed covering usage-type variability (commercial to exercise
   the permit path, residential to verify the skip path). Stage them as a pilot seed CSV.
2. Start the workflow with a distinct pilot jobId:

   ```bash
   curl localhost:8080/restate/send/CountyIngest/<county>-pilot-<date>/run \
     --json '{"county":"<county>","jobId":"pilot-<date>","seedPath":"seeds/<county>-pilot.csv","chunkSize":10000,"batchSize":100,"window":25}'
   ```

3. Verify one parcel end-to-end, in order: `capture.zip` on disk
   (`data/artifacts/appraisal/<county>/<jobId>/<folio>/`) → `transformed.zip` →
   validation pass → DB row → `eligibility.json` (and, if eligible, permit artifacts
   under `data/artifacts/permits/<county>/<jobId>/`).
4. Verify a permit-less parcel completes cleanly and a residential parcel stops after
   archive with `eligibility.json` showing `eligible: false` and no permit artifacts.
5. Record pilot timings per source: observed latency, safe concurrency, retry/failure
   rate, projected full-county duration.

## 2. Feasibility gate before full run

Project full-county duration from the pilot rate for every source that will be scraped:

- If the estimated full acquisition is 48 hours or less, proceed with the measured safe
  concurrency.
- If any source is estimated above 48 hours, do not scale it by default. Ask the operator
  whether to download artifacts anyway, ingest the source into the query DB, or retrieve
  it at runtime.
- If runtime retrieval is selected, ask which app/service owns the lookup and what the
  runtime path should be (direct API call, server-side scrape, cached lookup, queued
  background fetch). Record freshness, latency, and failure behavior before changing scope.

## 3. Full run

Same workflow, full seed:

```bash
curl localhost:8080/restate/send/CountyIngest/<county>-<jobId>/run \
  --json '{"county":"<county>","jobId":"<jobId>","seedPath":"seeds/<county>.csv","chunkSize":10000,"batchSize":100,"window":25}'
```

The workflow key `<county>-<jobId>` is the idempotency boundary: the same key is
exactly-once — a resubmit cannot start a duplicate and is refused as "previously
accepted". Treat that response as healthy, not an error. There is nothing else to name
or dedupe.

Backpressure in two sentences: the feeder never enqueues the whole county — it dispatches
`Parcel.process` in `window`-sized batches and admits the next batch only when the
previous one completes. Per-chunk child workflows keep every journal small, so a crash or
reboot resumes mid-chunk with no checkpoint files and no re-streaming
(`durable-workflow-builder` patterns 1, 2, and 11).

Watch with `monitoring-county-ingestion`: Web UI at `http://localhost:9070`,
`restate invocations list`, `restate sql` over `sys_invocation`/`state`.

## 4. Ramp-up & Warm Worker Pool Optimization

Raise the `CONCURRENCY_*` caps in `skills/use-oracle/runtime/.env` stepwise (`CONCURRENCY_PREPARE`,
`CONCURRENCY_TRANSFORM`, `CONCURRENCY_PERMIT_<VENDOR>` — in-process gates per
`durable-workflow-builder` pattern 2;
the Restate UI does not tune concurrency on this stack) and restart the services process —
safe mid-run, in-flight invocations resume from their journals. Let each step burn in 10+
minutes, then check error rates in the UI and the portal's health before the next.

- Start conservative. Permit portals: cap 2. Accela degrades above ~4 concurrent — hard
  lesson, treat ≤4 as a ceiling. Prepare grew to ~50 after burn-in in the reference
  county; transform ~100.
- **The limit is portal tolerance, not compute.** Your machine can always run more
  browser contexts than the county site will tolerate; ramp against the source's error
  rate, never against local headroom.

### High-Throughput Transform Optimization: Warm Worker Pool (`TransformPool`)

When transforming 500k+ parcels locally, spawning fresh Node.js subprocesses per parcel
(`child_process.execFile` / `execPath`) creates severe process-spawning overhead, thrashing
CPU cores, causing excessive fan noise, and dropping throughput to ~2-5 parcels/sec.

**Always use a Warm Worker Pool (`TransformPool` via `child_process.fork`)**:
1. Spawn a bounded pool of persistent child workers (`transform-worker.cjs`, sized to `os.cpus().length` or 8-16 workers).
2. Workers pre-compile Cheerio and all transform scripts once on startup.
3. IPC messages send `{ parcelDir }` to the next idle worker and return `{ success, error }`.
4. Achieves **20–60+ parcels/sec** sustained throughput with low CPU overhead and no fan thrashing.

### Memory Optimization: Streaming Seed CSV Processing

Never load a 500k-row CSV roll into an in-memory array (`const rows = parse(fileContent)`).
Large 300MB+ seed files will trigger `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.

**Always stream seeds with Node.js async generators**:
```javascript
export async function* streamSeedCsvRows(csvPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity,
  });
  let header = null;
  for await (const line of rl) {
    if (!header) { header = parseCsvLine(line); continue; }
    yield mapRow(header, parseCsvLine(line));
  }
}
```

### Fast Parallel File I/O & Zip Reading

When loading or validating transformed parcels:
- Prioritize reading `transformed_output.zip` using in-memory `AdmZip` rather than performing 15 sequential `fs.readFile()` calls for loose JSON files. This yields a **6.7x speedup** in disk I/O.
- Batch directory iterations in chunks of 256–512 with `Promise.all`.

## 5. Failure handling

Failed steps retry with backoff and **pause at max attempts** — visible in the UI with
the full journal. Inspect the journal, classify, act:

- **DEAD** — permanent source conditions (parcel retired/renumbered, page loads with no
  detail grid, selector permanently absent, true 404). Handlers record these
  (`dead.json` + a dead status in the return) and return normally — never thrown, so one
  dead parcel cannot fail its chunk (`durable-workflow-builder` pattern 5). Do not
  chase: achievable county count =
  seed − dead − current-invalid. A few record-heavy parcels can be unbounded-cost in
  any practical budget — document those in the dead/slow tail too, rather than letting
  them block wrap-up.
- **RETRYABLE** — transient (timeouts, 5xx, nav failures, connection refused). Fix the
  cause if needed, then `restate invocations resume <id>`.
- **Ambiguous 500s**: disambiguate with a couple of unloaded probes (curl the detail URL
  directly, no concurrent scrape load, ideally from more than one IP). 200 → load-induced,
  back off concurrency and resume. Consistent 500 unloaded → source-side defect, treat as
  dead tail.
- **Never gate completion on an exact source count.** An exact `== source` assert against
  a source with a dead tail loops forever. Gate on `loaded >= achievable`.

See `durable-workflow-builder` pattern 5 for the full taxonomy.

Geo-block or portal outage: pause the affected invocations (or stop the services
process), fix egress (US VPN/proxy — verify `curl -s ipinfo.io/country` → `US`), resume;
Restate redispatches. Machine crash or reboot: compose restarts the stack
(`restart: unless-stopped`), but the services process must also be relaunched (run it
supervised/detached for multi-day runs — see the `bootstrap-oracle-infra` gotchas);
the run then resumes from its journals — no watchdog, no re-streaming.

## 6. Streamed load + publish — queryable AS it ingests

Runs alongside the full run so the county lands in the query DB and re-publishes
incrementally, not in one batch at the end. (`Loader` and `Publish` must be authored
per `durable-workflow-builder` patterns 8–10 before first use.)

- `Loader` (virtual object keyed `<county>`) merges new artifacts into the DB
  incrementally — single-writer per county, so bulk merges never deadlock. Don't also
  bulk-load appraisal by hand mid-run; the incremental merge already covers it.
- `Publish.requestPublish` marks the county pending; the `Publish` object's
  self-scheduling `tick` runs the full publish sequence (consolidation first, then the
  query-table — `durable-workflow-builder` pattern 10), coalescing all tracks' signals.
- **PII gate**: the publish loop is a dry-run until a human approves once:

  ```bash
  curl localhost:8080/restate/call/Publish/<county>/approve --json '{}'
  ```

  Approval is durable state on the county's Publish object — flip it only when you
  intend to publish per-property PII publicly.

Details: `query-db-loading-matching` (loading/merges) and `county-query-table-publish`
(export/publish).

## 7. Redrives

Two mechanisms cover every redrive case:

- **Re-run a subset** (missing artifacts, transform-only re-runs, widened permit
  eligibility): start a NEW `CountyIngest` workflow key (`<county>-<jobId>-r2`) with a
  filtered seed but the SAME `jobId` payload field — the new key gives the pass
  exactly-once, the unchanged jobId keeps artifacts in the same namespace so
  skip-existing applies and already-done work is skipped, not re-scraped
  (`durable-workflow-builder` patterns 3–4). Transform-only re-runs work because the
  transform step skips only when capture hash AND transform version both match — a fixed
  transform regenerates stale output without re-scraping.
- **After a code fix**: on this single-endpoint local topology there is no second
  deployment to resume onto — cancel the paused invocations and re-run them as a redrive
  pass on the new code, or ship an in-place replay-compatible fix via `--force`
  re-register (`durable-workflow-builder` authoring rule 2). Plain `resume` is for
  world-fixes (egress, portal, disk), not code fixes.

Permit-scope redrives use the eligibility sentinels (see `county-appraisal-onboarding`):
an appraisal-only run sets the eligible-usage-types env to `__NONE__`; widening to full
permit coverage later is a re-run with `__ALL__` — skip-existing makes the appraisal side
a no-op. Never leave the variable unset: empty silently falls back to the commercial
default list. The services process is shared across counties — resolve the
county-scoped variable (`..._<COUNTY>`) first and use the bare variable only when a
single county runs, or a redrive's sentinel change leaks into every concurrent county.
Eligibility artifacts carry the policy fingerprint, so a same-job redrive with a changed
sentinel recomputes eligibility instead of trusting stale `eligible: false` files. A
redrive pass spawns its own `PermitFeed` under the new parent key, and the eligible
index is rebuilt with the current policy fingerprint.

After a redrive pass, re-scan the residual and loop (identify → re-run → re-identify)
until it stops shrinking; the floor is the documented dead tail (classify per §5). When
judging the residual, classify by errors **since the last redrive pass**, not all-time —
a parcel that failed transiently three runs ago and succeeded since is not a residual.
Confirm a dead tail with a sample redrive: re-run ~40 residual parcels live; 0/40
recovered with ≥97% of the fresh errors carrying the dead signature ⇒ confirmed dead,
stop chasing. Proxies do NOT help dead folios — the page loads fine (no geo-block), it
just has no data.

## 8. Wrap-up

- `CountyIngest` completing means appraisal DISPATCH is done — permit harvests it sent
  are still draining under their own caps. Wrap up only when: permit status artifacts
  exist for every eligible parcel, the `Loader` watermark covers the final artifacts, and
  a `Publish` tick ran after the last load. Reconcile with `monitoring-county-ingestion`:
  at appraisal terminal state `seed = ready + dead + current-invalid`; DB completion is
  verified separately (the `Loader` watermark covers the final artifacts, the distinct
  DB folio count covers `ready`); then permit-eligible vs permits loaded.
- Final publish: confirm the `Publish` tick ran post-approval and a smoke query answers
  for the county (`county-query-table-publish`).
- PR findings and any transform-script changes to `Counties-trasform-scripts`
  (`gh pr create`); commit code/docs, never data.
