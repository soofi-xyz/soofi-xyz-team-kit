# Runtime Scoring And Time Slotting

Score one candidate hour at a time:

`(person, debt, phone, send_hour)`

The score should answer:

`How valuable is it to send this text to this phone at this time?`

## Preserve These Solver Drivers

Keep these current `solver` ideas first-class:

- `balance` as a primary value anchor
- `tu_score` as an explicit credit or collectability signal
- phone-quality evidence as an explicit driver
- recent outreach and timing-window fit as meaningful score inputs

Do not hide `balance`, `TU`, or phone quality behind vague ML-score language.

## Two Scoring Stages

Use two scoring stages so the workflow mirrors the current `solver` pattern of reducing first, then optimizing.

### 1. Frontier Priority Score

Use a debt/phone frontier score before hourly allocation.

Recommended baseline:

```text
frontier_priority_score
  = 0.45 * normalized_balance_score
  + 0.30 * phone_confidence_score
  + 0.15 * normalized_tu_score
  - 0.10 * recent_contact_penalty
```

### 2. Final Hour Score

After the frontier is chosen, score each legal send hour.

Use these normalized score components:

- `collections_value_score`
- `phone_confidence_score`
- `tu_score`
- `recent_contact_penalty`
- `day_window_fit_score`
- `overall_window_fit_score`
- `call_coordination_bonus`

Start from the current call-solver shape, not a separate SMS-only ranking model.

```text
hour_assignment_score
  = balance_anchor
  + phone_quality_bonus
  + tu_score_bonus
  - recent_contact_penalty
  + day_window_fit_bonus
  + overall_window_fit_bonus
  + call_coordination_bonus
```

## What Feeds Phone Confidence

Build `phone_confidence_score` from phone-quality evidence rather than one raw field.

Important inputs:

- contactability profile
- verification result
- wireless or mobile evidence
- PBI-style signals

Recommended baseline:

```text
phone_confidence_score
  = 0.35 * contactability_score
  + 0.30 * verification_score
  + 0.20 * pbi_score
  + 0.15 * mobile_confidence_score
```

PBI belongs here as phone-quality evidence. It should not replace `balance`, `TU`, or the rest of the policy.

## Recent Contact Treatment

Keep recent text handling aligned with the current call solver:

- use `14_days_text_messages` as part of the recent-contact penalty
- do NOT treat recent text as a hard runtime-side cooldown
- combine text counts with other 14-day outreach counts the same way the call solver combines channels

Recommended channel weights:

- phone calls: `2.00`
- text messages: `0.50`
- emails: `0.25`
- letters: `0.10`

## Time Slotting Principles

The runtime must optimize both:

- daily selection
- hourly distribution

Do NOT:

- send the full day at one earliest hour
- assume local `8am` is always the best hour
- rank debt value first and treat time as an afterthought

Do:

- generate timezone-correct slots
- value same-hour or near-call reinforcement when it improves expected value
- mirror the call solver's window-fit and hourly distribution logic for SMS timing
- allow per-hour capacities so distribution is part of the solve

## Template Family Selection

Template choice is contextual, but it should happen after hour assignment, not inside OR-Tools.

Recommended flow:

1. use OR-Tools to decide `who` and `when`
2. for each selected row, choose the best allowed template family for that chosen hour and context
3. render the final message after template choice
