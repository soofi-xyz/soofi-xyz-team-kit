# Opt-out suppression reference

## Verify the list

- Download `union_suppression.csv` and `summary.json` from the version folder
  the operator names (for example
  `incident/sms-optout-2026-10-19/combined-suppression-<date>/` in the SMS
  lifecycle artifact bucket). Use the newest version the operator approves;
  each version is a superset of the previous one.
- Record SHA-256, byte count, `LastModified`, and row count. Require every
  `phone` to be exactly 10 digits and unique. The `in_*` columns name the
  sources that contributed each number; aggregate removals by them.
- Read the list's Quiq cut-off from the newest `refresh_<date>` block:
  `quiq_delta.cutoff_exclusive_utc` is where that delta started and
  `quiq_delta.latest_event_included_utc` is the last Quiq event the list
  contains. The top-level `quiq_incremental_updates` window belongs to an
  earlier version.

## Quiq opt-outs after the list cut-off

- Source: `s3://so-quiq-events/quiq-inbound/bi-data/springoakscapital/<YYYY-MM-DD>/CustomerOptOutStatusChanged-*.json`
  (UTC ingest-date folders). Each object has `timestamp` (epoch ms) and
  `data.updates[]` with `platform`, `optedOut`, and `handle`.
- Read folders from the day before the window start through today. Keep only
  `platform = SMS`, normalize `handle` to its last 10 digits, and take the
  latest event per phone.
- Suppress a phone whose latest event is `optedOut = true` with a timestamp
  after the window start. A latest `optedOut = false` never removes a number
  that is already on the list.
- A window that starts earlier than the list's last included event is safe; it
  only re-reads opt-outs already on the list. Report both the phones after the
  window start and the phones after `latest_event_included_utc`.

## Apply

1. Input: the post-PRIMARY-ZIP audience.
2. For each `phone_numbers[]` entry, remove it as `list` if its last 10 digits
   are on the list, otherwise as `quiq_after_list` if it is a Quiq opt-out
   above.
3. Drop debts with no remaining phone.
4. Assert `phones_in - phones_removed = phones_out`,
   `debts_in - debts_dropped = debts_out`, and 0 remaining overlap.

## Opt-out summary (counts only)

```json
{
  "step": "optout-suppression",
  "suppression_list": {"version_folder": "...", "sha256": "...", "rows": 0,
                       "quiq_delta_start_exclusive_utc": "...",
                       "quiq_latest_event_included_utc": "..."},
  "quiq_after_list_check": {"window_utc": ["<start> (exclusive)", "<latest event at read>"],
                            "files_read": 0, "phones_latest_optout_in_window": 0,
                            "phones_latest_optout_after_list_latest_event": 0,
                            "matches_in_audience": 0},
  "debts_in": 0, "debts_out": 0, "phones_in": 0, "phones_out": 0,
  "phones_removed": 0, "phones_removed_by_source": {"list": 0, "quiq_after_list": 0},
  "debts_dropped": 0
}
```

Keep a phone-level removal file locally only; it contains phone numbers.

## Final build

- Re-read Quiq from the opt-out step's latest event and remove any new
  opt-outs from the deduped audience (`quiq_final_refresh`).
- In a fresh read-only Interprose transaction over the final debts, count
  SPRING accounts with `do_not_txt = true` and final phones with
  `txt_msg_status = 'OPTED_OUT'` or a `txt_msg_opt_out_date` on any SPRING
  debt. Both must be 0, and every final debt must have one SPRING account.
- Write the final-build audit with `final_counts`, every removal stage
  (operator removals, same-day dedupe, Quiq final refresh), and the controls:
  unique debts and phones, 0 list overlap, 0 Quiq overlap, 0 same-day inventory
  overlap.
