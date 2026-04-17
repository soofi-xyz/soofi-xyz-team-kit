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

The parser should prefer:
1. task description
2. task title
3. latest relevant human-authored stories

Do NOT treat bot-authored example comments or stale previous outputs as fresh input.

```typescript
const candidates = [
  task.notes?.trim() ?? '',
  stripHtml(task.html_notes),
  task.name.trim(),
  ...stories
    .filter((story) => story.created_by?.gid !== botUserGid)
    .map((story) => story.text ?? stripHtml(story.html_text)),
];
```

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
const candidates = [task.notes, ...stories.map((story) => story.text)];

// ❌ Inventory question forced through the wrong source
if (question.includes('what assets are available')) {
  return primaryDataLookup();
}
```
