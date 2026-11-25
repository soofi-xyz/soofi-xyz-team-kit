# Interprose SMS scrub reference

Run every query in one `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`
transaction, restricted to the campaign's Filter-passed debt ids and their
supplied phones. Capture `now()`, `txid_current_snapshot()`, isolation, and
read-only state at the start and end, then commit. Never write to Interprose.

## Connect to Interprose

1. Run from a SOC-network workstation or approved compute connected to a
   SOCAPITAL VPC, such as an SSM-managed EC2 worker.
2. Fetch secret `prod/interprose/endpoint/privatelink` from Secrets Manager in
   `us-east-2` using the selected AWS profile.
3. Read `host`, `port` (default `5432`), `database`, `username`, and
   `password` at runtime; never print or persist them.
4. Connect with PostgreSQL `sslmode=require`.
5. Start `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.
6. Restrict queries to the campaign debt IDs, the person keys of those debts,
   and the required `spring.*` columns.
7. Capture transaction snapshot/isolation/read-only evidence, then commit.

Never write to Interprose through SQL. If PrivateLink is unreachable, use
approved VPC-connected compute; do not expose the database publicly.

## Reads

```sql
-- accounts
select debt_id, customer_id, active, debt_status_code, last_status_code,
       currentbal, do_not_txt, do_not_call, worklist_id
from spring.account where debt_id = any(:debts);

-- sell-back worklist membership (independent of account.worklist_id)
select distinct debt_id from spring.worklist_debt
where worklist_id = 1151 and debt_id = any(:debts);

-- person keys for the campaign debts
select a.debt_id, a.bundle_id, d.national_id_hash
from spring.account a
left join spring.demographic d
  on d.debt_id = a.debt_id and d.demographic_type = 'PRIMARY'
where a.customer_id = 'SPRING' and a.debt_id = any(:debts);

-- bankruptcies on any SPRING debt of those people, including non-campaign debts
select a.debt_id, a.bundle_id, d.national_id_hash, b.id as bankruptcy_id,
       upper(trim(coalesce(b.status, ''))) as status,
       coalesce(b.dismissed, false) as dismissed
from spring.account a
join spring.bankruptcy b on b.id = a.bankruptcy_id
left join spring.demographic d
  on d.debt_id = a.debt_id and d.demographic_type = 'PRIMARY'
where a.customer_id = 'SPRING'
  and (a.bundle_id = any(:bundle_ids) or d.national_id_hash = any(:ssn_hashes));

-- same-debt phones
select debt_id, phone_number, active, no_contact, status,
       txt_msg_status, txt_msg_opt_out_date, customer_id
from spring.demographic_phone where debt_id = any(:debts);

-- the same phone on any SPRING debt
select debt_id, phone_number, active, no_contact, status,
       txt_msg_status, txt_msg_opt_out_date
from spring.demographic_phone
where customer_id = 'SPRING' and phone_number = any(:phones);

-- historical STOP replies and provider opt-out results
select debt_id, inbound_phone_number, phone_number from spring.txt_msg_log
where debt_id = any(:debts)
  and (upper(trim(msg)) = any(:stop_words)
       or inbound_status ilike '%opt%out%'
       or vendor_result ilike '%opt%out%' or vendor_result ilike '%stop%');

-- PRIMARY ZIP (same transaction)
select debt_id, zip from spring.demographic
where demographic_type = 'PRIMARY' and debt_id = any(:debts);
```

`:stop_words` is `STOP`, `STOPALL`, `STOP ALL`, `UNSUBSCRIBE`, `CANCEL`, `END`,
`QUIT`, `OPT OUT`, `OPTOUT`, `REVOKE`. Do not filter `txt_msg_log` on
`inbound_phone_number is not null`; many genuine opt-outs only carry
`vendor_result=OPTED_OUT`. Match a STOP row to the debt-phone pair through
either its inbound or outbound phone.

## Account gate order

Evaluate only the SPRING account row; the first failing reason wins:

1. not exactly one SPRING row: `spring_account_rows_<n>`;
2. `debt_status_code` or `last_status_code` is `SLDBCK`: `status_sldbck`;
3. `worklist_id = 1151` or present in `worklist_debt` 1151: `worklist_1151_sell_back`;
4. an active bankruptcy on any SPRING debt sharing the debt's `bundle_id` or
   PRIMARY `national_id_hash`: `person_bankruptcy`;
5. `active` not true: `account_inactive`;
6. `debt_status_code` not `ACT`: `status_<code>`;
7. `currentbal` not above 0: `zero_balance`;
8. `do_not_txt` true: `do_not_txt`;
9. `do_not_call` true: `do_not_call`.

Gate 4 exists because Interprose records bankruptcy on a single debt
(`account.bankruptcy_id`) and Filter's `not_in_bankruptcy` and `in_bankruptcy`
rules evaluate only that debt, while bankruptcy applies to the person. Drop
every campaign debt of the person, whether the bankruptcy sits on that debt or
on another SPRING debt outside the campaign. Remove this gate only after the
Lexicon rules block bankruptcy per person.

A bankruptcy row is cleared only when `status <> 'REINSTATED'` and
(`dismissed = true` or `status = 'DISMISSED'`); every other row is active.
Ignore null `bundle_id` and null `national_id_hash` keys when matching, so
unrelated debts with missing keys never link.

Independently of that order, report these operator-check counts: debts with
any SPRING row in `SLDBCK`, debts with `account.worklist_id = 1151`, debts in
`worklist_debt` 1151, and person-bankruptcy debts split by where the active
bankruptcy sits (`same_debt`, `same_bundle`, `same_ssn_hash_only`). SLDBCK and
1151 are expected to be 0 after Filter. `same_debt` is expected to be 0 after
Filter; `same_bundle` and `same_ssn_hash_only` are not, because Filter checks
only the debt itself. Every non-zero count is still excluded and must be
called out.

## Phone gate order

Per supplied phone of a retained account; the first failing reason wins:

1. not a valid US 10-digit number (`^[2-9][0-9]{2}[2-9][0-9]{6}$`): `invalid_10_digit`;
2. no same-debt SPRING `demographic_phone` row: `no_same_debt_demographic_phone`;
3. any same-debt row blocked: `same_debt_<reason>`;
4. any global SPRING row for the phone blocked: `global_<reason>`;
5. a STOP/opt-out `txt_msg_log` row for the pair: `historical_stop_message`.

A row is blocked, checked in this order, when `txt_msg_status = 'OPTED_OUT'` or
`txt_msg_opt_out_date` is set (`sms_opted_out`), `no_contact` is true
(`no_contact_<status>`), `status` is not `NEW`, `VERIFIED`, or `ACTIVE`
(`status_<status>`), or `active` is not true (`inactive`).

Drop a debt with no remaining phone as `no_safe_sms_phone`. Then apply the
PRIMARY ZIP gate to the survivors and overwrite `postal_code` with the live
ZIP5.

## Evidence

Publish counts by reason for account, phone, and ZIP exclusions, the
transaction block, source row counts, per-file SHA-256, and a membership hash.
Keep exclusion CSVs that contain debt ids or phones in the campaign prefix
only; never paste ids or phones into chat or shared reports. Assert
`filter_passed = scrubbed + account_exclusions` and
`scrubbed = zip_passed + zip_exclusions`.
