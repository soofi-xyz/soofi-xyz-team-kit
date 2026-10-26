# Transform capability map

Use Kecleon for engine features and Silvally for language/mapping configuration.
Derive the dependency plan with the [shared workflow](../../SKILL.md). These thirteen
capability areas reflect the current [product contract](../../../build-transform-product/reference/PRD.md);
select and split them by the requested scope, rather than targeting a fixed count.
Pin definitions/mappings and keep one enabled directional SQL mapping per pair.
For the extraction phase, pin the selected configuration, connection revision, model, prompt
and JSON Schema using [its contract](../../../build-transform-product/reference/non-deterministic-extraction.md).
For transactional mappings, keep one enabled mapping per pair and engine and pin the
script digest using [its contract](../../../build-transform-product/reference/transactional-javascript.md).

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `typed-conversion` — convert one registered pair | Approved definitions and SQL | Deliver the minimum resolver, Parquet reader, SQL execution and typed writer; configure a tiny conversion and invalid typed input. | Inspect planning, Glue run/logs and one output row/type; preserve an independently expected result. |
| `mapping-reuse` — change behavior through registration | Typed conversion | Complete governed pair resolution/version pinning; configure another mapping version or direction without an engine edit. | Inspect resolved identity/digest and output difference; reject missing, ambiguous or disabled registration. |
| `jsonl-format` — read/write JSON Lines | Typed conversion | Deliver JSONL adapters; configure JSONL input/output and null/type cases. | Inspect resolved format, Glue parser/writer logs and actual bytes/types; compare round-trip values. |
| `csv-format` — read/write delimited tables | Typed conversion | Deliver CSV adapters/options; configure delimiter/header/quoting variants. | Inspect planned options, parser errors and output manifest/bytes; prove a variant changes interpretation as expected. |
| `excel-format` — read/write workbook datasets | Typed conversion | Deliver bounded Excel adapters; configure sheets, columns and row/byte limits. | Inspect Glue driver logs, per-sheet counts and limit rejection; compare the produced workbook data. |
| `multi-dataset-sql` — join and emit related datasets | Typed conversion | Deliver multi-input SQL dependencies and per-dataset outputs; configure a join and missing/optional input case. | Inspect pinned input views, SQL failure diagnostics and output dataset counts/types. |
| `graph-vertices` — emit stable graph facts | Typed conversion and model definitions | Deliver vertex role/property bindings; configure stable IDs and a bad/duplicate ID case. | Inspect distributed validation logs and actual output IDs/property types; compare repeated results. |
| `graph-edges` — emit relationships and graph profiles | Graph vertices and required output format | Deliver endpoint bindings and graph-specific serialization; configure valid/invalid edges and the requested profile. | Inspect endpoint validation and serialized headers/IDs; prove every edge matches a vertex without imposing graph columns on tabular outputs. |
| `cost-admission` — bound a conversion | Resolved plans/input sizing | Deliver supported size/cost admission and reporting; configure allowed and over-ceiling requests. | Inspect admission decisions and measured/reportable cost; show a rejected plan never starts Glue. |
| `pinned-replay` — reproduce a conversion | Resolved/pinned mappings and output manifests | Complete immutable input/configuration pinning and replay controls; configure repeated input and a changed-artifact conflict. | Inspect plan digests, workflow/Glue logs and manifests; compare results and reject incompatible drift. |
| `configuration-lifecycle` — register mappings for configuration bundles | Verified mapping configuration API and ownership contract | Deliver/verify validation, immutable registration, identical replay, changed-content conflict and read-back for Deploy's shared adapter; preserve Silvally's existing mapping-readiness gates. | Inspect registration IDs/digests and rejected writes; no implicit Transform run. Synthetic adapter tests do not establish production-derived mapping readiness. |
| `non-deterministic-extraction` — extract structured JSON from a string | Versioned extraction configuration and HTTP run contracts, verified adapter/model access and schema support | Deliver configuration selection/pinning, a TypeScript AI SDK worker with explicit provider adapters, extraction prompt and JSON Schema validation; configure a model/schema variant and exercise missing facts, non-string input and invalid model output. Keep SQL conversion available independently. | Inspect the actual workflow/worker logs, selected model and configuration/schema digests, structured output, token usage and bounded failures. Have the user run and inspect an authorized sample. Saved-result replay must avoid another model call; fresh inference may vary. |
| `transactional-javascript` — map one small transaction to a graph synchronously | Configuration API, Lexicon definitions for the pair, verified Persist GraphSON ingest | Deliver `engine: "javascript"` registration (script digest, compile-only validation), per-engine pair resolution, the synchronous transaction route, a fresh QuickJS sandbox per transaction with memory/time limits and GraphSON serialization of mapping ids; configure one mapping and exercise a script throw, timeout, invalid output and a dangling edge. Keep `spark-sql` registration and batch runs unchanged. | Inspect the Lambda logs (mapping digest, per-step durations, counts), the returned GraphSON and `POST /persist/validate` on it; prove sandbox probes fail closed; measure cold start and warm p50/p99 on the deployed route. |

Include validation, negative cases, replay/idempotency appropriate to the feature
and operational logs in each increment. The replay row is for the actual pinned
replay capability, not a final generic test phase. A fix to one amount expression
normally selects a single mapping feature piece with baseline, changed mapping,
invalid input and replay tests inside it; do not force formats or new pairs into
that task. Test-only requests do not edit/publish mappings. Discover real state/job
names and give the person only the current run's relevant inspection links.

For configuration-bundle work, follow [the shared installer contract](../../../build-product-deployer/reference/configuration-bundles.md).
Keep the new lifecycle/provider requirements distinct from observed deployment support.
