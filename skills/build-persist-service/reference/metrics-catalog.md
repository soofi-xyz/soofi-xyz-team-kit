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

1. The stream poller reads Neptune Streams and routes each changed item, status
   event or edge through the catalog's `notice_routing` to its scopes (a debt,
   a meeting or a person). It sends a notice to the scope FIFO queue
   (`METRIC_SCOPE_QUEUE_URL`), one message group per scope lane from the
   family's `lane_key_template` (`DEBT#…`, `MEETING#…`, `PERSON#…`). A change
   fanning out past `max_fan_out` becomes a backfill request instead.
2. The scope projector (the `metric-debt-projector` Lambda, which serves every
   scope despite its name) recounts the whole scope from current graph state
   and writes only the DAY cells that changed (absolute recompute, diff
   upsert). One lane per scope gives every cell exactly one writer.
3. The GLOBAL projector rolls scope partials into company-wide cells through
   the catalog's rollup eligibility path; a DynamoDB lane lease keeps one
   writer per family and business year.
4. `PersistMetricBackfillWorkflow` never writes cells: it sends `BACKFILL`
   notices for selected scopes into the same scope queue, so the projectors
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

## Scopes and family shapes

A family projects items into one scope. Families of one scope must agree on its
vertex, identifier, `lane_key_template` and `scope_edge`. The table lists the
families in Model's `v3.3.0` export; Persist's own test fixture
(`test/fixtures/metrics-catalog-v3/conversation-memory.put-body.json`) has only
five of them (no `meeting_action` and no `*_invited` families).

| Scope | Families today | Items | Shape |
| --- | --- | --- | --- |
| `DEBT` | `payment` and its status families | payments on one debt | `EXCLUDE_ALL`, `scope_link`, status events and election, GLOBAL rollup |
| `MEETING` | `meeting` (self scope, `path_from_scope: []`), `meeting_media`, `meeting_utterance` (meeting → media → utterance), `meeting_action` | the meeting, its media, utterances and actions | `EXCLUDE_ALL`, no scope link or status events, business time `meeting.started_at` |
| `MEETING` | `meeting_person`, `meeting_person_invited` | people who attended or were invited | `ALLOW_SHARED` (one person sits in many meetings), `NON_MERGEABLE`, no rollup |
| `PERSON` | `person_meeting`, `person_meeting_invited` | meetings a person attended or was invited to | `ALLOW_SHARED`, `NON_MERGEABLE`, no rollup |

What compiles today, in `compiler.ts`:

- Selectors read only the item (`ItemProperty`), the scope vertex
  (`ScopeProperty`), the status-event edge (`EventProperty`,
  `ElectedEventProperty`) or a constant. Business time must be one of these.
- Predicates are `PRESENT` and `EQ` on those selectors. There is no predicate
  on a vertex in the middle of the path, and no edge-absence predicate.
- An item is linked to its scope by one `path_from_scope` chain. There is no
  second, parallel edge requirement and no alternative (OR) edge.
- Stream routing resolves only the scope and item labels;
  `prismteam-ai/persist#377` adds the vertices between them.
- Dimensions need a pinning `EQ` predicate; an unpinned group-by fails.

Model's exporter (`prismteam-ai/model` `src/domain/persist-metrics-export.ts`)
applies its own, stricter rules before Persist sees a definition: at most two
path hops, conditions only on the item or scope, and business time only on the
item or scope. It excludes what fails and lists the reasons in the release's
`*.report.json`; documented waivers (`DROP_PREDICATE`, `DROP_DIMENSION`) are
in `configurations/<catalog>/persist-export.json`. Read both before deciding
whether a gap is Model's or Persist's.

## Meeting-report engine capabilities

Six `conversation-memory-metrics` definitions (Model `v3.3.0`) need four engine
capabilities. Build each as a generic, opt-in compiler and projector feature
that leaves debt and payment plans byte-for-byte identical. The definition
shapes below are proposals: agree the exact field names with Dialga, because
Model's exporter must emit them.

Every capability touches the same modules, in this order:

1. `lambda/metrics/catalogSchema.ts`: the new optional family or base field.
2. `lambda/metrics/compiler.ts`: compile it into the `ReadPlan` and selectors,
   and refuse everything else with a named issue.
3. `MetricScopeSnapshotReader.ts`: read the extra vertices or edges in the same
   per-scope traversal. `MetricScopeProjector.ts`: count from that snapshot.
4. `streamRouting.ts` and `MetricStreamScopeResolver.ts`: route every new
   trigger label back to its scopes, within the family's fan-out limit.
5. `MetricBackfillPlanner.ts`, `backfill.ts` and
   `lambda/metric-backfill/athenaPlan.ts`: plan date windows and drain
   overflow requests for the new labels. `identity.ts` when items are elected
   or excluded differently. `businessTime.ts` only for new time parsing.
