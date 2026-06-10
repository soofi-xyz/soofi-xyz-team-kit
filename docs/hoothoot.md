# Using Hoothoot

Hoothoot is a prod-first Persist reporting agent that runs a single Lexicon-rule-aware flow. It consumes the existing Lexicon, Rules, Persist, and report-publishing products; it does not build or redesign those platform products as part of report work. Use it in Cursor Agent mode when you want Hoothoot to connect to prod Persist, resolve the relevant Lexicon ruleset/filter/rule, build a local report preview from real data, create a GitHub PR, deploy on AWS, and optionally publish to the catalog.

Hoothoot does not operate in separate user-visible modes. Every report request moves through the same internal decision lifecycle, but Hoothoot should keep those internal paths invisible and describe the work in plain language: what it found, what data source it used, what is missing, and what happens next.

Hoothoot must not make up data. Every report number, row, bucket, chart, KPI, table, or data claim must come from Persist in the selected environment (prod by default), from a released and registered Lexicon ruleset's Rules execution output fetched through verified AWS access, or from an exact filter or separate rule executed through read-only Persist integration.

Current business questions such as "how many callable accounts do we have?" are report data requests. Hoothoot may use local Lexicon files, rulesets, filters, docs, SQL snippets, and code search results to understand the definition, but it should not answer the current count from those files. It also should not use Athena, cached outputs, notebooks, dashboards, generated reports, user-provided exports, or broad filesystem searches for report numbers. If Persist/Rules is not connected yet, Hoothoot should say the count is not available yet and continue the AWS setup flow.

Prod is the default for report numbers. Hoothoot may use dev or another non-prod environment only when you explicitly say this is a dev/test report or non-prod validation and accept that the numbers are not current production business truth. Every AWS command still needs an explicit profile and region.

## Start In Agent Mode

Open Cursor Marketplace, install the Soofi XYZ team kit, then start a new Agent chat and invoke Hoothoot directly:

```text
/hoothoot Build a report from Persist. Start with a local preview.
Ask me whether to create a new local project or use an existing local project path.
Then help me verify AWS access for the selected environment and resolve the Lexicon ruleset/filter/rule before creating any report files.
If I have not stated the core business question yet, ask that before resolving the rule/filter.
Do not ask about GitHub, deployment, or catalog until I approve the local preview.
```

You can also ask naturally:

```text
Use Hoothoot to build a fresh Persist-backed report. Ask where to create it locally, then connect to AWS for the selected environment, resolve the Lexicon ruleset/filter/rule, and run Persist or Rules before creating files.
```

If your request is general, Hoothoot should guide the work like this:

```text
First I need the local project path, AWS access path, and the core business question if you have not already stated it. Then I will verify prod AWS access by default, resolve the relevant Lexicon ruleset/filter/rule, and run a bounded data-shape discovery query or Rules output metadata/sample check before creating any report files. If this is explicitly a dev/test report, I will use the managed `DevReportingReadonly` profile and label the output accordingly.
```

## How Hoothoot Decides

Hoothoot is always aware of Lexicon. When you ask a rule-derived question ("show callable numbers", "count eligible accounts", "list active payers"), Hoothoot:

1. Checks whether registered Lexicon ruleset(s), released filters, or separate rules define the population.
2. Checks whether the deployed Rules service has already released an output for a matching ruleset.
3. Uses the released output directly when one exists.
4. Starts a new Rules execution when the ruleset is registered/released but no fresh output exists. For broad runs, Hoothoot asks you to confirm scope first.
5. Executes an exact filter or separate rule through read-only Persist integration when that is the available contract. It validates every referenced label, property, index, edge, and enum against Lexicon before running it.
6. When no matching ruleset, filter, or separate rule exists for a rule-derived request, Hoothoot opens a focused Lexicon branch and PR for the missing ruleset/filter/rule. Hoothoot then waits for that change to be released and registered before using it.

For graph-level requests that are not rule-derived (a simple count of vertices by an indexed enum that has no business-rule meaning), Hoothoot may issue a read-only Persist query against Lexicon labels and indexes directly only when the Lexicon definition is unambiguous and bounded data-shape discovery succeeds. This direct-read allowance must not replace a ruleset, filter, or separate rule for callable, eligible, suppressed, decision-bound, or other business-defined populations. Hoothoot should describe the data source and provenance, not internal branch names.

## Guardrails

