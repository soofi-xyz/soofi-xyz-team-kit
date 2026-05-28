# Using Hoothoot

Hoothoot is a prod AWS reporting agent for current counts, debt-identifier lists, tables, charts, dashboards, and secure static reporting apps. It uses direct prod Persist for aggregate report datasets and the Rules/legacy Filter product for non-aggregate debt-list or ruleset-driven eligibility requests.

Hoothoot must not make up data. Every report number, row, bucket, chart, KPI, table, or data claim must come from direct prod Persist aggregate results, Rules/Filter output artifacts, or from a user-provided file that you explicitly identify as an approved prod export.

Current business questions such as "how many callable accounts do we have?" are report data requests. Hoothoot may use local Lexicon files, rulesets, docs, SQL snippets, and code search results to understand the definition, but it should not answer the current count from those files. It also should not use Athena, cached outputs, notebooks, dashboards, generated reports, or broad filesystem searches unless you explicitly say that source is an approved Persist-derived export for this report. If prod Persist is not connected yet, Hoothoot should say the count is not available yet and continue the AWS/Persist setup flow.

## Start In Agent Mode

Open Cursor Marketplace, install the Soofi XYZ team kit, then start a new Agent chat and invoke Hoothoot directly:

```text
/hoothoot Build a report from Persist. Start with a local preview.
Ask me whether to create a new local project or use an existing local project path.
Then help me verify prod AWS access and choose the correct data route before creating any report files.
Do not ask about GitHub, deployment, or catalog until I approve the local preview.
```

You can also ask naturally:

```text
Use Hoothoot to build a fresh prod-backed report. Ask where to create it locally, then connect to prod AWS and choose the correct data route before creating files.
```

If your request is general, Hoothoot should guide the work like this:

```text
First I need the local project path, then I will verify prod AWS access and run the chosen data route's smoke check before creating any report files.
```

## What To Provide

- Where the local report project should live: either a new local project path or an existing local project path.
- For AWS access, Hoothoot should always offer these choices: "I have a prod AWS profile", "I use SSO", "I have an AWS credentials CSV", "I have another local credentials file or profile", or "I do not know".
- If you received an AWS credentials CSV, provide only the local file path, the profile name you want Hoothoot to create, and the AWS region. Hoothoot should create or update the profile for you and verify the prod account.
- After AWS/Persist is connected: what you want to know from the data, the table/KPI/chart widgets you want, the business question each widget must answer, and how the report should look.
- Persist fields, filters, companies, dates, or account populations if you know them.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

Hoothoot should not search your machine for an existing project, infer one from your workspace, or decide where the report belongs. It should ask for the local project path first, then use only that path.

After it has the local project path, Hoothoot should connect to prod AWS and choose the route immediately. It should not create a scaffold, write helper scripts, create example artifacts, run an example refresh, build UI files, or start a local server until AWS verifies and the chosen route passes a smoke check.

Do not ask Hoothoot for a dummy-data or sample-JSON report. A Hoothoot report starts by connecting to prod AWS and choosing direct Persist for aggregate requests or Rules/Filter for debt-list requests.

## Query Guidance

Tell Hoothoot the specific widget or table you want. Hoothoot should create one focused query or dataset contract per widget.

For general requests, Hoothoot should route first. Aggregate requests use direct Persist. Non-aggregate requests that select a list of `debt_identifier` values use Rules/legacy Filter, including ruleset changes and direct Filter workflow invocation.

Hoothoot should not substitute a nearby metric for the one you asked for. For example, if you ask for callable accounts, Hoothoot must use the selected ruleset or ask you for the callable rule. It should not simply count debts, accounts, or another population because that data is easier to query.

Hoothoot should keep the preview limited to the requested widgets, tables, and charts. It should not add unrelated KPIs, broad dashboard sections, exploratory tables, or extra charts unless you explicitly ask for them.

If Cursor or another routing layer frames a Hoothoot request as a local workspace investigation, Hoothoot should still treat current counts and report numbers as prod Persist questions. Local workspace search can support definition discovery only; it cannot replace the live Persist query.

For aggregate requests such as counts, sums, averages, and grouped chart buckets, Hoothoot should use focused prod Persist report queries. For non-aggregate requests where Hoothoot must select a list of `debt_identifier` values, such as callable debts or another eligibility population, it should use the Rules product route and the legacy Filter deployment alias when that is the available surface. Hoothoot must not call Persist Gremlin directly for this route; Filter may call Persist internally.

For Rules/Filter requests, Hoothoot should discover the Filter state machine ARN from SSM `filter-workflow-state-machine-arn` or `/rules/workflow/state-machine-arn`, and discover the ruleset catalog prefix from `/lexicon/rulesets-uri`. Every ruleset change must be tracked in the canonical Lexicon repo, normally `/home/movsiienko/Projects/socapital/lexicon`, under `src/data/rulesets/**`. Hoothoot should create a Lexicon branch, update the ruleset files, validate them, commit, push, and open a PR. It should not leave ruleset changes only in S3 or local scratch files.

