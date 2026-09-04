---
name: durable-workflow-builder
description: "Author durable pipeline workflows for the skills/use-oracle/runtime project with Restate's TypeScript SDK — service topology, code skeletons, and the full pattern library (backpressure feeder, layered concurrency, deterministic keys, idempotent side effects, single-writer objects, approval gates) distilled from running the previous county pipeline at full scale. Use when building or modifying pipeline workflows, adding a service or handler, choosing between workflow vs service vs virtual object, wiring retries, concurrency caps, or approval gates, or debugging stuck or paused invocations."
metadata: {"author":"elephant-xyz"}
---
# Durable Workflow Builder

All pipeline orchestration lives in `skills/use-oracle/runtime/services/` as TypeScript Restate
services in ONE Node process (`app.ts`, port 9080), registered with the local Restate
server from `docker-compose.yml` (ingress :8080, admin/UI :9070) — the stack is Restate
+ Postgres only. Files go to the filesystem under `skills/use-oracle/runtime/data/` (env
`DATA_DIR`), rows to Postgres via `DATABASE_URL`. See
`bootstrap-oracle-infra` for scaffolding; `county-ingest-run` for operating a run.

## Core model

Three service kinds — pick by state and keying:

- **Service** — stateless handlers, N concurrent invocations. Use for per-item work:
  `Parcel.process`, `PermitHarvest.harvestParcel`.
- **Virtual Object** — keyed, single-threaded per key, durable K/V state (`ctx.set/get`).
  Use where exactly-one-writer matters: `Loader` (key `<county>`, serial DB merges),
  `Publish` (key `<county>`, export→approve→IPNS loop).
- **Workflow** — a keyed `run` handler that executes exactly once per key. Use for jobs:
  `CountyIngest` (key `<county>-<jobId>`) and its `IngestChunk` children
  (key `<county>-<jobId>-c<N>`), `PermitFeed` (key = `<CountyIngest key>-permits`, so a
  redrive pass feeds `…-r2-permits`) and its `PermitFeedChunk` children
  (key `<PermitFeed key>-c<N>`), `SunbizIngest`/`BbbHarvest` (key `<jobId>`).

**Durable execution in two sentences:** every `ctx.*` action is journaled; on crash,
restart, or redeploy the invocation replays the journal and resumes exactly where it
stopped. State, timers, and calls survive process death — no checkpoint files, no
re-streaming, no watchdogs.

**Three authoring rules that make durability hold:**

1. Every side effect (fetch, upload, DB write, CLI exec) goes inside `ctx.run` AND must
   be idempotent — an interrupted step re-executes from its start, so file writes use
   deterministic paths and DB writes use `ON CONFLICT DO UPDATE`.
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
   multi-minute steps (`Loader` bulk loads, `Publish` export/upload, enrichment scans,
   `PermitHarvest` detail-heavy parcels and `Parcel` heavy captures — or split those
   into journaled search/list/detail steps),
   raise `inactivityTimeout`/`abortTimeout` in the service definition's options (or per
   service via the UI/CLI config) AND split the work into the smallest journaled steps
   that make sense. "No time limits" is true of the architecture only after this is set.

## Skeleton

`services/app.ts` — one endpoint binds everything:

```ts
import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { countyIngest, ingestChunk } from "./county-ingest";
import { parcel } from "./parcel";
import { permitHarvest, permitFeed, permitFeedChunk } from "./permit-harvest";
import { loader } from "./loader";
import { publish } from "./publish";
import { sunbizIngest, bbbHarvest } from "./enrichment"; // stubs until authored

restate.serve({
  services: [countyIngest, ingestChunk, parcel, permitHarvest, permitFeed,
             permitFeedChunk, loader, publish, sunbizIngest, bbbHarvest],
  port: 9080,
});
```

`services/county-ingest.ts` — the feeder, split in two so no journal grows unbounded:
the parent `CountyIngest` workflow spawns one `IngestChunk` child workflow per ~10k-row
slice (parent journal ≈ one entry per chunk), and each chunk dispatches `Parcel.process`
in bounded windows (the next window is admitted when the previous one completes; a chunk
journal stays ~10k entries and replays in seconds). Keys: parent `<county>-<jobId>`,
chunks `<county>-<jobId>-c<N>`; `county` and `jobId` also arrive as payload fields so
artifact paths stay `<county>/<jobId>`-scoped:

