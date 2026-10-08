# Model test data and dependency fakes

Use the smallest vocabulary in the target schema format: synthetic `fixture_person`
and `fixture_company` vertices and a `fixture_person_works_for_company` edge. Add
an optional `source_reference` property and a separately declared derived index
as the compatible variant. These are isolated test labels, not proposals to add
duplicate concepts to the canonical vocabulary. Ask Mew to check existing concepts
before preparing a real model change. Never invent production enum evidence.

| Capability | Fixture / fake behavior | Required observation |
| --- | --- | --- |
| Definition lookup | Two immutable releases with different digests and one missing definition | API returns the requested release; existing scoped artifact consumers still work |
| Candidate validation | Valid edge; missing endpoint; invalid required field; index mistaken for required input | Invalid candidate fails with usable errors and canonical release is unchanged |
| Governed changes | Approved, rejected and stale candidate revisions with fake review integration | Only supported approved revision proceeds; fake approval remains marked as mocked |
| Ruleset definitions | One rule and query referencing fixture labels; missing query and unknown-label variants | Catalog/reference checks pass or reject predictably without invoking Rule evaluation |
| Language/mappings | Two registered fixture languages and one Silvally-authored directional mapping | Missing reverse direction, schema/digest mismatch and missing graph bindings reject correctly |
| Business KPI discovery | One explicit report question, pinned source ledger and external-input ledger; valid family, unresolved attribution and numeric × enum × path candidate | Only source-supported family is `VALID`; unresolved/invalid requests appear under `Cannot Be Generated` |
| Metric materialization validation | Event-flow amount definition and current-status amount definition with deterministic election; missing tie-breaker, duplicate path, unknown enum, incomplete trigger and coverage mismatch variants | Closed plans regenerate exactly; invalid semantics fail before publication and no graph write occurs |
| Metric materialization publication | Reviewed package, exact activation allowlist, duplicate version, stale review, interrupted publication and digest mismatch | Immutable package and Lexicon release attest one another; publication never claims Persist activation or cells |
| Observability metric definitions | Fixture CloudWatch metric with required dimension; alternate valid dimension value; unknown dimension | Registry validation and publication work without claiming consumer emission |
| Release compatibility | Compatible addition, breaking removal and interrupted publication | Active release never points at a partial or incompatible artifact set; read-back hashes match |

Use the current target validators to materialize JSON, manifests and query files;
these scenarios do not define a replacement wire schema. Compute real fixture
hashes. Mock review delivery, artifact storage and consumer compatibility probes
first; keep Persist, Rule and Transform execution separate from Model validation.

For metric-materialization fixtures, use synthetic source identities and amounts,
not production data. Cover:

- one `EVENT_FLOW` SUM whose immutable source item contributes once;
- one `LATEST_STATE` status-member SUM and COUNT whose status election has
  explicit order, precedence and immutable tie-breaker;
- a transition into and then out of the qualifying status, proving that every
  status event is a recomputation trigger;
- one `AS_OF_SNAPSHOT` relationship classification at the source fact's
  business time, and rejection of a current index as historical evidence;
- DEBT and literal enterprise-GLOBAL scopes with DAY, MONTH, QUARTER and YEAR
  periods, proving larger current/as-of grains are not sums of daily cells;
- `FULL_HISTORY` without a start and `FORWARD_ONLY` with one;
- compatible units and a mixed-currency candidate with no governed conversion;
- enum expansion only after the measure × classifier family is valid; and
- one report question whose required input exists only outside Lexicon.

Use the current target package generator to produce the closed plan and compare
it byte-for-byte with validation output. Treat the KPI analysis template as an
authoring record, not a guessed API request shape.

Run the deployed test API with controlled candidate data and fake external
integrations; inspect API logs and publication workflows or resource logs for
synchronous operations. Give the user the selected request/release IDs and exact
AWS resources. If only S3/SSM and a static viewer exist, record HTTP acceptance as
pending and hand the API gap to Dialga. Never make canonical S3/SSM edits to fake a
passing configuration. Keep source review and approved release prerequisites.
