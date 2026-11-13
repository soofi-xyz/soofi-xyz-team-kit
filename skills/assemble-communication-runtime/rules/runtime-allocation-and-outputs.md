# Runtime Allocation And Outputs

Use OR-Tools `SimpleMinCostFlow` as the default SMS allocation engine unless the problem requires a more expressive formulation.

For implementation mechanics, also load [`build-solver-services`](../../build-solver-services/).

See [`../reference/current-solver-parity.md`](../reference/current-solver-parity.md) for the compact parity view.

## Solver-Style Allocation Shape

Recommended topology:

`Source -> FrontierItem -> HourBucket -> DailyBudget -> Sink`

Add overflow when capacity may be exhausted:

`Source -> FrontierItem -> Overflow -> Sink`

Where:

- `FrontierItem` is the surviving `(person, debt, phone)` context
- `HourBucket` enforces hourly allocation
- `DailyBudget` enforces the total send cap

## Capacity Rules

The allocation stage should enforce:

- one chosen hour per frontier item
- one SMS action per debt/person per run
- hourly slot capacities
- total daily SMS capacity
- already-gated legal slot eligibility from contact windows

Use candidate generation and frontier reduction to remove impossible or dominated rows before they reach OR-Tools.

## Cost Mapping

Min-cost flow minimizes cost, so convert high-value actions into low-cost edges.

Typical pattern:

- compute `hour_assignment_score`
- scale it to an integer
- transform it into a unit cost
- keep overflow slightly worse than the worst valid scheduled action, such as `max_assignment_cost + 1`

Do not push eligibility or template gating into cost math when they should already have been handled earlier.

## Runtime Outputs

Always emit:

1. `selected_actions`
2. `overflow_unscheduled_actions`
3. `run_summary`
4. `scheduled_send_files`

### `selected_actions`

Each selected row should include:

- action identifiers
- selected hour or slot
- final score
- score breakdown
- policy version
- why it won

After hour assignment, add:

- chosen template family
- rendered message payload
- final scheduled send timestamp

### `overflow_unscheduled_actions`

Each overflow row should include:

- action identifiers
- whether it lost at frontier or allocation stage
- loss reason
- conflict or capacity reason
- score
- policy version

### `run_summary`

Summarize at least:

- inputs read
- candidates excluded
- frontier candidates retained
- frontier candidates dropped
- candidate hours scored
- actions selected
- overflow count
- capacity used by hour

### `scheduled_send_files`

The final operational artifact should contain one row per scheduled SMS in the exact shape the execution workflow needs.

Each row should include at least:

- `message_id`
- `debt_id`
- `phone_number`
- `scheduled_send_ts`
- `template_family`
- rendered `message`
- `campaign_id`
- `campaign_identifier`
- `last_day_to_prevent_placement` when the selected template requires it
- campaign or routing metadata needed for execution handoff

## Campaign Assignment And Rendering Handoff

After allocation and template choice:

- keep the launch-by-S3 plus inline `campaign` contract; do not replace it
  with a campaign-only by-ID launch
- derive required parameter keys from the selected template query
  `has('parameter_key', ...)` plus the template's variables listing
- pass `last_day_to_prevent_placement` through to `Campaign Assignment v1`
  inside `campaign.parameters` as:
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
- use the same `campaign.parameters` container for SMS and email launches;
  email dry runs keep `submit_to_arda: false`
- validate the container and pass the whole `campaign` object to
  `Campaign Assignment v1`
- apply only one business rule for this key: the DATE value must be strictly
  after the `America/New_York` run day
- pass `campaign_id` on every Jigglypuff render batch so template lookups can resolve `{{campaign_identifier}}`
- keep the scheduled-send artifact explicit enough that downstream execution does not need to refetch or reinterpret campaign parameters

## Execution Boundary

`Oranguru` owns decisioning, scheduled-send-file generation, and the decision outputs.

`Chatot` owns provider execution, delivery API invocation, and feedback capture after the handoff.