- Hoothoot never inserts newly derived data unless it was produced by a registered/released Lexicon ruleset executed by Rules through verified AWS access, or by an exact filter or separate rule executed read-only through Persist.
- The main report uses plain data-source labels and freshness. Full rule/filter provenance belongs in a compact audit/details section and PR/deploy notes: ruleset/filter/rule name, release tag or source ref, Lexicon ref, whether the data came from an existing Rules output, a new Rules run, or a read-only Persist query, Rules workflow/execution ID or Persist request ID when available, and the S3 output location or Persist query summary used.
- Every AWS command runs with an explicit `AWS_PROFILE` and `AWS_REGION` so prod credentials are never implied by shell state.
- PII never appears in PR descriptions, commit messages, screenshots, or chat. Reports show counts, bucket labels, and rule/filter identifiers.
- For broad runs (whole-portfolio scans, untargeted aggregations, full Rules executions, or broad direct Persist filter/rule executions), Hoothoot surfaces a cost confirmation step and waits for your explicit go-ahead.
- No dummy, sample, or unverified data is shown in the preview or the deployed report.

## What To Provide

- Where the local report project should live: either a new local project path or an existing local project path.
- For AWS access, Hoothoot should always offer these choices: "Use the managed Hoothoot reporting profile", "I use SSO", "I have an AWS credentials CSV", "I have another local credentials file or profile", or "I do not know".
- If you received an AWS credentials CSV, provide only the local file path, the profile name you want Hoothoot to create, and the AWS region. Hoothoot should create or update the profile for you and verify the prod account.
- Before rule/filter resolution: the core business question, unless you already stated it in your prompt.
- After AWS access is connected and Hoothoot has inspected the data shape: the table/KPI/chart widgets you want, the business question each widget must answer, and how the report should look.
- Persist fields, filters, companies, dates, or account populations if you know them.
- If you want to insert or mutate source data, say so explicitly. Missing ruleset/filter/rule definitions for rule-derived reports are handled through a focused Lexicon PR when the business intent is clear.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

Hoothoot should not search your machine for an existing project, infer one from your workspace, or decide where the report belongs. It should ask for the local project path first, then use only that path.

After it has the local project path, Hoothoot should connect to prod AWS by default, resolve the relevant Lexicon ruleset/filter/rule, and run a bounded data-shape discovery query or Rules output metadata/sample check immediately. It may use a named non-prod profile only for an explicit dev/test report. It should not create a scaffold, write helper scripts, create example artifacts, run an example refresh, build UI files, or start a local server until that gate passes.

Do not ask Hoothoot for a dummy-data or sample-JSON report. A Hoothoot report starts by connecting to prod and resolving the Lexicon ruleset/filter/rule. If Hoothoot cannot connect, it should keep helping you locate or configure AWS credentials and discover Persist/Rules before building the preview.

## Query Guidance

Tell Hoothoot the core business question first. Hoothoot should understand the resolved data shape before asking for detailed widgets/tables/charts. After data-shape discovery, it should create one focused dataset contract per widget, with rule/filter provenance when the widget is rule-derived.

For general requests, Hoothoot should find the Persist data model from Lexicon first. Lexicon is the source of truth for vertex labels, edge labels, properties, indexes, enum values, graph relationships, registered rulesets, filters, and separately executable rules. If the schema, metric definition, population filter, or business term is unclear, Hoothoot should ask you for the missing business meaning before writing the query or starting an execution.

Hoothoot should not substitute a nearby metric for the one you asked for. For example, if you ask for callable accounts, Hoothoot must resolve whether a callable accounts ruleset, filter, or separate rule exists, then use its released Rules output, start a Rules execution, or execute the exact filter/rule through Persist. It must not silently count debts or another population because that data is easier to query.

After Hoothoot understands the data shape, it should keep the preview limited to the requested widgets, tables, and charts. It should not add unrelated KPIs, broad dashboard sections, exploratory tables, or extra charts unless you explicitly ask for them.

If Cursor or another routing layer frames a Hoothoot request as a local workspace investigation, Hoothoot should still treat current counts and report numbers as prod Persist/Rules questions. Local workspace search can support definition discovery only; it cannot replace the live data path.

Avoid asking for one large query for the whole report. Smaller widget-level queries, per-widget Rules output reads, or per-widget direct Persist filter/rule executions make timings clear, reduce timeout risk, and make it easier to verify each number.

Hoothoot must never build report queries from graph-internal vertex or edge identifiers. Do not ask it to use `hasId(...)`, `id()`, `T.id`, `has(T.id, ...)`, `within(...)` over internal element IDs, `startingWith(...)` over internal element IDs, or any other internal Persist element ID shortcut. Hoothoot should use Lexicon-declared business identifiers, properties, and indexes instead, such as `debt_identifier`, `person_identifier`, released Rules outputs, or exact released filters/rules. If a report cannot be answered without internal element IDs, Hoothoot should stop and ask for the proper business key or Lexicon rule/filter definition rather than running the query.

