---
title: Request Contracts & Routing
impact: CRITICAL
tags: [contracts, routing, asana, intent, tools]
---

# Request Contracts & Routing

When an agent supports more than one question or task type, it MUST use a typed request contract and route tools by intent. Do NOT force every ask through one fallback action.

## Use a Typed Multi-Intent Contract

Define a discriminated union of request shapes:

```typescript
const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('inspect_record'),
    record_id: z.string().min(1),
  }),
  z.object({
    action: z.literal('search_history'),
    subject: z.string().min(1),
    limit: z.number().int().positive().max(25).default(10),
  }),
  z.object({
    action: z.literal('list_assets'),
    query: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal('count_assets'),
    query: z.string().min(1).optional(),
  }),
]);
```

Use this when the agent must answer multiple question types such as:
- inspect one entity by ID
- search history by phone number or account
- list available templates or configurations
- count/filter inventory by family or query

## Parse the Right Asana Content

Chat SDK surfaces Asana events as typed messages via `@soofi-xyz/chat-adapter-asana`. Derive the current request from the `message` object delivered to the handler — do NOT fetch `task.notes` and stories separately.

- `chat.onNewMention(thread, message)` — first message on a newly assigned task. `message.raw.kind === "task_description"` and `message.text` holds the task description (plus task title where available in `message.raw`).
- `chat.onSubscribedMessage(thread, message)` — each subsequent comment. `message.raw.kind === "comment"`.

Parser preference order:

1. The current `message.text` (always the freshest human input).
2. The task description from history — available either from the first `onNewMention` event persisted in AgentCore Memory, or from `thread.getMessages()` filtered by `raw.kind === "task_description"`.
3. The task title from `message.raw` or thread metadata, as a last-resort fallback.

Filter out bot-authored messages when deriving the next request — `@soofi-xyz/chat-adapter-asana` exposes `message.author.platformUserId`, which you can compare against the bot user GID (fetched from `/users/me` on first use).

```typescript
function deriveCurrentAsk({
  message,
  history,
  botUserGid,
}: DeriveAskInput): string {
  const fromMessage = message.text?.trim();
  if (fromMessage) return fromMessage;

  const taskDescription = history.find(
    (event) => event.source === 'user' && event.kind === 'task_description',
  );
  if (taskDescription?.text) return taskDescription.text.trim();

  return message.raw?.taskName?.trim() ?? '';
}

// When reading prior events, never let bot-authored messages pose as user input.
const humanHistory = history.filter(
  (event) => event.source !== 'bot',
);
```

Do NOT treat bot-authored example comments or stale previous outputs as fresh input — filter on `message.author.platformUserId` or the cached bot GID before feeding history to the model.

## Route Tools by Source

Pick the source that actually owns the answer:

- **Primary data source** for record-linked questions, history, and status.
- **Reference source** for authored inventory, counts, and source-of-truth definitions.
- **Artifact store** only for materialized outputs that are already linked from the primary source.

Do NOT force every question through the same source if another system is the source of truth.
Do NOT search the artifact store for inventory when the reference source owns the catalog.

## Missing Data vs Unsupported Question

Handle these separately:

- **Missing data**: the question is supported, but the target record or reference is absent.
- **Unsupported question**: the current configured sources cannot answer the ask.

Return an explicit explanation instead of hallucinating or silently falling back.

## ✅ Correct

```typescript
switch (request.action) {
  case 'inspect_record':
    return inspectRecordFlow(request);
  case 'search_history':
    return searchHistoryFlow(request);
  case 'list_assets':
    return listAssetsFlow(request);
  case 'count_assets':
    return countAssetsFlow(request);
}
```

## ❌ Incorrect

```typescript
// ❌ Everything coerced into one action
const request = {
  action: 'inspect_record',
  record_id: extractAnyIdentifier(taskText) ?? 'fallback-id',
};

// ❌ Bot examples treated as user input
const candidates = history.map((event) => event.text);

// ❌ Hitting the Asana API directly for notes + stories instead of using
//    the message objects Chat SDK already delivered.
const task = await asanaClient.getTask(taskGid);
const stories = await asanaClient.listStories(taskGid);

// ❌ Inventory question forced through the wrong source
if (question.includes('what assets are available')) {
  return primaryDataLookup();
}
```
