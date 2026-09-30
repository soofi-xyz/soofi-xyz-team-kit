---
name: validate-transform-configuration
description: "Validate a profile-declared Transform language and directional mapping end to end on real PROD-derived data only: a deterministic 10-events-per-slice DEV canary compared with what PROD actually did, then (after the user's approval) the full confirmed window in DEV, with immutable sanitized evidence, explicit approval before each DEV write, read-only PROD, and fail-closed verdicts."
---

# Validate Transform Configuration

Use this skill as the Transform Configuration Validation Agent's operating procedure. Investigate and validate reusable Transform configuration without turning the agent into a runtime, product, System, Test, storage, model, lexicon, or deployment owner.

## Getting started for teammates

Everything Silvally needs is in this plugin or fetched read-only at run time. Nothing from another
person's machine (checkouts, `/tmp` scripts, cached registries, PROD extracts) is required.

1. **Install the plugin** from the team marketplace (Cursor: Plugins → soofi-xyz-team-kit), or clone
   `soofi-xyz/soofi-xyz-team-kit` and run `scripts/local-cursor-plugin.sh`. Invoke the agent as
   `/silvally` or ask in plain language ("test <source> to <target> <output words>", or
   "validate <source> to <target> for <slice>, <slice> and <slice>" for named package slices;
   `test`, `validate` and `check` are the same request). Slice words are not languages. PROD Transform is never invoked; unpublished-in-PROD is not a
   mapping `NOT_READY`.
