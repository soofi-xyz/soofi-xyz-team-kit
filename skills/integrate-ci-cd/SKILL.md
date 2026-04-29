---
name: integrate-ci-cd
description: "Integrate shared CI/CD GitHub Actions workflows into a project. Covers creating caller workflows, justfile with required recipes, and environment variable configuration. Triggers on: CI/CD, continuous integration, continuous deployment, GitHub Actions, pipeline, ci-cd, workflow, deploy pipeline, add CI, add CD, setup CI/CD."
---

# Integrating CI/CD

Step-by-step guide for integrating shared CI/CD GitHub Actions workflows into a project.

## Overview

This setup uses shared reusable GitHub Actions workflows hosted in [`Spring-Oaks-Capital-LLC/github-workflows`](https://github.com/Spring-Oaks-Capital-LLC/github-workflows). Every project calls these workflows instead of defining its own pipeline steps.

The pipeline runs: **format -> lint -> type-check -> test -> (AWS credentials) -> build -> deploy**.

| Workflow | Environment | Trigger |
| --- | --- | --- |
| `ci-cd-dev.yml` | DEV | Pull requests targeting `main` |
| `ci-cd-prod.yml` | PROD | Push to `main` (merge) |

## Integration Steps

Follow these steps in order. Do NOT skip ahead.

### Step 1 — Create the justfile

Create a `justfile` in the project root with the six required recipes. If a `setup` recipe exists, the shared workflow runs it automatically before the other steps.

**Required recipes:** `format`, `lint`, `type-check`, `test`, `build`, `deploy`

**Optional recipes:** `setup` (install dependencies, tooling, etc.)

#### Python (CDK) project example

```just
set dotenv-load := false

# Install Python and Node.js dependencies
setup:
    python -m pip install --upgrade pip
    pip install -e ".[dev]"
    npm install -g aws-cdk

# Check code formatting
format:
    ruff format --check .

# Run linting
lint:
    ruff check .

# Run type checking
type-check:
    basedpyright

# Run tests with coverage
test:
    pytest --cov --cov-report=xml --cov-report=term-missing

# Synthesize CDK stack
build:
    cdk synth --strict

# Deploy CDK stack
deploy:
    cdk deploy --require-approval never \
      ${CDK_BOOTSTRAP_QUALIFIER:+--context "@aws-cdk/core:bootstrapQualifier=$CDK_BOOTSTRAP_QUALIFIER"}
```

#### TypeScript (CDK) project example

```just
set dotenv-load := false

# Install dependencies
setup:
    npm ci
    npm install -g aws-cdk

# Check code formatting
format:
    npx prettier --check .

# Run linting
lint:
    npx eslint .

# Run type checking
type-check:
    npx tsc --noEmit

# Run tests
test:
    npx vitest run

# Synthesize CDK stack
build:
    cdk synth --strict

# Deploy CDK stack
deploy:
    cdk deploy --require-approval never
```

Refer to the [Just Programmer's Manual](https://just.systems/man/en/) for syntax details.

### Step 2 — Create caller workflows

Create two workflow files in `.github/workflows/` in the project.

#### `.github/workflows/ci-cd-dev.yml`

```yaml
name: DEV CI/CD
on:
  pull_request:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  dev:
    uses: Spring-Oaks-Capital-LLC/github-workflows/.github/workflows/ci-cd-dev.yml@main
    with:
      env-vars: |
        TARGET_ENV=dev
    permissions:
      id-token: write
      contents: read
```

#### `.github/workflows/ci-cd-prod.yml`

```yaml
name: PROD CI/CD
on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  prod:
    uses: Spring-Oaks-Capital-LLC/github-workflows/.github/workflows/ci-cd-prod.yml@main
    with:
      env-vars: |
        TARGET_ENV=prod
        CDK_BOOTSTRAP_QUALIFIER=slowking
    permissions:
      id-token: write
      contents: read
```

### Step 3 — Pass custom environment variables (if needed)

Use the `env-vars` input to pass arbitrary `KEY=VALUE` pairs. These are written to `$GITHUB_ENV` and available to all justfile recipes.

```yaml
with:
  env-vars: |
    TARGET_ENV=dev
    MY_CUSTOM_VAR=foo
    ANOTHER_VAR=bar
```

### Step 4 — Override AWS region (if needed)

The default AWS region is `us-east-2`. Override it with the `aws-region` input:

```yaml
with:
  aws-region: "us-west-2"
```

### Step 5 — Verify

1. Open a PR targeting `main` — the DEV workflow should trigger.
2. Merge the PR — the PROD workflow should trigger.
3. Check the Actions tab to confirm all steps pass.

## Inputs Reference

| Input | Type | Required | Default |
| --- | --- | --- | --- |
| `aws-region` | string | No | `us-east-2` |
| `env-vars` | string | No | `""` |

## Prerequisites

- The `github-workflows` repo must allow workflow access from the organization. This is configured in **Settings -> Actions -> General -> Access** of the `github-workflows` repo.
- Caller workflows MUST declare `permissions: id-token: write` at both the workflow and job level for AWS OIDC authentication to work.

## Common Issues

| Problem | Fix |
| --- | --- |
| Workflow not found error | Enable workflow sharing in `github-workflows` repo settings (Actions -> General -> Access -> "Accessible from repositories in the organization") |
| AWS credentials failure | Ensure `id-token: write` permission is set at both workflow and job level |
| Missing recipe error | Add all six required recipes to the justfile: `format`, `lint`, `type-check`, `test`, `build`, `deploy` |
| Workflow not triggering on PR | Ensure the PR targets `main` and the workflow file exists on the PR branch |
