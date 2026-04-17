---
title: Lambda Runtime Boundaries
impact: CRITICAL
tags: [architecture, lambda, runtime, decision]
---

# Lambda Runtime Boundaries

This skill supports **AWS Lambda only** for agent runtime. Do not use AgentCore as the runtime for agents built from this skill.

Validate the design against Lambda constraints **before** writing agent code.

## Boundary Check

Ask these questions in order:

1. **Can every invocation finish within Lambda limits?**
   - No → re-scope the workflow into smaller turns, or move long-running work to Step Functions / batch infrastructure outside the agent runtime.
2. **Can all state live outside the runtime?** (AgentCore Memory, DynamoDB, S3, Secrets Manager, queues)
   - No → redesign the state model. Lambda runtimes must be disposable.
3. **Are the tools API/store based rather than local shell/git workflows?**
   - No → move shell/git work into a separate automation system. Do not add bash-driven repo workflows to the agent runtime.
4. **Can retries and duplicate deliveries be tolerated idempotently?**
   - No → add dedupe, idempotency keys, and external checkpoints before proceeding.

If all four answers are yes, the design fits this skill.

## What Lambda Gives You

- **Lambda runtime** for the AI turn processor.
- **Thin webhook Lambda** behind API Gateway for Asana ingress.
- **External state** in AgentCore Memory, DynamoDB, S3, Secrets Manager, and other managed stores.
- **Async invocation + retry control** with EventInvokeConfig and dedupe.
- **Fast deploys and simpler operations** than containerized runtime approaches.

## Recommended Adaptations

- Need chat history: store typed conversation events in AgentCore Memory.
- Need large artifacts: write them to S3 and pass references through the agent.
- Need expensive preprocessing: run it before the agent turn or hand off to Step Functions.
- Need repo automation or bash: treat that as a separate automation service, not part of the Lambda agent runtime.

## Bootstrap Pattern

```typescript
import { ToolLoopAgent } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

export const handler = async (event: RuntimeInvocation) => {
  const deps = await loadDependencies();
  const bedrock = createAmazonBedrock({ region: deps.env.AWS_REGION });
  const model = bedrock(deps.env.BEDROCK_MODEL_ID);

  const agent = new ToolLoopAgent({ model, tools: deps.tools, system });
  return agent.run(buildPrompt(event));
};
```

## ✅ Correct

```
Q: The agent answers Asana requests using APIs and managed data stores.
A: External state + API tools + short turns → Lambda runtime ✅

Q: The agent needs conversation history across invocations.
A: Store history in AgentCore Memory and keep runtime stateless → Lambda runtime ✅
```

## ❌ Incorrect

```
# Using the runtime for git/bash workflows
export const handler = async () => {
  execSync('git clone ...'); // ❌ Not a Lambda-friendly agent tool path
};

# Solving >15 minute work by switching to AgentCore
// ❌ Re-scope the workflow instead of changing the runtime model
```
