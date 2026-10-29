# Record quality checks

Implement `record-quality-checks` as a Transform capability that evaluates
declarative, per-record checks registered with a mapping. A record that fails a
`reject` check is quarantined and never reaches the output; a record that fails
a `warn` check is written and listed. Valid records in the same run are still
written, so one bad source record no longer fails, or silently pollutes, a whole
conversion.

Transform is the only place this can happen: a quarantined record never reaches
the graph, so no downstream product (Rule/Filter, Schedule, solver) can see or
suppress it. Keep the checks generic: a check names a dataset, columns and a
kind from a fixed list. Never add source-, entity- or company-specific checks to
the engine.

Use this as an implementation requirement, not evidence of a deployed API.
Kecleon builds the capability; Silvally authors and tests checks once deployed
support is verified.

## Relationship to definition validation

Definition-derived validation (required properties are non-nullable, `type`,
`format`, `enum`, `pattern`, `minLength`) stays unchanged and still fails the
run: it describes what a language *is*. Record quality checks describe what a
record must contain to be *usable* by this mapping's consumers. Do not make a
property `required` in a Lexicon definition only to filter incomplete records;
that turns one bad row into a failed run.

## Mapping artifact

Add an optional `checks` array to `mapping.json` for both `spark-sql` and
`javascript` engines. Checks are part of the registered, immutable version and
its digest; changing a check is a new mapping version.

```json
{
  "id": "<from>-to-<to>",
  "version": "1.3.0",
  "engine": "spark-sql",
  "checks": [
    {
      "id": "primary-address-complete",
      "stage": "input",
      "dataset": "address",
      "subject": { "idColumn": "address_id", "refColumns": ["debt_id"] },
      "when": [{ "column": "is_primary", "equals": true }],
      "severity": "reject",
      "rules": [
        { "column": "address_line_1", "kind": "nonEmpty" },
        { "column": "city", "kind": "nonEmpty" },
        { "column": "postal_code", "kind": "pattern", "value": "^[0-9]{5}(-[0-9]{4})?$" }
      ],
      "thresholds": { "alertAtRejected": 1, "failRunAtRejectedRatio": 0.05 }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable kebab-case check id, unique within the mapping; appears in every outcome |
| `stage` | `input` (a declared input dataset, before SQL/`transform`) or `output` (a declared output dataset, after SQL/`transform`, before writing) |
| `dataset` | An input table name or output dataset name declared by the same mapping |
| `subject.idColumn` | Column that identifies the record in outcomes; required |
| `subject.refColumns` | Optional extra identifier columns copied into outcomes (for example a related business id) |
| `when` | Optional conjunction of `{ column, equals }` conditions; the check applies only to matching records |
| `severity` | `reject` or `warn` |
| `rules` | One or more rules; a record fails the check when any rule fails |
| `thresholds.alertAtRejected` | Publish an alert when at least this many records fail the check; default `1` for `reject`, unset for `warn` |
| `thresholds.failRunAtRejectedRatio` | Fail the run with `QualityThresholdExceeded` when failed/evaluated exceeds this ratio; protects against systemic input breakage |

Supported rule kinds (fixed list; anything else is rejected at registration):

| `kind` | Fails when |
| --- | --- |
| `present` | value is null or the column is absent |
| `nonEmpty` | value is null, or a string that is empty after trimming whitespace |
| `pattern` | value is non-null and does not match `value` (Spark/ECMAScript-compatible subset validated at registration) |
| `enum` | value is non-null and not in `value` (array) |
| `minLength` | value is a non-null string shorter than `value` |

Combine `present`/`nonEmpty` with `pattern`/`enum` to require a valid value.
Do not add a free-form SQL or JavaScript predicate kind; new kinds are engine
changes with their own tests.

## Registration

- Validate `checks` in the configuration API for both engines: unique ids,
  supported `stage`, `dataset` declared by the mapping, every referenced column
  present in that dataset's language definition (input stage: source definition;
  output stage: target definition), supported rule kinds and value types,
  compilable patterns, `0 < failRunAtRejectedRatio <= 1`.
- A mapping without `checks` validates and runs byte-for-byte as before.
- Preserve immutable versions, identical-content replay, `409` conflicts and
  digest read-back; include `checks` in the mapping digest.

## Execution

### Batch (`spark-sql`)

1. Input stage: after reading and typing each input view and before
   `spark.sql()`, evaluate its checks in Spark (no `collect()` of data).
   Remove `reject` failures from the registered view; keep `warn` failures.
2. Output stage: after each query result is validated against the target
   definition and before writing, evaluate output checks the same way.
3. Graph outputs: when a rejected record is a vertex, also remove every edge in
   the same run whose `~from` or `~to` references it, and quarantine those edges
   with reason `DependsOnRejected` and the originating check id. This keeps the
   complete-export endpoint contract intact.
4. A record failing several checks produces one outcome per failed check.
5. Evaluate `failRunAtRejectedRatio` after counts are known and before any
   output is committed; on breach, fail with `QualityThresholdExceeded` and
   write no output datasets, only the quarantine and metadata.

### Transactional (`javascript`)

Evaluate input checks on the parsed inputs before `transform` and output checks
on returned vertices/edges (`dataset` is the vertex or edge label). Remove
rejected elements and dependent edges, and add a `quality` block to the
`200` response:

```json
{ "quality": { "checks": [{ "id": "...", "evaluated": 1, "passed": 0, "warned": 0, "rejected": 1 }],
               "outcomes": [{ "checkId": "...", "severity": "reject", "subjectId": "...", "failedColumns": ["city"] }] } }
