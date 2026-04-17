# Runtime Candidate Generation And Eligibility

Generate the candidate universe in the same staged order as the current `solver`, starting from rows that are already hard-eligible from `xatu`.

## Stage Order

Keep this order explicit:

1. ingest filtered `results` rows from `input_s3_uri`
2. enrich them with SMS scheduling facts
3. choose one best phone per debt/person context
4. reduce to a best debt/phone frontier
5. derive legal send slots from contact window start/end and allowed hours
6. carry template eligibility forward for post-schedule selection
7. expand to candidate hour rows

This preserves the current `solver` pattern of reducing candidates before expensive optimization.

## Traversal Order

Use the filtered debt/person/phone input as the starting point, then keep the call-solver-style best-phone reduction:

1. start from filtered debt rows
2. attach candidate `phone_number` records that survived upstream filtering
3. enrich them with balance, TU, windows, calls, texts, and template context
4. rank phones per debt and keep one best phone
5. carry only that best phone into downstream scheduling

This keeps the same "choose one best phone first, then schedule" behavior as the current call solver.

## Frontier Reduction

Do not send every eligible row directly into hourly scheduling.

First build a frontier that keeps:

- at most one winning context per `debt_id`
- one best phone for that context
- one SMS action per debt/person per run

## Send Slot Generation

Generate only meaningful legal slots.

Common slot types:

- `same_hour_call_reinforcement`
- `pre_call_0_30m`
- `post_call_0_30m`
- `standalone_best_hour`

Every slot must already satisfy:

- legal time-of-day rules
- timezone correctness
- communication-preference windows
- any allowed contact-window start/end boundaries passed from input

Use the same contact-window logic as the call solver when building and evaluating hours.

## Template Family Context

Do not let template families explode the OR-Tools search space.

Baseline families:

- `settlement`
- `payment_plan`
- `blanket`

Typical gating:

- allow `settlement` only when live settlement context exists
- allow `payment_plan` only when payment-plan context exists
- keep `blanket` as the fallback family

Carry allowed template families forward so the runtime can choose the best family after hour assignment.

## Output Of This Stage

Produce:

- `frontier_candidates`
- `frontier_overflow`
- `candidate_hours`

Each frontier loss should explain why it lost. Each candidate hour row should already carry the legal send hour and the template context needed for downstream scoring and post-schedule template choice.
