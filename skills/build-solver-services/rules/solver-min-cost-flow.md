---
title: Min-Cost Flow with OR-Tools
impact: CRITICAL
tags: [or-tools, min-cost-flow, scoring, weights, graph-modeling]
---

# Min-Cost Flow with OR-Tools

Use `ortools.graph.python.min_cost_flow.SimpleMinCostFlow` for assignment-style optimization problems. This is the recommended solver for these workloads where each item must be assigned to exactly one slot under capacity constraints.

## When to Use MinCostFlow

MinCostFlow is the right choice when:

- Each item is assigned to exactly **one** slot (one-to-one or many-to-one)
- Each slot has a **capacity limit**
- The goal is to **maximize total score** (or equivalently, minimize total cost)
- Items that cannot fit should go to an **overflow bucket**

Examples: scheduling calls to hours, assigning tasks to workers, routing items to bins.

## Graph Topology

The graph has five node types connected by directed arcs:

```
Source → Item nodes → Slot nodes → Sink
                   ↘ Overflow node ↗
```

### Node Layout

```python
@dataclass(frozen=True)
class NodeLayout:
    source: int          # Supplies all flow
    person_start: int    # First item node index
    hour_start: int      # First slot node index
    unscheduled: int     # Overflow node index
    sink: int            # Absorbs all flow
    num_people: int

def _build_node_layout(num_people: int) -> NodeLayout:
    source = 0
    person_start = 1
    hour_start = person_start + num_people
    unscheduled = hour_start + HOURS_IN_DAY
    sink = unscheduled + 1
    return NodeLayout(
        source=source,
        person_start=person_start,
        hour_start=hour_start,
        unscheduled=unscheduled,
        sink=sink,
        num_people=num_people,
    )
```

### Supply and Demand

The source supplies exactly `num_items` units of flow. The sink demands exactly `num_items`. Every unit of flow represents one item being assigned:

```python
def _set_node_supplies(solver, layout, num_people):
    for node in range(layout.sink + 1):
        solver.set_node_supply(node, 0)
    solver.set_node_supply(layout.source, num_people)    # +N supply
    solver.set_node_supply(layout.sink, -num_people)     # -N demand
```

### Arc Types

| Arc | Capacity | Cost | Purpose |
| --- | --- | --- | --- |
| Source → Item | 1 | 0 | Each item emits exactly 1 unit of flow |
| Item → Slot | 1 | `-int(score * scale)` | Assignment cost (negative = maximization) |
| Item → Overflow | 1 | `max_cost + 1` | Penalty for not scheduling |
| Slot → Sink | `slot_capacity` | 0 | Slot absorbs up to capacity |
| Overflow → Sink | `num_items` | 0 | Overflow absorbs any excess |

## Converting Maximization to Minimization

`SimpleMinCostFlow` **minimizes** total cost. To **maximize** total score, negate the score:

```python
cost = -int(assignment_score * config.score_scale)
```

Higher scores become more negative costs, so the solver prefers them.

### Integer Scaling

`SimpleMinCostFlow` only accepts **integer** costs. Scale float scores before converting:

```python
DEFAULT_SCORE_SCALE = 1000

cost = -int(score * DEFAULT_SCORE_SCALE)
```

Choose a scale that preserves enough precision to distinguish candidates. `1000` works well for dollar-scale balances with percentage-scale bonuses.

## Designing the Scoring Function

The scoring function determines the solver's objective. Design it as a **weighted sum of components** where each component is normalized to a comparable scale.

### Anatomy of a Score

```python
def score(person: Person, hour: int, ...) -> float:
    # 1. Anchor term — the primary business value
    balance_term = person.debt_balance

    # 2. Bonus base — used to scale all bonuses proportionally
    bonus_base = abs(balance_term)

    # 3. Additive bonuses — each weighted independently
    quality_bonus = bonus_base * phone_quality_weight * person.phone_quality_normalized
    tu_bonus = bonus_base * tu_score_weight * person.tu_score_normalized

    # 4. Interaction term — amplifies time-fit bonus for higher-quality items
    time_bonus_multiplier = (
        1.0
        + phone_quality_time_multiplier * person.phone_quality_normalized
        + tu_score_time_multiplier * person.tu_score_normalized
    )

    # 5. Context-dependent bonuses — vary by which slot (hour) is being evaluated
    day_bonus = (day_time_fit_weight * bonus_base
                 * time_bonus_multiplier
                 * _window_bonus(hour, person.day_window_start_min, person.day_window_end_min))
    overall_bonus = (overall_time_fit_weight * bonus_base
                     * time_bonus_multiplier
                     * _window_bonus(hour, person.overall_window_start_min, person.overall_window_end_min))

    return balance_term + quality_bonus + tu_bonus + day_bonus + overall_bonus
```

