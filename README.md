# Soofi product team kit

Product builders and configurers for Cursor, GitHub Copilot CLI and OpenAI Codex.

## Quick start

Choose a builder to implement or fix a product, or a configurer to use an existing service.

```text
/conkeldurr Fix Persist's duplicate-ingest handling and walk me through a replay test.
/celebi Configure a Connect → Transform → Persist outcome on the existing System.
```

In Copilot, select `soofi-xyz-team-kit:<agent>`. In Codex, request the named custom agent.

## Product agents

<!-- product-catalog:start -->

| Product | What it does | Build and maintain | Configure and test |
| --- | --- | --- | --- |
| **Account** | Account manages Prism identities and keys, guides Prism-managed or client-owned AWS setup, creates or adopts the backing account, verifies Prism service access and emits bootstrap manifests. | [`kangaskhan`](./agents/kangaskhan.md) | [`blissey`](./agents/blissey.md) |
| **Environment** | Environment manages domains, certificates, shared routing and the initial Prism platform installation. | [`torterra`](./agents/torterra.md) | [`shaymin`](./agents/shaymin.md) |
| **Marketplace** | Marketplace catalogs products and reviews, publishes and rolls back bundles. | [`regigigas`](./agents/regigigas.md) | [`registeel`](./agents/registeel.md) |
| **Build** | Build turns validated source into portable deployment artifacts with provenance. | [`tinkaton`](./agents/tinkaton.md) | [`metang`](./agents/metang.md) |
| **Deploy** | Deploy executes validated artifacts and reports deployment run results. | [`corviknight`](./agents/corviknight.md) | [`skarmory`](./agents/skarmory.md) |
| **Model** | Model governs vocabulary, definitions and compatible artifact releases. | [`dialga`](./agents/dialga.md) | [`jirachi`](./agents/jirachi.md) |
| **Transform** | Transform converts registered source languages into target languages. | [`kecleon`](./agents/kecleon.md) | [`silvally`](./agents/silvally.md) |
| **Persist** | Persist stores graph facts and serves queries, indexes and triggers. | [`conkeldurr`](./agents/conkeldurr.md) | [`uxie`](./agents/uxie.md) |
| **Rule** | Rule selects entities and evaluates governed predicates. | [`gallade`](./agents/gallade.md) | [`meditite`](./agents/meditite.md) |
| **Connect** | Connect exchanges files and requests with external partners. | [`lapras`](./agents/lapras.md) | [`wingull`](./agents/wingull.md) |
| **System** | System orchestrates business outcomes through reusable configured flows. | [`zygarde`](./agents/zygarde.md) | [`celebi`](./agents/celebi.md) |

<!-- product-catalog:end -->

## Installation and updates

<details>
<summary>Cursor</summary>

Install into Cursor's local plugins directory:

```bash
mkdir -p ~/.cursor/plugins/local
git clone https://github.com/soofi-xyz/soofi-xyz-team-kit.git ~/.cursor/plugins/local/soofi-xyz-team-kit
```

Reload Cursor and confirm the plugin under **Settings → Plugins**.

To update:

```bash
git -C ~/.cursor/plugins/local/soofi-xyz-team-kit pull
```

Reload Cursor after updating. The bundled Elephant MCP requires Node **22.18+**;
see [MCP setup](./skills/use-elephant-mcp/reference/mcp-setup.md) and the
[self-contained ingestion guide](./skills/use-oracle/reference/self-contained-ingestion.md).

</details>

<details>
<summary>GitHub Copilot CLI</summary>

```bash
copilot plugin marketplace add soofi-xyz/soofi-xyz-team-kit
copilot plugin install soofi-xyz-team-kit@soofi-xyz
```

To update, run this inside Copilot:

```text
/plugin update soofi-xyz-team-kit@soofi-xyz
```

To remove: `copilot plugin uninstall soofi-xyz-team-kit`.

</details>

<details>
<summary>OpenAI Codex</summary>

From a checkout of this repository:

```bash
codex plugin marketplace add ./
codex plugin add soofi-xyz-team-kit@soofi-xyz-team-kit
```

To update:

```bash
codex plugin marketplace upgrade soofi-xyz-team-kit
codex plugin add soofi-xyz-team-kit@soofi-xyz-team-kit
```

Start a new thread after installation or updates. The plugin supplies skills;
custom agents are project-scoped in `.codex/agents/` when working in this checkout.

To remove: `codex plugin remove soofi-xyz-team-kit`.

</details>

[Contributing](./CONTRIBUTING.md) · [MIT License](./LICENSE) © Soofi XYZ
