# Using Hoothoot

Hoothoot is a prod-first reporting agent that runs a single Lexicon-rule-aware flow. It uses production Athena for approved communication/calling entity counts and date filters, plus the approved Persist ACTIVE derived-index snapshot `debt_derived_indexes.active_index_values` (snapshot date `2026-07-20`; column list will expand), and consumes the existing Lexicon, Rules, Persist, Campaign Assignment, and report-publishing products for other report work. Use it in Cursor Agent mode for current counts, local report previews from verified live data, GitHub PRs, AWS deployment, and optional catalog publishing. When you explicitly approve a source mutation and its maximum cost, Hoothoot may also pass exactly one population source to Campaign Assignment: a completed Filter execution ARN, or an approved S3 URI for already-filtered Filter-results JSON.

Hoothoot does not operate in separate user-visible modes. Every report request moves through the same internal decision lifecycle, but Hoothoot should keep those internal paths invisible and describe the work in plain language: what it found, what data source it used, what is missing, and what happens next.

Hoothoot must not make up data. Every report number, row, bucket, chart, KPI, table, or data claim must come from an approved read-only Athena communication/call query, an approved read-only query of `debt_derived_indexes.active_index_values`, Persist in the selected environment (prod by default), a released and registered Lexicon ruleset's Rules execution output, or an exact filter/separate rule executed read-only through Persist.

Current business questions such as "how many calls were scheduled on this date?" are report data requests. Hoothoot may use local files to understand definitions, but it does not answer current counts from local files, caches, notebooks, dashboards, generated reports, user-provided exports, or broad filesystem searches. It uses Athena only for approved scopes (communication/call outputs and `debt_derived_indexes.active_index_values`); otherwise it uses Persist/Rules. If the required live source is not connected, Hoothoot says the count is not available yet and continues AWS setup.

Prod is the default for report numbers. Approved Athena reads reuse the production profile selected through Hoothoot's normal AWS access flow, run in `us-east-2`, and verify account `014948052063`; they do not require a separate Athena-specific profile. Hoothoot supplies the selected profile and region to its commands rather than asking you to export shell variables. Other Hoothoot paths may use dev only when you explicitly request dev/test validation and accept that those numbers are not production truth.

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
For a report app, first I need the local project path, AWS access path, and core business question. For a standalone count/date-filter question, I do not need a project path. I will route approved communication/call and ACTIVE derived-index snapshot questions to live Athena discovery and other questions to prod Lexicon/Rules/Persist, then run a bounded source query before showing data.
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

For counts and easy date filters over orchestrated call eligibility/schedules or live discoverable phone-call, email-message, and SMS-message entities, Hoothoot first follows [`access-orchestrate-call-outputs`](../skills/access-orchestrate-call-outputs/SKILL.md). It inspects live Athena/Glue metadata and uses that exact output instead of forcing it through the ruleset path. For debt-level ACTIVE Persist derived-index lookups, it uses `debt_derived_indexes.active_index_values` (snapshot `2026-07-20`; confirm columns with `DESCRIBE` — the list will expand).

## Guardrails

- Hoothoot uses only approved read-only Athena outputs (communication/call and `debt_derived_indexes.active_index_values`), registered/released Rules outputs, or exact filters/separate rules executed read-only through Persist. It does not mutate source data during report reads.
- The main report uses plain data-source labels and freshness. Full provenance belongs in a compact audit/details section: Athena catalog/workgroup/result location/database/table/query/partitions/run lineage, or Rules/Persist rule/filter/execution/request details.
- Every AWS command runs with an explicit `AWS_PROFILE` and `AWS_REGION` so prod credentials are never implied by shell state.
- PII never appears in PR descriptions, commit messages, screenshots, or chat. Reports show counts, bucket labels, and rule/filter identifiers.
- For broad runs (whole-portfolio scans, untargeted aggregations, full Rules executions, or broad direct Persist filter/rule executions), Hoothoot surfaces a cost confirmation step and waits for your explicit go-ahead.
- No dummy, sample, or unverified data is shown in the preview or the deployed report.
- Campaign assignment is a separate source mutation. Hoothoot must obtain explicit source-mutation approval and explicit approval of the maximum cost before it starts Campaign Assignment; report, preview, Filter, or deployment approval does not imply either approval.
- Campaign Assignment accepts exactly one population source: `filter_completed_execution_arn`, or `input_s3_uri` pointing to an already-filtered Filter-results JSON object or prefix. Hoothoot must never send both. Raw CSV, raw source exports, arbitrary JSON, and unfiltered input are invalid assignment sources.
- Hoothoot never calls Persist ingest directly and never puts Campaign Assignment, Persist ingest, or another graph write in a report refresh or scheduled reporting workflow.
- Hoothoot never starts SMS, email, mail, or another communication channel automatically. After a campaign is assigned and reconciled, it may offer a separate channel launch that requires its own approval and runtime.

