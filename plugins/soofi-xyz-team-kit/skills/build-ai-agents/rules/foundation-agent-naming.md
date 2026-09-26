---
title: Agent Naming
impact: HIGH
tags: [naming, convention, identity, pokemon]
---

# Agent Naming

Every runtime agent MUST be named after a real Pokémon from the official Pokédex.

## Rules

1. **Pick a meaningful Pokémon.** The Pokémon's character or abilities should resonate with the agent's purpose.
2. **Use lowercase** for the repository and all code references (e.g., `lucario-agent`, not `Lucario-Agent`).
3. **Suffix runtime repos with `-agent`.** Use `<pokemon>-agent` as the identifier for repo folders, CDK entrypoints, env prefixes, and LangSmith projects (e.g., `lucario-agent`, `machamp-agent`).
4. **Do NOT reuse names.** Check existing runtime agent repos and Cursor plugin agents in `agents/` before picking.
5. **Confirm with the human** before scaffolding code or infrastructure.
6. **Document the choice.** Add a one-line explanation in the README of why this Pokémon was chosen.

## Plugin vs Runtime

| Context | Format | Example |
| --- | --- | --- |
| Cursor plugin subagent (`agents/*.md`) | Plain Pokémon name | `lucario` |
| Runtime Lambda repo | Pokémon + `-agent` suffix | `lucario-agent` |

Use the same base Pokémon in both places when a runtime agent has a matching plugin subagent.

## Allowed vs Disallowed

| Allowed | Disallowed |
| --- | --- |
| Official Pokédex Pokémon with `-agent` suffix (`machamp-agent`, `lucario-agent`) | Roman/Greek poets, philosophers, mythological figures |
| Lowercase hyphenated names | Generic words (`data-processor-agent`, `my-agent`) |
| Names that fit the agent role | Internal project codenames unrelated to Pokédex entries |
| | Deprecated poet repos (`ovid-agent`, `seneca-agent`) |

## Naming Examples

| Agent Purpose | Runtime Name | Why |
| --- | --- | --- |
| Batch / heavy processing | **machamp-agent** | Four-armed powerhouse suited to parallel batch work |
| Optimization / solver | **abra-agent** | Teleporting psychic — quick solver jumps |
| Communication / messaging | **chatot-agent** | Sound-based messenger Pokémon |
| Media / operations monitoring | **lucario-agent** | Aura-sensing tracker for run status and anomalies |

## Where the Name Is Used

Use the same lowercase `<pokemon>-agent` name everywhere in the runtime repo:

```
<agent-name>/
├── lib/<agent-name>-stack.ts
├── bin/<agent-name>.ts
└── apps/agent-handler/...
```

Runtime configuration:

- `keyPrefix: '<agent-name>'` for `@soofi-xyz/chat-state-dynamodb`
- `CHAT_STATE_KEY_PREFIX=<agent-name>`
- `LANGSMITH_PROJECT=<agent-name>`

## ✅ Correct

```
Repository: spring-oaks-capital-llc/lucario-agent
README: "Named after Lucario — tracks aura and anomalies, fitting for an M2D
         operations agent that monitors runs and surfaces failures."
```

```typescript
const state = createDynamoDbState({
  keyPrefix: 'lucario-agent',
  // ...
});
```

## ❌ Incorrect

```
Repository: spring-oaks-capital-llc/ovid-agent        # ❌ Deprecated poet naming
Repository: spring-oaks-capital-llc/data-processor-agent  # ❌ Generic name
Repository: spring-oaks-capital-llc/Lucario-Agent     # ❌ Wrong case
Repository: spring-oaks-capital-llc/lucario           # ❌ Missing -agent suffix on runtime repo
```
