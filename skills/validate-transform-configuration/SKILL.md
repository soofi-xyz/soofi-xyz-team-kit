---
name: validate-transform-configuration
description: "Validate a profile-declared Transform language and directional mapping end to end with immutable, sanitized evidence, explicit approval before each DEV write, read-only PROD checks, round-trip proof, a mandatory final DEV run on a user-confirmed PROD-derived source window, and fail-closed verdicts."
---

# Validate Transform Configuration

Use this skill as the Transform Configuration Validation Agent's operating procedure. Investigate and validate reusable Transform configuration without turning the agent into a runtime, product, System, Test, storage, model, lexicon, or deployment owner.

## Getting started for teammates

Everything Silvally needs is in this plugin or fetched read-only at run time. Nothing from another
person's machine (checkouts, `/tmp` scripts, cached registries, PROD extracts) is required.

1. **Install the plugin** from the team marketplace (Cursor: Plugins → soofi-xyz-team-kit), or clone
   `soofi-xyz/soofi-xyz-team-kit` and run `scripts/local-cursor-plugin.sh`. Invoke the agent as
   `/silvally` or ask in plain language ("test <source> to <target> <output words>").
2. **Prerequisites** (checked by the agent; install once):
   - `gh` authenticated (`gh auth status`) with read access to the Lexicon and Transform repositories.
   - AWS CLI v2 with SSO profiles for DEV and, only for read-only oracles, PROD. Profile names are
     yours to choose; pass them explicitly (`--profile`, `--aws dev=<dev-profile>`). Log in with
     `aws sso login --profile <name>`. Never export long-lived keys; tools strip `AWS_*` key variables
     and refuse PROD write verbs.
   - Node.js 22+ with `npm`/`npx` on `PATH` (only to materialize generated mappings with
     `--materialize-candidate`; the resolver runs the layout's `materialize.install` and `materialize.command` in the fetched checkout).
   - Python 3.10+ with `pip install -r scripts/requirements-silvally.txt` in a virtual environment.
     Optional: `requirements-silvally-spark.txt` (Python 3.10, Java 17, Spark 3.3 = Glue 4.0) for
     `synthetic-local` runs, and `requirements-silvally-prod-oracle.txt` for PROD Iceberg oracles.
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
4. **Test a new mapping configuration:** materialize it
   (`fetch_validation_inputs.py materialize`), run it locally on a small fixture with
   `local_mapping_run.py --negatives`, and check it with `compare_datasets.py check` against contracts
   from `resolve-transform-intent.py contracts` and an oracle written from the specification. The
   committed `fixtures/synthetic-registry/` shows the whole loop on a synthetic registry. Then draft
   or select a profile (`adding-profiles.md`) and let the agent run the 12 phases; DEV executions go
   through `transform_runs.py` cards and explicit approval.
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
| `local_mapping_run.py` | 7 | Run a materialized mapping on fixtures with local Spark (typed nulls for optional graph properties); `--negatives` proves each required input's omission is rejected |
| `compare_datasets.py` | 7, 10–11 | Keyed or whole-row diffs (CSV, JSONL, Parquet), part-byte identity, CSV header/delimiter checks, graph closure, and `check`: contracts plus the profile's declarative invariants, oracles and allowed losses |
| `graph_export_bridge.py` | 7, 11 | Neptune CSV output to Parquet graph exports (optional synthetic `created_at`), epoch-millis to ISO dates |
| `stage_evidence_package.py` | 4 | Build `manifest.json`, then create-only upload with an approval digest |
| `transform_runs.py` | 9, 11 | Cases derived from the registration, operation cards, approval-gated `start`, read-only `capture`, `regress` against a previous run, Glue `cost` |
| `iceberg_snapshot_read.py` | 11 | Read-only PROD Iceberg snapshot read for oracles; rows only in a mode-0700 directory |
| `source_window.py` | 1, 3 | `policy`: the profile's `sourceWindowPolicy`, or one derived with recorded defaults. `recommend`: mark sanitized per-UTC-day PROD metadata candidates complete and recommend the most recent complete window. `confirm`: record the user's explicit day-or-range answer |
| `evaluate_run.py` | 1–12 | Map tool evidence to the 12 phase statuses and compute the verdict; phase 12 is the final PROD-derived validation |
| `build_run_package.py` | 12 | Assemble `run.json`, compute the verdict from phases, refuse `READY` without a passing `finalValidation`, validate against the run schema |

Tests: `scripts/test-silvally-tools.py` and `scripts/test-validate-transform-configuration.py`
(both run in the plugin CI) use only the synthetic registry fixture. No tool branches on a mapping,
language, dataset or environment; mapping-specific semantics are profile data (see below).

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
4. **Recommend and stage datasets** — `reference/test-dataset-recommendations.md`; `--bind NAME=s3://prefix/`
   names each input package, and the tools list which outputs each binding can run.
5. **Approval gates** — one operation card per execution or write.
6. **Execute** — `spec-from-intent` derives a full case when one binding holds every output's inputs,
   one case per output per binding, and one rejected case per required input of every output
   (omitting exactly that input; the rejection must name it and happen before the Transform job).
7. **Parity** — `compare_datasets.py check`: format and columns from the contract, keys, the profile's
   declarative invariant checks, oracles (`part-bytes`, `sorted-rows`, `keyed`) and `allowedLosses`;
   `closure` for graph outputs.
8. **Regression** — `transform_runs.py regress --baseline <previous run>` matches cases by mapping,
   input locations and outputs, and compares row counts and content digests.
9. **Final PROD-derived validation** — `source_window.py recommend` on read-only PROD metadata, one
   confirmation question, `confirm`, approved staging of that window, then steps 5–8 again in
   `observed-dev` on the staged window. Synthetic runs stop before this step and stay `BLOCKED`.
10. **Verdict** — `evaluate_run.py` (with `--answer` for each resolver question the operator answered,
    `--source-window` and `--staging-upload`), then `build_run_package.py`.

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
7. `reference/test-dataset-recommendations.md`
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
5. For `RESOLVED`, ask the resolver's remaining `questions[]` through the structured question tool, using the defaults in `reference/intake-questions-and-gates.md`: DEV (PROD read-only), mapping version (not asked when the version was defaulted), test dataset, round-trip or one-way, optional cross-source step, and Persist policy (default `forbidden`).
6. Recommend datasets and storage from `reference/test-dataset-recommendations.md`.
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
- mode: `synthetic-local`, `bounded-dev-dry-run`, `observed-dev`, or `observed-prod-read-only`. Only `observed-dev` on a confirmed PROD-derived window can reach `READY`; the other modes are earlier phases or read-only checks.

Resolve every repository ref to a commit SHA and every configuration/deployment artifact to an immutable digest before evaluation. Branches and `latest` aliases may be discovery inputs but never evidence identities.

## Final PROD-derived validation (mandatory for READY)

Every run that aims for `READY` ends with a **final PROD-derived validation**:
the pinned mapping executes in DEV, under operation-specific approvals, against
a user-confirmed complete-UTC-day window derived read-only from PROD and staged
into DEV under its own approval digest, and passes every parity and closure
gate. `synthetic-local` and synthetic or edge-case DEV runs are earlier proof;
they never yield `READY`. Phase 12 records the final validation, and
`evaluate_run.py` and `build_run_package.py` refuse `READY` without it
(`FinalProdDerivedValidationRequired`).

Every promoted profile carries a `sourceWindowPolicy`. When a profile or draft
lacks one, derive it during intake without being asked: `draft-profile` emits
`derivedSourceWindowPolicy`, and `source_window.py policy` derives one from the
profile's source-role datasets and the resolver's `coverageTargets`. Record the
defaults it applies (`minimumCompleteUtcDays: 1`, `allowLongerRange: true`) in
`recordedDefaults` and show them to the user before promotion.

Once intake is complete, proactively inspect only sanitized read-only PROD
metadata. Compare at least 7 recent complete UTC-day candidates using the
policy's required source families and coverage signals, plus bounded rows,
bytes, cost and immutable evidence availability, with
`source_window.py recommend`. Never choose random rows or a partial day.

Recommend one half-open UTC window `[start, endExclusive)` covering at least
`minimumCompleteUtcDays`; allow the user to choose a longer contiguous range
when `allowLongerRange` is true. Ask one explicit day-or-range confirmation
question and stop before staging. Do not infer confirmation from a general
request to validate, a cost ceiling or an earlier approval. Record the user's
answer with `source_window.py confirm`, and every candidate and the confirmed
window in `sourceWindowSelection`.

Preserve complete relational and join closure across every profile-declared
source family and authoritative endpoint. If no candidate proves completeness,
return `BLOCKED`; do not pad fixtures, select the least-incomplete day or copy
PROD data to discover what is missing. PROD remains read-only. Each DEV staging
copy of the window and each DEV execution requires its own approval digest;
keep the `stage_evidence_package.py upload` record and pass it with
`--staging-upload`, plus `--source-window`, to `evaluate_run.py --mode observed-dev`.

When PROD metadata access, the window confirmation, a staging or execution
approval, or DEV access is unavailable, the verdict is `BLOCKED`, never `READY`.
Hand off exactly what is missing: the PROD read-only access or metadata, the
confirmation question, or the pending operation card and its digest.

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

Execute every required `repository-test` from `validationSources` in its pinned repository using that repository's documented package manager and runtime. Verify every `sanitized-evidence-package` manifest digest before reading bounded fixtures. A generic repository test suite is supporting evidence only; it cannot replace execution of each required directional mapping.

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

Continue configuration work only for `CONFIGURATION`. For `PRODUCT_CHANGE`, identify the owning product/builder, create a handoff, and stop the affected path as `BLOCKED` until it is resolved in a pinned product revision. Never hide a product change behind a profile flag.

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
7. Static and Spark proof
8. Release and deployment provenance
9. Transform runtime proof
10. Persist canary and graph closure
11. Export, hydration, and round-trip parity
12. Report, handoff, and verdict

Use only `PASS`, `FAIL`, `BLOCKED`, or `APPROVAL_REQUIRED` for phase/gate status. A required phase passes only when every required invariant in the profile has admissible evidence.

In `synthetic-local` mode, automatically run all read-only work available from the pinned configuration candidate: profile/schema validation, mapping materialization, repository tests, sanitized fixture validation, deployed Spark-version compatibility, each required forward mapping, every declared inverse/cross-source mapping, expected-output comparisons, and negative cases. Report the exact repository SHAs, mapping identities, fixture manifest digest, commands, counts, and mismatches. Do not stop after typecheck/lint/general unit tests when a mapping execution remains untested. A passing `synthetic-local` run is reported as `modeScopedResult: PASS` with verdict `BLOCKED` until the final PROD-derived validation passes; continue to the source-window recommendation instead of stopping.

Do not treat an absent system-wide `pyspark` or `spark-submit` binary as an immediate blocker. First inspect the pinned Transform runtime for its declared local Spark setup and test entrypoints. When present, run the bounded setup inside the isolated checkout, verify the resulting Spark major/minor version against the profile/runtime target, and use that environment for mapping-specific fixture execution. This is a local dependency setup, not a DEV write. Return `BLOCKED` only when the pinned runtime has no compatible setup path or that bounded setup fails with recorded evidence.

## Approval protocol

Before each DEV external write:

1. finish all possible read-only checks;
2. describe one exact operation, target environment/resource, bounded inputs, cost ceiling, expected outputs, containment/rollback, and evidence identifiers;
3. record a pending approval bound to the operation digest;
4. stop with `APPROVAL_REQUIRED`;
5. proceed only after explicit approval matching that digest;
6. record the approver, time, scope, and result without secret or PII content.

Do not reuse approval for another write or a changed operation. In `synthetic-local` and `bounded-dev-dry-run`, never execute the write: prove that the run stops at the gate. PROD is always read-only and always hands mutation work to a specialist.

Gated DEV operations include staging copies, manifest publication, DEV deployment of a pinned candidate through the owning repository's documented command, every Step Functions/Glue Transform execution, cost-approval callbacks, and Persist canaries. Each one gets its own operation card listing exactly what is read, written, and run (`reference/intake-questions-and-gates.md`). A DEV deployment is Deploy-owned evidence: Silvally records its digests but does not own rollback.

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
- `ACCESS_OR_EVIDENCE`: authentication, authorization, missing immutable fixtures, unavailable deployment provenance, or an approval gate.

Name the owning product/specialist and repository when known. Point only to exact files, mappings, datasets, and contracts verified at the pinned revision, and attach the evidence IDs that prove each location exists. State the smallest safe change, the regression case that must be added, the expected evidence, and which phases/directions must rerun. Do not implement a recommendation during an independent validation run.

Trace generated mapping artifacts back to their checked-in registration or generator source. Never recommend editing a materialized artifact, invent a manifest path, or describe an unverified path as “likely.” If the source or test location cannot be verified, leave it unknown and add an `ACCESS_OR_EVIDENCE` remediation for the missing discovery.

Name every contradicted field, dataset, endpoint, option, and mapping identity exactly as it appears in pinned evidence. A generic phrase such as “an endpoint dataset” is not an actionable remediation when the evidence identifies the exact `vertex-<label>` dataset; include the exact missing name, the declaration that references it, and the checked-in source that must change. Do not claim a pinned mapping still omits an input when the inspected artifact already contains it; distinguish retained pre-fix failure evidence from the current pinned artifact and state whether the recommendation is already implemented but not yet revalidated.

Apply these boundary examples consistently:

- When graph-edge metadata names a source or target vertex dataset but a mapping omits that dataset from its inputs or an output's `requiredInputs`, classify the repair as `CONFIGURATION`. Recommend declaring the endpoint dataset and proving registered-runtime endpoint closure.
- When a language declares an optional JSON property but Transform drops the column when every row omits the key, classify the repair as `PRODUCT_CHANGE`. Recommend schema-bound reading or equivalent typed-null materialization and a Spark regression where the property is absent from every row.

## Stop and verdict rules

- `FAIL` any contradicted invariant, mutable evidence used as proof, unsupported option, schema mismatch, endpoint gap, hash mismatch, deployment drift, or parity breach.
- `BLOCKED` inaccessible evidence, unresolved terminology, missing immutable provenance, or unavailable required readback when no failure is already conclusive.
- `APPROVAL_REQUIRED` whenever the next required proof is a DEV write without operation-specific approval.
- `NOT_READY` if any required gate is `FAIL`.
- `BLOCKED` if no required gate failed and at least one is `BLOCKED` or `APPROVAL_REQUIRED`.
- `READY` only when every required gate is `PASS` **and** phase 12 records a passing final PROD-derived validation: the mapping executed in DEV, under operation-specific approvals, against a user-confirmed complete-UTC-day window derived read-only from PROD and staged into DEV under its own approval digest, with every parity and closure gate passing. Synthetic-local and synthetic DEV runs never yield `READY`; without PROD metadata access, window confirmation or approval the verdict is `BLOCKED` with `FinalProdDerivedValidationRequired`.

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
- a `READY` package has `sourceWindowSelection.status: CONFIRMED`, `runtime.executionMode: observed-dev`, passing DEV `executionSteps` and a passing `finalValidation` listing the staging and execution approval digests;
- early `NOT_READY` packages use explicit `UNAVAILABLE` evidence objects instead
  of fabricated runtime, graph, dataset hashes, counts or locations; `READY`
  packages contain no unavailable evidence.
