---
title: Tools, Deploy & Test
impact: HIGH
tags: [tools, deploy, cdk, test, asana, langsmith, e2e, chat-sdk]
---

# Tools, Deploy & Test

Implement agent tools, deploy with CDK, and verify end-to-end through Asana tasks and LangSmith traces.

## Tools

### Tool Structure

Each tool lives in its own subdirectory under `tools/`:

```
tools/
├── primary-data/
│   └── index.ts
├── reference-data/
│   └── index.ts
└── task-system/
    └── index.ts
```

### Tool Implementation

Use the AI SDK `tool()` helper with Zod parameter schemas:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const lookupPrimaryRecordTool = tool({
  description: 'Look up the primary record needed to answer the request.',
  parameters: z.object({
    recordId: z.string().min(1),
  }),
  execute: async ({ recordId }) => {
    return dataClient.lookupRecord(recordId);
  },
});
```

### Tool Design Rules

1. **One purpose per tool.** A tool that reads AND writes is two tools.
2. **Return strings or JSON.** The model processes tool results as context.
3. **Return errors as strings.** Do NOT throw unless the error is truly fatal and should abort the agent loop.
4. **Keep tool execution fast.** Long-running work should run outside the Lambda agent runtime.
5. **Log tool execution.** Emit structured logs for every tool call with input summary and outcome.

## Deploy

### One CDK stack

The agent ships as a single CDK stack that composes four pieces: the agent Lambda, the Chat SDK state table, the Asana webhook, and AgentCore Memory.

```typescript
import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { AsanaChatWebhook } from '@soofi-xyz/chat-adapter-asana-cdk';
import { ChatStateDynamoDbTable } from '@soofi-xyz/chat-state-dynamodb-cdk';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';

