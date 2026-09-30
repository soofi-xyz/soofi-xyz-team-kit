# Validation evidence

## Registry

Assign stable kebab-case IDs to evidence. For each item record observation time, collector mode, environment, source type, immutable revision/digest, sensitivity, sanitization, credential-free location and claims supported.

Evidence precedence:

1. bounded downstream readback linked to immutable runtime inputs;
2. committed output data and manifests linked to an immutable plan;
3. deployment and execution metadata linked to source/configuration digests;
4. repository CI results at the pinned commit (read-only);
5. static code/configuration;
6. documentation.

Nothing is executed locally, so local runs are not evidence at any level. Every execution is a DEV Transform run on real PROD-derived data.

Lower levels cannot replace a required higher level. Workflow `SUCCEEDED` alone proves only orchestration status.

## Required evidence

- Boundary: proposed change, `CONFIGURATION` or `PRODUCT_CHANGE`, evidence IDs, resolution state and product/builder handoff.
- Transform class: deterministic mapping plus expected-output/negative Test evidence, or non-deterministic confidence/threshold/human-review evidence.
- Repository: slug and 40-character commit SHA.
- Configuration: exact profile, language definitions, mapping manifests and SQL SHA-256. For a registry object, also record its S3 `VersionId` from the execution plan; an unmerged `id@version` can be re-uploaded with different content, so the version string alone is not an identity.
- Environment: sanitized account hash, region and write policy.
- PROD-derived source window (every run aiming for `READY`): the profile's `sourceWindowPolicy` with its origin and recorded defaults, sanitized recent complete-UTC-day comparisons, required source-family and coverage-signal results, row/byte/cost bounds, immutable-evidence status, recommended half-open window and explicit user confirmation before DEV staging.
- Per-slice real-data check: the chosen day's row count per slice (`source_window.py data-days`) and, for an empty slice, the nearest UTC day with data that was suggested.
- PROD actuals (per slice): baseline kind (`state-machine-lambda-outcomes`, `iceberg-table` or `none`), where it was read (log group or table, snapshot id and time), event or row counts by outcome and UTC day, the private events digest, and `prodAccess: read-only`. For `none`, the stated fallback (schema, row-count, reject-reason).
- Canary: the selection rule and digest, events selected per slice by outcome, the staging and execution approval digests, execution ids, S3 inputs and outputs, row counts and the comparison with the PROD actual; then the canary gate (`AWAITING_APPROVAL`, `APPROVED`, `PRE_APPROVED` or `CANARY_FAILED`) and who approved it.
- Final PROD-derived validation: `finalValidation` with the confirmed window (or the owner's per-slice windows), the approval digest of every DEV staging copy, the staged manifest SHA-256s, the approval digest of every canary and full-window DEV execution, the canary result, the full-run approval, the baseline per slice and `prodAccess: read-only`. A bounded dry run or a canary alone cannot stand in for it.
- Deployment: immutable package/template/image digest and linked source revision.
- Dataset: derived schema digest, row count, deterministic content hash and credential-free physical location.
- Graph: ID uniqueness, endpoint count, endpoint membership and dangling count.
- Persist: bounded canary input digest, ingest status and consumer-surface readback.
- Export/hydration: UTC window, source watermark, manifest digest, object count and hydration reconciliation.
- Round trip: normalization rules, compared fields, source/return counts, mismatch count and expected losses.
- Cost: ceiling, estimate and actual when executed.
- Approval: operation digest, DEV environment, status and timestamp before the operation.

Test owns reusable execution/result mechanics; evidence records identify the Test version/digest and result IDs. Deploy owns deployment/environment records. Lexicon owns canonical meaning/identity inputs; Model owns representation bindings; Persist owns storage/receipts/custody. Evidence from those products proves preconditions and outcomes without transferring ownership to Silvally.

## Sanitization

Permit aggregate counts, schemas, hashes, statuses, durations, costs and safe failure codes. Reject raw records, names, addresses, phone/email values, account, customer, document or other business identifiers, document bodies, message content, secret values, credentials, bearer material and signed URLs.

Hash values only after canonicalization specified by the profile. A hash is not anonymization when its input has a small or guessable domain; do not publish row-level hashes of business identifiers.

Locations must omit user info, query strings, fragments and credentials. Prefer logical/prefix descriptions or private immutable object locations available only to authorized reviewers.

## Physical verification

Count only committed data objects; exclude metadata and temporary files. Reread output schemas and values using the declared format. Compare manifest counts/bytes with physical observations. Treat multipart ETags as observations, never content hashes. Preserve exact-byte SHA-256 for definitions, mappings, SQL, plans and manifests.
