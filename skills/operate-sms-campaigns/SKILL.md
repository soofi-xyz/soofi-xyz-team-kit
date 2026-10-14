---
name: operate-sms-campaigns
description: Prepares, certifies, and starts SOCAPITAL SMS campaigns through the mandatory standard or payfail Filter contract, live Interprose SMS cleanup, PRIMARY ZIP validation, same-day provider dedupe, template checks, reservation, and SMS orchestration. Use for bulk SMS, trigger SMS, credit-reporting sets, portfolio SMS, payfail SMS, workflow payloads, or SMS send readiness.
---

# Operate SMS campaigns

Prepare every SMS campaign as:

```text
source membership
  -> mandatory SMS Filter contract
  -> live Interprose SMS scrub
  -> live PRIMARY ZIP gate
  -> same-day provider/admission dedupe
  -> template/campaign collision checks
  -> encrypted final audience + reservation + payload
  -> SMS workflow only with explicit approval
```

Use the AWS profile selected by the operator. Set it explicitly on every
command, use `us-east-2`, and stop unless STS returns account
`014948052063`. Never hardcode a developer profile name.

## Choose exactly one Filter contract

Classify the campaign before starting Filter:

- **Payfail SMS:** its audience is selected because a payment or payment-plan
  installment failed/returned. Use the payfail contract.
- **Every other SMS campaign:** use the standard contract.

Do not call a non-payfail campaign `payfail-*` merely to obtain dispatch
priority. If classification is ambiguous, ask before running Filter.

Never combine the standard and payfail contracts. Never remove a rule because
the source audience appears to satisfy it already.

## Hand off local workbooks and files

A path such as `/Users/<name>/Downloads/...` works only for an agent on that
machine. Do not use a developer-specific local path as a shared campaign
contract.

For another operator, remote agent, or later run:

1. Upload the untouched source workbook/file to an isolated campaign S3
   prefix using AES256.
2. Publish a source manifest with original filename, byte count, SHA256, sheet
   names, per-sheet row counts, parsed debt counts, duplicate counts, uploader
   timestamp, and S3 URI.
3. Parse every required sheet and reconcile source rows to unique debts.
4. Publish normalized Filter input files with the exact `debt_id` header under
   a separate `filter-input/` prefix.

Treat the workbook as immutable source evidence, not direct Filter input.
Never assume a team member can access the original local path.

## Standard SMS contract

Every non-payfail SMS campaign MUST pass the exact ordered contract proven by:

`arn:aws:states:us-east-2:014948052063:execution:FilterStateMachine2E447DC0-TPcQCbFc1gAN:credit-reporting-set-08-sms-deployed-bal25-rerun-20260923T081620Z`

The 54 ordered rule IDs are:

1. `has_single_version_2_phone_owner`
2. `not_in_bankruptcy`
3. `not_with_forward_vendor`
4. `not_with_debt_settlement_agency`
5. `not_uncollectable`
6. `not_out_of_statute_restricted_states`
7. `not_account_level_dnc`
8. `has_active_phone_number`
9. `no_1099c_sent`
10. `demand_letter_attempted`
11. `person_not_deceased`
12. `not_sold_back`
13. `not_represented_by_attorney`
14. `no_active_payment_plan`
15. `not_litigious`
16. `no_compliance_hold`
17. `no_open_complaint`
18. `no_operational_hold`
19. `no_creditor_request_hold`
20. `next_work_date_due`
21. `in_current_inventory`
22. `max_7_attempts_in_7_days`
23. `not_do_not_call`
24. `max_1_rpc_in_7_days`
25. `no_cease_and_desist`
26. `no_open_dispute`
27. `ma_max_2_attempts_per_week`
28. `wa_max_3_attempts_per_week`
29. `respect_preferred_calling_times`
30. `dc_max_2_attempts_per_week`
31. `no_open_formal_complaint_on_phone_number`
32. `no_business_phone_number`
33. `latest_phone_status_is_callable`
34. `max_3_calls_per_phone_per_day`
35. `sms_opt_in`
36. `do_not_text`
37. `not_account_level_dnt`
38. `cease_and_desist`
39. `sms_curfew`
40. `sms_frequency_5_in_7`
41. `daily_account_contact_limit_2`
42. `daily_sms_limit`
43. `state_restriction_MA`
44. `state_restriction_WA`
45. `state_restriction_DC`
46. `nyc_zip_restriction`
47. `oos_restrictions`
48. `represented_by_attorney`
49. `in_bankruptcy`
50. `third_party_placement`
51. `has_valid_10_digit_phone_number`
52. `has_single_bundle_for_ssn_identity`
53. `has_single_debt_for_person_owner`
54. `balance_over_25`

