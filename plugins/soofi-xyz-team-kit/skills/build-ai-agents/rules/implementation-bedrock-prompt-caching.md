---
title: Bedrock Prompt Caching
impact: HIGH
tags: [ai-sdk, bedrock, prompt-cache, cost, telemetry]
---

# Bedrock Prompt Caching

Use **Bedrock prompt caching** for every Bedrock-backed `ToolLoopAgent`. Apply cache points through AI SDK language-model middleware so the behavior stays centralized and every agent invocation uses the same policy.

Reference implementation: `rules-agent` commit `d625817` (`feat: prompt modification and caching`).

## Runtime Contract

- Place the helper at `apps/agent-handler/src/agent/bedrock-prompt-cache.ts` next to model bootstrap code.
- Wrap the Bedrock model immediately after `bedrock(modelId)` and before constructing `ToolLoopAgent`.
- Add `providerOptions.bedrock.cachePoint = { type: 'default' }` to the first system message.
- Add the same cache point to the last non-system message in the prompt.
- Preserve existing provider options such as Bedrock reasoning config and LangSmith metadata.
- Overwrite only an existing `bedrock.cachePoint`; do not discard other Bedrock options.
- Do not add cache points to tool definitions or tool configuration unless Bedrock support and pricing are explicitly revalidated.
- Log cache read/write tokens from both generated and streamed responses.
- Merge `BEDROCK_PROMPT_CACHE_METADATA` into LangSmith run metadata.

## Helper Shape

Implement the wrapper with `wrapLanguageModel` from the AI SDK:

```typescript
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { logRuntime } from '../observability/logger.js';

type BedrockLanguageModel = Extract<
  LanguageModel,
  { specificationVersion: 'v3' }
>;
type LanguageModelCallOptions = Parameters<
  BedrockLanguageModel['doGenerate']
>[0];
type BedrockPrompt = LanguageModelCallOptions['prompt'];
type BedrockPromptMessage = BedrockPrompt[number];

const BEDROCK_CACHE_POINT = { type: 'default' as const };

export const BEDROCK_PROMPT_CACHE_METADATA = {
  bedrock_prompt_caching: true,
  bedrock_prompt_cache_strategy: 'system_and_last_non_system',
  bedrock_prompt_cache_ttl: 'default',
  bedrock_prompt_cache_tool_config: false,
} as const;

function withCachePoint(message: BedrockPromptMessage): BedrockPromptMessage {
  const providerOptions = message.providerOptions ?? {};
  const bedrockOptions =
    typeof providerOptions.bedrock === 'object' &&
    providerOptions.bedrock !== null
      ? providerOptions.bedrock
      : {};

  return {
    ...message,
    providerOptions: {
      ...providerOptions,
      bedrock: {
        ...bedrockOptions,
        cachePoint: BEDROCK_CACHE_POINT,
      },
    },
  };
}

export function applyBedrockPromptCaching(prompt: BedrockPrompt): {
  prompt: BedrockPrompt;
  cachePointsAdded: number;
} {
  const targetIndexes = new Set<number>();
  const firstSystemIndex = prompt.findIndex(
    (message) => message.role === 'system',
  );
  if (firstSystemIndex >= 0) {
    targetIndexes.add(firstSystemIndex);
  }

  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    if (prompt[index]?.role !== 'system') {
      targetIndexes.add(index);
      break;
    }
  }

  if (targetIndexes.size === 0) {
    return { prompt, cachePointsAdded: 0 };
  }

  return {
    prompt: prompt.map((message, index) =>
      targetIndexes.has(index) ? withCachePoint(message) : message,
    ),
    cachePointsAdded: targetIndexes.size,
  };
}

function logCacheUsage(
  usage:
    | Awaited<ReturnType<BedrockLanguageModel['doGenerate']>>['usage']
    | undefined,
): void {
  const cacheRead = usage?.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage?.inputTokens.cacheWrite ?? 0;

  if (cacheRead <= 0 && cacheWrite <= 0) {
    return;
  }

  logRuntime({
    level: 'info',
    message: 'Bedrock prompt cache usage.',
    bedrockPromptCacheReadInputTokens: cacheRead,
    bedrockPromptCacheWriteInputTokens: cacheWrite,
  });
}

export function withBedrockPromptCaching(
  model: BedrockLanguageModel,
): BedrockLanguageModel {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: applyBedrockPromptCaching(params.prompt).prompt,
      }),
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        logCacheUsage(result.usage);
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        const stream = result.stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === 'finish') {
                logCacheUsage(chunk.usage);
              }
              controller.enqueue(chunk);
            },
          }),
        );

        return { ...result, stream };
      },
    },
  });
}
```

