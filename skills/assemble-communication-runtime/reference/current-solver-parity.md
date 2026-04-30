# Current Solver Parity

Use this file as the compact source of truth for how the SMS runtime assembled by `Oranguru` should match the current `filter` -> `solver` workflow while still extending it for SMS.

## Workflow Shape To Preserve

The current `solver` workflow is shaped like this:

1. receive `input_s3_uri`
2. read filtered S3 results
3. enrich the rows before scheduling
4. prepare candidate rows in Glue / Spark
5. reduce the candidate set before OR-Tools
6. compute scores
7. allocate under daily and hourly capacity
8. emit selected, overflow, summary, and downstream handoff artifacts

The SMS runtime should keep that exact outer workflow shape.

## Worker Boundaries

- `xatu` owns the upstream audience handoff into this runtime contract
- `wigglytuff` owns template inventory and sync
- `chatot` owns the communication-activity contract around send execution and feedback
- `oranguru` owns the runtime that applies this parity

## What Should Stay Identical

These behaviors should remain aligned with the current `solver`:

- same external intake style: `input_s3_uri`
- same upstream handoff model: filtered S3 `results`
- same stage order: ingest -> enrich -> prep -> reduce -> score -> allocate -> emit
- same "choose one best phone first" pattern before optimization
- score before OR-Tools, not after
- explicit overflow / unscheduled output
- daily capacity and hourly capacity are both part of the optimization problem

## What SMS Should Modify

These are intentional SMS extensions:

- template-family selection after hour assignment
- call-reinforcement slot generation
- scheduled send files as the final runtime output artifact
- execution handoff into `chatot`
- feedback artifacts for send, click, PTP, payment, opt-out, and complaint outcomes

## Scoring Parity

Keep these current `solver` ideas first-class:

- `balance` is a primary economic anchor
- `tu_score` remains explicit
- phone quality remains explicit
- recent outreach and time-window fit still matter

For SMS, encode those ideas as:

- frontier reduction score driven by `balance`, `TU`, and phone confidence
- hour assignment score driven by balance, phone confidence, TU, recent-contact penalty, and time-window fit

Treat `PBI` as phone-quality evidence, not as the whole policy.

Keep recent text handling aligned with the call solver:

- `14_days_text_messages` contributes to the recent-contact penalty
- it is not a hard solver-side cooldown

## Capacity And Outputs

The SMS runtime should allocate with OR-Tools `SimpleMinCostFlow` under:

- total daily SMS cap
- hourly bucket caps
- one chosen hour per frontier context
- already-gated legal slots

Always emit:

- `selected_actions`
- `overflow_unscheduled_actions`
- `run_summary`
- `scheduled_send_files`

## Prompt Implication

The user prompt should not need to restate the current `solver`, `filter`, or SMS design docs. The worker skills should already carry that domain context.