The standard contract intentionally:

- includes `balance_over_25`;
- excludes `balance_over_250`;
- excludes `has_single_assigned_address`;
- uses
  `communication-compliance-baseline/rules/daily_account_contact_limit_2/`,
  not the deleted stale
  `sms-interactions/rules/daily_account_contact_limit_2/`.

Resolve each rule ID to its current canonical deployed URI, then compare the
ordered IDs against this list. Fail closed on any missing, additional,
duplicate, reordered, stale, or inactive rule.

## Payfail SMS contract

Use the exact 52-rule contract proven by corrected execution:

`arn:aws:states:us-east-2:014948052063:execution:FilterStateMachine2E447DC0-TPcQCbFc1gAN:payfail-sms-recovery-20260923-20260923T161906Z`

The ordered rule IDs are:

1. `has_failed_or_returned_transaction_today`
2. `not_in_bankruptcy`
3. `not_with_forward_vendor`
4. `not_with_debt_settlement_agency`
5. `not_uncollectable`
6. `not_out_of_statute_restricted_states`
7. `not_account_level_dnc`
8. `has_active_phone_number`
9. `no_1099c_sent`
10. `demand_letter_attempted`
11. `person_not_deceased`
12. `not_sold_back`
13. `not_represented_by_attorney`
14. `not_litigious`
15. `no_compliance_hold`
16. `no_open_complaint`
17. `no_operational_hold`
18. `no_creditor_request_hold`
19. `next_work_date_due`
20. `in_current_inventory`
21. `max_7_attempts_in_7_days`
22. `not_do_not_call`
23. `no_cease_and_desist`
24. `no_open_dispute`
25. `ma_max_2_attempts_per_week`
26. `wa_max_3_attempts_per_week`
27. `respect_preferred_calling_times`
28. `dc_max_2_attempts_per_week`
29. `no_open_formal_complaint_on_phone_number`
30. `no_business_phone_number`
31. `latest_phone_status_is_callable`
32. `max_3_calls_per_phone_per_day`
33. `sms_opt_in`
34. `do_not_text`
35. `not_account_level_dnt`
36. `cease_and_desist`
37. `sms_curfew`
38. `sms_frequency_5_in_7`
39. `daily_account_contact_limit_2`
40. `daily_sms_limit`
41. `state_restriction_MA`
42. `state_restriction_WA`
43. `state_restriction_DC`
44. `nyc_zip_restriction`
45. `oos_restrictions`
46. `represented_by_attorney`
47. `in_bankruptcy`
48. `third_party_placement`
49. `has_single_version_2_phone_owner`
50. `has_valid_10_digit_phone_number`
51. `has_single_bundle_for_ssn_identity`
52. `has_single_debt_for_person_owner`

The payfail contract intentionally omits:

- `has_single_assigned_address`;
- `balance_over_25` and `balance_over_250`;
- `no_active_payment_plan`;
- `max_1_rpc_in_7_days`.

It retains `has_single_debt_for_person_owner`. Use the same canonical
`daily_account_contact_limit_2` path required by the standard contract.

### Exact standard versus payfail difference

The contracts share 50 rule IDs.

Standard-only rules:

- `no_active_payment_plan` — excludes accounts with an active payment plan;
- `max_1_rpc_in_7_days` — applies the standard recent-RPC frequency gate;
- `balance_over_25` — requires balance greater than $25.

Payfail-only rule:

- `has_failed_or_returned_transaction_today` — requires the qualifying
  failed/returned payment or failed-installment event.

Therefore `54 - 3 + 1 = 52`. Both contracts omit
`has_single_assigned_address` and `balance_over_250`; omission means those two
rules do not block the campaign. This comparison is limited to the reviewed
standard and payfail contracts, not every rule that exists in Lexicon.

For historical payfail dates, back-date the canonical payfail selector's
runtime Eastern-day bounds against the underlying event source. Do not pretend
a daily Filter output exists for a date when it does not.

## Prepare and run Filter

Use:

```json
{
  "input_s3_uri": "s3://<source>/",
  "rule_s3_uris": ["<exact ordered canonical contract>"],
  "save_rules_reports": false,
  "skip_report_metrics": true
}
```

- Require CSV header `debt_id`.
- For a large source, create exactly 200 balanced input files—200 files, not
  200 debts per file. For a small source, use the minimum safe nonempty count.
- Use AES256 and publish source object hashes.
- Use a deterministic execution name and collision-check before starting.
- Reuse prior output only when its exact input, ordered rule contract, business
  date/freshness, and object hashes match this campaign.