```ts
import * as restate from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";
import { parcel } from "./parcel";
import { loader } from "./loader";
import { permitFeed } from "./permit-harvest";
import { buildSeedIndex, readSeedBatch } from "./lib/storage"; // fs helpers over DATA_DIR
                                          // (dataPath rejects absolute paths + traversal)

type RunReq = { county: string; jobId: string;
                seedPath: string; // DATA_DIR-relative, e.g. "seeds/lee.csv"
                chunkSize: number; batchSize: number; window: number };

export const countyIngest = restate.workflow({
  name: "CountyIngest",
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: RunReq) => {
      // key "<county>-<jobId>" (or "…-r2" for a redrive pass) makes the run exactly-once
      const slug = /^[a-z0-9-]+$/;
      if (!slug.test(req.county) || !slug.test(req.jobId) ||
          ![req.chunkSize, req.batchSize, req.window].every((n) => Number.isInteger(n) && n > 0))
        throw new TerminalError("invalid run request"); // invocation-level: never retried
      const base = `${req.county}-${req.jobId}`;
      if (ctx.key !== base && !new RegExp(`^${base}-r[1-9][0-9]*$`).test(ctx.key))
        throw new TerminalError("workflow key must be <county>-<jobId>[-rN]");
      // Index once: writes a byte-offset index next to the seed and returns the row
      // count. readSeedBatch then SEEKS via the index — O(1) per batch, no rescans (the
      // old pipeline re-streamed a 282 MiB seed from row 1 on every wakeup).
      const total = await ctx.run("index-seed", () => buildSeedIndex(req.seedPath));
      const chunks = Math.ceil(total / req.chunkSize); // chunkSize ~10-20k rows
      ctx.set("chunks", chunks); // total, for monitoring's chunksDone ÷ chunks
      for (let c = 0; c < chunks; c++) {
        // Child keys derive from the PARENT key: a redrive parent (-r2) spawns fresh
        // children instead of hitting the original run's already-completed chunk keys.
        await ctx.workflowClient(ingestChunk, `${ctx.key}-c${c}`)
          .run({ ...req, offset: c * req.chunkSize });
        ctx.set("chunksDone", c + 1); // progress, visible in UI / restate sql
      }
      // Appraisal dispatch done. Hand permits to the BOUNDED permit feeder — never one
      // send per parcel from Parcel.process: that would queue every eligible parcel at
      // once, recreating the whole-county dump this design exists to prevent.
      ctx.workflowSendClient(permitFeed, `${ctx.key}-permits`)
        .run({ county: req.county, jobId: req.jobId });
      return { county: req.county, jobId: req.jobId, total, chunks };
    },
  },
});

export const ingestChunk = restate.workflow({
  name: "IngestChunk",
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: RunReq & { offset: number }) => {
      for (let done = 0; done < req.chunkSize; ) {
        const rows = await ctx.run("read-batch", () => readSeedBatch(
          req.seedPath, req.offset + done, Math.min(req.batchSize, req.chunkSize - done)));
        if (rows.length === 0) break; // seed exhausted
        for (let i = 0; i < rows.length; i += req.window) {
          const slice = rows.slice(i, i + req.window);
          await RestatePromise.all(slice.map((row) =>
            ctx.serviceClient(parcel).process(
              { ...row, county: req.county, jobId: req.jobId }))); // row carries parcel_id;
              // canonical fields spread LAST so a CSV column cannot override them
        }
        done += rows.length;
      }
      // Hand this chunk's artifacts to the county Loader — the single-writer incremental
      // merge; this send is what advances the Loader watermark (no timer needed).
      // Loader derives artifactPrefix + jurisdictionKey from ITS OBJECT KEY + jobId —
      // a payload cannot point a lee-keyed Loader at another county's data (pattern 8).
      ctx.objectSendClient(loader, req.county).load({
        jobId: req.jobId, tracks: ["appraisal"], step: "incremental",
      });
      return {};
    },
  },
});
```

