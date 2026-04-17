---
title: Asana Bot & Webhook Integration
impact: CRITICAL
tags: [asana, webhook, bot, integration, handshake, signature, dedupe]
---

# Asana Bot & Webhook Integration

Every agent MUST have a dedicated Asana bot user and a webhook endpoint for receiving events.

## Task I/O Contract

Treat the Asana task description as the canonical **input** surface unless the workflow explicitly says otherwise.

- The task description contains the user ask and stable task context.
- Agent progress updates, answers, and corrections belong in comments.
- Do NOT overwrite the original ask in the description with the final answer.
- If the agent's result changes, add a correction comment instead of rewriting the input.
- Do NOT use `@tagging` the requester as the completion mechanism.
- Prefer creating a linked review task when the workflow needs a human follow-up or approval step.

## Step 1 — Create the Asana Bot User

1. Create a new Asana user (service account) for the agent.
2. Name it `<Agent Name> Bot` (e.g., `Seneca Bot`).
3. Record the bot user GID — it is required for webhook event filtering.
4. Generate a Personal Access Token (PAT) for the bot user.
5. Store the PAT in the deploy environment (it will be placed in Secrets Manager by CDK).

### Operator Setup From The Asana UI

When the agent is Asana-integrated, instruct the human operator to create a dedicated Asana profile for the agent first, then collect the required values from that profile and its watched project.

#### `ASANA_PAT`

From the agent's Asana profile:

1. Log in as the agent's Asana user.
2. Open Asana settings.
3. Go to `Apps`, `Developer apps`, or `Personal access tokens`.
4. Create a new token.
5. Store it as `ASANA_PAT` or in Secrets Manager.

#### `ASANA_BOT_USER_GID`

Preferred source: use the PAT with `users/me`.

```bash
curl -s https://app.asana.com/api/1.0/users/me \
  -H "Authorization: Bearer $ASANA_PAT" | jq -r '.data.gid'
```

UI source:

- Open the agent user's profile page in Asana.
- The URL looks like:

```text
https://app.asana.com/1/<workspace_gid>/profile/<user_gid>
```

- The number after `/profile/` is the bot user GID.

Many Asana PATs also visually embed the bot user GID in the token prefix:

```text
2/<ASANA_BOT_USER_GID>/...
```

Treat `users/me` as the authoritative source if there is any doubt.

#### `ASANA_WORKSPACE_GID`

Open the agent's Asana profile or My Tasks page. The workspace GID is the first long number in the URL:

```text
https://app.asana.com/1/<workspace_gid>/profile/<user_gid>
https://app.asana.com/1/<workspace_gid>/project/<project_gid>/list/<task_gid>
```

#### `ASANA_WEBHOOK_RESOURCE_GIDS`

Have the operator open the specific project the agent should watch. A common path is to go to the agent profile, open `My Tasks`, then navigate to the watched project.

The project URL looks like:

```text
https://app.asana.com/1/<workspace_gid>/project/<project_gid>/list/<task_gid>
```

Use:

- `ASANA_WORKSPACE_GID=<workspace_gid>`
- `ASANA_WEBHOOK_RESOURCE_GIDS=<project_gid>`

If multiple projects or task lists must be watched, pass a comma-separated list in `ASANA_WEBHOOK_RESOURCE_GIDS`.

## Step 2 — Implement the Webhook Handler

The webhook handler is a **thin Lambda** behind API Gateway. It does three things:

1. **Handshake** — respond to Asana's `X-Hook-Secret` registration challenge.
2. **Signature verification** — validate `X-Hook-Signature` on every delivery.
3. **Event routing** — filter events, then invoke the runtime Lambda.

