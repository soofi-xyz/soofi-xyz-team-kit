# Validation phases and gates

Run every promoted, schema-valid profile through these phases in order after generic intake reaches `CONTEXT_COMPLETE`. Intake is not a thirteenth phase and cannot use readiness verdicts. Use only `PASS`, `FAIL`, `BLOCKED`, and `APPROVAL_REQUIRED` during validation. Every phase works on real PROD-derived data; nothing runs locally and nothing falls back to synthetic data.

1. **Intake, terminology, boundary and real-data window** — resolve aliases, intent, direction, environment, datasets, adapters and consumers; classify every proposal as `CONFIGURATION` or `PRODUCT_CHANGE`; record owner decisions stated up front. For every profile, use (or derive with recorded defaults) its `sourceWindowPolicy`, proactively compare recent complete UTC-day PROD metadata read-only, and ask the user to confirm the recommended day or a permitted longer range — unless the owner chose "most recent full UTC day with real data per slice". Check each slice's real PROD data on the chosen day with `source_window.py data-days`. Gate: no ambiguous term remains, every unresolved product change has a named handoff, the window is `CONFIRMED` (or the owner's per-slice selection), and no slice is empty on it; an empty slice is `BLOCKED` (`EmptySliceWindow`) with the nearest UTC day that has data.
2. **Repository and environment discovery** — resolve the profile's repository plan in order: requested ref, one matching open PR when allowed, then default branch. Reuse a local checkout only when its remote and HEAD exactly match the remotely selected SHA. Pin the selected candidates and discover configured account, region and resources. Gate: every required path exists at one unambiguous commit SHA, every rejected candidate is recorded and discovery is read-only.
3. **Safety and access preflight** — classify sensitivity, verify permissions without reading secrets, set cost/scan bounds (and the owner's per-job cost ceiling, when given) and environment write policy. Confirm that the PROD-derived window covers at least the profile minimum, preserves every required source family/join and remains read-only until a separate DEV staging approval; every staging upload of the canary and of the full window carries its own approval digest. Gate: no prohibited access, partial/random sample, unbounded operation or job above the cost ceiling is required.
4. **Evidence registry** — assign stable evidence IDs and observation times. Gate: every planned claim has an admissible, sanitized evidence source; every canary and full-window input binding lies under the confirmed window's manifested DEV prefix or the run's own output root.
5. **Language and dataset model** — validate language definitions, required/optional fields, types and dataset roles. Gate: the Lexicon definitions are immutable and compatible; omitted optional JSON fields materialize as null.
6. **Configuration/product boundary and directional mapping** — resolve every required profile direction by its exact mapping ID, version, source paths and artifact path; validate languages, inputs, expected outputs, fields, schema shape, formats, normalization, expressions, options, SQL digests and graph bindings; read required repository tests as the pinned commit's CI result. Gate: every required direction resolves from the pinned configuration repository with no unsupported option, implicit inverse, ambiguity, undeclared schema, or product-boundary concern disguised as configuration; every `PRODUCT_CHANGE` is handed to Kecleon and is `BLOCKED` unless the owner accepted it as out of scope.
7. **PROD actuals baseline** — read, read-only, what PROD actually did in the window for every slice (`reference/prod-actuals.json`, `prod_actuals.py`): a PROD Lambda's accepted/rejected outcome per event, or a PROD Iceberg table. Gate: every slice has an `AVAILABLE` baseline, or a `NONE` baseline whose schema, row-count and reject-reason fallback is stated; an `EMPTY` or `STALE` baseline is `BLOCKED` with the nearest day it covers. Freshness comes from the newest data timestamp, not the snapshot commit; a stale mirror moves the slice to its most recent covered day with a `ProdMirrorStale` handoff. A slice whose catalog declares graph `joinCoverage` also needs every selected event's graph join covered by its built inputs (M2D: each uploaded event's files vertex by classified URI, linked to one debt); a `JOIN_COVERAGE_GAP` is `BLOCKED` with a `GraphJoinCoverageGap` handoff, not a mapping `FAIL`.
8. **Release and deployment provenance** — verify Deploy-owned environment records and bind the active DEV deployment to immutable source/configuration digests. Gate: DEV serves the pinned `mapping.json` before each execution and at verdict time (`dev_redeploy.py check`); a latest-PR-wins prune is `BLOCKED` (`DeploymentRace`, republished only through the registry's documented DEV deploy path under the owner's `devRedeployPinned`), and the pinned head's own deploy serving other content is `FAIL` (`DeploymentDrift`). Silvally never deploys PROD.
9. **DEV canary on real events** — select 10 real events per slice deterministically (mixing outcomes such as accepted and rejected), stage their real inputs to DEV under approval, run the canary in DEV under its own approval, capture it, and compare it with the PROD actual. Gate: every canary execution has its own recorded approval and reconciles physically, and the canary comparison passes; a failing comparison is `FAIL`.
10. **Canary gate and full-window DEV run** — show the user the canary result (execution ids, S3 inputs and outputs, row counts, comparison) and ask before the full window, unless the owner pre-approved it for a passing canary. After approval, stage the whole window and run it in DEV. Every gate belongs to one slice. Gate: the slice's canary passed and its full run is `APPROVED` (or `PRE_APPROVED`) — otherwise `APPROVAL_REQUIRED`; a failed canary is `BLOCKED` with `FullRunNotStarted`, and a full run started without an approved gate is `FAIL`; every full-window execution has its own recorded approval.
11. **Comparison with PROD actuals** — compare the full-window DEV outputs with the PROD actual per slice (or the stated fallback), the declared contracts and invariants, graph closure (and the Persist canary only when `persistPolicy` requires it), exporter/hydration and round-trip parity when declared, and regression against a previous run. Gate: counts, keys, fields and rejects reconcile; zero dangling endpoints.
12. **Final PROD-derived validation, package, handoff and readiness verdict** — confirm that phases 1–11 passed in `observed-dev` on the confirmed real window, record `finalValidation` (window, canary, full-run approval, baseline per slice, approval digests), validate the reusable configuration/readiness package, reconcile report statuses, route product changes and compute `READY`, `NOT_READY`, or `BLOCKED` per slice and overall (overall `READY` only when every slice is `READY`). Gate: the final PROD-derived validation passed (otherwise `BLOCKED` with `FinalProdDerivedValidationRequired`), package and report agree, contain no protected data, and state Marketplace-registration metadata without claiming Marketplace or Deploy ownership.

## Final PROD-derived validation

A run reaches `READY` only through a final pass of phases 1–12 in `observed-dev`, canary first:

- phase 1: `sourceWindowSelection.status` is `CONFIRMED` for a whole-UTC-day window of at least `minimumCompleteUtcDays`, every day of it compared and complete — or the owner chose the most recent full UTC day with real data per slice — and no slice is empty;
- phase 3: each DEV staging copy (canary and full window) was uploaded under its own approval digest, with a matching manifest readback;
- phase 4: every input binding lies under the window's staging prefix (or a previous step's output under the run's output root);
- phase 7: every slice has a usable PROD-actuals baseline;
- phase 9: the DEV canary of 10 real events per slice passed its comparison with the PROD actual;
- phase 10: the user approved the full-window run (or the owner pre-approved it for a passing canary), and every full-window execution was approved;
- phase 11: the full window matches the PROD actuals and passes closure, contract and regression gates;
- phase 12: `finalValidation.status` is `PASS`.

`bounded-dev-dry-run` proves the approval gates only; phase 12 stays `BLOCKED`. A canary awaiting the user's answer is `BLOCKED` (phase 10 `APPROVAL_REQUIRED`). A failed canary stops the run as `NOT_READY` (or `BLOCKED` when the comparison itself could not be made); the full run is not suggested. Missing PROD access, a missing confirmation, or a missing staging or execution approval is `BLOCKED` with a handoff naming what is needed.

## Chained validations

A chained request (`kind: chain`, `reference/chains.json`) runs the same 12 phases over an ordered chain of steps:
`source-events` (PROD events read-only, normalized by the chain source catalog and staged to DEV), `transform` (each with
its own pinned mapping, run directory and deployment digest checks), `persist-load` (DEV `PersistNeptuneCsvWorkflow` on the
previous transform's committed output), `persist-export` (a bounded read-only DEV Persist read of exactly this run's ids
into the next mapping's graph inputs, with hydrated bodies) and `compare` (the final output against the source events).

- phase 1: the chain resolves every transform step; the window is the most recent full UTC day with source events
  (`source_events.py days` feeds `source_window.py data-days`), or the user's confirmed day;
- phase 3: each staging copy, each Transform execution and each DEV Persist load has its own approval, the load only
  per operation or under the owner's `devPersistWrites` (never `blanketDevWrites`); PROD Persist is refused;
- phase 7: the baseline is the source events (`source_events.py expect`, `baselineKind: source-events`);
- phase 8: every transform step checks its own served digest before `StartExecution` and at verdict time;
- phase 9: every step runs its canary (10 accepted source events) in order and every canary step has evidence
  (`ChainStepEvidenceMissing` otherwise); `chain_runs.py gate` is the canary gate for the whole chain;
- phase 10: after the gate is `APPROVED` or `PRE_APPROVED`, every step runs the full window; a full Persist load without
  the gate is refused;
- phase 11: `compare_datasets.py source-baseline` on the full window: no missing, extra or changed row, with every
  exclusion category, quarantine reason and coverage gap reported with counts; the Persist export's scope check
  (`ExportScopeMismatch`) and zero dangling endpoints hold;
- phase 12: cost is summed across steps (`chain_runs.py summary`, `build_run_package.py --chain-summary --chain-step`).

## Approval placement

Finish read-only work first. Immediately before each DEV external write, create an operation-specific approval record and stop at `APPROVAL_REQUIRED`. After matching explicit approval, perform only that operation. Any changed target, payload, digest, cost ceiling or retry requires a new approval. The canary gate is one more approval: the full-window run needs the user's answer to the canary result, and `transform_runs.py start` refuses a full-stage run without an `APPROVED` or `PRE_APPROVED` gate.

`bounded-dev-dry-run` never crosses a DEV write gate. PROD never crosses one in any mode, and PROD Transform is never invoked.
