# Interprose SMS scrub reference

Run every query in one `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`
transaction, restricted to the campaign's Filter-passed debt ids and their
supplied phones. Capture `now()`, `txid_current_snapshot()`, isolation, and
read-only state at the start and end, then commit. Never write to Interprose.

## Reads

```sql
-- accounts
select debt_id, customer_id, active, debt_status_code, last_status_code,
       currentbal, do_not_txt, do_not_call, worklist_id
from spring.account where debt_id = any(:debts);

-- sell-back worklist membership (independent of account.worklist_id)
select distinct debt_id from spring.worklist_debt
where worklist_id = 1151 and debt_id = any(:debts);

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
4. `active` not true: `account_inactive`;
5. `debt_status_code` not `ACT`: `status_<code>`;
6. `currentbal` not above 0: `zero_balance`;
7. `do_not_txt` true: `do_not_txt`;
8. `do_not_call` true: `do_not_call`.

Independently of that order, report three operator-check counts: debts with
any SPRING row in `SLDBCK`, debts with `account.worklist_id = 1151`, and debts
in `worklist_debt` 1151. They are expected to be 0 after Filter; a non-zero
count is still excluded and must be called out.

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