6. `lambda/metric-stream-poller/` and `lib/persist-realtime-metrics-stack.ts`
   only if a new label needs stream filters, permissions or sizing.
7. `docs/metrics-realtime-cutover.md`: the new shapes and their backfill.

### 1. Business time from a vertex off the scope path

- **Metrics:** `person.utterance.spoken.count` (PERSON scope, item `utterance`
  through `person_spoke_utterance`) and `person.action.assigned.count` (PERSON
  scope, item `action` through `person_assigned_action`). Both take business
  time from `meeting.started_at`, which is neither the item nor the scope.
- **Shape:** a family-level time anchor, a path from the item to exactly one
  vertex holding the business time, for example
  `time.business_time_anchor: { path: [media_has_utterance, meeting_has_media], vertex: meeting }`,
  and a base business-time selector on that vertex. Compile it to a new
  selector tag (for example `AnchorProperty`). An item with zero or several
  anchors is excluded with a reason, never dated arbitrarily.
- **Families:** two new PERSON families, for example `person_utterance` over
  `[person_spoke_utterance]` and `person_action` over `[person_assigned_action]`,
  plus `ExclusionReason` values for an item with no anchor or several.
- **Routing:** a change to an anchor-path edge or the anchor vertex must walk
  anchor → item → scope. The compiler accepts a `REVERSE_PATH` only when it
  equals `path_from_scope`, so this is a new route kind (for example
  `ANCHOR_PATH`), which Model's exporter must also emit. A meeting's
  `started_at` never changes in place (identity is a content hash), so edge
  adds and removals carry most changes.
- **Backfill:** the planner dates windows from the anchor's time, not the
  item's, including the Athena planner (`lambda/metric-backfill/athenaPlan.ts`),
  which today prunes stream-export partitions by an item or scope property.
- **Cost:** a PERSON lane recounts every meeting that person was in. Set
  `max_items` from the largest real person and check the recount time.

### 2. Three-hop paths

- **Metric:** `meeting.speaker.person.count` (MEETING scope, item `person`
  through meeting → media → utterance ← person, `ALLOW_SHARED`, one count per
  meeting and person however many utterances).
- **Shape:** an ordinary `path_from_scope` of three hops; business time is the
  scope's `meeting.started_at`. No new schema field.
- **Routing:** `prismteam-ai/persist#377` routes changes on the in-between
  media and utterance vertices and edges, and adds
  `conversationMemorySpeakers.test.ts`. `prismteam-ai/model#47` lifts the
  exporter's two-hop limit. Build on both rather than repeating them.

### 3. Two edges to the same vertex

- **Metrics:** `person.meeting.invited_attended.count` (PERSON scope, item
  `meeting`) and `meeting.invited_attendee.person.count` (MEETING scope, item
  `person`). Count a pair only when both `person_invited_to_meeting` and
  `person_attended_meeting` join the same person and meeting.
- **Shape:** keep one edge as `path_from_scope` and require the other in
  parallel, for example
  `scope.parallel_edges: [{ edge_type: person_invited_to_meeting, from: person, to: meeting }]`.
  The reader keeps an item only when every parallel edge joins it to the same
  scope vertex.
- **Families:** two new `ALLOW_SHARED` families, one per scope. List the
  parallel edge in `source.edge_labels`, or routing ignores it.
- **Routing:** both edge labels are `EDGE_ENDPOINT` triggers (`FROM` for the
  PERSON family, `TO` for MEETING); adding or removing either edge recounts
  the scope.

### 4. Person-or-Email unions

- **Metric:** `action.assigned.count`, a GLOBAL count of actions with at least
  one `person_assigned_action` or `email_assigned_action`, once per action.
- **Shape:** Persist reaches GLOBAL only through a rollup, so project it as a
  MEETING-scoped family over `meeting_has_action` with an any-of edge-exists
  predicate, for example
  `{ selector: { kind: "EDGE_EXISTS", any_of: ["person_assigned_action", "email_assigned_action"] }, operator: "PRESENT" }`,
  and roll it up to GLOBAL. An action with both edges, or several assignees,
  still counts once. An action with more than one owning meeting fails closed.
- **Routing:** both assignment edges are in `source.edge_labels` and trigger a
  `REVERSE_PATH` from the action (`start: TO`) over `meeting_has_action`.
  Keep the family `EXCLUDE_ALL`: `ALLOW_SHARED` families cannot roll up.
- `person.action.assigned.count` counts Person edges only: Email-only
  assignment never implies a Person.

### Decisions to record before building