Certify the top-level execution and every Distributed Map child. Require zero
failures, pending/running children, timeouts, aborts, and pending redrives.
Prove:

```text
input = passed + rejected + not_loaded
```

Also prove source/pass/reject membership, no gaps or duplicates, expected file
totals, nonempty aggregate output, and AES256.

## Run live Interprose SMS scrub

Run after Filter through production PrivateLink in one read-only
`REPEATABLE READ` transaction.

### Connect to Interprose

1. Run from a SOC-network workstation or approved compute connected to a
   SOCAPITAL VPC, such as an SSM-managed EC2 worker.
2. Fetch secret `prod/interprose/endpoint/privatelink` from Secrets Manager in
   `us-east-2` using the selected AWS profile.
3. Read `host`, `port` (default `5432`), `database`, `username`, and
   `password` at runtime; never print or persist them.
4. Connect with PostgreSQL `sslmode=require`.
5. Start `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.
6. Restrict queries to the campaign debt IDs and required `spring.*` columns.
7. Capture transaction snapshot/isolation/read-only evidence, then commit.

Never write to Interprose through SQL. If PrivateLink is unreachable, use
approved VPC-connected compute; do not expose the database publicly.

Retain a debt only when:

- exactly one current SPRING account exists;
- account `active=true`, `debt_status_code=ACT`, `currentbal>0`;
- `do_not_txt` and `do_not_call` are not true;
- at least one supplied phone same-debt matches current
  `demographic_phone`;
- phone is valid US 10 digits, `active=true`, and `no_contact=false`;
- no same-debt/global SPRING row marks it bad, invalid, wrong, reassigned,
  consumer-blocked, DNC, do-not-call/contact, inactive, or disconnected;
- it is not currently opted out and has no historical SMS opt-out event/date.

Remove unsafe phones and drop debts left with no safe SMS phone. Publish
account/phone exclusion evidence, counts, hashes, and transaction proof.

## Require live PRIMARY ZIP

Read current production Interprose `spring.demographic` rows whose type is
`PRIMARY`. Require exactly one valid ZIP and normalize to ZIP5. Do not use
Persist/Graph ZIP, residential/mailing unions, or `interprose_current`
snapshots for this gate.

`ZIP5` means the first five numeric digits of a US postal code. Normalize
`12345`, `12345-6789`, or `123456789` to `12345`; reject missing values or
values with fewer than five digits.

## Deduplicate against today's sends

Before creating the final payload, build a current provider/admission
inventory from lifecycle executions, selected-action artifacts, dispatch
backlog, and active reservations.

- Include running/succeeded and actually admitted/enqueued/submitted
  campaigns.
- Include aborted campaigns when they have real admission/submission.
- Ignore aborted campaigns with zero admission/enqueue/submission.
- Exclude exact debt overlap.
- Remove shared normalized phones.
- Drop a debt if no phone remains.
- Enforce globally unique final phones.

Default to zero overlap. Proceed with known overlap only when the user
explicitly authorizes it; record that exception in the final audit.

## Certify template, campaign, and payload

Verify the Git-backed template is active and its ID/name/channel match. Check
the campaign identifier against Step Functions, lifecycle, backlog, send
context, and reservations.

Publish:

- final nonempty `parts/results/`;
- account/phone/ZIP/provider audits;
- debt-phone reservation;
- SHA256 manifest and AES256 proof;
- final certification;
- SMS orchestration payload.

Use:

```json
{
  "input_s3_uri": "s3://<certified-final>/parts/results/",
  "template_identifier": "<active-template-id>",
  "steps_to_skip": ["filter"],
  "campaign": {
    "name": "<unique-campaign-id>",
    "campaign_identifier": "<unique-campaign-id>",
    "purpose": "<business purpose>"
  }
}
```

Do not use `steps_to_skip:["filter"]` until Filter and every downstream
certification gate above have passed.

Campaign identifiers beginning with `payfail` automatically enter the SMS
`PRIORITY` dispatch lane. There is no supported priority input field.

## Start only with approval

Preparing or returning a payload does not authorize starting SMS. Start
`SmsOrchestrationWorkflowStateMachine` only after the user explicitly says to
start/send. Verify `RUNNING` and return the execution link. Do not separately
start assignment, rendering, dispatch, or provider sending.

## Report

Return source, Filter pass/reject/not-loaded, Interprose exclusions, safe
phones, ZIP exclusions, provider debt/phone overlaps, final debt/phone counts,
rule contract name/count, execution links, final/audit/reservation URIs,
payload, and whether SMS was started.