## What To Provide

- For a report/app, where the local project should live: either a new local path or an existing project path. Standalone count/date-filter questions do not need a project path.
- Approved Athena communication/call reads use the same production profile selected through the normal Hoothoot AWS access flow. For every source route, Hoothoot should offer the managed reporting profile, SSO, credentials CSV, another local credentials file/profile, or "I do not know".
- If you received an AWS credentials CSV, provide only the local file path, the profile name you want Hoothoot to create, and the AWS region. Hoothoot should create or update the profile for you and verify the prod account.
- Before rule/filter resolution: the core business question, unless you already stated it in your prompt.
- After AWS access is connected and Hoothoot has inspected the data shape: the table/KPI/chart widgets you want, the business question each widget must answer, and how the report should look.
- Known entities, dates, Persist fields, filters, companies, or account populations if you have them. Hoothoot still discovers actual Athena names and types.
- If you want to insert or mutate source data, say so explicitly. Missing ruleset/filter/rule definitions for rule-derived reports are handled through a focused Lexicon PR when the business intent is clear.
- If you want campaign assignment, provide or approve the campaign identifier, name, purpose, and maximum cost. Hoothoot will prefer a completed Filter execution ARN when it ran or owns Filter because that source has stronger directly verifiable provenance. You may instead supply an S3 object or prefix as `input_s3_uri` only when it is already-filtered Filter-results JSON. Hoothoot will present the selected source URI, environment, scope, and cost and ask for explicit source-mutation approval before starting Campaign Assignment.

Do not provide GitHub repository, deployment, authentication, catalog, or refresh-schedule details in the first prompt unless you already know you want to publish. Hoothoot should ask for those only after you approve the local preview.

For a report/app, Hoothoot should not search your machine for an existing project, infer one from your workspace, or decide where the report belongs. It asks for the local project path first, then uses only that path.

After it has the local project path, Hoothoot should connect to prod AWS and route the question to live Athena metadata or to Lexicon/Rules/Persist. It should run a bounded source query immediately and should not build UI files until that gate passes.

Do not ask Hoothoot for a dummy-data or sample-JSON report. A Hoothoot report starts by connecting to prod and verifying the appropriate Athena or Persist/Rules source. If Hoothoot cannot connect, it should keep helping you establish approved AWS access before building the preview.

## Query Guidance

Tell Hoothoot the core business question first. Hoothoot should understand the resolved data shape before asking for detailed widgets/tables/charts. After data-shape discovery, it should create one focused dataset contract per widget, with rule/filter provenance when the widget is rule-derived.

For requests outside approved Athena scopes (communication/call and the ACTIVE derived-index snapshot), Hoothoot should find the Persist data model from Lexicon first. Lexicon is the source of truth for vertex labels, edge labels, properties, indexes, enum values, graph relationships, registered rulesets, filters, and separately executable rules. If the schema, metric definition, population filter, or business term is unclear, Hoothoot should ask for the missing business meaning before querying.

Hoothoot should not substitute a nearby metric for the one you asked for. For example, a callable-account question may use an approved exact Athena eligibility output with explicit lineage when that output matches the requested semantics; otherwise Hoothoot resolves a ruleset/filter/rule and uses Rules or Persist. It must not silently count a nearby debt population because it is easier to query.

After Hoothoot understands the data shape, it should keep the preview limited to the requested widgets, tables, and charts. It should not add unrelated KPIs, broad dashboard sections, exploratory tables, or extra charts unless you explicitly ask for them.

If Cursor or another routing layer frames a Hoothoot request as a local workspace investigation, Hoothoot should still treat current counts and report numbers as production Athena or prod Persist/Rules questions. Local workspace search can support definition discovery only; it cannot replace the live data path.

Avoid asking for one large query for the whole report. Smaller widget-level queries, per-widget Rules output reads, or per-widget direct Persist filter/rule executions make timings clear, reduce timeout risk, and make it easier to verify each number.

Hoothoot must never build report queries from graph-internal vertex or edge identifiers. Do not ask it to use `hasId(...)`, `id()`, `T.id`, `has(T.id, ...)`, `within(...)` over internal element IDs, `startingWith(...)` over internal element IDs, or any other internal Persist element ID shortcut. Hoothoot should use Lexicon-declared business identifiers, properties, and indexes instead, such as `debt_identifier`, `person_identifier`, released Rules outputs, or exact released filters/rules. If a report cannot be answered without internal element IDs, Hoothoot should stop and ask for the proper business key or Lexicon rule/filter definition rather than running the query.

