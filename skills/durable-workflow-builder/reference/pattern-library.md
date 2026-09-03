# Durable Workflow Pattern Library

Distilled patterns from running the county pipeline at full scale. Referenced by [`../SKILL.md`](../SKILL.md).

## Pattern library

The distilled lessons of a production county pipeline. Apply them as written.

**1. Backpressure feeder.** Never dispatch a whole county at once — the previous pipeline
once dumped 516k messages into a queue, exceeding retention and losing all flow control.
The `CountyIngest`/`IngestChunk` pair above IS the fix: `window` (25–100) bounds
in-flight calls, per-chunk child workflows bound journal growth, and replay resumes
mid-chunk. Crash/reboot resumes mid-county; no checkpoint files, no watchdog timers, no
re-streaming a 282 MiB seed from row 1 on every wakeup.

**2. Layered concurrency.** Three layers: admission window (feeder) → per-stage/portal
semaphores in the services process → in-process pools (browser contexts). The Restate
server does NOT enforce per-service concurrency caps on this stack (server-side flow
control is a 1.7 preview behind experimental flags — adopt it once stable); the enforced
cap is an in-process gate with limits from env:

```ts
// lib/limits.ts — one semaphore per named stage/portal, cap from CONCURRENCY_<NAME>
import pLimit from "p-limit";
const gates: Record<string, ReturnType<typeof pLimit>> = {};
export const envPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const gate = (name: string, fallback: number) => {
  const n = Number(process.env[`CONCURRENCY_${envPart(name)}`]);
  return (gates[name] ??= pLimit(Number.isInteger(n) && n >= 1 ? n : Math.max(1, fallback)));
};
// countyGate: county-scoped cap when set, else the bare stage cap — so the skeleton
// honours CONCURRENCY_PREPARE_PALM_BEACH without edits, and falls back to CONCURRENCY_PREPARE.
export const countyGate = (stage: string, county: string, fallback: number) =>
  process.env[`CONCURRENCY_${envPart(stage)}_${envPart(county)}`]
    ? gate(`${stage}_${county}`, fallback) : gate(stage, fallback);
// empty/0/garbage env values fall back — a gate never throws or silently blocks forever;
// envPart makes hyphenated counties safe: prepare_palm-beach → CONCURRENCY_PREPARE_PALM_BEACH

// usage inside a handler step (canonical gate names: prepare, transform, permit_<vendor>):
await ctx.run("capture", () => gate("prepare", 8)(() => capture(p, dest)));
await ctx.run("harvest", () => gate("permit_accela", 2)(() => harvest(p)));
```

Portal politeness numbers: prepare ~50 after burn-in, transform ~100, permit portals
start at 2 — Accela degrades above ~4. To change a cap: edit `.env` and restart the
services process — safe mid-run, in-flight invocations resume from their journals. Ramp
one step at a time; watch error rates in the UI after every step. Each feeder's `window`
(appraisal and permit sides alike) bounds its in-flight work, so gates only shape short local queues, never unbounded
ones. Running two counties concurrently? Scope the gate name per county —
``gate(`prepare_${county}`, 8)`` → `CONCURRENCY_PREPARE_PALM_BEACH` (envPart normalizes
the hyphenated slug); the bare names imply one county at a time.

**3. Deterministic keys + skip-existing resume.** Artifact paths derive from
county/jobId/folio only (`safeKeyPart()` sanitization); every writer checks before it
writes. Re-running anything is safe and cheap — resume is a property of the paths, not a
separate redrive procedure. Redrive passes therefore reuse the SAME `jobId` payload
under a NEW workflow key (`<county>-<jobId>-r2`): the key gives the pass exactly-once,
the unchanged jobId keeps artifacts in the same namespace so skip-existing applies.

**4. Idempotent side effects in `ctx.run`.** A step interrupted mid-flight re-executes
from its start. File writes: deterministic path, atomic tmp+rename. DB: `ON CONFLICT DO
UPDATE`. External calls:
check-then-act or natural idempotency. In the old pipeline, at-least-once delivery times
non-idempotent completion callbacks produced an entire class of dead-token churn bugs;
this rule makes the class impossible.

**5. DEAD vs RETRYABLE taxonomy.** Permanent per-item conditions (404 page, parcel gone,
selector permanently absent) are RECORDED — `dead.json` next to the artifacts plus a
`status: "dead"` return — and the handler returns normally. Never throw for a per-item
condition: a thrown `TerminalError` propagates through the chunk's `RestatePromise.all`
and fails the whole run. Reserve `TerminalError` for invocation-level permanent errors
(invalid payload, broken config). Transient conditions (timeouts, 5xx, nav failures)
throw ordinary errors — retried with backoff, pausing at max attempts. Disambiguate an
HTTP 500 with a couple of unloaded probes before classifying. See the error taxonomy
section below.

