---
title: LangSmith Telemetry
impact: CRITICAL
tags: [langsmith, telemetry, observability, tracing, ai-sdk]
---

# LangSmith Telemetry

Wrap the Vercel AI SDK with **LangSmith** for per-turn traces grouped by session. Add tracing BEFORE iterating on prompts or expanding tools.

Reference implementation: `apps/agent-handler/src/observability/langsmith.ts` in any Pokémon-named runtime agent repo (for example `lucario`).

## Required Environment Variables

| Variable | Source | Description |
| --- | --- | --- |
| `LANGSMITH_API_KEY` | Secrets Manager (ARN passed as `LANGSMITH_API_KEY_SECRET_ARN`) | API key for LangSmith |
| `LANGSMITH_PROJECT` | CDK env var | Project name for trace grouping |
| `LANGSMITH_ENDPOINT` | CDK env var (default: `https://api.smith.langchain.com`) | LangSmith API endpoint |
| `LANGSMITH_TRACING` | CDK env var (default: `true`) | Enable/disable tracing |

The API key is **never** committed to git. CDK creates a Secrets Manager secret when `LANGSMITH_API_KEY` is set in the deploy environment.

## LangSmith Facade Pattern

Create a facade that wraps the AI SDK and provides traced versions of `generateText` and `ToolLoopAgent`:

```typescript
import * as ai from 'ai';
import { Client } from 'langsmith';
import { wrapAISDK } from 'langsmith/experimental/vercel';

export type LangSmithFacade = {
  tracingEnabled: boolean;
  generateText: typeof ai.generateText;
  ToolLoopAgent: typeof ai.ToolLoopAgent;
  flush: () => Promise<void>;
};

export async function createLangSmithFacade(
  env: RuntimeEnv,
): Promise<LangSmithFacade> {
  if (!tracingEnabled(env)) {
    return {
      tracingEnabled: false,
      generateText: ai.generateText,
      ToolLoopAgent: ai.ToolLoopAgent,
      flush: async () => {},
    };
  }

  const key = await resolveApiKey(env);
  if (!key) {
    return {
      tracingEnabled: false,
      generateText: ai.generateText,
      ToolLoopAgent: ai.ToolLoopAgent,
      flush: async () => {},
    };
  }

  // Set process.env for LangSmith SDK
  process.env.LANGSMITH_API_KEY = key;
  process.env.LANGSMITH_ENDPOINT = env.LANGSMITH_ENDPOINT;
  process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
  process.env.LANGSMITH_TRACING = 'true';

  const client = new Client();
  const wrapped = wrapAISDK(ai, { client });

  return {
    tracingEnabled: true,
    generateText: wrapped.generateText,
    ToolLoopAgent: wrapped.ToolLoopAgent ?? ai.ToolLoopAgent,
    flush: () => client.awaitPendingTraceBatches(),
  };
}
```

## Key Rules

1. **Resolve the API key from Secrets Manager at runtime.** Cache after first fetch.
2. **Pass the same `Client` instance** to `wrapAISDK()` and use it for `flush()`.
3. **Call `flush()` before returning** from every invocation. In Lambda/serverless lifecycles, pending trace batches are lost if not flushed.
4. **Group traces by `sessionId`.** LangSmith uses `LANGSMITH_PROJECT` for project-level grouping and the session ID for thread-level grouping.
5. **Graceful degradation.** If the API key is missing or tracing is disabled, return unwrapped AI SDK functions. Never fail an invocation because tracing is unavailable.
6. **Wire every runtime entrypoint through the same facade.** If one invocation path uses raw `ai.ToolLoopAgent`, LangSmith will show only outer wrapper traces for that path.

## Trace Depth Verification

The target shape is an invocation trace with visible child runs for model turns and tool calls.

If LangSmith only shows the top-level handler span, check these first:

1. The runtime actually constructs `langsmith.ToolLoopAgent`, not raw `ToolLoopAgent`.
2. All invocation entrypoints use the same wrapped facade.
3. `flush()` is awaited before returning from the invocation.

Shallow traces are usually an integration bug, not a LangSmith product limitation.

## API Key Resolution

Resolve the key lazily and cache it:

```typescript
let cachedKey: string | undefined;

async function resolveApiKey(env: RuntimeEnv): Promise<string | undefined> {
  if (env.LANGSMITH_API_KEY?.trim()) {
    return env.LANGSMITH_API_KEY.trim();
  }
  const arn = env.LANGSMITH_API_KEY_SECRET_ARN?.trim();
  if (!arn) return undefined;

  if (cachedKey) return cachedKey;

  const value = await loadSecretString(arn, region);
  if (value) cachedKey = value;
  return cachedKey;
}
```

## CDK Configuration

The CDK stack hardcodes non-secret LangSmith settings and passes the API key secret ARN:

```typescript
// In the CDK stack
const langsmithSecret = new secretsmanager.Secret(this, 'LangSmithApiKey', {
  secretStringValue: cdk.SecretValue.unsafePlainText(
    process.env.LANGSMITH_API_KEY!,
  ),
});

// Pass to runtime as env vars
runtimeEnvVars: {
  LANGSMITH_TRACING: 'true',
  LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
  LANGSMITH_PROJECT: '<agent-name>',
  LANGSMITH_API_KEY_SECRET_ARN: langsmithSecret.secretArn,
}
```

## ✅ Correct

```typescript
// Create facade at bootstrap, use throughout
const langsmith = await createLangSmithFacade(env);
const agent = new langsmith.ToolLoopAgent({ model, tools, system });
const result = await agent.run(prompt);
await langsmith.flush(); // Always flush before returning
```

## ❌ Incorrect

```typescript
// ❌ Hardcoded API key
process.env.LANGSMITH_API_KEY = 'lsv2_abc123...';

// ❌ Forgetting to flush
const result = await agent.run(prompt);
return result; // ❌ Traces lost in Lambda/serverless runtimes

// ❌ Failing the invocation when tracing is unavailable
if (!langsmithKey) throw new Error('LangSmith not configured'); // ❌
```
