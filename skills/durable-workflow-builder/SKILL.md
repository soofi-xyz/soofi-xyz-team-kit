---
name: durable-workflow-builder
description: "Author durable pipeline workflows for the skills/use-oracle/runtime project with Restate's TypeScript SDK — service topology, code skeletons, and the full pattern library (backpressure feeder, layered concurrency, deterministic keys, idempotent side effects, single-writer ledger, approval gates) distilled from running the previous county pipeline at full scale. Use when building or modifying pipeline workflows, adding a service or handler, choosing between workflow vs service vs virtual object, wiring retries, concurrency caps, or approval gates, or debugging stuck or paused invocations."
metadata: {"author":"elephant-xyz"}
---
# Durable Workflow Builder

All pipeline orchestration lives in `skills/use-oracle/runtime/services/` as TypeScript
Restate services in ONE Node process (`services/app.ts`, port 9080), registered with the
local Restate server from `skills/use-oracle/runtime/local/compose.yaml` (ingress :8080,
admin/UI :9070). Restate is the only run-state store: progress, retries, per-parcel
status, dedupe, and resume. Files under `DATA_DIR` (default
`skills/use-oracle/runtime/data`) hold all data. There is no SQL database: no step writes
rows. The shipped services are the source of truth; the skeletons below show the
patterns to preserve when you change them. See `bootstrap-oracle-infra` for bring-up and
`county-ingest-run` for operating a run.

## Topology

| Name | Kind | Key | Handlers | Role |
|---|---|---|---|---|
| `CountyIngest` | workflow | `<county>-<jobId>` | `run({county, jobId, seedPath, chunkSize=10000, window=25})`, `status()` | Streams the seed, spawns `IngestChunk` children, then `PermitFeed`. Never enqueues the whole county. |
| `IngestChunk` | workflow | `<county>-<jobId>-c<N>` | `run({county, jobId, rows, window})` | Dispatches `Parcel.process` in bounded windows. |
| `Parcel` | service | — | `process({county, jobId, parcel_id, source_identifier?, situs_address?, extra?})` | capture → transform → validate → ready marker → ledger record → eligibility. |
| `CountyLedger` | virtual object | `<county>-<jobId>` | `record({parcel_id, stage, status, reason?, artifactHash?, transformVersion?})`, `get({parcel_id})`, `summary()` (shared), `list({status?, cursor?, limit?})` (shared) | Single writer of per-parcel status: `pending`, `ready`, `dead`, `invalid`, `failed`. Permit link results use `stage: "permits"`. |
| `PermitFeed` | workflow | `<CountyIngest key>-permits` | `run({county, jobId, window})` | Walks eligibility and dispatches `PermitHarvest.harvestParcel` in bounded windows. |
| `PermitHarvest` | service | — | `harvestParcel({county, jobId, parcel_id})` | Routes to the county's vendor adapters (`src/permits/adapters/*`), writes artifacts plus `status/<parcel>.json`, then records to the ledger. |
| `PublishGroup` | workflow | `<county>-<group>-<jobId>` | `run({county, jobId, group, groupDir, atlasPage, state, fips})`, `approve({approvedBy})`, `reject({reason})`, `status()` | validate → hash → validate CAR → export-tables, waits on a durable promise for `approve`, then uploads CAR and tables with readback. Stops before the Atlas PR. |

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
   changed code corrupts journals. Local dev: `restate deployments register --force` and
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
   `PublishGroup` hash and upload), raise `inactivityTimeout`/`abortTimeout` in the
   service definition's options (or per service via the UI/CLI config) AND split the work
   into the smallest journaled steps that make sense.

## Skeleton

`services/app.ts` — one endpoint binds everything:

```ts
import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { countyIngest, ingestChunk } from "./county-ingest";
import { parcel } from "./parcel";
import { countyLedger } from "./county-ledger";
import { permitFeed, permitHarvest } from "./permit-harvest";
import { publishGroup } from "./publish-group";

restate.serve({
  services: [countyIngest, ingestChunk, parcel, countyLedger, permitFeed,
             permitHarvest, publishGroup],
  port: 9080,
});
```

