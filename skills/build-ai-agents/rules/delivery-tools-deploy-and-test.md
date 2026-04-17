---
title: Tools, Deploy & Test
impact: HIGH
tags: [tools, deploy, cdk, test, asana, langsmith, e2e]
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

### Deploy Pipeline

The deploy command orchestrates multiple CDK stacks in order:

1. **Webhook stack** — API Gateway + webhook Lambda + Secrets Manager.
2. **Runtime stack** — runtime Lambda + AgentCore Memory + IAM.
3. **Webhook registration** — reconciles Asana webhooks for configured resources.

### Deploy Script

```json
{
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "synth": "cdk synth",
    "deploy": "tsx scripts/deploy-agent-runtime.ts",
    "invoke": "tsx scripts/invoke-agent-runtime.ts"
  }
}
```

### Required Deploy Environment Variables

| Variable | Description |
| --- | --- |
| `ASANA_PAT` | Asana bot user PAT |
| `ASANA_BOT_USER_GID` | Bot user GID |
| `ASANA_WORKSPACE_GID` | Workspace GID |
| `ASANA_WEBHOOK_RESOURCE_GIDS` | Comma-separated resource GIDs to watch |
| `LANGSMITH_API_KEY` | LangSmith API key (stored in Secrets Manager by CDK) |
| `GITHUB_TOKEN` | Optional GitHub token when the agent reads GitHub content |

Create `.env.example` listing all required variables. Copy to `.env` for local deploys.

### CI/CD

Use the shared `Spring-Oaks-Capital-LLC/github-workflows` deploy workflow. Caller workflows use `secrets: inherit`. Add `LANGSMITH_API_KEY`, `ASANA_PAT`, and any optional API secrets such as `GITHUB_TOKEN` as repository secrets.

## Test

### Unit Tests

- Test tool execution logic in isolation.
- Test request/response contract schemas with Zod.
- Test event codec (encode/decode roundtrip).
- Test actor resolution logic.
- Run with `vitest`.

### CDK Synthesis Tests

- Verify all stacks synthesize without errors.
- Verify IAM permissions are scoped correctly.

### End-to-End Testing

E2E testing is done through real Asana interactions:

1. **Assign a task to the bot user** in a watched project.
2. **Verify the webhook fires** — check Lambda logs for the accepted delivery.
3. **Verify the agent responds** — check for a comment posted by the bot on the Asana task.
4. **Check LangSmith traces** — open the project in LangSmith, find the session, verify:
   - Root trace exists for the invocation.
   - Tool calls are visible in the trace tree.
   - No error spans.
5. **Test @mention** — comment on a task mentioning the bot user. Verify the agent processes the mention and responds.
6. **Verify duplicate protection** — one human action should produce one accepted runtime execution, not repeated duplicate runs.
7. **Verify review handoff** — if the workflow requires human review on completion, confirm the agent creates the linked review task instead of only tagging the requester.

### Testing Checklist

- [ ] Bot user created in Asana
- [ ] Webhook endpoint deployed and reachable
- [ ] Webhook handshake succeeds (check Secrets Manager for stored hook secret)
- [ ] Task assignment triggers the agent
- [ ]  Agent posts a comment on the task
- [ ] LangSmith traces appear in the correct project
- [ ] LangSmith trace tree shows tool/model child spans, not only the outer invocation
- [ ] @mention triggers the agent
- [ ] Duplicate triggers are deduped across repeated deliveries/retries
- [ ] AgentCore Memory persists conversation history across invocations

## ✅ Correct

```bash
# Deploy and verify
pnpm deploy
# Assign a task to the bot in Asana
# Check CloudWatch logs for webhook + runtime
# Check LangSmith for traces
# Check Asana for bot comment
```

## ❌ Incorrect

```bash
# ❌ Deploying without testing locally first
pnpm deploy  # Never tested build or synth

# ❌ Only unit tests, no E2E
pnpm test  # Passes, but webhook was never verified

# ❌ Skipping LangSmith verification
# "It works in Asana" — but traces show errors you can't see from Asana
```
