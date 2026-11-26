---
name: durable-workflow-builder
description: "Author durable pipeline workflows for the skills/use-oracle/runtime project with Restate's TypeScript SDK — service topology, a code map of the shipped services, and the full pattern library (backpressure feeder, layered concurrency, deterministic keys, idempotent side effects, single-writer ledger, approval gates) distilled from running the previous county pipeline at full scale. Use when building or modifying pipeline workflows, adding a service or handler, choosing between workflow vs service vs virtual object, wiring retries, concurrency caps, or approval gates, or debugging stuck or paused invocations."
metadata: {"author":"elephant-xyz"}
---
# Durable Workflow Builder

All pipeline orchestration lives in `skills/use-oracle/runtime/services/` as TypeScript
Restate services in ONE Node process (`services/app.ts`, port 9080, bound to loopback
plus the Docker bridge gateway by default — `SERVICES_HOST`), registered with the
local Restate server from `skills/use-oracle/runtime/docker-compose.yml` (ingress :8080,
admin/UI :9070, loopback only). Restate is the only run-state store: progress, retries, per-parcel
status, dedupe, and resume. Files under `DATA_DIR` (default
`skills/use-oracle/runtime/data`) hold all data. There is no SQL database: no step writes
rows. The shipped services and `services/README.md` are the source of truth; the code map
below names the patterns to preserve when you change them. See `bootstrap-oracle-infra` for bring-up and
`county-ingest-run` for operating a run.

## Topology

| Name | Kind | Key | Handlers | Role |
|---|---|---|---|---|
| `CountyIngest` | workflow | `<county>-<jobId>[-rN]` | `run({county, jobId, seedPath, chunkSize=10000, window=25, startPermits=true, permitWindow?})`, `status()` | Indexes the seed once, runs one `IngestChunk` child per `chunkSize` rows (passing a seed byte range), then runs and awaits `PermitFeed` unless `startPermits: false`; `status()` phase `indexing` → `appraisal` → `permits` → `done` (or `appraisal-done`) with permit counts. Never enqueues the whole county. |
| `IngestChunk` | workflow | `<CountyIngest key>-c<N>` | `run({county, jobId, rows \| seed, window})`, `status()` | Takes inline `rows` or a `seed` byte range; dispatches `Parcel.process` in bounded windows. |
| `Parcel` | service | — | `process({county, jobId, parcel_id, source_identifier?, situs_address?, extra?})` | capture → transform → validate → ready marker → ledger record → eligibility. |
| `CountyLedger` | virtual object | `<county>-<jobId>` | `record({parcel_id, stage, status, reason?, artifactHash?, transformVersion?, detail?})`, `get({parcel_id})`, `summary()` (shared), `list({status?, cursor?, limit?, stage?})` (shared) | Single writer of per-parcel status. |
| `PermitFeed` | workflow | `<CountyIngest key>-permits`; children `<PermitFeed key>-c<N>` | `run({county, jobId, window, chunkSize?})`, `status()` | Rebuilds the eligible index, then hands each `chunkSize` slice to a child run of the same workflow, which dispatches `PermitHarvest.harvestParcel` in bounded windows. |
| `PermitHarvest` | service | — | `harvestParcel({county, jobId, parcel_id})` | Routes to the county's vendor adapters (`src/permits/adapters/*`), writes artifacts plus `status/<parcelKey>.json`, then records to the ledger. |
| `PublishGroup` | workflow | `<county>-<group>-<jobId>` | `run({county, jobId, group, groupDir, atlasPage, state, fips})`, `approve({approvedBy, groupDigest?})`, `reject({reason})`, `status()` | validate → hash → validate CAR → export-tables onto a STAGED Atlas page under `data/publish/…/atlas/`, waits on the durable promise `approval`, uploads CAR and tables with readback, then copies the staged page onto `atlasPage` (only if that page is unchanged since export). Stops before the Atlas PR. |

`CountyLedger` rules (`services/lib/ledger-state.ts`):

- Stages: `capture`, `transform`, `validate`, `ready`, `eligibility` (the parcel entry)
  and `permits` (a separate permit-link entry, so a permit outcome never changes the
  appraisal status). Statuses: `pending`, `ready`, `dead`, `invalid`, `failed`, plus
  `blocked` for `permits` only.
- `ready` requires `artifactHash` (sha256 of the validated `transformed.zip`) and
  `transformVersion`; `dead`, `invalid`, `failed`, and `blocked` require a `reason`; `detail` is an
  optional object. An identical re-record is a no-op.
