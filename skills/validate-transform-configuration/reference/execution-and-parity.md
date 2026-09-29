# Execution capture and derived validation

## Execute the workflow

Run the steps in `workflow.steps` strictly by ascending `sequence`. Before
each DEV run, complete the operation card in `intake-questions-and-gates.md`
and get approval for its digest.

1. **Locate the runtime read-only.** Get the DEV Transform state machine ARN
   (`aws stepfunctions list-state-machines`, name ending with the layout's
   `transformRuntime.stateMachineSuffix`) and the published registry root
   (`publishedRegistry.uriParameter`). Confirm that each step's deployed
   `mapping.json` SHA-256 and every query `sha256` match the pinned candidate.
   A mismatch is deployment drift, and the step does not start.
2. **Build the v2 request** from the registered mapping. Mapping identity is
   derived from `from` and `to`:

   ```json
   {
     "contractVersion": 2,
     "from": "<source language>",
     "to": "<target language>",
     "mappingVersion": "<x.y.z>",
     "inputs": [{ "table": "<declared input table>", "s3Uri": "s3://…/derived/<table>/" }],
     "output": { "s3Prefix": "s3://<dev-transform-data-bucket>/outputs/silvally-<profile-or-mapping>/<runId>/<case>/" },
     "costCeilingUsd": 5
   }
   ```

   - Step 1 binds `inputs[]` to the confirmed dataset manifest. Every declared
     required input must be present. Undeclared, duplicate, or empty inputs fail
     in `resolve-plan`, which is a valid finding.
   - Step *n > 1* binds each declared input table to the physical output of step
     *n − 1*: `<output.s3Prefix>/<executionId>/tables/<dataset>/`. The dataset
     name must equal the input table name. Neptune-profile outputs
     (`vertices/`, `edges/`) are bound only when the next mapping declares
     graph inputs from them. Never bind to a prefix whose `_metadata.json` is
     absent.
3. **Start the execution** with a new unique name
   (`silvally-<runId>-<sequence>-<mapping-id>`), using
   `aws stepfunctions start-execution --state-machine-arn … --name … --input file://request.json`.
   If the workflow pauses at the cost gate, the callback is a separate card.
4. **Wait and capture.** Poll `describe-execution` until the run terminates;
   never retry blindly. Record in `executionSteps[]`:
   - `executionArn`, status, and start and stop times;
   - `planSha256` from `s3://<dev-transform-data-bucket>/runs/<executionId>/plan.json`;
   - `metadataSha256` of `<prefix>/<executionId>/_metadata.json`, plus its
     per-dataset row counts, schema locations, and file groups;
   - `executedSqlSha256s`: the query digests recorded in the plan and metadata.
     Registration-only evidence never satisfies this;
   - `inputManifestSha256` and `outputLocation`;
   - `logLocations`: the state machine log group, the `resolve-plan` and
     `report-metrics` Lambda log groups, and `/aws-glue/jobs/output` and
     `/aws-glue/jobs/error` for the Glue run ID. Store sanitized excerpts only.
5. **Stop on failure.** A failed step is a finding. Inspect `_metadata.json`
   (which will be absent), the plan, and the logs; later steps are not started.
   Only an operator can rerun it, through a new card with a new execution name.

## Tools for this procedure

