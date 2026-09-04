---
name: query-db-loading-matching
description: "Load county artifacts (appraisal, permits, Sunbiz, BBB) from the pipeline data dir into the Postgres query DB and cross-match records by parcel id and normalized address hash. Use when loading transformed data into the query DB, reconciling row counts, linking permits or companies to parcels, or debugging missing query-db data."
metadata: {"author":"elephant-xyz"}
---
# Query DB Loading & Matching

The query DB is the `elephant-query-db` package (sibling repo): Drizzle schema,
lexicon-aligned logical tables, full source data preserved in `source_payload` columns.
Design docs: `../elephant-query-db/docs/{schema-design.md, data-load-and-matching-plan.md,
lexicon-alignment.md, open-lexicon-gaps.md}`. This skill is the LOADING side; publishing
is `county-open-data-publish` / `county-query-table-publish`.

## Connection

- Everything is driven by **`DATABASE_URL`** — default is the local Postgres from
  `skills/use-oracle/runtime/.env`: `postgresql://postgres:elephant@localhost:5432/elephant`.
- The loader scripts are invoked by the `Loader` virtual object and read artifact
  **files** from paths under `DATA_DIR` (`skills/use-oracle/runtime/data/`). If a loader script
  is still S3-only today, it needs a thin filesystem read adapter — one line, don't dwell.
- **Neon (optional):** a hosted Neon DB substitutes by swapping `DATABASE_URL` only — if
  you do, use the **unpooled/direct** endpoint for bulk loads (COPY and the permanent
  stage table need session semantics; the pooled proxy breaks both). Before a big merge
  on Neon, raise compute autoscaling to 2–8 CU (at 1 CU the `ON CONFLICT` merge is
  CPU-bound and becomes the bottleneck) and run the loader near the DB region.

## Loading principles (non-negotiable)

1. **Idempotent merges only** — CSV/batch staging + `ON CONFLICT DO UPDATE` (see
   `elephant-query-db/src/loader/bulk.ts`, `permits.ts`). Any load must be safely
   re-runnable.
2. **Deterministic keys** — **folio (`request_identifier`) for parcels/properties** (the
   true 1:1 key; do NOT key on the digits-only normalized parcel id — see below); permit
   number + source for permits; document number for Sunbiz.
3. **Keep `source_payload`** — never drop unmapped fields; lexicon gaps are logged in
   `open-lexicon-gaps.md`, not discarded.
4. **Reconcile BEFORE loading** — count the loadable set with one cheap sweep
   (`find data/artifacts/appraisal/<county>/<jobId> -name ready.json | wc -l`)
   and compare to the seed row count. Count `ready.json` markers, not `transformed.zip` —
   the marker is written only after validation passes (and removed on dead/invalid), so
   it is fail-closed by construction. A load against an incomplete artifact set produces a
   short DB that looks "done".

## ⚠️ Parcel-id normalization collapses distinct parcels — key on the folio

`normalizeParcelIdentifier` strips **all non-digit characters**. When the `parcels`
conflict key was `(jurisdiction_key, parcel_identifier)`, distinct STRAPs containing
letters silently collapsed: Lee condo units `…0001A/B/C` (different owners) → one row.
Lee impact: 516,841 distinct STRAPs → 485,599 digits-only keys → **~31,242 parcels
silently lost** plus 20,926 orphaned `properties` (parcel_id NULL). Fixed by keying
`parcels` on the **folio (`request_identifier`)** + unique index; child tables already
resolve their parent FK via the folio-based `source_record_key`.

**RULE — validate by folio, never by normalized parcel id** (and never by raw parcel-id
string compare — false mismatches). After a key fix, a **clean re-load is required**: a
plain re-run keeps merging onto the already-collapsed rows.

## ⚠️ Clean re-load: FK-safe clear — NEVER `TRUNCATE … CASCADE` the shared tables

`addresses`, `companies`, `people` are **shared** across all tracks (Sunbiz/BBB FK into
them) and the permit child tables FK into `property_improvements`. A `TRUNCATE CASCADE`
on shared/parent tables once wiped Sunbiz (379,449) + BBB (2,619) + all permit children —
recovered only via point-in-time restore.

**RULE — clear by source, in reverse FK order, batched** (`clear-appraisal-source.ts`):