- A parcel that was ever ready and is now `dead`/`invalid` is a tombstone; a later
  `ready` clears it. `summary()` returns counts, tombstones, and permit counts;
  `list({stage: "permits"})` pages permit entries.
- Permit mapping: harvest `done` → `ready` (reason `unlinked: N` when some permits are
  unlinked); `blocked` (the jurisdiction's source is blocked: captcha, login,
  custodian-only — harvestable later) → `blocked`; `unrouted`, `no_profile`,
  `not_eligible` → `dead`; `failed` → `failed`. Transient permit failures throw and
  retry; they are never recorded.

A redrive pass uses a new parent key `<county>-<jobId>-r<N>` with the SAME `jobId`
payload: children and `PermitFeed` derive their keys from the parent key, while the
artifact paths and the `CountyLedger` key (`<county>-<jobId>`) stay the same, so
skip-existing applies and the ledger keeps one status per parcel.

Pick the kind by state and keying:

- **Service** — stateless handlers, N concurrent invocations; per-item work.
- **Virtual Object** — keyed, single-threaded per key, durable K/V state
  (`ctx.set/get`); use where exactly-one-writer matters (`CountyLedger`). Mark read-only
  handlers `shared` so status reads never queue behind writes.
- **Workflow** — a keyed `run` handler that executes exactly once per key; use for jobs
  and for durable human gates (`PublishGroup.approve`).

**Durable execution in two sentences:** every `ctx.*` action is journaled; on crash,
restart, or redeploy the invocation replays the journal and resumes exactly where it
stopped. State, timers, and calls survive process death — no checkpoint files, no
re-streaming, no watchdogs.

**Three authoring rules that make durability hold:**

1. Every side effect (fetch, upload, file write, CLI exec) goes inside `ctx.run` AND must
   be idempotent — an interrupted step re-executes from its start, so file writes use
   deterministic paths with atomic tmp-file → rename, and steps skip work whose input
   hash and transform version already match.
2. Never mutate a registered deployment under in-flight invocations — replay against
   changed code corrupts journals. Local dev: `npm run register -- --force` and
   wiping the `restate-data` volume are fine *until a real run is live*. This
   single-process topology has no second endpoint for a true new version, so during a
   live run: freeze code; ship an in-place fix ONLY if it is replay-compatible (no
   journaled steps added, removed, or reordered) via `--force` re-register — an explicit,
   accepted risk; otherwise cancel/drain the affected invocations and re-run them as a
   redrive pass (pattern 3) on the new code.
3. Long-blocking steps need raised service timeouts. Server defaults are **1 min
   inactivity / 10 min abort** — a handler stuck inside one `ctx.run` longer than that is
   aborted and the step re-runs from its start, forever. For services with
   multi-minute steps (`Parcel` heavy captures, `PermitHarvest` detail-heavy parcels,
   `PublishGroup` hash and upload, `CountyIngest`/`PermitFeed` indexing) the service
   options already raise `inactivityTimeout`/`abortTimeout`; tune them with
   `{PARCEL,PERMIT,PUBLISH}_{INACTIVITY,ABORT}_TIMEOUT_MS`, and keep the work split into
   the smallest journaled steps that make sense.

## Code map

| File | What it holds |
|---|---|
| `services/app.ts` | One endpoint binding the seven services on `SERVICES_PORT` (9080). |
| `services/county-ingest.ts` | `CountyIngest` + `IngestChunk`: key checks (`<county>-<jobId>[-rN]` else `TerminalError`), seed index in one `ctx.run`, a fail-fast check that the county has a transform and a capture route, child keys derived from the parent key. |
| `services/parcel.ts`, `services/lib/parcel-flow.ts` | `Parcel.process` written against a small IO interface (`run` + `record`) so tests drive it with a fake. |
| `services/lib/parcel-steps.ts` | Capture (plug-in or `elephant-cli prepare` on a seed ZIP), transform (+ Seed merge), validate, and the marker writers. |
| `services/ledger.ts`, `services/lib/ledger-state.ts` | `CountyLedger` handlers over pure state transitions. |
| `services/permits.ts`, `services/lib/permit-steps.ts` | `PermitFeed`, `PermitHarvest`, eligible index, ledger mapping. |
| `services/publish.ts`, `services/lib/publish-flow.ts` | `PublishGroup` and its approval gate. |
| `services/lib/reconcile.ts`, `bin/reconcile-county.mjs` | Completion gates, manifest, group assembly. |
| `services/lib/limits.ts` | `countyGate(stage, county, fallback)` in-process semaphores (pattern 2). |
| `services/lib/storage.ts`, `seed.ts`, `cli.ts`, `config.ts`, `county-config.ts` | `DATA_DIR` paths and safe keys, seed scan/range reads, CLI runner and identity, env and per-county resolution. |

