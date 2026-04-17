---
title: Glue PySpark Data Preparation
impact: HIGH
tags: [glue, pyspark, data-prep, spark]
---

# Glue PySpark Data Preparation

PySpark handles all data I/O and preparation. The goal: reduce millions of raw records to a clean, minimal candidate set that fits in driver memory for OR-Tools.

## Reading from S3

Use `GlueContext.create_dynamic_frame.from_options()` for S3 reads:

```python
source_dynamic_frame = glue_context.create_dynamic_frame.from_options(
    connection_type="s3",
    connection_options={
        "paths": [input_s3_uri],
        "recurse": True,
        "groupFiles": "inPartition",
        "groupSize": group_size_bytes,
        "isFailFast": True,
    },
    format="json",
    format_options={"multiline": True},
    transformation_ctx="source_json",
)
raw_frame = source_dynamic_frame.toDF()
```

Key options:

| Option | Purpose |
| --- | --- |
| `recurse=True` | Read all files under the prefix |
| `groupFiles=inPartition` | Merge small files into larger partitions for efficiency |
| `groupSize` | Target partition size in bytes (default 128MB) |
| `isFailFast=True` | Fail immediately on read errors |

## Flattening Nested Arrays

Use `explode_outer` for top-level arrays and `posexplode_outer` when you need the array index:

```python
# Flatten results[] array
debts_frame = raw_frame.select(F.explode_outer("results").alias("debt")).select("debt.*")

# Flatten phone_numbers[] with position index
phone_frame = debts_frame.select(
    "debt_identifier",
    F.posexplode_outer("phone_numbers").alias("phone_rank", "phone"),
).select(
    "debt_identifier",
    "phone_rank",
    F.col("phone.phone_number").alias("phone_number"),
    F.col("phone.latest_phone_status").alias("latest_phone_status"),
    ...
)
```

Use `_outer` variants to preserve rows even when the array is null or empty.

## Adding Missing Optional Columns

Gracefully handle schemas that may or may not include optional fields:

```python
def _add_missing_columns(frame: DataFrame, column_names: tuple[str, ...]) -> DataFrame:
    result = frame
    for column_name in column_names:
        if column_name not in result.columns:
            result = result.withColumn(column_name, F.lit(None).cast("string"))
    return result
```

## Enum Weight Mapping

Convert string enums to integer weights using `create_map`:

```python
def _map_weight_column(column_name: str, mapping: dict[str, int]) -> F.Column:
    normalized = F.upper(F.trim(F.coalesce(F.col(column_name).cast("string"), F.lit(""))))
    mapping_entries: list[F.Column] = []
    for key, value in mapping.items():
        mapping_entries.extend((F.lit(key), F.lit(value)))
    return F.coalesce(F.create_map(*mapping_entries).getItem(normalized), F.lit(0))
```

✅ Define weight dictionaries in the shared `src/` module so both Spark and unit tests use the same values.

## Candidate Ranking and Selection

Use `Window` + `row_number` to pick the best candidate per entity:

```python
selection_window = Window.partitionBy("debt_identifier").orderBy(
    F.col("has_rpc_ts").desc(),
    F.col("latest_rpc_ts").desc_nulls_last(),
    F.col("phone_quality_score").desc(),
    F.col("has_day_window").desc(),
    F.col("phone_rank").asc(),
)

selected = (
    enriched
    .withColumn("selection_rank", F.row_number().over(selection_window))
    .where(F.col("selection_rank") == 1)
)
```

## Normalization

Normalize scores to [0, 1] in Spark so they're ready for the solver:

```python
# TU score: clamp to [300, 850], normalize to [0, 1]
tu_score_clamped = F.when(
    tu_score_int.isNull(), F.lit(None).cast("int")
).otherwise(F.least(F.greatest(tu_score_int, F.lit(300)), F.lit(850)))

tu_score_normalized = F.when(
    tu_score_clamped.isNull(), F.lit(0.0)
).otherwise(
    (tu_score_clamped.cast("double") - F.lit(300.0)) / F.lit(550.0)
)

# Phone quality: raw score / max possible score
phone_quality_normalized = F.col("phone_quality_score").cast("double") / F.lit(float(MAX_SCORE))
```

## Capacity Pre-Filtering

When the candidate set exceeds solver capacity, pre-filter in Spark:

```python
def _split_schedulable_people(
    selected_people_frame: DataFrame,
    processed_person_count: int,
    max_schedulable_people: int,
) -> tuple[DataFrame, DataFrame]:
    if processed_person_count <= max_schedulable_people:
        return selected_people_frame, empty_unscheduled_frame

    prioritized = selected_people_frame.withColumn(
        "priority_score_upper_bound", _priority_score_upper_bound()
    )
    schedulable = (
        prioritized
        .orderBy(F.desc("priority_score_upper_bound"), F.desc("debt_balance"), F.asc("debt_id"))
        .limit(max_schedulable_people)
        .drop("priority_score_upper_bound")
        .cache()
    )
    unscheduled = (
        prioritized
        .join(schedulable.select("debt_id"), on="debt_id", how="left_anti")
        .withColumn("reason", F.lit("CAPACITY_FILTERED_IN_SPARK"))
        .cache()
    )
    return schedulable, unscheduled
```

Use `.cache()` on frames that are reused downstream (e.g., for output writes after the solve).

## Time String Parsing

Convert `"HH:MM:SS"` time strings to integer minutes for the solver:

```python
def _time_string_to_minutes(column_name: str) -> F.Column:
    source = F.trim(F.col(column_name))
    parts = F.split(source, ":")
    return (
        F.when(source.isNull() | source.eqNullSafe(""), F.lit(None).cast("int"))
        .otherwise(parts.getItem(0).cast("int") * F.lit(60) + parts.getItem(1).cast("int"))
        .cast("int")
    )
```