```

A transaction whose every output element is rejected returns `200` with an empty
graph and the `quality` block; it is not a `MappingFailed` error.

A `json` output mapping returns a document, not labeled elements: evaluate its
input checks as above and reject output-stage checks at registration.

## Outputs

Write outcomes next to the run's datasets and bind them in `_metadata.json`:

- `<base>/<executionId>/quarantine/<checkId>/` — JSONL, one line per rejected
  record (including `DependsOnRejected` edges).
- `<base>/<executionId>/warnings/<checkId>/` — JSONL, one line per warned record.

Each line:

```json
{ "executionId": "...", "mapping": { "id": "...", "version": "...", "sha256": "..." },
  "checkId": "primary-address-complete", "severity": "reject", "stage": "input",
  "dataset": "address", "subjectId": "<idColumn value>", "refs": { "debt_id": "<value>" },
  "failedColumns": ["city"], "reasons": ["nonEmpty"] }
```

Record identifiers and column names only. Never write, log or alert on the
failing values themselves; they may be PII.

Extend `Result` in `_metadata.json` with `checks[]`:
`{ id, severity, stage, dataset, evaluated, passed, warned, rejected, quarantineUri?, warningsUri? }`.
The reporter treats `quarantine/` and `warnings/` as expected paths when the
plan declares checks, verifies their line counts against the reported counts and
rejects them when the plan declares none.

## Alerts and metrics

- After the run commits, publish one alert per check that reached
  `alertAtRejected` through the existing alert receiver, deduplicated by
  `executionId` + `checkId`. Include mapping id/version, check id, counts, the
  quarantine URI and at most 50 subject ids; never values.
- Emit per-check metrics (`RecordsEvaluated`, `RecordsWarned`,
  `RecordsRejected`) with dimensions `mapping` and `check` through the shared
  metrics integration, so trends can be alarmed without reading S3.
- `QualityThresholdExceeded` uses the existing execution-failure alert path.

## Replay

Checks are pinned with the mapping, so replaying the same inputs and mapping
version produces identical outcomes. There is no quarantine state to clear:
a quarantined record is processed normally on the next run after its source is
fixed. Do not add retry or redrive for quarantined records.

## Acceptance

- Registration: valid checks for both engines; unknown dataset/column, unknown
  rule kind, bad pattern, duplicate id, invalid threshold are rejected; mappings
  without checks are unchanged; identical replay and changed-content `409`.
- Batch: pass, `warn` and `reject` at each stage; `when` scoping; a record
  failing two checks; a rejected vertex with dependent edges (edges quarantined,
  endpoint validation still passes); `failRunAtRejectedRatio` breach writes no
  output datasets; metadata counts equal quarantine/warnings line counts.
- Transactional: rejected element and dependent edges removed, `quality` block
  returned, all-rejected transaction returns an empty graph.
- Privacy: quarantine lines, logs, metrics and alerts contain no failing values.
- Alerts: one alert per breaching check per execution; no alert below threshold.
- Replay: same inputs and version give identical outcomes; a fixed source record
  passes on the next run.
- Live: one authorized DEV run with a known failing record, inspected through
  the quarantine output, `_metadata.json`, the alert and the metrics. Report
  local tests, synthesis and deployed behavior as separate evidence levels.