**6. Claim-check.** Files go to `data/`; journals and object state hold only paths and
small JSON — never file contents. Restate caps payload entries at 32 MiB — never put
captures or zips in workflow state. The old pipeline blurred artifact store, state store,
and signalling channel into one storage layer; here the filesystem plays only the
artifact role.

**7. Fail-closed validation gate.** Every parcel passes `elephant-cli validate` before
its row is loaded or permits are enqueued. A parcel that fails is recorded and excluded
— never silently loaded. The mechanism: loaders and pre-load validation enumerate
`ready.json` markers (written only after validation passes, removed on dead/invalid) —
never raw `transformed.zip` files, which exist before validation runs. Status
transitions are ORDERED: `transform()` removes `ready.json` before regenerating (a
replacement is unloadable until revalidated); `ready.json` records the validated
transform hash and the Loader loads only on hash match; `ok → invalid/dead` leaves a
tombstone the Loader reconciles into a DB deletion or status downgrade; a later pass
that validates clears BOTH stale markers. Test all four transitions
(`ok→invalid`, `ok→dead`, `invalid→ok`, `dead→ok`). Origin: a branch
of the old pipeline skipped validation and unvalidated data reached the DB. See
`validate-county-transform`.

**8. Single-writer per county (Virtual Object).** Parallel bulk merges into DB parent
tables deadlock. Route ALL bulk loads for a county through `Loader.load` (object keyed by
`<county>`) — the object's per-key serialization replaces advisory locks and serial-task
constraints. Ownership split: `Parcel.process` keeps its per-parcel single-row upsert
(deadlock-safe); `Loader` owns every MULTI-row bulk merge, clear, and reload. The object
key is the identity: `Loader` derives `dbCounty = ctx.key.replace(/-/g, "_")`,
`jurisdictionKey = dbCounty + "_appraiser"`, and the job artifact prefix from key +
payload `jobId` — a payload-supplied value that differs from the derived one is rejected
with `TerminalError`, so a lee-keyed invocation can never clear or load another county.
`Loader` owns the permits track too: `PermitFeed` submits batched permit merges per
completed chunk (`tracks: ["permits"]`); harvesters write artifacts and status only,
never merge inline. Watermarks are content-aware: `watermark_<track>` state tracks
merged (path, artifact-hash) pairs — the hash index lives on disk under
`$DATA_DIR/staging/loader/<county>/<jobId>/` (claim-check; state stays small) — so an
in-place redrive that regenerates `transformed.zip` gets re-merged; a path-only
watermark would silently skip corrections. The incremental merge also consumes
invalid/dead TOMBSTONES — removing or downgrading previously loaded rows; without that,
a parcel that went invalid after loading lives on in the DB and the published data.
Loader steps are long: raise its timeouts per authoring rule 3. The same primitive makes `Publish` a per-county singleton for free. Merge
details: `query-db-loading-matching`.

**9. Human approval gate as durable state.** PII review: `Publish` dry-runs until
`Publish/<county>/approve` has been called once; `approve()` flips a durable flag in
object state. No external parameter store, no "missing param = dry-run" convention —
the gate is explicit state you can read in the UI.

**10. Self-scheduling loop.** Recurring work (the incremental publish tick) is a virtual
object handler that re-schedules itself with a delayed send —
`ctx.objectSendClient(publish, county).tick({}, restate.rpc.sendOpts({ delay: { minutes: 15 } }))`
— or waits with `ctx.sleep`. One tick per county runs the full publish sequence in
order: consolidation export/upload first (writes `manifest.json`), then the query-table
export/publish (which reads that manifest) — a single loop, not two competing ones.
`requestPublish()` sets pending AND arms the first tick when none is scheduled (persist
a `tickScheduled` flag; every tick re-arms exactly one successor) — a fresh county must
never sit pending forever. State machine: an unapproved tick dry-runs ONCE per content
watermark (persist `lastDryRunWatermark`), LEAVES `pending = true`, and stops re-arming
until `approve()` or a newer `requestPublish()` — never rebuild a multi-GB export every
15 minutes while waiting for a human. `approve()` sets approved and arms an immediate
tick when pending; `pending` clears only after a successful APPROVED publication. Replaces cron rules, poll loops, and the
stale-checkpoint watchdog — which, in its naive no-cooldown form, once piled ~150
duplicate feeder invocations that deadlocked the worker.

**11. Chunked fan-out.** Never run a whole county through one invocation: `window` bounds
concurrency but NOT journal length — 516k rows in a single journal is >1M entries,
replayed in full on every crash. The `IngestChunk` children in the skeleton bound both.
For independent bulk jobs (enrichment batches), same move: per-chunk workflows keyed by
chunk id.