### Score Component Design Rules

#### 1. Anchor on the primary business value

The first term is the raw business value (e.g., debt balance). This ensures higher-value items are inherently preferred:

```python
balance_term = person.debt_balance
```

#### 2. Scale bonuses relative to the anchor

Use `abs(anchor)` as the bonus base so that a 40% phone-quality bonus on a $1000 debt means $400 of additional score, not a fixed constant. This keeps bonus magnitudes proportional to business value:

```python
bonus_base = abs(balance_term)
quality_bonus = bonus_base * 0.40 * person.phone_quality_normalized  # Up to 40% of balance
```

#### 3. Normalize all input signals to [0, 1]

Every enrichment signal MUST be normalized before entering the score function. Normalization happens in the Spark prep layer or in a shared `scoring_profiles.py`:

```python
# TU score: clamp [300, 850] → [0, 1]
tu_score_normalized = (clamped - 300) / (850 - 300)

# Phone quality: sum of enum weights / max possible sum → [0, 1]
phone_quality_normalized = phone_quality_score / MAX_PHONE_QUALITY_SCORE
```

#### 4. Use explicit weight constants

Define every weight as a module-level constant with a `DEFAULT_` prefix:

```python
DEFAULT_PHONE_QUALITY_WEIGHT = 0.40      # Up to 40% bonus on balance
DEFAULT_TU_SCORE_WEIGHT = 0.25           # Up to 25% bonus on balance
DEFAULT_DAY_TIME_FIT_WEIGHT = 0.05       # Up to 5% bonus for preferred day window
DEFAULT_OVERALL_TIME_FIT_WEIGHT = 0.02   # Up to 2% bonus for overall window
```

Weight magnitudes communicate business priority:
- **0.40** = phone quality is a strong differentiator
- **0.25** = TU score matters but less than phone quality
- **0.05** = day-window fit is a tiebreaker, not a primary driver
- **0.02** = overall-window fit is the weakest signal

#### 5. Add interaction terms for compounding effects

When two signals should amplify each other, use a **multiplier** on the weaker signal:

```python
DEFAULT_PHONE_QUALITY_TIME_MULTIPLIER = 1.00
DEFAULT_TU_SCORE_TIME_MULTIPLIER = 0.50

time_bonus_multiplier = (
    1.0
    + phone_quality_time_multiplier * person.phone_quality_normalized
    + tu_score_time_multiplier * person.tu_score_normalized
)
```

This means: placing a call inside the preferred window is worth more when the phone is high quality and the TU score is strong. A perfect phone + perfect TU score triples the time-fit bonus (1.0 + 1.0 + 0.5 = 2.5x).

#### 6. Context-dependent bonuses vary by slot

Some score components change based on which slot the item would be assigned to. These drive the solver to prefer specific slots for specific items:

```python
def _window_bonus(hour: int, start_min: int | None, end_min: int | None) -> float:
    if start_min is None or end_min is None:
        return 0.0
    if not hour_in_window(hour, start_min, end_min):
        return 0.0
    return window_center_distance_bonus(hour, start_min, end_min)
```

The bonus is 0.0 outside the window and up to 1.0 at the center — creating a smooth preference gradient.

### Window Center Distance Bonus

For time-window fit, score hours closer to the window center higher:

```python
def window_center_distance_bonus(hour: int, start_min: int, end_min: int) -> float:
    """Returns [0, 1], higher is better. Supports cross-midnight windows."""
    # Calculate window center and width
    if start_min < end_min:
        width = end_min - start_min
        center = start_min + width / 2
    else:  # Cross-midnight
        width = (MINUTES_PER_DAY - start_min) + end_min
        center = start_min + width / 2
        if center >= MINUTES_PER_DAY:
            center -= MINUTES_PER_DAY

    hour_midpoint = hour * 60 + 30
    distance = abs(hour_midpoint - center)
    circular_distance = min(distance, MINUTES_PER_DAY - distance)
    half_width = max(width / 2, 1.0)
    return max(0.0, 1.0 - (circular_distance / half_width))
```

## Overflow Bucket