Report artifacts and audit notes should not contain internal vertex or edge IDs. Row keys should be business identifiers or report-local synthetic row numbers that are clearly not Persist IDs.

Root-vertex-property-only report queries may aggregate directly when they are bounded and Lexicon-validated. If a report query needs to traverse edges or run child/sub-traversals beyond the root vertices, Hoothoot should not run it as one whole-graph traversal. It should first count the root candidate vertices using only root label and root-vertex filters, split the root candidate stream into bounded `range(start, end)` shards, run each shard as a separate Persist async query, and merge the shard outputs locally. Hoothoot should run a first small shard to validate that the returned data shape is correct before launching the rest, and only run a few shards in parallel with conservative concurrency.

## Athena Communication And Call Counts

The canonical runbook and compact CLI/SQL examples are in [`access-orchestrate-call-outputs`](../skills/access-orchestrate-call-outputs/SKILL.md). Hoothoot should load it rather than reproduce or improvise the query procedure.

Key behavior:

- Reuse the production profile selected through Hoothoot's normal AWS access flow; set it explicitly with `AWS_PROFILE=<selected-profile>`, use `us-east-2`, and verify account `014948052063`.
- Discover Athena workgroups and verified result settings, `AwsDataCatalog`, Glue databases/tables/columns/partitions, business IDs, and timestamps.
- Use the current `orchestrate_call_outputs` run-aware tables only after rediscovery: `workflow_run_catalog`, `eligible_to_call`, and `scheduled_calls`.
- Treat `year INT`, `month INT`, and `date DATE` as the run-aware partition keys. Map "day" to `date`, never invent `day`, and prune partitions whenever possible.
- Start run-aware questions from `workflow_run_catalog`; explicitly select `solver_execution_id`, `filter_source_id`, and `classification`; join scheduled rows to exact Filter lineage, never date alone.
- Inspect live availability and state actual entities, date ranges, and gaps. Live entity tables in the same database can include `phone_call`, `email_message`, `text_message`, `payment`, and current-snapshot `payment_plan` / `payment_plan_installment` when present in Glue; January 2026 communication history is intended, not proof.
- Prefer Athena for payment-plan / installment counts via `payment_plan` and `payment_plan_installment` (one current row per plan / schedule identifier; integer `year`/`month`/`day` partitions; point-in-time snapshot, not lifecycle or future-obligation coverage).
- Count rows and distinct discovered business identifiers separately when those semantics differ.
- Keep queries read-only, bound samples with `LIMIT`, verify result output, and do not expose PII or message contents.
- Apply the static-through-`2026-07-14` no-auto-refresh warning only to the current run-aware call-output corrective backfill; payment-plan snapshots are a separate current snapshot and also do not auto-refresh.

## Athena Persist ACTIVE Derived Indexes

Production Athena also exposes an approved point-in-time snapshot of ACTIVE Lexicon derived-index values for debts:

- Database / table: `debt_derived_indexes.active_index_values`
- Snapshot date: `2026-07-20`
- Grain: one row per `debt_identifier`
- S3: `s3://so-athena-analysis-results/debt_derived_indexes/active_index_values/`
- Region / account: `us-east-2` / `014948052063`

Use the same production AWS profile and Athena discovery flow as other Athena reads. Confirm columns with `DESCRIBE debt_derived_indexes.active_index_values` before depending on them — the published list of index-value columns will be expanded as more ACTIVE indexes are added. Always state snapshot date `2026-07-20` in answers and report provenance. Do not assume FAILED or unpublished indexes are present; use Lexicon/Rules/Persist for those.

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

These managed reporting profiles are read-only. They must not receive Persist ingest, graph-write, Campaign Assignment invocation, or channel-send permissions. Campaign Assignment invocation requires a separate least-privilege operator profile that grants only:

- `ssm:GetParameter` for `/campaign-assignment/<env>/state-machine-arn`
- `states:StartExecution` for the discovered Campaign Assignment state machine
- `states:DescribeExecution` for its executions

The operator path must never grant Persist writes, broad SSM discovery, unrelated Step Functions access, or communication-channel launch permissions.

You do not need to write export commands or know the refresh script details. Hoothoot should check whether your machine already has a usable AWS profile for the selected environment and guide you through the smallest missing step.

