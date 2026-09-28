# Lexicon to Interprose v4 round-trip calibration

Use only with `lexicon-interprose-v4.json`. This dossier holds sanitized expectations, not runtime evidence. Status: **registered on a candidate**. `lexicon-to-interprose@4.0.0` is registered by Lexicon PR #811 (not yet on `main`); pin the PR head SHA and prove that the DEV registry `mapping.json` and query SHA-256 digests equal a local materialization of that SHA before any run. The DEV registry key is overwritten on every PR deploy, so bind each execution to the registry object `VersionId` recorded in its plan.

## DEV package

`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/lexicon-interprose-v4/20260928-dev-stage-sample_v1/` (bucket versioning `Enabled`) holds a 197-debt DEV Stage sample:

- `stage/`: the ten profile source families, one Parquet object each; `stage/manifest.sha256.json` lists key, bytes, SHA-256 and `VersionId` per object.
- `lexicon/`: the thirteen Parquet graph exports v4 reads, bridged from an `interprose-to-lexicon@1.0.0` Neptune CSV run; `lexicon/manifest.sha256.json` as above.
- The manifests carry no row counts, source window, or sanitization record, and the bridge assigns every `created_at` as a synthetic sequence; record both as limitations.

Classification: `deterministic`. The profile fixes the DSA election rule, form constants, cents conversion, and CSV format. Changing any of them in the mapping is a configuration change. Changing the Lexicon model is forbidden for this profile.

## Pinned references

- Lexicon `main` `6f7a2ebf0877d9a25adf473577e5a711a1262f7b`: `src/data/lexicon.json` (debt `is_dsa` index, `company_represents_debt`, payment-plan concepts), `src/data/interprose.json` (`payment_plan`, `payment_plan_schedule`), and the Interprose-to-Lexicon SQL under `src/transform/interprose/`.
- Transform `main` `f67430f98634cf3f783d02aa36d907afed766400`: `outputDatasets` request selection in `src/shared/contracts.ts` and required-input enforcement in `src/lambdas/resolve-plan/index.ts`.
- `form_1281` is not an `interprose.json` type. Its columns come from the profile's consumer contract.

## Synthetic graph export

Generate Parquet vertex and edge tables locally from the language definitions. Use fixture-only tokens, and retain only counts, schemas, and SHA-256 digests.

| Case | Graph facts | Expected output |
| --- | --- | --- |
| DSA active, verified later than reported | one version 2 `DEBT_SETTLEMENT_AGENCY` edge, `ACTIVE`, `effective_at` = verified + 1 s | three `form_1281` rows; `DSA_REPRESENTATION` true |
| DSA sticky delete | `ACTIVE` then `DELETED` for the same `company_identifier`, `DELETED` has the newer `created_at` | not represented |
| DSA reactivation | `DELETED` (older `created_at`, later `effective_at`) then `ACTIVE` (newer `created_at`) | represented; `created_at` outranks `effective_at` |
| DSA rename | two company vertices with one `company_identifier`; old vertex `ACTIVE`, new vertex `DELETED` newer | not represented (grouped by `company_identifier`) |
| Legacy edge | version 1 `DEBT_SETTLEMENT_AGENCY` edge, status null | ignored |
| Other roles | `ATTORNEY` and `FORWARD_VENDOR` `ACTIVE` edges only | no DSA rows |
| Plan lifecycle | one plan each: `ACTIVE`; `COMPLETED`; `CANCELLED`; `DEFAULTED` | `active`, `complete_date`, `deactivation_date` per status |
| Plan actors | created by user A, then updated twice (B, then A) | `created_by` A; `last_updated_by` A at the later `last_update` |
| Cents boundary | `total_amount` 19.99, 0.07, 1234567.89, and null | `payment_total` 1999, 7, 123456789, empty |
| Installments | attempted slot and booked future slot, `scheduled_amount` 33.33 | `amount` 3333; `payment_plan_id` resolves |

## Expected flow

1. Verify that the candidate `lexicon.json` equals `main` and that no shared forbidden concept or property appears.
2. Run v4 once with all outputs, then once per `partialInputPolicy` case.
3. Check the first line of every CSV part file. It must be the declared columns joined by `|`.
4. Round trip: take a sanitized Interprose sample, run `interprose-to-lexicon@1.0.0` with `outputDatasets` limited to the twelve graph datasets, run v4, then column-diff by the declared row keys.

## Regression expectations

- Any `lexicon.json` diff against `main`: phase 5 `FAIL` (`LexiconModelDiffersFromMain`).
- A forbidden label or property in the model, a graph input, or the SQL: phase 5/6 `FAIL`.
- Registered `requiredInputs` or CSV options differ from `outputContracts`: phase 6 `FAIL`.
- Election by `effective_at` alone, or by physical company vertex: phase 11 `FAIL` (`DsaElectionMismatch`).
- `payment_total` written as `1998` or `19.99`: phase 11 `FAIL` (`CentsConversionMismatch`).
- A payment-plan column outside the graph-fillable list is populated: phase 11 `FAIL` (`ProfileParityDrift`).
- A request for `payment_plan` without `edge-payment-plan-has-total-amount` is not rejected before Glue starts: phase 9 `FAIL`.
- Any Persist call: phase 10 `FAIL`.
