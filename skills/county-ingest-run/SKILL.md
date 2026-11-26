---
name: county-ingest-run
description: "Operate the end-to-end property-first ingestion run for an onboarded county: pilot batch, source-feasibility gate, backpressure-aware full run with stepwise ramp-up, and the ledger-and-files reconciliation that gates Atlas publication. Use when starting, scaling, resuming, reconciling, or wrapping up a county ingestion run."
metadata: {"author":"elephant-xyz"}
---
# County Ingest Run

Prerequisites: `bootstrap-oracle-infra` checks pass; appraisal onboarding, transform
validation, and the permit adapter are done for the county. Before any permit harvest
(pilot or full `PermitFeed`), load and reconcile the identity baseline: the official
corporate registry first, then a fail-closed adequate official contractor-licensing
snapshot (licenses, qualifier/person relationships, qualified-business relationships,
status, and effective dates covering the ingest window). In Florida, run
`sunbiz-corporate-ingest` then `dbpr-license-ingest`; elsewhere name and use the official
state equivalents in the county profile. Adapter build may already exist; harvesting
permits first or in parallel with those registries is not allowed. If licensing data is
missing, stale, unreconciled, empty, reputation-only, or name-only, acquire the official
snapshot next and do not start `PermitFeed` until adequate or the operator aborts.

Run parameters (county slug, jobId, pilot vs full scope, seed CSV) come from the
`onboard-county` intake — don't re-ask what's already established. If entered directly
without that context, ask for the missing parameters once before starting: a run sends
sustained traffic to county websites and should never start on guessed inputs.

## Run shape

Property-first: each parcel flows capture → transform → validate (fail-closed) → ready
marker → `CountyLedger` record → eligibility branch → permit harvest, individually.
Restate is the only run-state store (progress, retries, per-parcel status, dedupe,
resume); files under `DATA_DIR` hold all data. There is no SQL database. Public
publication happens later through the Atlas CAR/table sequence in `use-oracle`, from
validated group directories, never from Restate state. County-level identity registries
(Sunbiz + official DBPR) are a predecessor of this permit harvest, not a later
enrichment join. Input is ONLY the seed CSV at `data/seeds/<county>.csv` (never
re-derive work from run state). The `CountyIngest` workflow (keyed `<county>-<jobId>`)
indexes the seed once and hands each ~10k-row byte range to an `IngestChunk` child
(keyed `<CountyIngest key>-c<N>`) that dispatches `Parcel.process` in bounded windows;
when appraisal dispatch completes it runs and awaits the `PermitFeed` workflow (keyed
`<CountyIngest key>-permits`, so a redrive pass feeds its own `…-r2-permits`) unless the
run passed `startPermits: false`; `CountyIngest/status` then shows phase `permits` and,
at the end, `done` with the permit counts (`appraisal-done` without permits). `PermitFeed` rebuilds the eligible index from the
`eligibility.json` files and runs child passes of itself (`<PermitFeed key>-c<N>`) that
dispatch `PermitHarvest.harvestParcel` in their OWN bounded windows (`permitWindow`,
default `window`) — neither side ever queues the whole county. Journal replay is the
only checkpoint. `CountyLedger` (virtual object keyed `<county>-<jobId>`) is the single
writer of per-parcel status: `pending`, `ready`, `dead`, `invalid`, `failed`, with permit
link results under `stage: "permits"` (where `blocked` marks a blocked permit source). See
`durable-workflow-builder` patterns 1 (backpressure feeder), 2 (layered concurrency),
8 (single-writer ledger), and 11 (chunked fan-out).

For an operator-requested full re-ingest, preserve this one order: readiness PASS and
seed/appraisal backbone → official corporate registry → official licensing-authority
adequacy-or-acquire → permit detail/contact harvest → permit evidence preflight and
versioned identity resolution → identity relationship files, reconcile, and product-query
rerun → BBB/places enrichment.

