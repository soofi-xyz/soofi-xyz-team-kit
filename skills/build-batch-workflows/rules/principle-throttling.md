---
title: Throttling and Concurrency Control
impact: HIGH
tags: throttling, concurrency, rate-limit, sqs, distributed-map, p-throttle, lambda
---

## Throttling and Concurrency Control

**Ask the user** before building:
- What are the rate limits of the target system? (N requests per second/minute)
- What is the max concurrency the target system supports?
- Are there burst limits vs sustained limits?

### Strategy Selection

| Target System Limit | Strategy |
| --- | --- |
| Concurrency limit only (e.g., max 40 parallel requests) | Distributed Map `MaxConcurrency` + Lambda reserved concurrency |
| Rate limit per time window (e.g., 100 req/min) | SQS + single-instance Lambda with `p-throttle` + task tokens |
| Both | Combine both strategies |

### Strategy 1: Concurrency-Only Limits

Use `MaxConcurrency` on the Distributed Map and reserved concurrency on the Lambda.

```typescript
// CDK
const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 40, // Match target system's concurrency limit
});

const deliveryLambda = new lambda.Function(this, 'DeliverToTarget', {
  reservedConcurrentExecutions: 40, // Hard cap on concurrent executions
  // ...
});
```

### Strategy 2: Rate-Limited Target Systems (SQS + p-throttle + Task Tokens)

When the external system enforces a rate limit per time window (e.g., 100 requests per minute), Distributed Map alone cannot enforce time-based throttling. Use this architecture:

```
Step Function
  └── Distributed Map
        └── For each record:
              ├── Send to SQS (with task token)
              └── Wait for callback (.waitForTaskToken)

SQS Queue
  └── Lambda (reserved concurrency = 1)
        ├── Reads messages
        ├── Applies rate limit via p-throttle
        ├── Calls external system
        └── Reports back via SendTaskSuccess / SendTaskFailure
```

#### How It Works

1. The Distributed Map sends each record to an SQS queue, including a Step Functions **task token**.
2. A **single-instance Lambda** (reserved concurrency = 1) consumes from the queue.
3. The Lambda uses **`p-throttle`** to enforce the exact rate limit (e.g., 100 calls per 60 seconds).
4. After each call, the Lambda reports success/failure back to the state machine using the task token.

#### ✅ Correct

```typescript
// Lambda processor with p-throttle
import pThrottle from 'p-throttle';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import type { SQSEvent } from 'aws-lambda';

const sfnClient = new SFNClient({});

// 100 calls per 60 seconds — matches target system's rate limit
const throttle = pThrottle({ limit: 100, interval: 60_000 });

const throttledCall = throttle(async (record: Record<string, unknown>) => {
  const response = await fetch('https://target-system.example.com/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });

  if (!response.ok) {
    throw new Error(`Target rejected: ${response.status} ${await response.text()}`);
  }

  return response.json();
});

export const handler = async (event: SQSEvent) => {
  for (const sqsRecord of event.Records) {
    const { taskToken, record } = JSON.parse(sqsRecord.body);

    try {
      const result = await throttledCall(record);
      await sfnClient.send(new SendTaskSuccessCommand({
        taskToken,
        output: JSON.stringify({ status: 'success', result }),
      }));
    } catch (error) {
      await sfnClient.send(new SendTaskFailureCommand({
        taskToken,
        error: 'DeliveryFailed',
        cause: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }
};
```

```typescript
// CDK: Distributed Map step that sends to SQS with task token
const sendToQueue = new tasks.SqsSendMessage(this, 'SendToThrottleQueue', {
  queue: throttleQueue,
  integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
  messageBody: sfn.TaskInput.fromObject({
    taskToken: sfn.JsonPath.taskToken,
    record: sfn.JsonPath.entirePayload,
  }),
});

const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 200, // Can be higher since SQS + Lambda handle the real throttle
});
distributedMap.itemProcessor(sendToQueue);

// Single-instance Lambda reads from queue
const throttleLambda = new lambda.Function(this, 'ThrottledDelivery', {
  reservedConcurrentExecutions: 1, // Exactly one instance — p-throttle controls rate
  timeout: cdk.Duration.minutes(15),
  // ...
});
throttleQueue.grantConsumeMessages(throttleLambda);

new lambdaEvents.SqsEventSource(throttleQueue, {
  batchSize: 10,
  maxConcurrency: 1,
});
```

#### ❌ Incorrect

```typescript
// Using Distributed Map MaxConcurrency for rate limiting
// This controls parallelism, NOT rate per time window
const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 100, // This is NOT "100 per minute" — it's 100 concurrent
});
```

```typescript
// Multiple Lambda instances each with their own p-throttle
// Each instance throttles independently — total rate = N × limit
const throttleLambda = new lambda.Function(this, 'ThrottledDelivery', {
  reservedConcurrentExecutions: 5, // 5 instances × 100/min = 500/min — exceeds limit
});
```

### References

- [p-throttle npm package](https://www.npmjs.com/package/p-throttle)
- [Step Functions task tokens](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token)
- [SQS event source for Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Lambda reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
