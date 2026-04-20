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
- any message-rendering fields required to build the final send file

The runtime should assume hard suppressions were already applied upstream by `xatu` and `filter`.

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
- campaign or routing metadata needed for execution handoff

## Graph Modeling Rules

- do NOT invent new vertex labels, edge labels, or properties without first confirming lexicon support
- if the runtime needs a new persisted concept, add it to lexicon first
- if a concept remains runtime-local for now, keep it in runtime output artifacts instead of pretending it already exists in graph
- keep entity names and properties consistent with lexicon and persist expectations
