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
Use real Persist data if my AWS profile is ready. Do not ask about GitHub, deployment, or catalog until I approve the local preview.
```

You can also ask naturally:

```text
Use Hoothoot to add a chart to my existing report showing pay rate by recovery score. Create the query for that chart only.
```

## What To Provide

- What you want to know from the data.
- The table, KPI card, or chart widgets you want.
- The business question each widget must answer.
- How the report should look: layout, chart style, table columns, labels, colors, or examples to match.
- If the report needs real Persist data, tell Hoothoot whether you already have a prod AWS profile, use SSO, or have an AWS credentials CSV file path.
- If you received an AWS credentials CSV, provide only the local file path and the profile name you want Hoothoot to create.
- Persist fields, filters, companies, dates, or account populations if you know them.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

## Query Guidance

Tell Hoothoot the specific widget or table you want. Hoothoot should create one focused query or dataset contract per widget.

Avoid asking for one large query for the whole report. Smaller widget-level queries make timings clear, reduce timeout risk, and make it easier to verify each number.

## Persist Access Setup

If Hoothoot needs to query Persist with real data, it uses prod Persist. You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable prod AWS profile and guide you through the smallest missing step.

What Hoothoot should do for you:
- Check local AWS profiles when the AWS CLI is available.
- Ask you to pick the right prod profile only if there is more than one possible choice.
- Verify the selected profile and explain which AWS account it can access.
- If your profile uses SSO, start the login flow and ask you only to finish the browser login.
- If you have an AWS credentials CSV, import it locally without printing the secret values.
- Stop if the profile does not verify as prod; it should not silently use dev or a default profile.

For SSO-backed profiles, Hoothoot may run this for you and ask you to complete the browser login:

```bash
aws sso login --profile <profile-name>
```

For locally configured access-key profiles, Hoothoot should prefer an approved internal setup flow or a local CSV file path. Do not paste access keys, session tokens, passwords, or secrets into chat.

The goal is that you say what you have, and Hoothoot performs the safe local checks.

### If You Have An AWS Credentials CSV

If an administrator gave you an AWS credentials CSV, do not paste the CSV contents into chat. Tell Hoothoot only the file path on your machine and the profile name to create:

```text
My AWS credentials CSV is at /Users/me/Downloads/credentials.csv.
Set it up as the profile prod-reporting in us-east-2.
```

Hoothoot can import the CSV locally, configure the named profile, and verify access without printing the credential values. After the profile is working, delete the downloaded CSV from your machine.

Use SSO when available. Credentials CSV files should be treated as sensitive fallback setup material.

Before Hoothoot runs Persist queries, it should verify the active account:

```bash
AWS_PROFILE=<profile-name> AWS_REGION=<region> aws sts get-caller-identity
```

Hoothoot should continue only when the returned AWS account matches the intended prod account. It should run local refresh/query commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Expected Workflow

1. Hoothoot confirms the report and widget list.
2. Hoothoot discovers the relevant Lexicon/Persist fields.
3. Hoothoot confirms AWS profile/region when real Persist access is needed.
4. Hoothoot builds a local static preview first.
5. Hoothoot records query timings per widget.
6. After you approve the local preview, Hoothoot asks where the report source should live.
7. Hoothoot creates or updates the report source in GitHub and opens a PR.
8. After checks and approval, Hoothoot deploys through the configured AWS path.
9. Hoothoot asks whether to publish the deployed report to the catalog.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