export class AgentStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const stateTable = new ChatStateDynamoDbTable(this, 'ChatStateTable');

    const memory = new agentcore.CfnMemory(this, 'AgentMemory', {
      name: `${props.agentName}Memory`,
      eventExpiryDuration: 90,
    });

    const langsmithSecret = new secretsmanager.Secret(this, 'LangSmithApiKey', {
      secretStringValue: cdk.SecretValue.unsafePlainText(props.langsmithApiKey),
    });

    const handler = new LambdaFunction(this, 'AgentHandler', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: Code.fromAsset(handlerAssetPath),
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ASANA_WORKSPACE_GID: props.workspaceGid,
        CHAT_STATE_TABLE_NAME: stateTable.table.tableName,
        CHAT_STATE_KEY_PREFIX: props.agentName,
        AGENTCORE_MEMORY_ID: memory.attrMemoryId,
        LANGSMITH_API_KEY_SECRET_ARN: langsmithSecret.secretArn,
        LANGSMITH_PROJECT: props.agentName,
        LANGSMITH_TRACING: 'true',
        BEDROCK_MODEL_ID: props.bedrockModelId,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    stateTable.table.grantReadWriteData(handler);
    langsmithSecret.grantRead(handler);

    handler.role?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    handler.role?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:CreateEvent', 'bedrock:ListEvents', 'bedrock:GetMemory'],
      resources: [memory.attrMemoryArn],
    }));

    const webhook = new AsanaChatWebhook(this, 'AsanaWebhook', {
      handler,
      accessToken: props.asanaPat,          // or accessTokenSecret: ISecret
      workspaceGid: props.workspaceGid,
    });

    new CfnOutput(this, 'WebhookUrl', { value: webhook.webhookUrl });
    new CfnOutput(this, 'WebhookGid', { value: webhook.webhookGid });
    new CfnOutput(this, 'WebhookSecretArn', { value: webhook.webhookSecret.secretArn });
    new CfnOutput(this, 'TableName', { value: stateTable.table.tableName });
  }
}
```

### Deploy script

A single `cdk deploy` is enough — webhook registration happens inside `AsanaChatWebhook` as a CloudFormation custom resource. Do NOT write a separate post-deploy reconcile step.

```json
{
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "synth": "cdk synth",
    "deploy": "cdk deploy",
    "destroy": "cdk destroy",
    "invoke": "tsx scripts/invoke-agent.ts"
  }
}
```

### Required Deploy Environment Variables

| Variable | Description |
| --- | --- |
| `ASANA_PAT` | Asana bot user PAT (or pass `accessTokenSecret` to the CDK construct) |
| `ASANA_WORKSPACE_GID` | Workspace GID |
| `LANGSMITH_API_KEY` | LangSmith API key (stored in Secrets Manager by CDK) |
| `GITHUB_TOKEN` | Optional GitHub token when the agent reads GitHub content |

No longer required: `ASANA_BOT_USER_GID`, `ASANA_WEBHOOK_RESOURCE_GIDS`. The adapter resolves the bot identity lazily via `/users/me`, and the CDK construct registers the webhook against the bot's *My Tasks* user-task-list automatically.

Create `.env.example` listing all required variables. Copy to `.env` for local deploys.

### CI/CD

Use the shared `Spring-Oaks-Capital-LLC/github-workflows` deploy workflow. Caller workflows use `secrets: inherit`. Add `LANGSMITH_API_KEY`, `ASANA_PAT`, and any optional API secrets such as `GITHUB_TOKEN` as repository secrets.

## Test

### Unit Tests

- Test tool execution logic in isolation.
- Test request/response contract schemas with Zod.
- Test conversation event codec (encode/decode roundtrip).
- Test actor resolution logic against `message.author` shapes from `@soofi-xyz/chat-adapter-asana`.
- Run with `vitest`.

### CDK Synthesis Tests

- Verify the stack synthesises without errors.
- Verify IAM permissions are scoped correctly (handler gets `grantReadWriteData` on the state table, `bedrock:CreateEvent`/`bedrock:ListEvents` on AgentCore Memory only, and `secretsmanager:GetSecretValue` on the LangSmith secret only).

### End-to-End Testing

E2E testing is done through real Asana interactions:

1. **Assign a task to the bot user** in a watched resource (the *My Tasks* user-task-list by default).
2. **Verify the webhook fires** — check Lambda logs for the Chat SDK `handleWebhook` log line and confirm the handshake secret was persisted in the CDK-managed Secrets Manager secret.
3. **Verify the agent responds** — check for a comment posted by the bot on the Asana task via `thread.post({ markdown })`.
4. **Check LangSmith traces** — open the project in LangSmith, find the session keyed by `thread.id`, verify:
   - Root trace exists for the invocation.
   - Tool calls are visible in the trace tree.
   - No error spans.
5. **Test @mention** — comment on a task mentioning the bot user. Verify `onSubscribedMessage` fires and the agent responds.
6. **Verify duplicate protection** — replay a webhook delivery or assign/unassign rapidly; confirm only one handler invocation wins the Chat SDK thread lock.
7. **Verify review handoff** — if the workflow requires human review on completion, confirm the agent creates the linked review task instead of only tagging the requester.

### Testing Checklist

- [ ] Bot user created in Asana and PAT captured
- [ ] Stack deployed; `WebhookUrl`, `WebhookGid`, `WebhookSecretArn`, and `TableName` visible as outputs
- [ ] Handshake succeeded (verify the hook secret is populated in the CDK-managed Secrets Manager secret)
- [ ] Asana webhook visible on `GET /webhooks?workspace=…` with the stack's `WebhookGid`
- [ ] Task assignment triggers `onNewMention`; subsequent comment triggers `onSubscribedMessage`
- [ ] Agent posts a reply on the task
- [ ] LangSmith traces appear in the correct project, grouped by `thread.id`
- [ ] LangSmith trace tree shows tool/model child spans, not only the outer invocation
- [ ] Duplicate deliveries are dropped by the Chat SDK state adapter's distributed lock
- [ ] AgentCore Memory persists conversation history across invocations
- [ ] Stack destroy removes the webhook registration via the `AsanaChatWebhook` custom resource

## ✅ Correct

```bash
# Single-stack deploy; no post-deploy reconcile step
pnpm build
pnpm deploy
# Assign a task to the bot in Asana
# Check CloudWatch logs for handler invocation
# Check LangSmith for traces
# Check Asana for bot comment
```

## ❌ Incorrect

```bash
# ❌ Custom post-deploy script that calls POST /webhooks directly —
# AsanaChatWebhook already registers the webhook as a custom resource.
pnpm deploy && tsx scripts/reconcile-asana-webhook.ts

# ❌ Two stacks with async invoke between webhook + runtime — the single
# Lambda + Chat SDK model replaces this.
pnpm deploy:webhook && pnpm deploy:runtime

# ❌ Only unit tests, no E2E
pnpm test  # Passes, but the Asana flow was never verified

# ❌ Skipping LangSmith verification
# "It works in Asana" — but traces show errors you can't see from Asana
```
