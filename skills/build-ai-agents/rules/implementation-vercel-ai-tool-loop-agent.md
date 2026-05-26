---
title: AI SDK & ToolLoopAgent
impact: CRITICAL
tags: [ai-sdk, vercel, tool-loop-agent, bedrock, model, tools, prompt-cache]
---

# AI SDK & ToolLoopAgent

Use the **Vercel AI SDK** with `ToolLoopAgent` for all agent AI logic. Models MUST come from **Amazon Bedrock**.

## Setup

Install the AI SDK skill first:

```bash
npx -y skills add vercel/ai -y
```

Reference: [ToolLoopAgent API](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent#toolloopagent).

### Dependencies

```json
{
  "ai": "latest",
  "@ai-sdk/amazon-bedrock": "latest",
  "@aws-sdk/credential-providers": "latest"
}
```

## Model Selection

Use Amazon Bedrock models only. Create the provider with explicit region and credential chain:

```typescript
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { withBedrockPromptCaching } from './bedrock-prompt-cache.js';

const bedrock = createAmazonBedrock({
  region: 'us-east-2',
  credentialProvider: fromNodeProviderChain(),
});

const model = withBedrockPromptCaching(
  bedrock('us.anthropic.claude-sonnet-4-6'),
);
```

Do NOT hardcode credentials. Use the AWS credential provider chain.
Do NOT pass a raw Bedrock model into `ToolLoopAgent`; wrap it with `withBedrockPromptCaching` first.

### Bedrock Model IDs

Do NOT assume a short alias or unqualified model name will work in every account.

- Use a regional model ID or inference profile ARN that is enabled in the target account and region.
- Verify on-demand support before standardizing on a model string.
- If the account requires inference profiles, use the inference profile ID/ARN instead of the raw model name.

Example failure mode:

```text
Invocation of model ID anthropic.claude-sonnet-4-6 with on-demand throughput is not supported.
```

Treat this as a configuration issue, not an agent-logic issue.

## ToolLoopAgent

Use `ToolLoopAgent` for tool-calling behavior. It manages the tool call → result → model loop automatically.

```typescript
import { ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  model,
  tools: {
    lookupPrimaryRecord: lookupPrimaryRecordTool,
    fetchReferenceData: fetchReferenceDataTool,
    updateTaskOutput: updateTaskOutputTool,
  },
  system: 'You are a helpful agent that...',
});

const result = await agent.run('Inspect the requested record and summarize the result.');
```

### Invocation from Chat SDK handlers

Invoke `ToolLoopAgent` inside the Chat SDK event handlers — not from a second Lambda. The handler receives `thread` + `message` from `@soofi-xyz/chat-adapter-asana`, loads conversation history from `ConversationEventStore` (AgentCore Memory), runs the agent, posts the reply, and appends the new turn:

```typescript
chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await runChatTurn({ thread, message, kind: 'task_description' });
});

chat.onSubscribedMessage(async (thread, message) => {
  // 👀 ack so the human sees the bot is working during the long AI turn.
  await asana.addReaction(thread.id, message.id, emoji.eyes);
  await runChatTurn({ thread, message, kind: 'comment' });
});

async function runChatTurn({ thread, message, kind }: ChatTurnInput) {
  const sessionId = thread.id;
  const actorId = message.author.platformUserId ?? 'unknown';

  const history = await conversationStore.loadSessionEvents(sessionId, actorId);

  const prompt = buildPrompt({ history, message, kind });

  const result = await agent.run(prompt);

  await thread.post({ markdown: result.text });

  await conversationStore.appendEvents(
    sessionId,
    actorId,
    toConversationEvents(message, result),
    { clientTokenFor: (_event, ordinal) => `${message.id}:${ordinal}` },
  );
}
```

Keep the `Chat` instance, the `ToolLoopAgent`, and the `ConversationEventStore` at module scope so containers reuse them across invocations. Do NOT reconstruct them inside the handler.

### Key Rules

1. **Register tools explicitly.** Pass a typed tools object — do NOT dynamically discover tools at runtime.
2. **Set a system prompt.** Define the agent's role and boundaries clearly.
3. **Use `ToolLoopAgent`, not `generateText` with manual loops.** The agent handles retries, tool errors, and loop termination.
4. **Limit tool iterations** if needed — pass `maxIterations` to prevent runaway loops.
5. **Wrap Bedrock models with prompt caching.** Use `withBedrockPromptCaching` from `rules/implementation-bedrock-prompt-caching.md`.
6. **Use typed request contracts for multi-capability agents.** Route tools by intent and source instead of forcing every ask through one fallback flow.
7. **Keep tools Lambda-friendly.** Prefer API and data-store tools; do not design around local bash or git workflows inside the runtime.

## Tool Definition

Define each tool with a clear description and Zod parameter schema:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const readFileTool = tool({
  description: 'Read the contents of a file at the given path.',
  parameters: z.object({
    path: z.string().describe('Absolute file path to read'),
  }),
  execute: async ({ path }) => {
    const content = await fs.readFile(path, 'utf8');
    return content;
  },
});
```

### Tool Design Rules

- **One purpose per tool.** Do NOT create multi-function tools.
- **Descriptions matter.** The model uses them to decide when to call the tool.
- **Validate parameters with Zod.** The AI SDK enforces the schema automatically.
- **Return strings or structured data.** The model processes the result as context.
- **Handle errors gracefully.** Return error messages as strings — do NOT throw unless truly fatal.

## Wrapping with LangSmith

When LangSmith tracing is enabled, use the wrapped versions of `ToolLoopAgent` and `generateText` from the LangSmith facade:

```typescript
const langsmith = await createLangSmithFacade(env);

// Use langsmith.ToolLoopAgent instead of ai.ToolLoopAgent
const agent = new langsmith.ToolLoopAgent({
  model,
  tools,
  system,
});
```

See `rules/observability-langsmith-telemetry.md` for the full facade pattern.

## ✅ Correct

```typescript
// Typed tools, explicit registration, ToolLoopAgent
const agent = new langsmith.ToolLoopAgent({
  model: withBedrockPromptCaching(
    bedrock('us.anthropic.claude-sonnet-4-6'),
  ),
  tools: { lookupPrimaryRecord, listAvailableAssets, updateTaskOutput },
  system: 'You are the Seneca agent. You inspect requests and return concise task updates.',
});
```

## ❌ Incorrect

```typescript
// ❌ Manual tool loop
let response = await generateText({ model, prompt });
while (response.toolCalls.length > 0) {
  // Hand-rolling what ToolLoopAgent does for you
}

// ❌ Non-Bedrock model
const model = openai('gpt-4o'); // ❌ Must use Bedrock

// ❌ Unsupported or stale Bedrock model ID
const model = bedrock('anthropic.claude-sonnet-4-6'); // ❌ Verify regional ID or inference profile

// ❌ Raw Bedrock model, no prompt-cache middleware
const agent = new ToolLoopAgent({ model: bedrock(modelId), tools, system });

// ❌ Dynamic tool discovery
const tools = await discoverTools(); // ❌ Tools must be explicit

// ❌ Lambda runtime depending on shell/git tools
const tools = { bash, gitStatus, gitCommit }; // ❌ Keep runtime API-first
```
