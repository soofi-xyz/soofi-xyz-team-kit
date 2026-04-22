---
name: build-ai-agents
description: "Guides creation of AI agents using the rules-agent pattern. Covers Lambda-first agent runtime design, Chat SDK ingress via @soofi-xyz/chat-adapter-asana, Chat SDK state persistence via @soofi-xyz/chat-state-dynamodb, Vercel AI SDK ToolLoopAgent on Bedrock, multi-intent request routing, LangSmith telemetry, AgentCore-backed AI conversation memory, tools, deployment, and testing. Triggers on: ai agent, build agent, lambda agent, asana bot, chat sdk, chat-adapter-asana, chat-state-dynamodb, webhook agent, tool loop agent, langsmith agent, agent memory, bedrock agent, agentcore memory."
---

# Building AI Agents

Step-by-step guide for designing and deploying AI agents in this ecosystem. Follow the **ovid-agent / rules-agent** reference implementation, updated for the Chat SDK and the `@soofi-xyz/*` packages that replace hand-rolled Asana webhook code.

## Architecture: Lambda Runtime Only

This skill standardizes on **AWS Lambda** for agent runtime. Do not use AgentCore as the runtime for agents built from this skill.

The Lambda hosts the Chat SDK (with `@soofi-xyz/chat-adapter-asana`) and runs the AI turn inside Chat SDK handlers. There is **one** Lambda per agent — the old two-Lambda layout (thin webhook + runtime) is deprecated.

Read `rules/architecture-runtime-selection.md` for the full Lambda boundary guidance.

## Workflow: Seven Phases

Follow these phases in order. Each phase gates the next — do NOT skip ahead.

## Required Implementation Checklist

Before implementing, copy this checklist into the working todo list and keep it updated. Do NOT mark the agent complete while any required item is still unchecked.

