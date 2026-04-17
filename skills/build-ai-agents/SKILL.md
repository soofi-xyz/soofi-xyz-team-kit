---
name: build-ai-agents
description: "Guides creation of AI agents using the rules-agent pattern. Covers Lambda-first agent runtime design, Asana integration, task description/output contracts, webhook dedupe and retry control, Vercel AI SDK ToolLoopAgent on Bedrock, multi-intent request routing, LangSmith telemetry, AgentCore-backed conversation memory, tools, deployment, and testing. Triggers on: ai agent, build agent, lambda agent, asana bot, webhook agent, tool loop agent, langsmith agent, agent memory, bedrock agent, agentcore memory."
---

# Building AI Agents

Step-by-step guide for designing and deploying AI agents in this ecosystem. Follow the **ovid-agent / rules-agent** reference implementation.

## Architecture: Lambda Runtime Only

This skill standardizes on **AWS Lambda** for agent runtime. Do not use AgentCore for agents built from this skill.

Read `rules/architecture-runtime-selection.md` for the full Lambda boundary guidance.

## Workflow: Seven Phases

Follow these phases in order. Each phase gates the next — do NOT skip ahead.

## Required Implementation Checklist

Before implementing, copy this checklist into the working todo list and keep it updated. Do NOT mark the agent complete while any required item is still unchecked.

