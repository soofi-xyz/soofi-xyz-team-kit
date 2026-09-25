---
name: validate-transform-configuration
description: "Validate a profile-declared Transform language and directional mapping end to end with immutable, sanitized evidence, explicit approval before each DEV write, read-only PROD checks, round-trip proof, and fail-closed verdicts."
---

# Validate Transform Configuration

Use this skill as the Transform Configuration Validation Agent's operating procedure. Investigate and validate reusable Transform configuration without turning the agent into a runtime, product, System, Test, storage, model, lexicon, or deployment owner.

## Load first

Read, in order:

1. `reference/operating-contract.md`
2. `reference/transform-configuration-profile-draft.schema.json`
3. `reference/transform-configuration-profile.schema.json`
4. the selected document in `reference/profiles/` after profile matching
5. `reference/validation-phases-and-gates.md`
6. `reference/evidence-requirements.md`
7. `reference/transform-configuration-run.schema.json`
8. `reference/known-failure-modes.md`
9. `reference/validation-report.md`
10. the selected profile's dossier in `reference/calibrations/` only when calibrating or running its declared scenario

Read `skills/build-transform-product/reference/contracts-and-defaults.md` and `languages-and-mappings.md` for the Transform contract. Load only the product skills and agents named by the profile.

## Generic intake

A profile ID is not required from the user. Select or build the profile through discovery before starting validation.

1. Parse every supplied clue: business goal, repository or pull-request URL, source/target terms, mapping name, sample/evidence location, environment, and requested mode.
2. Perform bounded read-only discovery before asking questions. Inspect profile descriptors, repository metadata, changed paths, registered language/mapping identities, and safe sample metadata.
3. Match an existing profile only when exactly one compatible candidate remains and at least one hard signal supports it: exact profile ID, exact mapping/language identity, pull-request path overlap, or a corroborated dataset signature.
4. Treat business phrases as candidate hints only. If zero or multiple profiles remain, create a sanitized local draft conforming to `transform-configuration-profile-draft.schema.json`.
5. Record every material fact as `CONFIRMED`, `INFERRED`, `AMBIGUOUS`, or `MISSING`, with evidence IDs and the next plain-language question where needed. Never invent mapping IDs, canonical meanings, fields, identities, consumers, or product behavior.
6. Ask one focused question at a time, prioritizing: business meaning and direction; required directions; repository/ref; environment/mode; evidence and sensitive-data handling; consumer/readback; field preservation and permitted losses; measurable success and bounds.
7. Promote the draft to the strict profile schema only when all material facts are resolved and `promotionEligible` is true.
8. Begin the 12-phase validation workflow only after promotion.

Use intake states `DISCOVERING`, `NEEDS_INPUT`, `CONTEXT_COMPLETE`, and `VALIDATING`. They are not validation statuses. During incomplete intake, do not run mapping tests, invoke Test, request DEV approval, produce a validation-run artifact, or calculate `READY`, `NOT_READY`, or `BLOCKED`.

An experienced request containing all required context takes the fast path without redundant questions. A bare invocation or generic request is valid and starts read-only discovery.

## Required inputs

Resolve through supplied context, discovery, or focused questions:

- selected strict profile, or a complete promoted local draft;
- target environment, region, and operator-selected access profile;
- repositories and requested refs;
- source and target language names and requested direction;
- optional existing execution IDs and artifact locations;
- mode: `synthetic-local`, `bounded-dev-dry-run`, `observed-dev`, or `observed-prod-read-only`.

Resolve every repository ref to a commit SHA and every configuration/deployment artifact to an immutable digest before evaluation. Branches and `latest` aliases may be discovery inputs but never evidence identities.

## Confirm PROD-derived source windows

When a profile declares `sourceWindowPolicy` and validation will copy or derive
DEV evidence from PROD, inspect only sanitized read-only PROD metadata first.
Compare recent complete UTC-day candidates using the profile's required source
families and coverage signals, plus bounded rows, bytes, cost and immutable
evidence availability. Never choose random rows or a partial day.

Recommend one half-open UTC window `[start, endExclusive)` covering at least
`minimumCompleteUtcDays`; allow the user to choose a longer contiguous range
when `allowLongerRange` is true. Ask one explicit day-or-range confirmation
question and stop before staging. Do not infer confirmation from a general
request to validate, a cost ceiling or an earlier approval. Record every
candidate and the confirmed window in `sourceWindowSelection`.

Preserve complete relational and join closure across every profile-declared
source family and authoritative endpoint. If no candidate proves completeness,
return `BLOCKED`; do not pad fixtures, select the least-incomplete day or copy
PROD data to discover what is missing. PROD remains read-only and each later
DEV staging operation requires its own approval digest.

## Resolve configuration sources automatically

When the user names a profile or a language pair, do not limit discovery to the current workspace. The profile's `repositories`, `directions`, and `validationSources` are the discovery plan.

