# Visualize a governed Model release

Jirachi renders an interactive Cursor Canvas of one governed Model release: its
vocabulary graph (vertices, relationships and events) and the metric catalogs
of that release. Use the [canvas template](model-canvas-template.canvas.tsx).
The canvas is a read-only snapshot; it never changes the Model.

## Triggers

Use this workflow when the user asks to "pull up the model", "show the model",
"open the model", "visualize the model", "visualize the metrics", "show the
metric catalog" or asks what a release contains in a form they can explore.
Also offer it after a KPI suggestion or a release read-back when a picture of
the graph would help.

## Read-only steps

This workflow is read-only: it issues only `GET` operations and never submits
change sets, uploads artifacts, records review decisions, publishes or
activates anything.

1. Get the Model API URL, API key and `account_id` from the user as in step 1 of
   the [configurer skill](../SKILL.md); never use AWS credentials or profiles.
   Verify every operation below in `prismteam-ai/model` `contracts/openapi.yaml`
   at the pinned revision. Send the key in the `x-api-key` header on every
   `/model/*` request; a fake-auth review stack also needs `X-Test-Account-Id`
   equal to the path `account_id`. Keep the key in an unexported shell variable;
   never echo it.
2. Pin the release. Unless the user names a release, call `getRelease` with
   `release_id=current` and resolve it to the immutable release ID and release
   digest. Use that immutable release ID for every later read; never render
   `current`.
3. Read the vocabulary with `getReleaseComposition`
   (`GET /model/v1/accounts/{account_id}/vocabularies/{vocabulary_id}/releases/{release_id}/composition`).
   Check that the returned `releaseId` and `releaseDigest` match step 2 and keep
   its `sourceDigest`.
4. Read the effective metric catalogs with `listReleaseMetricCatalogs`
   (`.../releases/{release_id}/metric-catalogs`). The effective catalog set of a
   release is its own catalogs plus catalogs inherited from the pinned base
   release; keep every item and its `origin`. Use `getReleaseMetricCatalog`
   (`.../metric-catalogs/{catalog_id}`) when the user asks for one catalog.
5. Verify catalog digests. Every item must carry a `digest`. The digest covers
   the raw artifact bytes, not the parsed `document`. Compare the listed digest
   with the composition `manifest.metricCatalogs[].digest`. When raw bytes are
   available (for example the same file at the pinned repository revision), hash
   those exact bytes with SHA-256. Never hash re-serialized JSON. If no raw bytes are
   available, report "digest present, bytes not verified". Stop and report
   a digest mismatch, a `404` or a `502` instead of rendering partial content.
6. For an extension release, resolve imported endpoints: each
   `manifest.imports[]` entry pins an `alias`, `vocabularyId`, `releaseId` and
   `releaseDigest`. Read that pinned release's composition to fill imported
   vertex properties, or render the imported vertex with only its ID.
7. Fill a copy of the template (mapping below), write it and link it to the user.

## Mapping API JSON to template constants

Replace only the block between `DATA START` and `DATA END`. Keep the types,
helpers and components unchanged.

- `RELEASE`: `title` (descriptive, for example "Shared base model and metrics"),
  `vocabularyId`, `packageKind` and `namespace` from `document.manifest`,
  immutable `releaseId`, `releaseDigest`, `sourceDigest`, `source`
  (`governed-release`, or `repository-checkout` for the fallback below),
  `sourceDetail` naming the operations read (no host secrets or keys) and the
  `readAt` date.
- `VERTICES`: one entry per `document.definitions[]` item whose `body.kind` is
  `vertex`: `id` = `definitionId`, `name` = `body.name`, and `props` from
  `body.properties` (`type` = the property `format` or `type`; `required` when
  listed in `body.required` or flagged `required: true`; `enumValues` = `enum`).
  Add each imported endpoint as a vertex with `imported: true`.
- `EDGES`: one entry per `relationship` definition with `from`/`to` set to the
  endpoint `definitionId` (for `scope: import` use the imported vertex ID) and
  `props` mapped as for vertices. A relationship whose `from` equals its `to` is
  an event: the template lists it on the vertex instead of drawing an arrow, so
  add no separate events constant.
- `stateMachine` and `derivedIndex` definitions are not drawn; mention them in
  the chat reply when present.
- `CATALOGS`: one entry per metric-catalog item with `catalogId`, `origin`
  (`local` or `inherited`), `sourcePackageNamespace`, `contractVersion`,
  `digest`, and `metrics`/`ratios` from `document`.
- Each `metrics[]` entry: `id` = `metric_id`, `name` = `business_name`, `root`,
  `family` = `family_id`, `edges` = `triggering_edges` plus every
  `path_hops[].edge_type`, `measure` = "`calculation` `measure`", `unique` =
  `unique_item`, `dimensions`, `businessTime` = `business_time_property`,
  `timezone` = `business_timezone`, `scopes`, `grains`, `cohort` =
  `business_time_election.candidate_filter.values` when present, `rule` =
  `contribution_rule`.
- `conditions`: render each `qualifying_conditions[]` item as
  `<owner.property> = <value>` for `eq`, `<edge_type> exists` for `exists` and
  `<owner.property> <operator> <value>` otherwise. Keep the `owner.property`
  token first; the template uses it to highlight the properties a metric reads.
- Each `ratios[]` entry: `id` = `ratio_id`, `question` = `business_question`,
  `numerator` = `numerator_metric_id`, `denominator` = `denominator_metric_id`.

Copy values verbatim from the release; never invent vertices, edges,
properties, enum values or metrics. Leave a constant empty rather than filling
it with placeholders: the template omits sections without data (no catalogs
means no metric, catalog or rate sections; no self-relationships means no
events) and truncates long enums with "+N more". If the composition has no
vertex definitions, do not write a canvas; report what is missing.

## Write and share the canvas

- Write a single `.canvas.tsx` file into the current workspace's Cursor
  `canvases/` directory, named `model-<vocabulary>-<release-short>.canvas.tsx`
  (for example `model-shared-base-rel-1c50af89.canvas.tsx`). Follow the Cursor
  canvas skill's file rules and confirm its TypeScript check reports no errors.
- Embed all data inline. The template imports only from `cursor/canvas` and
  must never call `fetch(` or any network API.
- Never embed secrets: no API keys, bearer tokens, account credentials,
  signed URLs or internal storage coordinates in the canvas, its file name or
  the chat reply.
- Link the canvas to the user with its absolute path and summarize the pinned
  release ID/digest, catalog IDs with origins and digests, and any verification
  failures.
- The canvas is a release snapshot, not a live view. Regenerate it on request,
  or when a newer release becomes current, by repeating the steps above.

## Fallback without a deployment

Only when the provided URL's `/health` fails, and the user explicitly agrees
after being told the result will not be a governed release, read a
`prismteam-ai/model` checkout pinned to `origin/main` (state its commit and asset
version): `assets/shared-base/<version>/composition.json`, its
`metric-catalogs.json`, and `configurations/<package>/` catalogs. Set
`RELEASE.source` to `repository-checkout`, put the repository revision in
`sourceDetail`, and tell the user the canvas shows repository source, not a
governed release. Treat 401/403/404 as a configuration error to report, not as
an unreachable deployment. Never use the legacy `Spring-Oaks-Capital-LLC/lexicon`
repository as a source.
