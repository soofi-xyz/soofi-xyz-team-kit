# Using Hoothoot

Hoothoot is a prod Persist-only reporting agent that runs a single Lexicon-rule-aware flow. It consumes the existing Lexicon, Rules, Persist, and report-publishing products; it does not build or redesign those platform products as part of report work. Use it in Cursor Agent mode when you want Hoothoot to connect to prod Persist, resolve the relevant Lexicon ruleset, build a local report preview from real data, create a GitHub PR, deploy on AWS, and optionally publish to the catalog.

Hoothoot does not operate in separate modes. Every report request moves through the same decision lifecycle. Hoothoot picks the right branch based on what Lexicon and Rules already provide.

Hoothoot must not make up data. Every report number, row, bucket, chart, KPI, table, or data claim must come from prod Persist, from a released and registered Lexicon ruleset's Rules execution output, or from a user-provided file that you explicitly identify as an approved Persist or Rules-released export.

Current business questions such as "how many callable accounts do we have?" are report data requests. Hoothoot may use local Lexicon files, rulesets, docs, SQL snippets, and code search results to understand the definition, but it should not answer the current count from those files. It also should not use Athena, cached outputs, notebooks, dashboards, generated reports, or broad filesystem searches unless you explicitly say that source is an approved Persist or Rules-released export for this report. If prod Persist/Rules is not connected yet, Hoothoot should say the count is not available yet and continue the AWS setup flow.

## Start In Agent Mode

Open Cursor Marketplace, install the Soofi XYZ team kit, then start a new Agent chat and invoke Hoothoot directly:

```text
/hoothoot Build a report from Persist. Start with a local preview.
Ask me whether to create a new local project or use an existing local project path.
Then help me verify prod AWS access and resolve the Lexicon ruleset before creating any report files.
Do not ask about GitHub, deployment, or catalog until I approve the local preview.
```

You can also ask naturally:

```text
Use Hoothoot to build a fresh Persist-backed report. Ask where to create it locally, then connect to prod AWS, resolve the Lexicon ruleset, and run Persist or Rules before creating files.
```

If your request is general, Hoothoot should guide the work like this:

```text
First I need the local project path, then I will verify prod AWS access, resolve the relevant Lexicon ruleset, and either read the latest released Rules output or run a Persist smoke check before creating any report files.
```

## How Hoothoot Decides

Hoothoot is always aware of Lexicon. When you ask a rule-derived question ("show callable numbers", "count eligible accounts", "list active payers"), Hoothoot:

1. Resolves which registered Lexicon ruleset(s) define the population.
2. Checks whether the deployed Rules service has already released an output for that ruleset.
3. Uses the released output directly when one exists.
4. Starts a new Rules execution when the ruleset is registered/released but no fresh output exists. For broad runs, Hoothoot asks you to confirm scope first.
5. Only when you explicitly ask to insert new data or to add/change a rule does Hoothoot open a Lexicon branch and PR to create or modify a ruleset. Hoothoot then waits for that ruleset to be released and registered before running an execution and ingesting the output.

For graph-level requests that are not rule-derived (a simple count of vertices by an indexed enum that has no business-rule meaning), Hoothoot may issue a read-only Persist query against Lexicon labels and indexes directly. Hoothoot will tell you in plain language which branch it took.

## Guardrails

- Hoothoot never inserts newly derived data unless it was produced by a Lexicon ruleset that is registered and released and executed by Rules.
- Every widget shows ruleset provenance: ruleset name, release tag, Lexicon ref, Rules workflow/execution ID, and the S3 output location used.
- Every AWS command runs with an explicit `AWS_PROFILE` and `AWS_REGION` so prod credentials are never implied by shell state.
- PII never appears in PR descriptions, commit messages, screenshots, or chat. Reports show counts, bucket labels, and ruleset identifiers.
- For broad runs (whole-portfolio scans, untargeted aggregations, full Rules executions), Hoothoot surfaces a cost confirmation step and waits for your explicit go-ahead.
- No dummy, sample, or unverified data is shown in the preview or the deployed report.

## What To Provide

- Where the local report project should live: either a new local project path or an existing local project path.
- For AWS access, Hoothoot should always offer these choices: "I have a prod AWS profile", "I use SSO", "I have an AWS credentials CSV", "I have another local credentials file or profile", or "I do not know".
- If you received an AWS credentials CSV, provide only the local file path, the profile name you want Hoothoot to create, and the AWS region. Hoothoot should create or update the profile for you and verify the prod account.
- After AWS access is connected: what you want to know from the data, the table/KPI/chart widgets you want, the business question each widget must answer, and how the report should look.
- Persist fields, filters, companies, dates, or account populations if you know them.
- If you want to add new data or to add/change a rule, say so explicitly — that is the only branch where Hoothoot will open a Lexicon PR.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

