---
title: AgentCore Memory (AI Conversation History)
impact: HIGH
tags: [memory, agentcore, state, session, conversation, events]
---

# AgentCore Memory (AI Conversation History)

Implement conversational memory for the AI agent using **Amazon AgentCore Memory** as the backing store. This is the history of turns that the model sees — user asks, assistant replies, tool calls, tool results — and it is distinct from the Chat SDK state adapter.

Keep the boundary explicit:

- **Chat SDK state** (`@soofi-xyz/chat-state-dynamodb`) owns thread subscriptions, distributed locks, webhook dedupe, and caching. See `rules/state-chat-sdk-state.md`.
- **AgentCore Memory** owns the AI's conversation history, keyed by session and actor.

Do NOT conflate the two. Do NOT store AI turns in the Chat SDK state adapter, and do NOT try to resolve thread subscriptions through AgentCore Memory.

## Architecture

```
ConversationEventStore (interface)
├── AgentCoreConversationEventStore  (production — stores events in AgentCore Memory)
└── NoopConversationEventStore       (fallback — returns empty, stores nothing)
```

The chat layer calls the `ConversationEventStore` interface — it never imports the AWS SDK directly. The store is invoked from inside the Chat SDK handlers (`onNewMention`, `onSubscribedMessage`) to load history before running the model and to append new turns after the reply is posted.

## Interface

```typescript
export type AppendEventsOptions = {
  clientTokenFor: (event: ConversationEvent, ordinal: number) => string;
};

export interface ConversationEventStore {
  loadSessionEvents(
    sessionId: string,
    actorId: string,
  ): Promise<ConversationEvent[]>;

  appendEvents(
    sessionId: string,
    actorId: string,
    events: ConversationEvent[],
    options: AppendEventsOptions,
  ): Promise<void>;
}
```

## AgentCore Implementation

Use `@aws-sdk/client-bedrock-agentcore` to query recent events and append new ones:

```typescript
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

export class AgentCoreConversationEventStore implements ConversationEventStore {
  private readonly client: BedrockAgentCoreClient;
  private readonly memoryId: string;
  private readonly historyLimit: number;

  async loadSessionEvents(
    sessionId: string,
    actorId: string,
  ): Promise<ConversationEvent[]> {
    const collected: ConversationEvent[] = [];
    let nextToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListEventsCommand({
          memoryId: this.memoryId,
          sessionId,
          actorId,
          includePayloads: true,
          maxResults: Math.min(100, this.historyLimit),
          nextToken,
        }),
      );

      for (const ev of page.events ?? []) {
        const decoded = decodeEvent(ev);
        if (decoded) collected.push(decoded);
      }

      nextToken = page.nextToken;
      if (collected.length >= this.historyLimit) break;
    } while (nextToken);

    return sortEventsByTime(collected).slice(-this.historyLimit);
  }

  async appendEvents(
    sessionId: string,
    actorId: string,
    events: ConversationEvent[],
    options: AppendEventsOptions,
  ): Promise<void> {
    let ordinal = 0;
    for (const event of events) {
      const { payload, metadata } = encodeEventToPayloads(
        event,
        sessionId,
        actorId,
      );

      await this.client.send(
        new CreateEventCommand({
          memoryId: this.memoryId,
          actorId,
          sessionId,
          eventTimestamp: new Date(event.at),
          payload,
          metadata,
          clientToken: options.clientTokenFor(event, ordinal),
        }),
      );
      ordinal += 1;
    }
  }
}
```

## Session / actor keys from Chat SDK

Derive `sessionId` and `actorId` from the Chat SDK `thread` and `message` objects inside the handler:

```typescript
chat.onNewMention(async (thread, message) => {
  await thread.subscribe();

  const sessionId = thread.id;                 // e.g. Asana task GID
  const actorId = message.author.platformUserId ?? 'unknown';

  const history = await conversationStore.loadSessionEvents(sessionId, actorId);
  const reply = await runAgentTurn({ history, userMessage: message });

  await thread.post({ markdown: reply.text });

  await conversationStore.appendEvents(
    sessionId,
    actorId,
    [
      { kind: 'user', at: message.createdAt, text: message.text ?? '' },
      ...reply.events,
    ],
    { clientTokenFor: (_event, ordinal) => `${message.id}:${ordinal}` },
  );
});
```

Use a deterministic `clientToken` (`${messageId}:${ordinal}`) so a retried Chat SDK handler — or a delivery that slipped through the Chat SDK state adapter's lock — does not double-write the same turn.

## Key Rules

1. **Always implement the `Noop` fallback.** If `AGENTCORE_MEMORY_ID` is not set, use `NoopConversationEventStore`. Never fail because memory is unconfigured.
2. **Paginate `ListEventsCommand`.** AgentCore Memory is paginated; always honour `nextToken`.
3. **Enforce a history limit.** Load at most `CHAT_HISTORY_EVENT_LIMIT` events (default: 200).
4. **Use deterministic `clientToken` values.** Writes must be safe across retries and duplicate deliveries. Derive from the Chat SDK `message.id` plus an ordinal.
5. **Encode/decode events.** Keep a codec module to serialize conversation events into AgentCore payloads.
6. **Keep memory external.** Lambda process memory is not durable and must not be treated as conversation history.
7. **Do NOT reuse the Chat SDK state adapter for AI history.** Keep the two storage layers separate.

## CDK Configuration

```typescript
const memory = new agentcore.CfnMemory(this, 'AgentMemory', {
  name: `${agentName}Memory`,
  eventExpiryDuration: 90,
});

handler.addEnvironment('AGENTCORE_MEMORY_ID', memory.attrMemoryId);
handler.addEnvironment('CHAT_HISTORY_EVENT_LIMIT', '200');

handler.role?.addToPrincipalPolicy(new iam.PolicyStatement({
  actions: [
    'bedrock:CreateEvent',
    'bedrock:ListEvents',
    'bedrock:GetMemory',
  ],
  resources: [memory.attrMemoryArn],
}));
```

## ✅ Correct

```typescript
const store = env.AGENTCORE_MEMORY_ID
  ? new AgentCoreConversationEventStore(env)
  : new NoopConversationEventStore();

chat.onNewMention(async (thread, message) => {
  const history = await store.loadSessionEvents(thread.id, message.author.platformUserId ?? 'unknown');
  // ...run the model using history...
  await store.appendEvents(thread.id, actorId, newEvents, {
    clientTokenFor: (_e, i) => `${message.id}:${i}`,
  });
});
```

## ❌ Incorrect

```typescript
// ❌ Importing the backing store SDK directly in the chat handler
import { ListEventsCommand } from '@aws-sdk/client-bedrock-agentcore';
chat.onNewMention(async (thread, message) => {
  const events = await client.send(new ListEventsCommand(...)); // ❌
});

// ❌ Failing when memory is not configured
if (!env.AGENTCORE_MEMORY_ID) throw new Error('Memory required'); // ❌

// ❌ Storing AI turns in the Chat SDK state adapter instead of
//    AgentCore Memory — wrong layer.
await state.appendToList(`conv:${thread.id}`, { role: 'assistant', text });

// ❌ Non-deterministic clientToken — duplicate deliveries double-write.
clientTokenFor: () => randomUUID(),
```
