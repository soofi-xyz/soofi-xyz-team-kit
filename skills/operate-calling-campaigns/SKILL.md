---
name: operate-calling-campaigns
description: Prepares, validates, schedules, and delivers SOCAPITAL calling campaigns through Filter, live Interprose cleanup, graph_catalog Solver, live PRIMARY ZIP correction, Integrate, and LiveVox. Use for daily calling, prelegal, payfail calling, portfolio campaigns, Solver preparation, ZIP/hour audits, or LiveVox shipment.
---

# Operate calling campaigns

Prepare a calling campaign as a proven chain:

```text
source membership
  -> CALLING Filter
  -> live Interprose account/phone scrub
  -> graph_catalog Solver
  -> live PRIMARY ZIP/hour correction
  -> Integrate-ready output
  -> Integrate/LiveVox only with explicit approval
```

Use the AWS profile selected by the operator. Set it explicitly on every
command, use `us-east-2`, and stop unless STS returns account
`014948052063`. Never hardcode a developer profile name.

## Decide the campaign business date

- Use `America/New_York` for business dates and calling windows.
- If today's relevant calling windows have opened, prepare the next full
  business day unless the user explicitly requests only remaining legal hours.
- Set Solver `selected_day_of_week` from the campaign business date, not the
  machine's local date.
- Record source event dates separately from the campaign business date.

## Establish authoritative source membership

Require a unique `debt_id` per source row and publish a source manifest with:

- source URI/query/execution lineage;
- business-date boundaries;
- source count and debt-membership SHA256;
- duplicate and malformed-row counts;
- AES256 object evidence.

For a multi-date audience, preserve per-date membership and report each date,
the overlap, and the deduplicated union.

### Payfail calling source

Do not infer a historical payfail audience from an SMS-final audience or from
a daily Filter output that never existed. Evaluate the current canonical
`has_failed_or_returned_transaction_today` rule semantics against the
underlying historical events for each requested Eastern business date:

- linked payment `payment_status_changed` status `NSF` or `RETURNED`; or
- linked payment-plan installment
  `payment_plan_installment_status_changed` status `FAILED`;
- event `effective_at` inside
  `[Eastern day start, next Eastern day start)`.

Fetch and hash the deployed rule artifacts before querying. Parameterize their
runtime date bounds; do not invent a proxy. Include the exact SQL/Gremlin,
query execution ID, source snapshot, result hash, and date counts in the
audit. Apply CALLING compliance separately after source qualification.

## Run CALLING Filter

Always run CALLING Filter when the source has not already passed the exact
approved calling contract for the same business purpose and freshness window.
Do not reuse SMS Filter output as calling certification.

Use current canonical rule URIs. The proven general/prelegal calling baseline
is the ordered 36-rule contract from execution
`prelegal-xlsx-200files-20260923T154357Z`:

1. `has_single_version_2_phone_owner`
2. `not_in_bankruptcy`
3. `not_with_forward_vendor`
4. `not_with_debt_settlement_agency`
5. `not_uncollectable`
6. `balance_over_250`
7. `not_out_of_statute_restricted_states`
8. `not_account_level_dnc`
9. `has_active_phone_number`
10. `no_1099c_sent`
11. `demand_letter_attempted`
12. `person_not_deceased`
13. `not_sold_back`
14. `not_represented_by_attorney`
15. `no_active_payment_plan`
16. `not_litigious`
17. `no_compliance_hold`
18. `no_open_complaint`
19. `no_operational_hold`
20. `no_creditor_request_hold`
21. `next_work_date_due`
22. `in_current_inventory`
23. `max_7_attempts_in_7_days`
24. `not_do_not_call`
25. `max_1_rpc_in_7_days`
26. `no_cease_and_desist`
27. `no_open_dispute`
28. `ma_max_2_attempts_per_week`
29. `wa_max_3_attempts_per_week`
30. `respect_preferred_calling_times`
31. `dc_max_2_attempts_per_week`
32. `no_open_formal_complaint_on_phone_number`
33. `no_business_phone_number`
34. `latest_phone_status_is_callable`
35. `max_3_calls_per_phone_per_day`
36. `initial_letter_sent`