The overflow (unscheduled) node absorbs items when slot capacity is exhausted. Set its cost **higher than any possible assignment cost** so the solver only uses it as a last resort:

```python
def _build_unscheduled_cost(max_assignment_cost: int) -> int:
    return max_assignment_cost + 1
```

Track `max_assignment_cost` while adding Item → Slot arcs:

```python
max_assignment_cost = 0
for person_index, person in enumerate(people):
    for hour in HOURS:
        cost = -int(score(person, hour, ...) * config.score_scale)
        solver.add_arc_with_capacity_and_unit_cost(person_node, hour_node, 1, cost)
        max_assignment_cost = max(max_assignment_cost, cost)
```

Then add Item → Overflow arcs with the penalty cost:

```python
unscheduled_cost = _build_unscheduled_cost(max_assignment_cost)
for person_index in range(num_people):
    solver.add_arc_with_capacity_and_unit_cost(person_node, overflow_node, 1, unscheduled_cost)
```

## Solving and Extracting Results

```python
def _solve_or_raise(solver):
    status = solver.solve()
    if status != solver.OPTIMAL:
        raise RuntimeError(f"MinCostFlow not optimal. status={status}")
```

Extract assignments by checking which arcs carry flow:

```python
for arc in range(solver.num_arcs()):
    if solver.flow(arc) != 1:
        continue
    tail = solver.tail(arc)
    head = solver.head(arc)
    if is_item_node(tail) and is_slot_node(head):
        assignments[item_id] = slot_index
    elif is_item_node(tail) and is_overflow_node(head):
        unscheduled.append(item_id)
```

Optimize extraction by pre-building a map of outgoing arcs per item node rather than scanning all arcs repeatedly:

```python
outgoing_by_person: dict[int, list[int]] = {
    layout.person_node(i): [] for i in range(layout.num_people)
}
for arc in range(solver.num_arcs()):
    tail = solver.tail(arc)
    if tail in outgoing_by_person:
        outgoing_by_person[tail].append(arc)
```

## Complete Weight Reference (Solver Example)

| Weight | Default | Business Meaning |
| --- | --- | --- |
| `phone_quality_weight` | 0.40 | Better phones increase priority by up to 40% of balance |
| `tu_score_weight` | 0.25 | Stronger TU scores increase priority by up to 25% of balance |
| `day_time_fit_weight` | 0.05 | Preferred day-window fit adds up to 5% of balance |
| `overall_time_fit_weight` | 0.02 | Overall-window fit adds up to 2% of balance |
| `phone_quality_time_multiplier` | 1.00 | Perfect phone quality doubles the time-fit bonus |
| `tu_score_time_multiplier` | 0.50 | Perfect TU score adds 50% to the time-fit bonus |
| `score_scale` | 1000 | Float-to-integer precision for OR-Tools |
| `hour_capacity` | 100,000 | Max assignments per hour slot |

## Verifying Weight Behavior in Tests

Test that weights produce the expected ordering:

```python
# Higher quality → higher score
def test_higher_phone_quality_increases_score():
    low = _person("low", balance=100.0, phone_quality_normalized=0.0)
    high = _person("high", balance=100.0, phone_quality_normalized=1.0)
    assert score(high, 10) > score(low, 10)

# Preferred window → higher score than outside window
def test_preferred_window_scores_higher():
    person = _person("p", balance=100.0, day_start_min=14*60, day_end_min=16*60)
    assert score(person, 14) > score(person, 8)

# Quality amplifies window advantage (interaction term)
def test_phone_quality_amplifies_window_advantage():
    low = _person("low", balance=100.0, phone_quality_normalized=0.0,
                  day_start_min=14*60, day_end_min=16*60)
    high = _person("high", balance=100.0, phone_quality_normalized=1.0,
                   day_start_min=14*60, day_end_min=16*60)
    low_gap = score(low, 14) - score(low, 8)
    high_gap = score(high, 14) - score(high, 8)
    assert high_gap > low_gap

# No preference → equal score across all hours
def test_no_preference_is_hour_invariant():
    person = _person("p", balance=100.0)
    assert score(person, 8) == score(person, 14)

# Overflow drops lowest-priority items
def test_overflow_drops_lowest_balance():
    people = [_person(f"p{i}", balance=float(i)) for i in range(1, len(HOURS) + 2)]
    result = build_schedule_with_overflow_bucket(people=people, hour_capacity=1)
    assert result.unscheduled_debt_ids == ["p1"]
```
