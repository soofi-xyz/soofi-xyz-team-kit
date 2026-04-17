---
name: build-solver-services
description: "Guides creation of optimization services that combine AWS Glue PySpark data preparation with Google OR-Tools solvers. Covers the three-layer architecture (Spark prep → collect bridge → OR-Tools solve → Spark output), solver module design, Glue job wiring, CDK infrastructure, and testing strategy. Triggers on: solver, optimization, OR-Tools, min-cost-flow, assignment problem, scheduling optimizer, PySpark solver, capacity assignment, constraint optimization."
---

# Building Solver Services

Step-by-step guide for building batch optimization services that use **AWS Glue PySpark** for data preparation and **Google OR-Tools** for mathematical optimization.

## Architecture: Three-Layer Pattern

Every solver service follows this architecture:

```
S3 input → Glue PySpark (read, flatten, normalize, rank, pre-filter)
         → .collect() bridge (Spark → Python list)
         → OR-Tools solver (pure Python, single-driver)
         → Glue PySpark (write partitioned output to S3)
```

The critical design rule: **the OR-Tools solver module MUST be pure Python with zero Spark dependencies.** Spark handles I/O and data prep at scale; OR-Tools runs the optimization on the reduced candidate set in-memory on the driver.

Read `rules/architecture-three-layers.md` for rationale and boundaries.

## Workflow: Five Phases

Follow these phases in order. Each phase gates the next.

### Phase 1 — Define the Optimization Problem

Before writing code, define:

1. **Decision variables** — What is being assigned? (e.g., people to time slots, items to bins)
2. **Constraints** — What limits apply? (e.g., capacity per slot, one assignment per item)
3. **Objective** — Minimize cost or maximize score?
4. **Input data shape** — What fields does each candidate carry?
5. **Output data shape** — What does the result look like?

Document these as a data contract before proceeding.

### Phase 2 — Build the OR-Tools Solver Module

Use **`SimpleMinCostFlow`** from `ortools.graph.python.min_cost_flow` as the default solver. It is the recommended algorithm for assignment problems where items compete for capacity-limited slots.

Create a standalone pure-Python module in `src/`:

- Model the problem as a directed graph: Source → Items → Slots (+ Overflow) → Sink
- Define input types using `NamedTuple` or `@dataclass(frozen=True)`
- Define a config dataclass for tunable weights and capacities
- Design a scoring function as a weighted sum of normalized signals anchored on the primary business value
- Implement graph construction and result extraction as separate functions
- Pin `ortools` in `glue_job/requirements.txt`
- Write unit tests that cover: basic assignment, infeasible cases, overflow/unscheduled buckets, scoring properties, weight interactions

Read `rules/solver-min-cost-flow.md` for the complete MinCostFlow pattern — graph topology, score design, weight definitions, overflow buckets, and integer cost scaling.

Read `rules/solver-pure-python.md` for module structure and conventions.

### Phase 3 — Build the Spark Data Pipeline

Implement the PySpark data preparation in `glue_job/`:

- Read nested JSON from S3 using `GlueContext.create_dynamic_frame.from_options()`
- Flatten nested arrays with `explode_outer` / `posexplode_outer`
- Normalize enums, compute composite scores using `create_map` weight lookups
- Rank and select best candidates per entity using `Window` + `row_number`
- Pre-filter to capacity limits in Spark before collecting

Read `rules/glue-pyspark-prep.md` for specific patterns.

### Phase 4 — Wire the Glue Job Entrypoint

Connect Spark prep → OR-Tools solve → output writes:

- Parse arguments with `getResolvedOptions`
- Initialize `GlueContext`, `SparkSession`, `Job`
- Execute phases with elapsed-time logging
- `.collect()` the reduced candidate set into a Python list of solver input types
- Call the solver
- Write results back through Spark (partitioned CSV/JSON to S3)
- Call `job.commit()`

Read `rules/glue-job-wiring.md` for the entrypoint template.

### Phase 5 — CDK Infrastructure

Deploy with CDK using Python (matches the Glue job language):

- Package the Glue script, support code (`src/`), and `requirements.txt` as `s3_assets.Asset`
- Create `CfnJob` with Glue 5.0, `--extra-py-files`, `--additional-python-modules`
- Configure S3 output bucket, IAM role, worker sizing

Read `rules/cdk-glue-infra.md` for the stack template.

## Repository Layout

```
project-root/
├── src/                        # Pure-Python solver + helpers (no Spark)
│   ├── or_solver.py            # OR-Tools optimization module
│   ├── scoring_profiles.py     # Scoring/normalization helpers
│   └── batch_runtime.py        # Runtime utilities (dates, S3 helpers)
├── glue_job/
│   ├── solver_glue_job.py      # Glue PySpark entrypoint
│   └── requirements.txt        # Pinned OR-Tools version for Glue
├── cdk/
│   ├── app.py                  # CDK app entry
│   ├── solver_cdk/
│   │   └── solver_stack.py     # Glue job infrastructure
│   └── pyproject.toml          # CDK dependencies
├── tests/
│   ├── conftest.py             # sys.path injection for src/
│   ├── test_or_solver.py       # Solver unit tests
│   └── test_scoring_profiles.py
├── docs/
│   └── business-logic.md       # Business logic documentation
├── pyproject.toml              # Root project config (uv workspace)
└── pytest.ini
```

## Key Conventions

- Use `uv` for dependency management with workspace members: `[tool.uv.workspace] members = ["cdk"]`
- Python ≥ 3.12
- Linting: `ruff`
- Type checking: `basedpyright` or `ty`
- Mark PySpark/awsglue/ortools as allowed unresolved imports in type checker config
- Tests run with `pytest` — solver tests do NOT require Spark

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Three-Layer Architecture | `rules/architecture-three-layers.md` | CRITICAL |
| Min-Cost Flow with OR-Tools | `rules/solver-min-cost-flow.md` | CRITICAL |
| Pure-Python Solver | `rules/solver-pure-python.md` | CRITICAL |
| Glue PySpark Prep | `rules/glue-pyspark-prep.md` | HIGH |
| Glue Job Wiring | `rules/glue-job-wiring.md` | HIGH |
| CDK Glue Infrastructure | `rules/cdk-glue-infra.md` | CRITICAL |
| Testing Strategy | `rules/testing-strategy.md` | HIGH |
