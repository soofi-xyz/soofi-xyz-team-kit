# Runtime Data Contract

Use `CDM/graph` as the runtime's canonical decision surface and lexicon as the only allowed schema.

Before designing graph queries or persisted runtime facts, verify the latest entities, edges, properties, and enums against the authoritative graph schema. If the runtime must read or write through a persistence service, pin its contract before downstream design.

See [`../reference/current-solver-parity.md`](../reference/current-solver-parity.md) for the compact parity view.

## Internal Enriched Candidate Contract

After `xatu` hands the external intake to the runtime, enrich into the internal SMS decisioning contract before scheduling.

At minimum include:

- `person_id`
- `debt_id`
- `phone_number_id`
- `phone_number_e164`
- `campaign_identifier`
- `local_timezone`
- `current_balance`
- `tu_score`
- `pbi_score` or equivalent phone-quality evidence
- phone-contactability evidence
- phone-verification evidence
- recent call and text counts
- allowed send hours
- communication windows
- call anchors
- settlement and payment-plan offer flags for template choice
- language and any required compliance context
- any required campaign-scoped template parameters
- any message-rendering fields required to build the final send file

The runtime should assume hard suppressions were already applied upstream by `xatu` and `filter`.

## Campaign Parameter Contract

When a launch or `Campaign Assignment v1` uses `last_day_to_prevent_placement`, keep the field optional in the external launch contract but persist it as a campaign-scoped fact before rendering or send execution depends on it.

Launch contract rules:

- required parameter keys come from the selected template query
  `has('parameter_key', ...)` plus the template's variables listing
- place the value inside the `campaign` object as:
  ```json
  "parameters": {
    "last_day_to_prevent_placement": {
      "type": "DATE",
      "value": "YYYY-MM-DD"
    }
  }
  ```
- reject flat `campaign.last_day_to_prevent_placement` and top-level
  `last_day_to_prevent_placement` forms
- use the same `campaign.parameters` container for SMS and email launches
- validate the container and pass the whole `campaign` object to
  `Campaign Assignment v1`
- keep the launch-by-S3 plus inline `campaign` contract; do not replace it
  with a campaign-only by-ID launch
- the only business rule for this parameter is that the DATE value is strictly
  after the `America/New_York` run day

Persist shape:

- vertex label: `campaign_parameter`
- edge label: `campaign_has_parameter`
- `parameter_key = last_day_to_prevent_placement`
- store the date in `date_value`
- do not set `value_type` on the vertex; Persist reserves that property name

Write semantics:

- first write wins
- a repeat write with the same date is idempotent
- a repeat write with a different date fails instead of silently rewriting history

## Required Graph Facts

The runtime should be able to reason over these graph-native concepts:

- `person`
- `debt`
- `phone_number`
- `portfolio`
- `tu_score`
- `communication_preference`
- `communication_preference_day_window`
- `phone_contactability_profile`
- `phone_verification_result`
- `phone_call`
- `text_message`

Commonly needed supporting facts:

- settlement availability
- short-link or visit history
- preferred language
- timezone or local-hour context

## Candidate-Action Contract

The canonical pre-allocation shape is:

`(person, debt, phone, send_hour, policy_date)`

Each candidate hour row should carry:

- stable identifiers
- the candidate send hour
- the score inputs used to evaluate it
- the policy version that produced it

After hour assignment, add:

- the chosen template family
- the rendered message payload
- the final scheduled send timestamp

## Output Contract

Emit at least these artifacts:

1. `selected_actions`
2. `overflow_unscheduled_actions`
3. `run_summary`
4. `scheduled_send_files`

Each selected or overflow row should include:

- action identifiers
- selected or chosen send slot
- chosen template family when applicable
- final score
- score breakdown where applicable
- win or loss reason
- policy version
- run timestamp

The overflow artifact should include both:

- frontier losses that never reached OR-Tools
- OR-Tools overflow or unscheduled records

Each scheduled send row should include at least:

- `message_id`
- `debt_id`
- `phone_number`
- `scheduled_send_ts`
- `template_family`
- rendered `message`
- `campaign_identifier`
- campaign or routing metadata needed for execution handoff

## Graph Modeling Rules

- do NOT invent new vertex labels, edge labels, or properties without first confirming lexicon support
- if the runtime needs a new persisted concept, add it to lexicon first
- if a concept remains runtime-local for now, keep it in runtime output artifacts instead of pretending it already exists in graph
- keep entity names and properties consistent with lexicon and persist expectations