Adjust only the logger import path to match the repository. Keep the rest of the behavior consistent unless Bedrock provider semantics change.

## Model Bootstrap

Wrap the model once at module/bootstrap scope:

```typescript
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { withBedrockPromptCaching } from './bedrock-prompt-cache.js';

const bedrock = createAmazonBedrock({
  region: env.AWS_REGION,
  credentialProvider: fromNodeProviderChain(),
});

const model = withBedrockPromptCaching(bedrock(env.BEDROCK_MODEL_ID));
```

Pass `model` to `langsmith.ToolLoopAgent`. Do not pass the raw `bedrock(...)` model.

## LangSmith Metadata

Attach cache policy metadata to every traced AI run:

```typescript
import { createLangSmithProviderOptions } from 'langsmith/experimental/vercel';
import { BEDROCK_PROMPT_CACHE_METADATA } from './bedrock-prompt-cache.js';

const langsmithProviderOptions = createLangSmithProviderOptions({
  metadata: {
    ls_provider: 'anthropic',
    ls_model_name: 'claude-sonnet-4-6',
    bedrock_model_id: env.BEDROCK_MODEL_ID,
    ...BEDROCK_PROMPT_CACHE_METADATA,
    session_id: sessionId,
    thread_id: thread.id,
  },
});
```

Use these exact metadata keys so LangSmith queries can compare cached and uncached runs:

| Key | Value |
| --- | --- |
| `bedrock_prompt_caching` | `true` |
| `bedrock_prompt_cache_strategy` | `system_and_last_non_system` |
| `bedrock_prompt_cache_ttl` | `default` |
| `bedrock_prompt_cache_tool_config` | `false` |

## Tests

Add unit coverage for all cache behavior:

- `applyBedrockPromptCaching` marks the first system message and the last non-system message.
- Existing provider options survive and only `bedrock.cachePoint` changes.
- Generated responses log `bedrockPromptCacheReadInputTokens` and `bedrockPromptCacheWriteInputTokens`.
- Streamed responses log cache usage from the `finish` chunk without changing stream chunks.
- `ToolLoopAgent` LangSmith provider options include `BEDROCK_PROMPT_CACHE_METADATA`.

## Correct

```typescript
const rawModel = bedrock(env.BEDROCK_MODEL_ID);
const model = withBedrockPromptCaching(rawModel);

const agent = new langsmith.ToolLoopAgent({
  model,
  tools,
  instructions,
  providerOptions: {
    bedrock: runtimeBedrockOptions,
    langsmith: langsmithProviderOptions,
  },
});
```

## Incorrect

```typescript
// Raw Bedrock model bypasses cache middleware.
const agent = new langsmith.ToolLoopAgent({
  model: bedrock(env.BEDROCK_MODEL_ID),
  tools,
  instructions,
});

// Cache metadata without middleware gives misleading traces.
const langsmithProviderOptions = createLangSmithProviderOptions({
  metadata: { bedrock_prompt_caching: true },
});

// Replacing provider options drops reasoning config and trace metadata.
message.providerOptions = {
  bedrock: { cachePoint: { type: 'default' } },
};
```