**12. Geo-gate first.** Before debugging any scrape failure: `curl -s ipinfo.io/country`
must print `US` — county portals geo-block, and everything now runs on your machine.
Get US egress (VPN/proxy) before touching code. Politeness delays and proxy URLs are
worker config, not infra.

**13. Flat listing.** When reconciling artifact counts, one `find` sweep over the job
directory beats per-parcel stat-in-a-loop — the same ~80× lesson learned reconciling the
old pipeline, in filesystem form.
`find data/artifacts/appraisal/<county>/<jobId> -name transformed.zip | wc -l`.

**14. Raw-first capture.** Always store the raw capture next to the extraction so
re-transform never re-scrapes. Transform reads `capture.zip`, never a live page.

**15. 48-hour source-feasibility gate.** Probe source throughput before any full run
(pilot of ~100 parcels; measure latency, failure rate, safe concurrency). If full
acquisition exceeds 48h, stop and ask: download anyway / ingest-only / runtime retrieval
from the owning app. See `county-permit-adapter` for the permit-portal variant.

## Error taxonomy

- **Permanent, per-item (dead parcels)** — record and return per pattern 5; never throw,
  so one dead parcel cannot reject the sibling parcels awaited in the same chunk.
- **`TerminalError`** — permanent, invocation-level. Not retried; the invocation fails.
  Use for: invalid request payloads, broken configuration — cases where the invocation
  itself, not a data item, is unfixable by retry.
- **Any other thrown error** — retryable. Restate retries with exponential backoff and,
  at max attempts, **pauses** the invocation instead of dropping it. The stock 1.7
  server's default policy retries ~70 times with exponential backoff, then pauses
  (`on-max-attempts = pause`) — review/tune `default-retry-policy` (or per-service retry
  options via UI/CLI/SDK) during bootstrap so misclassified permanent failures pause on
  your intended schedule; an explicitly UNSET policy means unlimited retries and nothing
  ever pauses. Paused invocations
  are visible in the UI (:9070) with the full journal and last error: inspect, fix the
  WORLD (egress, portal, disk), then resume — resume replays onto the same deployment.
  For CODE fixes: `resume --deployment latest` only helps when a genuinely distinct
  deployment exists; on this single-endpoint local topology, prefer cancelling the
  paused invocations and re-running them as a redrive pass (pattern 3) on the new code,
  or an in-place replay-compatible fix per authoring rule 2. This replaces every
  DLQ-inspect-and-redrive procedure.
- **Never gate completion on an exact count.** Some parcels are legitimately dead at the
  source; `assert loaded == seedTotal` produces an infinite retry loop (the old pipeline
  burned ~10 h per attempt on exactly this). Gate on `loaded >= achievable`, where
  achievable = seed − dead − current-invalid, and reconcile the same identity:
  seed = loaded + dead + current-invalid ("current" because a stale `invalid.json` is
  cleared when a later validation passes).

## Operate & debug quick reference

```bash
docker compose up -d                      # restate + postgres
npm run dev                               # services on :9080 (tsx watch services/app.ts)
restate deployments register http://host.docker.internal:9080   # --force in dev only

# start a run (fire-and-forget)
curl localhost:8080/restate/send/CountyIngest/<county>-<jobId>/run \
  --json '{"county":"lee","jobId":"2026q3","seedPath":"seeds/lee.csv","chunkSize":10000,"batchSize":100,"window":25}'

# approve publish (durable PII gate; --json makes this a POST)
curl localhost:8080/restate/call/Publish/<county>/approve --json '{}'

# inspect
restate invocations list
restate invocations describe <id>         # journal, current step, last error
restate invocations resume <id>           # after fixing a paused invocation
restate invocations cancel <id>           # graceful; kill <id> as last resort
restate sql "SELECT id, target, status FROM sys_invocation WHERE status != 'completed'"
```

- **Web UI `http://localhost:9070`**: invocations with live journals, workflow/object
  state (e.g. `CountyIngest` chunksDone, `Publish` approved flag), paused invocations
  with their error, and per-service configuration (retries and the inactivity/abort
  timeouts from authoring rule 3 — not concurrency).
- **Concurrency caps live in `.env`** (`CONCURRENCY_*`, pattern 2): edit and restart the
  services process — safe mid-run, invocations resume from their journals. Use the UI to
  watch error rates while ramping; it does not tune caps on this stack.
- Counts for reconciliation: `find … | wc -l` over `data/artifacts` (pattern 13) and
  `docker compose exec postgres psql -U postgres elephant -c "..."`.
- Run operations end-to-end (pilot, ramp, wrap-up): `county-ingest-run`. Status and ETA
  reporting: `monitoring-county-ingestion`.