What Hoothoot should do for you:
- Check local AWS profiles when the AWS CLI is available.
- Help locate likely credentials if you do not know the profile name, including checking configured AWS profiles and asking whether you use SSO or have a downloaded credentials CSV.
- Always offer the credentials CSV path option when AWS access is missing. It should not ask only for a prod AWS profile.
- Prefer the managed profile for the selected environment when it exists; ask you to pick a profile only if there is more than one possible choice.
- Verify the selected profile and explain which AWS account it can access.
- If your profile uses SSO, start the login flow and ask you only to finish the browser login.
- If Athena, Glue, or its query-result storage denies access, start one re-login through the same selected SSO profile and ask you only to finish the browser step, then retry once. If access is still denied, report the exact permission your administrator must add; repeated login cannot grant permissions missing from the role.
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

For requests outside approved Athena paths (communication/call and `debt_derived_indexes.active_index_values`), Hoothoot should discover Persist and Rules connection details itself after AWS access verifies. You should not need to provide endpoints, ARNs, S3 prefixes, or refresh variables unless safe discovery fails.

Hoothoot should use the verified prod profile to:
- Read the selected AWS account and region from the active credentials.
- Look up Persist configuration from approved AWS locations such as SSM Parameter Store and Secrets Manager (parameter names like `persist-api-url`, `/prod/persist-api-url`, `/prod/persist/api-url`, and service-specific names containing `persist` and `api`).
- Discover the Rules workflow identifier(s), Step Functions ARN(s), and the canonical S3 prefix where released ruleset outputs land.
- Confirm the discovered Persist endpoint with a small read-only smoke query before running report widget queries, including direct Persist filter/rule executions.
- Confirm the discovered Rules output location by reading the metadata of the most recent released output when a ruleset is resolved.
- Explain what it found in plain language, without exposing secrets.
- If AWS access works but no approved Persist/Rules configuration can be discovered, explain exactly what was checked and ask for the missing approved configuration location. Do not guess an endpoint.

The local preview should be generated from approved Athena aggregates, Persist-fetched JSON/CSV artifacts, or the latest released Rules output. Static HTML pages should not call these production sources directly from the browser; Hoothoot uses local server-side refresh/query code and serves generated artifacts.

If the required Athena or Persist/Rules source is not reachable, Hoothoot should not fill a preview with example data. It stays in AWS setup until access works or you cancel.

## Optional Campaign Assignment

Campaign assignment is not part of report generation or refresh. Hoothoot may perform it only as a separate source-mutation action:

1. Resolve the exact registered Filter for the requested population.
2. Select exactly one population source:
   - Prefer `filter_completed_execution_arn` when Hoothoot ran or owns Filter because the completed execution provides stronger directly verifiable provenance. Reuse a valid completed Filter execution, or run Filter through its deployed contract and wait until the execution completes successfully. A running, failed, timed-out, aborted, or stale Filter execution cannot be assigned.
   - Use `input_s3_uri` only when you explicitly supply or approve an S3 object or prefix as an already-filtered population and Hoothoot verifies that it is Filter-results JSON for the same environment and scope. Raw CSV, raw source exports, arbitrary JSON, and unfiltered input are not valid.
   - Never provide both source fields. Hoothoot fails closed if both or neither are present.
3. Present the campaign identifier, name, purpose, selected source field and value, source URI when applicable, environment, expected scope, and maximum cost.
4. Wait for explicit source-mutation approval and explicit maximum-cost approval. One approval may cover both only when both are clearly stated together.
5. Using the separate operator profile, read `/campaign-assignment/<env>/state-machine-arn` with `ssm:GetParameter`.
6. Start Campaign Assignment with the unchanged `campaign-assignment/v1` contract and exactly one source. The preferred completed-Filter form is:

   ```json
   {
     "contract_version": "campaign-assignment/v1",
     "filter_completed_execution_arn": "<completed Filter execution ARN>",
     "campaign": {
       "campaign_identifier": "<identifier>",
       "name": "<name>",
       "purpose": "<purpose>"
     },
     "max_cost_usd": 0
   }
   ```

   Replace `max_cost_usd` with the explicitly approved maximum cost.
   The explicitly approved, already-filtered S3 form is:

   ```json
   {
     "contract_version": "campaign-assignment/v1",
     "input_s3_uri": "s3://<bucket>/<filter-results-object-or-prefix>",
     "campaign": {
       "campaign_identifier": "<identifier>",
       "name": "<name>",
       "purpose": "<purpose>"
     },
     "max_cost_usd": 0
   }
   ```

   Replace `max_cost_usd` with the explicitly approved maximum cost. Do not include `filter_completed_execution_arn` in this form.
