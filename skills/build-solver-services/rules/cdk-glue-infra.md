---
title: CDK Glue Infrastructure
impact: CRITICAL
tags: [cdk, glue, infrastructure, aws]
---

# CDK Glue Infrastructure

Deploy Glue solver jobs using CDK with Python. CDK is the ONLY permitted IaC tool per engineering guidelines.

## CDK App Structure

```
cdk/
├── app.py                  # CDK app entry
├── solver_cdk/
│   ├── __init__.py
│   └── solver_stack.py     # Glue job stack
├── pyproject.toml          # CDK dependencies
└── cdk.json
```

### CDK Dependencies (`cdk/pyproject.toml`)

```toml
[project]
name = "cdk"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "aws-cdk-lib>=2.239.0",
    "constructs>=10.5.1",
]
```

### CDK App Entry (`cdk/app.py`)

```python
#!/usr/bin/env python3
import os
from aws_cdk import App, Environment, Tags
from solver_cdk.solver_stack import SolverStack

app = App()
stack = SolverStack(
    app,
    "SolverStack",
    env=Environment(
        account=os.getenv("CDK_DEFAULT_ACCOUNT"),
        region=os.getenv("CDK_DEFAULT_REGION", "us-east-2"),
    ),
)
Tags.of(stack).add("project_name", "solver")
app.synth()
```

## Stack Template

### Packaging Assets

Package three assets from the repository root:

```python
repository_root = Path(__file__).resolve().parents[2]

# 1. The Glue entrypoint script
glue_script_asset = s3_assets.Asset(
    self, "GlueScriptAsset",
    path=str(repository_root / "glue_job" / "solver_glue_job.py"),
)

# 2. Support code directory (src/) — uploaded as a zip
glue_support_code_asset = s3_assets.Asset(
    self, "GlueSupportCodeAsset",
    path=str(repository_root / "src"),
)

# 3. requirements.txt for --additional-python-modules
glue_requirements_asset = s3_assets.Asset(
    self, "GlueRequirementsAsset",
    path=str(repository_root / "glue_job" / "requirements.txt"),
)
```

### Glue Job Configuration

```python
glue_job = glue.CfnJob(
    self,
    "SolverGlueJob",
    role=glue_role.role_arn,
    command=glue.CfnJob.JobCommandProperty(
        name="glueetl",
        python_version="3",
        script_location=f"s3://{glue_script_asset.s3_bucket_name}/{glue_script_asset.s3_object_key}",
    ),
    default_arguments={
        "--job-bookmark-option": "job-bookmark-enable",
        "--enable-continuous-cloudwatch-log": "true",
        "--enable-job-insights": "true",
        "--enable-spark-ui": "true",
        "--extra-py-files": (
            f"s3://{glue_support_code_asset.s3_bucket_name}/{glue_support_code_asset.s3_object_key}"
        ),
        "--python-modules-installer-option": "-r",
        "--additional-python-modules": (
            f"s3://{glue_requirements_asset.s3_bucket_name}/{glue_requirements_asset.s3_object_key}"
        ),
        "--spark-event-logs-path": f"s3://{output_bucket.bucket_name}/spark-ui/",
        "--TempDir": f"s3://{output_bucket.bucket_name}/glue-temp/",
        "--output_s3_uri": default_output_prefix,
        "--hour_capacity": "100000",
        "--group_size_bytes": "134217728",
    },
    execution_property=glue.CfnJob.ExecutionPropertyProperty(max_concurrent_runs=1),
    execution_class="STANDARD",
    glue_version="5.0",
    max_retries=0,
    number_of_workers=4,
    timeout=120,
    worker_type="G.2X",
)
```

### Key Default Arguments

| Argument | Purpose |
| --- | --- |
| `--extra-py-files` | Makes `src/` importable by the Glue script |
| `--additional-python-modules` | Installs `ortools` from `requirements.txt` |
| `--python-modules-installer-option` | Tells Glue to use `-r` (requirements file mode) |
| `--job-bookmark-option` | Enables incremental processing |
| `--enable-spark-ui` | Enables Spark UI for debugging |

### IAM Role

```python
glue_role = iam.Role(
    self, "GlueJobRole",
    assumed_by=iam.ServicePrincipal("glue.amazonaws.com"),
    managed_policies=[
        iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AWSGlueServiceRole"),
    ],
)

# Grant read on input sources
glue_role.add_to_policy(iam.PolicyStatement(
    actions=["s3:GetObject", "s3:ListBucket"],
    resources=["arn:aws:s3:::*", "arn:aws:s3:::*/*"],
))

# Grant read/write on output bucket
output_bucket.grant_read_write(glue_role)

# Grant read on all asset buckets
glue_script_asset.grant_read(glue_role)
glue_support_code_asset.grant_read(glue_role)
glue_requirements_asset.grant_read(glue_role)
```

### Worker Sizing Guidelines

| Dataset Size | Worker Type | Workers | Notes |
| --- | --- | --- | --- |
| < 1M records | G.1X | 2–4 | Minimal config |
| 1M–10M records | G.2X | 4–8 | Standard solver workload |
| > 10M records | G.2X | 8–16 | Consider tighter Spark pre-filtering |

The solver `.collect()` runs on the driver, so more workers mainly helps Spark prep speed. Driver memory (determined by worker type) is the constraint for the OR-Tools solve.

## Deploying

Use `uv` for CDK dependency setup per project conventions:

```bash
UV_PROJECT_ENVIRONMENT=cdk/.venv uv sync --project cdk
cdk/.venv/bin/cdk synth
cdk/.venv/bin/cdk deploy
```

## Starting a Job Run

```bash
aws glue start-job-run \
  --job-name solver-glue-job \
  --arguments '{
    "--input_s3_uri": "s3://input-bucket/prefix/",
    "--output_s3_uri": "s3://output-bucket/solver-output/",
    "--hour_capacity": "100000"
  }'
```