The window loop every feeder uses (from `IngestChunk`):

```ts
for (let start = 0; start < rows.length; start += window) {
  const slice = rows.slice(start, start + window);
  const results = await RestatePromise.all(
    slice.map((row) => ctx.serviceClient(parcel).process(parcelPayload(row, req.county, req.jobId))),
  );
  // tally results; ctx.set("done", …) for status()
}
```

`Parcel.process` step order (`parcel-flow.ts`) — per-parcel conditions are recorded and
returned, never thrown (pattern 5):

1. `record({stage: "capture", status: "pending"})`.
2. `capture` under `countyGate("prepare", county, 4)`. `dead` (gone at source) or
   `failed` writes `dead.json`/`failed.json` and records `capture`.
3. `transform` under `countyGate("transform", county, 8)` from the stored capture; skipped
   when capture hash and transform version match. Failure writes `failed.json` and records
   `transform`/`failed`.
4. `validate` (`elephant-cli validate --output-csv validate-findings.csv`); only exit 0
   passes. Exit 1 writes `invalid.json` and records `validate`/`invalid`.
5. `mark-ready` writes `ready.json` (`parcel_id`, `captureHash`, `transformVersion`,
   `transformedHash`, `validatedAt`, `cli {version, commit}`, `dataGroups`) and clears
   stale `dead`/`invalid`/`failed` markers.
6. `record({stage: "ready", status: "ready", artifactHash, transformVersion})`.
7. `eligibility` from the transformed output. No permit dispatch here: `PermitFeed`
   walks eligibility in its own bounded windows.

Elephant CLI exit codes: 0 passed, 1 the input failed, 2 the command could not run. On
exit 2 the message decides: HTTP 404/410 from the source → `dead`; a network-shaped
failure (connection, timeout, DNS, 5xx, schema fetch) → throw and retry; anything else →
`failed` (capture/transform) or `invalid` (validate). The v2 alpha prints no build
commit, so set `ELEPHANT_CLI_COMMIT` to record it in ready markers.

Capture is pluggable per county: `src/counties/<county>/capture.mjs` (or
`CAPTURE_MODULE_<COUNTY>`) exporting `capture(input, ctx)` wins. `input.parcelDir`
exists before the call; `ctx` is `{signal, timeoutMs, parcelDir}`, and `signal` aborts at
`CAPTURE_TIMEOUT_MS[_<COUNTY>]` (default 10 min, below the Parcel inactivity timeout;
the step then throws and retries). The plug-in writes the prepared ZIP to `input.dest`
and returns `{status: "captured"}` or `{status: "dead", reason}`. Otherwise
`elephant-cli prepare` runs on a seed ZIP built from the row (`source_url` column or
`PREPARE_URL_TEMPLATE_<COUNTY>`) with the county flow settings. The source request is
kept whole end to end — method, base URL, `multiValueQueryString`, and `json`/`body`
with `content-type` (`services/lib/source-request.ts`); a query string never stays in
the URL, and the merged Seed group takes the request the capture stored. Transform
uses `TRANSFORM_ZIP_<COUNTY>` or `counties/<county>/transform-v2.zip`, else the scripts
directory; when the county output has no Seed root, the CLI seed-mode output is merged
in (`TRANSFORM_SEED_<COUNTY>=off` disables it), because `hash` needs Seed in every
property.

`PermitFeed` rebuilds its eligible index on every pass under
`data/artifacts/permits/<county>/<jobId>/eligible/<PermitFeed key>/c<N>.json`, stamped
with the eligibility-policy fingerprint; it records and skips a malformed
`eligibility.json` instead of throwing. `PermitHarvest` routes through the county
routing hook (`src/counties/<county>/permit-routing.mjs`, `resolveJurisdiction`) before
city routing, passes `resolvePermitAdapterOptions` (env) to the adapters, and reads linked
bulk snapshots from `PERMIT_BULK_DIR_<COUNTY>` before the live adapter. Permit portal
modules live in `county-permit-adapter`.

Run `npm test` in `skills/use-oracle/runtime` (it typechecks the services first) after
any change. Propose the experimental Elephant CLI 2 for capture, transform, and validate
(skill `migrate-elephant-cli-v2`); `ELEPHANT_CLI` points at the binary.

See the full pattern library in [`reference/pattern-library.md`](./reference/pattern-library.md).