- [ ] Lambda runtime boundaries confirmed and documented
- [ ] Canonical single-Lambda repo layout scaffolded
- [ ] Asana bot user created and PAT captured
- [ ] Chat SDK wired up with `@soofi-xyz/chat-adapter-asana` + `SecretsManagerWebhookSecretStore`
- [ ] Chat SDK state persisted in DynamoDB via `@soofi-xyz/chat-state-dynamodb` + `ChatStateDynamoDbTable`
- [ ] Asana webhook provisioned via `@soofi-xyz/chat-adapter-asana-cdk` (`AsanaChatWebhook`)
- [ ] AgentCore Memory configured behind a `ConversationEventStore` interface (separate from Chat SDK state)
- [ ] Typed multi-intent request contract added when the agent supports multiple asks
- [ ] AI path uses Vercel AI SDK `ToolLoopAgent` with an Amazon Bedrock model, invoked from inside Chat SDK handlers
- [ ] LangSmith facade added before prompt iteration or tool expansion
- [ ] `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, and `LANGSMITH_TRACING` wired correctly
- [ ] All AI entrypoints use the same wrapped LangSmith facade and call `flush()` before returning
- [ ] Deploy-time/user-side setup values are documented explicitly for the human
- [ ] End-to-end verification includes checking LangSmith traces, not just functional output

### Phase 1 — Agent Naming

Pick a Pokémon name from the official Pokédex. The Pokémon's character should resonate with the agent's purpose (e.g., a batch-processing agent could be `machamp`, a solver could be `abra`).

Read `rules/foundation-agent-naming.md`.

### Phase 2 — Purpose & Runtime Boundaries

Define the agent's purpose by answering:

1. **What does the agent do?** (one sentence)
2. **What triggers it?** (Asana task assignment, comment, reaction)
3. **Can every invocation finish within Lambda limits?**
4. **Can all state live outside the runtime?** (Chat SDK state in DynamoDB, AgentCore Memory, S3, Secrets Manager)
5. **What tools does it need?** (API calls, data stores, queues, webhooks)

If the design depends on persistent local filesystem, bash tools, git workflows, or executions longer than Lambda allows, **re-scope the agent**. Break the work into Lambda-friendly turns or move the heavy work into adjacent infrastructure. Do NOT switch this skill to AgentCore.

After deciding, scaffold the repository using the canonical layout.

Read `rules/architecture-runtime-selection.md` and `rules/architecture-rules-agent-layout.md`.

### Phase 3 — Asana Integration via Chat SDK

Every agent MUST use the Chat SDK with `@soofi-xyz/chat-adapter-asana`:

1. **Create a dedicated Asana bot user** for the agent and capture the PAT.
2. **Build the `Chat` instance** with `createAsanaAdapter({ accessToken, workspaceGid, webhookSecretStore: SecretsManagerWebhookSecretStore(...) })`.
3. **Implement the handlers** — `chat.onNewMention` for task assignment, `chat.onSubscribedMessage` for follow-up comments, `chat.onReaction([emoji.check], …)` for completion.
4. **Keep the user input in the task description and put the agent's output in comments** — do not overwrite the original ask with the final answer.
5. **Provision the webhook with `AsanaChatWebhook`** from `@soofi-xyz/chat-adapter-asana-cdk`; it creates the HTTP API, the signing-key secret, and the webhook registration custom resource.
6. **Tell the human exactly how to collect the required Asana values**: `ASANA_PAT` and `ASANA_WORKSPACE_GID`. (`ASANA_BOT_USER_GID` and `ASANA_WEBHOOK_RESOURCE_GIDS` are no longer required — the adapter resolves the bot identity from `/users/me` and the CDK construct registers the webhook against the bot's *My Tasks* user-task-list automatically.)

Do NOT hand-roll the handshake, signature verification, event filtering, dedupe, or retry logic — they all come from Chat SDK + the adapter + the state adapter.

Read `rules/integration-asana-bot-and-webhook.md`.

### Phase 4 — Chat SDK State (DynamoDB)

Provide the Chat SDK with a production-grade state adapter. Lambda-hosted agents MUST use `@soofi-xyz/chat-state-dynamodb`:

- Provision the table via `ChatStateDynamoDbTable` from `@soofi-xyz/chat-state-dynamodb-cdk`.
- Wire `createDynamoDbState({ tableName, region, keyPrefix: '<agent-name>', credentials: fromNodeProviderChain() })` into `new Chat({ ..., state })`.
- Use a unique `keyPrefix` per agent so multiple agents can share the table without mixing subscriptions, locks, or dedupe entries.
- Prefer `onLockConflict: 'force'` for AI agents so long turns do not block newer messages indefinitely.

This adapter handles thread subscriptions, distributed locks (the dedupe mechanism), and TTL-scoped message dedupe. It is **not** the AI conversation history store.

Read `rules/state-chat-sdk-state.md`.

### Phase 5 — AI Logic

Install the Vercel AI SDK skill and use `ToolLoopAgent` with an Amazon Bedrock model inside the Chat SDK handlers:

```bash
npx -y skills add vercel/ai -y
```

- Use `ToolLoopAgent` from `ai` package for tool-calling behavior.
- Model MUST be from Amazon Bedrock and MUST be a model ID or inference profile that is enabled in the target AWS account and region.
- Register tools explicitly — do NOT use dynamic tool discovery.
- When an agent supports multiple question types, use a typed multi-intent request contract and route tools by source instead of coercing every ask into one action.
- Invoke `agent.run(...)` from inside `chat.onNewMention` / `chat.onSubscribedMessage` — not from a second Lambda.

Read `rules/implementation-vercel-ai-tool-loop-agent.md` and `rules/implementation-request-contracts-and-routing.md`.

### Phase 6 — Telemetry

Add LangSmith tracing **before** iterating on prompts or expanding tools. Wrap the AI SDK with LangSmith to get per-turn traces grouped by session (session = `thread.id`).

Required environment variables:
- `LANGSMITH_API_KEY` — stored in Secrets Manager, resolved at runtime.
- `LANGSMITH_PROJECT` — project name for trace grouping.

Read `rules/observability-langsmith-telemetry.md`.

### Phase 7 — AgentCore Memory (AI Conversation History)

Implement conversational memory using **Amazon AgentCore Memory** behind a `ConversationEventStore` interface. This is **separate** from Chat SDK state — Chat SDK state tracks thread subscriptions and locks; AgentCore Memory tracks the AI's conversation history:

- Store conversation events (user/assistant turns, tool calls/results).
- Key memory by `sessionId = thread.id` and `actorId = message.author.platformUserId`.
- Load history inside the Chat SDK handler before running the model; append new events after the reply is posted.
- Use deterministic `clientToken` values (e.g. `${message.id}:${ordinal}`) so duplicate deliveries don't double-write turns.

Read `rules/state-agentcore-memory.md`.

### Phase 8 — Tools, Deploy & Test

1. **Implement tools** — each tool is a typed function with a clear description.
2. **Deploy** — a single CDK stack composes the Lambda, the Chat SDK state table, the AgentCore Memory, and the Asana webhook construct. A single `cdk deploy` is enough — webhook registration is a custom resource, no post-deploy reconcile.
3. **Test end-to-end** — assign an Asana task to the bot, verify the agent responds, check LangSmith traces, and confirm the Asana task state matches the agreed input/output contract.

Read `rules/delivery-tools-deploy-and-test.md`.

## Canonical Repository Layout

### Single-Lambda Asana Agent Layout

```
<agent-name>/
├── apps/
│   └── agent-handler/              # Single Lambda: Chat SDK ingress + AI turn
│       ├── src/
│       │   ├── chat/               # Chat instance bootstrap (adapters, state, handlers)
│       │   ├── agent/              # processAgentTurn — model + tools + memory
│       │   ├── config/             # env.ts — Zod-validated environment
│       │   ├── contracts/          # Request/response Zod schemas
│       │   ├── identity/           # Actor resolution from Chat SDK message.author
│       │   ├── memory/             # ConversationEventStore + AgentCore impl
│       │   ├── observability/      # LangSmith facade + logger
│       │   ├── secrets/            # Secrets Manager lazy loader
│       │   ├── tools/              # Agent tools
│       │   └── handler.ts          # API Gateway proxy → chat.webhooks.asana
│       └── package.json
├── lib/
│   └── <agent-name>-stack.ts       # AsanaChatWebhook + ChatStateDynamoDbTable
│                                   # + Lambda + AgentCore Memory + IAM
├── bin/
│   └── <agent-name>.ts             # CDK app entry
├── scripts/
│   └── invoke-agent.ts             # Local invoke helper
├── pnpm-workspace.yaml
├── cdk.json
└── package.json
```

## Non-Negotiable Principles

1. **Keep the runtime Lambda-friendly.** If the design needs local state, git, bash, or long-lived execution, redesign it before implementing tools.
2. **Use Chat SDK + `@soofi-xyz/chat-adapter-asana` for ingress.** Do NOT hand-roll handshake, signature verification, event filtering, dedupe, or retry logic.
3. **Use `ToolLoopAgent` for tool-calling.** Do NOT hand-roll tool loops.
4. **Persist Chat SDK state in DynamoDB via `@soofi-xyz/chat-state-dynamodb`.** In-memory state is only acceptable in unit tests.
5. **Add LangSmith BEFORE prompt iteration.** You cannot improve what you cannot observe.
6. **Isolate AI conversation history behind `ConversationEventStore`** backed by AgentCore Memory. Keep it separate from Chat SDK state.
7. **Test through real Asana tasks and mentions.** Unit tests alone are insufficient.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Agent Naming | `rules/foundation-agent-naming.md` | HIGH |
| Runtime Selection | `rules/architecture-runtime-selection.md` | CRITICAL |
| Repository Layout | `rules/architecture-rules-agent-layout.md` | HIGH |
| Asana Bot & Webhook (Chat SDK) | `rules/integration-asana-bot-and-webhook.md` | CRITICAL |
| AI SDK & ToolLoopAgent | `rules/implementation-vercel-ai-tool-loop-agent.md` | CRITICAL |
| Request Contracts & Routing | `rules/implementation-request-contracts-and-routing.md` | CRITICAL |
| LangSmith Telemetry | `rules/observability-langsmith-telemetry.md` | CRITICAL |
| Chat SDK State (DynamoDB) | `rules/state-chat-sdk-state.md` | CRITICAL |
| AgentCore Memory (AI History) | `rules/state-agentcore-memory.md` | HIGH |
| Tools, Deploy & Test | `rules/delivery-tools-deploy-and-test.md` | HIGH |
