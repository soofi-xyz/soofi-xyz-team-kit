# Lexicon to Interprose v4 round-trip calibration

Use only with `lexicon-interprose-v4.json`. This dossier holds sanitized expectations, not runtime evidence. Status: **registered on a candidate**. `lexicon-to-interprose@4.0.0` is registered by Lexicon PR #811 (not yet on `main`); pin the PR head SHA and prove that the DEV registry `mapping.json` and query SHA-256 digests equal a local materialization of that SHA before any run. Unmerged 4.0.0 was uploaded several times under the same version and was pruned by other branches' DEV deploys, so pin every piece of evidence by `mapping.json` and query SHA-256 plus the registry object `VersionId` recorded in the plan. The version string alone, or evidence from an earlier upload of the same version, never proves the current candidate.

## DEV package

`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/lexicon-interprose-v4/20260928-dev-stage-sample_v2/` (bucket versioning `Enabled`) holds a 265-debt DEV Stage sample:

- `stage/ingest-a/` and `stage/ingest-b/`: the ten profile source families as two ingests. Ingest A uses the 2026-08-14 `debt_settlement_agency` snapshot; ingest B is current. `stage/manifest.sha256.json` lists key, bytes, SHA-256 and `VersionId` per object.
- `lexicon/`: the thirteen Parquet graph exports v4 reads, bridged from two ordered `interprose-to-lexicon@1.0.0` runs with Persist's append-only behaviour: an unchanged edge keeps its first `created_at` and endpoints, a changed vertex mints a new content-hashed physical vertex, and `created_at` is the ingest time plus a rank.
- Coverage: DSA reactivations, renames, new deletions and debts with two DSA edges, all under one `company_identifier`.
- Attempted slots: DEV Stage has schedule rows for almost no attempted slots. By owner decision (2026-09-28) the PROD schedule extract is skipped and payment records are the accepted substitute: plan, amount and date against the first attempt, state against the latest outcome.
- Two DSA identities on one debt: covered by the PROD graph sample below and checked read-only against PROD `is_dsa` and `dsa_company_name`.
- Pinned mapping: `mapping.json` sha256 `0e3146aa6e3ce02b6e19ef7b7fe401e424ffeca72abab18c569b40fc3626347b`, S3 VersionId `kbw8QFT.dlJVEmOAaG0DrOpZbJV6pCLX` (Lexicon PR #811 `74ddd5ab`). Evidence from earlier uploads (`0ad567be…`, `5ccdc76f…`) is superseded.
- Expected rows: `form_1281` 198, `payment_plan` 952, `payment_plan_schedule` 4,135.

## PROD graph sample

`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/lexicon-interprose-v4/20260928-prod-graph-sample_v1/` holds a read-only PROD Persist sample of 309 debts: the 265 v2 debts, the 4 Interprose debts with more than one DSA identity, and 40 sanitized placeholder debts. `iso/` carries ISO-8601 DateTime and is the supported v4 input; `raw/` keeps Persist epoch millis and is an unsupported input contract (the Glue run fails with a bigint-to-date cast error).

- Expected rows from `iso/`: `form_1281` 206 (103 debts x 2 fields), `payment_plan` 968 (991 plan vertices, 23 plans with a changed `plan_type`), `payment_plan_schedule` 4,736.
- PROD has 13,625 debts with more than one DSA identity; 13,621 are `UNMATCHED_SSN_` placeholders, which v4 never exports, and 4 are Interprose debts.
- Risk finding: for several ACTIVE identity heads, `DSA_NAME` reproduces the `java.util.HashMap` iteration order of Gremlin `group()` (bucket of `String.hashCode`, then insertion order). This matches PROD today but depends on Neptune/TinkerPop internals. On the 3 real concurrent-ACTIVE debts, the newest-head rule gives the same name, so PROD confirms the output without discriminating the rule. Owner: Lexicon `debt.dsa_company_name`, with Kecleon.

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

## Final PROD-derived validation

The synthetic graph export above is an earlier phase. It proves shape, negatives and wiring, and its
evaluation ends `BLOCKED` with `FinalProdDerivedValidationRequired`. `READY` needs the final run:
compare at least 7 recent complete UTC days of every declared source family from read-only PROD metadata against the
profile's `sourceWindowPolicy` (declared by the profile, minimum one day, no longer range), ask the user to confirm the recommended window, stage the
sanitized window into DEV under its own approval digest, execute every workflow step in
`observed-dev` under per-execution approvals, and pass the regression expectations below on that
window. If PROD metadata access or the confirmation is missing, the verdict stays `BLOCKED`.

## Regression expectations

- Any `lexicon.json`, Stage column manifest or forward SQL diff against `main` for #811: phase 5 `FAIL` (`LexiconModelDiffersFromMain`). The four approved edge properties belong to the follow-up branch `feat/dsa-form-1281-facts`.
- A forbidden label or property in the model, a graph input, or the SQL: phase 5/6 `FAIL`.
- Registered `requiredInputs` or CSV options differ from `outputContracts`: phase 6 `FAIL`.
- Election by `effective_at` alone, or by physical company vertex: phase 11 `FAIL` (`DsaElectionMismatch`).
- `payment_total` written as `1998` or `19.99`: phase 11 `FAIL` (`CentsConversionMismatch`).
- A payment-plan column outside the declared list is populated: phase 11 `FAIL` (`ProfileParityDrift`).
- Any `form_1281` row other than `DSA_NAME`, or a represented debt without its `DSA_NAME` row: phase 11 `FAIL` (`Form1281ShapeMismatch`).
- v4 `form_1281` or a full run fails on a graph export that lacks the optional `company_represents_debt` columns: phase 9 `FAIL` (`OptionalPropertyNotMaterialized`). Raw epoch-millis payment inputs failing `cannot cast bigint to date` is the documented ISO input contract (`iso-datetime-inputs-only`), not this failure.
- A forward SQL reading a Stage column that the target environment's Stage outputs do not carry: phase 8 `FAIL` (`DeployOrderHazard`).
- A non-empty `payment_method` that differs from the source: phase 11 `FAIL` (`RoundTripColumnMismatch`).
- A request for `payment_plan_schedule` without `edge-payment-plan-installment-status-changed` is not rejected before Glue starts: phase 9 `FAIL`.
- Runtime evidence bound only to `4.0.0` without the plan's `mapping.json` SHA-256 and `VersionId`, or a registry that no longer serves that digest at verdict time: phase 8 `BLOCKED` (`DeploymentDrift`).
- A request for `payment_plan` without `edge-payment-plan-has-total-amount` is not rejected before Glue starts: phase 9 `FAIL`.
- Any Persist call: phase 10 `FAIL`.

## Claydol form 1281 round (PR #811 `9cba6122`)

- Pinned: v4 `mapping.json` `1050611b…` (VersionId `Ko5886TiHSl9ax7iIm6l_5xr0cAfffUd`, `form_1281.sql` `ac9141e3…`); forward `interprose-to-lexicon@1.0.0` `b3783711…` (VersionId `Gesii87aUnenVBfQKTYFXuiqCwdH95cE`).
- Approved model additions: optional `reported_at`, `verified_at`, `deleted_at` (dates) and `dsa_representation` (boolean) on `company_represents_debt`; `is_dsa` and `dsa_company_name` unchanged.
- `20260928-prod-reconstruct_v1/`: 340 PROD debts; `stage/` equals PROD Stage `debt_settlement_agency` at snapshot `1858287755566753224` except `dsa_representation`, which is reconstructed from Claydol `COMPLETED` representation records because Stage does not extract it yet. Expected `form_1281` fields: `DSA_NAME` 266, `REPORTED_DATE` 114, `DSA_REPRESENTATION` 116, `VERIFIED_DATE` 215, `DELETE_DATE` 74.
- Claydol inventory writes that set `REPORTED_DATE` without a representation (29 represented debts in the sample) are not reproduced by rule; record them.
- Graph exports without the four columns (all edges ingested before the change, the v2 and PROD graph samples) must still run: absent optional properties are typed nulls.
- Deploy order: the forward SQL reads `debt_settlement_agency.dsa_representation`; publish it only where Stage already has the column, and not in place over a live `1.0.0`.

## Independent re-validation of `9cba6122` (run `20260928T192229Z`)

- Local build reproduces v4 `1050611b…` and forward `b3783711…`; DEV serves the same bytes. The DEV plans executed `form_1281.sql` `ac9141e3…`, `payment_plan.sql` `93536bfa…` and `payment_plan_schedule.sql` `5188a76d…`.
- `lexicon.json` against the merge base, and a trial merge into current `main`, differ only by the four approved properties. The `is_dsa` and `dsa_company_name` index definitions are byte-identical.
- PROD-reconstruct package: the forward rerun matches the implementer's output except for per-run random edge `~id`s; the `lexicon/` bridge carries the same edge and company facts. v4 `form_1281` (785 rows) is byte-identical to the implementer's and exact against PROD Stage for 340 of 340 debts. This requires Claydol records cut off at the package extraction time (`18:43:31Z`); one later Claydol write adds one debt.
- v2 and PROD-sample graph exports: v4 `form_1281` and full runs fail (`lacks property column 'reported_at:Date'`). Payment-only and schedule-only runs pass. `payment_plan_schedule` is unchanged. `payment_plan` changes only `deactivation_date`: 28 PROD-sample plans, all now empty and all with a COMPLETED event. Rerunning with the four columns added as typed nulls (diagnostic only) leaves `DSA_NAME` and the represented-debt set unchanged.
- Deploy order in DEV: since `18:50Z` the published `interprose/edges/company_represents_debt.sql` (`72e5bb92…`) reads `dsa.dsa_representation`, but no DEV Stage output carries the column. Spark 3.3 fails with `Column 'dsa.dsa_representation' does not exist`. No live DEV forward run failed yet, because none has run on that SQL. DEV mapping objects flip between PR deploys (latest PR wins).

## Lexicon `15905c1a` with Transform `0684acbc` (run `20260929T112816Z`)

- Pins, reproduced locally and served in DEV: v4 `4152746b…` (VersionId `JSpktgsE._kDpzAwp_DI0QK1tK2Z_TEr`, `form_1281.sql` `b3886776…`); forward `a4635c70…` (VersionId `kj5tHm7RGE0SYQhVMYBwKPJNsm68xYpQ`); DEV Glue script `7e07c8c1…` equals Transform #44.
- `lexicon.json` equals `main` plus the four approved optional properties. `DELETE_DATE` is removed from v4 only; `deleted_at` stays on the edge.
- Deploy order: the forward SQL emits `dsa_representation` as NULL, and the Stage column manifest equals `main`. It runs on current DEV Stage columns locally (Spark 3.3) and in DEV (`cc-limited-run7`: 39 DSA edges, 0 with `dsa_representation`).
- PROD-reconstruct graph: 709 rows, exact for 340 of 340 debts (DSA_NAME 266, REPORTED_DATE 114, DSA_REPRESENTATION 114, VERIFIED_DATE 215). With `dsa_representation` as the forward emits it: 481 rows, DSA_NAME 266 and VERIFIED_DATE 215 only (documented limitation).
- Legacy exports without the new columns (v2, PROD sample iso and raw): `form_1281` passes and equals the typed-null diagnostic. Payment outputs are byte-identical to the previous round. Raw payment runs still fail on epoch-millis dates (ISO input contract).

## Split #811 (`4b8d63b1`, run `20260929T125429Z`)

- #811 no longer changes the model: `lexicon.json`, the Stage column manifest and the forward SQL equal `main` (`2efa32a1`). The four approved edge properties, `REPORTED_DATE`/`VERIFIED_DATE`, and Transform typed-null reading (closed #44) are deferred to `feat/dsa-form-1281-facts`; the earlier sections above record their evidence.
- Pins (local build equals DEV): v4 `90ffdb98…` (VersionId `K3CEoN.fFabhKLiaJO51RYnBw5_gdZSK`, `form_1281.sql` `5d8c963a…`); forward `e0d7d405…` (VersionId `ZURtOqzlBoPwma9nD4S7aF1atAKI2wZA`); DEV Glue script `09a1ad85…` (Transform main).
- `form_1281` is `DSA_NAME` plus `DSA_REPRESENTATION` `true`, byte-identical to the `0e3146aa` round. PROD graph sample: `DSA_NAME` equals `dsa_company_name` for 103 of 103, and no row for 166 of 166 `is_dsa` false. Reconstruct: 266 of 266 against PROD Stage.
- Payment outputs are byte-identical to the previous round, keeping the empty `deactivation_date` on the 28 completed PROD-sample plans.

## DSA_NAME only (#811 `87557fe3`, run `20260929T140056Z`)

- `DSA_REPRESENTATION` is dropped from #811: a PROD read-only sample of 200 active DSA debts held true 192, false 3 and empty 5, so the flag cannot be derived from the election. It moves to `feat/dsa-form-1281-facts` with the date fields.
- Pins (local build equals DEV): v4 `dae4a372…` (VersionId `bjdSApk6Fmpet0iBVkRkhLJcr_K01vLP`, `form_1281.sql` `eafa2d59…`); forward `e0d7d405…` equals main; DEV Glue script `09a1ad85…`.

## Cumulative 4.0.0 with sms_log (#811 `015ff00f`, run `20260929T181723Z`)

- 4.0.0 `mapping.json` `f3649d45…` (DEV VersionId `xONXQzNpWENfop42neJKVndx0.W0Oe4W`; the earlier `.8cc67QKLJgCUkCh2YIU3bLkPB.TJebW` held the same bytes before a CI re-upload). `sms_log` has the same SQL (`8a4651e1…`), inputs, `requiredInputs` and CSV options as 2.0.0. 2.0.0 (`b9219f31…`) and 1.0.0 (`e72706b7…`) are byte-identical to the previous round.
- `sms_log`-only on the 2.0.0 reference run's snapshotted inputs matches the reference: 72 of 72 parts with the same SHA-256 multiset, 130,321 rows. Without `hydrated_text_message_artifact`, resolve-plan rejects it.
- form, payment and schedule outputs on v2 and the PROD graph sample are byte-identical to the previous round.
- No committed package holds both the SMS graph and the DSA/payment graph (they share `vertex-debt` from different sources), so a full four-output run needs a combined package first.

