---
title: Lambda Runtime Boundaries
impact: CRITICAL
tags: [architecture, lambda, runtime, decision, chat-sdk]
---

# Lambda Runtime Boundaries

This skill supports **AWS Lambda only** for agent runtime. The Lambda hosts the Chat SDK (with `@soofi-xyz/chat-adapter-asana`) and runs the AI turn inside Chat SDK handlers. Do not use AgentCore as the runtime for agents built from this skill.

Validate the design against Lambda constraints **before** writing agent code.

## Boundary Check

Ask these questions in order:

1. **Can every invocation finish within Lambda limits?**
   - No → re-scope the workflow into smaller turns, or move long-running work to Step Functions / batch infrastructure outside the agent runtime.
2. **Can all state live outside the runtime?** (DynamoDB via `@soofi-xyz/chat-state-dynamodb`, AgentCore Memory, S3, Secrets Manager, queues)
   - No → redesign the state model. Lambda runtimes must be disposable.
3. **Are the tools API/store based rather than local shell/git workflows?**
   - No → move shell/git work into a separate automation system. Do not add bash-driven repo workflows to the agent runtime.
4. **Can retries and duplicate deliveries be tolerated idempotently?**
   - Yes, by default. Chat SDK's distributed locking via the DynamoDB state adapter dedupes duplicate Asana deliveries per-thread. AgentCore Memory writes use deterministic `clientToken` values keyed off `message.id`. Ensure any custom tool writes are idempotent too.

If all four answers are acceptable, the design fits this skill.

## What Lambda + Chat SDK Gives You

- **One Lambda** that handles Asana webhook ingress AND the AI turn.
- **Chat SDK as the webhook front-door** — handshake, signature verification, event routing to `onNewMention` / `onSubscribedMessage` / `onReaction`, and per-thread distributed locking are handled by `@soofi-xyz/chat-adapter-asana` + the state adapter. No hand-rolled webhook code.
- **External state** for Chat SDK (DynamoDB via `@soofi-xyz/chat-state-dynamodb`) and for AI conversation history (AgentCore Memory), plus S3 / Secrets Manager for artifacts and secrets.
- **Fast deploys and simpler operations** than containerised runtime approaches, and no secondary Lambda hop.

## Recommended Adaptations

- Need chat history: store typed conversation events in AgentCore Memory behind a `ConversationEventStore` interface. Do NOT use the Chat SDK state adapter for AI history.
- Need durable thread subscriptions, distributed locks, or dedupe: use `@soofi-xyz/chat-state-dynamodb` via the Chat SDK state adapter.
- Need large artifacts: write them to S3 and pass references through the agent.
- Need expensive preprocessing: run it before the agent turn or hand off to Step Functions.
- Need repo automation or bash: treat that as a separate automation service, not part of the Lambda agent runtime.
- Long AI turns that risk holding the Chat SDK thread lock past `DEFAULT_LOCK_TTL_MS` (30s): keep turns short, or set `onLockConflict: 'force'` so a newer message can re-acquire the lock.

## Bootstrap Pattern

```typescript
import { Chat, emoji } from 'chat';
import { createAsanaAdapter } from '@soofi-xyz/chat-adapter-asana';
import { createDynamoDbState } from '@soofi-xyz/chat-state-dynamodb';
import { ToolLoopAgent } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

const asana = createAsanaAdapter({ /* ... */ });
const state = createDynamoDbState({ /* ... */ });
const chat = new Chat({
  userName: 'my-agent-bot',
  adapters: { asana },
  state,
  onLockConflict: 'force',
});

chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  const reply = await runAgentTurn({ thread, message });
  await thread.post({ markdown: reply });
});

export const handler = asanaLambdaHandler(chat);
```

## ✅ Correct

```
Q: The agent answers Asana requests using APIs and managed data stores.
A: Chat SDK ingress + external state + API tools + short turns → Lambda ✅

Q: The agent needs conversation history across invocations.
A: Store history in AgentCore Memory; keep Chat SDK state in DynamoDB ✅
```

## ❌ Incorrect

```
# Using the runtime for git/bash workflows
export const handler = async () => {
  execSync('git clone ...'); // ❌ Not a Lambda-friendly agent tool path
};

# Solving >15 minute work by switching to AgentCore
// ❌ Re-scope the workflow instead of changing the runtime model

# Splitting into two Lambdas (thin webhook + runtime invoke) just to
# "keep the webhook thin" — Chat SDK already keeps ingress thin.
```