Everything runs locally (`bootstrap-oracle-infra`): Restate only from
`skills/use-oracle/runtime/docker-compose.yml` (ingress :8080, admin/UI :9070, loopback),
one services process (`npm run services`) on :9080, registered with `npm run register`
(`npm run register -- --uri http://localhost:9080` with Linux host networking). Run the
commands below from `skills/use-oracle/runtime`. Egress must be US
(`curl -s ipinfo.io/country` → `US`) — county portals geo-block.

## 1. Pilot (always first)

1. Pick ~25 parcels from the seed covering usage-type variability (commercial to exercise
   the permit path, residential to verify the skip path). Stage them as a pilot seed CSV.
2. Start the workflow with a distinct pilot jobId:

   ```bash
   curl localhost:8080/CountyIngest/<county>-pilot-<date>/run/send \
     --json '{"county":"<county>","jobId":"pilot-<date>","seedPath":"seeds/<county>-pilot.csv","chunkSize":10000,"window":25}'
   ```

3. Verify one parcel end-to-end, in order: `capture.zip` on disk
   (`data/artifacts/appraisal/<county>/<jobId>/<parcelKey>/`, where `<parcelKey>` is the
   parcel id or its filesystem-safe form) → `transformed.zip` and `transformed.meta.json`
   (check the Seed group was merged when the county transform emits none) → validation
   pass (`validate-findings.csv` empty) → `ready.json` (`captureHash`,
   `transformVersion`, `transformedHash`, `validatedAt`, `cli`, `dataGroups`) → the
   parcel's `CountyLedger` record
   (`curl localhost:8080/CountyLedger/<county>-<jobId>/get --json '{"parcel_id":"..."}'`
   returns `parcel.status: "ready"`) → `eligibility.json` (and, if eligible, permit
   artifacts under `data/artifacts/permits/<county>/<jobId>/`, the link status
   `status/<parcelKey>.json`, and a `permits` entry in the same `get` response).
4. Verify a permit-less parcel completes cleanly and a residential parcel stops after
   archive with `eligibility.json` showing `eligible: false` and no permit artifacts.
