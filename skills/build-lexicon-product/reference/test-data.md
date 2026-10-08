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
| Financial metric definitions | Target repo's smallest financial metric fixture; materially different supported calculation/time behavior; unknown graph reference or unsupported ratio | Exact definition validation, deterministic materialization generation and publication work without claiming activation or Persist materialization |
| Observability metric definitions | Fixture CloudWatch metric with required dimension; alternate valid dimension value; unknown dimension | Registry validation and publication work without claiming consumer emission |
| Release compatibility | Compatible addition, breaking removal and interrupted publication | Active release never points at a partial or incompatible artifact set; read-back hashes match |

Use the current target validators to materialize JSON, manifests and query files;
these scenarios do not define a replacement wire schema. Compute real fixture
hashes. Mock review delivery, artifact storage and consumer compatibility probes
first; keep Persist, Rule and Transform execution separate from Model validation.

Run the deployed test API with controlled candidate data and fake external
integrations; inspect API logs and publication workflows or resource logs for
synchronous operations. Give the user the selected request/release IDs and exact
AWS resources. If only S3/SSM and a static viewer exist, record HTTP acceptance as
pending and hand the API gap to Dialga. Never make canonical S3/SSM edits to fake a
passing configuration. Keep source review and approved release prerequisites.