`CountyIngest` streams the seed in chunk-sized slices and hands each slice to an
`IngestChunk` child, so the parent journal grows by about one entry per chunk and each
child journal stays ~10k entries:

```ts
export const countyIngest = restate.workflow({
  name: "CountyIngest",
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: RunReq) => {
      const { county, jobId, seedPath, chunkSize = 10000, window = 25 } = req;
      if (!SLUG.test(county) || !SLUG.test(jobId) ||
          ![chunkSize, window].every((n) => Number.isInteger(n) && n > 0))
        throw new TerminalError("invalid run request"); // invocation-level: never retried
      const base = `${county}-${jobId}`;
      if (ctx.key !== base && !new RegExp(`^${base}-r[1-9][0-9]*$`).test(ctx.key))
        throw new TerminalError("workflow key must be <county>-<jobId>[-rN]");
      // Index once (byte offsets next to the seed); each chunk read SEEKS, never rescans.
      const total = await ctx.run("index-seed", () => buildSeedIndex(seedPath));
      const chunks = Math.ceil(total / chunkSize);
      ctx.set("chunks", chunks);
      for (let c = 0; c < chunks; c++) {
        const rows = await ctx.run(`read-c${c}`, () =>
          readSeedBatch(seedPath, c * chunkSize, chunkSize));
        await ctx.workflowClient(ingestChunk, `${ctx.key}-c${c}`)
          .run({ county, jobId, rows, window });
        ctx.set("chunksDone", c + 1);
      }
      // Appraisal dispatch done. Hand permits to the BOUNDED permit feeder — never one
      // send per parcel from Parcel.process.
      ctx.workflowSendClient(permitFeed, `${ctx.key}-permits`).run({ county, jobId, window });
      return { county, jobId, total, chunks };
    },
    status: async (ctx: restate.WorkflowSharedContext) => ({
      chunks: await ctx.get<number>("chunks"),
      chunksDone: await ctx.get<number>("chunksDone"),
    }),
  },
});

export const ingestChunk = restate.workflow({
  name: "IngestChunk",
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: ChunkReq) => {
      for (let i = 0; i < req.rows.length; i += req.window) {
        await RestatePromise.all(req.rows.slice(i, i + req.window).map((row) =>
          ctx.serviceClient(parcel).process(
            { ...row, county: req.county, jobId: req.jobId }))); // canonical fields LAST
      }
      return {};
    },
  },
});
```

`Parcel.process` — every step a `ctx.run`; per-parcel conditions are recorded and
returned, never thrown (pattern 5). The ledger record is the last write of each branch:

```ts
export const parcel = restate.service({
  name: "Parcel",
  handlers: {
    process: async (ctx: restate.Context, p: ParcelReq) => {
      const dir = dataPath("artifacts", "appraisal", p.county, p.jobId, safeKeyPart(p.parcel_id));
      const ledger = ctx.objectSendClient(countyLedger, `${p.county}-${p.jobId}`);
      const captured = await ctx.run("capture", () => skipIfExists(`${dir}/capture.zip`, () =>
        countyGate("prepare", p.county, 8)(() => capture(p, `${dir}/capture.zip`)))); // false ⇒ gone
      if (!captured) {
        await ctx.run("record-dead", () => markDead(dir, "gone-at-source")); // removes ready.json
        ledger.record({ parcel_id: p.parcel_id, stage: "appraisal", status: "dead",
                        reason: "gone-at-source" });
        return { parcel_id: p.parcel_id, status: "dead" };
      }
      // Transform from the stored capture; skips only when capture hash AND transform
      // version match; removes ready.json before regenerating.
      const t = await ctx.run("transform", () => countyGate("transform", p.county, 16)(() =>
        transform({ county: p.county, src: `${dir}/capture.zip`, dest: `${dir}/transformed.zip` })));
      const v = await ctx.run("validate", () => validate(`${dir}/transformed.zip`)); // exit 0 only
      if (!v.valid) {
        await ctx.run("record-invalid", () => markInvalid(dir, v.errors)); // removes ready.json
        ledger.record({ parcel_id: p.parcel_id, stage: "appraisal", status: "invalid",
                        reason: v.summary, transformVersion: t.transformVersion });
        return { parcel_id: p.parcel_id, status: "invalid" };
      }
      const ready = await ctx.run("mark-ready", () => writeReady(dir, t)); // clears dead/invalid
      ledger.record({ parcel_id: p.parcel_id, stage: "appraisal", status: "ready",
                      artifactHash: ready.transformedHash, transformVersion: ready.transformVersion });
      const eligibility = await ctx.run("eligibility", () =>
        writeEligibility(`${dir}/eligibility.json`, `${dir}/transformed.zip`, p));
      return { parcel_id: p.parcel_id, status: "ready", eligibility };
    },
  },
});
```