5. Record pilot timings per source: observed latency, safe concurrency, retry/failure
   rate, projected full-county duration. For browser-captured sources, measure with the
   ladder in
   [`source-access.md`](../use-oracle/reference/source-access.md#5-measure-throughput)
   (1 → 20 back to back → 20 at 4 workers → sustained), apply the vendor recipe's session
   rule, and count captures complete only when the recipe's readiness condition holds and
   the file clears its size floor. Do not add delays that were not measured as needed. If
   every record fails the same way, re-test one known-good record with a known-good probe
   before blaming the source.

## 2. Feasibility gate before full run

Project full-county duration from the pilot rate for every source that will be scraped:

- If the estimated full acquisition is 48 hours or less, proceed with the measured safe
  concurrency.
- If any source is estimated above 48 hours, do not scale it by default. Ask the operator
  whether to download artifacts anyway, ingest an official bulk export or records
  extract as artifact files instead of scraping, or retrieve it at runtime.
- If runtime retrieval is selected, ask which app/service owns the lookup and what the
  runtime path should be (direct API call, server-side scrape, cached lookup, queued
  background fetch). Record freshness, latency, and failure behavior before changing scope.

## 3. Full run

Same workflow, full seed:

```bash
curl localhost:8080/CountyIngest/<county>-<jobId>/run/send \
  --json '{"county":"<county>","jobId":"<jobId>","seedPath":"seeds/<county>.csv","chunkSize":10000,"window":25}'
```

The run checks up front that the county has a transform and a capture route (capture
plug-in, prepare flow, `source_url` seed column, or `PREPARE_URL_TEMPLATE_<COUNTY>`) and
fails terminally otherwise. Add `"startPermits": false` for an appraisal-only pass and
`"permitWindow"` to bound permit dispatch separately.

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
`restate invocations list`, `restate sql` over `sys_invocation`/`state`,
`CountyIngest/<county>-<jobId>/status`, and `CountyLedger/<county>-<jobId>/summary`
(POST to the ingress).

### Incremental progress

Report progress per chunk, not only at the end. When `chunksDone` in
`CountyIngest/<county>-<jobId>/status` advances:

1. Refresh the run manifest without gating:
   `npm run reconcile -- --county <county> --job <jobId>` (no `--strict`; add `--no-rehash`
   on a large county to keep it quick). Mid-run `seed_complete` and `permits_complete`
   fail by design.
2. Push coverage by hand
   ([`pipeline-reporting.md`](../use-oracle/reference/pipeline-reporting.md#coverage-push-every-mining-machine)).
3. Report `chunksDone` of `chunks`, ready/dead/invalid/failed from the manifest, the
   Pipeline stage, and the Local %.

**Pack as you go (planned).** The goal is to assemble, validate and hash each finished
chunk so final packing is short. The runtime has no per-chunk packing command yet:
`--assemble` and `PublishGroup` work on the whole job. Until one exists, pack once after
the strict reconcile (§6).

## 4. Ramp-up & Warm Worker Pool Optimization

Raise the `CONCURRENCY_*` caps in `skills/use-oracle/runtime/.env` stepwise
(`CONCURRENCY_PREPARE[_<COUNTY>]`, `CONCURRENCY_TRANSFORM[_<COUNTY>]`,
`CONCURRENCY_PERMIT_<ADAPTER>` such as `ACCELA` or `TYLER_CIVIC_ACCESS` — in-process gates per
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
- **Restate flow control (evaluated, not the default).** Restate 1.7 has experimental
  scoped concurrency limits that could replace the chunk feeder and the in-process caps.
  The Cobb evaluation was promising, with caveats: it needs Restate 1.7.9 or newer, a
  fresh or migrated cluster, and `experimental_enable_vqueues`, and the cap must be set
  from the source's measured request rate. Keep the feeder and `CONCURRENCY_*` caps
  unless the operator approves trying it on a new run.

### High-Throughput Transform Optimization: Warm Worker Pool (`TransformPool`)

This applies to the scripts runner in `src/core/transform-runner.mjs` (the
`elephant-county` CLI path). The Restate `Parcel` path runs one Elephant CLI transform
per parcel under `CONCURRENCY_TRANSFORM`; prefer Elephant CLI 2 there, which needs no
Node process per call.

When transforming 500k+ parcels locally, spawning fresh Node.js subprocesses per parcel
(`child_process.execFile` / `execPath`) creates severe process-spawning overhead, thrashing
CPU cores, causing excessive fan noise, and dropping throughput to ~2-5 parcels/sec.

**Always use a Warm Worker Pool (`TransformPool` via `child_process.fork`)**:
1. Spawn a bounded pool of persistent child workers (`transform-worker.cjs`, sized to `os.cpus().length` or 8-16 workers).
2. Workers pre-compile Cheerio and all transform scripts once on startup.
3. IPC messages send `{ parcelDir }` to the next idle worker and return `{ success, error }`.
4. Achieves **20–60+ parcels/sec** sustained throughput with low CPU overhead and no fan thrashing.

### Memory Optimization: Streaming Seed CSV Processing

The shipped `CountyIngest` already streams: it indexes the seed once and each
`IngestChunk` reads only its byte range. Keep that property in any new seed tooling.
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

When reconciling or validating transformed parcels:
- Prioritize reading `transformed_output.zip` using in-memory `AdmZip` rather than performing 15 sequential `fs.readFile()` calls for loose JSON files. This yields a **6.7x speedup** in disk I/O.
- Batch directory iterations in chunks of 256–512 with `Promise.all`.

## 5. Failure handling

Failed steps retry with backoff and **pause at max attempts** — visible in the UI with
the full journal. Inspect the journal, classify, act:

- **DEAD** — permanent source conditions (parcel retired/renumbered, page loads with no
  detail grid, selector permanently absent, true 404). Handlers record these
  (`dead.json` + a `dead` ledger record) and return normally — never thrown, so one
  dead parcel cannot fail its chunk (`durable-workflow-builder` pattern 5). Do not
  chase: achievable county count =
  seed − dead − current-invalid. A few record-heavy parcels can be unbounded-cost in
  any practical budget — document those in the dead/slow tail too, rather than letting
  them block wrap-up.
- **FAILED** — deterministic non-source errors (no transform configured, transform or
  capture error that is not network-shaped). Handlers write `failed.json`, record
  `failed` with a reason, and return. Fix the cause, then redrive those parcels (§7).
- **RETRYABLE** — transient (timeouts, 5xx, nav failures, connection refused). Fix the
  cause if needed, then `restate invocations resume <id>`.
- **Elephant CLI exit 2** ("could not run") is classified by its message: HTTP 404/410
  from the source → DEAD; network-shaped (connection, timeout, DNS, 5xx, schema fetch) →
  RETRYABLE; anything else → FAILED (capture/transform) or INVALID (validate).
- **Ambiguous 500s**: disambiguate with a couple of unloaded probes (curl the detail URL
  directly, no concurrent scrape load, ideally from more than one IP). 200 → load-induced,
  back off concurrency and resume. Consistent 500 unloaded → source-side defect, treat as
  dead tail.
- **Never gate completion on an exact source count.** An exact `== source` assert against
  a source with a dead tail loops forever. Gate on `ready >= achievable`.

See `durable-workflow-builder` pattern 5 for the full taxonomy.

Geo-block or portal outage: pause the affected invocations (or stop the services
process), fix egress (US VPN/proxy — verify `curl -s ipinfo.io/country` → `US`), resume;
Restate redispatches. Machine crash or reboot: compose restarts Restate
(`restart: unless-stopped`), but the services process must also be relaunched (run it
supervised/detached for multi-day runs — see the `bootstrap-oracle-infra` gotchas);
the run then resumes from its journals — no watchdog, no re-streaming.

**Moving a run to another machine.** Never let two machines mine the same job.

1. Stop the old machine: kill the job's Restate invocations
   (`restate invocations kill`) and stop and disable its services and any timers or units
   that restart them.
2. Verify it stopped: no running invocations for the job, no services process, and the
   artifact counts no longer change.
3. Copy the artifacts: `rsync -a --delete --exclude '*.tmp' <old>:<DATA_DIR>/ <DATA_DIR>/`
   (seed, artifacts, runs).
4. Start the same `jobId` on the new machine (a `-rN` workflow key, §7, if that key
   already ran on its Restate); parcels already finished are skipped by their hash.
   Move the coverage push with the run (`bootstrap-oracle-infra`).

## 6. Reconcile

Reconciliation is computed from the `CountyLedger` plus the artifact files — never from
SQL. Run it during the full run to watch drift, and with `--strict` before wrap-up:

```bash
cd skills/use-oracle/runtime
npm run reconcile -- --county <county> --job <jobId> --strict
# same as: node bin/reconcile-county.mjs --county <county> --job <jobId> --strict
```

Flags: `--restate <admin-url>` (default `RESTATE_ADMIN_URL` or `:9070`), `--ingress
<ingress-url>` (default `RESTATE_INGRESS_URL` or `:8080`), `--seed <DATA_DIR-relative
csv>` (default: the `seedPath` the run was started with, read from the `CountyIngest`
`<county>-<jobId>` state through the admin API or its `status` handler, then
`seeds/<county>.csv`; the manifest records `seed.source`), `--strict`, `--assemble <group>`, and `--no-rehash`
(trust `ready.json` hashes instead of rehashing every `transformed.zip`; use only for a
quick mid-run look). It reads the ledger through the Restate admin SQL query API,
falling back to `CountyLedger/summary` + `list` through ingress, plus the seed and the
artifact markers, then writes the durable run manifest
`data/runs/<county>/<jobId>/manifest.json`: counts by status, dead/invalid/failed
reasons, tombstones, permits linked/unlinked by reason, blocked permit sources by
jurisdiction (apart from dead parcels), ready-marker hash coverage, and ledger-vs-file
mismatches. The services keep finished workflow state for 14 days
(`PublishGroup` 30), so the manifest is the record of the run. Exit codes: 0 ok, 1 a
gate failed under `--strict`, 2 the command could not run. Require every gate:

- **`seed_accounted`:** every seed parcel has exactly one ledger entry and
  `seed = ready + dead + invalid + pending + failed`, with no ledger entry outside the
  seed.
- **`seed_complete`:** `seed = ready + dead + invalid` — nothing `pending` or `failed`.
- **`no_duplicate_keys`:** no duplicate seed `parcel_id`, no artifact-key collision, no
  marker whose `parcel_id` disagrees with its directory. The key is the official
  folio/request identifier as a string; never a digits-only normalization, which
  collapses distinct lettered parcels.
- **`ready_hash_coverage`:** every ledger-ready parcel has `ready.json` whose
  `transformedHash` matches its `transformed.zip` (rehashed by default).
- **`ledger_files_agree`:** zero mismatches between ledger status and the markers on
  disk.
- **`permits_linked`:** every harvested permit is linked to its requested parcel or
  explicitly unlinked with a reason.
- **`permits_complete`:** every eligible ready parcel has a permit status file and the
  status files agree with the ledger. It reports `not_started` when no permit pass has
  run for the job; that is not a pass for a run that includes permits.
- **`tombstones_excluded`:** a parcel that was `ready` and is now `dead` or `invalid`
  (and any parcel not verified ready, or assembled from an older transform) is absent
  from every group directory.

### Permit and official identity reconciliation

- Link a permit to the REQUESTED parcel from the harvest request's target evidence.
  Use exact folio/source identity first; normalized parcel or address evidence only as
  an explicit, recorded fallback. Never trust a portal's displayed related parcel
  without reconciling it to the target. Keep valid permits that cannot be linked,
  `unlinked` with a reason, and record match method, version, and source hashes.
- Preserve raw contractor names and omitted license values in the permit artifacts.
- Resolve contractor companies per
  [`permit-evidence-preflight.md`](../use-oracle/reference/permit-evidence-preflight.md):
  an official license number, or one unique company plus a temporally valid licensed
  qualifier. Persist company, person, and license only from the official DBPR/Sunbiz
  detail records and emit them as lexicon relationship files —
  `property_improvement_has_contractor`, `contractor_has_license`
  (`license_identifier` on `license`), and `contractor_has_person`. Write a permit-level
  contractor edge only when every contractor-role contact on that permit resolves to the
  same company.
- Record resolver version and identity-snapshot digests in a private, immutable
  resolution ledger (JSONL) beside the job's permit artifacts. Keep unresolved,
  ambiguous, conflicting, stale, and orphaned identities unlinked there with reasons.
  Name, phone, address, BBB, and places matches are candidates only.
- Gap: no bundled runtime stage emits these identity relationship files or the
  resolution ledger yet, and none turns the permit artifacts into a publishable
  `property_improvement` group either: the Restate permit path writes permit artifacts
  and link status only, so today only the County group (or another appraisal-transform
  group) is publishable through `PublishGroup`. Until one exists, produce them with a reviewed, versioned resolver and report the
  identity edges as not generated when none ran.

### Roof age and enrichment

Roof age is a file-based step, but it is not yet wired into the Restate pipeline: the
`Parcel` transform does not call the estimator, and nothing yet builds roof-age record
JSONL from transformed parcels plus permit artifacts. Today the estimator
(`runtime/src/roof-age/`) runs through the `elephant-county` scripts runner
(`src/core/transform-runner.mjs`, optional `roofAge`; it reads transformed parcel files
only, so it yields built-year anchors) or through
`bin/roof-age-backfill.mjs` over a prepared JSONL file — see
[`roof-age-and-identity-reingest.md`](../use-oracle/reference/roof-age-and-identity-reingest.md).
Report roof age as not computed for a run that has not done one of those. Preserve accepted work and lifecycle-status mapping, the
selected permit or built-year fallback, source profile and digest, evidence date
precision, confidence and historical-coverage caveats, and the as-of date and terminal
reason. Do not infer replacement from generic repair text, open permits, coatings,
accessory roofs, or impossible dates.

Run BBB, places, HOA/property management, and AVM as separate enrichment tracks with
their own source and licence gates and their own manifests. They may add useful
evidence but never establish corporate or licensing identity or change core permit
completeness. Their working Parquet and coverage files are internal intermediates:
never upload them or point MCP at them.

### Assemble group directories

Assemble each data group from verified ready parcels only:

```bash
npm run reconcile -- --county <county> --job <jobId> --strict --assemble <group>
```

Under `--strict` a failing gate blocks assembly and nothing partial is staged. It writes
`data/groups/<county>/<jobId>/<group>/<parcelKey>.zip` with the index
`<group>.assembly.json` beside the directory; each archive keeps the requested group plus
the Seed root, which every group archive carries. `--assemble seed` is rejected: never
publish Seed as its own group. Hand those directories to `use-oracle` (or
`PublishGroup`) for the Atlas sequence.

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
  pass on the new code, or ship an in-place replay-compatible fix via
  `npm run register -- --force` (`durable-workflow-builder` authoring rule 2). Plain `resume` is for
  world-fixes (egress, portal, disk), not code fixes.

Permit-scope redrives use the eligibility sentinels (see `county-appraisal-onboarding`):
an appraisal-only run sets `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_<COUNTY>` to
`__NONE__` (or passes `startPermits: false`); widening to full permit coverage later is a
re-run with `__ALL__` — skip-existing makes the appraisal side a no-op. Unset means
`__NONE__` (appraisal only), so a run that should harvest permits silently harvests none;
set the variable explicitly for every county. The services process is shared across
counties — resolve the
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

- `CountyIngest` completing means appraisal DISPATCH is done — permit harvests sent by
  `PermitFeed` are still draining under their own caps. Wrap up only when permit status
  artifacts exist for every eligible parcel and `reconcile-county.mjs --strict` passes
  every gate in §6 (`seed_accounted`, `seed_complete`, `no_duplicate_keys`,
  `ready_hash_coverage`, `ledger_files_agree`, `permits_linked`, `permits_complete` —
  `not_started` only for an appraisal-only run — and `tombstones_excluded`). Keep the resulting `manifest.json`; it outlives Restate retention.
- Before wrap-up, rerun the current versioned official-identity resolver over the
  harvested permits and regenerate the identity relationship files. Preserve raw names
  and omitted licenses; unresolved, ambiguous, or conflicting contacts remain unlinked
  in the resolution ledger. Rerun the product query in
  `use-oracle/reference/roof-age-and-identity-reingest.md`.
- When public publication is in scope, assemble the group directories (§6) and hand
  them to `use-oracle` for the Atlas CAR/table sequence. Do not run another publisher or
  create a per-county public pointer.
- PR findings and any transform-script changes to `Counties-trasform-scripts`
  (`gh pr create`); commit code/docs, never data.
- Return pilot/full counts, source rates, failure classes, the run manifest path and its
  gate results (status counts, dead/invalid reasons, tombstones, hash coverage,
  mismatches), permit links and unlinked reasons, official identity edges, roof-age and
  enrichment coverage, and the validated group directories ready for the Atlas sequence.