Treat this as the default when no approved campaign profile says otherwise.
For normal-daily Solver campaigns, use the current deployed Git-managed
normal-daily profile because campaign/prelegal/portfolio exclusions can differ
from the general baseline. Record the exact ordered rule IDs, URIs, artifact
hashes, and profile/context. Never append an SMS rule to a calling contract.

Use:

```json
{
  "input_s3_uri": "s3://<source>/",
  "rule_s3_uris": ["<ordered current canonical CALLING rules>"],
  "save_rules_reports": false,
  "skip_report_metrics": true
}
```

- Use CSV header `debt_id`.
- For a large source, create exactly 200 balanced files—200 files, not 200
  debts per file. For a small source, use the minimum safe nonempty file count
  for the worker batch size.
- Use a deterministic execution name and collision-check before starting.
- If a rule prefix is empty/deleted, resolve the same active rule ID from the
  current deployed manifest. Do not silently substitute a different rule.

Certify top-level success and every Distributed Map child. Require zero
failed, running, pending, timed-out, aborted, or pending-redrive children.
Prove:

```text
input = passed + rejected + not_loaded
```

Also require exact source/pass/reject membership reconciliation, no gaps or
duplicates, nonempty outputs, expected file counts, and AES256.

## Run live Interprose calling scrub

Run after Filter and before Solver through the production PrivateLink in one
read-only `REPEATABLE READ` transaction.

Retain a debt only when:

- exactly one current SPRING account exists;
- account `active=true`, `debt_status_code=ACT`, `currentbal>0`;
- `do_not_call` is not true;
- at least one supplied phone same-debt matches a current
  `demographic_phone` row;
- phone is valid US 10 digits, `active=true`, and `no_contact=false`;
- no same-debt or global SPRING record marks the number bad, invalid, wrong,
  reassigned, consumer-blocked, DNC, do-not-call, do-not-contact, inactive,
  not-active, or disconnected.

Do not use SMS opt-out as a calling exclusion unless the approved calling
contract explicitly requires it. Remove unsafe phone entries; remove a debt
only when no safe callable phone remains.

Publish account exclusions, phone exclusions, transaction proof, counts,
membership hashes, and AES256 output evidence.

## Run Solver

Use the deployed `graph_catalog` Solver and the certified Interprose-clean
prefix. Reuse the exact current production configuration for the campaign
type; do not guess flags from an older run.

At minimum, record:

- Solver execution ARN and exact input;
- campaign business date and selected weekday;
- schedule hours and capacities;
- graph catalog lineage;
- input, compliance-excluded, scheduled, and unscheduled counts;
- hourly/priority counts and output hashes.

For payfail precedence or score tiers, follow the current
`operate-solver-campaigns` contract. Never infer mode from the directory
layout alone.

## Correct ZIP and legal hours

After Solver, read the latest live production Interprose
`spring.demographic` row whose type is `PRIMARY`; normalize it to ZIP5. Do not
authorize against Persist/Graph ZIP or `interprose_current` snapshots.

Re-evaluate each row with the deployed Solver timezone, curfew, DST,
NPA-NXX/phone overlay, prohibited-area-code, selected-hour, and capacity
logic. Classify each row:

- unchanged;
- ZIP changed but assigned hour remains legal;
- rescheduled to the nearest legal capacity-valid hour;
- removed/unresolved.

Preserve caller ID and priority. Publish only final legal rows under:

```text
scheduled_calls/hour=H/priority=P/part-*.csv
```

Prove unique debts, exact source/final/excluded reconciliation, valid 13-column
LiveVox rows, ZIP5 validity, and zero unresolved rows in the shipment prefix.

## Deliver

Stop at Integrate-ready output unless the user explicitly says to upload.

- Integrate input is the final corrected `scheduled_calls/` prefix.
- Do not use raw Solver output after a ZIP correction.
- Do not upload hours whose campaign window has already opened.
- For a direct combined LiveVox campaign, merge only rows legal throughout the
  requested common window and report held rows.
- Before any upload, collision-check campaign names and source hashes.
- Start Integrate or call LiveVox only after explicit user approval.

## Report

Return source/date counts, Filter pass/reject/not-loaded, Interprose account
and phone exclusions, Solver scheduled/unscheduled, ZIP classifications,
final rows by hour/priority, execution links, audit URIs, final S3 URI, local
CSV path when requested, and whether Integrate/LiveVox was started.
