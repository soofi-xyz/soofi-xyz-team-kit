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

## Invoke the correct Filter rules

Use `gallade` for Filter/Rules changes and operations. Read the
[batch contract](../../build-rules-product/reference/implementation/batch-contract.md) and
[rule selection contract](../../build-rules-product/reference/implementation/rules-and-queries.md).

Keep the two decisions separate:

- `candidate_scopes: ["phone"]` selects phone candidates used by SMS.
- `rule_context` selects the SMS rules from the actual active Lexicon catalog.
  Omitting context selects the default `phone` ruleset; phone candidates alone
  do not select SMS suppression rules.

Resolve required consumer/campaign/lane context values from the target catalog
and register a stable `rule_context.consumer` with the capacity controller. Use
this illustrative shape only after replacing the example consumer and verifying
the catalog's channel value:

```json
{
  "input_s3_uri": "s3://tenant-input/sms/",
  "rule_context": { "consumer": "example-sms-consumer", "channel": "SMS" },
  "candidate_scopes": ["phone"],
  "save_rules_reports": true
}
```

Use report mode to establish suppression evidence: default filter-mode counts
combine excluded and graph-missing input debts and omit per-rule explanations.
An explicit `rule_s3_uris` subset bypasses catalog selection; context does not
automatically add SMS suppressions to that subset. Verify its actual rule content.

For email handoffs, select email rules and `candidate_scopes: ["email"]`, preserving
`eligible_email_candidates` metadata. Selecting both `phone` and `email` uses AND
semantics. Run separate executions for an email OR SMS audience, then define the
downstream union/deduplication policy explicitly.

Keep `run_eligibility_ingest` unset/false for SMS, email and campaign runs. It is
reserved for the intended daily phone-call eligibility producer. Verify live
Lexicon suppression cases before declaring any channel ready; this schema alone
does not establish deployed rule coverage.

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

Treat these as downstream-compatible optional fields. Verify what the current
Filter projection actually supplies before requiring them; do not promise that
all communication-history fields are emitted by Filter.

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