- `DELETE … WHERE source_system='<county>_appraiser'` per appraisal table, in the
  **reverse** of `APPRAISAL_TABLE_ORDER`, **skipping `addresses`/`companies`/`people`**
  (orphaned shared rows are harmless — every child FK into them is `ON DELETE SET NULL`;
  the idempotent merge re-handles them).
- Deleting `property_improvements` by `source_system` is safe (doesn't touch permit-source
  rows). Never delete it by parcel/property.
- **Batch the deletes** (`ctid LIMIT 50000` in a loop) — the child tables are huge
  (`property_valuations` ~14.8M rows); one statement locks tens of millions of rows.
- **Perf:** `property_improvements` deletes FK-cascade-check the 6 permit child tables;
  without an index on their `property_improvement_id` column that's a scan per delete
  (~50k rows / ~6 min observed). Add those FK-column indexes before a large clear.

## The `Loader` virtual object — single-writer per county

All bulk loads route through the **`Loader` virtual object keyed by county**
(`services/loader.ts` in `skills/use-oracle/runtime`; see `durable-workflow-builder` pattern 8).
Author `services/loader.ts` per `durable-workflow-builder` pattern 8 first — the curl
invocations below target code you have written, not a prebuilt service.

Division of labor: **`Parcel.process` upserts only the per-parcel property row**
(streaming, single-row); **`Loader` owns staging + every multi-row merge** into
parent/child tables from artifacts.

- **The serial constraint is a domain fact:** the appraisal loader interleaves stage+merge
  and writes the shared parents (`addresses`/`companies`/`people`/`parcels`). Running two
  loads for one county **in parallel deadlocks on those parents** (cause of an earlier
  ~30k-parcel loss). The virtual object makes serialization structural: two loads for the
  same county queue behind each other; loads for **different counties run in parallel**.
  No advisory locks, no "is another run active?" checks.
- **Bulk reload** = one **`Loader.load`** invocation running **migrate → clear → load →
  validate** as `ctx.run` steps. The canonical payload is job-scoped — the county comes
  from the object key, and the Loader DERIVES `jurisdictionKey` and the job's artifact
  prefix from the key + `jobId` (payload-supplied values that differ are rejected with
  `TerminalError`):
  `{"jobId":"<jobId>","tracks":["appraisal"],"step":"all","skipClear":<see below>}`.
  `skipClear` distinguishes the two load modes — `true` only for a county's INITIAL
  load; `false` for any EXISTING-county reload (the clear runs as its own journaled
  step). A `step` argument selects a single phase for read-only
  smoke tests (e.g. `{"step":"validate"}`) — use synchronous `/restate/call/` for those
  so the caller gets the validation outcome; keep fire-and-forget `/restate/send/` for
  the real multi-hour bulk reload:

  ```bash
  # read-only smoke test (synchronous — returns the validation result)
  curl localhost:8080/restate/call/Loader/<county>/load \
    --json '{"jobId":"<jobId>","tracks":["appraisal"],"step":"validate"}'

  # INITIAL load of a NEW county (fire-and-forget) — skipClear:true, nothing to clear
  curl localhost:8080/restate/send/Loader/<county>/load \
    --json '{"jobId":"<jobId>","tracks":["appraisal"],"step":"all","skipClear":true}'

  # EXISTING-county reload (fire-and-forget) — skipClear:false, the FK-safe clear
  # runs first as its own journaled step
  curl localhost:8080/restate/send/Loader/<county>/load \
    --json '{"jobId":"<jobId>","tracks":["appraisal"],"step":"all","skipClear":false}'
  ```

  Multi-hour steps are fine — no platform hard cap once the service's inactivity/abort
  timeouts are raised (Restate's defaults abort-and-retry a handler stuck ~11 min inside
  one `ctx.run`; see `durable-workflow-builder` authoring rule 3) — steps are journaled;
  if the services process dies, restart it and the invocation resumes at the interrupted
  step (keep the laptop awake with `caffeinate -i -s`, or accept the pause and resume).
