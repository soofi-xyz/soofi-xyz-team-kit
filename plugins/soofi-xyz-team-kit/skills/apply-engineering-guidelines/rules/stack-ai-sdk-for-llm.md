---
title: AI SDK for All LLM Interactions
impact: CRITICAL
tags: ai, llm, ai-sdk, vercel, typescript, openai, anthropic, bedrock, agents
---

## AI SDK for All LLM Interactions

**All LLM interactions MUST use the [Vercel AI SDK](https://ai-sdk.dev/) (`ai` package) with strict TypeScript.** Do NOT use provider-specific SDKs (e.g., `openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`) directly to call LLMs. The AI SDK is the only permitted abstraction for LLM calls.

### Why

- Provides a unified, provider-agnostic API — switching models requires changing one line.
- Built-in TypeScript types for prompts, tool definitions, streaming, and structured output.
- First-class support for tool calling, multi-step agents, and structured output via Zod schemas.
- Consistent telemetry and observability hooks across all providers.

### Standards

- Install the `ai` core package and the appropriate provider package (e.g., `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/amazon-bedrock`).
- Use `generateText` for single-turn completions, `streamText` for streaming, `generateObject` for structured output.
- Define all tool input schemas with **Zod** — never use raw JSON schemas or untyped objects.
- Enable **strict mode** on tools when the provider supports it (`strict: true`).
- All LLM-calling code MUST be in TypeScript with strict type checking enabled (`"strict": true` in `tsconfig.json`).
- Use the `ToolLoopAgent` class for multi-step agentic flows — do NOT hand-roll tool loops.

### ✅ Correct

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { tool } from 'ai';

const weatherTool = tool({
  description: 'Get the weather for a location',
  parameters: z.object({
    city: z.string().describe('The city name'),
  }),
  execute: async ({ city }) => {
    // call weather API
    return { temperature: 72, condition: 'sunny' };
  },
});

const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: 'What is the weather in London?',
  tools: { weather: weatherTool },
});
```

```typescript
// Structured output with Zod schema
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const { object } = await generateObject({
  model: anthropic('claude-sonnet-4-20250514'),
  schema: z.object({
    summary: z.string(),
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number().min(0).max(1),
  }),
  prompt: 'Analyze the sentiment of: "I love this product!"',
});
```

### ❌ Incorrect

```typescript
// Using the OpenAI SDK directly — FORBIDDEN
import OpenAI from 'openai';

const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

```typescript
// Using AWS Bedrock SDK directly — FORBIDDEN
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({});
const response = await client.send(new InvokeModelCommand({ /* ... */ }));
```

```javascript
// Plain JavaScript without types — FORBIDDEN
const { generateText } = require('ai');
```

```typescript
// Untyped tool parameters — FORBIDDEN
const myTool = {
  description: 'Do something',
  parameters: { type: 'object', properties: { input: { type: 'string' } } },
  execute: async (args: any) => { /* ... */ },
};
```

### References

- [AI SDK Documentation](https://ai-sdk.dev/)
- [AI SDK Core — generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
- [AI SDK Core — streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK Core — generateObject](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object)
- [AI SDK Core — tool](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool)
- [AI SDK Core — ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [AI SDK Providers](https://ai-sdk.dev/docs/foundations/providers-and-models)
