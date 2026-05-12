# Using Hoothoot

Hoothoot builds secure static reporting apps backed by Persist data. Use it in Cursor Agent mode when you want a local report preview, focused Persist queries, a GitHub PR, an AWS deployment, and optional catalog publishing.

## Start In Agent Mode

Invoke Hoothoot directly:

```text
/hoothoot Build a DSA accounts report. Start with a local preview.
Widgets:
- KPI: total DSA accounts
- Chart: pay rate by balance bucket
- Table: top 15 DSA companies by balance
Use prod Persist data, but do not deploy until I approve the preview.
```

You can also ask naturally:

```text
Use Hoothoot to add a chart to my existing report showing pay rate by recovery score. Create the query for that chart only.
```

## What To Provide

- Report name, audience, and the business question.
- The table, KPI card, or chart widgets you want.
- The business question each widget must answer.
- Environment: `dev` or `prod`.
- AWS profile and region for Persist access when the report needs real Persist data.
- Persist fields, filters, companies, dates, or account populations if you know them.
- Access model: Cognito username/password or Microsoft Azure SSO.
- GitHub owner/repository destination for report source.
- Whether to add the deployed report to the catalog.

## Query Guidance

Tell Hoothoot the specific widget or table you want. Hoothoot should create one focused query or dataset contract per widget.

Avoid asking for one large query for the whole report. Smaller widget-level queries make timings clear, reduce timeout risk, and make it easier to verify each number.

## Persist Access Setup

If Hoothoot needs to query Persist with real `dev` or `prod` data, your local AWS profile must already be configured for that environment. Hoothoot should ask for the intended AWS profile and region before running Persist queries.

For SSO-backed profiles, refresh access before querying:

```bash
aws sso login --profile <profile-name>
```

For locally configured access-key profiles, update the profile through the approved internal process or:

```bash
aws configure --profile <profile-name>
```

Do not paste access keys, session tokens, passwords, or secrets into chat.

Before Hoothoot runs Persist queries, verify the active account:

```bash
AWS_PROFILE=<profile-name> AWS_REGION=<region> aws sts get-caller-identity
```

Only continue when the returned AWS account matches the intended `dev` or `prod` account. Hoothoot should run local refresh/query commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Expected Workflow

1. Hoothoot confirms the report and widget list.
2. Hoothoot discovers the relevant Lexicon/Persist fields.
3. Hoothoot confirms AWS profile/region when real Persist access is needed.
4. Hoothoot builds a local static preview first.
5. Hoothoot records query timings per widget.
6. After approval, Hoothoot creates or updates the report source in GitHub and opens a PR.
7. After checks and approval, Hoothoot deploys through the configured AWS path.
8. Hoothoot asks whether to publish the deployed report to the catalog.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

For Microsoft Azure login, Hoothoot uses Cognito federation to the shared Hoothoot SSO broker for the selected environment.
