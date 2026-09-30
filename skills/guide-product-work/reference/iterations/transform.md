# Transform capability map

Use Kecleon for engine features and Silvally for language/mapping configuration.
Derive the dependency plan with the [shared workflow](../../SKILL.md). These ten
capability areas reflect the current [product contract](../../../build-transform-product/reference/PRD.md);
select and split them by the requested scope, rather than targeting a fixed count.
Pin definitions/mappings and keep one enabled directional mapping per pair.

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

Include validation, negative cases, replay/idempotency appropriate to the feature
and operational logs in each increment. The replay row is for the actual pinned
replay capability, not a final generic test phase. A fix to one amount expression
normally selects a single mapping feature piece with baseline, changed mapping,
invalid input and replay tests inside it; do not force formats or new pairs into
that task. Test-only requests do not edit/publish mappings. Discover real state/job
names and give the person only the current run's relevant inspection links.