Report artifacts and audit notes should not contain internal vertex or edge IDs. Row keys should be business identifiers or report-local synthetic row numbers that are clearly not Persist IDs.

## When A Ruleset Does Not Exist Yet

If no registered or released Lexicon ruleset exists for the rule-derived data you want, Hoothoot should next check whether an exact released filter or separate rule exists and can be executed through read-only Persist integration. It may run that filter/rule only when the definition is explicit, traceable, and validated against Lexicon. It must not invent a query that approximates the rule.

If no matching ruleset, filter, or separate rule exists for a rule-derived request, report generation waits on a focused Lexicon change. If the business meaning is ambiguous, Hoothoot asks for the missing definition details first; if the business intent is clear, it drafts the needed Lexicon change:

1. Draft only the ruleset/filter/data change needed by the report, using the existing Lexicon repository conventions and released schema format.
2. Open a Lexicon branch and PR with the proposed ruleset/filter/data change and a PR body containing the business intent and references — no PII.
3. Wait for the ruleset/filter/rule to be released and registered when release is required.
4. Once released, use the released Rules output, start a Rules execution, or execute the exact direct Persist filter/rule before ingesting anything into the report.

Hoothoot does not use product-builder skills such as `build-lexicon-product`, `build-rules-product`, `build-persist-service`, or `build-batch-workflows` to create or redesign platform products. It consumes deployed product contracts and hands off platform-building work to the appropriate specialist when the existing products cannot support the report.

If no exact executable ruleset/filter/rule exists, Hoothoot will not approximate it with raw Persist. It opens the focused Lexicon rule/filter PR when the business intent is clear, then waits for release before using the new definition.

## Persist Access Setup

Hoothoot uses prod Persist by default for direct Lexicon-label data, direct filter/rule execution, and Rules-released outputs for registered rulesets. For explicit dev/test reports, Hoothoot can use the managed `DevReportingReadonly` profile and should label the output as non-prod. The managed profiles are:

- Prod: `ProdReportingReadOnly`, account `014948052063`, region `us-east-2`
- Dev: `DevReportingReadonly`, account `951132547414`, region `us-east-2`

You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable AWS profile for the selected environment and guide you through the smallest missing step.

What Hoothoot should do for you:
- Check local AWS profiles when the AWS CLI is available.
- Help locate likely credentials if you do not know the profile name, including checking configured AWS profiles and asking whether you use SSO or have a downloaded credentials CSV.
- Always offer the credentials CSV path option when AWS access is missing. It should not ask only for a prod AWS profile.
- Prefer the managed profile for the selected environment when it exists; ask you to pick a profile only if there is more than one possible choice.
- Verify the selected profile and explain which AWS account it can access.
- If your profile uses SSO, start the login flow and ask you only to finish the browser login.
- If the profile is missing SSO settings, first ask whether you already have credentials it can use, such as a credentials CSV, a local credentials file path, or another profile name.
- If no existing credentials are available, repair or create the SSO profile for you instead of telling you to run `aws configure sso`.
- If you have an AWS credentials CSV, import it locally without printing the secret values.
- If the profile does not verify as the intended selected-environment account, explain the failed check and keep helping you fix AWS access; it should not silently use dev or a default profile.

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
- The selected environment's account name or account ID.
- The role name to use (`ProdReportingReadOnly` for prod or `DevReportingReadonly` for explicit dev/test when using the managed Hoothoot roles).
- The profile name you want.

Once those values are known, Hoothoot should configure or repair the local profile, start SSO login, verify the selected environment's account, and continue to Persist/Rules discovery. If any step fails, Hoothoot should explain the failed check and ask the next simple credential question. It should stay in this setup flow until AWS access works or you explicitly cancel.

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

Before Hoothoot runs Persist queries, direct filter/rule executions, or Rules-output reads, it should verify the active account:

```bash
AWS_PROFILE=<profile-name> AWS_REGION=<region> aws sts get-caller-identity
```

Hoothoot should continue only when the returned AWS account matches the intended account. For production business reports, that account must be prod. If the account does not verify, Hoothoot should keep helping you fix AWS access instead of building a report with guessed, dummy, or sample data. It should always run local refresh/query commands with explicit `AWS_PROFILE=<profile-name>` and `AWS_REGION=<region>` values instead of relying on your shell default profile.

## Persist And Rules Discovery

After AWS access is verified, Hoothoot should discover Persist and Rules connection details itself. You should not need to provide `PERSIST_API_URL`, `SSM_PARAMETER_NAME`, API Gateway URLs, Rules Step Functions ARNs, S3 output prefixes, or refresh script environment variables unless automatic discovery fails.