Reference implementation: [ovid-agent webhook handler](https://github.com/Spring-Oaks-Capital-LLC/ovid-agent/blob/master/apps/asana-webhook/src/handler.ts).

Reference documentation: [Asana Webhooks Guide](https://developers.asana.com/docs/webhooks-guide).

### Handshake

When Asana registers a webhook, it sends a POST with `X-Hook-Secret` header and no body. Respond with `200` and echo the secret back in `X-Hook-Secret` response header.

```typescript
const hookSecret = headerValue(event.headers, 'x-hook-secret');
if (hookSecret) {
  // Store the secret for future signature verification
  await deps.saveState({
    pendingHookSecrets: [
      ...state.pendingHookSecrets,
      { secret: hookSecret, observedAt: new Date().toISOString() },
    ],
  });

  return emptyResponse(200, { 'x-hook-secret': hookSecret });
}
```

### Signature Verification

Every delivery after handshake includes `X-Hook-Signature` — an HMAC-SHA256 of the raw body using the hook secret.

```typescript
function verifySignature(
  rawBody: string,
  secret: string,
  signature: string,
): boolean {
  const digest = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const digestBuffer = Buffer.from(digest, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  return (
    digestBuffer.length === signatureBuffer.length &&
    timingSafeEqual(digestBuffer, signatureBuffer)
  );
}
```

Use `timingSafeEqual` — never compare signatures with `===`.

### Event Filtering

Filter events Lambda-side before invoking the runtime. Only forward events where:

- The task is **assigned to the bot user**, OR
- A **comment mentions the bot user**.

```typescript
const filteredEvents = payload.events.filter((item) =>
  shouldForwardEvent(item, state.botUserGid),
);

if (filteredEvents.length === 0) {
  return jsonResponse(202, { success: true, accepted: false });
}
```

### Trigger Dedupe

Asana can deliver multiple events for one human action, and async runtime invocation can replay failed deliveries. Agents MUST dedupe task triggers durably across deliveries.

Use a fingerprint claim store such as DynamoDB:

```typescript
const claimed = await deps.dedupe.claim(candidate.fingerprint);
if (!claimed) {
  logRuntime({
    level: 'info',
    message: 'Skipped duplicate Asana trigger.',
    fingerprint: candidate.fingerprint,
    taskGid: candidate.taskGid,
  });
  continue;
}
```

The fingerprint should encode the trigger type, task identity, and a stable event bucket or story identifier.

### Retry Control

If the webhook invokes a Lambda runtime asynchronously, explicitly disable or constrain Lambda async retries so one failed task does not fan out into duplicate agent runs:

```typescript
new EventInvokeConfig(this, 'AgentRuntimeAsyncInvokeConfig', {
  function: runtimeFunction,
  maxEventAge: Duration.hours(1),
  retryAttempts: 0,
});
```

Keep dedupe in place even with Lambda retry controls because duplicate Asana deliveries can arrive before runtime execution.

### Runtime Invocation

After filtering, invoke the runtime Lambda with the delivery payload:

```typescript
await lambda.send(
  new InvokeCommand({
    FunctionName: env.AGENT_RUNTIME_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      kind: 'asana-webhook',
      deliveryId,
      projectGid: matchingRegistration?.resourceGid,
      botUserGid: state.botUserGid,
      events: filteredEvents,
    }), 'utf8'),
  }),
);
```

## Step 3 — Configure Webhook Registration

Webhook registration happens during deploy. Required environment variables:

| Variable | Description |
| --- | --- |
| `ASANA_PAT` | Bot user's Personal Access Token |
| `ASANA_BOT_USER_GID` | Bot user's GID |
| `ASANA_WORKSPACE_GID` | Workspace GID |
| `ASANA_WEBHOOK_RESOURCE_GIDS` | Comma-separated resource GIDs to watch (projects, tasks, user task lists) |

At the end of an Asana-integrated agent setup, explicitly tell the human how to obtain each of these values from the Asana UI and/or `users/me`.

### Important Asana Behavior

- Do NOT replace resource-scoped webhooks with a workspace webhook. Task, subtask, and story events do not propagate to workspace/team webhooks.
- If you need multiple entry points, configure multiple watched resources instead.
- The desired Asana filters are: `task added`, `task changed`, `story added`, `story changed`.
- Parse current task input from the task description/title and the latest relevant human-authored story. Ignore bot-authored example outputs when deriving the next request.

## Step 4 — CDK Infrastructure

The webhook stack creates:

- API Gateway HTTP API (public endpoint).
- Lambda function with the webhook handler.
- Secrets Manager secret for webhook state (hook secrets, registration metadata).
- Durable dedupe storage when runtime triggers must be claimed across deliveries.
- IAM permissions: webhook Lambda → Secrets Manager + runtime Lambda invoke permissions.

## ✅ Correct

```typescript
// Thin webhook handler — validate, filter, invoke
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // 1. Handshake check
  // 2. Signature verification
  // 3. Parse + filter events
  // 4. Invoke runtime
  // Nothing else
};
```

## ❌ Incorrect

```typescript
// ❌ AI logic in the webhook handler
export const handler = async (event) => {
  const result = await generateText({ model, prompt: event.body });
  await postAsanaComment(result); // ❌ Webhook should not do AI work
};

// ❌ Skipping signature verification
export const handler = async (event) => {
  const body = JSON.parse(event.body); // ❌ No signature check
  await invokeRuntime(body);
};
```
