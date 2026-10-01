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
   A mismatch stops the step: `dev_redeploy.py check` classifies it as a `DeploymentRace`
   (another head's latest-PR-wins DEV deploy pruned or replaced it; `BLOCKED`, republished only
   under the owner's `devRedeployPinned`) or `DeploymentDrift` (the pinned head's own deploy
   serves other content; `FAIL`). `transform_runs.py start` re-reads the served digest right before
   each `StartExecution`.
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
# canary: 10 real events per slice from the confirmed window, staged under approval
python3 $S/transform_runs.py spec-from-intent --stage canary --intent intent.json --workspace "$WS" --profile <dev-profile> \
  --bind <name>=s3://<bucket>/<canary-prefix>/ [--profiles <profile-dir>] [--owner-cost-ceiling <usd>] --out canary-spec.json
python3 $S/transform_runs.py cards --spec canary-spec.json --run-dir "$CANARY"  # APPROVAL_REQUIRED + digests
python3 $S/transform_runs.py start --run-dir "$CANARY" --approve sha256:<digest> \
  --approver "<who>" --scope "<approval in their words>"                      # only matching cards start
python3 $S/transform_runs.py capture --run-dir "$CANARY"                       # read-only; rows under <run>/private/outputs/
python3 $S/prod_actuals.py compare --catalog <prod-actuals.json> --slice <slice> --actual <private events> \
  --dataset <dataset>=<run>/private/outputs/<runId>/<case>/tables/<dataset>/ --out canary-<slice>.json
python3 $S/transform_runs.py canary-gate --canary-run-dir "$CANARY" --comparison canary-<slice>.json \
  [--owner-decisions decisions.json] --out gate.json                          # show it and ask
