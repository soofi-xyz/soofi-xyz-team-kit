# Lexicon to Interprose v4 round-trip calibration

Use only with `lexicon-interprose-v4.json`. This dossier holds sanitized expectations, not runtime evidence. Status: **registered on a candidate**. `lexicon-to-interprose@4.0.0` is registered by Lexicon PR #811 (not yet on `main`); pin the PR head SHA and prove that the DEV registry `mapping.json` and query SHA-256 digests equal a local materialization of that SHA before any run. Unmerged 4.0.0 was uploaded several times under the same version and was pruned by other branches' DEV deploys, so pin every piece of evidence by `mapping.json` and query SHA-256 plus the registry object `VersionId` recorded in the plan. The version string alone, or evidence from an earlier upload of the same version, never proves the current candidate.

## DEV package

`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/lexicon-interprose-v4/20260928-dev-stage-sample_v2/` (bucket versioning `Enabled`) holds a 265-debt DEV Stage sample:

- `stage/ingest-a/` and `stage/ingest-b/`: the ten profile source families as two ingests. Ingest A uses the 2026-08-14 `debt_settlement_agency` snapshot; ingest B is current. `stage/manifest.sha256.json` lists key, bytes, SHA-256 and `VersionId` per object.
- `lexicon/`: the thirteen Parquet graph exports v4 reads, bridged from two ordered `interprose-to-lexicon@1.0.0` runs with Persist's append-only behaviour: an unchanged edge keeps its first `created_at` and endpoints, a changed vertex mints a new content-hashed physical vertex, and `created_at` is the ingest time plus a rank.
- Coverage: DSA reactivations, renames, new deletions and debts with two DSA edges, all under one `company_identifier`.
- Attempted slots: DEV Stage has schedule rows for almost no attempted slots. By owner decision (2026-09-28) the PROD schedule extract is skipped and payment records are the accepted substitute: plan, amount and date against the first attempt, state against the latest outcome.
- Two DSA identities on one debt: not in the DEV sample. The coverage source is a read-only PROD-derived graph sample selected to include such debts. If PROD has none, the check narrows to multiple edges per debt and the finding is recorded. `form_1281` stays `BLOCKED` until that sample is evaluated.
- Pinned mapping: `mapping.json` sha256 `5ccdc76f115779d5c0a3ef2fe7cc01f0d950637089b0077330f1e6a85f078cd6`, S3 VersionId `tv86x9ecXJPr4VxdqA7ybSOCm_prq3Vl` (Lexicon PR #811 `50717c3e`).

Classification: `deterministic`. The profile fixes the DSA election rule, form constants, cents conversion, and CSV format. Changing any of them in the mapping is a configuration change. Changing the Lexicon model is forbidden for this profile.

## Pinned references

- Lexicon `main` `6f7a2ebf0877d9a25adf473577e5a711a1262f7b`: `src/data/lexicon.json` (debt `is_dsa` index, `company_represents_debt`, payment-plan concepts), `src/data/interprose.json` (`payment_plan`, `payment_plan_schedule`), and the Interprose-to-Lexicon SQL under `src/transform/interprose/`.
- Transform `main` `f67430f98634cf3f783d02aa36d907afed766400`: `outputDatasets` request selection in `src/shared/contracts.ts` and required-input enforcement in `src/lambdas/resolve-plan/index.ts`.
- `form_1281` columns come from the profile's consumer contract. The candidate also declares it in `interprose.json`. v4 emits only `DSA_NAME` and `DSA_REPRESENTATION`; `REPORTED_DATE` and `DSA_CLIENT_ID_` are expected-absent.

## Synthetic graph export

Generate Parquet vertex and edge tables locally from the language definitions. Use fixture-only tokens, and retain only counts, schemas, and SHA-256 digests.

| Case | Graph facts | Expected output |
| --- | --- | --- |
| DSA active, verified later than reported | one version 2 `DEBT_SETTLEMENT_AGENCY` edge, `ACTIVE`, `effective_at` = verified + 1 s | two `form_1281` rows (`DSA_NAME`, `DSA_REPRESENTATION` true); no `REPORTED_DATE` |
| DSA sticky delete | `ACTIVE` then `DELETED` for the same `company_identifier`, `DELETED` has the newer `created_at` | not represented |
| DSA reactivation | `DELETED` (older `created_at`, later `effective_at`) then `ACTIVE` (newer `created_at`) | represented; `created_at` outranks `effective_at` |
| DSA rename | two company vertices with one `company_identifier`; old vertex `ACTIVE`, new vertex `DELETED` newer | not represented (grouped by `company_identifier`) |
| Several DSA edges on one debt | two identities, one `ACTIVE` head and one `DELETED` head | represented; `DSA_NAME` from the `ACTIVE` identity |
| Tied `ACTIVE` identities | two `ACTIVE` heads with equal `created_at` and `effective_at`, `company_identifier` `9` and `10` | deterministic; report as an observation that `9` wins because identifiers compare as strings |
| Legacy edge | version 1 `DEBT_SETTLEMENT_AGENCY` edge, status null | ignored |
| Other roles | `ATTORNEY` and `FORWARD_VENDOR` `ACTIVE` edges only | no DSA rows |
| Plan lifecycle | one plan each: `ACTIVE`; `COMPLETED`; `CANCELLED`; `DEFAULTED` | `active`, `complete_date`, `deactivation_date` per status |
| Completed and deactivated plan | source has `complete_date` and `deactivation_date` | `deactivation_date` empty is a permitted loss; any other `deactivation_date` difference fails |
| Plan payment method | installments `ACH` on an `INSTALLMENT` plan; `MIXED`/`PROMISE` (`OTHER`); disagreeing installments | `ACH`; empty; empty. A non-empty value that differs from the source fails |
| Plan actors | created by user A, then updated twice (B, then A) | `created_by` A; `last_updated_by` A at the later `last_update` |
| Cents boundary | `total_amount` 19.99, 0.07, 1234567.89, and null | `payment_total` 1999, 7, 123456789, empty |
| Installments | attempted slot and booked future slot, `scheduled_amount` 33.33 | `amount` 3333; `payment_plan_id` resolves |

## Expected flow

1. Verify that the candidate `lexicon.json` equals `main` and that no shared forbidden concept or property appears.
2. Run v4 once with all outputs, then once per `partialInputPolicy` case.
3. Check the first line of every CSV part file. It must be the declared columns joined by `|`.
4. Round trip: take a sanitized Interprose sample, run `interprose-to-lexicon@1.0.0` with `outputDatasets` limited to the thirteen graph datasets, run v4, then column-diff by the declared row keys.

## Regression expectations

- Any `lexicon.json` diff against `main`: phase 5 `FAIL` (`LexiconModelDiffersFromMain`).
- A forbidden label or property in the model, a graph input, or the SQL: phase 5/6 `FAIL`.
- Registered `requiredInputs` or CSV options differ from `outputContracts`: phase 6 `FAIL`.
- Election by `effective_at` alone, or by physical company vertex: phase 11 `FAIL` (`DsaElectionMismatch`).
- `payment_total` written as `1998` or `19.99`: phase 11 `FAIL` (`CentsConversionMismatch`).
- A payment-plan column outside the declared list is populated: phase 11 `FAIL` (`ProfileParityDrift`).
- Any `REPORTED_DATE` or `DSA_CLIENT_ID_` row in `form_1281`: phase 11 `FAIL` (`Form1281ShapeMismatch`).
- A non-empty `payment_method` that differs from the source: phase 11 `FAIL` (`RoundTripColumnMismatch`).
- A request for `payment_plan_schedule` without `edge-payment-plan-installment-status-changed` is not rejected before Glue starts: phase 9 `FAIL`.
- Runtime evidence bound only to `4.0.0` without the plan's `mapping.json` SHA-256 and `VersionId`, or a registry that no longer serves that digest at verdict time: phase 8 `BLOCKED` (`DeploymentDrift`).
- A request for `payment_plan` without `edge-payment-plan-has-total-amount` is not rejected before Glue starts: phase 9 `FAIL`.
- Any Persist call: phase 10 `FAIL`.
