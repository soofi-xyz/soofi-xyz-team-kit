# Synthetic new-mapping fixture

A deliberately small, PII-free mapping used by the tool tests and by the teammate quick start
to prove `synthetic-local` validation end to end without AWS:

- `transform-mappings/example-to-summary/0.1.0/` is a materialized mapping (same layout the
  Lexicon materializer and the published registry use). `opted_out` is an optional property
  absent from most input rows, so the run also proves typed-null handling.
- `inputs/people/` is JSONL input; one row has a null key and must be dropped.
- `expected/person_summary.csv` is the oracle written from the specification, not from the SQL.

See `SKILL.md` ("Getting started for teammates") for the commands.
