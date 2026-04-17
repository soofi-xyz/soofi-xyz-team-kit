---
title: Repository Layout
impact: HIGH
tags: [architecture, monorepo, pnpm, cdk, layout]
---

# Repository Layout

Every agent repository MUST follow the canonical monorepo structure from `rules-agent`.

## Monorepo Setup

Use **pnpm workspaces** with TypeScript throughout.

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

## Canonical Lambda Layout

```
<agent-name>/
├── apps/
│   ├── agent-runtime/              # Runtime Lambda
│   │   ├── src/
│   │   │   ├── asana/              # Asana API client (fetch task, post comment)
│   │   │   ├── chat/               # processChatTurn — orchestrates model + tools + memory
│   │   │   ├── config/             # env.ts — Zod-validated environment config
│   │   │   ├── contracts/          # Request/response Zod schemas
│   │   │   ├── identity/           # Actor resolution (actorId from header/body/default)
│   │   │   ├── memory/             # ConversationEventStore interface + AgentCore impl
│   │   │   ├── observability/      # langsmith.ts facade + runtime-logger.ts
│   │   │   ├── secrets/            # Secrets Manager lazy loader
│   │   │   ├── tools/              # Agent-specific tools (each in its own subdirectory)
│   │   │   ├── webhooks/           # processAsanaWebhook — routes webhook events to chat
│   │   │   ├── agent.ts            # Bootstrap: deps → ToolLoopAgent runner
│   │   │   └── handler.ts          # Invocation router: webhook vs chat
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── asana-webhook/              # Thin Lambda for Asana webhook ingress
│       ├── src/
│       │   ├── handler.ts          # Handshake, signature verify, heartbeat, invoke runtime
│       │   └── logger.ts
│       └── tsconfig.json
├── lib/                            # CDK stacks
│   ├── <agent-name>-stack.ts       # Runtime Lambda + AgentCore Memory + IAM
│   └── asana-webhook-stack.ts      # API Gateway + Lambda + Secrets Manager
├── bin/
│   └── <agent-name>.ts             # CDK app entry (loads .env via dotenv)
├── scripts/
│   ├── deploy-agent-runtime.ts     # Deploy orchestration (stack deploy → webhook reconcile)
│   └── invoke-agent-runtime.ts     # Runtime Lambda invoke helper
├── test/                           # CDK synth tests + unit tests
├── .env.example                    # Template for required env vars
├── cdk.json
├── package.json                    # Root: build, test, deploy, invoke scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── tsconfig.json
```

## Key Conventions

- **TypeScript everywhere.** No JavaScript files.
- **Zod for validation.** All external inputs (env, request bodies, webhook payloads) validated with Zod schemas.
- **One tool per subdirectory** under `tools/`. Each tool exports a typed function + tool definition.
- **Config in `config/env.ts`.** Parse `process.env` once at startup with a Zod schema. Never read `process.env` directly in business logic.
- **Secrets lazy-loaded.** Use a `loadSecretString(arn, region)` helper that caches after first fetch.
- **Lambda runtime stays disposable.** Do not depend on local filesystem persistence or shell state between invocations.

## ✅ Correct

```typescript
// config/env.ts — Zod-validated environment
import { z } from 'zod';

const envSchema = z.object({
  AGENTCORE_MEMORY_ID: z.string().min(1),
  BEDROCK_MODEL_ID: z.string().default('us.anthropic.claude-sonnet-4-6'),
  LANGSMITH_PROJECT: z.string().default('my-agent'),
  LANGSMITH_API_KEY_SECRET_ARN: z.string().optional(),
});

export type RuntimeEnv = z.infer<typeof envSchema>;
export function loadEnv(): RuntimeEnv {
  return envSchema.parse(process.env);
}
```

## ❌ Incorrect

```typescript
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
```
