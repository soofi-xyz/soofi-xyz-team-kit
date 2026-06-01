# soofi-xyz plugin kit

A dual [Cursor plugin](https://cursor.com/docs/plugins) and [GitHub Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) packaging company-wide project subagents and skills for AI-assisted development.

## Install

### Cursor

Clone this repository into Cursor's local plugins directory so it is auto-discovered as `soofi-xyz`:

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/soofi-xyz/cursor-plugin.git ~/.cursor/plugins/local/soofi-xyz
```

Then reload Cursor. The plugin will load from `~/.cursor/plugins/local/soofi-xyz` and register all agents and skills automatically.

### GitHub Copilot CLI

Add the marketplace first, then install the plugin from that marketplace:

```bash
copilot plugin marketplace add soofi-xyz/cursor-plugin
copilot plugin install soofi-xyz@soofi-xyz
```

## Update Or Remove

### Cursor

Pull the latest agents and skills from the same directory:

```bash
git -C ~/.cursor/plugins/local/soofi-xyz pull
```

Reload Cursor after pulling so updated agents, skills, and the manifest are picked up.

### GitHub Copilot CLI

Update or uninstall the plugin by name:

```bash
copilot plugin update soofi-xyz
copilot plugin uninstall soofi-xyz
```

## Quick start

When in doubt, **start with [`arceus`](./agents/arceus.md)** — the master router. Arceus reads this README, the agent definitions, and the skill metadata, then tells you which specialist(s) and skill(s) to use for your task. It does not perform the work itself; it hands you a copy-pasteable invocation hint for the right agent.

In Cursor, invoke it explicitly with the slash form:

```text
/arceus I need to add Google Tag Manager to a Vite app and want regression coverage
```

Or mention it naturally in chat:

```text
Use the arceus subagent to recommend the right specialist for migrating an SMS template inventory.
```

In GitHub Copilot CLI, select the custom agent with `/agent` and choose `soofi-xyz:arceus`, or start directly with `--agent soofi-xyz:arceus`.

Cursor's Agent can also delegate to `arceus` automatically at the start of a task when no specific specialist has been named — so simply describing your task in plain English usually triggers the right routing.

If you already know which specialist you need, skip the router and call them directly — for example `/sylveon` for Figma-to-code work or `/regigigas` for SaaS marketplace architecture. The full roster, with triggers and descriptions, lives in the [Agents](#agents) and [Skills](#skills) tables below.

## Agents

| Mascot | Agent | Description | Start With |
| :---: | --- | --- | --- |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/063.png" alt="Abra" width="96"> | [`abra`](./agents/abra.md) | Designs and scaffolds solver services with Glue PySpark, pure Python OR-Tools solvers, and CDK-backed infrastructure. | `/abra Build an optimization solver for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/065.png" alt="Alakazam" width="96"> | [`alakazam`](./agents/alakazam.md) | RAG agent builder — directs reusable AWS RAG agents with Bedrock, OpenSearch, DynamoDB, S3, SAM local, and Docker OpenSearch replay. | `/alakazam Build RAG for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/493.png" alt="Arceus" width="96"> | [`arceus`](./agents/arceus.md) | The Alpha Pokémon — master router that reads `README.md`, agent definitions, and skills, then directs the user to the right specialist(s) and skill(s) for any task. Does not implement the work. | `/arceus Which agent should handle...` |
| <img src="https://archives.bulbagarden.net/media/upload/3/3a/Ash_OS_2.png" alt="Ash" width="96"> | [`ash`](./agents/ash.md) | Designs and implements Asana-triggered Lambda agents using the established Bedrock and telemetry patterns. | `/ash Build an Asana agent that...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/531.png" alt="Audino" width="96"> | [`audino`](./agents/audino.md) | Frontend bug-fix specialist — design comparison, override archaeology, minimal fixes, and regression-proof tests. | `/audino Fix this UI bug...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/628.png" alt="Braviary" width="96"> | [`braviary`](./agents/braviary.md) | Google marketing stack v1 orchestrator — GTM + GA4 + Search Console + Ads linking, stakeholder access, QA handoff; delegates site GTM wiring to `castform`. | `/braviary Set up Google marketing...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/351.png" alt="Castform" width="96"> | [`castform`](./agents/castform.md) | Injects Google Tag Manager (`GTM-…`) into any frontend — official head + body snippets, framework-appropriate root shell, env-aware IDs; does not add standalone GA4 unless you opt out. | `/castform Add GTM-XXXX to...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/441.png" alt="Chatot" width="96"> | [`chatot`](./agents/chatot.md) | Owns the communication-activity lifecycle — provider setup, routing, send handoff, delivery events, and response ingestion. | `/chatot Build send workflow for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/534.png" alt="Conkeldurr" width="96"> | [`conkeldurr`](./agents/conkeldurr.md) | Platform engineer — owns the SOCAPITAL platform product map across Account, Bootstrap, Marketplace, Deployer, Puller, Persist, Connect, Translate, Product, and Rules; always asks "integrate existing or provision new?" before building. | `/conkeldurr Design platform capability...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/225.png" alt="Delibird" width="96"> | [`delibird`](./agents/delibird.md) | Report catalog app builder — single AWS-hosted catalog page listing report URLs, plus a CLI for registering, updating, validating, and publishing report entries. | `/delibird Build report catalog...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/132.png" alt="Ditto" width="96"> | [`ditto`](./agents/ditto.md) | S3 → external file-share sync workflow builder — EventBridge Scheduler starts a Step Functions Distributed Map (plan + cost gate → per-file workers → aggregate) that copies a configured S3 bucket/prefix into Citrix Endpoint Management (default), Citrix ShareFile, or another pluggable destination, with per-env SSM + Secrets Manager configuration and DEV/PROD CI/CD. | `/ditto Sync S3 files to...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/196.png" alt="Espeon" width="96"> | [`espeon`](./agents/espeon.md) | End-to-end RAG system builder — local TypeScript CLI POC first, then AWS OpenSearch migration, historical backfill, webhook ingestion, and rollout. | `/espeon Build an end-to-end RAG system...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/040.png" alt="Wigglytuff" width="96"> | [`wigglytuff`](./agents/wigglytuff.md) | Template-management specialist — Git-backed template inventory, source discovery, metadata normalization, sync workflows, and Asana-facing template operations. | `/wigglytuff Manage templates for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/163.png" alt="Hoothoot" width="96"> | [`hoothoot`](./agents/hoothoot.md) | Prod-first Persist reporting agent running a single Lexicon-rule-aware flow — resolves registered/released rulesets, filters, or separate rules; reads existing Rules outputs, runs new executions, executes exact filters/rules through read-only Persist, or opens a focused Lexicon PR for missing rule definitions; then builds local previews and secure static HTML reports with scheduled AWS refresh, shared Microsoft Azure SSO access, and Amplify deployments. | `/hoothoot Build a Persist report. Ask path, then AWS.`<br>[Guide](./docs/hoothoot.md) |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/064.png" alt="Kadabra" width="96"> | [`kadabra`](./agents/kadabra.md) | Top-level SMS communication service builder — composes `xatu`, `wigglytuff`, `chatot`, and `oranguru` and owns the golden prompt. | `/kadabra Build SMS service...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/707.png" alt="Klefki" width="96"> | [`klefki`](./agents/klefki.md) | Files portal builder — Cognito Managed Login, private S3 folder browsing, per-user grants, custom-domain CloudFront hosting, and Figma-driven UI. | `/klefki Build file portal...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/448.png" alt="Lucario" width="96"> | [`lucario`](./agents/lucario.md) | Media-processing operations agent builder — Asana-triggered M2D run orchestration, replay and approval flows, Interprose verification, and PR-first config/code workflows. | `/lucario Build an M2D operations agent...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/068.png" alt="Machamp" width="96"> | [`machamp`](./agents/machamp.md) | Designs and implements AWS batch workflows with strategy selection, cost gates, throttling, idempotency, and staged test pipelines. | `/machamp Build batch workflow...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/052.png" alt="Meowth" width="96"> | [`meowth`](./agents/meowth.md) | Cursor spend-limit approval workflow builder — EventBridge Scheduler starts a Step Functions Standard state machine (Plan → Map over candidate users → `WaitForTaskToken` Asana approval per user → VerifyAndApply → Aggregate). Opens an Asana task in a configured project assigned to a configured approver when a user crosses a configurable threshold of their `monthlyLimitDollars`, and on task completion the webhook Lambda completes the task token so the state machine raises the user's limit by a configurable increment via `POST /teams/user-spend-limit`, with per-env SSM + Secrets Manager configuration, a DynamoDB cycle ledger, and DEV/PROD CI/CD. | `/meowth Build spend approval...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/376.png" alt="Metagross" width="96"> | [`metagross`](./agents/metagross.md) | Designs and scaffolds fullstack frontend-backend monorepos with Turborepo, Amplify, tRPC, Lambda, and CDK. | `/metagross Scaffold fullstack app...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/164.png" alt="Noctowl" width="96"> | [`noctowl`](./agents/noctowl.md) | Builds general S3-backed audit anomaly analyzers from versioned audit profiles and evidence-backed rule outputs. | `/noctowl Build audit analyzer...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/765.png" alt="Oranguru" width="96"> | [`oranguru`](./agents/oranguru.md) | Communication-runtime assembler — composes audience, template, and activity capabilities into deterministic end-to-end channel services. | `/oranguru Assemble runtime for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/137.png" alt="Porygon" width="96"> | [`porygon`](./agents/porygon.md) | Unifies and analyzes metrics across vendors and data sources with a lexicon-first, audit-friendly workflow. | `/porygon Compare metrics for...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/486.png" alt="Regigigas" width="96"> | [`regigigas`](./agents/regigigas.md) | SaaS marketplace architect — centralized marketplace account governing per-customer AWS tenant accounts, CloudFormation bundle distribution (`cdk synth` artifacts), and component register/release/rollback/list/subscribe/unsubscribe operations. | `/regigigas Design marketplace...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/235.png" alt="Smeargle" width="96"> | [`smeargle`](./agents/smeargle.md) | Responsive design-testing specialist — Playwright design specs across breakpoints, with mocked and real-device lane selection. | `/smeargle Add responsive tests...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/700.png" alt="Sylveon" width="96"> | [`sylveon`](./agents/sylveon.md) | Figma-to-code specialist — updates existing frontend code to match Figma while preserving business logic and locking breakpoints. | `/sylveon Apply Figma design...` |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/178.png" alt="Xatu" width="96"> | [`xatu`](./agents/xatu.md) | Audience-selection specialist — eligibility boundaries, runtime intake contracts, and filter-to-runtime handoffs. | `/xatu Define audience for...` |

## Skills

| Skill | Description |
| --- | --- |
| [`apply-engineering-guidelines`](./skills/apply-engineering-guidelines/) | Apply the Golden Path engineering standards for tech stack, infrastructure, testing, observability, and AI implementation choices. |
| [`assemble-communication-runtime`](./skills/assemble-communication-runtime/) | Runtime-assembly skill for composing audience, template, and communication-activity capabilities into deterministic end-to-end channel services. |
| [`atomic-data`](./skills/atomic-data/) | Atomic row-level facts plus vendor daily rollups for contact-center and operational metrics, Parquet-first storage, CloudWatch + lexicon lineage, and reconciliation patterns. |
| [`build-ai-agents`](./skills/build-ai-agents/) | Build AI agents with the rules-agent pattern: Lambda runtime, Asana webhooks, Bedrock + Vercel AI SDK `ToolLoopAgent`, Bedrock prompt caching, LangSmith telemetry, and AgentCore memory. |
| [`build-batch-workflows`](./skills/build-batch-workflows/) | Design and implement AWS batch workflows with Step Functions Distributed Map, Glue PySpark, cost gates, throttling, idempotency, and staged test pipelines. |
| [`build-build-service`](./skills/build-build-service/) | Build the Build service — TypeScript CDK source intake, CodeBuild synth and validation, CDK cloud assembly artifacts, artifact provenance, build manifests, and marketplace-ready bundle outputs. |
| [`build-bootstrap-cli`](./skills/build-bootstrap-cli/) | Build the Bootstrap CLI — operator-run TypeScript tooling that reads the Account bootstrap manifest, installs the first Deployer locally, then installs Marketplace Puller through that Deployer. |
| [`build-connect-service`](./skills/build-connect-service/) | Build the Connect partner-integration platform — declarative flow specs compiled into Step Functions state machines, partner credential / token registries, on-demand static-IP fabric, webhook task tokens, batch executions, and AWS Transfer Family SFTP connectors. |
| [`build-frontend-backends`](./skills/build-frontend-backends/) | Build fullstack monorepos with Turborepo, AWS Amplify frontends, and tRPC + Lambda backends deployed via CDK. |
| [`build-html-to-pdf`](./skills/build-html-to-pdf/) | Build HTML-to-PDF generation workflows on AWS Lambda using Playwright and Chromium, with typed request contracts, deterministic HTML rendering, runtime packaging, and verification. |
| [`build-inbound-sftp-workflows`](./skills/build-inbound-sftp-workflows/) | Build inbound SFTP workflows on AWS with Transfer Family, a Lambda poller, and listing-first transfer validation. |
| [`build-lexicon-product`](./skills/build-lexicon-product/) | Build the Lexicon product — governed graph vocabulary, ruleset data, metric definitions, source-system mapping artifacts, S3/SSM artifact publication, and read-only schema browsing. |
| [`build-local-rag-pocs`](./skills/build-local-rag-pocs/) | Build local TypeScript RAG proof-of-concepts as simple query-only CLIs with libSQL databases, embeddings, JSON output, and `AGENTS.md` usage instructions. |
| [`build-marketplace-puller`](./skills/build-marketplace-puller/) | Build the Marketplace Puller standalone product — tenant-side scheduled reconciler that polls marketplace desired state, detects drift on subscribed components, and converges via `POST /deploys` (push-primary mode) or a tenant-local CFN executor (pull-only mode). |
| [`build-persist-service`](./skills/build-persist-service/) | Build the Persist graph-persistence platform service — Amazon Neptune backend with SigV4-authorised `/persist/*` HTTP API, lexicon-validated GraphSON v3 ingest (sync + async), Neptune CSV bulk-load workflow, and sync + async Gremlin query channels. |
| [`build-product-deployer`](./skills/build-product-deployer/) | Build the Product Deployer standalone product — defines the common CDK contract every product implements, owns the canonical `EnvironmentContext`, and runs the Step Function that turns `(component, version, env_slug)` into a deployed stack via StackSets or assume-role + raw CloudFormation. |
| [`build-product-service`](./skills/build-product-service/) | Build the Product service — product definitions, schemas, OpenAPI metadata, product flow templates, template-backed flows, invocations, waterfalls, reports, SMS, email, widgets, blobs, and operational telemetry. |
| [`build-rag-systems`](./skills/build-rag-systems/) | Build reusable AWS RAG systems with Bedrock embeddings, OpenSearch retrieval, DynamoDB review state, S3 corpora, local POC migration, historical ingestion, webhooks, SAM local, and Docker OpenSearch replay. |
| [`build-rules-product`](./skills/build-rules-product/) | Build the Rules product — tenant-local batch decisioning over Persist graph facts, lexicon-backed rule evaluation, callable-population S3 outputs, audit reports, Glue preparation jobs, and CloudWatch metrics. |
| [`build-saas-marketplace`](./skills/build-saas-marketplace/) | Build a multi-tenant SaaS distribution marketplace on AWS — Organizations-backed per-customer accounts, a central marketplace control plane, a `cdk synth`-artifact component registry, cross-account CloudFormation StackSet deploys, and the six register / release / rollback / list / subscribe / unsubscribe operations. |
| [`build-sms-communication-service`](./skills/build-sms-communication-service/) | Top-level builder skill for the SMS communication service — owns ontology, worker-skill composition, and golden-prompt governance while delegating to audience, template, activity, and runtime workers. |
| [`build-solver-services`](./skills/build-solver-services/) | Build optimization services combining AWS Glue PySpark data prep with Google OR-Tools solvers using the three-layer architecture. |
| [`build-tenant-account-manager`](./skills/build-tenant-account-manager/) | Build the Tenant Account Manager standalone product — owns customers, environments, and per-environment API keys; mints the bootstrap key issued by the provider for a new customer; supports overlap rotation; ships the shared Lambda authorizer every other marketplace API consumes. |
| [`build-tenant-domain-router`](./skills/build-tenant-domain-router/) | Build the Tenant Domain Router standalone product — root domain `provider.xyz` in marketplace Route 53, per-environment subdomains delegated via NS to a child hosted zone in each tenant account, ACM strategy, and the SSM-backed base-path contract every other product uses to publish HTTP endpoints. |
| [`build-translate-service`](./skills/build-translate-service/) | Build the Translate service — registered partner languages, versioned TypeScript mappings, validation, preview, asynchronous translation executions, mapping packs, and execution telemetry. |
| [`candidate-agent-qc-validation`](./skills/candidate-agent-qc-validation/) | Evaluate hiring-candidate-built agents against requirements and integrations with a concise evidence-backed verdict, setup/test summary, acceptance-criteria mapping, and hiring decision support. |
| [`figma-to-code`](./skills/figma-to-code/) | Frontend engineering workflow to update existing code from Figma designs while preserving logic and adding responsive design test coverage. |
| [`frontend-bug-fix`](./skills/frontend-bug-fix/) | Frontend bug triage and fix workflow with design comparison, commit analysis, test updates, and verification. |
| [`integrate-ci-cd`](./skills/integrate-ci-cd/) | Integrate the shared GitHub Actions workflows into a project using the required `justfile` recipes and caller workflows. |
| [`manage-channel-templates`](./skills/manage-channel-templates/) | Reusable template-management skill for channel template CRUD, metadata normalization, Git-backed inventory, and source-to-Git template synchronization. |
| [`manage-communication-activity`](./skills/manage-communication-activity/) | Reusable communication-activity skill that keeps provider setup, routing, execution handoff, delivery events, and response feedback in one lifecycle. |
| [`responsive-design-tests`](./skills/responsive-design-tests/) | Write Playwright design tests for Figma-driven responsive UI updates across mocked and real-device lanes. |
| [`select-communication-audience`](./skills/select-communication-audience/) | Reusable audience-selection skill for defining eligibility boundaries and packaging filtered communication populations for downstream runtimes. |
| [`unify-metrics`](./skills/unify-metrics/) | Lexicon-first metric unification: comparability gates, normalization, analysis, and audit-friendly outputs. |
| [`use-elephant-query-db`](./skills/use-elephant-query-db/) | User guide for consuming the Vercel Neon `elephant-query-db` database with `@elephant-xyz/query-db` schema imports and TypeScript/Drizzle query code for parcels, permits, Sunbiz companies, and addresses. |
| [`use-translate-service`](./skills/use-translate-service/) | User guide for calling a deployed Translate service — what a language and a runtime mapping are, the JSON shapes required to register them, the input/output shapes Translate expects, and how to validate, preview, and run asynchronous executions over `/translate/*`. |

## License

[MIT](./LICENSE) © Soofi XYZ
