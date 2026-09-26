---
title: Chat SDK State (DynamoDB)
impact: CRITICAL
tags: [state, chat-sdk, dynamodb, subscriptions, locks, dedupe]
---

# Chat SDK State (DynamoDB)

Every agent MUST provide the Chat SDK with a production-grade state adapter. Use [`@soofi-xyz/chat-state-dynamodb`](https://github.com/soofi-xyz/chat-state-dynamodb) for Lambda-hosted agents. Do NOT use `@chat-adapter/state-memory` in production — in-memory state is lost on cold start and cannot coordinate concurrent Lambda invocations.

This is **not** the AI conversation history store. Conversation history (user/assistant turns, tool calls) lives separately in AgentCore Memory — see `rules/state-agentcore-memory.md`. The two stores serve different concerns and MUST stay isolated.

## What the Chat SDK state adapter owns

The Chat SDK uses the state adapter internally for:

- **Thread subscriptions.** `thread.subscribe()` persists a record that the bot is watching the task. Subsequent comments route to `chat.onSubscribedMessage` only when the subscription exists, so the mapping must survive Lambda cold starts and work across concurrent instances.
- **Distributed locks.** On every webhook delivery the SDK acquires a per-thread lock before invoking your handler. This is the dedupe mechanism that replaces homegrown DynamoDB claim stores — duplicate Asana deliveries targeting the same thread fail to acquire the lock and are dropped.
- **Message dedupe.** The SDK keeps a TTL-scoped dedupe record (`dedupeTtlMs`, default 5 minutes) keyed off the delivery identifier so retried webhook events are not re-processed.
- **Caching.** `thread.setState()` / `thread.getState()`, handler-local KV storage, and internal caches.

Application code MAY also use the state adapter directly for per-thread append-only lists or queues (for example, a running journal of comments), but conversation memory for the AI SHOULD use the dedicated `ConversationEventStore` interface instead of reaching into Chat SDK state.

## Package layout

| Package | Purpose |
| --- | --- |
| `@soofi-xyz/chat-state-dynamodb` | `StateAdapter` implementation backed by a DynamoDB single-table schema |
| `@soofi-xyz/chat-state-dynamodb-cdk` | CDK construct (`ChatStateDynamoDbTable`) that provisions the recommended table |

Reference end-to-end example: [`examples/asana-journal-lambda`](https://github.com/soofi-xyz/chat-state-dynamodb/tree/main/examples/asana-journal-lambda) in the repo.

## Runtime wiring

Build the state adapter once at module scope and pass it to `Chat`:

```typescript
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Chat } from 'chat';
import { createDynamoDbState } from '@soofi-xyz/chat-state-dynamodb';

const state = createDynamoDbState({
  tableName: requireEnv('CHAT_STATE_TABLE_NAME'),
  region: process.env.AWS_REGION ?? 'us-east-1',
  keyPrefix: process.env.CHAT_STATE_KEY_PREFIX ?? 'chat-sdk',
  credentials: fromNodeProviderChain(),
});

const chat = new Chat({
  userName: 'my-agent-bot',
  adapters: { asana },
  state,
  onLockConflict: 'force',
});
```

### Configuration options

| Option | Required | Notes |
| --- | --- | --- |
| `tableName` | yes | Name of the DynamoDB table (pass `table.tableName` from CDK) |
| `region` | yes | AWS region for the DynamoDB client |
| `credentials` | yes | AWS credential identity or provider (use `fromNodeProviderChain()` in Lambda) |
| `endpoint` | no | Override for local DynamoDB / VPC endpoints |
| `keyPrefix` | no | Namespace prefix inside the table (defaults to `chat-sdk`) |
| `logger` | no | Chat SDK `Logger` instance |
| `dynamoDbClientConfig` | no | Extra `DynamoDBClient` config, excluding `region`, `credentials`, and `endpoint` |

### `onLockConflict` for AI agents

A full AI turn can take tens of seconds (model inference + tool calls). If a second webhook arrives for the same thread while the first is running, the default `'drop'` behaviour silently discards the new message. Agents that support long-running turns SHOULD set `onLockConflict: 'force'` so the new message wins and the older handler releases the lock.

Force-releasing the lock does NOT cancel the in-flight handler. The SDK simply re-acquires the lock; the previous handler continues running until it returns. Keep handlers idempotent and assume concurrent execution on the same thread.

For custom logic, pass a callback:

```typescript
onLockConflict: (threadId, message) =>
  message.text?.toLowerCase().includes('stop') ? 'force' : 'drop',
```

## CDK infrastructure

Use `ChatStateDynamoDbTable` to provision the table and grant IAM access to the handler Lambda:

```typescript
import { RemovalPolicy } from 'aws-cdk-lib';
import { ChatStateDynamoDbTable } from '@soofi-xyz/chat-state-dynamodb-cdk';

const stateTable = new ChatStateDynamoDbTable(this, 'ChatStateTable', {
  // Production defaults: deletion protection + PITR are on by default.
  // Override only for ephemeral example stacks.
});

stateTable.table.grantReadWriteData(handler);

handler.addEnvironment('CHAT_STATE_TABLE_NAME', stateTable.table.tableName);
handler.addEnvironment('CHAT_STATE_KEY_PREFIX', '<agent-name>');
```

The construct exposes the underlying `Table` via `stateTable.table` so consumers can attach IAM grants, read the table name, or add alarms. The schema is a single table with:

- partition key `pk` (`S`)
- sort key `sk` (`S`)
- TTL attribute `ttl` (`N`, epoch seconds)

TTL is background cleanup only; the adapter enforces logical expiry with `expiresAtMs` values on reads and writes.

### Stack outputs

Surface the table name, ARN, and key prefix as `CfnOutput` values so operators can debug from CloudFormation:

```typescript
new CfnOutput(this, 'TableName', { value: stateTable.table.tableName });
new CfnOutput(this, 'TableArn', { value: stateTable.table.tableArn });
new CfnOutput(this, 'KeyPrefix', { value: '<agent-name>' });
```

### Sharing the table across agents

One DynamoDB table can back multiple agents if each agent uses a distinct `keyPrefix`. Provision one `ChatStateDynamoDbTable` per environment and set `keyPrefix: '<agent-name>'` per agent. Do NOT share a key prefix across agents — it mixes subscription records and locks.

## Key rules

1. **Always pass a production state adapter.** `Chat` requires one; `createMemoryState()` is only acceptable in unit tests.
2. **Use `fromNodeProviderChain()` for credentials.** Never hardcode access keys.
3. **Set a unique `keyPrefix` per agent.** `<agent-name>` works as the default. Never share a prefix between agents.
4. **Grant the handler read/write on the table.** Use `stateTable.table.grantReadWriteData(handler)`; do NOT attach broad `dynamodb:*` policies.
5. **Prefer `onLockConflict: 'force'` for AI agents.** Drop behaviour loses messages when a turn runs long. Force ensures the newest message always wins.
6. **Do NOT use `dedupeTtlMs` as a way to allow retries.** Extending the window masks duplicate-processing bugs. The default 5 minutes is correct.
7. **Do NOT reach into the state adapter for AI conversation history.** Keep that behind `ConversationEventStore` with AgentCore Memory; see `rules/state-agentcore-memory.md`.

## ✅ Correct

```typescript
const state = createDynamoDbState({
  tableName: env.CHAT_STATE_TABLE_NAME,
  region: env.AWS_REGION,
  keyPrefix: 'pikachu-agent',
  credentials: fromNodeProviderChain(),
});

const chat = new Chat({
  userName: 'pikachu-bot',
  adapters: { asana },
  state,
  onLockConflict: 'force',
});
```

```typescript
const stateTable = new ChatStateDynamoDbTable(this, 'ChatStateTable');
stateTable.table.grantReadWriteData(handler);
handler.addEnvironment('CHAT_STATE_TABLE_NAME', stateTable.table.tableName);
handler.addEnvironment('CHAT_STATE_KEY_PREFIX', 'pikachu-agent');
```

## ❌ Incorrect

```typescript
// ❌ In-memory state in a Lambda — subscriptions and locks vanish on cold start.
const chat = new Chat({
  adapters: { asana },
  state: createMemoryState(),
  userName: 'my-bot',
});

// ❌ Hand-rolled dedupe claim store on top of a second DynamoDB table.
const claimed = await deps.dedupe.claim(candidate.fingerprint);
if (!claimed) return;

// ❌ Sharing a key prefix across agents — subscriptions and locks collide.
createDynamoDbState({ tableName, region, keyPrefix: 'chat-sdk' });

// ❌ Storing AI conversation turns in the Chat SDK state adapter instead of
//    behind the ConversationEventStore interface.
await state.appendToList(`conv:${threadId}`, { role: 'assistant', text });
```
