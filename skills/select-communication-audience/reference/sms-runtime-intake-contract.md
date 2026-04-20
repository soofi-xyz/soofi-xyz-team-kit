# SMS Runtime Intake Contract

Use this file as the canonical audience-handoff contract that `Xatu` hands to the SMS runtime.

## Filter Boundary

For the current SMS service, upstream `filter` owns hard suppressions and contact eligibility.

The runtime should not recreate hard suppressions for:

- opt-out and do-not-text rows
- invalid, disconnected, or non-mobile phones
- customer-level suppression across debts
- complaint and wrong-party exclusions

If those rows still appear in runtime input, fix `filter` instead of duplicating the logic downstream.

## Runtime Entrypoint

The current SMS runtime should accept:

- `input_s3_uri`
- a URI that points to one file or an S3 prefix
- JSON with a top-level `results` array

## Outer Record Shape

The filtered debt payload should preserve the same outer shape the current `solver` already reads.

Required debt fields:

- `debt_identifier`
- `balance`
- `phone_numbers`

Common optional debt fields:

- `first_name`
- `last_name`
- `postal_code`
- `preferred_language`
- `tu_score`
- `allowed_call_hours`
- `14_days_phone_calls`
- `14_days_text_messages`
- `14_days_emails`
- `14_days_letters`

Each `phone_numbers[]` entry should preserve the current solver-friendly fields:

- `phone_number`
- `latest_phone_status`
- `latest_rpc_contact_date`
- `overall_call_start_time`
- `overall_call_end_time`
- `phone_usage_12_months`
- `verified`
- `verification_result`
- `day_windows[]`

## Handoff Rules

`Xatu` should package eligible rows so the runtime does not need to rediscover the audience from raw systems.

The handoff should remain:

- explicit
- replayable
- auditable
- stable enough for downstream runtime reuse
