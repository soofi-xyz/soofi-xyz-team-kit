# Persist real-time metrics and the metrics catalog

Use feature `metrics` for real-time metric cells and the metrics catalog that
defines them. Verify the target revision, account and region before claiming
any behavior below: `PUT /persist/metrics/catalog` arrives with
`prismteam-ai/persist` PR #347, and a deployment without it reads the
catalog only from the Model/Lexicon-published SSM boundary. Follow
[current scope](current-scope.md) and the Persist capability map.

## How cells are built

Every metric is a count or sum held in `metric_cell` vertices in Neptune. The
stack is `PersistRealtimeMetricsStack` (`lib/persist-realtime-metrics-stack.ts`,
code in `lambda/metrics/` and `lambda/metric-*/`).

1. The stream poller reads Neptune Streams and routes each changed payment,
   status event or edge through the catalog's `notice_routing` to a scope (a
   debt). It sends a notice to the DEBT FIFO queue, one message group per debt.
   A change fanning out past `max_fan_out` becomes a backfill request instead.
2. The debt projector recounts the whole debt from current graph state and
   writes only the DAY cells that changed (absolute recompute, diff upsert).
   One lane per debt gives every cell exactly one writer.
3. The GLOBAL projector rolls debt partials into company-wide cells through
   the catalog's rollup eligibility path; a DynamoDB lane lease keeps one
   writer per family and business year.
4. `PersistMetricBackfillWorkflow` never writes cells: it sends `BACKFILL`
   notices for selected scopes into the same DEBT queue, so the projectors
   recount them. It only plans unless the input carries `"confirm": true`.
5. Consumers read only the generation named by
   `metric_projection_state.active_generation_id`, and only definitions in that
   generation's `metric_generation_state.active_definition_ids`. The
   `MetricActivationControl` Lambda owns both: a 15-minute `SYNC`, plus gated
   compare-and-set `ACTIVATE` and `ROLLBACK` that only plan without `confirm`.

Resource names are published under SSM `/persist/realtime-metrics/`
(`activation-control-function-name`, `backfill-state-machine-arn`,
`generation-id`, `queue-health`, ...). Discover them there; do not hardcode them.
The operator runbook is `docs/metrics-realtime-cutover.md` in the Persist repo.

## What the catalog is

The catalog is two documents, compiled together per environment by
`compileMetricsCatalog` (`lambda/metrics/compiler.ts`):

- The **v3 metrics catalog** (`lexicon-metrics-catalog-config/v3`,
  `lambda/metrics/catalogSchema.ts`): `families` (scope, source labels, notice
  routing, identity and exclusion rules, business timezone, grains, GLOBAL
  rollups) and `definitions` (`metric_id@v<version>`, merge operator, base
  reference, and per-environment `activation: { DEV, PROD }` of `BACKFILLING`,
  `ACTIVE` or `RETIRED`). `package.status` `DRAFT` keeps every definition
  `BACKFILLING`, and `ACTIVATE` refuses those.
- The **v2 base package** (`financial-metrics-catalog/v2`): the
  `materialization_plan` of each referenced definition (predicates,
  business-time selector, calculation input, dimensions). v3 pins the base's
  definition-set digest; loading verifies the bytes, size and digest.

Persist code decides executability: an operator, routing kind or family shape
the compiler does not support fails to load. Model (Dialga/Jirachi) owns metric
definitions, their vocabulary and governed releases.

## Where Persist reads it

`MetricsCatalogV3S3Source` resolves the catalog in this order, failing closed on
anything other than a definitively absent source:

1. The API pointer `metrics-catalog/active.json` in Persist's configuration
   bucket (`PERSIST_CONFIGURATION_BUCKET`), naming a content-addressed
   generation `metrics-catalog/generations/<sha256>/` with `catalog.json`,
   `base-catalog.json` and `manifest.json`. Every file is re-hashed on load.
2. Only when no pointer exists: the v3 URI from SSM
   `/lexicon/metrics-catalog-v3-uri`, with the v2 base from
   `PAYMENT_METRIC_APPROVED_RELEASE_URI`, which CDK resolves from
   `/lexicon/financial-metrics-catalog-uri` at deploy time.

`MetricCatalogCache` keeps the compiled catalog for 300 seconds, so an applied
change reaches every projector within about five minutes. `SYNC` then records
the deployed catalog's ACTIVE, BACKFILLING and RETIRED ids.

## Build or change the engine

