# SMS Orchestration Data Contracts And Testing

Use this rule when implementation details are needed beyond the quick checklist in `SKILL.md`.

## Canonical Contracts

### Filter Output

Filter output must be replayable from S3 and include enough identifiers for the solver to avoid re-deriving eligibility:

- `debt_id`
- `person_id`
- phone candidates and phone identifiers
- channel eligibility evidence
- recent-contact/legal-window evidence when relevant
- rule report URI when saved

### Solver Scheduled Send Row

The solver output consumed by rendering/lifecycle must include:

- `message_id`: UUID string
- `debt_id`
- `person_id`
- `phone_number_id`
- `phone_number`
- `scheduled_send_ts`
- `scheduled_hour`
- `template_identifier`
- `provider: "QUIQ"`
- `policy_version`
- routing/runtime metadata

### Rendered Send Row

Rendering should compact the row for lifecycle:

- `message_id`
- `debt_id`
- `phone_number`
- `scheduled_send_ts`
- `template_identifier`
- `asset_id`
- `interaction_identifier`
- `rendered_message`
- `render_status`
- `provider`
- `policy_version`

### Send Context

Persist one row keyed by Quiq `providerMessageId`:

- `providerMessageId`: Quiq message id
- `messageId`: local Kadabra UUID
- `debtId`
- `phoneNumber`
- `templateIdentifier`
- `interactionIdentifier`
- `messageBody`
- `sentAt`
- `providerStatus`
- route/contact-point metadata

### Interprose `sms_log`

Pipe-delimited column order:

```text
debt_id|phone_number|msg|sent_date|vendor_result|txt_msg_template_id|vendor_tracking_code|te_id|interaction_identifier
```

`te_id` is the Quiq provider message id. `interaction_identifier` is the Jigglypuff-rendered interaction id for the corresponding send.

## Test Fixtures

Keep small fixtures for:

- one eligible filtered debt
- one solver scheduled row
- one rendered row with `asset_id` and `interaction_identifier`
- one Quiq accepted response
- one raw `NotificationsDeliverabilityStatus` event for `Sent`
- one raw event for `Delivered`
- one opt-out event

## E2E Assertions

An E2E run is not complete until all of these are true:

- the rendered message body matches the Jigglypuff artifact
- Quiq payload uses `assets: [{ "assetId": "..." }]`
- send context contains both local `messageId` and Quiq `providerMessageId`
- raw Quiq S3 has an event for the provider id
- processed JSONL rows are written under the expected export date
- `sms_log` includes the delivered/sent row and the final `interaction_identifier` column
- SFTP upload logs show the final files reached `incoming/SOC Datawarehouse/`