If rules are changed for one execution, Hoothoot should still create the Lexicon PR, then upload each rule to its own S3 prefix containing exactly one `.json` definition and one `.gremlin` query, then pass those prefixes as `rule_s3_uris`. If the shared catalog changes, Hoothoot should create the Lexicon PR, then upload `index.json`, the ruleset manifest, and the rule `.json`/`.gremlin` files under the `/lexicon/rulesets-uri` prefix before invoking Filter. Use `input_s3_uri` only for an approved CSV/Parquet population with a `debt_id` column; otherwise omit it and let Filter discover debt identifiers internally.

Avoid asking for one large query for the whole report. Smaller widget-level queries make timings clear, reduce timeout risk, and make it easier to verify each number.

## Persist Access Setup

Hoothoot uses prod AWS services for report data. You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable prod AWS profile and guide you through the smallest missing step.

What Hoothoot should do for you:
- Check local AWS profiles when the AWS CLI is available.
- Help locate likely credentials if you do not know the profile name, including checking configured AWS profiles and asking whether you use SSO or have a downloaded credentials CSV.
- Always offer the credentials CSV path option when AWS access is missing. It should not ask only for a prod AWS profile.
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

Hoothoot can import the CSV locally, configure the named profile, and verify access without printing the credential values. The user should not have to run `aws configure` manually. After the profile is working, delete the downloaded CSV from your machine.

Use SSO when available. Credentials CSV files should be treated as sensitive fallback setup material.

Before Hoothoot runs Persist queries, it should verify the active account:

```bash
AWS_PROFILE=<profile-name> AWS_REGION=<region> aws sts get-caller-identity
```

Hoothoot should continue only when the returned AWS account matches the intended prod account. If the account does not verify, Hoothoot should keep helping you fix AWS access instead of building a report with guessed, dummy, or sample data. It should run local refresh/query/workflow commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Persist Discovery

After AWS access is verified, Hoothoot should discover the chosen route's connection details itself. You should not need to provide `PERSIST_API_URL`, state machine ARNs, SSM parameter names, API Gateway URLs, or refresh script environment variables unless automatic discovery fails.

Hoothoot should use the verified prod profile to:
- Read the prod AWS account and region from the active credentials.
- Look up direct Persist configuration for aggregate requests, or Filter workflow and Lexicon ruleset configuration for debt-list requests, from approved AWS locations such as SSM Parameter Store and Secrets Manager.
- Search likely parameter names including `persist-api-url`, `/prod/persist-api-url`, `/prod/persist/api-url`, and service-specific names containing `persist` and `api`.
- Confirm the discovered route with a small safe smoke check before running report widget queries or Filter executions.
- Explain what it found in plain language, without exposing secrets.
- If AWS access works but no approved Persist configuration can be discovered, explain exactly what was checked and ask for the missing approved Persist configuration location. Do not guess an endpoint.

The local preview should be generated from prod route JSON or CSV artifacts. Static HTML pages cannot call Persist or Filter directly from the browser, so Hoothoot should create or use local server-side refresh/query/workflow code to fetch the data first, then serve the static preview. It should not hand you a sample JSON file to load as the report.

If the chosen prod route is not reachable yet, Hoothoot should not prepare layout, CSS, empty states, data schemas, helper scripts, example artifacts, or UI scaffolds. It should stay in the AWS setup flow until access works or you explicitly cancel.

## Expected Workflow

Hoothoot should use this same workflow for every report request. A broad prompt, existing HTML file, sample JSON file, or partial example should not change the order.

1. Hoothoot asks whether to create a new local report project or use an existing local report project, then collects the exact path.
2. Hoothoot asks which AWS credential source to use, always offering profile, SSO, credentials CSV path, another credentials file/profile, or "I do not know."
3. Hoothoot helps locate and verify prod AWS credentials.
4. After AWS access works, Hoothoot chooses aggregate Persist or Rules/Filter.
5. Hoothoot discovers the chosen route's connection details and runs smoke checks.
6. Hoothoot confirms the report and widget list.
7. Hoothoot discovers the relevant Lexicon/Persist fields or Filter ruleset contract.
8. Hoothoot runs focused aggregate queries or invokes Filter directly.
9. Hoothoot builds a local static preview from Persist-generated artifacts.
10. Hoothoot records query timings per widget.
11. After you approve the local preview, Hoothoot asks where the report source should live.
12. Hoothoot creates or updates the report source in GitHub and opens a PR.
13. After checks and approval, Hoothoot deploys through the configured AWS path.
14. Hoothoot asks whether to publish the deployed report to the catalog.

If any step fails, Hoothoot should pause at that step, explain the failure in plain language, ask the next required question, and then resume from that same step. It should not switch to a dummy-data, browser-only, helper-script-only, or manually loaded JSON workflow.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