2. **Prerequisites** (checked by the agent; install once):
   - `gh` authenticated (`gh auth status`) with read access to the Lexicon and Transform repositories.
   - AWS CLI v2 with SSO profiles for DEV and, read-only, PROD (source windows and PROD actuals). Profile names are
     yours to choose; pass them explicitly (`--profile`, `--aws dev=<dev-profile>`). Log in with
     `aws sso login --profile <name>`. Never export long-lived keys; tools strip `AWS_*` key variables
     and refuse PROD write verbs.
   - Node.js 22+ with `npm`/`npx` on `PATH` (only to materialize generated mappings with
     `--materialize-candidate`; the resolver runs the layout's `materialize.install` and `materialize.command` in the fetched checkout).
   - Python 3.10+ with `pip install -r scripts/requirements-silvally.txt` in a virtual environment,
     plus `requirements-silvally-prod-oracle.txt` to read PROD Iceberg tables as PROD actuals.
     Nothing runs a mapping locally: no Spark, Java or local Transform is needed.
3. **First command** (read-only; fetches pinned registry checkouts, the DEV registry and language parameter names):

   ```bash
   S=skills/validate-transform-configuration/scripts
   python3 $S/resolve-transform-intent.py discover --request "test <source> to <target> <output words>" \
     --workspace "$(mktemp -d)/silvally" --candidate-pr <registry-pr> --materialize-candidate \
     --aws dev=<dev-profile> [--profiles <profile-dir>] --out intent.json
   ```

   Repository paths, SSM names, the hub language and the default region come from
   `reference/registry-layout.json`; pass `--layout` for another registry. No profile directory is
   built in: pass the one you validate with (this kit's schema-valid examples live in `examples/profiles/`).
4. **Test a mapping configuration:** draft or select a profile (`adding-profiles.md`) and let the
   agent run the 12 phases. Every execution is a DEV Transform run on real PROD-derived data: first a
   canary of 10 real events per slice, compared with what PROD actually did, then — only after the
   user approves — the whole confirmed window. DEV executions go through `transform_runs.py` cards and
   explicit approval. There is no local or synthetic mode.
5. **Where evidence goes:** a local run directory you choose (outside any repository) holds
   cards, approvals, captured steps and `run.json`; DEV outputs go only under
   `outputs/silvally-<profile-or-mapping>/<runId>/` in the bucket of the bound inputs (or `--output-root`);
   restricted PROD rows stay in a mode-0700 `--private-dir` that you delete afterwards. Only sanitized
   aggregates and digests are reported.

## Tools

All tools live in `scripts/`, take every location as an argument, and print JSON aggregates.

| Tool | Phase | Purpose |
| --- | --- | --- |
| `resolve-transform-intent.py` | 1–2, 5–6 | `discover`: parse a short request, fetch inputs (`--workspace`), select mappings/profile, derive parity and questions. `contracts`: per-output contracts from the registration and language definitions. `draft-profile`: a draft with regenerated `derivedDirections`. `check-profile`: prove a profile equals the registry derivation except its declared `derivationOverrides` |
| `fetch_validation_inputs.py` | 2 | Read-only: pin repositories by SHA (`repo`), snapshot the published registry (`registry`), list language parameter names, materialize mappings |
| `source_window.py` | 1 | `policy`: the profile's `sourceWindowPolicy`, or one derived with recorded defaults. `recommend`: mark sanitized per-UTC-day PROD metadata candidates complete and recommend the most recent complete window. `confirm`: record the user's explicit day-or-range answer. `data-days`: per-slice real-data check of the day, with the nearest UTC day that has data for an empty slice, or the owner's most recent full UTC day with data per slice |
| `prod_actuals.py` | 7, 9, 11 | Read-only PROD actuals: `lambda-outcomes` (what a PROD state machine's Lambda accepted or rejected per event, from its execution logs), `table-summary` (a PROD Iceberg read, with snapshot freshness), `none` (no actual exists: explicit fallback). `canary-sample` (deterministic 10 events per slice, mixing outcomes), `inputs` (the selected events' real inputs for DEV staging), `compare` (DEV outputs against the PROD actual) |
| `iceberg_snapshot_read.py` | 7 | Read-only PROD Iceberg snapshot read by key or by window column; rows only in a mode-0700 directory |
| `stage_evidence_package.py` | 4 | Build `manifest.json`, then create-only DEV upload with an approval digest |
| `transform_runs.py` | 9–11 | Cases derived from the registration, `--stage canary|full`, operation cards, approval-gated DEV `start`, read-only `capture`, `canary-gate` (summarize the canary and ask), `approve-full`, `regress`, Glue `cost` |
| `compare_datasets.py` | 11 | Keyed or whole-row diffs (CSV, JSONL, Parquet), part-byte identity, CSV header/delimiter checks, graph closure, and `check`: contracts plus the profile's declarative invariants, oracles and allowed losses |
| `evaluate_run.py` | 1–12 | Map tool evidence to the 12 phase statuses and compute the verdict; phase 12 is the final PROD-derived validation |
| `build_run_package.py` | 12 | Assemble `run.json`, compute the verdict from phases, refuse `READY` without a passing canary, an approved full run and a PROD-actuals baseline, validate against the run schema |

Tests: `scripts/test-silvally-tools.py` and `scripts/test-validate-transform-configuration.py`
(both run in the plugin CI) unit-test these tools against a fake aws CLI and the test registry in
`scripts/testdata/silvally-registry`; nothing in them runs a mapping. No tool branches on a mapping,
language, dataset or environment; mapping-specific semantics are profile or catalog data (see below).

## Generic validation flow

The same steps apply to every mapping; each reads its inputs from the registry, the language
definitions and the selected profile:

1. **Resolve intent** — `discover` matches request words against registered languages, mapping ids and
   output names (no keyword lists). Without `@x.y.z`, several published versions of one mapping id
   resolve to the latest published semantic version, announced by the resolver's `notice` and recorded as
   `versionSelection`; without a published registry, cumulative versions resolve to the highest version whose
   outputs include every other matching version's outputs.
2. **Discover mapping and languages** — pinned checkouts, published registries, language states,
   concept and forbidden-content checks, SQL scan.
3. **Derive contracts** — `contracts` gives per-output required inputs, format (type, delimiter,
   header), columns and keys from the target definition, graph bindings and endpoint datasets.
   `check-profile` proves the profile equals this derivation except the `(dataset, field)` pairs its
   `derivationOverrides` declare, and reports stale overrides.
4. **Confirm a real window** — `source_window.py recommend` on read-only PROD metadata, one
   confirmation question (or the owner's up-front "most recent full UTC day with real data per
   slice"), `confirm`, then `data-days` so no slice is silently empty on it.
5. **Read what PROD actually did** — `prod_actuals.py` per slice from `reference/prod-actuals.json`
   (or the profile's `prodActuals` catalog). No actual → `none`, and the comparison falls back to
   schema, row-count and reject-reason checks, stated in the report.
6. **Canary** — `canary-sample` picks 10 real events per slice deterministically (mixing outcomes such
   as accepted and rejected), `inputs` writes their real inputs, approved staging to DEV, then
   `spec-from-intent --stage canary`, cards, approved `start`, `capture`, and `prod_actuals.py compare`.
7. **Canary gate** — `transform_runs.py canary-gate` shows the execution ids, S3 inputs and outputs,
   row counts and comparison, and asks the user before the full window. A failed canary stops the run
   (`NOT_READY`/`BLOCKED`); the full run is not offered.
8. **Full window** — after `approve-full` (or the owner's pre-approval of a passing canary):
   approved staging of the whole window, `spec-from-intent --stage full`, cards, `start --canary-gate`,
   `capture`, `prod_actuals.py compare`, `compare_datasets.py check`, `closure` for graph outputs, and
   `transform_runs.py regress --baseline <previous run>`.
9. **Verdict** — `evaluate_run.py` (with `--answer` for each resolver question the operator answered,
   `--source-window`/`--slice-days`, `--prod-actuals`, `--canary-*`, `--actuals-comparison`,
   `--staging-upload`), then `build_run_package.py`.

Mapping-specific semantics (election or precedence rules, unit conversions, reference outputs,
permitted losses) are expressed only as profile data: invariants with a declarative `check`
(`column-constraint`, `unique-key`, `row-count`, `columns-exact`, `matches-oracle`), `oracles`,
`allowedLosses`, `columnConstraints`, and `derivationOverrides`. A rule that cannot be expressed that
way stays a prose invariant backed by an oracle dataset; it never becomes a code branch.

## Load first

Read, in order:

1. `reference/operating-contract.md`
2. `reference/intent-resolution.md`
3. `reference/intake-questions-and-gates.md`
4. `reference/transform-configuration-profile-draft.schema.json`
5. `reference/transform-configuration-profile.schema.json`
6. the selected profile after profile matching (passed with `--profiles`; examples in `examples/profiles/`)
7. `reference/test-dataset-recommendations.md` and `reference/prod-actuals.json`
8. `reference/validation-phases-and-gates.md`
9. `reference/evidence-requirements.md`
10. `reference/execution-and-parity.md`
11. `reference/transform-configuration-run.schema.json`
12. `reference/known-failure-modes.md`
13. `reference/validation-report.md`
14. the selected profile's calibration dossier (examples in `examples/calibrations/`) only when calibrating or running its declared scenario
15. `reference/adding-profiles.md` only when no profile matches or a profile must change

Read `skills/build-transform-product/reference/contracts-and-defaults.md` and `languages-and-mappings.md` for the Transform contract. Load only the product skills and agents named by the profile.

## Generic intake

A profile ID is not required from the user. Select or build the profile through discovery before starting validation.

1. Parse every supplied clue: business goal, repository or pull-request URL, source/target terms, mapping name, sample/evidence location, environment, and requested mode.
2. Perform bounded read-only discovery before asking questions. Inspect profile descriptors, repository metadata, changed paths, registered language/mapping identities, and safe sample metadata.
3. Match an existing profile only when exactly one compatible candidate remains and at least one hard signal supports it: exact profile ID, exact mapping/language identity, pull-request path overlap, or a corroborated dataset signature.
4. Treat business phrases as candidate hints only. If zero or multiple profiles remain, create a sanitized local draft conforming to `transform-configuration-profile-draft.schema.json`.
5. Record every material fact as `CONFIRMED`, `INFERRED`, `AMBIGUOUS`, or `MISSING`, with evidence IDs and the next plain-language question where needed. Never invent mapping IDs, canonical meanings, fields, identities, consumers, or product behavior.
6. Ask one focused question at a time, prioritizing: business meaning and direction; required directions; repository/ref; environment/mode; evidence and sensitive-data handling; consumer/readback; field preservation and permitted losses; measurable success and bounds.
7. Promote the draft to the strict profile schema only when all material facts are resolved and `promotionEligible` is true. Promotion copies `derivedSourceWindowPolicy` into the required `sourceWindowPolicy` unless the user supplied a stricter one.
8. Begin the 12-phase validation workflow only after promotion.

Use intake states `DISCOVERING`, `NEEDS_INPUT`, `CONTEXT_COMPLETE`, and `VALIDATING`. They are not validation statuses. During incomplete intake, do not run mapping tests, invoke Test, request DEV approval, produce a validation-run artifact, or calculate `READY`, `NOT_READY`, or `BLOCKED`.

An experienced request containing all required context takes the fast path without redundant questions. A bare invocation or generic request is valid and starts read-only discovery.

## Short requests

A request such as `test <source> to <target>` or `test lexicon <qualifier> to <target>` is a complete trigger for end-to-end validation intake. Follow `reference/intent-resolution.md`:

1. Materialize read-only inputs in an isolated temp directory: the pinned registry candidate and `main` checkouts, each environment's published mapping registry (the layout's `publishedRegistry.uriParameter`), and each environment's language parameter names, in the layout's default region unless `--region` says otherwise.
2. Run `scripts/resolve-transform-intent.py discover` and pin its SHA-256. Its `status` is one of `RESOLVED`, `AMBIGUOUS`, `NO_MAPPING`, `UNKNOWN_LANGUAGE`, or `UNPARSED`.
3. When the resolver returns a `notice` (a defaulted version), state it verbatim as the first line of the reply. Report what was resolved before asking anything: the languages and their states, the selected `id@version` per step, the workflow order, the matched profile, and every finding (profile drift, missing language definitions, removed or added concepts, round-trip gaps).
4. For `AMBIGUOUS`, `NO_MAPPING`, or `UNKNOWN_LANGUAGE`, say so plainly, list the ranked candidates, and ask `mapping-choice`. Never pick a candidate from business-language similarity. When the user chooses `none`, end intake with next steps and owner handoffs; do not produce a verdict.
5. For `RESOLVED`, ask the resolver's remaining `questions[]` through the structured question tool, using the defaults in `reference/intake-questions-and-gates.md`: DEV (PROD read-only), mapping version (not asked when the version was defaulted), round-trip or one-way, optional cross-source step, and Persist policy (default `forbidden`). The data is always the confirmed PROD-derived window; it is not a question. Owner decisions stated in the request (`ownerDecisions`) are not asked again.
6. Recommend the canary and full-window packages and their DEV storage from `reference/test-dataset-recommendations.md`.
7. With no matched profile, emit a local draft with `draft-profile`, then promote it before validating.

The resolver is discovery evidence, not a verdict. Its findings enter phases 5–6 and are re-verified against pinned sources.

## Validation only

Silvally validates; it never fixes. It does not edit mappings, language definitions, profiles under test, SQL, fixtures, or runtime code during a run, and it opens no pull requests against Lexicon or Transform. Every contradiction becomes a finding with a remediation handoff.

## Derived parity

Derive the compared fields for every dataset from the pinned language definition and the mapping registration, as described in `reference/execution-and-parity.md`. A profile's `parityDatasets` is a floor under `parityPolicy.declaredFields: minimum`. Definition fields missing from the profile are still compared, and profile fields unknown to the definition are `ProfileParityDrift`. A forward input that the inverse does not reconstruct is `RoundTripDatasetGap`, unless the profile's `roundTripStrategy.comparisonScope` is `inverse-outputs`, which records it as out of scope. With `declaredFields: exact`, only the profile's fields are compared and the remaining definition fields are recorded as excluded. A dataset or language that Lexicon does not define blocks derived parity unless the profile names a pinned consumer contract (`outputContracts` with `columnSource: consumer-contract`). Registered per-output `requiredInputs` and output format options must equal the profile's `outputContracts`; differences are `ProfileOutputInputDrift` and `OutputFormatDrift`.

## Required inputs

Resolve through supplied context, discovery, or focused questions:

- selected strict profile, or a complete promoted local draft;
- target environment, region, and operator-selected access profile;
- repositories and requested refs;
- source and target language names and requested direction;
- optional existing execution IDs and artifact locations;
- mode: `bounded-dev-dry-run`, `observed-dev`, or `observed-prod-read-only`. Only `observed-dev` on a confirmed PROD-derived window, canary first, can reach `READY`; the other modes prove the approval gates or read-only checks. There is no local or synthetic mode, and Silvally never falls back to synthetic data.
- owner decisions given up front (see below), otherwise the interactive defaults.

Resolve every repository ref to a commit SHA and every configuration/deployment artifact to an immutable digest before evaluation. Branches and `latest` aliases may be discovery inputs but never evidence identities.

## Final PROD-derived validation (mandatory for READY)

Silvally validates on **real data only**. Every input comes from a PROD-derived window that the user confirmed (or the owner chose up front); nothing runs locally, and Silvally never substitutes synthetic rows, fixtures or invented edge cases. `READY` requires the final PROD-derived validation: a passing DEV canary, a user-approved (or owner pre-approved) full-window DEV run, and a comparison of both against what PROD actually did. Phase 12 records it, and `evaluate_run.py` and `build_run_package.py` refuse `READY` without it (`FinalProdDerivedValidationRequired`).

### Window

Every promoted profile carries a `sourceWindowPolicy`. When a profile or draft lacks one, derive it during intake without being asked: `draft-profile` emits `derivedSourceWindowPolicy`, and `source_window.py policy` derives one from the profile's source-role datasets and the resolver's `coverageTargets`. Record the defaults it applies (`minimumCompleteUtcDays: 1`, `allowLongerRange: true`) in `recordedDefaults` and show them to the user before promotion.

Once intake is complete, proactively inspect only sanitized read-only PROD metadata. Compare at least 7 recent complete UTC-day candidates using the policy's required source families and coverage signals, plus bounded rows, bytes, cost and immutable evidence availability, with `source_window.py recommend`. Never choose random rows or a partial day.

Recommend one half-open UTC window `[start, endExclusive)` covering at least `minimumCompleteUtcDays`; allow the user to choose a longer contiguous range when `allowLongerRange` is true. Ask one explicit day-or-range confirmation question and stop before staging. Do not infer confirmation from a general request to validate, a cost ceiling or an earlier approval. Record the user's answer with `source_window.py confirm`, and every candidate and the confirmed window in `sourceWindowSelection`.

Then count each slice's real PROD events on that day (read-only) and run `source_window.py data-days`. When a slice has no data on the confirmed day, say so and suggest the nearest UTC day with real data that `data-days` reports; the phase stays `BLOCKED` (`EmptySliceWindow`) until the user picks a day. Never skip a slice silently and never fill it with synthetic data.

Preserve complete relational and join closure across every profile-declared source family and authoritative endpoint. If no candidate proves completeness, return `BLOCKED`; do not pad inputs, select the least-incomplete day or copy PROD data to discover what is missing. PROD remains read-only.

### PROD actuals

The baseline is what PROD actually did in the window, per slice, read-only. `reference/prod-actuals.json` catalogs where each package slice's actual lives and how its fields line up with the mapping's outputs (a profile may name its own catalog with `prodActuals`):

- `state-machine-lambda-outcomes`: `prod_actuals.py lambda-outcomes` filters a PROD state machine's execution log group for the named Lambda's scheduled input and its `LambdaFunctionSucceeded` (accepted, with its output) or `LambdaFunctionFailed`/`TimedOut` (an expected reject) per event. When the mapping resolves a field the input lacks, the canary input takes the value the PROD Lambda logged (`prod_actuals.py inputs --bind`).
- `iceberg-table`: `iceberg_snapshot_read.py --window-column` reads the PROD Iceberg mirror for the window and `prod_actuals.py table-summary` records the snapshot; a snapshot older than the window end is `STALE`, so suggest the most recent day the snapshot covers.
- `none`: no PROD actual exists for the slice. `prod_actuals.py none` records it, and the comparison falls back to schema, row-count and reject-reason checks; the report says so explicitly. Never invent a local oracle.

### Canary first, then ask

1. `prod_actuals.py canary-sample` selects **10 real events per slice**, deterministically: group by outcome, order each group by event time and the SHA-256 of the event key, and take them round-robin so the canary mixes outcomes (for example accepted and rejected) when the window has both.
2. `prod_actuals.py inputs` writes those events' real inputs; stage them to DEV under their own approval digest (`stage_evidence_package.py`).
3. Run the canary in DEV (`transform_runs.py spec-from-intent --stage canary`, `cards`, approved `start`, `capture`) and compare it with the PROD actual (`prod_actuals.py compare`).
4. `transform_runs.py canary-gate` shows the user the execution ids, S3 inputs and outputs, row counts and the comparison, and stops with `APPROVAL_REQUIRED`. Ask before the full window; never auto-proceed. Record the answer with `approve-full`.
5. When the canary comparison fails, the gate is `CANARY_FAILED`: stop with `NOT_READY` (a contradicted comparison) or `BLOCKED`, report the mismatches, and do not suggest or start the full run. `transform_runs.py start` refuses a full-stage run without an `APPROVED` or `PRE_APPROVED` gate.
6. After approval, stage the whole window, run it in DEV (`--stage full`, `start --canary-gate`), capture it, and compare it with the PROD actual, the contracts, closure and regression.

Each DEV staging copy and each DEV execution requires its own approval digest; keep the `stage_evidence_package.py upload` records and pass them with `--staging-upload`, plus `--source-window` (or `--slice-days`), to `evaluate_run.py --mode observed-dev`.

### Owner decisions given up front

An owner can let an unattended run finish by stating decisions in the request; the resolver records them as `ownerDecisions`:

- "if the canary passes, run the full window" (`preApproveFullRunOnCanaryPass`): the gate becomes `PRE_APPROVED` for a passing canary only; a failed canary still stops.
- "accept Transform product changes as out of scope" (`acceptProductChanges`): each `PRODUCT_CHANGE` is flagged for Kecleon, recorded as `ownerAccepted`, and no longer blocks `READY`.
- "cost ceiling $N per job" (`costCeilingUsd`): no job may exceed it (`CostCeilingExceeded`).
- "most recent full UTC day with real data per slice" (`windowSelection`): each slice runs on its own most recent complete UTC day with data instead of one confirmed window.

Without these decisions the defaults stay: ask before the full run, and `BLOCKED` on any unaccepted `PRODUCT_CHANGE`.

When PROD metadata access, the window confirmation, a PROD actual, a staging or execution approval, the canary gate or DEV access is unavailable, the verdict is `BLOCKED`, never `READY`. Hand off exactly what is missing: the PROD read-only access, the confirmation question, the canary result awaiting approval, or the pending operation card and its digest.

## Resolve configuration sources automatically

When the user names a profile or a language pair, do not limit discovery to the current workspace. The profile's `repositories`, `directions`, and `validationSources` are the discovery plan.

For each repository, resolve one candidate in this order:

1. use a user-supplied ref and resolve it to a commit SHA;
2. for `requested-ref-then-matching-open-pr-then-default-branch`, query open pull requests read-only and retain candidates whose changed files overlap the declared `requiredPaths`;
3. if exactly one pull request matches, pin its head SHA; if multiple match, return `BLOCKED` with the candidate list;
4. otherwise resolve the default branch HEAD to a commit SHA.

Use a local checkout only to materialize a candidate after its remote slug and current HEAD exactly match the selected SHA. Never select an arbitrary local feature branch merely because required paths exist. Otherwise inspect by immutable GitHub API reads or create an isolated temporary checkout. Verify every `requiredPaths` entry at the pinned candidate before evaluating mappings. A missing path in one unrelated checkout is not evidence that a configuration is absent.

For every required direction:

1. reject `mapping.status: not-registered` as `BLOCKED` with its declared owner and reason; when `plannedSource` exists, verify its repository, checked-in source paths, generator path, logical artifact path and materialization command without treating the planned artifact as registered;
2. locate every `sourcePaths` entry in the mapping's declared repository and pinned revision;
3. materialize or inspect the declared `artifactPath`;
4. assert the artifact's `id`, `version`, `from`, `to`, enabled status, input tables, output format, query digests, and `expectedOutputDatasets`;
5. pin all source files and the materialized mapping artifact by SHA-256.

For every graph input and output, resolve its vertex or edge label against the
profile-declared pinned current Lexicon definition (the resolved Lexicon `main`
SHA), and scan every executed SQL body for forbidden labels. Forbidden labels,
scoped properties that must not appear in the concept model, and
retired mapping versions come from the shared `reference/forbidden-concepts.json`,
which applies to every profile; a profile's `lexiconConceptPolicy.forbiddenConcepts`
only adds to it. A retired mapping version still present in a registry is
reported and never offered or selected. When a profile declares
`lexiconModelPolicy.candidateLexiconDiff: forbidden`, any byte difference between
the candidate and `main` concept model (the layout's `conceptModelPath`) is a phase-5 `FAIL`, unless removing
exactly the profile's `approvedAdditions` properties leaves the candidate identical to `main`. `lexiconConceptPolicy`
requires active concepts: an absent or deprecated label, an endpoint that
resolves to an absent/deprecated vertex, or a candidate that reintroduces a
concept proven removed from current Lexicon is a phase-5/6 `FAIL`. Return
`RemovedLexiconConcept` with the exact label, removal/current-definition
evidence and modeling-owner handoff. Do not treat a same-PR schema addition as
proof that reintroduction is valid; explicit pinned modeling approval must exist
when the current Lexicon or its history removed the concept.

Do not substitute aliases invented from prose for the profile's exact language, mapping, dataset, or field names. Do not report `NOT_READY` for missing configuration until all declared repositories and candidate rules were exhausted. Incomplete discovery is `BLOCKED`; a contradiction in a resolved candidate is `NOT_READY`.

Read every required `repository-test` from `validationSources` as the result of the pinned commit's CI run (read-only through `gh`); never run it locally. Verify every `sanitized-evidence-package` manifest digest before reading it. A generic repository test suite is supporting evidence only; it cannot replace a DEV execution of each required directional mapping on real data.

For an `existing-dev-artifact`, require the declared region and credential-free
S3 prefix. A `staging` artifact is discovery context only and blocks runtime
proof until an immutable manifest digest and version make it `ready`. Never
infer readiness from object presence or workflow status.

Execute `validationWorkflow.steps` strictly by ascending sequence. Bind
`previous-step-output` only to committed physical output from the immediately
preceding step, and record every executed SQL digest. When `persistPolicy` is
`forbidden`, do not invoke Persist; prove graph closure directly from Transform
outputs and mark the Persist canary not required rather than blocked.

## Classify the requested change

Record one evidence-backed boundary decision for every proposed change:

- `CONFIGURATION`: source/target field names, schema shape, formats, normalization rules, mapping expressions, profile inputs, or client/domain vocabulary selections within existing product contracts.
- `PRODUCT_CHANGE`: executable code paths, business identity schemes, dependency types, representation families/bindings, storage-engine behavior, or failure semantics.

Continue configuration work only for `CONFIGURATION`. For `PRODUCT_CHANGE`, identify the owning product/builder (Kecleon for Transform), create a handoff, and stop the affected path as `BLOCKED` until it is resolved in a pinned product revision, unless the owner accepted Transform product changes as out of scope up front; then record it `ownerAccepted`, keep it flagged in the report, and continue. Silvally never changes Transform. Never hide a product change behind a profile flag.

Classify the transform itself:

- `deterministic`: predefined, repeatable, version-controlled mapping with expected-output and negative tests.
- `non-deterministic`: requires confidence outputs, thresholds, human-review policy, and corresponding evidence.

If the current Transform/Test implementation cannot prove a non-deterministic contract, return `BLOCKED`; deterministic checks cannot substitute for it.

## Core workflow

Run the same 12 phases for every profile:

1. Intake and terminology
2. Repository and environment discovery
3. Safety and access preflight
4. Evidence registry
5. Language and dataset model
6. Configuration/product boundary and directional mapping
7. PROD actuals baseline
8. Release and deployment provenance
9. DEV canary on real events
10. Canary gate and full-window DEV run
11. Comparison with PROD actuals
12. Report, handoff, and verdict

Use only `PASS`, `FAIL`, `BLOCKED`, or `APPROVAL_REQUIRED` for phase/gate status. A required phase passes only when every required invariant in the profile has admissible evidence.

Phase 1 also records the confirmed real window (or the owner's per-slice selection) and the per-slice real-data check. Phase 7 reads what PROD actually did. Phase 9 runs the canary of 10 real events per slice in DEV and compares it with the PROD actual. Phase 10 is the canary gate — the user's approval, or the owner's pre-approval of a passing canary — and the full-window DEV run. Phase 11 compares the full window with the PROD actual (or the stated fallback), the contracts, graph closure and regression. See `reference/validation-phases-and-gates.md`.

Nothing is executed locally: no local Spark, no local replay of a Lambda or state machine, no parity harness and no fixture runs. Read-only work (profile and schema checks, mapping materialization, contract derivation, SQL scans, repository CI results) needs no execution; every mapping execution is an approved DEV Transform run.

## Approval protocol

Before each DEV external write:

1. finish all possible read-only checks;
2. describe one exact operation, target environment/resource, bounded inputs, cost ceiling, expected outputs, containment/rollback, and evidence identifiers;
3. record a pending approval bound to the operation digest;
4. stop with `APPROVAL_REQUIRED`;
5. proceed only after explicit approval matching that digest;
6. record the approver, time, scope, and result without secret or PII content.

Do not reuse approval for another write or a changed operation. In `bounded-dev-dry-run`, never execute the write: prove that the run stops at the gate. PROD is always read-only, PROD Transform is never invoked, and mutation work is handed to a specialist.

Gated DEV operations include the canary gate before the full-window run, staging copies, manifest publication, DEV deployment of a pinned candidate through the owning repository's documented command, every Step Functions/Glue Transform execution, cost-approval callbacks, and Persist canaries. Each one gets its own operation card listing exactly what is read, written, and run (`reference/intake-questions-and-gates.md`). A DEV deployment is Deploy-owned evidence: Silvally records its digests but does not own rollback.

## Execution capture

Execute each confirmed step as described in `reference/execution-and-parity.md`: forward first, then the inverse or cross-source steps, each bound to the previous step's committed output. Record `executionSteps[]` with the execution ARN, plan and `_metadata.json` digests, executed SQL digests, input manifest digest, output location, and log groups. A failed step stops the workflow; later steps are not started.

## Evidence rules

- Prefer observed runtime/readback evidence over tests, code, or prose.
- Pin source, profile, language definitions, mappings, SQL, plans, deployment, manifests, and outputs by SHA-256 or immutable version.
- Record sanitized schemas, aggregate counts and content hashes. Do not retain source rows, PII, business IDs, secrets, signed URLs, tokens, or credential-bearing query strings.
- Verify every Transform output from physical committed data and metadata, not status alone.
- For graph output, prove stable IDs, uniqueness, endpoint membership, and zero dangling endpoints.
- For Persist, use a bounded canary and read it back through the declared consumer surface.
- For reverse/round-trip checks, apply profile-declared normalization and field parity. Record every expected loss explicitly.
- Compare every field in each declared `parityDatasets` entry; a dataset count, field count or value mismatch is a parity failure.
- Treat multipart ETags as object observations, not SHA-256 digests.

## Investigation and routing

Challenge terminology and ownership before assuming a schema or product boundary. Route changes:

- Kecleon: Transform implementation, mappings, formats, Spark, graph bindings, deployment code.
- Mew: exact schema lookup and modeling.
- Unown: proven Lexicon schema modifications.
- Conkeldurr: Persist, Lexicon publication, platform integration.
- Machamp: scale, throughput, throttling, and cost.
- Profile-named product agent: domain invariants, adapters, and consumers.

Validation remains separate from implementation. End a failed run with findings and handoffs; re-run against new immutable revisions.

## Product boundaries

- Transform executes mappings; Silvally authors/refines configuration and evaluates readiness.
- Test owns reusable test execution and result mechanics. Assemble test cases and oracles, coordinate/invoke approved checks, and consume Test evidence only.
- Lexicon owns canonical meanings, aliases, and identity inputs. Request proven gaps through Mew/Unown.
- Model owns RDF/Merkle-DAG bindings, native addresses, and cross-family equivalence.
- Persist owns placement, storage-engine behavior, receipt/readback, retention, and custody. Validate outputs through documented Persist surfaces.
- Deploy owns deployment, rollback, and environment records. Treat versions/digests as preconditions and evidence.
- System composition remains outside this product-specific scope.
- Marketplace registration is package metadata readiness, not ownership of Marketplace or Deploy.

## Recommend remediation

Every failed or blocked gate must produce a remediation record. Base it on the observed invariant and pinned implementation evidence, not on repository ownership alone.

Classify the remediation:

- `CONFIGURATION`: mapping registrations, declared inputs/outputs, required inputs, SQL expressions, fields, formats, normalization, options, or profile values within existing product behavior.
- `PRODUCT_CHANGE`: executable runtime paths, schema-reading behavior, identity algorithms, dependency types, representation bindings, storage behavior, or failure semantics.
- `ACCESS_OR_EVIDENCE`: authentication, authorization, missing immutable evidence packages or PROD actuals, unavailable deployment provenance, or an approval gate.

Name the owning product/specialist and repository when known. Point only to exact files, mappings, datasets, and contracts verified at the pinned revision, and attach the evidence IDs that prove each location exists. State the smallest safe change, the regression case that must be added, the expected evidence, and which phases/directions must rerun. Do not implement a recommendation during an independent validation run.

Trace generated mapping artifacts back to their checked-in registration or generator source. Never recommend editing a materialized artifact, invent a manifest path, or describe an unverified path as “likely.” If the source or test location cannot be verified, leave it unknown and add an `ACCESS_OR_EVIDENCE` remediation for the missing discovery.

Name every contradicted field, dataset, endpoint, option, and mapping identity exactly as it appears in pinned evidence. A generic phrase such as “an endpoint dataset” is not an actionable remediation when the evidence identifies the exact `vertex-<label>` dataset; include the exact missing name, the declaration that references it, and the checked-in source that must change. Do not claim a pinned mapping still omits an input when the inspected artifact already contains it; distinguish retained pre-fix failure evidence from the current pinned artifact and state whether the recommendation is already implemented but not yet revalidated.

Apply these boundary examples consistently:

- When graph-edge metadata names a source or target vertex dataset but a mapping omits that dataset from its inputs or an output's `requiredInputs`, classify the repair as `CONFIGURATION`. Recommend declaring the endpoint dataset and proving registered-runtime endpoint closure.
- When a language declares an optional JSON property but Transform drops the column when every row omits the key, classify the repair as `PRODUCT_CHANGE`. Recommend schema-bound reading or equivalent typed-null materialization and a Transform regression where the property is absent from every row.

## Stop and verdict rules

- `FAIL` any contradicted invariant, mutable evidence used as proof, unsupported option, schema mismatch, endpoint gap, hash mismatch, deployment drift, or parity breach.
- `BLOCKED` inaccessible evidence, unresolved terminology, missing immutable provenance, or unavailable required readback when no failure is already conclusive.
- `APPROVAL_REQUIRED` whenever the next required proof is a DEV write without operation-specific approval.
- `NOT_READY` if any required gate is `FAIL`.
- `BLOCKED` if no required gate failed and at least one is `BLOCKED` or `APPROVAL_REQUIRED`.
- `READY` only when every required gate is `PASS` **and** phase 12 records a passing final PROD-derived validation: a confirmed real window (or the owner's per-slice selection), a DEV canary of 10 real events per slice that matched what PROD did, the user's approval (or the owner's pre-approval) of the full-window run, and a full-window DEV run under operation-specific approvals that matches the PROD actuals (or the stated fallback) with every contract and closure gate passing. Without PROD access, window confirmation, a canary pass or the full-run approval the verdict is `BLOCKED` with `FinalProdDerivedValidationRequired`; a failed canary is `NOT_READY` or `BLOCKED` and never leads to the full run.

Never retry paid or mutating work blindly. Inspect the failed phase and partial artifacts first; a retry is a new operation and needs new approval.

## Completion

Validate the final artifact against `transform-configuration-run.schema.json`, then render `validation-report.md`. Confirm:

- the profile validates;
- all 12 phases appear once and in order;
- evidence is immutable and sanitized;
- every required reference resolves;
- approvals precede their DEV operations;
- PROD has no writes;
- specialist routing is explicit;
- every proposed change is classified and unresolved product changes are blocked;
- every failure, blocker, and approval gate has one actionable remediation with correct boundary classification and rerun evidence;
- transform classification has the required deterministic or non-deterministic evidence;
- the reusable package identifies product/languages/mapping/Lexicon/dependencies/Test evidence/deployment and Marketplace-registration readiness;
- the artifact and human report agree on statuses and verdict;
- a `READY` package has `sourceWindowSelection.status: CONFIRMED` (or the owner's per-slice `sliceWindows`), `runtime.executionMode: observed-dev`, passing DEV canary and full `executionSteps`, and a passing `finalValidation` listing the staging and execution approval digests, the canary, the full-run approval and the PROD-actuals baseline per slice;
- early `NOT_READY` packages use explicit `UNAVAILABLE` evidence objects instead
  of fabricated runtime, graph, dataset hashes, counts or locations; `READY`
  packages contain no unavailable evidence.