Hoothoot should not search your machine for an existing project, infer one from your workspace, or decide where the report belongs. It should ask for the local project path first, then use only that path.

After it has the local project path, Hoothoot should connect to prod AWS, resolve the relevant Lexicon ruleset, and either read the latest Rules-released output or run a Persist smoke query immediately. It should not create a scaffold, write helper scripts, create example artifacts, run an example refresh, build UI files, or start a local server until that gate passes.

Do not ask Hoothoot for a dummy-data or sample-JSON report. A Hoothoot report starts by connecting to prod and resolving the Lexicon ruleset. If Hoothoot cannot connect, it should keep helping you locate or configure AWS credentials and discover Persist/Rules before building the preview.

## Query Guidance

Tell Hoothoot the specific widget or table you want. Hoothoot should create one focused dataset contract per widget, with ruleset provenance when the widget is rule-derived.

For general requests, Hoothoot should find the Persist data model from Lexicon first. Lexicon is the source of truth for vertex labels, edge labels, properties, indexes, enum values, graph relationships, and registered rulesets. If the schema, metric definition, population filter, or business term is unclear, Hoothoot should ask you for the missing business meaning before writing the query or starting an execution.

Hoothoot should not substitute a nearby metric for the one you asked for. For example, if you ask for callable accounts, Hoothoot must resolve the callable accounts ruleset from Lexicon, use its released Rules output (or start an execution if needed), and not silently count debts or another population because that data is easier to query.

Hoothoot should keep the preview limited to the requested widgets, tables, and charts. It should not add unrelated KPIs, broad dashboard sections, exploratory tables, or extra charts unless you explicitly ask for them.

If Cursor or another routing layer frames a Hoothoot request as a local workspace investigation, Hoothoot should still treat current counts and report numbers as prod Persist/Rules questions. Local workspace search can support definition discovery only; it cannot replace the live data path.

Avoid asking for one large query for the whole report. Smaller widget-level queries or per-widget Rules output reads make timings clear, reduce timeout risk, and make it easier to verify each number.

## When A Ruleset Does Not Exist Yet

If no registered or released Lexicon ruleset exists for the rule-derived data you want, Hoothoot will not invent a query that approximates the rule. Instead, if you explicitly ask Hoothoot to add or change a rule (or to insert new data that requires a new ruleset), Hoothoot leaves normal report-generation mode and performs a focused Lexicon change handoff:

1. Draft only the ruleset/data change needed by the report, using the existing Lexicon repository conventions and released schema format.
2. Open a Lexicon branch and PR with the proposed ruleset/data change and a PR body containing the business intent and references — no PII.
3. Wait for the ruleset to be released and registered.
4. Once released, start a Rules execution for the new ruleset and read its output before ingesting anything into the report.

Hoothoot does not use product-builder skills such as `build-lexicon-product`, `build-rules-product`, `build-persist-service`, or `build-batch-workflows` to create or redesign platform products. It consumes deployed product contracts and hands off platform-building work to the appropriate specialist when the existing products cannot support the report.

If you did not ask to add or change a rule, Hoothoot will stop and tell you that the ruleset is missing rather than approximating it.

## Persist Access Setup

Hoothoot uses prod Persist for direct Lexicon-label data and reads Rules-released outputs for rule-derived populations. You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable prod AWS profile and guide you through the smallest missing step.

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

Once those values are known, Hoothoot should configure or repair the local profile, start SSO login, verify the prod account, and continue to Persist/Rules discovery. If any step fails, Hoothoot should explain the failed check and ask the next simple credential question. It should stay in this setup flow until AWS access works or you explicitly cancel.

For locally configured access-key profiles, Hoothoot should prefer an approved internal setup flow or a local CSV file path. Do not paste access keys, session tokens, passwords, or secrets into chat.

The goal is that you say what you have, and Hoothoot performs the safe local checks.

### If You Have An AWS Credentials CSV

If an administrator gave you an AWS credentials CSV, do not paste the CSV contents into chat. Tell Hoothoot only the file path on your machine and the profile name to create:

```text
My AWS credentials CSV is at /Users/me/Downloads/credentials.csv.
Set it up as the profile prod-reporting in us-east-2.
```