- [ ] Lambda runtime boundaries confirmed and documented
- [ ] Canonical Lambda repo layout scaffolded
- [ ] Asana bot user, webhook, dedupe, and retry control implemented
- [ ] Typed multi-intent request contract added when the agent supports multiple asks
- [ ] AI path uses Vercel AI SDK with an Amazon Bedrock model
- [ ] LangSmith facade added before prompt iteration or tool expansion
- [ ] `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, and `LANGSMITH_TRACING` wired correctly
- [ ] All AI entrypoints use the same wrapped LangSmith facade and call `flush()` before returning
- [ ] Deploy-time/user-side setup values are documented explicitly for the human
- [ ] End-to-end verification includes checking LangSmith traces, not just functional output

### Phase 1 — Agent Naming

Pick a name from Roman/Greek poets, philosophers, or other significant historical figures. The name MUST be meaningful — choose a figure whose legacy resonates with the agent's purpose.

Read `rules/foundation-agent-naming.md`.

### Phase 2 — Purpose & Runtime Boundaries

Define the agent's purpose by answering:

1. **What does the agent do?** (one sentence)
2. **What triggers it?** (Asana task assignment, comment mention, scheduled event)
3. **Can every invocation finish within Lambda limits?**
4. **Can all state live outside the runtime?** (AgentCore Memory, DynamoDB, S3, Secrets Manager)
5. **What tools does it need?** (API calls, data stores, queues, webhooks)

If the design depends on persistent local filesystem, bash tools, git workflows, or executions longer than Lambda allows, **re-scope the agent**. Break the work into Lambda-friendly turns or move the heavy work into adjacent infrastructure. Do NOT switch this skill to AgentCore.

After deciding, scaffold the repository using the canonical layout.

Read `rules/architecture-runtime-selection.md` and `rules/architecture-rules-agent-layout.md`.

### Phase 3 — Asana Integration

Every agent MUST have Asana integration:

1. **Create a dedicated Asana bot user** for the agent.
2. **Implement the Asana webhook** — handshake, signature verification, heartbeats, event filtering, and runtime invocation.
3. **Keep the user input in the task description and put the agent's output in comments** — do not overwrite the original ask with the final answer.
4. **Create linked review tasks for completion handoff** instead of relying on tags or mentions as the completion notification.
5. **Configure webhook registration, dedupe, and retry control** in the deploy pipeline.
6. **At the end of setup, tell the human exactly how to collect the required Asana values**: `ASANA_PAT`, `ASANA_BOT_USER_GID`, `ASANA_WORKSPACE_GID`, and `ASANA_WEBHOOK_RESOURCE_GIDS`.

Read `rules/integration-asana-bot-and-webhook.md`.

### Phase 4 — AI Logic

Install the Vercel AI SDK skill and use `ToolLoopAgent` with an Amazon Bedrock model:

```bash
npx -y skills add vercel/ai -y
```

- Use `ToolLoopAgent` from `ai` package for tool-calling behavior.
- Model MUST be from Amazon Bedrock and MUST be a model ID or inference profile that is enabled in the target AWS account and region.
- Register tools explicitly — do NOT use dynamic tool discovery.
- When an agent supports multiple question types, use a typed multi-intent request contract and route tools by source instead of coercing every ask into one action.

Read `rules/implementation-vercel-ai-tool-loop-agent.md` and `rules/implementation-request-contracts-and-routing.md`.

### Phase 5 — Telemetry

Add LangSmith tracing **before** iterating on prompts or expanding tools. Wrap the AI SDK with LangSmith to get per-turn traces grouped by session.

Required environment variables:
- `LANGSMITH_API_KEY` — stored in Secrets Manager, resolved at runtime.
- `LANGSMITH_PROJECT` — project name for trace grouping.

Read `rules/observability-langsmith-telemetry.md`.

### Phase 6 — Memory

Implement conversational memory using **Amazon AgentCore Memory** behind a module boundary:

- Store conversation events (user/assistant turns, tool calls/results).
- Key memory by `sessionId` and `actorId`.
- Load history on each invocation, append new events after processing.

Read `rules/state-agentcore-memory.md`.

### Phase 7 — Tools, Deploy & Test

1. **Implement tools** — each tool is a typed function with a clear description.
2. **Deploy** — use CDK stacks for infrastructure, pnpm for orchestration.
3. **Test end-to-end** — assign an Asana task to the bot, verify the agent responds, check LangSmith traces, and confirm the Asana task state matches the agreed input/output contract.

Read `rules/delivery-tools-deploy-and-test.md`.

## Canonical Repository Layout

### Lambda-Based Asana Agent Layout

```
<agent-name>/
├── apps/
│   ├── agent-runtime/
│   │   ├── src/
│   │   │   ├── asana/           # Asana API client
│   │   │   ├── chat/            # Chat turn orchestration
│   │   │   ├── config/          # Environment config + validation
│   │   │   ├── contracts/       # Request/response schemas
│   │   │   ├── identity/        # Actor resolution
│   │   │   ├── memory/          # AgentCore Memory event store
│   │   │   ├── observability/   # LangSmith facade + logger
│   │   │   ├── secrets/         # Secrets Manager helpers
│   │   │   ├── tools/           # Agent tools
│   │   │   ├── webhooks/        # Webhook event processing
│   │   │   └── handler.ts       # Runtime Lambda entry
│   │   └── package.json
│   └── asana-webhook/
│       └── src/
│           ├── handler.ts       # Webhook Lambda handler
│           └── logger.ts
├── lib/
│   ├── <agent-name>-stack.ts         # Runtime Lambda + AgentCore Memory + IAM
│   └── asana-webhook-stack.ts        # Webhook endpoint CDK
├── bin/
│   └── <agent-name>.ts               # CDK app entry
├── scripts/
│   ├── deploy-agent-runtime.ts
│   └── invoke-agent-runtime.ts
├── pnpm-workspace.yaml
├── cdk.json
└── package.json
```

## Non-Negotiable Principles

1. **Keep the runtime Lambda-friendly.** If the design needs local state, git, bash, or long-lived execution, redesign it before implementing tools.
2. **Keep the Asana webhook thin.** It validates, filters, and invokes — nothing else.
3. **Use `ToolLoopAgent` for tool-calling.** Do NOT hand-roll tool loops.
4. **Add LangSmith BEFORE prompt iteration.** You cannot improve what you cannot observe.
5. **Isolate memory behind a module boundary.** The chat layer calls a `ConversationEventStore` interface, not raw AWS SDK.
6. **Test through real Asana tasks and mentions.** Unit tests alone are insufficient.
7. **Prevent duplicate Asana execution.** Durable webhook dedupe and explicit retry control are mandatory for task-triggered agents.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Agent Naming | `rules/foundation-agent-naming.md` | HIGH |
| Runtime Selection | `rules/architecture-runtime-selection.md` | CRITICAL |
| Repository Layout | `rules/architecture-rules-agent-layout.md` | HIGH |
| Asana Bot & Webhook | `rules/integration-asana-bot-and-webhook.md` | CRITICAL |
| AI SDK & ToolLoopAgent | `rules/implementation-vercel-ai-tool-loop-agent.md` | CRITICAL |
| Request Contracts & Routing | `rules/implementation-request-contracts-and-routing.md` | CRITICAL |
| LangSmith Telemetry | `rules/observability-langsmith-telemetry.md` | CRITICAL |
| Conversation Memory | `rules/state-agentcore-memory.md` | HIGH |
| Tools, Deploy & Test | `rules/delivery-tools-deploy-and-test.md` | HIGH |