`services/parcel.ts` — per-parcel unit of work, every step a `ctx.run`. The canonical
payload field is `parcel_id` (from the seed CSV); the `<folio>` path segment is its
sanitized form, `safeKeyPart(parcel_id)`:

```ts
import * as restate from "@restatedev/restate-sdk";
// lib/storage: dataPath(...parts), exists(path); writes go tmp-file → rename, so an
// interrupted ctx.run never leaves a half-written artifact.
import { dataPath, exists, removeIfExists, safeKeyPart } from "./lib/storage";
import { capture, transform, validate, upsertParcelRow, writeEligibility,
         writeDead, writeInvalid, writeReady, type SeedRow } from "./lib/parcel-steps";
import { countyGate } from "./lib/limits";

export const parcel = restate.service({
  name: "Parcel",
  handlers: {
    process: async (ctx: restate.Context, p: SeedRow & { county: string; jobId: string }) => {
      const dir = dataPath("artifacts", "appraisal", p.county, p.jobId, safeKeyPart(p.parcel_id));
      // 1. Raw capture (elephant-cli prepare / browser flow). Deterministic path,
      //    skip-existing → re-runs never re-scrape. A gone parcel records dead.json below.
      const captured = await ctx.run("capture", async () => {
        if (await exists(`${dir}/capture.zip`)) return true;
        return countyGate("prepare", p.county, 8)(() =>
          capture(p, `${dir}/capture.zip`)); // false ⇒ gone
      });
      if (!captured) {
        // DEAD: record + return. Never THROW for a per-parcel condition — it would
        // propagate through the chunk's RestatePromise.all and fail the whole run.
        await ctx.run("record-dead", async () => {
          await removeIfExists(`${dir}/ready.json`); // no longer loadable
          await writeDead(`${dir}/dead.json`, "gone-at-source");
        });
        return { parcel_id: p.parcel_id, status: "dead" };
      }
      // 2. Transform v2 from the stored raw capture — never from a live page. transform()
      //    writes transformed.meta.json (capture hash + transform version) and skips only
      //    when BOTH match — so a fixed transform regenerates stale output on re-runs.
      await ctx.run("transform", () => countyGate("transform", p.county, 16)(() =>
        transform({ county: p.county, src: `${dir}/capture.zip`,
                    dest: `${dir}/transformed.zip` })));
      // 3. Validate, fail closed: invalid parcels are recorded and EXCLUDED, never loaded.
      const v = await ctx.run("validate", () => validate(`${dir}/transformed.zip`));
      if (!v.valid) {
        await ctx.run("record-invalid", async () => {
          await removeIfExists(`${dir}/ready.json`); // fail-closed: not loadable
          await writeInvalid(`${dir}/invalid.json`, v.errors);
        });
        return { parcel_id: p.parcel_id, status: "invalid", errors: v.errors };
      }
      // Status artifacts reflect CURRENT state: a pass clears BOTH stale markers
      // (a parcel once dead or invalid that now validates is neither).
      await ctx.run("clear-stale-markers", async () => {
        await removeIfExists(`${dir}/invalid.json`);
        await removeIfExists(`${dir}/dead.json`);
      });
      // 4. Idempotent DB upsert + eligibility artifact. writeEligibility stamps the
      //    resolved policy fingerprint and recomputes when the policy changed (e.g.
      //    __NONE__ → __ALL__) — a same-job redrive must not trust stale eligibility.
      await ctx.run("upsert", () => upsertParcelRow(p, dir)); // ON CONFLICT DO UPDATE
      const eligibility = await ctx.run("eligibility", () =>
        writeEligibility(`${dir}/eligibility.json`, `${dir}/transformed.zip`, p));
      // Loadable = ready.json present. Written ONLY here; removed on dead/invalid — the
      // loader and pre-load validation enumerate ready markers, never raw transformed.zip.
      await ctx.run("mark-ready", () => writeReady(`${dir}/ready.json`));
      // NOTE: no permit send here. Permits are dispatched by the bounded PermitFeed
      // feeder after appraisal dispatch — one send per parcel from here would queue the
      // whole eligible county at once (see CountyIngest and pattern 1).
      return { parcel_id: p.parcel_id, status: "ok", eligibility };
    },
  },
});
```