Hoothoot can import the CSV locally, configure the named profile, and verify access without printing the credential values. You should not have to run `aws configure` manually. After the profile is working, delete the downloaded CSV from your machine.

Use SSO when available. Credentials CSV files should be treated as sensitive fallback setup material.

Before Hoothoot runs Persist queries or Rules-output reads, it should verify the active account:

```bash
AWS_PROFILE=<profile-name> AWS_REGION=<region> aws sts get-caller-identity
```

Hoothoot should continue only when the returned AWS account matches the intended prod account. If the account does not verify, Hoothoot should keep helping you fix AWS access instead of building a report with guessed, dummy, or sample data. It should always run local refresh/query commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Persist And Rules Discovery

After AWS access is verified, Hoothoot should discover Persist and Rules connection details itself. You should not need to provide `PERSIST_API_URL`, `SSM_PARAMETER_NAME`, API Gateway URLs, Rules Step Functions ARNs, S3 output prefixes, or refresh script environment variables unless automatic discovery fails.

Hoothoot should use the verified prod profile to:
- Read the prod AWS account and region from the active credentials.
- Look up Persist configuration from approved AWS locations such as SSM Parameter Store and Secrets Manager (parameter names like `persist-api-url`, `/prod/persist-api-url`, `/prod/persist/api-url`, and service-specific names containing `persist` and `api`).
- Discover the Rules workflow identifier(s), Step Functions ARN(s), and the canonical S3 prefix where released ruleset outputs land.
- Confirm the discovered Persist endpoint with a small read-only smoke query before running report widget queries.
- Confirm the discovered Rules output location by reading the metadata of the most recent released output for the resolved ruleset.
- Explain what it found in plain language, without exposing secrets.
- If AWS access works but no approved Persist/Rules configuration can be discovered, explain exactly what was checked and ask for the missing approved configuration location. Do not guess an endpoint.

The local preview should be generated from Persist-fetched JSON/CSV artifacts (for direct Lexicon reads) or from the latest released Rules output (for rule-derived populations). Static HTML pages cannot call Persist directly from the browser, so Hoothoot creates or uses local server-side refresh/query code to fetch the data first, then serves the static preview. It should not hand you a sample JSON file to load as the report.

If Persist or Rules is not reachable yet, Hoothoot should not prepare layout, CSS, empty states, data schemas, helper scripts, example artifacts, or UI scaffolds. It should stay in the AWS/Persist/Rules setup flow until access works or you explicitly cancel.

## Expected Workflow

Hoothoot should use this same lifecycle for every report request. A broad prompt, existing HTML file, sample JSON file, or partial example should not change the order.

1. Hoothoot asks whether to create a new local report project or use an existing local report project, then collects the exact path.
2. Hoothoot asks which AWS credential source to use, always offering profile, SSO, credentials CSV path, another credentials file/profile, or "I do not know."
3. Hoothoot helps locate and verify prod AWS credentials.
4. After AWS access works, Hoothoot discovers the Persist and Rules connection details from AWS.
5. Hoothoot classifies the request as data-read or data-insert. (If ambiguous, it asks one short question.)
6. Hoothoot resolves the relevant Lexicon ruleset(s) and records release metadata.
7. For rule-derived widgets, Hoothoot reads the latest Rules-released output if one matches the ruleset and freshness window.
8. If no fresh output exists, Hoothoot proposes a Rules execution, surfaces cost for broad runs, waits for your go-ahead, starts the execution, and waits for completion.
9. If no registered/released ruleset exists and you explicitly asked to add/change a rule, Hoothoot opens a Lexicon PR and waits for release before continuing. Otherwise Hoothoot stops and surfaces the missing ruleset.
10. For direct Lexicon-label widgets, Hoothoot runs read-only Persist smoke checks and focused widget queries.
11. Hoothoot confirms the report and widget list, with ruleset provenance per widget.
12. Hoothoot builds a local static preview from Persist-generated or Rules-released artifacts.
13. Hoothoot records timings: Lexicon resolution, Rules read/execution, each Persist query, artifact generation.
14. After you approve the local preview, Hoothoot asks where the report source should live.
15. Hoothoot creates or updates the report source in GitHub and opens a PR with provenance, timing, and no PII.
16. After checks and approval, Hoothoot deploys through the configured AWS path.
17. Hoothoot asks whether to publish the deployed report to the catalog.

If any step fails, Hoothoot should pause at that step, explain the failure in plain language, ask the next required question, and then resume from that same step. It should not switch to a dummy-data, browser-only, helper-script-only, or manually loaded JSON workflow.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
