# Soofi product team kit

Product builders, configurers and supporting skills for Cursor, GitHub Copilot CLI and OpenAI Codex.

## Install

### Cursor

Clone this repository into Cursor's local plugins directory so it is auto-discovered as `soofi-xyz-team-kit`:

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/soofi-xyz/cursor-plugin.git ~/.cursor/plugins/local/soofi-xyz-team-kit
```

Then reload Cursor. The plugin will load from `~/.cursor/plugins/local/soofi-xyz-team-kit` and register all agents, skills, and the bundled **`elephant`** MCP server (`mcp.json`) automatically.

**Donphan / Elephant MCP:** Requires Node **22.18+**. Bundled `mcp.json` still runs the current Elephant MCP server with the legacy per-county maps so Donphan keeps working during the Atlas transition. The MCP 2.0 configuration (global Atlas index + gateway order, `npx -y @elephant-xyz/mcp@2 mcp`) is in [`docs/mcp-atlas.example.json`](./docs/mcp-atlas.example.json); switch `mcp.json` to it when MCP 2.0 is released **and** the Atlas index lists at least one county. After install or `git pull`, reload Cursor and confirm **`elephant`** is enabled under **Settings → MCP**. On 2.0, discover scope with `listAtlasCounties`, then pass `state`, `county`, and `dataGroup` explicitly.

**Elephant routing:** `donphan` + `use-elephant-mcp` = explore synchronized Atlas data via normalized MCP 2.0 tools; `oracle` + `use-oracle` = mine county sources, reconcile the internal Query DB, publish one CAR and normalized table set per data group, register the county in Atlas, and verify the global Atlas IPNS; `build-county-transform` = author and prove county transforms; `watchog` + `build-elephant-hero-facts` = build the scheduled homepage hero-facts service. The Query DB is internal and is not the MCP/publication source.

**Self-contained ingestion runtime:** `oracle` drives a fully bundled, self-contained ingestion
runtime at `skills/use-oracle/runtime/` (Node **22.18+**, `npm ci && npm test` there). It never
requires a sibling `oracle-node`, `Counties-trasform-scripts`, or `elephant-query-db` checkout,
and never runs `npx skills add`. See
[`skills/use-oracle/reference/self-contained-ingestion.md`](./skills/use-oracle/reference/self-contained-ingestion.md)
for install, offline replay, bounded live pilot, internal reconciliation artifacts, Atlas
publication handoff, and MCP smoke commands, and run `python3 scripts/check-plugin-clean-room.py`
before opening a PR that touches it.

### GitHub Copilot CLI

Add the marketplace first, then install the plugin from that marketplace:

```bash
copilot plugin marketplace add soofi-xyz/cursor-plugin
copilot plugin install soofi-xyz-team-kit@soofi-xyz
```

### OpenAI Codex

From this checkout, add the repo marketplace and install the Codex plugin:

```bash
codex plugin marketplace add ./
codex plugin add soofi-xyz-team-kit@soofi-xyz-team-kit
```

The Codex plugin packages the skills in `skills/`. Project-scoped Codex custom agents are materialized in `.codex/agents/` when you work in this repository.

## Update Or Remove

### Cursor

Pull the latest agents and skills from the same directory:

```bash
git -C ~/.cursor/plugins/local/soofi-xyz-team-kit pull
```

Reload Cursor after pulling so updated agents, skills, MCP config, and the manifest are picked up.

### GitHub Copilot CLI

When you are inside the plugin in GitHub Copilot CLI, update it with the plugin-qualified slash command:

```text
/plugin update soofi-xyz-team-kit@soofi-xyz
```

Uninstall the plugin by name:

```bash
copilot plugin uninstall soofi-xyz-team-kit
```

### OpenAI Codex

Refresh the marketplace and reinstall from a new Codex thread:

```bash
codex plugin marketplace upgrade soofi-xyz-team-kit
codex plugin add soofi-xyz-team-kit@soofi-xyz-team-kit
```

Remove the installed Codex plugin by name:

```bash
codex plugin remove soofi-xyz-team-kit
```

## Quick start

Choose the product, then whether you need to build its reusable service or
configure a particular use of it. Pokémon names are invocation names; product
ownership is shown below. For example:

```text
/conkeldurr Fix Persist's duplicate-ingest handling and walk me through a small replay test.
/zygarde Split System into usable feature pieces; have me run and inspect each one.
/celebi Configure a Connect → Transform → Persist outcome on the existing System.
/wingull Configure this partner's SFTP intake and prove it in dev.
```

In Copilot, select the corresponding `soofi-xyz-team-kit:<agent>` custom agent.
In Codex, start a new thread after updating the plugin and request the named
custom agent. Use the product map directly; a router is not required.

Product agents derive **usable feature pieces from scope and dependencies**.
Each piece ends with you trying its configuration, inspecting the actual AWS
execution/logs, and reporting what happened before the next piece is implemented.
Four is the minimum for full-product work, not the target for every product.
The capability maps differ by product; narrow fixes/configurations select only
the relevant features. Tests, failure cases and replay checks belong inside each
feature rather than inflating the piece count. See the
[shared workflow](./skills/guide-product-work/SKILL.md) and the product's
`iterationGuide` in the catalog.

## Product agents

The [product catalog](./skills/guide-product-work/reference/product-catalog.json)
records the supplied Staircase/Prism mapping and current role assignments.
Each assigned product has a separate builder and configurer. Conkeldurr owns
Persist; Zygarde owns System. Configurers include authoring and testing.
This table features the product roster. Other existing specialists remain
installed and available from `agents/`; omission from this table does not remove them.

<!-- product-catalog:start -->

| Product | What it does | Build and maintain | Configure and test |
| --- | --- | --- | --- |
| **Marketplace** | Marketplace catalogs products and reviews, publishes and rolls back bundles. | [`regigigas`](./agents/regigigas.md) | [`registeel`](./agents/registeel.md) |
| **Transform** | Transform converts registered source languages into target languages. | [`kecleon`](./agents/kecleon.md) | [`silvally`](./agents/silvally.md) |
| **Persist** | Persist stores graph facts and serves queries, indexes and triggers. | [`conkeldurr`](./agents/conkeldurr.md) | [`uxie`](./agents/uxie.md) |
| **Rule** | Rule selects entities and evaluates governed predicates. | [`gallade`](./agents/gallade.md) | [`meditite`](./agents/meditite.md) |
| **Connect** | Connect exchanges files and requests with external partners. | [`lapras`](./agents/lapras.md) | [`wingull`](./agents/wingull.md) |
| **System** | System orchestrates business outcomes through reusable configured flows. | [`zygarde`](./agents/zygarde.md) | [`celebi`](./agents/celebi.md) |

**Catalog products awaiting scoped ownership:** Access, Console, Environment, Finance, Host, Setup, Assess, Build, Code, Comply, Deploy, Health, Pipeline, Asset, Credit, Employment, Identity, Income, Tax, Appraisal, Listing, Property, Valuation, Compliance, Fraud, Government, Insurance, Rating, Document, Electronic, Fee, Model, Notary, Price, Signature, Title, Approval, Boarding, Closing, LOS, POS, Servicing, Content, ML, Site, Turker, Job, Workflow, Discover, Schedule, Report, Predict.

Unassigned means no dedicated builder/configurer pair is assigned in this catalog. Retained specialists remain available; assignment does not establish deployment.

<!-- product-catalog:end -->

Keep Environment as the product identity for bootstrap work. Puller is a
Marketplace/Deploy implementation concern, not a separate product. Model's two
source rows are consolidated; Lexicon remains the universal vocabulary. Retain
historical aliases only for compatibility, not as competing product names.

## Supporting skills

The reusable skills and bundled runtime remain at their existing paths. Retained
specialists are callable through their agent definitions, and supporting skills
can also be used directly when relevant.
Resolve current product ownership through the catalog before a cross-product
handoff. Use the current product instructions; consult Git history when a
comparison with an earlier version is needed.

## Skills

| Skill | Purpose |
| --- | --- |
| [`access-orchestrate-call-outputs`](./skills/access-orchestrate-call-outputs/) | Answering data questions about production communication, calling, payment, and payment-plan activity — counts, date filtering, and coverage checks against the approved datasets. |
| [`apply-engineering-guidelines`](./skills/apply-engineering-guidelines/) | Applying the company Golden Path engineering standards. Use when building or refactoring services, choosing technologies, setting up infrastructure, testing, CI/CD, observability, or alerting, or reviewing architecture. |
| [`asana-initiatives`](./skills/asana-initiatives/) | Extending the Hypno initiative-portfolio chat bot and its personal task and story workflows. |
| [`assemble-communication-runtime`](./skills/assemble-communication-runtime/) | Assembling end-to-end communication runtimes from reusable audience, template, and activity capabilities — workflow composition, data contracts, scoring, allocation, validation. |
| [`atomic-data`](./skills/atomic-data/) | Designing metrics layers that combine row-level facts with vendor rollups — reconciliation, classification rules, lineage, and per-agent daily reporting for operational platforms. |
| [`babysit-release`](./skills/babysit-release/) | Use every time the user creates a PR — babysit it through review, merge, and production release, monitor the deployment, and open follow-up fix PRs when a release fails. |
| [`bbb-harvest`](./skills/bbb-harvest/) | Harvest BBB (Better Business Bureau) business profiles by category for contractor reputation and quality enrichment in the elephant query DB, with throughput checks before long crawls. Use when asked to collect BBB profiles, contractor reputation data, or refresh bbb_* tables. |
| [`bootstrap-oracle-infra`](./skills/bootstrap-oracle-infra/) | Verify and bootstrap the local pipeline stack required for county ingestion: the durable workflow server, data directories, the internal database, and the bundled runtime services process. Use when starting county onboarding, when a run or registration fails because the stack is down, or when setting up on a fresh machine. |
| [`build-ai-agents`](./skills/build-ai-agents/) | Building AI agents and chat bots — runtime design, message ingress, conversation state and memory, tool loops, request routing, telemetry, deployment, and testing. |
| [`build-batch-workflows`](./skills/build-batch-workflows/) | Building batch workflows and data processing pipelines — processing strategy selection, testing, cost control, throttling, idempotency, and failure alerting. |
| [`build-bootstrap-cli`](./skills/build-bootstrap-cli/) | Implementing or changing the Bootstrap CLI from its PRD — initial tenant setup, manifest intake, first installs, resume and status. Read reference/PRD.md first. |
| [`build-build-service`](./skills/build-build-service/) | Implementing or changing the Build service from its PRD — source intake, build and validation, artifact provenance, marketplace-ready bundles. Read reference/PRD.md first. |
| [`build-connect-product`](./skills/build-connect-product/) | Build Connect, the only layer that talks to external systems, as configurable blocks: generic verbs (LIST, FETCH, PUT, MOVE, CALL, POLL, WAIT_FOR_WEBHOOK, DECRYPT) over typed connections (http, sftp, azure_blob, s3, drop_zone), shared options (ledger, pagination, file landing), partner configurations, activations (schedule, drop zone, webhook) and a job API, compiled to Step Functions. Use for Connect engine changes, drivers and verbs; use Wingull for partner configurations. |
| [`build-connect-service`](./skills/build-connect-service/) | Maintain the current Connect service runtime and caller compatibility. Use Lapras for engine changes and Wingull for partner configuration. |
| [`build-county-transform`](./skills/build-county-transform/) | Build or repair a county transform end to end: capture sample pages, turn them into lexicon records with exact source-request provenance, prove every record validates against the live lexicon and every field on the page was extracted, then open the transform pull request. Use when onboarding a county's appraiser, permit, or registry source, when validation or coverage fails on an existing transform, or when asked whether a county's transform is complete. |
| [`build-elephant-hero-facts`](./skills/build-elephant-hero-facts/) | Build the Watchog hero-facts service — dataset change detection, deterministic fact recipes behind an immutable evidence gate, an Asana approval state model, and a content-only publish hand-off with no auto-merge for the elephant.xyz homepage hero. |
| [`build-frontend-backends`](./skills/build-frontend-backends/) | Building fullstack web applications — monorepo structure, shared modules, frontend hosting, backend APIs, custom domains, and multi-app deployment. |
| [`build-html-to-pdf`](./skills/build-html-to-pdf/) | Building server-side document generation that renders HTML templates to PDF — request contracts, template registries, deterministic rendering, verification. |
| [`build-inbound-sftp-workflows`](./skills/build-inbound-sftp-workflows/) | Building inbound file-transfer integrations with partners — connection inputs, credential contracts, infrastructure, polling, and transfer validation. |
| [`build-lexicon-product`](./skills/build-lexicon-product/) | Implementing or changing the Lexicon product from its PRD — governed vocabulary, rulesets, metric definitions, artifact publication, schema browsing. Read reference/PRD.md first. |
| [`build-local-rag-pocs`](./skills/build-local-rag-pocs/) | Prototyping local retrieval (RAG) tools that agents can query from the terminal — corpus evaluation, search quality, machine-readable output, and usage instructions. |
| [`build-marketplace-puller`](./skills/build-marketplace-puller/) | Implementing or changing the Marketplace Puller from its PRD — subscription intake, desired-state reconciliation, drift repair, deployer handoff. Read reference/PRD.md first. |
| [`build-persist-service`](./skills/build-persist-service/) | Build or maintain the Persist graph service, ingestion, queries, indexes and triggers. Use Conkeldurr; use Uxie for particular configurations. |
| [`build-portals`](./skills/build-portals/) | Portal delivery and maintenance playbook for creating new repositories or incrementally changing existing portal frontend, backend, infrastructure, tests, and deployments through pull requests. |
| [`build-product-deployer`](./skills/build-product-deployer/) | Build or maintain the stateless Deploy run service, Build artifact integration and run-status inspection. Verify the target service contract first. |
| [`build-rag-systems`](./skills/build-rag-systems/) | Building production retrieval (RAG) systems — knowledge bases, retrieval quality, confidence policy, historical ingestion, refresh, and migrating local prototypes to the cloud. |
| [`build-rules-product`](./skills/build-rules-product/) | Designing, integrating, or operating a generic Rule Filter product — entity-selection queries, predicates, candidates, projections, batch/direct evaluation, snapshots, reports, and capacity. |
| [`build-saas-marketplace`](./skills/build-saas-marketplace/) | Build or maintain Prism Marketplace catalog registration, bundle publication, review and rollback. Use Regigigas; use Registeel for catalog operations. |
| [`build-solver-services`](./skills/build-solver-services/) | Building optimization services for assignment, scheduling, and constraint problems — data preparation, solver design, infrastructure, and testing. |
| [`build-system-product`](./skills/build-system-product/) | Build or maintain the System orchestration framework with TypeScript, CDK and Step Functions. Use Zygarde for runtime changes and a guided mock-first build; use Celebi for outcome configuration. |
| [`build-tenant-account-manager`](./skills/build-tenant-account-manager/) | Implementing or changing the Account service from its PRD — customer identity, credentials, tenant provisioning, domains, bootstrap manifest. Read reference/PRD.md first. |
| [`build-tenant-domain-router`](./skills/build-tenant-domain-router/) | Building or changing the Tenant Domain Router — root-domain ownership, per-tenant subdomains, certificates, and the endpoint-attachment contract other products consume. |
| [`build-transform-product`](./skills/build-transform-product/) | Implement the Transform product: from/to data languages registered in Lexicon (the definition is the schema), mappings that own formats and output shape, Python/PySpark execution, Parquet/JSONL/CSV/Excel, typed tables, graph vertex/edge ID mappings, and TypeScript CDK orchestration. |
| [`certify-email-workflow`](./skills/certify-email-workflow/) | Certifies Email Workflow through an exact CloudFormation and code-control map against pinned SMS revisions, allowing only provider-specific channel adaptations. Use for focused diagnostics, workflow readiness, handoff quality, or production certification. |
| [`configure-persist-product`](./skills/configure-persist-product/) | Configure and test a particular ingestion, query, governed index or trigger on an existing Persist deployment. Use Uxie; hand service implementation changes to Conkeldurr. |
| [`configure-rule-product`](./skills/configure-rule-product/) | Configure selection, rules, candidate scopes and projections on an existing Rule service and verify expected decisions. Use Meditite; use Gallade for engine changes. |
| [`configure-system-product`](./skills/configure-system-product/) | Compose and test a business outcome as configuration of the existing System framework. Use Celebi for definitions, templates, flows, waterfalls and invocations; use Zygarde for framework changes. |
| [`configure-transform-product`](./skills/configure-transform-product/) | Author and verify language-pair mappings for an existing Transform engine, including formats, SQL, typed outputs and graph identities. Use Silvally; use Kecleon for engine changes. |
| [`county-appraisal-onboarding`](./skills/county-appraisal-onboarding/) | Wire a new county's appraisal scraping into the pipeline - browser flow JSON in skills/use-oracle/runtime/flows/, per-county prepare config and Parcel concurrency, transform scripts synced from Counties-trasform-scripts, and appraisal-source throughput gates. Use when onboarding a county's property appraiser site, creating browser flows, or when prepare fails for a specific county. |
| [`county-discovery`](./skills/county-discovery/) | Research a new US county before onboarding it to the ingestion pipeline - appraiser portal, permit portal vendor, parcel id format, bulk data sources, anti-bot posture, source performance, and bulk-ingest vs runtime-retrieval feasibility. Use when asked to onboard, evaluate, or scope a new county, or when planning appraisal/permit scraping for a county not yet ingested. |
| [`county-ingest-run`](./skills/county-ingest-run/) | Operate the end-to-end property-first ingestion run for an onboarded county: pilot batch, source-feasibility gate, backpressure-aware full run with stepwise ramp-up, and the streamed internal load that reconciles the county before Atlas publication. Use when starting, scaling, resuming, or wrapping up a county ingestion run. |
| [`county-permit-adapter`](./skills/county-permit-adapter/) | Build a new county's permit-portal harvester as a vendor module for the permit-harvest service, by adapting the Accela template or writing a new vendor module, including source throughput checks and bulk-harvest vs runtime-retrieval decisions. Use when onboarding a county's permit portal, adding a permit vendor module, or debugging per-parcel permit harvest for a county. |
| [`county-readiness-preflight`](./skills/county-readiness-preflight/) | Fail-closed county readiness validator. Use before county-seed-data, county-ingest-run, onboard-county, or any pilot or full ingest. At the start of every new county, validates skills/use-oracle/runtime/docs/<county>-sources.yaml for GIS vs tax-roll, permit-jurisdiction classification, destination proof, records-request recipients, and BBB advertised-count traps. |
| [`county-seed-data`](./skills/county-seed-data/) | Produce and stage the parcel seed CSV that drives county ingestion, at skills/use-oracle/runtime/data/seeds/<county>.csv. Use when onboarding a county, when the ingest feeder reports missing or malformed seed data, or when asked where parcel lists come from. |
| [`dbpr-license-ingest`](./skills/dbpr-license-ingest/) | Look up the official Florida DBPR license detail for a license number printed on a permit, persist company, person, and license from that record, and map property_improvement_has_contractor, contractor_has_license, and contractor_has_person. Acquire the missing public-records relationship extract only for historical qualification when the permit has no license number. |
| [`deploy-open-data-mcp`](./skills/deploy-open-data-mcp/) | Run or deploy the Elephant MCP server against the published Atlas county index, synchronize it, and verify the served tools after a county publication. Use when setting up, cutting over, or checking the open-data MCP. |
| [`durable-workflow-builder`](./skills/durable-workflow-builder/) | Author durable pipeline workflows for the skills/use-oracle/runtime project with Restate's TypeScript SDK — service topology, code skeletons, and the full pattern library (backpressure feeder, layered concurrency, deterministic keys, idempotent side effects, single-writer objects, approval gates) distilled from running the previous county pipeline at full scale. Use when building or modifying pipeline workflows, adding a service or handler, choosing between workflow vs service vs virtual object, wiring retries, concurrency caps, or approval gates, or debugging stuck or paused invocations. |
| [`evaluate-candidate-implementation`](./skills/evaluate-candidate-implementation/) | Phase 3 of candidate test-task evaluation — score implementation quality and kit-usage conformance. |
| [`evaluate-candidate-intent`](./skills/evaluate-candidate-intent/) | Phase 1 of candidate test-task evaluation — derive the story's business intent, then build the evidence model, the pass/fail gates, and the 100-point scoring model. |
| [`evaluate-candidate-product`](./skills/evaluate-candidate-product/) | Phase 2 of candidate test-task evaluation — enforce gates, exercise the candidate's deployed runtime, and score functional outcome and evidence. |
| [`figma-to-code`](./skills/figma-to-code/) | Updating existing frontend code to match Figma designs while preserving business logic and adding responsive design test coverage. |
| [`frontend-bug-fix`](./skills/frontend-bug-fix/) | Triaging and fixing frontend bugs — design comparison, root-cause analysis in history, minimal fixes, test updates, and verification. |
| [`guide-product-work`](./skills/guide-product-work/) | Build or configure a product in usable feature increments derived from its scope and dependencies. Require a user-run configuration, AWS inspection and feedback after every increment. Use with every product builder and configurer. |
| [`integrate-ci-cd`](./skills/integrate-ci-cd/) | Integrating the shared CI/CD pipelines into a project — caller workflows, required recipes, and environment configuration. |
| [`lucario-m2d-doc-replay`](./skills/lucario-m2d-doc-replay/) | Changing or operating Lucario's M2D failed-document replay, run status, manual approval, and restart-from-beginning behavior. |
| [`lucario-m2d-staging-config`](./skills/lucario-m2d-staging-config/) | Changing or operating Lucario's M2D portfolio staging-config updates — config publication, change requests, and sample-media verification. |
| [`manage-channel-templates`](./skills/manage-channel-templates/) | Managing message templates for SMS and email — creating, updating, organizing, and synchronizing template inventories from operational stores. |
| [`manage-communication-activity`](./skills/manage-communication-activity/) | Managing the communication send lifecycle — provider setup, routing, execution handoff, delivery updates, response ingestion, and activity closure for SMS or email. |
| [`manage-short-urls`](./skills/manage-short-urls/) | Designing, rebuilding, and operating the short-URL service — token issuance, link resolution, public redirects, click telemetry. |
| [`manage-story-quality`](./skills/manage-story-quality/) | Operating and extending Kirlia, the story-quality bot that rewrites mentioned Asana stories into the WOW format — enablement, triggers, ledger, diagnosis. |
| [`monitoring-county-ingestion`](./skills/monitoring-county-ingestion/) | Monitor a running county ingestion - workflow progress and ETA, in-flight and paused invocation counts, artifact file counts under data/, query-DB row counts, and stall diagnosis - for any county. Use when asked for ingestion status, ETA, backlog, permit harvest progress, appraisal progress, or why ingestion stalled. |
| [`monitoring-oracle-ingestion`](./skills/monitoring-oracle-ingestion/) | Monitor the bundled AWS ingestion tracks for appraisal, permits, and corporate data, including queue health, artifact counts, and ETAs. Use for AWS-mode Oracle ingestion status. |
| [`onboard-county`](./skills/onboard-county/) | Orchestrate county onboarding or re-ingest through readiness, appraisal, official identity, permits, internal Query DB reconciliation, enrichment, and Atlas publication. |
| [`operate-calling-campaigns`](./skills/operate-calling-campaigns/) | Prepares, validates, schedules, and delivers SOCAPITAL calling campaigns through Filter, live Interprose cleanup, graph_catalog Solver, live PRIMARY ZIP correction, Integrate, and LiveVox. Use for daily calling, prelegal, payfail calling, portfolio campaigns, Solver preparation, ZIP/hour audits, or LiveVox shipment. |
| [`operate-connect-configurations`](./skills/operate-connect-configurations/) | Onboard a partner exchange onto the deployed Connect service as configuration: understand the partner's data, locate production credentials, get dev credentials, select a safe test sample, write the flow, partner configuration, activation and job request, prove them on the dev stack, and hand them to the consuming product. Use when adding a partner, a partner API call, webhook, SFTP or bucket intake, file delivery, or lookup to Connect, or when testing or using an existing Connect configuration. |
| [`operate-marketplace`](./skills/operate-marketplace/) | Operate the deployed Prism Marketplace catalog API from prismteam-ai/marketplace: configure review settings, register ontology (families, categories, products, configurations, components), check and fix product publish readiness, publish CDK cloud-assembly zips and poll reviews, and roll back VALID bundles. Use when registering or publishing products to Prism Marketplace or checking review status. |
| [`operate-sms-campaigns`](./skills/operate-sms-campaigns/) | Prepares, certifies, and starts SOCAPITAL SMS campaigns through the mandatory standard or payfail Filter contract, live Interprose SMS cleanup, PRIMARY ZIP validation, same-day provider dedupe, template checks, reservation, and SMS orchestration. Use for bulk SMS, trigger SMS, credit-reporting sets, portfolio SMS, payfail SMS, workflow payloads, or SMS send readiness. |
| [`overture-places-ingest`](./skills/overture-places-ingest/) | Ingest Overture Maps places for a county with pinned release, county-boundary, taxonomy, source-licence, and internal-reconciliation gates, producing lexicon places records ready for Atlas publication. Use when a county needs business/POI category data or when refreshing an Overture release. |
| [`query-db-loading-matching`](./skills/query-db-loading-matching/) | Load county artifacts into the internal reconciliation store and cross-match records: folio identity, watermarks, tombstones, permit and official identity links, roof age, and enrichment. Use when loading or reconciling a county run; never as the public data source. |
| [`responsive-design-tests`](./skills/responsive-design-tests/) | Writing automated design tests that verify responsive UI changes across mobile, tablet, and desktop breakpoints. |
| [`select-communication-audience`](./skills/select-communication-audience/) | Defining audience selection and eligibility for communications — filter boundaries, intake contracts, input schemas, and packaging eligible populations for downstream runtimes. |
| [`sunbiz-corporate-ingest`](./skills/sunbiz-corporate-ingest/) | Load Florida Sunbiz corporate registration as the official legal-entity identity baseline (document_number) before county permit harvest - bulk download, ZIP-prefix extraction, and lexicon transform as one durable batch job. Use when pre-populating Florida companies for a county, refreshing quarterly Sunbiz data, or matching corporate entities to county addresses. Sunbiz does not issue contractor licenses. |
| [`unified-portal-smoke-testing`](./skills/unified-portal-smoke-testing/) | Create and run scenario-derived unified-portal integration tests on feature and approved development deployments, including isolated CORS-disabled Chrome diagnostics, checkpoint screenshots, and Asana evidence sheets. |
| [`unify-metrics`](./skills/unify-metrics/) | Defining and delivering business metrics end to end — metric discovery, vendor-to-canonical mapping, registration, pipeline integration, and dashboards. Use when adding or changing a metric. |
| [`use-eevee`](./skills/use-eevee/) | Drafting editorial content in the organization's voice — pitches, propositions, website copy, papers, and decks grounded in the curated knowledge base. |
| [`use-elephant-mcp`](./skills/use-elephant-mcp/) | Explore published county property data through the Elephant MCP: scoped counts and filters, property lookups, area questions, and lexicon schema definitions. Use when answering questions about published Atlas county records. Not for ingestion. |
| [`use-magnezone`](./skills/use-magnezone/) | Operate and extend the magnezone-agent relationship-intelligence scaffold for Google Chat, web query, Google Workspace event ingestion, and OpenClaw-aware deployment. |
| [`use-neutral-lexicon`](./skills/use-neutral-lexicon/) | Queries bundled neutral lexicon references for exact schema lookup and modeling precedent. Use when Mew must return entity properties, enums, indexes, relationships, lifecycle, identity, or modeling-paradigm patterns without loading full reference files. |
| [`use-oracle`](./skills/use-oracle/) | Operate Oracle county mining and Atlas publication, improve HOA name/fee/frequency accuracy against NetSuite-paid truth, or return one property's raw official response without transformation. |
| [`use-rotom`](./skills/use-rotom/) | Operate and extend the rotom-agent Google Chat runtime for formal weekly stakeholder progress emails grounded in Asana facts and saved template memory. |

## License

[MIT](./LICENSE) © Soofi XYZ
