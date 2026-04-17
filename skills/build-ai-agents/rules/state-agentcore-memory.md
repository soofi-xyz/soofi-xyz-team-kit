---
title: AgentCore Memory
impact: HIGH
tags: [memory, agentcore, state, session, conversation, events]
---

# AgentCore Memory

Implement conversational memory using **Amazon AgentCore Memory** as the backing store. This works with a Lambda runtime because the memory service is external to the function.

Reference implementation: keep a `ConversationEventStore` interface so the chat layer does not care which backing store is used.

## Architecture

```
ConversationEventStore (interface)
├── AgentCoreConversationEventStore  (production — stores events in AgentCore Memory)
└── NoopConversationEventStore       (fallback — returns empty, stores nothing)
```

The chat layer calls the `ConversationEventStore` interface — it never imports the AWS SDK directly.

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

## Key Rules

1. **Always implement the `Noop` fallback.** If `AGENTCORE_MEMORY_ID` is not set, use `NoopConversationEventStore`. Never fail because memory is unconfigured.
2. **Paginate `ListEventsCommand`.** AgentCore Memory is paginated; always honor `nextToken`.
3. **Enforce a history limit.** Load at most `CHAT_HISTORY_EVENT_LIMIT` events (default: 200).
4. **Use deterministic `clientToken` values.** Writes must be safe across retries and duplicate deliveries.
5. **Encode/decode events.** Keep a codec module to serialize conversation events into AgentCore payloads.
6. **Keep memory external.** Lambda process memory is not durable and must not be treated as conversation history.

## CDK Configuration

```typescript
const memory = new agentcore.CfnMemory(this, 'AgentMemory', {
  name: `${agentName}Memory`,
  eventExpiryDuration: 90,
});

// Pass memory ID to runtime Lambda
runtimeEnvVars: {
  AGENTCORE_MEMORY_ID: memory.attrMemoryId,
  CHAT_HISTORY_EVENT_LIMIT: '200',
}
```

## ✅ Correct

```typescript
// Bootstrap — choose implementation based on config
const store = env.AGENTCORE_MEMORY_ID
  ? new AgentCoreConversationEventStore(env)
  : new NoopConversationEventStore();
```

## ❌ Incorrect

```typescript
// ❌ Importing the backing store SDK directly in the chat layer
import { ListEventsCommand } from '@aws-sdk/client-bedrock-agentcore';
async function processChatTurn() {
  const events = await client.send(new ListEventsCommand(...)); // ❌
}

// ❌ Failing when memory is not configured
if (!env.AGENTCORE_MEMORY_ID) throw new Error('Memory required'); // ❌
```
