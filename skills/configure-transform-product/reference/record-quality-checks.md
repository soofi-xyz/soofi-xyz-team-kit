# Authoring record quality checks

Use record quality checks when a mapping must keep incomplete or unusable source
records out of its output (for example a primary address without a city) while
still writing every valid record. The engine contract is
[record quality checks](../../build-transform-product/reference/record-quality-checks.md).

Verify deployed support first: register a throwaway DEV version with one check
through `validate` and confirm the API accepts the `checks` field and the run
metadata reports `checks[]`. When it does not, hand the gap to Kecleon and stop.

## Choose the check

1. Start from a concrete defect: the records that caused it, the consumer that
   was harmed and the columns that were missing or invalid. Write those down as
   the check's independent expectation before editing the mapping.
2. Pick the stage:
   - `input` when the problem is in the source data and the record should not
     influence the mapping at all (missing address parts from the source
     system).
   - `output` when the problem only appears after the mapping's joins or
     derivations (a target vertex without a required derived property).
3. Pick the severity:
   - `reject` when writing the record would cause harm downstream (a wrong or
     incomplete address used for outreach).
   - `warn` when the record is still usable but someone should look at it.
4. Scope with `when` instead of creating a narrower dataset; keep conditions to
   equality on declared columns.
5. Choose `subject.idColumn` so the quarantine lines identify the record the
   source owner must fix; add `refColumns` for the business id people search by.
6. Set `alertAtRejected` (default `1` for reject) and a conservative
   `failRunAtRejectedRatio` that only a systemic break would cross; derive it
   from the observed failure rate on recent PROD-derived data, not a guess.

## Example

```json
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
      { "column": "postal_code", "kind": "nonEmpty" },
      { "column": "postal_code", "kind": "pattern", "value": "^[0-9]{5}(-[0-9]{4})?$" }
    ],
    "thresholds": { "alertAtRejected": 1, "failRunAtRejectedRatio": 0.05 }
  }
]
```

Column names come from the language definition of the checked dataset; do not
invent them. Adding, removing or changing a check is a new mapping version.

## Test

1. Fixtures: one passing record, one record per failing rule, one record outside
   `when`, one warned record when a `warn` check exists, and, for graph outputs,
   a rejected vertex with dependent edges.
2. Expect, independently of the output: the written records, the quarantine and
   warnings lines (check id, subject id, failed columns), the `_metadata.json`
   `checks[]` counts and whether an alert fires. Expect no failing values in any
   of them.
3. Register and run in DEV through the configuration API under the existing
   approval cards; inspect the quarantine prefix, metadata, alert and metrics.

## Validation runs

During a test-only validation (`/silvally test ...`), compare against PROD
actuals as usual. Records that a declared check quarantined are expected
differences: report them per check with counts and subject ids, not as parity
failures. Any other missing or extra record is still a finding. A check that
quarantines records PROD consumers needed is a `CONFIGURATION` finding against
the check; a missing rule kind, stage or output is a `PRODUCT_CHANGE` for
Kecleon.