For each repository, resolve one candidate in this order:

1. use a user-supplied ref and resolve it to a commit SHA;
2. for `requested-ref-then-matching-open-pr-then-default-branch`, query open pull requests read-only and retain candidates whose changed files overlap the declared `requiredPaths`;
3. if exactly one pull request matches, pin its head SHA; if multiple match, return `BLOCKED` with the candidate list;
4. otherwise resolve the default branch HEAD to a commit SHA.

Use a local checkout only to materialize a candidate after its remote slug and current HEAD exactly match the selected SHA. Never select an arbitrary local feature branch merely because required paths exist. Otherwise inspect by immutable GitHub API reads or create an isolated temporary checkout. Verify every `requiredPaths` entry at the pinned candidate before evaluating mappings. A missing path in one unrelated checkout is not evidence that a configuration is absent.

For every required direction:

1. reject `mapping.status: not-registered` as `BLOCKED` with its declared owner and reason;
2. locate every `sourcePaths` entry in the mapping's declared repository and pinned revision;
3. materialize or inspect the declared `artifactPath`;
4. assert the artifact's `id`, `version`, `from`, `to`, enabled status, input tables, output format, query digests, and `expectedOutputDatasets`;
5. pin all source files and the materialized mapping artifact by SHA-256.

Do not substitute aliases invented from prose for the profile's exact language, mapping, dataset, or field names. Do not report `NOT_READY` for missing configuration until all declared repositories and candidate rules were exhausted. Incomplete discovery is `BLOCKED`; a contradiction in a resolved candidate is `NOT_READY`.

Execute every required `repository-test` from `validationSources` in its pinned repository using that repository's documented package manager and runtime. Verify every `sanitized-evidence-package` manifest digest before reading bounded fixtures. A generic repository test suite is supporting evidence only; it cannot replace execution of each required directional mapping.

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

In `synthetic-local` mode, automatically run all read-only work available from the pinned configuration candidate: profile/schema validation, mapping materialization, repository tests, sanitized fixture validation, deployed Spark-version compatibility, each required forward mapping, every declared inverse/cross-source mapping, expected-output comparisons, and negative cases. Report the exact repository SHAs, mapping identities, fixture manifest digest, commands, counts, and mismatches. Do not stop after typecheck/lint/general unit tests when a mapping execution remains untested.

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

## Evidence rules

- Prefer observed runtime/readback evidence over tests, code, or prose.
- Pin source, profile, language definitions, mappings, SQL, plans, deployment, manifests, and outputs by SHA-256 or immutable version.
- Record sanitized schemas, aggregate counts and content hashes. Do not retain source rows, PII, business IDs, secrets, signed URLs, tokens, or credential-bearing query strings.
- Verify every Transform output from physical committed data and metadata, not status alone.
- For graph output, prove stable IDs, uniqueness, endpoint membership, and zero dangling endpoints.
- For Persist, use a bounded canary and read it back through the declared consumer surface.
- For reverse/round-trip checks, apply profile-declared normalization and field parity. Record every expected loss explicitly.
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

Name every contradicted field, dataset, endpoint, option, and mapping identity exactly as it appears in pinned evidence. A generic phrase such as “an endpoint dataset” is not an actionable remediation when the evidence identifies `vertex-rule-execution`; include the exact missing name, the declaration that references it, and the checked-in source that must change. Do not claim a pinned mapping still omits an input when the inspected artifact already contains it; distinguish retained pre-fix failure evidence from the current pinned artifact and state whether the recommendation is already implemented but not yet revalidated.

Apply these boundary examples consistently:

- When graph-edge metadata names a source or target vertex dataset but a mapping omits that dataset from its inputs or an output's `requiredInputs`, classify the repair as `CONFIGURATION`. Recommend declaring the endpoint dataset and proving registered-runtime endpoint closure.
- When a language declares an optional JSON property but Transform drops the column when every row omits the key, classify the repair as `PRODUCT_CHANGE`. Recommend schema-bound reading or equivalent typed-null materialization and a Spark regression where the property is absent from every row.

## Stop and verdict rules

- `FAIL` any contradicted invariant, mutable evidence used as proof, unsupported option, schema mismatch, endpoint gap, hash mismatch, deployment drift, or parity breach.
- `BLOCKED` inaccessible evidence, unresolved terminology, missing immutable provenance, or unavailable required readback when no failure is already conclusive.
- `APPROVAL_REQUIRED` whenever the next required proof is a DEV write without operation-specific approval.
- `NOT_READY` if any required gate is `FAIL`.
- `BLOCKED` if no required gate failed and at least one is `BLOCKED` or `APPROVAL_REQUIRED`.
- `READY` only when all required gates are `PASS`.

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
- the artifact and human report agree on statuses and verdict.
