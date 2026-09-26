---
title: Python Only for PySpark + AWS Glue Jobs
impact: CRITICAL
tags: python, pyspark, glue, data
---

## Python Only for PySpark + AWS Glue Jobs

Python is permitted **only** for PySpark + AWS Glue jobs. For **all other workloads** — including data-processing Lambdas, batch jobs, Step Functions, and APIs — use TypeScript.

### Standards (when Python is used for Glue)

- Type checking: [**basedpyright**](https://github.com/DetachHead/basedpyright)
  - If a dependency or code structure requires an exception, use a [line-level diagnostic suppression](https://docs.basedpyright.com/v1.23.1/configuration/comments/#prefer-pyrightignore-comments) comment and include a reason.
- Formatting & linting: **Ruff**
- Testing: **Pytest**

### ✅ Correct

```python
# Python used for an AWS Glue PySpark job — this is the only permitted Python use case
from pyspark.context import SparkContext
from awsglue.context import GlueContext

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session

df = glueContext.create_dynamic_frame.from_catalog(database="my_db", table_name="my_table")
# PySpark transformations ...
```

### ❌ Incorrect

```python
# Using Python for a Lambda or batch job — violates Golden Path
# Use TypeScript instead for anything that is not a PySpark/Glue job
import polars as pl
from aws_lambda_powertools import Logger

logger = Logger()

@logger.inject_lambda_context
def handler(event, context):
    df = pl.read_parquet("s3://bucket/data.parquet")
    # ... this should be a TypeScript Lambda
```

### References

- [basedpyright](https://github.com/DetachHead/basedpyright)
- [Ruff](https://docs.astral.sh/ruff/)