`scripts/transform_runs.py` implements steps 1–5 from a run spec (state machine ARN, output
root, operator's DEV profile, pinned mapping digests and VersionIds, and one case per request):

```bash
S=skills/validate-transform-configuration/scripts
python3 $S/transform_runs.py spec-from-intent --intent intent.json --workspace "$WS" --profile <dev-profile> \
  --bind <name>=s3://<bucket>/<input-prefix>/ [--bind ...] [--profiles <profile-dir>] --out run-spec.json
python3 $S/transform_runs.py cards --spec run-spec.json --run-dir "$RUN"      # APPROVAL_REQUIRED + digests
python3 $S/transform_runs.py start --run-dir "$RUN" --approve sha256:<digest> \
  --approver "<who>" --scope "<approval in their words>"                      # only matching cards start
python3 $S/transform_runs.py capture --run-dir "$RUN"                          # read-only evidence + reconciliation
python3 $S/transform_runs.py regress --run-dir "$RUN" --baseline "$PREVIOUS_RUN"
python3 $S/transform_runs.py cost --run-dir "$RUN" --job-name <transform-glue-job>
```

`spec-from-intent` reads the mapping registration from the workspace and derives every case
from it: for each binding (a prefix holding one `<table>/` directory per input, listed
read-only), one case per output whose `requiredInputs` are all present, a full case when one
binding covers every output, and one rejected case per required input of every output, which
omits exactly that input. Bindings default to the profile's ready `existing-dev-artifact`
sources for the direction. Outputs a binding cannot run and a full run no binding supports are
listed under `skipped`. The spec records each output's registered format, the pinned digest,
and `deployment.drift` when the published registry does not serve the pinned digest; `start`
then refuses. `expected: REJECTED` cases pass only when the execution fails before
`RunTransformJob` and the error names the omitted input. `capture` reads CSV, JSONL or Parquet
outputs in their registered format, reconciles physical rows and files with `_metadata.json`, and
flags `mappingPinMatches: false` when the plan's `mapping.json` digest or VersionId differs from
the pin (deployment drift or a latest-PR-wins overwrite). `regress` matches cases with a previous
run by mapping, input locations, outputs and expectation (not by case name) and compares row
counts and content digests. Check outputs with `compare_datasets.py check` (contract format and
columns, keys, the profile's declarative checks, oracles and allowed losses), prove graph closure
with `compare_datasets.py closure`, compute phases with `evaluate_run.py`, and assemble the
package with `build_run_package.py`. When a step needs Parquet graph inputs but the previous step wrote
Neptune CSV, bridge it with `graph_export_bridge.py neptune-csv` (record synthetic
`created_at` as a limitation); convert epoch-millis exports with `graph_export_bridge.py iso-dates`.

## Field-by-field parity

Derive parity from the pinned language definitions and registrations. Never
derive it from prose or copy it from a profile. The resolver's
`parityDerivation` output is the starting set.

- **Round trip** (`X -> <hub> -> X`): for each input table of the forward
  mapping, compare every non-deprecated property that the dataset declares in
  the definition of `X`. Normalize both sides by the profile's declared rules
  (UTC timestamps, numeric canonical form, and null versus absent only where
  the definition marks the field optional). Then compare multisets of rows keyed
  by the dataset's required identity fields. Report `fieldCount`,
  `mismatchCount`, per-field mismatch counts, and SHA-256 digests of the
  normalized sorted rows on both sides.
- **Projection or cross-source** (`<hub> -> Y`): for each output dataset,
  every property declared in the definition of `Y` must be present and typed. An
  oracle (the profile's `oracles`, referenced by a `matches-oracle` check) states the
  expected values; compare them `part-bytes`, `sorted-rows`, or `keyed` by the contract key,
  where only the profile's `allowedLosses` may explain a difference.
- **Missing reconstruction**: a forward input that the inverse mapping does not
  output is `RoundTripDatasetGap` (`FAIL`) unless the profile lists it as a
  permitted loss.
- **Undefined target**: if the dataset or language has no Lexicon definition,
  the parity entry is `UNDEFINED_IN_LEXICON` and `BLOCKED`. Under
  `parityPolicy.undefinedDatasets: consumer-contract`, the profile's consumer
  contract may supply the field list, recorded as `fieldSource:
  consumer-contract`.
- **Profile floor**: with `parityPolicy.declaredFields: minimum`, the
  profile's `parityDatasets` fields are a floor. Definition fields missing
  from the profile are still compared and reported as `missingFromProfile`.
  Profile fields unknown to the definition are `ProfileParityDrift`
  (`BLOCKED`). With `exact`, only the profile's fields are compared
  (`comparedFields`), and the other definition fields are recorded as
  `excludedByProfile`; use it for projections that can fill only a subset of
  the target columns.
- **Scoped round trip**: under `roundTripStrategy.comparisonScope:
  inverse-outputs`, a forward input the inverse does not output is
  `OUT_OF_SCOPE`, not `RoundTripDatasetGap`.
- **Output format**: for every CSV `outputContracts` entry, read the first line
  of each committed part file and compare it with the declared columns joined
  by the declared delimiter. A missing header or a different delimiter is
  `OutputFormatDrift`.
- **Partial inputs**: when `partialInputPolicy.status` is `supported`, run each
  declared case with the request's `outputDatasets`. A `PASS` case must
  succeed with only its `providedInputs`, and a `REJECTED` case must fail in
  `resolve-plan` before Glue starts.

## Forbidden and removed concepts

For every `* -> <hub>` output and every graph input of `<hub> -> *`,
normalize the label (drop the `vertex-` or `edge-` prefix and change `-` to
`_`), then classify it against **current Lexicon `main`**:

| State | Result |
| --- | --- |
| `ACTIVE_ON_MAIN` | pass |
| `ADDED_IN_CANDIDATE` | pass only when `main` history never removed it (`git log -S '"type": "<label>"' -- <conceptModelPath>` on a full-history `main` clone); record as additive. `historyChecked: false` means the resolver had no full history, so run the check before phase 6 passes |
| `REMOVED_ON_MAIN` | `FAIL` (`RemovedLexiconConcept`): absent on `main` but present in its history |
| `DEPRECATED_ON_MAIN`, `ABSENT` | `FAIL` (`LexiconConceptInactive`) |
| `FORBIDDEN` (shared `forbidden-concepts.json`, profile `forbiddenConcepts`, or a retired mapping id) | `FAIL` (`RemovedLexiconConcept`) |
| `AUXILIARY_INPUT` | non-graph input without a graph binding; not a concept, recorded only |
| `NOT_SELECTED` | output outside a profile's `outputDatasetMatch: includes` subset; the run excludes it through `outputDatasets` |

Independently of mappings, the shared list's labels and scoped properties
(`concept.property`) must not appear in the candidate or `main`
concept model (`ForbiddenConceptInLexicon`, `ForbiddenPropertyInLexicon`).
Properties marked `sqlScan: true` are also scanned for in SQL.

Also scan every executed SQL body for forbidden labels. A string match in SQL
or output labels is a `FAIL` even when registration metadata is clean. The
resolver scans each registered and published `queries/*.sql` beside a mapping
(`sqlScan`, finding `ForbiddenConceptInSql`); after execution, confirm the
plan's executed query digests equal the scanned files.

## Coverage

- Every required source family has more than zero rows in the confirmed window.
- Every enum value declared by a source definition (`coverageTargets`) is
  observed, or is explicitly waived by the profile.
- Every profile `requiredCoverageSignals` entry has evidence.
- Graph outputs have unique, non-empty IDs; every edge endpoint resolves inside
  the run's own outputs or a declared authoritative endpoint export; and the
  dangling endpoint count is zero.
- With `persistPolicy: forbidden`, graph closure comes only from Transform
  outputs, and the Persist canary is recorded as not required.

## Verdict and evidence package

Apply the verdict rules in `SKILL.md`. Findings the resolver reports before
execution (profile drift, `HubOutputNotGraph`, `LanguageDefinitionMissing`,
`UpstreamSourceUnresolved`, `RoundTripDatasetGap`) enter phases 5–6 as `FAIL`
or `BLOCKED` findings with remediation handoffs. Execution does not override
them.

Keep the evidence package outside the repositories, in a local run directory
or an approved DEV `evidence/` prefix:

```text
<run>/intent.json                  resolver output (sha256 pinned)
<run>/approvals/<digest>.json      one operation card per gated write or run
<run>/steps/<sequence>/request.json, describe-execution.json, plan.sha256, _metadata.json, logs-excerpt.txt
<run>/parity/<dataset>.json        field counts, mismatches, normalized digests
<run>/concepts.json                concept classification and SQL scan
<run>/run.json                     transform-configuration-run.schema.json package
<run>/report.md                    validation-report.md rendering
```
