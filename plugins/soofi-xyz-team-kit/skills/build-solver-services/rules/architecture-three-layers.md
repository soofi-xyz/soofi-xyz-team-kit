---
title: Three-Layer Architecture
impact: CRITICAL
tags: [architecture, spark, or-tools, separation-of-concerns]
---

# Three-Layer Architecture

Solver services MUST separate concerns into three layers with a clean boundary between Spark and the optimization engine.

## The Three Layers

### Layer 1 — PySpark Data Preparation

Runs distributed across Glue workers. Handles:

- S3 reads (nested JSON, CSV, Parquet)
- Flattening nested arrays
- Enum normalization and weight mapping
- Composite score computation
- Candidate ranking and selection (one best candidate per entity)
- Capacity pre-filtering (reduce to max solvable set before collecting)

### Layer 2 — `.collect()` Bridge

The single point where data moves from distributed Spark to the driver's Python process:

```python
def _build_people(selected_people_frame: DataFrame) -> list[Person]:
    people: list[Person] = []
    for row in selected_people_frame.select(
        "debt_id", "phone1", "debt_balance",
        "tu_score_normalized", "phone_quality_normalized",
        "day_window_start_min", "day_window_end_min",
        "overall_window_start_min", "overall_window_end_min",
    ).collect():
        people.append(Person(
            debt_id=str(row.debt_id),
            phone=str(row.phone1),
            debt_balance=float(row.debt_balance),
            tu_score_normalized=float(row.tu_score_normalized),
            phone_quality_normalized=float(row.phone_quality_normalized),
            day_window_start_min=row.day_window_start_min,
            day_window_end_min=row.day_window_end_min,
            overall_window_start_min=row.overall_window_start_min,
            overall_window_end_min=row.overall_window_end_min,
        ))
    return people
```

Key rules:

- Select only the columns the solver needs before `.collect()`
- Pre-filter in Spark so the collected set fits in driver memory
- Convert Spark `Row` objects to solver-native types (NamedTuples / dataclasses) during collection

### Layer 3 — OR-Tools Solver

Runs on the Glue driver as pure Python. Receives a `list[SolverInputType]`, returns a result dataclass. Has zero imports from `pyspark` or `awsglue`.

## Why This Separation Matters

1. **Testability** — The solver module is tested with `pytest` without any Spark infrastructure
2. **Debuggability** — Solver bugs are reproduced with a plain Python list, not a Spark cluster
3. **Performance** — Spark handles the I/O-heavy, parallelizable work; OR-Tools runs the compute-heavy optimization in-memory
4. **Maintainability** — Scoring weights, graph topology, and business logic change independently from data plumbing

## ✅ Correct

```
src/or_solver.py      → imports: ortools, dataclasses, typing (NO pyspark)
glue_job/entrypoint.py → imports: pyspark, awsglue, src.or_solver
```

## ❌ Incorrect

```python
# or_solver.py — NEVER import Spark in the solver module
from pyspark.sql import DataFrame  # ❌ Wrong layer

def solve(df: DataFrame):  # ❌ Solver should not know about DataFrames
    ...
```
