---
title: AWS Glue PySpark Strategy
impact: CRITICAL
tags: glue, pyspark, etl, joins, aggregation, heavy-processing, python
---

## AWS Glue PySpark Strategy

Use AWS Glue with PySpark for heavy data manipulation: joins, aggregations, deduplication, hash computation, diff detection, or any operation that benefits from distributed processing.

### When to Use

- Joining multiple datasets
- Computing hashes or checksums across records
- Finding diffs between snapshots
- Aggregations, grouping, windowing
- Any operation where records depend on each other (not embarrassingly parallel)

### When to Combine with Step Functions

If the workflow requires heavy processing AND delivery to an external system:

1. **Glue** handles the heavy computation and writes results to an internal S3 location.
2. **Step Functions Distributed Map** reads from that S3 location and delivers to the external system with throttling and retry.

Glue can write directly to S3 — no Step Functions needed for internal S3 writes.

### Architecture (Glue Only)

```
S3 (input) → Step Function
               ├── Cost Prediction (Lambda)
               ├── Glue Job (PySpark)
               │     ├── Read + Validate
               │     ├── Transform / Join / Aggregate
               │     └── Write to S3
               └── Emit Metrics (Lambda)
```

### Architecture (Glue + Step Functions)

```
S3 (input) → Step Function
               ├── Cost Prediction (Lambda)
               ├── Glue Job → writes to internal S3
               ├── Distributed Map (reads from internal S3)
               │     └── Deliver to External System (Lambda)
               └── Emit Metrics (Lambda)
```

### ✅ Correct

```python
# Glue job with proper validation and metrics
import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from awsglue.context import GlueContext
from pyspark.context import SparkContext

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session

args = getResolvedOptions(sys.argv, ['JOB_NAME', 'input_path', 'output_path'])

# Read input
df = spark.read.parquet(args['input_path'])

# Validate input schema
expected_columns = {'id', 'name', 'amount', 'timestamp'}
actual_columns = set(df.columns)
missing = expected_columns - actual_columns
if missing:
    raise ValueError(f"Missing required columns: {missing}")

# Process
result = df.groupBy('name').agg({'amount': 'sum'})

# Write output
result.write.mode('overwrite').parquet(args['output_path'])
```

### ❌ Incorrect

```python
# No input validation — processes whatever comes in
df = spark.read.parquet(input_path)
result = df.groupBy('name').agg({'amount': 'sum'})
result.write.parquet(output_path)
# Missing: schema validation, error handling, metrics
```

### References

- [AWS Glue PySpark documentation](https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-python.html)
- [Glue CDK constructs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue-readme.html)
