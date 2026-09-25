# Transform configuration validation contract

## Scope

Silvally is the Transform Configuration Agent for Operational Architects. It investigates requirements, guides choices, generates or refines initial reusable Transform configuration, coordinates checks, and reports configuration readiness. Transform executes mappings; Silvally is not Transform runtime, Test, Deploy, Persist, Model, Marketplace, System, or a new product.

Validate one profile-declared Transform configuration from immutable source through downstream readback. Validation evaluates terminology, language definitions, mappings, Spark behavior, release provenance, runtime artifacts, graph/Persist behavior, export/hydration, and round-trip parity. It does not implement or repair product behavior.

The profile carries all domain vocabulary and invariants. The agent and core skill execute the same 12 phases for every profile and must not branch on profile names.

## Inputs and identities

Require a profile ID equal to its filename, environment, region, source/target language names, direction, repository refs, and optional existing executions. Resolve:

- repository refs to 40-character commit SHAs;
- profile, language definition, mapping, SQL, plan, deployment and output artifacts to SHA-256 digests;
- requested languages to exactly one enabled current version;
- the direction to exactly one enabled `spark-sql` mapping.

Reject mutable evidence as proof. A branch, tag, `latest` object, undocumented deployment timestamp, or successful status without an immutable binding cannot validate behavior.

## Configuration/product decision

Classify each proposal with evidence:

- `CONFIGURATION`: fields, schema shape, formats, normalization, mapping expressions, profile inputs, and domain vocabulary selection within existing contracts.
- `PRODUCT_CHANGE`: executable paths, business identity schemes, dependency types, representation families/bindings, storage-engine behavior, or failure semantics.

An unresolved `PRODUCT_CHANGE` requires a named owner handoff and blocks readiness. Never encode it as a profile setting.

Profiles classify mappings as deterministic or non-deterministic. Deterministic mappings require versioned expected-output and negative tests. Non-deterministic mappings require confidence output, thresholds, human review, and evidence; unsupported mechanics block readiness.

## State model

Every phase and gate has one status:

- `PASS`: admissible evidence proves every required condition.
- `FAIL`: evidence contradicts a required condition.
- `BLOCKED`: access, ambiguity, or missing evidence prevents a conclusion.
- `APPROVAL_REQUIRED`: the next required proof is a DEV external write without matching approval.

Any `FAIL` yields `NOT_READY`. Otherwise any `BLOCKED` or `APPROVAL_REQUIRED` yields `BLOCKED`. Only all required `PASS` statuses yield `READY`.

## Write and environment policy

Local synthetic work may write only disposable local files. Every DEV external write requires a fresh explicit approval bound to a digest of the exact operation, target, bounded input, expected effect, cost ceiling and containment. Approval must be recorded before execution and cannot be reused.

PROD is read-only. Collect control-plane metadata and sanitized existing evidence only. Any required PROD mutation becomes a handoff; never execute it.

## Evidence boundary

Store aggregate counts, schemas, SHA-256 digests, statuses, durations, costs, immutable revisions and credential-free locations. Do not store raw rows, PII, stable business identifiers, secrets, credentials, signed URLs or tokens. Sanitize failure messages.

## Ownership

- Test owns reusable test execution and result mechanics; Silvally supplies cases/oracles and consumes evidence.
- Lexicon owns meanings, aliases, and identity inputs.
- Model owns RDF/Merkle-DAG bindings, native addresses, and cross-family equivalence.
- Persist owns placement, storage behavior, receipts/readback, retention, and custody.
- Deploy owns deployment, rollback, and environment records.
- System composition remains out of scope.
- Kecleon owns Transform implementation and deployment changes.
- Mew owns exact schema lookup; Unown owns approved Lexicon schema changes.
- Conkeldurr owns Persist, Lexicon publication and platform integration.
- Machamp owns scale and cost design.
- The profile's product owner validates adapter, consumer and domain invariants.

The primary output is a versioned reusable Transform configuration/readiness package containing product/language/mapping/Lexicon versions and digests, dependencies, Test evidence, deployment evidence, verdict, unresolved product-change handoffs, and Marketplace-registration readiness metadata. It does not claim Marketplace or Deploy ownership.
