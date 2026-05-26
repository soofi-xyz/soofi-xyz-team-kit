---
title: Repository Layout
impact: HIGH
tags: [architecture, monorepo, pnpm, cdk, layout, chat-sdk]
---

# Repository Layout

Every agent repository MUST follow the canonical monorepo structure below. The layout is organised around a **single agent Lambda** that hosts the Chat SDK — the old two-Lambda pattern (runtime + separate `asana-webhook`) is deprecated. Chat SDK + `@soofi-xyz/chat-adapter-asana` handle ingress; the same Lambda runs the AI turn.

## Monorepo Setup

Use **pnpm workspaces** with TypeScript throughout.

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

## Canonical Single-Lambda Layout

```
<agent-name>/
├── apps/
│   └── agent-handler/              # Single Lambda: Chat SDK ingress + AI turn
│       ├── src/
│       │   ├── chat/               # Chat instance bootstrap (adapters, state, handlers)
│       │   ├── agent/              # processAgentTurn — model + prompt cache + tools + memory orchestration
│       │   ├── config/             # env.ts — Zod-validated environment config
│       │   ├── contracts/          # Request/response Zod schemas
│       │   ├── identity/           # Actor resolution from Chat SDK message.author
│       │   ├── memory/             # ConversationEventStore interface + AgentCore impl
│       │   ├── observability/      # langsmith.ts facade + logger
│       │   ├── secrets/            # Secrets Manager lazy loader
│       │   ├── tools/              # Agent-specific tools (each in its own subdirectory)
│       │   └── handler.ts          # API Gateway proxy → chat.webhooks.asana(request)
│       ├── package.json
│       └── tsconfig.json
├── lib/                            # CDK stacks
│   └── <agent-name>-stack.ts       # AsanaChatWebhook + ChatStateDynamoDbTable
│                                   # + Lambda + AgentCore Memory + IAM + LangSmith secret
├── bin/
│   └── <agent-name>.ts             # CDK app entry (loads .env via dotenv)
├── scripts/
│   └── invoke-agent.ts             # Local invoke helper for dev/debug
├── test/                           # CDK synth tests + unit tests
├── .env.example                    # Template for required env vars
├── cdk.json
├── package.json                    # Root: build, test, deploy, invoke scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── tsconfig.json
```

## What the layout deliberately omits

- **No `apps/asana-webhook/`** — the `AsanaChatWebhook` CDK construct wires API Gateway directly to the agent handler, and Chat SDK handles handshake + signature verification inside the same Lambda.
- **No `scripts/deploy-agent-runtime.ts`** that reconciles Asana webhooks — webhook registration is a CDK custom resource owned by `AsanaChatWebhook`. A single `cdk deploy` is enough.
- **No `dedupe/` module** with a DynamoDB claim store — distributed locking and dedupe are handled by the Chat SDK state adapter (`@soofi-xyz/chat-state-dynamodb`).

## Key Conventions

- **TypeScript everywhere.** No JavaScript files.
- **Zod for validation.** All external inputs (env, request bodies, adapter webhook payloads surfaced through `message.raw`) validated with Zod schemas.
- **One tool per subdirectory** under `tools/`. Each tool exports a typed function + tool definition.
- **Config in `config/env.ts`.** Parse `process.env` once at startup with a Zod schema. Never read `process.env` directly in business logic.
- **Secrets lazy-loaded.** Use a `loadSecretString(arn, region)` helper that caches after first fetch.
- **Lambda runtime stays disposable.** Do not depend on local filesystem persistence or shell state between invocations.
- **Chat SDK instance at module scope.** Construct `Chat` once per Lambda container; wiring it per-invocation breaks the state adapter's connection caching.

## ✅ Correct

```typescript
// config/env.ts — Zod-validated environment
import { z } from 'zod';

const envSchema = z.object({
  ASANA_WORKSPACE_GID: z.string().min(1),
  ASANA_WEBHOOK_SECRET_ARN: z.string().min(1),
  CHAT_STATE_TABLE_NAME: z.string().min(1),
  CHAT_STATE_KEY_PREFIX: z.string().default('chat-sdk'),
  AGENTCORE_MEMORY_ID: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().default('us.anthropic.claude-sonnet-4-6'),
  LANGSMITH_PROJECT: z.string().default('pikachu-agent'),
  LANGSMITH_API_KEY_SECRET_ARN: z.string().optional(),
});

export type RuntimeEnv = z.infer<typeof envSchema>;
export function loadEnv(): RuntimeEnv {
  return envSchema.parse(process.env);
}
```

## ❌ Incorrect

```typescript
// ❌ Two-Lambda architecture (webhook + runtime) — deprecated.
apps/
  agent-runtime/
  asana-webhook/

// ❌ Reading process.env inline in business logic
const modelId = process.env.BEDROCK_MODEL_ID || 'some-default';

// ❌ Flat src/ with everything in one directory
src/
  handler.ts
  asana.ts
  memory.ts
  langsmith.ts
  tool1.ts
  tool2.ts

// ❌ Creating a new Chat instance inside the handler function
export const handler = async (event) => {
  const chat = new Chat({ ... }); // ❌ construct once at module scope
};
```
