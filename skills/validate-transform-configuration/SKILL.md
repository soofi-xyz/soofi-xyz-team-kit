---
name: validate-transform-configuration
description: "Validate a profile-declared Transform language and directional mapping end to end with immutable, sanitized evidence, explicit approval before each DEV write, read-only PROD checks, round-trip proof, and fail-closed verdicts."
---

# Validate Transform Configuration

Use this skill as the Transform Configuration Agent's operating procedure for Operational Architects. Configure and validate a reusable Transform product. Do not turn the agent into a runtime, product, System, Test, storage, model, lexicon, or deployment owner.

## Load first

Read, in order:

1. `reference/operating-contract.md`
2. `reference/transform-configuration-profile.schema.json`
3. the selected document in `reference/profiles/`
4. `reference/validation-phases-and-gates.md`
5. `reference/evidence-requirements.md`
6. `reference/transform-configuration-run.schema.json`
7. `reference/known-failure-modes.md`
8. `reference/validation-report.md`
9. the selected profile's dossier in `reference/calibrations/` only when calibrating or running its declared scenario

Read `skills/build-transform-product/reference/contracts-and-defaults.md` and `languages-and-mappings.md` for the Transform contract. Load only the product skills and agents named by the profile.

## Required inputs

Collect:

- profile path or ID;
- target environment, region, and operator-selected access profile;
- repositories and requested refs;
- source and target language names and requested direction;
- optional existing execution IDs and artifact locations;
- mode: `validation`, `synthetic-local`, or `bounded-dev-dry-run`.

Resolve every repository ref to a commit SHA and every configuration/deployment artifact to an immutable digest before evaluation. Branches and `latest` aliases may be discovery inputs but never evidence identities.

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
- transform classification has the required deterministic or non-deterministic evidence;
- the reusable package identifies product/languages/mapping/Lexicon/dependencies/Test evidence/deployment and Marketplace-registration readiness;
- the artifact and human report agree on statuses and verdict.
