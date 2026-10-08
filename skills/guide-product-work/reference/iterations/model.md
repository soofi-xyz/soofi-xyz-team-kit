# Model capability map

Use Dialga to implement Model and Jirachi to configure existing
capabilities. Follow the [shared workflow](../../SKILL.md). These 8 areas are a
starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `definition-lookup` — read governed definitions through the API | Verified Lexicon artifacts and release identity | Deliver authenticated vocabulary/release discovery API over the existing published artifacts. Exercise pinned/current versions, absent definitions and unauthorized access. | Trace request and scoped artifact reads; compare returned identity/digest with the selected release and keep the existing S3/SSM consumer paths usable. |
| `candidate-validation` — validate a proposed schema change | Definition lookup | Deliver candidate submission/validation and observable results without publishing. Compare compatible property/edge changes, missing endpoints, invalid required fields and properties incorrectly moved into indexes. | Inspect validation execution and errors; prove invalid candidates never replace canonical artifacts. Separate Model governance checks from Persist’s runtime validation. |
| `governed-changes` — review and version candidate changes | Validated candidate and verified review integration | Deliver supported review/version/deprecation workflow with optimistic conflict protection. Exercise approved/rejected and stale candidates; keep source review authoritative and record reviewer provenance. | Follow candidate status and audit logs; verify unapproved or stale changes cannot publish. Mock review delivery but never present fabricated approval as live approval. |
| `ruleset-definitions` — publish consistent rule definitions | Governed changes and Rule artifact contract | Deliver ruleset catalog/manifests/query-reference validation and governed publication. Exercise ordered rules, missing query files and unknown vocabulary labels. | Inspect validation/publication logs and API read-back; verify artifacts match the approved candidate. Hand actual Rule evaluation to Meditite. |
| `language-mappings` — govern shared language and mapping registrations | Governed changes and Transform registration contract | Deliver versioned schema references and directional mapping publication. Use Silvally-authored mapping fixtures; exercise reverse direction missing, schema/digest mismatch and explicit graph ID/endpoint bindings. | Inspect published identities, references and digests. Verify publication without claiming Transform execution; a new generic catalog pointer remains a build requirement until observed. |
| `kpi-metric-configuration` — map business KPIs to executable metric families | Governed changes, verified graph vocabulary and Base Metrics catalogs | Deliver exact-reuse lookup, family matching, executable-package validation and release inclusion. Compare a reused definition, supported family variant, family without an executor and unsupported composite formula. Finance is one executable family, not the generic KPI contract. | Inspect Base Metrics and executable-package manifests, generated plans/digests, released artifact and API read-back. Verify consumer compatibility separately; distinguish validation, publication, activation and observed materialization. |
| `observability-metric-definitions` — govern CloudWatch names and dimensions | Governed changes | Deliver observability registry validation and release inclusion. Compare two dimension sets and reject unknown dimensions or inconsistent emission metadata. Coordinate actual emitter/dashboard updates with their owners. | Inspect registry validation, released artifact and API read-back; distinguish a valid definition from an observed CloudWatch metric emitted by a consumer. |
| `release-compatibility` — publish and select compatible releases | Selected governed artifact families | Deliver reviewed release publication, digest metadata, consumer compatibility checks and supported prior-release selection. Exercise a breaking change, interrupted publication and digest mismatch. | Inspect publication execution, release metadata and consumer-readable S3/SSM values. Verify no partial release is advertised as complete; use supported reviewed release flow, never direct object overwrite. |

Read [the product contract](../../../build-lexicon-product/reference/PRD.md) and
[synthetic test data](../../../build-lexicon-product/reference/test-data.md).
Discover actual routes, auth, statuses and test adapters from the target revision.
Exercise each piece through the HTTP API, including submission/status/results for
async work. Direct AWS inspection supports evidence; it does not replace API use.
Start with faked dependencies, then run the real test-stack API/workflow using those
fakes. Use live dependencies only within authorized scope. Give one invocation and
at most three AWS inspection steps, collect the person’s redacted ID and observation,
and wait for that feedback before implementing or configuring the next piece.
Keep local tests, synthesis, deployed mocked execution and live effects distinct.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.
