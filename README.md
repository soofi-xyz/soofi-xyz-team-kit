# soofi-xyz-cursor-plugin

A [Cursor plugin](https://cursor.com/docs/plugins) packaging company-wide project subagents for AI-assisted development.

## Installation

Clone this repository into Cursor's local plugins directory so it is auto-discovered as `soofi-xyz`:

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/soofi-xyz/cursor-plugin.git ~/.cursor/plugins/local/soofi-xyz
```

Then reload Cursor. The plugin will load from `~/.cursor/plugins/local/soofi-xyz` and register all agents and skills automatically.

## Updating

Pull the latest agents and skills from the same directory:

```bash
git -C ~/.cursor/plugins/local/soofi-xyz pull
```

Reload Cursor after pulling so updated agents, skills, and the manifest are picked up.

## Quick start

When in doubt, **start with [`arceus`](./agents/arceus.md)** — the master router. Arceus reads this README, the agent definitions, and the skill metadata, then tells you which specialist(s) and skill(s) to use for your task. It does not perform the work itself; it hands you a copy-pasteable invocation hint for the right agent.

Invoke it explicitly with the slash form:

```text
/arceus I need to add Google Tag Manager to a Vite app and want regression coverage
```

Or mention it naturally in chat:

```text
Use the arceus subagent to recommend the right specialist for migrating an SMS template inventory.
```

Cursor's Agent will also delegate to `arceus` automatically at the start of a task when no specific specialist has been named — so simply describing your task in plain English usually triggers the right routing.

If you already know which specialist you need, skip the router and call them directly — for example `/sylveon` for Figma-to-code work or `/regigigas` for SaaS marketplace architecture. The full roster, with triggers and descriptions, lives in the [Agents](#agents) and [Skills](#skills) tables below.

## What's inside

| Component | Location | Description |
| --- | --- | --- |
| Agents | [`agents/`](./agents/) | Custom subagent configurations discovered automatically by Cursor |
| Skills | [`skills/`](./skills/) | Agent skills — one directory per skill with a `SKILL.md` entry point |
| Manifest | [`.cursor-plugin/plugin.json`](./.cursor-plugin/plugin.json) | Plugin manifest |

## Agents

| Mascot | Agent | Description |
| :---: | --- | --- |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/063.png" alt="Abra" width="96"> | [`abra`](./agents/abra.md) | Designs and scaffolds solver services with Glue PySpark, pure Python OR-Tools solvers, and CDK-backed infrastructure. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/493.png" alt="Arceus" width="96"> | [`arceus`](./agents/arceus.md) | The Alpha Pokémon — master router that reads `README.md`, agent definitions, and skills, then directs the user to the right specialist(s) and skill(s) for any task. Does not implement the work. |
| <img src="https://archives.bulbagarden.net/media/upload/3/3a/Ash_OS_2.png" alt="Ash" width="96"> | [`ash`](./agents/ash.md) | Designs and implements Asana-triggered Lambda agents using the established Bedrock and telemetry patterns. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/531.png" alt="Audino" width="96"> | [`audino`](./agents/audino.md) | Frontend bug-fix specialist — design comparison, override archaeology, minimal fixes, and regression-proof tests. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/351.png" alt="Castform" width="96"> | [`castform`](./agents/castform.md) | Injects Google Tag Manager (`GTM-…`) into any frontend — official head + body snippets, framework-appropriate root shell, env-aware IDs; does not add standalone GA4 unless you opt out. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/441.png" alt="Chatot" width="96"> | [`chatot`](./agents/chatot.md) | Owns the communication-activity lifecycle — provider setup, routing, send handoff, delivery events, and response ingestion. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/534.png" alt="Conkeldurr" width="96"> | [`conkeldurr`](./agents/conkeldurr.md) | Platform engineer — owns the SOCAPITAL platform ontology (Persist, Connect), always asks "extend existing or provision new?" before building, and is fully capable of standing up each product end to end. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/132.png" alt="Ditto" width="96"> | [`ditto`](./agents/ditto.md) | S3 → external file-share sync workflow builder — EventBridge Scheduler starts a Step Functions Distributed Map (plan + cost gate → per-file workers → aggregate) that copies a configured S3 bucket/prefix into Citrix Endpoint Management (default), Citrix ShareFile, or another pluggable destination, with per-env SSM + Secrets Manager configuration and DEV/PROD CI/CD. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/040.png" alt="Wigglytuff" width="96"> | [`wigglytuff`](./agents/wigglytuff.md) | Template-management specialist — Git-backed template inventory, source discovery, metadata normalization, sync workflows, and Asana-facing template operations. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/064.png" alt="Kadabra" width="96"> | [`kadabra`](./agents/kadabra.md) | Top-level SMS communication service builder — composes `xatu`, `wigglytuff`, `chatot`, and `oranguru` and owns the golden prompt. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/707.png" alt="Klefki" width="96"> | [`klefki`](./agents/klefki.md) | Files portal builder — Cognito Managed Login, private S3 folder browsing, per-user grants, custom-domain CloudFront hosting, and Figma-driven UI. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/068.png" alt="Machamp" width="96"> | [`machamp`](./agents/machamp.md) | Designs and implements AWS batch workflows with strategy selection, cost gates, throttling, idempotency, and staged test pipelines. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/052.png" alt="Meowth" width="96"> | [`meowth`](./agents/meowth.md) | Cursor spend-limit approval workflow builder — EventBridge Scheduler starts a Step Functions Standard state machine (Plan → Map over candidate users → `WaitForTaskToken` Asana approval per user → VerifyAndApply → Aggregate). Opens an Asana task in a configured project assigned to a configured approver when a user crosses a configurable threshold of their `monthlyLimitDollars`, and on task completion the webhook Lambda completes the task token so the state machine raises the user's limit by a configurable increment via `POST /teams/user-spend-limit`, with per-env SSM + Secrets Manager configuration, a DynamoDB cycle ledger, and DEV/PROD CI/CD. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/376.png" alt="Metagross" width="96"> | [`metagross`](./agents/metagross.md) | Designs and scaffolds fullstack frontend-backend monorepos with Turborepo, Amplify, tRPC, Lambda, and CDK. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/164.png" alt="Noctowl" width="96"> | [`noctowl`](./agents/noctowl.md) | Builds general S3-backed audit anomaly analyzers from versioned audit profiles and evidence-backed rule outputs. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/765.png" alt="Oranguru" width="96"> | [`oranguru`](./agents/oranguru.md) | Communication-runtime assembler — composes audience, template, and activity capabilities into deterministic end-to-end channel services. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/137.png" alt="Porygon" width="96"> | [`porygon`](./agents/porygon.md) | Unifies and analyzes metrics across vendors and data sources with a lexicon-first, audit-friendly workflow. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/486.png" alt="Regigigas" width="96"> | [`regigigas`](./agents/regigigas.md) | SaaS marketplace architect — centralized marketplace account governing per-customer AWS tenant accounts, CloudFormation bundle distribution (`cdk synth` artifacts), and component register/release/rollback/list/subscribe/unsubscribe operations. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/235.png" alt="Smeargle" width="96"> | [`smeargle`](./agents/smeargle.md) | Responsive design-testing specialist — Playwright design specs across breakpoints, with mocked and real-device lane selection. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/700.png" alt="Sylveon" width="96"> | [`sylveon`](./agents/sylveon.md) | Figma-to-code specialist — updates existing frontend code to match Figma while preserving business logic and locking breakpoints. |
| <img src="https://assets.pokemon.com/assets/cms2/img/pokedex/detail/178.png" alt="Xatu" width="96"> | [`xatu`](./agents/xatu.md) | Audience-selection specialist — eligibility boundaries, runtime intake contracts, and filter-to-runtime handoffs. |

## Skills

| Skill | Description |
| --- | --- |
| [`apply-engineering-guidelines`](./skills/apply-engineering-guidelines/) | Apply the Golden Path engineering standards for tech stack, infrastructure, testing, observability, and AI implementation choices. |
| [`assemble-communication-runtime`](./skills/assemble-communication-runtime/) | Runtime-assembly skill for composing audience, template, and communication-activity capabilities into deterministic end-to-end channel services. |
| [`atomic-data`](./skills/atomic-data/) | Atomic row-level facts plus vendor daily rollups for contact-center and operational metrics, Parquet-first storage, CloudWatch + lexicon lineage, and reconciliation patterns. |
| [`build-ai-agents`](./skills/build-ai-agents/) | Build AI agents with the rules-agent pattern: Lambda runtime, Asana webhooks, Bedrock + Vercel AI SDK `ToolLoopAgent`, LangSmith telemetry, and AgentCore memory. |
| [`build-batch-workflows`](./skills/build-batch-workflows/) | Design and implement AWS batch workflows with Step Functions Distributed Map, Glue PySpark, cost gates, throttling, idempotency, and staged test pipelines. |
| [`build-bootstrap-cli`](./skills/build-bootstrap-cli/) | Build the Bootstrap CLI — operator-run TypeScript tooling that reads the Account bootstrap manifest, installs the first Deployer locally, then installs Marketplace Puller through that Deployer. |
| [`build-connect-service`](./skills/build-connect-service/) | Build the Connect partner-integration platform — declarative flow specs compiled into Step Functions state machines, partner credential / token registries, on-demand static-IP fabric, webhook task tokens, batch executions, and AWS Transfer Family SFTP connectors. |
| [`build-frontend-backends`](./skills/build-frontend-backends/) | Build fullstack monorepos with Turborepo, AWS Amplify frontends, and tRPC + Lambda backends deployed via CDK. |
| [`build-html-to-pdf`](./skills/build-html-to-pdf/) | Build HTML-to-PDF generation workflows on AWS Lambda using Playwright and Chromium, with typed request contracts, deterministic HTML rendering, runtime packaging, and verification. |
| [`build-inbound-sftp-workflows`](./skills/build-inbound-sftp-workflows/) | Build inbound SFTP workflows on AWS with Transfer Family, a Lambda poller, and listing-first transfer validation. |
| [`build-marketplace-puller`](./skills/build-marketplace-puller/) | Build the Marketplace Puller standalone product — tenant-side scheduled reconciler that polls marketplace desired state, detects drift on subscribed components, and converges via `POST /deploys` (push-primary mode) or a tenant-local CFN executor (pull-only mode). |
| [`build-persist-service`](./skills/build-persist-service/) | Build the Persist graph-persistence platform service — Amazon Neptune backend with SigV4-authorised `/persist/*` HTTP API, lexicon-validated GraphSON v3 ingest (sync + async), Neptune CSV bulk-load workflow, and sync + async Gremlin query channels. |
| [`build-product-deployer`](./skills/build-product-deployer/) | Build the Product Deployer standalone product — defines the common CDK contract every product implements, owns the canonical `EnvironmentContext`, and runs the Step Function that turns `(component, version, env_slug)` into a deployed stack via StackSets or assume-role + raw CloudFormation. |
| [`build-saas-marketplace`](./skills/build-saas-marketplace/) | Build a multi-tenant SaaS distribution marketplace on AWS — Organizations-backed per-customer accounts, a central marketplace control plane, a `cdk synth`-artifact component registry, cross-account CloudFormation StackSet deploys, and the six register / release / rollback / list / subscribe / unsubscribe operations. |
| [`build-sms-communication-service`](./skills/build-sms-communication-service/) | Top-level builder skill for the SMS communication service — owns ontology, worker-skill composition, and golden-prompt governance while delegating to audience, template, activity, and runtime workers. |
| [`build-solver-services`](./skills/build-solver-services/) | Build optimization services combining AWS Glue PySpark data prep with Google OR-Tools solvers using the three-layer architecture. |
| [`build-tenant-account-manager`](./skills/build-tenant-account-manager/) | Build the Tenant Account Manager standalone product — owns customers, environments, and per-environment API keys; mints the bootstrap key issued by the provider for a new customer; supports overlap rotation; ships the shared Lambda authorizer every other marketplace API consumes. |
| [`build-tenant-domain-router`](./skills/build-tenant-domain-router/) | Build the Tenant Domain Router standalone product — root domain `provider.xyz` in marketplace Route 53, per-environment subdomains delegated via NS to a child hosted zone in each tenant account, ACM strategy, and the SSM-backed base-path contract every other product uses to publish HTTP endpoints. |
| [`figma-to-code`](./skills/figma-to-code/) | Frontend engineering workflow to update existing code from Figma designs while preserving logic and adding responsive design test coverage. |
| [`frontend-bug-fix`](./skills/frontend-bug-fix/) | Frontend bug triage and fix workflow with design comparison, commit analysis, test updates, and verification. |
| [`integrate-ci-cd`](./skills/integrate-ci-cd/) | Integrate the shared GitHub Actions workflows into a project using the required `justfile` recipes and caller workflows. |
| [`manage-channel-templates`](./skills/manage-channel-templates/) | Reusable template-management skill for channel template CRUD, metadata normalization, Git-backed inventory, and source-to-Git template synchronization. |
| [`manage-communication-activity`](./skills/manage-communication-activity/) | Reusable communication-activity skill that keeps provider setup, routing, execution handoff, delivery events, and response feedback in one lifecycle. |
| [`responsive-design-tests`](./skills/responsive-design-tests/) | Write Playwright design tests for Figma-driven responsive UI updates across mocked and real-device lanes. |
| [`select-communication-audience`](./skills/select-communication-audience/) | Reusable audience-selection skill for defining eligibility boundaries and packaging filtered communication populations for downstream runtimes. |
| [`unify-metrics`](./skills/unify-metrics/) | Lexicon-first metric unification: comparability gates, normalization, analysis, and audit-friendly outputs. |

## Repository layout

```text
soofi-xyz-cursor-plugin/
├── .cursor-plugin/
│   └── plugin.json                  # Plugin manifest (required)
├── agents/                          # Subagent definitions (auto-discovered)
│   ├── abra.md
│   ├── arceus.md
│   ├── ash.md
│   ├── audino.md
│   ├── castform.md
│   ├── chatot.md
│   ├── conkeldurr.md
│   ├── ditto.md
│   ├── wigglytuff.md
│   ├── kadabra.md
│   ├── klefki.md
│   ├── machamp.md
│   ├── meowth.md
│   ├── metagross.md
│   ├── noctowl.md
│   ├── oranguru.md
│   ├── porygon.md
│   ├── regigigas.md
│   ├── smeargle.md
│   ├── sylveon.md
│   └── xatu.md
├── skills/                          # Agent skills (auto-discovered, one dir per skill)
│   ├── apply-engineering-guidelines/ # Golden Path engineering standards
│   ├── assemble-communication-runtime/ # Runtime-assembly worker skill (used by Oranguru)
│   ├── atomic-data/                 # Atomic facts + vendor rollups for operational metrics
│   ├── build-ai-agents/             # Rules-agent pattern for AI agents
│   ├── build-batch-workflows/       # Step Functions / Glue batch workflows
│   ├── build-bootstrap-cli/         # Initial tenant bootstrap CLI for Deployer + Puller
│   ├── build-connect-service/       # Connect partner-integration platform service (used by Conkeldurr)
│   ├── build-frontend-backends/     # Turborepo + Amplify + tRPC + CDK monorepos
│   ├── build-html-to-pdf/           # Lambda + Playwright + Chromium HTML-to-PDF workflows
│   ├── build-inbound-sftp-workflows/ # AWS Transfer Family inbound SFTP integrations
│   ├── build-marketplace-puller/    # Tenant-side reconciler standalone product (used by Regigigas)
│   ├── build-persist-service/       # Persist graph-persistence platform service (used by Conkeldurr)
│   ├── build-product-deployer/      # Common CDK + EnvironmentContext deploy product (used by Regigigas)
│   ├── build-saas-marketplace/      # Multi-tenant SaaS marketplace control plane + cross-account CFN distribution (used by Regigigas)
│   ├── build-sms-communication-service/ # Top-level SMS communication service builder (used by Kadabra)
│   ├── build-solver-services/       # Glue + OR-Tools optimization services
│   ├── build-tenant-account-manager/ # Customers, environments, API keys, shared authorizer standalone product (used by Regigigas)
│   ├── build-tenant-domain-router/  # Root domain + per-env subdomains + base-path contract standalone product (used by Regigigas)
│   ├── figma-to-code/               # Figma-driven frontend updates
│   ├── frontend-bug-fix/            # UI bug triage and regression prevention
│   ├── integrate-ci-cd/             # Shared GitHub Actions workflows
│   ├── manage-channel-templates/    # Template-management worker skill (used by Jigglypuff)
│   ├── manage-communication-activity/ # Communication-activity worker skill (used by Chatot)
│   ├── responsive-design-tests/     # Playwright design tests across breakpoints
│   ├── select-communication-audience/ # Audience-selection worker skill (used by Xatu)
│   └── unify-metrics/               # Lexicon-first metric unification
├── AGENTS.md                        # Contributor guidance for agents/skills in this repo
├── CONTRIBUTING.md                  # How to contribute
└── README.md
```

Cursor discovers components automatically based on folder names. See the [Plugins reference](https://cursor.com/docs/reference/plugins) for the full component model.

## References

- [Cursor Plugins overview](https://cursor.com/docs/plugins)
- [Plugins reference](https://cursor.com/docs/reference/plugins)
- [Cursor plugin template](https://github.com/cursor/plugin-template)

## License

[MIT](./LICENSE) © Soofi XYZ
