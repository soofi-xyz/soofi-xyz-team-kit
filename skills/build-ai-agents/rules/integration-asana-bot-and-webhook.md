---
title: Asana Bot & Webhook Integration
impact: CRITICAL
tags: [asana, webhook, bot, integration, chat-sdk, chat-adapter-asana]
---

# Asana Bot & Webhook Integration

Every agent MUST have a dedicated Asana bot user and an HTTPS webhook endpoint for receiving events. The agent integrates with Asana through the [Chat SDK](https://chat-sdk.dev/) and the [`@soofi-xyz/chat-adapter-asana`](https://github.com/soofi-xyz/chat-adapter-asana) adapter — do NOT hand-roll the webhook handshake, signature verification, event filtering, or retry logic.

## Why Chat SDK + `@soofi-xyz/chat-adapter-asana`

The adapter handles everything that used to be custom webhook code:

- **Handshake** (`X-Hook-Secret`) — `AsanaAdapter.handleWebhook` echoes the secret and persists it via the configured `WebhookSecretStore` (use `SecretsManagerWebhookSecretStore` in production).
- **Signature verification** (`X-Hook-Signature`, HMAC-SHA256) — done inside the adapter with timing-safe comparison.
- **Event routing** — Asana tasks become Chat SDK threads, comments become messages, and task completion becomes a `:white_check_mark:` reaction on the task-description message. Your code listens on `chat.onNewMention`, `chat.onSubscribedMessage`, and `chat.onReaction(...)` — not on raw Asana payloads.
- **Thread subscription persistence + distributed locking + message dedupe** — delegated to the Chat SDK state adapter. Pair this adapter with [`@soofi-xyz/chat-state-dynamodb`](https://github.com/soofi-xyz/chat-state-dynamodb) in Lambda runtimes; see `rules/state-chat-sdk-state.md`.
- **Automatic @-mentions** on replies, **markdown ↔ Asana rich text**, **file attachments**, and **native emoji reactions** (`addReaction` / `removeReaction`).

The companion CDK construct [`@soofi-xyz/chat-adapter-asana-cdk`](https://github.com/soofi-xyz/chat-adapter-asana/tree/main/packages/chat-adapter-asana-cdk) provisions the HTTP API, the Secrets Manager secret for the signing key, and a custom resource that registers (and deregisters on stack delete) the webhook against the bot's *My Tasks* user-task-list.

The complete reference is the monorepo's [`examples/lambda-http`](https://github.com/soofi-xyz/chat-adapter-asana/tree/main/examples/lambda-http) stack.

## Task I/O Contract

Treat the Asana task description as the canonical **input** surface unless the workflow explicitly says otherwise.

- The task description is delivered by Chat SDK as the first `message` on `chat.onNewMention`, with `message.raw.kind === "task_description"`.
- Subsequent comments are delivered on `chat.onSubscribedMessage` with `message.raw.kind === "comment"`.
- Agent progress updates, answers, and corrections belong in comments. Post them with `thread.post({ markdown })`.
- Do NOT overwrite the original ask in the description with the final answer.
- If the agent's result changes, add a correction comment instead of rewriting the input.
- Do NOT treat `@tagging` the requester as the completion mechanism. Prefer creating a linked review task when the workflow needs human follow-up or approval.
- Task completion is surfaced as `chat.onReaction([emoji.check], …)` with `event.added === true`; reopen fires the same reaction with `event.added === false`.

## Step 1 — Create the Asana Bot User

1. Create a new Asana user (service account) for the agent.
2. Name it `<Agent Name> Bot` (e.g., `Pikachu Bot`).
3. Record the bot user GID — useful for logs and actor resolution.
4. Generate a Personal Access Token (PAT) for the bot user.
5. Store the PAT in the deploy environment. In CDK, pass either `accessToken` (string, goes into CloudFormation at deploy time) or `accessTokenSecret` (existing `ISecret`) to `AsanaChatWebhook`.

### Isolate Webhook Ownership By Environment

Use a different Asana bot user and PAT for every active environment of the same
agent. The default webhook resource is the bot's *My Tasks* user-task-list, so
reusing one identity couples the environments to the same external principal.

Before provisioning `AsanaChatWebhook`:

1. Resolve the bot GID through `/users/me`.
2. Record the workspace GID.
3. Resolve the effective resource GID through
   `/users/me/user_task_list?workspace=<workspace_gid>`, or use the explicit
   `resourceGid` override from the stack.
4. Compare the bot GID with every other active environment for this agent. Stop
   if an identity is reused; provision a separate bot account and PAT before
   deploying.

Do not copy a production PAT into development. Existing legacy systems that
manually reconcile shared webhooks need a repo-specific single-owner gate; do
not copy that exception into a new Chat SDK agent.

### Operator Setup From The Asana UI

When the agent is Asana-integrated, instruct the human operator to create a dedicated Asana profile for the agent first, then collect the required values from that profile.

#### `ASANA_PAT`

From the agent's Asana profile:

1. Log in as the agent's Asana user.
2. Open Asana settings.
3. Go to `Apps`, `Developer apps`, or `Personal access tokens`.
4. Create a new token.
5. Store it as `ASANA_PAT` (or an AWS Secrets Manager secret) in the deploy environment.

#### `ASANA_BOT_USER_GID` (optional)

`@soofi-xyz/chat-adapter-asana` resolves the bot identity lazily from `/users/me` on first use, so `ASANA_BOT_USER_GID` is no longer required as a separate env var. Pre-seed it only if you want to avoid the cold-start API call — pass `botUser: { gid, name, email? }` to `createAsanaAdapter`.

To read the GID manually:

```bash
curl -s https://app.asana.com/api/1.0/users/me \
  -H "Authorization: Bearer $ASANA_PAT" | jq -r '.data.gid'
```

UI source: open the agent user's profile page. The URL is:

```text
https://app.asana.com/1/<workspace_gid>/profile/<user_gid>
```

#### `ASANA_WORKSPACE_GID`

Open the agent's Asana profile or My Tasks page. The workspace GID is the first long number in the URL:

```text
https://app.asana.com/1/<workspace_gid>/profile/<user_gid>
https://app.asana.com/1/<workspace_gid>/project/<project_gid>/list/<task_gid>
```

Set it as `ASANA_WORKSPACE_GID`.

#### Watched resource (automatic)

The `AsanaChatWebhook` CDK construct registers the webhook against the bot's *My Tasks* user-task-list by default, so the bot only receives events for tasks assigned to it. Override this with the `resourceGid` prop if the agent needs to watch a different project or task list.

Do NOT maintain a comma-separated `ASANA_WEBHOOK_RESOURCE_GIDS` env var anymore — the construct handles registration and deregistration as a custom resource tied to the stack lifecycle.

## Step 2 — Wire the Chat SDK

The Lambda handler builds one `Chat` instance at module scope and delegates webhook ingress to `chat.webhooks.asana(request)`.

```typescript
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import {
  proxyEventToWebRequest,
  webResponseToProxyResult,
} from '@aws-lambda-powertools/event-handler/http';
import { Chat, emoji } from 'chat';
import {
  createAsanaAdapter,
  SecretsManagerWebhookSecretStore,
} from '@soofi-xyz/chat-adapter-asana';
import { createDynamoDbState } from '@soofi-xyz/chat-state-dynamodb';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManagerClient({});

const asana = createAsanaAdapter({
  accessToken: await resolveAsanaPat(),
  workspaceGid: requireEnv('ASANA_WORKSPACE_GID'),
  webhookSecretStore: new SecretsManagerWebhookSecretStore({
    secretArn: requireEnv('ASANA_WEBHOOK_SECRET_ARN'),
    client: secretsManager,
  }),
});

const state = createDynamoDbState({
  tableName: requireEnv('CHAT_STATE_TABLE_NAME'),
  region: process.env.AWS_REGION ?? 'us-east-1',
  keyPrefix: process.env.CHAT_STATE_KEY_PREFIX,
  credentials: fromNodeProviderChain(),
});

const chat = new Chat({
  userName: process.env.ASANA_BOT_USER_NAME ?? 'asana-bot',
  adapters: { asana },
  state,
  logger: 'info',
  // Allow a newly arriving webhook to force-release a stuck lock so an
  // in-flight long AI turn does not block future messages indefinitely.
  onLockConflict: 'force',
});

chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  const reply = await runAgentTurn({ thread, message, kind: 'task_description' });
  await thread.post({ markdown: reply });
});

chat.onSubscribedMessage(async (thread, message) => {
  // Acknowledge receipt immediately so the human sees the bot is working
  // even while a long AI turn is still in-flight.
  await asana.addReaction(thread.id, message.id, emoji.eyes);
  const reply = await runAgentTurn({ thread, message, kind: 'comment' });
  await thread.post({ markdown: reply });
});

chat.onReaction([emoji.check], async (event) => {
  if (!event.added) return;
  await event.thread.post({
    markdown: `Acknowledged: task completed by ${event.user.userName}.`,
  });
});

export const handler = async (
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = proxyEventToWebRequest(event);
  const pending: Array<Promise<unknown>> = [];
  const response = await chat.webhooks.asana(request, {
    waitUntil: (task) => {
      pending.push(task.catch((err) => console.error('[handler] failed', err)));
    },
  });
  const result = await webResponseToProxyResult(response, 'ApiGatewayV2');
  if (pending.length > 0) await Promise.all(pending);
  return result;
};
```

Key behaviours:

- `thread.subscribe()` persists the subscription through the state adapter; subsequent comments on the same task flow into `onSubscribedMessage`.
- **Always react with `emoji.eyes` at the top of `onSubscribedMessage`.** A full AI turn can take 20–60 seconds; without an immediate acknowledgement, the human has no signal that the bot received the comment. `asana.addReaction(thread.id, message.id, emoji.eyes)` writes a native Asana 👀 reaction on the story via `PUT /stories/{gid}` and is scoped to the bot user. Do the same pattern inside `onNewMention` when the greeting comment is delayed by any preflight work. Remove the reaction once the reply is posted if you want the final state to look clean: `await asana.removeReaction(thread.id, message.id, emoji.eyes);`.
- `waitUntil` lets API Gateway get a timely HTTP response while Chat SDK finishes handler work after the response is flushed. Always await the pending promises before returning so Lambda does not freeze mid-handler.
- `onLockConflict: 'force'` is recommended for AI agents: it releases a stale lock when a new message arrives so long-running turns do not block the thread forever. See the Chat SDK docs on [distributed locking](https://chat-sdk.dev/docs/state).

## Step 3 — Provision the webhook with CDK

Use `AsanaChatWebhook` from `@soofi-xyz/chat-adapter-asana-cdk` plus `ChatStateDynamoDbTable` from `@soofi-xyz/chat-state-dynamodb-cdk`:

```typescript
import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { AsanaChatWebhook } from '@soofi-xyz/chat-adapter-asana-cdk';
import { ChatStateDynamoDbTable } from '@soofi-xyz/chat-state-dynamodb-cdk';

const stateTable = new ChatStateDynamoDbTable(this, 'ChatStateTable');

const handler = new LambdaFunction(this, 'AgentHandler', {
  runtime: Runtime.NODEJS_22_X,
  handler: 'handler.handler',
  code: Code.fromAsset(handlerAssetPath),
  timeout: Duration.seconds(60),
  memorySize: 1024,
  environment: {
    ASANA_WORKSPACE_GID: props.workspaceGid,
    CHAT_STATE_TABLE_NAME: stateTable.table.tableName,
    CHAT_STATE_KEY_PREFIX: '<agent-name>',
    AGENTCORE_MEMORY_ID: memory.attrMemoryId,
    // LangSmith, Bedrock, and tool-specific env vars go here.
  },
});

stateTable.table.grantReadWriteData(handler);

const webhook = new AsanaChatWebhook(this, 'AsanaWebhook', {
  handler,
  accessToken: props.accessToken,        // or accessTokenSecret: ISecret
  workspaceGid: props.workspaceGid,
});
```

The construct:

1. Creates an HTTP API route (default `/webhooks/asana`) that forwards to `handler`.
2. Creates a Secrets Manager secret for the webhook signing key and injects `ASANA_WEBHOOK_SECRET_ARN` into the handler environment. IAM read/write grants are added automatically.
3. Runs a Lambda-backed custom resource at deploy time that resolves the bot's *My Tasks* user-task-list GID via `/users/me/user_task_list?workspace=…` and registers the Asana webhook against it. On stack delete, the webhook is deregistered.

Expose the construct outputs in the stack so operators can verify delivery:

```typescript
new CfnOutput(this, 'WebhookUrl', { value: webhook.webhookUrl });
new CfnOutput(this, 'WebhookGid', { value: webhook.webhookGid });
new CfnOutput(this, 'WebhookSecretArn', { value: webhook.webhookSecret.secretArn });
```

### What the construct supersedes

Do NOT add any of the following to new agents — they are handled by the adapter or its CDK construct:

- Manual `X-Hook-Secret` handshake code.
- Manual `X-Hook-Signature` HMAC comparison.
- A separate `apps/asana-webhook/` thin-Lambda app.
- `POST /webhooks` registration scripts invoked during deploy.
- `EventInvokeConfig` with `retryAttempts: 0` on an async runtime invocation — there is no secondary Lambda hop any more.
- Homegrown DynamoDB dedupe claim stores — the Chat SDK state adapter dedupes deliveries through distributed locks and `dedupeTtlMs`.

### Required deploy-time environment variables

| Variable | Where it comes from |
| --- | --- |
| `ASANA_PAT` (or an `ISecret` reference) | Operator; collected from the agent's Asana profile |
| `ASANA_WORKSPACE_GID` | Operator; collected from the Asana profile URL |
| AWS profile/region | Deployer's AWS CLI environment |

Inside the Lambda, `ASANA_WEBHOOK_SECRET_ARN` and `CHAT_STATE_TABLE_NAME` are injected by the CDK constructs — do NOT set them manually.

## Important Asana Behaviour

- Task, subtask, and story events are delivered for the resource the webhook is registered against. The default *My Tasks* user-task-list delivers events for tasks assigned to the bot, which matches the standard Chat SDK thread-per-task model. Override `resourceGid` only if the agent must watch a specific project.
- When multiple entry points are required, provision additional `AsanaChatWebhook` constructs with different `resourceGid` values instead of fanning out from one webhook.
- Parse current task input from Chat SDK message objects. The first message on `onNewMention` carries the task description (`message.raw.kind === "task_description"`), subsequent messages carry comments (`message.raw.kind === "comment"`). Ignore bot-authored messages when deriving the next request — filter by `message.author.userName` or `message.author.platformUserId`.

## ✅ Correct

```typescript
// Single Lambda: Chat SDK handles ingress, handler runs the AI turn.
export const handler = async (event: APIGatewayProxyEventV2) => {
  const request = proxyEventToWebRequest(event);
  const pending: Array<Promise<unknown>> = [];
  const response = await chat.webhooks.asana(request, {
    waitUntil: (task) => pending.push(task.catch(logError)),
  });
  const result = await webResponseToProxyResult(response, 'ApiGatewayV2');
  if (pending.length > 0) await Promise.all(pending);
  return result;
};
```

## ❌ Incorrect

```typescript
// ❌ Hand-rolled handshake and signature verification
const hookSecret = headerValue(event.headers, 'x-hook-secret');
if (hookSecret) return emptyResponse(200, { 'x-hook-secret': hookSecret });
const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
if (digest !== signature) return forbidden();

// ❌ Two-Lambda architecture with async invoke between them
await lambda.send(new InvokeCommand({
  FunctionName: env.AGENT_RUNTIME_FUNCTION_NAME,
  InvocationType: 'Event',
  Payload: Buffer.from(JSON.stringify(events)),
}));

// ❌ Homegrown DynamoDB dedupe claim
const claimed = await deps.dedupe.claim(candidate.fingerprint);
if (!claimed) continue;

// ❌ Manual webhook registration during deploy
await asana.post('/webhooks', { resource, target });

// ❌ Forgetting to wait for Chat SDK background work
const response = await chat.webhooks.asana(request, {
  waitUntil: (task) => { /* dropped */ },
});
return webResponseToProxyResult(response, 'ApiGatewayV2');
```