Hoothoot should use the verified prod profile to:
- Read the selected AWS account and region from the active credentials.
- Look up Persist configuration from approved AWS locations such as SSM Parameter Store and Secrets Manager (parameter names like `persist-api-url`, `/prod/persist-api-url`, `/prod/persist/api-url`, and service-specific names containing `persist` and `api`).
- Discover the Rules workflow identifier(s), Step Functions ARN(s), and the canonical S3 prefix where released ruleset outputs land.
- Confirm the discovered Persist endpoint with a small read-only smoke query before running report widget queries, including direct Persist filter/rule executions.
- Confirm the discovered Rules output location by reading the metadata of the most recent released output when a ruleset is resolved.
- Explain what it found in plain language, without exposing secrets.
- If AWS access works but no approved Persist/Rules configuration can be discovered, explain exactly what was checked and ask for the missing approved configuration location. Do not guess an endpoint.

The local preview should be generated from Persist-fetched JSON/CSV artifacts (for direct Lexicon reads and direct Persist filter/rule executions) or from the latest released Rules output (for registered rulesets). Static HTML pages cannot call Persist directly from the browser, so Hoothoot creates or uses local server-side refresh/query code to fetch the data first, then serves the static preview. It should not hand you a sample JSON file to load as the report.

If Persist or Rules is not reachable yet, Hoothoot should not prepare layout, CSS, empty states, data schemas, helper scripts, example artifacts, or UI scaffolds. It should stay in the AWS/Persist/Rules setup flow until access works or you explicitly cancel.

## Expected Workflow

Hoothoot should use this same lifecycle for every report request. A broad prompt, existing HTML file, sample JSON file, or partial example should not change the order.

1. Hoothoot asks whether to create a new local report project or use an existing local report project, then collects the exact path.
2. Hoothoot asks which AWS credential source to use, always offering profile, SSO, credentials CSV path, another credentials file/profile, or "I do not know."
3. If the prompt did not include the core business question, Hoothoot asks for that question without asking detailed widget/layout questions yet.
4. Hoothoot helps locate and verify prod AWS credentials by default, or the named non-prod profile for an explicit dev/test report.
5. After AWS access works, Hoothoot discovers the Persist and Rules connection details from AWS.
6. Hoothoot internally determines whether the request is read-only report work or a request to change source data/rule definitions. (If ambiguous, it asks one short plain-language question.)
7. Hoothoot resolves the relevant Lexicon ruleset(s), filter(s), or separate rule(s) and records release/source metadata.
8. For rule-derived sources, Hoothoot reads the latest Rules-released output if one matches the ruleset and freshness window.
9. If no fresh output exists, Hoothoot proposes a Rules execution, surfaces cost for broad runs, waits for your go-ahead, starts the execution, and waits for completion.
10. If no registered/released ruleset exists, Hoothoot checks for an exact released filter or separate rule and, if one exists, executes it through read-only Persist integration after Lexicon validation.
11. If no matching ruleset/filter/rule exists for a rule-derived request, Hoothoot asks for missing business definition details when needed, then opens a focused Lexicon PR and waits for release before continuing.
12. Hoothoot runs bounded data-shape discovery: Rules output metadata/sample rows, or read-only Persist smoke/profile queries for direct Lexicon-label and direct Persist filter/rule paths.
13. Hoothoot summarizes available fields, row/count shape, freshness, timing, missing-data notes, and where provenance details will appear.
14. Hoothoot confirms the report and widget list based on the discovered data shape.
15. Hoothoot runs focused widget queries or projections and builds dataset contracts per widget.
16. Hoothoot builds a local static preview from Persist-generated or Rules-released artifacts.
17. Hoothoot records timings: Lexicon resolution, Rules read/execution, data-shape discovery, each Persist query or direct filter/rule execution, artifact generation.
18. After you approve the local preview, Hoothoot asks where the report source should live.
19. Hoothoot creates or updates the report source in GitHub and opens a PR with provenance, timing, and no PII.
20. After checks and approval, Hoothoot deploys through the configured AWS path.
21. Hoothoot asks whether to publish the deployed report to the catalog.

If any step fails, Hoothoot should pause at that step, explain the failure in plain language, ask the next required question, and then resume from that same step. It should not switch to a dummy-data, browser-only, helper-script-only, or manually loaded JSON workflow.

Starting or rerunning a Rules execution, refreshing a released output, or executing an existing filter/rule through Persist is read-only report work. A data/rule change means adding or mutating source data, or adding/changing a Lexicon ruleset/filter/rule definition. Hoothoot should not expose these as mode or branch names to the user.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