Capture is pluggable per county: `src/counties/<county>/capture.mjs` may export
`capture({parcel_id, ...}, ctx)` for a custom browser capture (qPublic and similar);
otherwise `capture()` runs `elephant-cli prepare` with the county's flow/config.

`CountyLedger` stores one small JSON status per parcel (paths and hashes only — never
file contents, pattern 6), keeps per-status counters for `summary()`, and accepts
`record` idempotently: the same `(parcel_id, stage, status, artifactHash)` twice is a
no-op. `PermitFeed` is the permit-side twin of the feeder: it rebuilds an eligible-list
index (`data/artifacts/permits/<county>/<jobId>/eligible.idx`) atomically on EVERY pass,
stamped with the eligibility-policy fingerprint; records and skips a malformed
`eligibility.json` instead of throwing; and dispatches `PermitHarvest.harvestParcel` in
bounded windows. Permit portal modules live in `county-permit-adapter`.

**Lib contracts** — the shipped helpers keep these signatures; `npm test` in
`skills/use-oracle/runtime` must pass after any change:

```ts
// storage
dataPath(...parts: string[]): string   // joins under DATA_DIR; rejects absolute + traversal
buildSeedIndex(seedPath: string): Promise<number>  // writes <seed>.idx; returns row count
readSeedBatch(seedPath: string, offset: number, limit: number): Promise<SeedRow[]> // seeks
safeKeyPart(s: string): string         // fs-safe; collision-safe (short hash suffix)
// SeedRow: parcel_id REQUIRED; source_identifier falls back to parcel_id; extra columns
// flow through untouched; identifiers stay strings (leading zeros and letters kept).

// parcel steps
capture(p, dest: string): Promise<boolean>   // false = gone at source
transform(req): Promise<{ captureHash: string; transformVersion: string }>
validate(path: string): Promise<{ valid: boolean; errors?: unknown; summary?: string }>
writeReady(dir: string, t): Promise<ReadyMarker>
  // ready.json = {parcel_id, captureHash, transformVersion, transformedHash, validatedAt,
  //               cli: {version, commit}}; written only after validate exit 0
markDead(dir: string, reason: string): Promise<void>      // dead.json; removes ready.json
markInvalid(dir: string, errors: unknown): Promise<void>  // invalid.json; removes ready.json
writeEligibility(dest: string, transformedPath: string, p): Promise<{ eligible: boolean }>
  // reads usage type FROM THE TRANSFORMED OUTPUT; persists { eligible, usageType,
  // policyFingerprint }
```

Propose the experimental Elephant CLI 2 for capture, transform, and validate (skill
`migrate-elephant-cli-v2`): one binary with `prepare` and `transform` built in, run with
`--json`; exit 0 passed, 1 the input failed, 2 the command could not run. `ELEPHANT_CLI`
points at the binary.

See the full pattern library in [`reference/pattern-library.md`](./reference/pattern-library.md).