Virtual objects follow the same shape with `restate.object({ name, handlers })` and a
`restate.ObjectContext`. Patterns 8–10 below define the `Loader` and `Publish`
*contracts* — behavioral specs you author the same way, not code that already exists.
Permit portal modules themselves live in `county-permit-adapter`; `PermitHarvest` just
routes to them. `PermitFeed` is the permit-side twin of the appraisal feeder — author it
from the `CountyIngest`/`IngestChunk` skeleton above with this contract. Keys derive
from the parent: `PermitFeed` = `<CountyIngest key>-permits` (a redrive pass feeds
`…-r2-permits`, never colliding with the first pass); children = `<PermitFeed key>-c<N>`.
Request: `{county, jobId, chunkSize?, batchSize?, window?}` (defaults 10000/100/25;
chunk children add `offset`). It scans eligibility artifacts (`eligible: true`) into an
eligible-list index (`data/artifacts/permits/<county>/<jobId>/eligible.idx`) — rebuilt
atomically on EVERY pass and stamped with the eligibility-policy fingerprint, so a
policy change never reuses a stale index; a malformed `eligibility.json` is recorded
and skipped, never thrown — one bad manifest must not poison the feeder. Track
`chunks`/`chunksDone` state exactly like `CountyIngest`; each chunk dispatches
`PermitHarvest.harvestParcel` in bounded windows and, on completion (per chunk, not per
window), submits `Loader.load({ jobId, tracks: ["permits"], step: "incremental" })`.

**Lib contracts** — author these signatures before the first run (the skeletons above
import them; `npm run typecheck` must pass):

```ts
// lib/storage.ts
dataPath(...parts: string[]): string   // joins under DATA_DIR; rejects absolute + traversal
exists(path: string): Promise<boolean>
removeIfExists(path: string): Promise<void>
buildSeedIndex(seedPath: string): Promise<number>  // writes <seed>.idx (byte offsets); returns row count
readSeedBatch(seedPath: string, offset: number, limit: number): Promise<SeedRow[]> // seeks via index
safeKeyPart(s: string): string         // fs-safe; collision-safe (suffix a short hash when chars drop)

// lib/parcel-steps.ts — canonical seed header: parcel_id REQUIRED; source_identifier
// falls back to parcel_id when absent; extra columns flow through untouched.
// buildSeedIndex validates the header. SeedRow =
//   { parcel_id: string; source_identifier?: string; situs_address?: string;
//     [column: string]: string | undefined }
capture(p, dest: string): Promise<boolean>   // elephant-cli prepare / browser flow; false = gone
transform(req: { county: string; src: string; dest: string }): Promise<void>
  // resolves the county's v2 handler package transforms/<county>/transform-v2.zip (root
  // handler.js — built per transform-v2-builder from Counties-trasform-scripts sources);
  // writes transformed.meta.json (capture hash + package hash/version); skips iff BOTH match.
  // REMOVES ready.json before regenerating — a replacement is never loadable until revalidated
validate(path: string): Promise<{ valid: boolean; errors?: unknown }>  // elephant-cli validate
upsertParcelRow(p, dir: string): Promise<void>       // single-row ON CONFLICT DO UPDATE
writeEligibility(dest: string, transformedPath: string, p): Promise<{ eligible: boolean }>
  // reads usage type FROM THE TRANSFORMED OUTPUT (policy needs transformed data, not the
  // seed row); persists { eligible, usageType, policyFingerprint }; county env suffix via envPart
writeDead(dest: string, reason: string): Promise<void>
writeInvalid(dest: string, errors: unknown): Promise<void>
writeReady(dest: string): Promise<void>
  // loadability marker; records the validated transform hash — Loader loads a parcel only
  // when the ready hash matches transformed.meta.json (a regenerated zip is not loadable)
```

See the full pattern library in [`reference/pattern-library.md`](./reference/pattern-library.md).
