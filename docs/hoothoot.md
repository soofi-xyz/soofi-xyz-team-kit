# Using Hoothoot

Hoothoot builds secure static reporting apps backed by prod Persist data. Use it in Cursor Agent mode when you want Hoothoot to connect to Persist, build a local report preview from real data, create a GitHub PR, deploy on AWS, and optionally publish to the catalog.

Hoothoot must not make up data. Every report number, row, bucket, chart, KPI, table, or data claim must come from prod Persist, or from a user-provided file that you explicitly identify as an approved Persist export.

## Start In Agent Mode

Open Cursor Marketplace, install the Soofi XYZ team kit, then start a new Agent chat and invoke Hoothoot directly:

```text
/hoothoot Build a report from Persist. Start with a local preview.
Ask me whether to create a new local project or use an existing local project path.
Ask me what widgets or tables I want and how I want the data shown.
First help me verify prod AWS access and connect to Persist. Do not ask about GitHub, deployment, or catalog until I approve the local preview.
```

You can also ask naturally:

```text
Use Hoothoot to add a chart to my existing report showing pay rate by recovery score. Create the query for that chart only.
```

If your request is general, Hoothoot should guide the work like this:

```text
I will find the relevant Persist data model, create focused queries, ask how you want the data shown, and then build the local report from Persist data.
```

## What To Provide

- Where the local report project should live: either a new local project path or an existing local project path.
- What you want to know from the data.
- The table, KPI card, or chart widgets you want.
- The business question each widget must answer.
- How the report should look: layout, chart style, table columns, labels, colors, or examples to match.
- For AWS access, tell Hoothoot what you have: "I think I have a prod profile", "I use SSO", "I have a credentials CSV", or "I do not know".
- If you received an AWS credentials CSV, provide only the local file path and the profile name you want Hoothoot to create.
- Persist fields, filters, companies, dates, or account populations if you know them.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

Hoothoot should not search your machine for an existing project, infer one from your workspace, or decide where the report belongs. It should ask for the local project path first, then use only that path.

Do not ask Hoothoot for a dummy-data or sample-JSON report. A Hoothoot report starts by connecting to prod Persist. If Hoothoot cannot connect, it should keep helping you locate or configure AWS credentials and Persist access before building the preview.

## Query Guidance

Tell Hoothoot the specific widget or table you want. Hoothoot should create one focused query or dataset contract per widget.

For general requests, Hoothoot should find the Persist data model from Lexicon first. Lexicon is the source of truth for vertex labels, edge labels, properties, indexes, enum values, and graph relationships. If the schema or metric definition is unclear, Hoothoot should ask you for the missing business meaning before writing the query.

Avoid asking for one large query for the whole report. Smaller widget-level queries make timings clear, reduce timeout risk, and make it easier to verify each number.

## Persist Access Setup

Hoothoot uses prod Persist for report data. You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable prod AWS profile and guide you through the smallest missing step.

What Hoothoot should do for you:
- Check local AWS profiles when the AWS CLI is available.
- Help locate likely credentials if you do not know the profile name, including checking configured AWS profiles and asking whether you use SSO or have a downloaded credentials CSV.
- Ask you to pick the right prod profile only if there is more than one possible choice.
- Verify the selected profile and explain which AWS account it can access.
- If your profile uses SSO, start the login flow and ask you only to finish the browser login.
- If the profile is missing SSO settings, first ask whether you already have credentials it can use, such as a credentials CSV, a local credentials file path, or another profile name.
- If no existing credentials are available, repair or create the SSO profile for you instead of telling you to run `aws configure sso`.
- If you have an AWS credentials CSV, import it locally without printing the secret values.
- If the profile does not verify as prod, explain the failed check and keep helping you fix AWS access; it should not silently use dev or a default profile.

For SSO-backed profiles, Hoothoot may run the login flow for you and ask you to complete only the browser step:

```bash
aws sso login --profile <profile-name>
```

If AWS says the profile is missing `sso_start_url` or `sso_region`, Hoothoot should not hand you `aws configure sso` as homework. It should look for SSO settings in other local AWS profiles first. Then it should ask whether you already have:
- An AWS credentials CSV from an administrator.
- A local credentials file path.
- Another AWS profile name that should be used instead.

If you have one of those, provide only the local path or profile name. Hoothoot should import or reuse it without printing secret values.

If you do not have existing credentials, Hoothoot should ask in plain language for:
- The company AWS access portal/start URL.
- The SSO region.
- The prod account name or account ID.
- The role name to use.
- The profile name you want.

Once those values are known, Hoothoot should configure or repair the local profile, start SSO login, verify the prod account, and continue to Persist discovery. If any step fails, Hoothoot should explain the failed check and ask the next simple credential question. It should stay in this setup flow until AWS access works or you explicitly cancel.

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

Hoothoot should continue to Persist only when the returned AWS account matches the intended prod account. If the account does not verify, Hoothoot should keep helping you fix AWS access instead of building a report with guessed, dummy, or sample data. It should run local refresh/query commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Persist Discovery

After AWS access is verified, Hoothoot should discover the Persist connection details itself. You should not need to provide `PERSIST_API_URL`, `SSM_PARAMETER_NAME`, API Gateway URLs, or refresh script environment variables unless automatic discovery fails.

Hoothoot should use the verified prod profile to:
- Read the prod AWS account and region from the active credentials.
- Look up Persist configuration from approved AWS locations such as SSM Parameter Store and Secrets Manager.
- Search likely parameter names including `persist-api-url`, `/prod/persist-api-url`, `/prod/persist/api-url`, and service-specific names containing `persist` and `api`.
- Confirm the discovered Persist endpoint with a small read-only smoke query before running report widget queries.
- Explain what it found in plain language, without exposing secrets.
- If AWS access works but no approved Persist configuration can be discovered, explain exactly what was checked and ask for the missing approved Persist configuration location. Do not guess an endpoint.

The local preview should be generated from Persist-fetched JSON or CSV artifacts. Static HTML pages cannot call Persist directly from the browser, so Hoothoot should create or use local server-side refresh/query code to fetch the data first, then serve the static preview. It should not hand you a sample JSON file to load as the report.

If Persist is not reachable yet, Hoothoot can prepare layout, CSS, empty states, and data schemas, but it must label that work as structure only. It must not present a chart, KPI, or table as the report until the data is fetched from Persist.

## Expected Workflow

Hoothoot should use this same workflow for every report request. A broad prompt, existing HTML file, sample JSON file, or partial example should not change the order.

1. Hoothoot asks whether to create a new local report project or use an existing local report project, then collects the exact path.
2. Hoothoot confirms the report and widget list.
3. Hoothoot discovers the relevant Lexicon/Persist fields.
4. Hoothoot helps locate and verify prod AWS credentials.
5. After AWS access works, Hoothoot discovers the Persist connection details from AWS.
6. Hoothoot runs read-only Persist smoke checks and widget queries.
7. Hoothoot builds a local static preview from Persist-generated artifacts.
8. Hoothoot records query timings per widget.
9. After you approve the local preview, Hoothoot asks where the report source should live.
10. Hoothoot creates or updates the report source in GitHub and opens a PR.
11. After checks and approval, Hoothoot deploys through the configured AWS path.
12. Hoothoot asks whether to publish the deployed report to the catalog.

If any step fails, Hoothoot should pause at that step, explain the failure in plain language, ask the next required question, and then resume from that same step. It should not switch to a dummy-data, browser-only, helper-script-only, or manually loaded JSON workflow.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
