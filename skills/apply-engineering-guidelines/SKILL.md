---
name: apply-engineering-guidelines
description: "Apply the repository Golden Path engineering standards. Use when building new services, refactoring existing code, setting up infrastructure, configuring CI/CD, choosing libraries, writing tests, adding observability, or reviewing architecture decisions. Covers tech stack (TypeScript for all services, Python only for PySpark/Glue), AWS/CDK infrastructure, testing strategy (Vitest/Pytest), observability (structured logs, X-Ray), and AI policy. Triggers on: new service, scaffold, refactor, architecture review, tech stack question, infrastructure setup, CDK, testing setup, logging, observability, CI/CD pipeline. Do NOT trigger for general coding questions unrelated to the repository standards."
---

# Engineering Guidelines

Follow these standards when building or refactoring any service in this ecosystem. Deviation requires justification in peer review.

## Quick Reference

| Area | Golden Path Standard |
| --- | --- |
| Primary language (all services) | **TypeScript** |
| Exception: PySpark + Glue only | **Python** (PySpark/Glue jobs only — nothing else) |
| LLM interactions | **[Vercel AI SDK](https://ai-sdk.dev/) (`ai`)** — strict TypeScript, no direct provider SDKs |
| Cloud | **AWS** (primary region: `us-east-2`) |
| Infrastructure as Code | **CDK** (`cdk deploy`) — **MANDATORY, no alternatives permitted** |
| Testing | **Vitest / Pytest** + CI in GitHub Actions |
| Formatting & linting | **Prettier + ESLint** (TS) · **Ruff** (Python) |
| Type checking | **tsc** (TS) · **basedpyright** (Python) |
| Observability | **Powertools** (Logger + Tracer + Metrics) · **CloudWatch** · **X-Ray** |

## Rule Categories

| Priority | Category | Rule Prefix | Impact |
| --- | --- | --- | --- |
| 1 | Tech Stack & Languages | `stack-` | CRITICAL |
| 2 | Cloud & Infrastructure | `cloud-` | CRITICAL |
| 3 | Testing & Quality | `testing-` | HIGH |
| 4 | Observability | `observability-` | HIGH |

## Rules Summary

### 1. Tech Stack & Languages (CRITICAL)

- `stack-typescript-for-apis` — Use TypeScript for **all** services, Lambdas, APIs, and batch workloads
- `stack-python-for-data` — Python is permitted **only** for PySpark + AWS Glue jobs
- `stack-ai-sdk-for-llm` — **All LLM interactions MUST use the [Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) with strict TypeScript.** No direct provider SDKs.

### 2. Cloud & Infrastructure (CRITICAL)

- `cloud-aws-primary` — AWS-first with `us-east-2`, **CDK is the only permitted IaC tool**, cost tagging

### 3. Testing & Quality (HIGH)

- `testing-strategy` — Testing pyramid, tooling standards, mock guidance

### 4. Observability (HIGH)

- `observability-logging-tracing` — Powertools Logger/Tracer/Metrics on every Lambda, structured JSON logs, X-Ray tracing
- `observability-metrics` — Business-level metrics per service: items processed, items failed, duration

## How to Use These Rules

Read individual rule files in `rules/` for detailed explanations, rationale, and code examples:

```
rules/stack-typescript-for-apis.md
rules/stack-python-for-data.md
rules/stack-ai-sdk-for-llm.md
rules/cloud-aws-primary.md
rules/testing-strategy.md
rules/observability-logging-tracing.md
rules/observability-metrics.md
```

## Applying the Guidelines

When building or refactoring a service:

1. **Default to TypeScript** for all workloads — APIs, Lambdas, batch, Step Functions, etc.
2. **Use Python only for PySpark + AWS Glue jobs.** For any other workload, use TypeScript.
3. **Set up infrastructure** per `cloud-aws-primary` — CDK in the same language as the service.
4. **Configure CI/CD** per `testing-strategy` — formatter, linter, type checker, tests in GitHub Actions.
5. **Add observability** per `observability-logging-tracing` — Powertools Logger, Tracer, Metrics on every Lambda.
6. **Emit business metrics** per `observability-metrics` — items processed/failed, duration.

## Non-Negotiables

These are hard constraints that MUST NOT be violated without VP-level approval:

1. **TypeScript for ALL services.** Python is permitted **only** for PySpark + AWS Glue jobs. No other Python usage without VP-level approval.
2. **All LLM interactions MUST use the [Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) with strict TypeScript.** Direct use of provider SDKs (`openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`) for LLM calls is FORBIDDEN. Tool schemas MUST use Zod. No `any` types in LLM-related code.
3. **AWS as primary cloud**, `us-east-2` as primary region.
4. **CDK is the ONLY permitted IaC tool.** All infrastructure MUST be defined in CDK and deployed via `cdk deploy`. Do NOT use Terraform, Pulumi, SAM, CloudFormation YAML/JSON, Serverless Framework, or any other IaC tool.
5. **No secrets in logs.** Never log passwords, tokens, secrets, or PII.
6. **Every metric registered in [Lexicon](https://github.com/Spring-Oaks-Capital-LLC/lexicon)** (`cloudwatch-metrics.json`) **and displayed on [Main Dashboard](https://github.com/Spring-Oaks-Capital-LLC/main-dashboard).** No metric may exist in code without both.