- Keep catalog acceptance on the shared configuration-source pattern
  (`lambda/services/ConfigurationSource.ts`): pointer first, legacy SSM only for
  a definitively missing pointer, content-addressed objects with
  `If-None-Match: *`, pointer swing with `If-Match` on the ETag read, and a
  `409 ConfigurationLegacySourceActiveError` while the legacy source still
  resolves and no pointer exists. Check that guard before validating.
- Validate a candidate with the real `loadMetricsCatalogV3` for both DEV and
  PROD before writing; a catalog the projectors cannot compile must never
  become active. Derive the approved-release envelope from the stored base
  bytes (`approvedReleaseFor`) so API and Lexicon releases pass the same
  integrity checks.
- A new operator, family shape or routing kind is an engine change in
  `catalogSchema.ts`, `compiler.ts` and the projectors, with TinkerGraph tests.
  A new definition inside a supported family is configuration, not engine work.
- Keep every metric-managed label and property in
  `PaymentMetricProjectionPolicy`, so public GraphSON and CSV ingest cannot
  write cells. Keep rate pacing out of `lambda/metrics/`, whose lint bans
  fractional arithmetic for metric values.
- Never make cells visible by rewriting them: visibility changes only through
  the activation pointer and generation state.

## Configure with Uxie

1. Resolve the request ("add NSF amount by month", "retire this metric",
   "install Model release X's metrics") into a target, the approved Model
   catalog release and the definitions it changes. Route authoring of
   definitions to Jirachi, and unsupported shapes to Dialga (Model) or
   Conkeldurr (Persist compiler). Never author definitions inside Persist.
2. Read the current state first. Take `$PERSIST_API_URL` from the SSM
   parameter the stack publishes as `PersistApiUrlParameter`, and sign with
   the profile selected through the existing AWS access flow:

   ```bash
   awscurl --service execute-api --region "$AWS_REGION" \
     "$PERSIST_API_URL/persist/metrics/catalog"
   ```

   `source: legacy-ssm` means the catalog is still Model/Lexicon-published:
   the API refuses writes with 409 until that SSM parameter is retired. Do not
   delete the parameter yourself; the cutover belongs to the Model owners, and
   removing it before the first API write leaves the projectors without a
   catalog. `?include=document` returns the stored documents for an API
   generation only.
3. Apply an approved release as one body, pinned to the version you read:

   ```bash
   jq -n --slurpfile c catalog.v3.json --slurpfile b base.v2.json \
     '{catalog: $c[0], base: $b[0]}' > body.json
   awscurl --service execute-api --region "$AWS_REGION" -X PUT \
     -H "If-Match: \"$VERSION\"" -d @body.json \
     "$PERSIST_API_URL/persist/metrics/catalog"
   ```

   A 400 `MetricsCatalogApplyValidationError` lists the compile issues per
   environment and writes nothing. A 409 `ConfigurationConflictError` means
   another writer moved the pointer: re-read and retry. An identical body
   returns `changed: false`. The cross-account invoke role cannot call this.
4. Wait five minutes for the catalog cache, then confirm with the activation
   control `STATUS` that the generation is synced to the new definition set
   (`generation.synced`, `inSync`) and which definitions are `BACKFILLING`.
5. For new or changed definitions, backfill before activating: quarter-sized
   `RANGE` windows, newest first, each planned without `confirm` and reviewed
   before the confirmed run, one confirmed run at a time. Follow the runbook's
   pre-run checks (deployed code, empty queues and DLQs, published catalog,
   fresh stream export).
6. `ACTIVATE` only after `STATUS.gates` pass (coverage recorded and complete,
   GLOBAL invariants clean, queues healthy), first as a plan, then with
   `"confirm": true` and the `expectedActiveGenerationId` read from `STATUS`.
   Record the previous generation as the rollback target.
7. Retiring a definition is a catalog change that sets it `RETIRED`; its cells
   drop lazily on the next projection. Change semantics with a new
   `definition_version`, not by editing an `ACTIVE` definition in place.

Work in DEV first and ask before every PUT, confirmed backfill, `ACTIVATE` or
`ROLLBACK`, and any PROD write.

## Verify

- Builder: a valid catalog applies and the projectors log the API source
  (`catalogUriSource: Api`); an invalid one is refused with nothing written;
  a tampered generation file fails closed; the legacy guard returns 409; a
  replay is a no-op; TinkerGraph projector tests still pass.
- Configurer: `GET` version and release id after the PUT, `STATUS` in sync,
  backfill counters and coverage, `ACTIVATE` gates and the resulting pointer,
  and cell read-back for one known debt. Keep request IDs and responses;
  never paste debt identifiers or amounts from PROD.
