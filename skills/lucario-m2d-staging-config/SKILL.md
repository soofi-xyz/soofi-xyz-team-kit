---
name: lucario-m2d-staging-config
description: "Use when changing or operating Lucario's M2D portfolio staging-config update flow, S3 config publication, GitHub PR creation, or approved sample-media verification."
---

# Lucario: M2D Portfolio Staging-Config Update

## Purpose

Lucario can add or update a single portfolio entry in M2D's `staging-config.json`, publish the merged config directly to configured environment-specific S3 config locations, create a GitHub pull request against the canonical M2D repository, and optionally run an approved verification using sample media.

This action is for portfolio staging configuration only. It does not edit other M2D shared config files.

## When To Use

Use this skill when:

- creating a new portfolio entry
- changing an existing portfolio's staging config
- publishing staging-config changes to one or more configured runtime S3 locations
- opening a matching PR against `Spring-Oaks-Capital-LLC/m2d-pipeline`
- optionally verifying a staging-config change with sample media in an approved target environment

The user should provide either a JSON patch for the portfolio config or clear natural-language instructions that Lucario can convert into a patch.

## Asana Task Contract

Required fields:

- `action`: `update_portfolio_staging_config`
- `portfolioId`: portfolio key in `staging-config.json`
- `configTargets`: one or more target environment labels
- `stagingConfigPatch`: JSON object to deep-merge into `config[portfolioId]`

Optional fields:

- `openPullRequest`: `true` / `false`, defaults to `true`
- `verifyWithSampleMedia`: `true` / `false`
- `sourceBucket` and `sourceKey`: required when `verifyWithSampleMedia` is `true`
- `region`
- `stackName`
- `runId`
- `parentTaskGid`
- `approvalTaskGid`
- `engineeringTaskGid`
- `reviewTaskGid`

If the user only provides prose, interpret the request, propose the portfolio patch, and ask for clarification when target environments or patch details are unclear.

## Runtime Configuration

Set per resolved environment:

- environment-specific M2D workflow stack used to discover runtime `CONFIG_BUCKET` / `CONFIG_KEY` for `staging-config.json`
- environment-specific region for CloudFormation and Lambda discovery
- optional environment-specific assume role for cross-account stack discovery and S3 access
- `M2D_GITHUB_OWNER` / `M2D_GITHUB_REPO`: canonical M2D GitHub repo
- `M2D_GITHUB_DEFAULT_BRANCH`: base branch for PRs, `main` by default
- `M2D_GITHUB_SECRET_ARN`: Secrets Manager secret containing GitHub token JSON like `{"token":"..."}`

Lucario's runtime role needs `cloudformation:DescribeStackResources`, `lambda:GetFunctionConfiguration`, read/write access to the discovered staging-config S3 objects, and `secretsmanager:GetSecretValue` for the GitHub token secret.

## Behavior

1. Validate the request. `portfolioId`, `configTargets`, and a patch are required.
2. Load current config from the chosen source environment.
3. Deep-merge the patch into `config[portfolioId]` only.
4. Leave other portfolio keys and `default` untouched.
5. Publish the fully merged config to the requested S3 targets.
6. Create a GitHub PR that updates `workflow/functions/shared/staging-config.json` with the same merged file content.
7. If `verifyWithSampleMedia` is `true`, run a preprocessing test using supplied sample media after publishing to an approved verification target.
8. Comment once with S3 targets updated, PR URL, and verification run ID when applicable, then complete the task.

## Safety

- Prefer explicit `configTargets` over guessing.
- Require sample media before verification.
- Verification must use an approved non-customer-impacting target unless the user explicitly approves the target.
- Keep GitHub and S3 content aligned by using the same rendered JSON for both.
- Do not silently edit unrelated portfolio entries.

## Out Of Scope

- Do not edit `context_file_config.json`, `interprose_tag_mapping.json`, or other M2D config files.
- Do not merge multiple unrelated portfolio changes in one task.
- Do not promise automatic rollback if the PR is closed later.
