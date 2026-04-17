---
title: Testing Strategy
impact: HIGH
tags: [testing, pytest, solver, unit-tests]
---

# Testing Strategy

Test the solver module independently with `pytest`. Solver tests MUST NOT require Spark, Glue, or any AWS services.

## Test Layout

```
tests/
├── conftest.py               # sys.path injection for src/
├── test_or_solver.py          # Solver unit tests
├── test_scoring_profiles.py   # Scoring/normalization tests
└── test_batch_runtime.py      # Runtime utility tests
```

## Path Injection (`conftest.py`)

The `src/` directory is not a package — inject it into `sys.path`:

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
```

## Solver Test Categories

### 1. Basic Assignment

Verify that a single item is assigned to a valid slot:

```python
def test_no_preference_person_is_assigned_to_a_valid_hour() -> None:
    people = [_person("nopref", balance=100.0)]
    assignment = build_and_solve_min_cost_flow(people=people)
    assert assignment["nopref"] in HOURS
```

### 2. Infeasibility Detection

Verify the solver raises when capacity is truly insufficient (no overflow bucket):

```python
def test_raises_when_capacity_makes_problem_infeasible() -> None:
    people = [_person(f"p{i}", balance=float(i)) for i in range(1, len(HOURS) + 2)]
    with pytest.raises(RuntimeError, match="MinCostFlow not optimal"):
        build_and_solve_min_cost_flow(people=people, hour_capacity=1)
```

### 3. Overflow Bucket

Verify the overflow variant absorbs excess items:

```python
def test_overflow_bucket_absorbs_excess() -> None:
    people = [_person(f"p{i}", balance=float(i)) for i in range(1, len(HOURS) + 3)]
    result = build_schedule_with_overflow_bucket(people=people, hour_capacity=1)
    assert len(result.assignments) == len(HOURS)
    assert len(result.unscheduled_debt_ids) == 2
```

### 4. Priority Ordering

Verify that higher-value items are scheduled and lower-value items overflow:

```python
def test_overflow_drops_lowest_balance_first() -> None:
    people = [_person(f"p{i}", balance=float(i)) for i in range(1, len(HOURS) + 2)]
    result = build_schedule_with_overflow_bucket(people=people, hour_capacity=1)
    assert result.unscheduled_debt_ids == ["p1"]
```

### 5. Scoring Properties

Test that the score function has the expected monotonicity and ordering:

```python
def test_higher_phone_quality_increases_score() -> None:
    baseline = _person("base", balance=100.0, phone_quality_normalized=0.0)
    enriched = _person("enriched", balance=100.0, phone_quality_normalized=1.0)
    assert score(enriched, 10) > score(baseline, 10)

def test_preferred_window_scores_higher_than_outside() -> None:
    person = _person("p", balance=100.0, day_start_min=14*60, day_end_min=16*60)
    assert score(person, 14) > score(person, 8)
```

### 6. Input Validation

Test that invalid inputs raise descriptive errors:

```python
def test_partial_window_bounds_raise() -> None:
    people = [_person("bad", balance=100.0, overall_start_min=600, overall_end_min=None)]
    with pytest.raises(ValueError, match="window bounds must both be set"):
        build_and_solve_min_cost_flow(people=people)
```

## Test Helper Factory

Create a helper to build test inputs with sensible defaults:

```python
def _person(
    debt_id: str,
    balance: float,
    tu_score_normalized: float = 0.0,
    phone_quality_normalized: float = 0.0,
    day_start_min: int | None = None,
    day_end_min: int | None = None,
    overall_start_min: int | None = None,
    overall_end_min: int | None = None,
) -> Person:
    return Person(
        debt_id=debt_id,
        phone=f"+1{debt_id}",
        debt_balance=balance,
        tu_score_normalized=tu_score_normalized,
        phone_quality_normalized=phone_quality_normalized,
        day_window_start_min=day_start_min,
        day_window_end_min=day_end_min,
        overall_window_start_min=overall_start_min,
        overall_window_end_min=overall_end_min,
    )
```

## Scoring/Normalization Tests

Test scoring helpers independently:

- Enum weight functions return expected values for known and unknown inputs
- Normalization clamps values to valid ranges
- Missing/null inputs return zero
- Composite scores use all components

## Running Tests

```bash
uv run pytest tests/ -v
```

## What NOT to Test Here

- Spark transformations (no local Spark in solver tests)
- CDK synthesis (test in CI with `cdk synth`)
- End-to-end Glue job execution (validate in deployed environment)
