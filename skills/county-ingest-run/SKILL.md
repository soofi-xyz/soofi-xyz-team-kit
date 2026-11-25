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
streams the seed into per-chunk `IngestChunk` children (~10k rows each, keyed
`<county>-<jobId>-c<N>`) that dispatch `Parcel.process` in bounded windows; when
appraisal dispatch completes it starts the `PermitFeed` workflow (keyed
`<CountyIngest key>-permits`, so a redrive pass feeds its own `…-r2-permits`), which
walks eligibility from the ledger and artifacts and dispatches
`PermitHarvest.harvestParcel` in its OWN bounded windows — neither side ever queues the
whole county. Journal replay is the only checkpoint. `CountyLedger` (virtual object keyed
`<county>-<jobId>`) is the single writer of per-parcel status: `pending`, `ready`,
`dead`, `invalid`, `failed`, with permit link results under `stage: "permits"`. See
`durable-workflow-builder` patterns 1 (backpressure feeder), 2 (layered concurrency),
8 (single-writer ledger), and 11 (chunked fan-out).

For an operator-requested full re-ingest, preserve this one order: readiness PASS and
seed/appraisal backbone → official corporate registry → official licensing-authority
adequacy-or-acquire → permit detail/contact harvest → permit evidence preflight and
versioned identity resolution → identity relationship files, reconcile, and product-query
rerun → BBB/places enrichment.

Everything runs locally (`bootstrap-oracle-infra`): Restate only from
`skills/use-oracle/runtime/local/compose.yaml` (ingress :8080, admin/UI :9070), one
services process (`services/app.ts`) on :9080, registered with
`restate deployments register http://host.docker.internal:9080` (or
`http://localhost:9080` with Linux host networking). Egress must be US
(`curl -s ipinfo.io/country` → `US`) — county portals geo-block.

## 1. Pilot (always first)

1. Pick ~25 parcels from the seed covering usage-type variability (commercial to exercise
   the permit path, residential to verify the skip path). Stage them as a pilot seed CSV.
2. Start the workflow with a distinct pilot jobId:

   ```bash
   curl localhost:8080/restate/send/CountyIngest/<county>-pilot-<date>/run \
     --json '{"county":"<county>","jobId":"pilot-<date>","seedPath":"seeds/<county>-pilot.csv","chunkSize":10000,"window":25}'
   ```

3. Verify one parcel end-to-end, in order: `capture.zip` on disk
   (`data/artifacts/appraisal/<county>/<jobId>/<parcel_id>/`) → `transformed.zip` →
   validation pass → `ready.json` (`captureHash`, `transformVersion`, `transformedHash`,
   `validatedAt`, `cli`) → the parcel's `CountyLedger` record
   (`curl localhost:8080/CountyLedger/<county>-<jobId>/get --json '{"parcel_id":"..."}'`
   shows `ready`) → `eligibility.json` (and, if eligible, permit artifacts under
   `data/artifacts/permits/<county>/<jobId>/` plus a `stage: "permits"` ledger record).
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
curl localhost:8080/restate/send/CountyIngest/<county>-<jobId>/run \
  --json '{"county":"<county>","jobId":"<jobId>","seedPath":"seeds/<county>.csv","chunkSize":10000,"window":25}'
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
`restate invocations list`, `restate sql` over `sys_invocation`/`state`,
`CountyIngest/<county>-<jobId>/status`, and `CountyLedger/<county>-<jobId>/summary`.

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
- **RETRYABLE** — transient (timeouts, 5xx, nav failures, connection refused). Fix the
  cause if needed, then `restate invocations resume <id>`.
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

## 6. Reconcile

Reconciliation is computed from the `CountyLedger` plus the artifact files — never from
SQL. Run it during the full run to watch drift, and with `--strict` before wrap-up:

```bash
cd skills/use-oracle/runtime
node bin/reconcile-county.mjs --county <county> --job <jobId> \
  --restate http://localhost:9070 --strict
```

It reads the ledger (Restate admin SQL query API first, falling back to
`CountyLedger/summary` + `list` through ingress), the seed, and the ready markers, then
writes the durable run manifest `data/runs/<county>/<jobId>/manifest.json`: counts by
status, dead/invalid reasons, permits linked/unlinked by reason, ready-marker hash
coverage, and ledger-vs-file mismatches. Restate keeps finished state only for its
retention window, so the manifest is the record of the run. `--strict` exits non-zero on
a failed gate. Require every gate:

- **Seed identity:** `seed = ready + dead + invalid`; before completion the remainder is
  `pending` or `failed`, never unaccounted.
- **Unique keys:** no duplicate parcel keys. The key is the official folio/request
  identifier as a string; never a digits-only normalization, which collapses distinct
  lettered parcels. Use normalized identifiers only as bounded matching candidates.
- **Ready-marker hash coverage:** every `ready` parcel has `ready.json` whose
  `transformedHash` matches its `transformed.zip` and whose `transformVersion` is
  current. A missing or mismatched marker is not ready, not an empty record.
- **Tombstones:** a parcel that was `ready` and is now `dead` or `invalid` keeps its
  `dead.json`/`invalid.json` and reason and is excluded from every group directory.
- **Ledger = files:** zero mismatches between ledger status and the markers on disk.
- **Permits:** every harvested permit is linked to its requested parcel or explicitly
  unlinked with a reason.

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

### Roof age and enrichment

Compute roof age from files after permit and identity reconciliation: the estimator
(`runtime/src/roof-age/`, called from the transform) reads the transformed appraisal
output and the job's extracted permit artifacts and writes the estimate and lineage
into the lexicon output. Preserve accepted work and lifecycle-status mapping, the
selected permit or built-year fallback, source profile and digest, evidence date
precision, confidence and historical-coverage caveats, and the as-of date and terminal
reason. Do not infer replacement from generic repair text, open permits, coatings,
accessory roofs, or impossible dates. See
[`roof-age-and-identity-reingest.md`](../use-oracle/reference/roof-age-and-identity-reingest.md).

Run BBB, places, HOA/property management, and AVM as separate enrichment tracks with
their own source and licence gates and their own manifests. They may add useful
evidence but never establish corporate or licensing identity or change core permit
completeness. Their working Parquet and coverage files are internal intermediates:
never upload them or point MCP at them.

### Assemble group directories

After a strict pass, assemble each data group from ready parcels only:

```bash
node bin/reconcile-county.mjs --county <county> --job <jobId> --strict \
  --assemble <group>
```

This writes `data/groups/<county>/<jobId>/<group>/`. Hand those validated directories
to `use-oracle` (or `PublishGroup`) for the Atlas sequence.

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

- `CountyIngest` completing means appraisal DISPATCH is done — permit harvests sent by
  `PermitFeed` are still draining under their own caps. Wrap up only when permit status
  artifacts exist for every eligible parcel and `reconcile-county.mjs --strict` passes
  every gate in §6 (`seed = ready + dead + invalid`, no duplicate keys, ready-marker hash
  coverage, tombstones excluded, ledger = files, every permit linked or unlinked with a
  reason). Keep the resulting `manifest.json`; it outlives Restate retention.
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
