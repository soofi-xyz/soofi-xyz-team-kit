# Validation phases and gates

Run every profile through these phases in order. Use only `PASS`, `FAIL`, `BLOCKED`, and `APPROVAL_REQUIRED`.

1. **Intake, terminology, and boundary** — resolve aliases, intent, direction, environment, datasets, adapters and consumers; classify every proposal as `CONFIGURATION` or `PRODUCT_CHANGE`. Gate: no ambiguous term remains and every unresolved product change has a named handoff and blocks the affected path.
2. **Repository and environment discovery** — pin repositories and discover configured account, region and resources. Gate: every source ref is a commit SHA and discovery is read-only.
3. **Safety and access preflight** — classify sensitivity, verify permissions without reading secrets, set cost/scan bounds and environment write policy. Gate: no prohibited access or unbounded operation is required.
4. **Evidence registry** — assign stable evidence IDs and observation times. Gate: every planned claim has an admissible, sanitized evidence source.
5. **Language and dataset model** — validate language definitions, required/optional fields, types and dataset roles. Gate: the Lexicon definitions are immutable and compatible; omitted optional JSON fields materialize as null.
6. **Configuration and directional mapping** — resolve exactly one enabled mapping and validate fields, schema shape, formats, normalization, expressions, options, SQL digests and graph bindings. Gate: no unsupported option, implicit inverse, ambiguity, undeclared schema, or product-boundary concern disguised as configuration exists.
7. **Test coordination and Spark proof** — assemble expected-output/negative cases and oracles, then consume evidence from the Test-owned reusable runtime using the deployed major/minor compatibility target. Non-deterministic profiles additionally require confidence, thresholds and human-review evidence. Gate: required Test evidence passes without Silvally claiming Test ownership.
8. **Release and deployment provenance** — verify Deploy-owned environment records and bind the active deployment to immutable source/configuration digests. Gate: no deployment drift or latest-PR-wins race remains; Silvally performs no deployment.
9. **Transform runtime proof** — verify an approved DEV or existing immutable execution, committed metadata, schemas, physical counts/hashes and cost. Gate: status, manifest and physical artifacts reconcile.
10. **Persist canary and graph closure** — when required, coordinate a bounded canary through Persist's documented surface, prove unique stable IDs and endpoint membership, then consume receipt/readback evidence. Gate: zero dangling endpoints and pinned Lexicon/Persist compatibility; placement, retention and custody remain Persist-owned.
11. **Export, hydration and round-trip parity** — verify exporter timezone/window semantics, immutable manifests, artifact hydration and declared forward/reverse parity. Gate: counts/hashes/order and required fields reconcile after normalization.
12. **Package, handoff and readiness verdict** — validate the reusable configuration/readiness package, reconcile report statuses, route product changes and compute `READY`, `NOT_READY`, or `BLOCKED`. Gate: package and report agree, contain no protected data, and state Marketplace-registration metadata without claiming Marketplace or Deploy ownership.

## Approval placement

Finish read-only work first. Immediately before each DEV external write, create an operation-specific approval record and stop at `APPROVAL_REQUIRED`. After matching explicit approval, perform only that operation. Any changed target, payload, digest, cost ceiling or retry requires a new approval.

`synthetic-local` and `bounded-dev-dry-run` never cross a DEV write gate. PROD never crosses one in any mode.
