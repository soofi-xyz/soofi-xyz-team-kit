---
title: Pure-Python Solver Module
impact: CRITICAL
tags: [or-tools, solver, pure-python, min-cost-flow]
---

# Pure-Python Solver Module

The OR-Tools solver MUST live in `src/` as a standalone Python module with no Spark dependencies.

## Input Types

Define solver inputs as `NamedTuple` or `@dataclass(frozen=True)`:

```python
class Person(NamedTuple):
    debt_id: str
    phone: str
    debt_balance: float
    tu_score_normalized: float
    phone_quality_normalized: float
    day_window_start_min: int | None
    day_window_end_min: int | None
    overall_window_start_min: int | None
    overall_window_end_min: int | None
```

Use `NamedTuple` for solver inputs (immutable, lightweight, iterable). Use `@dataclass(frozen=True)` for config and result types.

## Config Dataclass

Expose all tunable weights and capacities through a frozen dataclass with sensible defaults:

```python
@dataclass(frozen=True)
class SolverConfig:
    hour_capacity: int = DEFAULT_HOUR_CAPACITY
    score_scale: int = DEFAULT_SCORE_SCALE
    day_time_fit_weight: float = DEFAULT_DAY_TIME_FIT_WEIGHT
    overall_time_fit_weight: float = DEFAULT_OVERALL_TIME_FIT_WEIGHT
```

Define defaults as module-level constants so they are importable by both the solver and the Glue job.

## Result Types

Return structured results, not raw dicts:

```python
@dataclass(frozen=True)
class ScheduleResult:
    assignments: dict[str, int]          # debt_id -> assigned_hour
    unscheduled_debt_ids: list[str]      # overflow bucket
```

## Scoring Function

Implement the objective function as a standalone `score()` function:

- Accept a single input record and the assignment target (e.g., hour)
- Accept weight parameters with defaults
- Return a `float`
- Keep it pure — no side effects, no state

```python
def score(person: Person, hour: int, ...) -> float:
    balance_term = person.debt_balance
    bonus_base = abs(balance_term)
    quality_bonus = bonus_base * phone_quality_weight * person.phone_quality_normalized
    ...
    return balance_term + quality_bonus + ...
```

## Graph Construction

For min-cost-flow problems, decompose graph construction into small functions:

1. `_build_node_layout()` — Compute node indices (source, items, slots, overflow, sink)
2. `_set_node_supplies()` — Set supply/demand on source and sink
3. `_add_source_to_item_arcs()` — Source → each item (capacity=1, cost=0)
4. `_add_item_to_slot_arcs()` — Item → each slot (capacity=1, cost=-score)
5. `_add_item_to_overflow_arcs()` — Item → overflow bucket (high penalty cost)
6. `_add_slot_to_sink_arcs()` — Slot → sink (capacity=slot_capacity, cost=0)
7. `_add_overflow_to_sink_arc()` — Overflow → sink (capacity=num_items, cost=0)

## Score Scaling

OR-Tools `SimpleMinCostFlow` uses **integer costs**. Scale float scores to ints:

```python
cost = -int(assignment_score * config.score_scale)
```

Use negative cost to convert a maximization problem into minimization.

## Overflow Bucket

When capacity may not fit all items, add an overflow (unscheduled) node. Set its cost higher than any assignment cost so the solver only uses it when forced:

```python
def _build_unscheduled_cost(max_assignment_cost: int) -> int:
    return max_assignment_cost + 1
```

## Public API

Expose one or two top-level functions:

```python
def build_and_solve(items: list[Item], capacity: int) -> dict[str, int]:
    """Returns item_id -> assigned_slot. Raises if infeasible."""

def build_and_solve_with_overflow(items: list[Item], capacity: int) -> Result:
    """Returns assignments + unscheduled list. Always feasible."""
```

## Dependency

Pin `ortools` in `glue_job/requirements.txt`:

```
ortools==9.15.6755
```

Also add it to the root `pyproject.toml` for local development:

```toml
dependencies = ["ortools>=9.15.6755"]
```

## Validation

Validate all inputs at the top of the public API:

- Capacity > 0
- Normalized values in [0, 1]
- Window bounds in valid range
- Paired optional fields (both set or both None)

Raise `ValueError` with descriptive messages for invalid inputs.