- `media.media_type eq TRANSCRIPT` and `media_supersedes_media not_exists` on
  both utterance metrics: waive them, as `utterance.recorded.count` already
  does (Google Meet writes only TRANSCRIPT media and no supersedes edges), or
  build intermediate-vertex and edge-absence predicates.
- `person.action.assigned.count` groups by unpinned `action.action_type`: waive
  it with `DROP_DIMENSION`, as `action.recorded.count` does, or build it.
- `person.meeting.talk.count` needs a compound `PERSON_MEETING` scope (one lane
  per person and meeting). It is optional and outside these six metrics.

- The field and route-kind names (`business_time_anchor`, `ANCHOR_PATH`,
  `parallel_edges`, `EDGE_EXISTS`, the new exclusion reasons), agreed with
  Dialga so Model's exporter emits them.
- Open metrics PRs: rebase on `prismteam-ai/persist#377` (three-hop routing)
  and #358 (it also changes the schema, compiler and reader). #353 conflicts
  and was largely superseded by merged #356; #357 is voice-mail and debt work
  that conflicts. Their owners decide whether to close or rebase them.

Put waivers in Model's `persist-export.json`, never in Persist.

Build one capability at a time, in this order: three-hop paths, two edges,
unions, then the off-path anchor (the largest). Hold a review checkpoint after
each. Whether they merge separately or together, every merge is one commit that
ships both ways.

## Test the capabilities

Use TinkerGraph, extending `test/metrics/conversationMemory*.test.ts` (and
`conversationMemorySpeakers.test.ts` from #377) with the seeders in
`test/metrics/graphSeed.ts` (`seedConversationVertex`, `seedConversationEdge`)
and the put-body helpers in `test/metrics/support.ts`. Model's `v3.3.0` export
leaves these definitions out, so hand-build the families and base definitions
in the conversation-memory fixture, and switch to Model's real export once it
emits them. For each capability, test one
positive and one negative case through the real reader and projector, plus the
stream route:

| Capability | Positive | Negative |
| --- | --- | --- |
| Off-path business time | an utterance counts on its meeting's New York date | an utterance with no owning meeting, or two, is excluded |
| Three-hop paths | 5 + 1 utterances by two people count 2 speakers | an utterance never linked to media counts 0; if the TRANSCRIPT condition is built rather than waived, a speaker on non-TRANSCRIPT media counts 0 |
| Two edges, same vertex | invited and attended counts 1 | an invitee who did not attend, and a walk-in who was not invited, count 0 |
| Person-or-Email union | Person-only, Email-only and both-edge actions each count once | an action assigned by email only adds nothing to `person.action.assigned.count` |

Keep the existing debt and payment tests (`hoothootGolden`, `debtProjectorBatch`,
`globalRollup`, `streamRouting`) passing unchanged, and add a regression test
that the payment catalog compiles to the same plan. Compile every new
definition with the real loader (`loadMetricsCatalogV3`) for DEV and PROD.

## Ship one change two ways

Merge once to `prismteam-ai/persist` `main`; never change `persist-fork`.

- **Prism Marketplace:** `marketplace/app.ts` (tolerant lexicon mode, portable
  sizing). Build, Marketplace review and a VALID `persist` bundle; each
  environment's Puller installs it (soofi-safavi runs AUTO). Confirm the new
  bundle id replaced the previous one.
- **SOC:** `bin/app.ts` (strict lexicon mode, SOC sizing). `ci-cd-dev` deploys
  SOC DEV (`951132547414`); check that debt and payment cells are unchanged,
  then promote to SOC PROD (`014948052063`) through `ci-cd-prod` only with
  SOC's approval.

The metrics loader has no lexicon mode; the mode governs ingest and FTS. Before
SOC DEV, confirm SOC's strict lexicon declares every label and edge the new
families read (for example `email_assigned_action`), or leave those
definitions `BACKFILLING` there.

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

### Backfill and verify meeting and person scopes

New MEETING or PERSON definitions follow the same steps, one scope at a time:

1. After the catalog is in sync, plan the MEETING backfill without `confirm`.
   Review the scope count, windows and expected notices, then run it with
   `"confirm": true`. Wait for the scope queue and its DLQ to drain, then do
   the same for PERSON.
2. Read `STATUS`: every gate must pass and coverage must be complete for the
   new definitions.
3. Plan `ACTIVATE`, then run it with `"confirm": true` and the
   `expectedActiveGenerationId` read from `STATUS`. Record the previous
   generation as the rollback target.
4. Compare the active generation's DAY cells with direct graph counts for
   every metric, using a read-only check script. For the meeting report that is
   Quinlen's `verify_metrics.py`, which is not in a repository: ask for it. Also check for duplicate or detached cells,
   that re-running the backfill adds none, and that metrics already ACTIVE
   kept their totals. Then read the report itself.

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
