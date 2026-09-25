# Validation evidence

## Registry

Assign stable kebab-case IDs to evidence. For each item record observation time, collector mode, environment, source type, immutable revision/digest, sensitivity, sanitization, credential-free location and claims supported.

Evidence precedence:

1. bounded downstream readback linked to immutable runtime inputs;
2. committed output data and manifests linked to an immutable plan;
3. deployment and execution metadata linked to source/configuration digests;
4. local Spark/runtime tests at the compatible version;
5. static code/configuration;
6. documentation.

Lower levels cannot replace a required higher level. Workflow `SUCCEEDED` alone proves only orchestration status.

## Required evidence

- Boundary: proposed change, `CONFIGURATION` or `PRODUCT_CHANGE`, evidence IDs, resolution state and product/builder handoff.
- Transform class: deterministic mapping plus expected-output/negative Test evidence, or non-deterministic confidence/threshold/human-review evidence.
- Repository: slug and 40-character commit SHA.
- Configuration: exact profile, language definitions, mapping manifests and SQL SHA-256.
- Environment: sanitized account hash, region and write policy.
- PROD-derived source window: sanitized recent complete-UTC-day comparisons, required source-family and coverage-signal results, row/byte/cost bounds, immutable-evidence status, recommended half-open window and explicit user confirmation before DEV staging.
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

Permit aggregate counts, schemas, hashes, statuses, durations, costs and safe failure codes. Reject raw records, names, addresses, phone/email values, debt/account/document/client identifiers, document bodies, message content, secret values, credentials, bearer material and signed URLs.

Hash values only after canonicalization specified by the profile. A hash is not anonymization when its input has a small or guessable domain; do not publish row-level hashes of business identifiers.

Locations must omit user info, query strings, fragments and credentials. Prefer logical/prefix descriptions or private immutable object locations available only to authorized reviewers.

## Physical verification

Count only committed data objects; exclude metadata and temporary files. Reread output schemas and values using the declared format. Compare manifest counts/bytes with physical observations. Treat multipart ETags as observations, never content hashes. Preserve exact-byte SHA-256 for definitions, mappings, SQL, plans and manifests.
