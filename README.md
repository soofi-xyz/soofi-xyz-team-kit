# soofi-xyz-cursor-plugin

A [Cursor plugin](https://cursor.com/docs/plugins) packaging company-wide project subagents for AI-assisted development.

## What's inside

| Component | Location | Description |
| --- | --- | --- |
| Agents | [`agents/`](./agents/) | Custom subagent configurations discovered automatically by Cursor |
| Skills | [`skills/`](./skills/) | Agent skills — one directory per skill with a `SKILL.md` entry point |
| Manifest | [`.cursor-plugin/plugin.json`](./.cursor-plugin/plugin.json) | Plugin manifest |

## Skills

| Skill | Description |
| --- | --- |
| [`apply-engineering-guidelines`](./skills/apply-engineering-guidelines/) | Apply the Golden Path engineering standards for tech stack, infrastructure, testing, observability, and AI implementation choices. |
| [`atomic-data`](./skills/atomic-data/) | Atomic row-level facts plus vendor daily rollups for contact-center and operational metrics, Parquet-first storage, CloudWatch + lexicon lineage, and reconciliation patterns. |
| [`build-ai-agents`](./skills/build-ai-agents/) | Build AI agents with the rules-agent pattern: Lambda runtime, Asana webhooks, Bedrock + Vercel AI SDK `ToolLoopAgent`, LangSmith telemetry, and AgentCore memory. |
| [`build-batch-workflows`](./skills/build-batch-workflows/) | Design and implement AWS batch workflows with Step Functions Distributed Map, Glue PySpark, cost gates, throttling, idempotency, and staged test pipelines. |
| [`build-frontend-backends`](./skills/build-frontend-backends/) | Build fullstack monorepos with Turborepo, AWS Amplify frontends, and tRPC + Lambda backends deployed via CDK. |
| [`build-inbound-sftp-workflows`](./skills/build-inbound-sftp-workflows/) | Build inbound SFTP workflows on AWS with Transfer Family, a Lambda poller, and listing-first transfer validation. |
| [`build-solver-services`](./skills/build-solver-services/) | Build optimization services combining AWS Glue PySpark data prep with Google OR-Tools solvers using the three-layer architecture. |
| [`chatot`](./skills/chatot/) | Reusable communication-activity skill that keeps provider setup, routing, execution handoff, delivery events, and response feedback in one lifecycle. |
| [`discover-skills`](./skills/discover-skills/) | Discover, search, install, and update agent skills from the company registry. Load before starting any task to check if a relevant skill exists. |
| [`figma-to-code`](./skills/figma-to-code/) | Frontend engineering workflow to update existing code from Figma designs while preserving logic and adding responsive design test coverage. |
| [`frontend-bug-fix`](./skills/frontend-bug-fix/) | Frontend bug triage and fix workflow with design comparison, commit analysis, test updates, and verification. |
| [`integrate-ci-cd`](./skills/integrate-ci-cd/) | Integrate the shared GitHub Actions workflows into a project using the required `justfile` recipes and caller workflows. |
| [`jigglypuff`](./skills/jigglypuff/) | Reusable template-management skill for channel template CRUD, metadata normalization, Git-backed inventory, and source-to-Git template synchronization. |
| [`kadabra`](./skills/kadabra/) | Top-level builder skill for the SMS communication service — owns ontology, worker-skill composition, and golden-prompt governance while delegating to `xatu`, `chatot`, and `oranguru`. |
| [`metrics-skill`](./skills/metrics-skill/) | Lexicon-first metric unification: comparability gates, normalization, analysis, and audit-friendly outputs. |
| [`oranguru`](./skills/oranguru/) | Runtime-assembly skill for composing audience, template, and communication-activity capabilities into deterministic end-to-end channel services. |
| [`responsive-design-tests`](./skills/responsive-design-tests/) | Write Playwright design tests for Figma-driven responsive UI updates across mocked and real-device lanes. |
| [`xatu`](./skills/xatu/) | Reusable audience-selection skill for defining eligibility boundaries and packaging filtered communication populations for downstream runtimes. |

## Agents

| Agent | Mascot | Description |
| --- | --- | --- |
| [`abra`](./agents/abra.md) | Abra | Designs and scaffolds solver services with Glue PySpark, pure Python OR-Tools solvers, and CDK-backed infrastructure. |
| [`ash`](./agents/ash.md) | Ash | Designs and implements Asana-triggered Lambda agents using the established Bedrock and telemetry patterns. |
| [`chatot`](./agents/chatot.md) | Chatot | Owns the communication-activity lifecycle — provider setup, routing, send handoff, delivery events, and response ingestion. |
| [`jigglypuff`](./agents/jigglypuff.md) | Jigglypuff | Template-management specialist — Git-backed template inventory, CRUD, metadata normalization, and sync workflows. |
| [`kadabra`](./agents/kadabra.md) | Kadabra | Top-level SMS communication service builder — composes `xatu`, `jigglypuff`, `chatot`, and `oranguru` and owns the golden prompt. |
| [`machamp`](./agents/machamp.md) | Machamp | Designs and implements AWS batch workflows with strategy selection, cost gates, throttling, idempotency, and staged test pipelines. |
| [`metagross`](./agents/metagross.md) | Metagross | Designs and scaffolds fullstack frontend-backend monorepos with Turborepo, Amplify, tRPC, Lambda, and CDK. |
| [`oranguru`](./agents/oranguru.md) | Oranguru | Communication-runtime assembler — composes audience, template, and activity capabilities into deterministic end-to-end channel services. |
| [`porygon`](./agents/porygon.md) | Porygon | Unifies and analyzes metrics across vendors and data sources with a lexicon-first, audit-friendly workflow. |
| [`smeargle`](./agents/smeargle.md) | Smeargle | Handles Figma-driven frontend delivery: design intake, UI bug triage, commit archaeology, code updates, and responsive design verification. |
| [`xatu`](./agents/xatu.md) | Xatu | Audience-selection specialist — eligibility boundaries, runtime intake contracts, and filter-to-runtime handoffs. |

### Agent mascots

| Agent | Image |
| --- | --- |
| abra | ![Abra](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/063.png) |
| ash | <img src="https://archives.bulbagarden.net/media/upload/3/3a/Ash_OS_2.png" alt="Ash" width="112" height="112"> |
| chatot | ![Chatot](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/441.png) |
| jigglypuff | ![Jigglypuff](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/039.png) |
| kadabra | ![Kadabra](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/064.png) |
| machamp | ![Machamp](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/068.png) |
| metagross | ![Metagross](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/376.png) |
| oranguru | ![Oranguru](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/765.png) |
| porygon | ![Porygon](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/137.png) |
| smeargle | ![Smeargle](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/235.png) |
| xatu | ![Xatu](https://assets.pokemon.com/assets/cms2/img/pokedex/detail/178.png) |

## Repository layout

```text
soofi-xyz-cursor-plugin/
├── .cursor-plugin/
│   └── plugin.json                  # Plugin manifest (required)
├── agents/                          # Subagent definitions (auto-discovered)
│   ├── abra.md
│   ├── ash.md
│   ├── chatot.md
│   ├── jigglypuff.md
│   ├── kadabra.md
│   ├── machamp.md
│   ├── metagross.md
│   ├── oranguru.md
│   ├── porygon.md
│   ├── smeargle.md
│   └── xatu.md
├── skills/                          # Agent skills (auto-discovered, one dir per skill)
│   ├── apply-engineering-guidelines/ # Golden Path engineering standards
│   ├── atomic-data/                 # Atomic facts + vendor rollups for operational metrics
│   ├── build-ai-agents/             # Rules-agent pattern for AI agents
│   ├── build-batch-workflows/       # Step Functions / Glue batch workflows
│   ├── build-frontend-backends/     # Turborepo + Amplify + tRPC + CDK monorepos
│   ├── build-inbound-sftp-workflows/ # AWS Transfer Family inbound SFTP integrations
│   ├── build-solver-services/       # Glue + OR-Tools optimization services
│   ├── chatot/                      # Communication-activity skill (worker of kadabra)
│   ├── discover-skills/             # Registry discovery before task start
│   ├── figma-to-code/               # Figma-driven frontend updates
│   ├── frontend-bug-fix/            # UI bug triage and regression prevention
│   ├── integrate-ci-cd/             # Shared GitHub Actions workflows
│   ├── jigglypuff/                  # Template-management skill (worker of kadabra)
│   ├── kadabra/                     # Top-level SMS communication service builder
│   ├── metrics-skill/               # Lexicon-first metric unification
│   ├── oranguru/                    # Runtime-assembly skill (worker of kadabra)
│   ├── responsive-design-tests/     # Playwright design tests across breakpoints
│   └── xatu/                        # Audience-selection skill (worker of kadabra)
├── AGENTS.md                        # Contributor guidance for agents/skills in this repo
├── CONTRIBUTING.md                  # How to contribute
└── README.md
```

Cursor discovers components automatically based on folder names. See the [Plugins reference](https://cursor.com/docs/reference/plugins) for the full component model.

## Installation

### Option 1: Local development (symlink)

Load the plugin directly from this checkout for fast iteration:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s "$(pwd)" ~/.cursor/plugins/local/soofi-xyz-cursor-plugin
```

Then run **Developer: Reload Window** in Cursor (or restart Cursor). Verify the agents show up in the agent picker.

### Option 2: Install from GitHub

1. Push this repository to GitHub.
2. In Cursor, open the **Marketplace** panel and install from the repo URL, or use an MCP-style deeplink if distributing.
3. For team-wide distribution, add this repo as a [team marketplace](https://cursor.com/docs/plugins#team-marketplaces) (Teams / Enterprise plans).

## Adding a new agent

1. Create `agents/<name>.md` with YAML frontmatter:

   ```markdown
   ---
   name: <name>
   description: <what it does and when it should be used>
   ---

   You are <Name>, the <role>.

   When invoked:
   1. …
   ```

2. Add a row to the **Agents** table in this README.
3. Reload Cursor.

## Adding a new skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`).
2. Keep `SKILL.md` under 500 lines; split detail into `rules/` or `reference/` subdirectories.
3. Add a row to a **Skills** table in this README.

See [`AGENTS.md`](./AGENTS.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.

## References

- [Cursor Plugins overview](https://cursor.com/docs/plugins)
- [Plugins reference](https://cursor.com/docs/reference/plugins)
- [Cursor plugin template](https://github.com/cursor/plugin-template)

## License

[MIT](./LICENSE) © Soofi XYZ