python3 $S/transform_runs.py approve-full --gate gate.json --approver "<who>" --scope "<their answer>"
# full window, only after an APPROVED or PRE_APPROVED gate
python3 $S/transform_runs.py spec-from-intent --stage full ... --bind <name>=s3://<bucket>/<window-prefix>/ --out full-spec.json
python3 $S/transform_runs.py cards --spec full-spec.json --run-dir "$RUN"
python3 $S/transform_runs.py start --run-dir "$RUN" --canary-gate gate.json --approve sha256:<digest> --approver "<who>" --scope "<…>"
python3 $S/transform_runs.py capture --run-dir "$RUN"
python3 $S/transform_runs.py regress --run-dir "$RUN" --baseline "$PREVIOUS_RUN" --slice <slice>  # per slice
python3 $S/transform_runs.py cost --run-dir "$RUN" --job-name <transform-glue-job>
# after evaluate_run.py: the package spec is generated from the run's records (no hand-written spec)
python3 $S/build_run_package.py --run-dir "$RUN" [--run-dir <other slice's full run> ...] --canary-run-dir "$CANARY" [...] \
  --evaluation evaluation.json --intent intent.json --workspace "$WS" --profile-doc <selected or run-scoped profile> \
  --handoffs data-days.json [--graph-inputs <graph_inputs.py summary> ...] \
  --transform-revision <Transform commit> --transform-deployment-digest <deployed Glue script SHA-256> --spark-version <x.y> \
  [--package-spec override.json] --write-package-spec "$RUN/package-spec.json" --out "$RUN/run.json"
```

`build_run_package.py` derives `discoveryTrace` (the workspace's pinned repositories), `configurationPackage`
(languages, slices as directions, the pin and `versionSelection` from the intent; the Transform product from the
flags), `environment` (DEV account hash and region from the run-spec), `sensitivity` (sensitive slices), `graph`
(graph_inputs.py summaries), `runtime` (the flags; `UNAVAILABLE` without them, which cannot be `READY`),
`persistCanary`, `exporterHydration`, `roundTrip`, `boundaryDecisions` (owner-accepted and flagged product
changes), `failures` (the evaluation's non-`PASS` reasons) and `remediations` (the handoffs `data-days` recorded
and the catalog's `blockedHandoffs` for each slice that is not `READY`). Nothing is invented: a key no record
supports stops with `PackageSpecIncomplete` naming the missing input. `--package-spec` is optional; its top-level
keys replace the generated ones (`configurationPackage` merges key by key).

`spec-from-intent` reads the mapping registration from the workspace and derives every case
from it: for each binding (a prefix holding one `<table>/` directory per input, listed
read-only), one case per output whose `requiredInputs` are all present, a full case when one
binding covers every output, and one rejected case per required input of every output, which
omits exactly that input. When omitting the input would leave the case with no inputs at all, the
negative is not run and is listed under `skipped` with `OmissionLeavesNoInputs`. `--slice` limits the
spec to one package slice's outputs, and `--outputs` takes comma-separated or repeated dataset names
and rejects unknown names. Bindings default to the profile's ready `existing-dev-artifact`
sources for the direction. Outputs a binding cannot run and a full run no binding supports are
listed under `skipped`. The spec records each output's registered format, the pinned digest,
`deployment.location` (the registry root) and `deployment.drift` when the published registry does not
serve the pinned digest at spec time. With a location, the pins are refreshed read-only from what DEV
serves now, both in `spec-from-intent` and again in `cards` (`deployment-checks/refresh-*.json`): a
redeploy after the workspace snapshot or the spec republishes the pin under a new VersionId and clears the
spec-time drift. `start` re-reads the served digest right before each `StartExecution` and refuses a pruned
or replaced pin (`DeploymentRace`). Without a location, `start` refuses on the spec-time drift. Each case
records `inputContent`: per input table, a digest of its objects (path below `<table>/` and SHA-256) in the
binding's staged `manifest.json`. `expected: REJECTED` cases pass when the execution fails before
`RunTransformJob`. When the error does not name the omitted input, the case still passes and
carries a `transform-reject-error-unnamed` PRODUCT_CHANGE flag for Kecleon; it never fails the
canary gate. `capture` reads CSV, JSONL or Parquet
outputs in their registered format, reconciles physical rows and files with `_metadata.json`, and
flags `mappingPinMatches: false` when the plan's `mapping.json` digest differs from the pin, or its
VersionId differs from a pinned VersionId and from the one served right before that `StartExecution`
(deployment drift or a latest-PR-wins overwrite). A null or absent pin VersionId is not pinned: the
SHA-256 alone decides. `regress` matches cases with a previous run by mapping id@version and digest,
slice, output datasets, expectation and input content (`inputContent`), never by case name or S3 prefix
(every run stages to a new prefix; an input without a content digest falls back to its prefix), and
compares row counts and content digests; with no content-identical case (for example the same version
republished with another digest and output names, or other input content) it reports `NOT_APPLICABLE`
with the reason (`MappingRepublished`, `OutputNamesDiffer`, `InputContentDiffers`) instead of passing silently.
`capture` writes output rows only under the enclosing run's `private/outputs/<runId>/` (removed by
`run_workspace.py cleanup`) and keeps sanitized summaries (`steps.json`, `_metadata.json`) in the run directory. Check outputs with `compare_datasets.py check --slice` (contract format and
columns, keys, the profile's declarative checks, oracles and allowed losses), compare them with
what PROD actually did with `prod_actuals.py compare`, prove graph closure with
`compare_datasets.py closure`, compute phases with `evaluate_run.py`, and assemble the package
with `build_run_package.py`. When a later step needs inputs in another shape than the previous
step wrote, that conversion belongs in a registered mapping run by DEV Transform; Silvally does
not convert data locally.

## Comparison with PROD actuals

The baseline is what PROD did with the same real events, per slice, catalogued in
`reference/prod-actuals.json` (`slices.<slice>`: `baselineKind`, where it is read, the key on each
side, `fieldMap` from output column to actual path, optional `rowFilter` and `rejects`):

- `state-machine-lambda-outcomes`: a DEV output row must exist for each PROD-accepted event with
  equal mapped fields, and each PROD-rejected event must appear in the rejects dataset (keyed by
  the SHA-256 the mapping records). Rows only in DEV, rows only in PROD and per-column mismatches
  are counted (`ProdActualsMismatch`, `ProdRejectMismatch`).
- `iceberg-table`: DEV rows and the PROD table's rows in the window are matched by key and
  compared over `fieldMap`, after `rowFilter`. The key may fall back to other fields and normalize
  values (`key.fallback`, `key.normalize`); `keyCoverage` reports how many rows each side keyed.
  `comparison.actualScope: current-state-by-key` compares the current state per key (for example
  `active` or `deleted` per entity). Its key read (`comparison.keyRead`) selects the keys from the
  window, then reads each selected key's current state as of the mirror's data cutoff
  (`iceberg_snapshot_read.py --key-column --keys-file --current-state-as-of <dataThrough>
  --data-max-column`, no window): every row of those keys up to the cutoff, not only the window's rows.

Datasets whose language definition declares no required fields (a log or a rejects dataset
where several rows may share a value) have no unique key. `compare_datasets.py check` then skips
the duplicate-key check, and a profile `unique-key` invariant without a key is `NOT_APPLICABLE`.
Rejects are compared as a set: every PROD failure must appear among the DEV rejects.
- `none`: no PROD actual exists; state it and compare schema, row counts and reject reasons
  only.

`--allow-column COLUMN=REASON` excludes a column from value comparison and records the reason;
use it only for a documented owner exception, never to make a failing comparison pass.

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

Keep the evidence package outside the repositories, in a private run directory
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
