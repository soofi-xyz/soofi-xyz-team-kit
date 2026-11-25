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
from its start. File writes: deterministic path, atomic tmp+rename, skip when the input
hash and transform version already match. Ledger records: idempotent per
`(parcel_id, stage, status, artifactHash)`. External calls: check-then-act or natural
idempotency. In the old pipeline, at-least-once delivery times
non-idempotent completion callbacks produced an entire class of dead-token churn bugs;
this rule makes the class impossible.

**5. DEAD vs RETRYABLE taxonomy.** Permanent per-item conditions (404 page, parcel gone,
selector permanently absent) are RECORDED — `dead.json` next to the artifacts plus a
`dead` `CountyLedger` record — and the handler returns normally. Never throw for a per-item
condition: a thrown `TerminalError` propagates through the chunk's `RestatePromise.all`
and fails the whole run. Reserve `TerminalError` for invocation-level permanent errors
(invalid payload, broken config). Transient conditions (timeouts, 5xx, nav failures)
throw ordinary errors — retried with backoff, pausing at max attempts. Disambiguate an
HTTP 500 with a couple of unloaded probes before classifying. See the error taxonomy
section below.

**6. Claim-check.** Files go to `data/`; journals and object state (including
`CountyLedger`) hold only paths, hashes, and small JSON — never file contents. Restate caps payload entries at 32 MiB — never put
captures or zips in workflow state. The old pipeline blurred artifact store, state store,
and signalling channel into one storage layer; here the filesystem plays only the
artifact role.

**7. Fail-closed validation gate.** Every parcel passes `elephant-cli validate` (exit 0)
before it is marked ready or its permits are enqueued. A parcel that fails is recorded
`invalid` and excluded — never silently published. The mechanism: group assembly and
reconciliation enumerate `ready.json` markers (written only after validation passes,
removed on dead/invalid) — never raw `transformed.zip` files, which exist before
validation runs. Status transitions are ORDERED: `transform()` removes `ready.json`
before regenerating (a replacement is not ready until revalidated); `ready.json` records
`captureHash`, `transformVersion`, and `transformedHash`, and reconciliation accepts a
parcel only on hash match; `ready → invalid/dead` leaves a TOMBSTONE (`invalid.json` or
`dead.json` plus the ledger record) that excludes the parcel from every group
directory; a later pass that validates clears BOTH stale markers. Test all four
transitions (`ready→invalid`, `ready→dead`, `invalid→ready`, `dead→ready`). Origin: a
branch of the old pipeline skipped validation and unvalidated data was published. See
`build-county-transform`.

**8. Single-writer ledger (Virtual Object).** Per-parcel status has exactly one writer:
`CountyLedger`, keyed `<county>-<jobId>`. The object's per-key serialization replaces
locks; handlers (`Parcel`, `PermitHarvest`) never write status files that compete with
it — they write artifacts at deterministic paths, then send one `record`. Different
counties and jobs have different keys and run in parallel. Read handlers (`get`,
`summary`, `list`) are `shared`, so monitoring never queues behind writes. Validate the
key against the payload: a `record` whose `parcel_id` path or county does not match the
object key is a `TerminalError`. Keep state small (pattern 6) and paginate `list` with a
cursor. Restate keeps finished state only for its retention window, so
`bin/reconcile-county.mjs` writes the durable per-run manifest
(`data/runs/<county>/<jobId>/manifest.json`) from the ledger plus the files; prefer the
Restate admin SQL query API for bulk ledger reads and fall back to `summary` + `list`.

**9. Human approval as a durable promise.** `PublishGroup` (workflow keyed
`<county>-<group>-<jobId>`) runs validate → hash → validate CAR → export-tables, then
awaits a durable promise resolved by `approve({approvedBy})` or rejected by
`reject({reason})`. Bind the approval to the immutable group digest it reviewed; a
changed group needs a new workflow key. Only after approval does it upload the CAR and
tables with readback. It stops before the Atlas PR, which stays a human/agent `gh` step.
No "missing parameter means approved" convention.

**10. Self-scheduling reconciliation loop.** Recurring internal work is a virtual-object
handler that re-schedules itself with a delayed send or waits with `ctx.sleep`. Persist
one scheduled flag and one content digest so a fresh county cannot sit pending and
unchanged multi-GB working artifacts are not rebuilt every interval. Clear pending only
after a reconcile pass writes its manifest with every gate passing. Public publication
remains the separate CAR/table/Atlas sequence. This replaces naive cron poll loops and
the stale-checkpoint watchdog — which, in its no-cooldown form, once piled ~150
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
  source; `assert ready == seedTotal` produces an infinite retry loop (the old pipeline
  burned ~10 h per attempt on exactly this). Gate on `ready >= achievable`, where
  achievable = seed − dead − current-invalid, and reconcile the same identity:
  seed = ready + dead + current-invalid ("current" because a stale `invalid.json` is
  cleared when a later validation passes).

## Operate & debug quick reference

```bash
docker compose -f local/compose.yaml up -d   # Restate only (from skills/use-oracle/runtime)
npx tsx services/app.ts                   # services on :9080
restate deployments register http://host.docker.internal:9080   # or http://localhost:9080 on Linux host networking; --force in dev only

# start a run (fire-and-forget)
curl localhost:8080/restate/send/CountyIngest/<county>-<jobId>/run \
  --json '{"county":"lee","jobId":"2026q3","seedPath":"seeds/lee.csv","chunkSize":10000,"window":25}'

# inspect
restate invocations list
restate invocations describe <id>         # journal, current step, last error
restate invocations resume <id>           # after fixing a paused invocation
restate invocations cancel <id>           # graceful; kill <id> as last resort
restate sql "SELECT id, target, status FROM sys_invocation WHERE status != 'completed'"
curl -s localhost:8080/CountyLedger/lee-2026q3/summary         # per-status counts
node bin/reconcile-county.mjs --county lee --job 2026q3        # manifest; add --strict to gate
```

- **Web UI `http://localhost:9070`**: invocations with live journals, workflow/object
  state (for example `CountyIngest` chunksDone and `CountyLedger` counters), paused invocations
  with their error, and per-service configuration (retries and the inactivity/abort
  timeouts from authoring rule 3 — not concurrency).
- **Concurrency caps live in `.env`** (`CONCURRENCY_*`, pattern 2): edit and restart the
  services process — safe mid-run, invocations resume from their journals. Use the UI to
  watch error rates while ramping; it does not tune caps on this stack.
- Counts for reconciliation: `find … | wc -l` over `data/artifacts` (pattern 13), the
  `CountyLedger` summary, and the manifest from `bin/reconcile-county.mjs`.
- Run operations end-to-end (pilot, ramp, wrap-up): `county-ingest-run`. Status and ETA
  reporting: `monitoring-county-ingestion`.
