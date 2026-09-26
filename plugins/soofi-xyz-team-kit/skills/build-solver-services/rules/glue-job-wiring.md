---
title: Glue Job Entrypoint Wiring
impact: HIGH
tags: [glue, entrypoint, wiring, pyspark]
---

# Glue Job Entrypoint Wiring

The Glue job entrypoint connects PySpark data preparation to the OR-Tools solver and writes results back to S3.

## Entrypoint Structure

```python
import sys
import time

from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext

from or_solver import build_schedule_with_overflow_bucket, Person, ScheduleResult
from scoring_profiles import ...
from batch_runtime import ...


REQUIRED_GLUE_ARGS = (
    "JOB_NAME",
    "input_s3_uri",
    "output_s3_uri",
    "hour_capacity",
    "group_size_bytes",
)


def main() -> None:
    args = getResolvedOptions(sys.argv, list(REQUIRED_GLUE_ARGS))
    input_s3_uri = args["input_s3_uri"]
    output_s3_uri = args["output_s3_uri"]

    sc = SparkContext.getOrCreate()
    glue_context = GlueContext(sc)
    spark = glue_context.spark_session
    spark.conf.set("spark.sql.session.timeZone", "UTC")
    logger = glue_context.get_logger()

    job = Job(glue_context)
    job.init(args["JOB_NAME"], args)

    # Phase 1: Read and normalize
    # Phase 2: Select candidates, pre-filter
    # Phase 3: Collect and solve
    # Phase 4: Write outputs
    # Phase 5: Write run summary

    job.commit()


if __name__ == "__main__":
    main()
```

## Phased Logging with Elapsed Times

Log each phase with timing for operational visibility:

```python
phase_started_at = time.perf_counter()
raw_frame = _read_source_frame(glue_context, input_s3_uri, group_size_bytes)
debts_frame = _extract_debts_frame(raw_frame)
input_record_count = debts_frame.count()
logger.info(
    f"Loaded and normalized debts input_record_count={input_record_count} "
    f"elapsed_seconds={time.perf_counter() - phase_started_at:.2f}"
)
```

Use structured key=value pairs in log messages for CloudWatch Insights queries.

## The Collect → Solve Bridge

After Spark prep, collect the reduced candidate set and convert to solver types:

```python
phase_started_at = time.perf_counter()
logger.info(f"Starting collect for solver solver_candidate_count={solver_candidate_count}")
people = _build_people(schedulable_people_frame)
logger.info(
    f"Completed collect for solver collected_people_count={len(people)} "
    f"elapsed_seconds={time.perf_counter() - phase_started_at:.2f}"
)
```

Log before AND after `.collect()` — this is the most memory-critical step.

## Output Writing

Write results back through Spark for partitioned output:

### Scheduled (assigned) records

```python
assignment_frame = spark.createDataFrame(
    [(debt_id, hour) for debt_id, hour in assignment.items()],
    schema=assignment_schema,
)
scheduled_frame = assignment_frame.join(export_frame, on="debt_id", how="inner")
(
    scheduled_frame
    .repartition("hour")
    .write.mode("overwrite")
    .option("header", "true")
    .partitionBy("run_date", "hour")
    .csv(scheduled_path)
)
```

### Unscheduled (overflow) records

```python
if unscheduled_frame.limit(1).count() == 0:
    return
unscheduled_frame.write.mode("overwrite").option("header", "true").partitionBy("run_date").csv(path)
```

### Run summary

Write a single JSON file with counts for all phases:

```python
summary_frame.coalesce(1).write.mode("overwrite").json(summary_path)
```

## Optional Arguments

For arguments that are not required by `getResolvedOptions`, parse `sys.argv` directly:

```python
def _read_optional_argument(argument_name: str) -> str | None:
    needle = f"--{argument_name}"
    for index, value in enumerate(sys.argv):
        if value != needle:
            continue
        next_index = index + 1
        if next_index >= len(sys.argv):
            return None
        return sys.argv[next_index]
    return None
```

## Completion Log

Log a final summary with all key counts:

```python
logger.info(
    f"Completed solver Glue job input_record_count={input_record_count} "
    f"processed_person_count={processed_person_count} "
    f"solver_candidate_count={solver_candidate_count} "
    f"assigned_count={len(schedule_result.assignments)} "
    f"unscheduled_count={unscheduled_count}"
)
job.commit()
```

Always call `job.commit()` as the last statement to mark the job as successfully completed and enable job bookmarks.