- **County parameterization:** the county slug in the object key is hyphenated
  (`palm-beach`) and the Loader derives the underscore DB form (`palm_beach_appraiser`)
  itself — never hand-build `jurisdictionKey` from the hyphen slug. That derived
  `jurisdictionKey` scopes the clear, the
  loaded rows (`--jurisdiction-key`), and the folio validation
  (`validate-appraisal-folio.ts` counts `parcels WHERE source_system = <key>`). The
  `parcels` conflict key is `(jurisdiction_key, request_identifier)` — a wrong key
  cross-contaminates counties. `tracks` (default `appraisal`) plus optional
  sunbiz/bbb prefixes let one invocation load all tracks. `expectLetterStraps` gates the
  letter-STRAP regression guard — set false for numeric-folio counties or validation
  false-fails on `letter_straps == 0`.
- **Initial load of a NEW county:** `skipClear: true` (nothing to clear; the upsert is
  idempotent — never clear with another county's key). **RE-loading an EXISTING county**
  (e.g. after a key fix): do NOT skip the clear — run it with that county's
  `jurisdictionKey` so stale rows go first; skipping merges on top of stale data.
- **On success** the handler calls **`Publish.requestPublish()`** on the county's
  `Publish` object (`ctx.objectSendClient`) — no flag files, no polling.

## Load paths

- **Permits**: harvesters only write artifacts — after each completed chunk,
  `PermitFeed` submits `Loader.load({jobId, tracks:["permits"], step:"incremental"})`,
  so the `Loader` owns permit merges (single-writer) and its watermark covers both the
  appraisal and permits tracks. Bulk/backfill via the loader scripts (see city-portal
  JSONL below).
- **Appraisal**: from transform artifacts under
  `data/artifacts/appraisal/<county>/<jobId>/`, per `data-load-and-matching-plan.md`.
- **Sunbiz / BBB**: staged JSONL under
  `data/artifacts/enrichment/sunbiz/<quarter>/<county>/` (classes under
  `.../business-registration-v1/classes/`) and `data/artifacts/enrichment/bbb/<jobId>/`
  → loader scripts, `--sunbiz-prefix` / `--bbb-prefix`.

## Paths & listing

- **Always pass the county/jobId-scoped subdir**
  (`data/artifacts/appraisal/<county>/<jobId>/`). NEVER point a load at the shared
  multi-county `data/artifacts/appraisal/` root — it is millions of files across counties
  and the loader refuses it. Never narrow a full-county load with a scope manifest either.
- **One sweep, not per-parcel stats:** `listAppraisalArtifacts` does ONE `find`-style
  sweep over the scoped dir filtered on names ending `ready.json` (the validated-loadable
  marker — `transformed.zip` exists before validation, so enumerating it would load
  invalid/dead parcels; fail-closed means no marker, no load) — the old
  per-parcel stat-in-a-loop ran ~6.6 artifacts/s (~21 h for 501k) vs ~100/s for a single
  sweep (**~80× faster**). Keep it one sweep.
- Property-first 2-level outputs (`row-N/<uuid>/`) load via `load:bulk` (recursive), not
  `load:data`.
- **Geometry caveat:** confirm `geometry_*.json` actually maps into the `geometries`
  table at load — a pilot load once wrote `geometries: 0`, and empty geometries = no maps
  downstream.

## Disk-bounded batch mode

A full county staged into one CSV once hit **106 GB and killed the disk**. Use
`--batch-size N` (default **20000**; `0` = legacy single-CSV): each batch stages → COPY →
merges all tables → drops the stage table → **deletes the CSV**. Peak disk = one batch CSV
(~1–2 GB). A checkpoint file
(`$DATA_DIR/staging/loader/<county>/<jobId>/appraisal-batch-checkpoint-n<N>.json`, named
by batch size) tracks completed batches, so re-running the same command resumes
automatically — merges are idempotent. Batch CSVs stage under the same
`$DATA_DIR/staging/loader/<county>/<jobId>/` dir.

```bash
cd ../elephant-query-db
npm run load:bulk -- --tracks appraisal \
  --appraisal-prefix "appraisal/<county>/<jobId>/" \
  --jurisdiction-key <county>_appraiser \
  --batch-size 20000 --concurrency 32
```

All loader `--*-prefix` values are relative to `data/artifacts/` (the loader joins them
to `DATA_DIR`) — hence `appraisal/<county>/<jobId>/`, not a `data/artifacts/…` path.

Monitor: batch events in the log, at most 1 CSV in the staging dir, `df -h` not falling.

## Robustness (survive connection drops)

- Every `pg.Client` sets `keepAlive: true` (proxied/hosted DBs drop idle connections
  between COPY and the first merge; local Postgres doesn't care but it's free).
- **Permanent stage table** (`public.elephant_bulk_stage_<ts>`), not TEMP — TEMP is
  session-scoped and gone on disconnect.
- **Per-table commits** — each logical table merges in its own `BEGIN/COMMIT` on a fresh
  client; a per-table checkpoint file (under
  `$DATA_DIR/staging/loader/<county>/<jobId>/`) lets a re-run skip committed tables.
- `--stage-table <name>` resumes the merge phase against an already-COPY'd stage table,
  skipping COPY.

## Merge performance (three parts, all required)

1. **Single-column indexes on `source_record_key`** for every parent table (`addresses`,
   `parcels`, `properties`, `property_improvements`, `companies`, `people`, `deeds`) —
   the composite unique indexes have it trailing, so FK-resolution joins can't seek. Use
   `CREATE INDEX CONCURRENTLY` (safe on a live load); see
   `migrations/0004_bulk_merge_perf_indexes.sql`.
2. **Session planner hints** before each merge — `SET work_mem TO '128MB'` (kills disk
   spill) AND `SET random_page_cost TO 1.1` (SSD; the default 4 forces Hash joins even
   with the indexes). Both together flip the plan to index seeks: join CTE 20,874 ms →
   **270 ms**.
3. **VACUUM ANALYZE** parent tables after mass inserts — clears visibility maps so
   index-only scans stop heap-fetching.

### Fast Bulk Loading Optimizations (PostgreSQL / Neon)

When bulk loading millions of property records into PostgreSQL:
- **UNLOGGED Staging Tables**: Use `CREATE UNLOGGED TABLE` for temporary batch staging. This eliminates write-ahead logging (WAL) overhead, accelerating `COPY FROM STDIN` by 3–5x.
- **Post-COPY Index Creation**: Drop indexes on temporary staging tables before massive `COPY` ingestion, and recreate indexes only when the staging batch is complete.
- **CTE Predicate Pushdown**: When merging into domain tables, always filter stage tables inside a CTE by `table_name` before performing joins:
  ```sql
  WITH stage_filtered AS (
    SELECT * FROM public.bulk_stage WHERE table_name = 'property_valuations'
  )
  INSERT INTO property_valuations (...)
  SELECT ... FROM stage_filtered sf
  JOIN properties p ON p.source_record_key = sf.parent_source_record_key
  ON CONFLICT (property_id, tax_year) DO UPDATE ...;
  ```
  Filtering early in the CTE prevents Cartesian join blowups and eliminates memory spills to temporary disk files.

The remaining floor is `ON CONFLICT` unique-index maintenance on the multi-GB tables
(`taxes`, `property_valuations`) — IO-bound, not plan-bound.

## Cross-source matching

1. **Parcel id** — normalize both sides (appraiser vs permit-portal formats differ). The
   primary join.
2. **Normalized address hash** — fallback when parcel ids are absent (Sunbiz, BBB). Only
   write FK links at high confidence; leave low-confidence candidates unlinked for review.
3. **Permit→parcel caution:** link permits from the harvest request's target parcel
   evidence (`propertyFirstTarget`), not the parcel displayed on the permit page — portals
   sometimes display related/different parcels (caused a Lee repair job).

## Reconciliation gotchas (hard-won)

- **`files` + `ownerships` merge LAST in `APPRAISAL_TABLE_ORDER`** — mid-load they read 0.
  Timing, not a gap; recheck after the load completes.
- **Dead tail:** some seed folios are genuinely source-empty and never resolve; the target
  is `seed − dead tail`, not `seed`. ⚠️ **Prove every excluded folio is a clean
  source-empty first** (raw capture shows the empty-search result AND a re-scrape recovers
  ~0) — a transform failure miscounted as dead tail silently drops real properties.
- **LEGACY-IMPORT-ONLY — duplicate outputs from the old pipeline's per-attempt layout.**
  In the local pipeline this cannot happen: each parcel has ONE deterministic
  `transformed.zip`, atomically regenerated in place on redrive — no duplicates exist.
  It applies only when importing historical data produced by the old pipeline, where a
  post-fix redrive left each parcel with both old and new `transformed.zip` and the bulk
  loader read ALL outputs with **last-write-wins by arbitrary listing order**. When
  importing such data: keep the NEWEST `transformed.zip` per parcel, delete the rest.
  Dry-run first and assert: every deleted path is a `transformed.zip` under the county's
  subdir, 0 parcels end up with zero outputs, every kept output is redrive-dated.

## Verification queries

Always reconcile distinct parcels **BY FOLIO** vs the seed count:

```bash
docker compose exec postgres psql -U postgres elephant -c \
  "SELECT count(DISTINCT request_identifier) FROM parcels WHERE jurisdiction_key='<county>_appraiser';"
```

Also: orphan check (`properties WHERE parcel_id IS NULL`), per-county property/permit
counts, recent insert rate (`created_at > now() - interval '10 minutes'`). Compare against
the artifact listing and the seed row count; investigate any gap before declaring a run
complete. Check actual names in `elephant-query-db/src/schema/` — the schema evolves with
the lexicon. Once counts validate by folio, the next step is `county-open-data-publish`.

## City-portal permits — normalized-JSONL bulk load

Counties whose permits come from **city portals** produce normalized snake_case JSONL,
not per-permit detail JSON. Loading them (verified with Santa Clara, 98,592 permits):

1. Stage the JSONL into a job-scoped load dir — the loader sweeps a directory, not
   arbitrary files, and the path must stay inside the `<county>/<jobId>/` namespace:
   `cp <city>-permits-normalized.jsonl data/artifacts/permits/<county>/<jobId>/permits-load/`.
2. `npm run load:bulk -- --tracks permits --permit-format normalized-jsonl
   --permit-prefix permits/<county>/<jobId>/permits-load/ --permit-source-system <county>_permits`.
3. **`--permit-source-system` MUST start with the county's underscore slug**
   (`santa_clara_permits`, not `sanjose_permits`) — the permit-table export filters by
   `source_system LIKE '<county>_%'`; a wrong prefix loads fine but silently vanishes
   from the published table.
4. Verify with the standard queries (permit count by county join + parcel-match rate),
   then call `Publish.requestPublish()` for the county — do NOT re-run a manual export.

## Streamed alternative — incremental load

To load a county **as its ingestion run produces artifacts** instead of one batch at the
end, the trigger is **event-driven**: each completed `IngestChunk` sends a job-scoped
`Loader.load` (`step:"incremental"`, with the job's `jobId` — the artifact prefix is
derived from the object key + `jobId`). The `Loader` keeps a **content-aware watermark**
over the artifact prefix: it tracks merged **(path, artifact-hash) pairs** (hash from
`ready.json`/`transformed.meta.json`), with the hash index on disk under
`$DATA_DIR/staging/loader/<county>/<jobId>/`. The consequence: an in-place transform
redrive (same path, new hash) IS picked up and re-merged; a path-only watermark would
skip corrections. Two more merge rules: **ready-hash gate** — a parcel is loaded only
when the hash in its `ready.json` matches `transformed.meta.json` (`transform()`
removes `ready.json` before regenerating, so a mid-regeneration parcel is simply not
loadable yet); and **tombstone consumption** — the incremental merge also consumes
invalid/dead tombstones and deletes/downgrades the previously loaded rows (without
this, a parcel that went invalid after loading lives on in the DB). The `watermark_<track>` state fields are
`{ prefix, mergedCount, lastMergedAt, hashIndexPath }`. On each send it
merges only NEW artifacts, then requests publish — no timer is involved
(`durable-workflow-builder` pattern 10 covers only the Publish tick). Same loader, same
idempotent merges, same folio key. A manual bulk load
during streaming can't deadlock (same object key ⇒ they queue), but it duplicates work —
let the watermarked incremental sends pick up the new artifacts instead.

**Watermark + publish-gate visibility.** The `Loader` object persists per-track
watermark state (`watermark_<track>`, readable via `restate sql "SELECT * FROM state
WHERE service_name = 'Loader' AND service_key = '<county>'"`); the `Publish` object
persists `approved`, `tickScheduled`, and `lastTickAt`. These state reads are how the
wrap-up gates (watermark covers final artifacts; tick ran after last load) are actually
verified.