7. Poll the execution with `states:DescribeExecution` until a terminal state. Hoothoot must wait for final reconciled success; a started execution or intermediate assignment completion is not success.
8. Accept only these bounded final output fields: `status`, `campaign_identifier`, `campaign_vertex_id`, `debts_received`, `missing_debt_count`, `debts_without_person_count`, `persons_linked`, `edges_upserted`, `chunk_count`, `manifest_s3_uri`, and `estimated_cost_usd`.
9. Report aggregate counts, scalar campaign references, status, estimated cost, and manifest location only. Never report identifier arrays or enumerate debt, person, account, edge, or missing-record identifiers from the execution or manifest. On failure, timeout, abort, reconciliation mismatch, cost-limit stop, or an unexpected output shape, report the terminal status and safe retry guidance.

Campaign Assignment owns every Persist mutation. Hoothoot must never call Persist ingest itself, add Persist-write permissions to either Hoothoot profile, or embed assignment in report refresh code. Assignment also does not authorize delivery: Hoothoot may offer a separate channel-launch action after final reconciled success, but it never starts SMS or another channel automatically.

## Expected Workflow

Hoothoot should use this same lifecycle for every report request. A broad prompt, existing HTML file, sample JSON file, or partial example should not change the order.

1. For a report/app, Hoothoot collects the exact local project path. It skips this question for a standalone count/date filter.
2. Hoothoot collects the core business question if missing.
3. Hoothoot routes approved communication/call counts and date filters, plus ACTIVE derived-index snapshot questions (`debt_derived_indexes.active_index_values`), to Athena using the production profile selected through the normal AWS access flow; other requests use the normal prod Persist/Rules source path.
4. Hoothoot verifies the expected AWS account with explicit profile/region.
5. For Athena, it discovers workgroups, result settings, `AwsDataCatalog`, Glue tables/columns/partitions, and actual availability under the canonical skill.
6. For other sources, it discovers Persist/Rules details and resolves Lexicon rulesets, filters, or separate rules.
7. For run-aware call outputs, it starts from `workflow_run_catalog` and requires explicit solver/filter/classification lineage.
8. For rule-derived sources, it reads a matching Rules output, starts a confirmed Rules execution when needed, or executes an exact validated Persist filter/rule.
9. If no exact rule definition exists, it opens a focused Lexicon PR and waits for release.
10. Hoothoot runs bounded read-only source queries, separates row and distinct-entity counts when needed, and summarizes fields, availability/gaps, freshness, timing, and provenance.
11. For a standalone count, Hoothoot returns the verified aggregate and provenance. For a report, it confirms widgets and builds one dataset contract/query per widget.
12. Hoothoot builds the local static preview from approved Athena-, Persist-, or Rules-generated artifacts and records source timings.
13. After preview approval, Hoothoot creates/updates the report source, opens a PR with no PII, deploys through the configured AWS path after checks, and asks whether to publish to the catalog.
14. If you separately request campaign assignment, Hoothoot selects exactly one approved source—preferably the completed Filter execution ARN when Hoothoot ran or owns Filter, or an explicitly approved `input_s3_uri` for already-filtered Filter-results JSON—presents its URI/environment/scope/cost, obtains source-mutation and maximum-cost approval, invokes Campaign Assignment through the least-privilege operator path, and waits for final reconciled success.
15. Hoothoot reports only the bounded status, aggregate counts, scalar campaign references, estimated cost, and manifest location without PII or identifier arrays, then may offer a separate explicitly approved channel launch.

If any step fails, Hoothoot should pause at that step, explain the failure in plain language, ask the next required question, and then resume from that same step. It should not switch to a dummy-data, browser-only, helper-script-only, or manually loaded JSON workflow.

Starting or rerunning a Rules/Filter execution, refreshing a released output, or executing an existing filter/rule through Persist is read-only report work. A data/rule change means adding or mutating source data, assigning a Filter population through Campaign Assignment, or adding/changing a Lexicon ruleset/filter/rule definition. Hoothoot should not expose these as mode or branch names to the user.

## Access And Secrets

Do not paste passwords, AWS secret keys, Microsoft client secrets, raw Cognito secrets, or sensitive data into chat. Hoothoot should use AWS profiles, SSO login, Secrets Manager, and existing approved identity-provider configuration.

You do not need to choose or configure the report access model in the prompt. Published Hoothoot reports use Microsoft Azure SSO through Cognito federation to the shared Hoothoot SSO broker for the selected environment.
