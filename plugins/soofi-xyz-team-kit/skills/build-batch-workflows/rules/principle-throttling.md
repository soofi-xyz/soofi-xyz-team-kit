---
title: Throttling, Concurrency Control, and External Dependency Boundaries
impact: HIGH
tags: throttling, concurrency, rate-limit, sqs, dlq, idempotency, distributed-map, p-throttle, lambda, external-api
---

## Throttling and Concurrency Control

**Ask the user** before building:
- What are the rate limits of the target system? (N requests per second/minute)
- What is the max concurrency the target system supports?
- Are there burst limits vs sustained limits?
- What are the retry, idempotency, and outage expectations of the target?
- Is this provider replaceable or likely to migrate in the future?

---

## External Dependency Boundary Decision: Sync vs Asynchronous (Queued)

When designing a workflow that interacts with an external dependency (vendor API, third-party service, webhook, or external partner endpoint):

### 1. Decision Criteria: Synchronous vs Asynchronous

| Scenario / Characteristic | Decision | Architectural Boundary |
| --- | --- | --- |
| Rate or concurrency limits exist (e.g. 10 req/s, 40 concurrent) | **Asynchronous (Queued)** | SQS queue with controlled consumer concurrency / `p-throttle` |
| Risk of outages, throttling, or prolonged latency spikes | **Asynchronous (Queued)** | SQS queue with exponential backoff retries and DLQ |
| Side-effect operations (charges, creates, dispatches, document uploads) | **Asynchronous (Queued)** | SQS queue with atomic idempotency store before external dispatch |
| Swappable provider or migration likelihood (SMS, email, OCR, servicing) | **Asynchronous (Queued)** | Canonical internal contract + provider-specific adapter interface |
| User-blocking synchronous read (interactive UI lookup, real-time auth) | **Synchronous (Direct)** | Inline call with strict timeout ($\le 5$s), circuit breaker, and fallback |
| Low-volume, trusted internal platform microservice read | **Synchronous (Direct)** | Inline SDK/HTTP call with standard timeout and retry budget |

### 2. Synchronous Exception Requirements
Synchronous external calls are **strictly exceptions** and are allowed ONLY when:
1. **Immediate response requirement:** The calling client or end-user is blocked waiting on the response to complete an interactive operation.
2. **Documented timeout:** Strict timeouts are set (typically 3–5 seconds maximum; never leave timeouts unbounded).
3. **Recovery & fallback strategy:** Documented behavior for when the external service returns 5xx, 429, or times out (e.g., cached fallback, degraded response, or explicit error boundary).

---

## Mandatory Queue-Based Recommendations

Every asynchronous external queue boundary must implement the following resilience patterns:

### 1. Bounded Consumer Concurrency
- Never allow queue workers to scale freely against rate-limited external APIs.
- Cap concurrency using Lambda `reservedConcurrentExecutions`, Step Functions `MaxConcurrency`, or a single-instance consumer with `p-throttle`.
- The maximum possible concurrent requests across all worker instances must never exceed the external system's concurrency ceiling.

### 2. Atomic Idempotency
- All calls producing side effects must compute a deterministic idempotency key from business identifiers (e.g. `hash(vendor, entity_id, action, date)`).
- Atomically record intent before dispatching (e.g. DynamoDB conditional `PutItem` with `attribute_not_exists(idempotency_key)` and TTL).
- If the worker retries or crashes mid-flight, duplicate dispatches are blocked.

### 3. Retries and Exponential Backoff with Jitter
- Handle HTTP 429 (rate-limited) and 5xx (server errors) with exponential backoff plus full jitter.
- Immediately fail fast on HTTP 4xx client errors (400, 401, 403, 404, 422) without retrying into the queue loop.

### 4. Consumer and Delivery DLQs
- Primary SQS queues MUST configure a Dead-Letter Queue (DLQ) with `maxReceiveCount` (typically 3 to 5).
- If using asynchronous destinations (SNS, EventBridge, Lambda destinations), configure delivery-failure DLQs so failed dispatches are never dropped.

### 5. Timeout-Safe Batch Sizing
- Calibrate SQS `batchSize` and Lambda `timeout` such that:
  $$\text{batchSize} \times \text{p99 external latency} + \text{buffer} < \text{Lambda timeout} \le \text{Queue visibilityTimeout}$$
- Avoid large batches (e.g., 100) if individual external calls can take 2–3 seconds; use smaller batches (5–10) or single-record dispatches.

### 6. Queue Depth, Age, Failure, and DLQ Monitoring
- **DLQ Alarm:** Every DLQ MUST have a CloudWatch Alarm triggering on `ApproximateNumberOfMessagesVisible > 0` wired to PagerDuty/SNS (per `observability-dlq-alarms`).
- **Age of Oldest Message:** Monitor `ApproximateAgeOfOldestMessage` on the primary queue to detect consumer stall or throttling lag before SLAs breach.
- **Queue Depth:** Alarm when queue depth exceeds expected burst backlog.

### 7. Staged Rollout and Redrive Procedures
- Provide a clear runbook for draining poisoned messages from the DLQ once the root cause or external outage is mitigated:
  - AWS CLI SQS `start-message-move-task` (native redrive).
  - Staged canary redrive (move 5 messages first to verify resolution before moving the entire DLQ).

### 8. Migration Likelihood and Adapter Boundaries
- Never couple internal workflow payloads to external vendor schema.
- Implement an **Adapter Interface**:
  ```typescript
  export interface ExternalCommunicationAdapter {
    send(payload: CanonicalNotification): Promise<ProviderDispatchResult>;
    checkStatus(externalId: string): Promise<DeliveryStatus>;
  }
  ```
- Swapping the external provider becomes an adapter change without modifying the queue, Step Functions, or upstream business logic.

---

## Strategy Selection

| Target System Limit | Strategy |
| --- | --- |
| Concurrency limit only (e.g., max 40 parallel requests) | Distributed Map `MaxConcurrency` + Lambda reserved concurrency |
| Rate limit per time window (e.g., 100 req/min) | SQS + single-instance Lambda with `p-throttle` + task tokens |
| Both rate and concurrency limits | SQS + controlled concurrency Lambda with `p-throttle` |

---

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

---

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
        ├── Calls external system (via Adapter interface)
        └── Reports back via SendTaskSuccess / SendTaskFailure
```

#### How It Works

1. The Distributed Map sends each record to an SQS queue, including a Step Functions **task token**.
2. A **single-instance Lambda** (reserved concurrency = 1) consumes from the queue.
3. The Lambda uses **`p-throttle`** to enforce the exact rate limit (e.g., 100 calls per 60 seconds).
4. After each call, the Lambda reports success/failure back to the state machine using the task token.

#### ✅ Correct (Full Resilience Pattern with DLQ and Adapter)

```typescript
// Lambda processor with p-throttle, idempotency, and adapter
import pThrottle from 'p-throttle';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import type { SQSEvent } from 'aws-lambda';

const sfnClient = new SFNClient({});

// 100 calls per 60 seconds — matches target system's rate limit
const throttle = pThrottle({ limit: 100, interval: 60_000 });

// Adapter interface for swappable external provider
interface ExternalVendorAdapter {
  dispatchRecord(record: Record<string, unknown>): Promise<{ remoteId: string }>;
}

const vendorAdapter: ExternalVendorAdapter = {
  async dispatchRecord(record) {
    const response = await fetch('https://target-system.example.com/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!response.ok) {
      throw new Error(`Target rejected: ${response.status} ${await response.text()}`);
    }
    return response.json();
  },
};

const throttledCall = throttle(async (record: Record<string, unknown>) => {
  return vendorAdapter.dispatchRecord(record);
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
      // Retriable vs terminal error check
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
// CDK: Distributed Map step that sends to SQS with task token, DLQ, and alarm
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';

// 1. DLQ with self-resolving alarm
const dlq = new sqs.Queue(this, 'ThrottleDlq', {
  retentionPeriod: cdk.Duration.days(14),
});

const dlqAlarm = new cloudwatch.Alarm(this, 'ThrottleDlqAlarm', {
  metric: dlq.metricApproximateNumberOfMessagesVisible({
    period: cdk.Duration.minutes(1),
    statistic: 'Maximum',
  }),
  threshold: 0,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
dlqAlarm.addAlarmAction(new cwActions.SnsAction(channelTopic));
dlqAlarm.addOkAction(new cwActions.SnsAction(channelTopic));

// 2. Primary Queue
const throttleQueue = new sqs.Queue(this, 'ThrottleQueue', {
  visibilityTimeout: cdk.Duration.minutes(5),
  deadLetterQueue: {
    maxReceiveCount: 3,
    queue: dlq,
  },
});

// 3. Step Functions integration
const sendToQueue = new tasks.SqsSendMessage(this, 'SendToThrottleQueue', {
  queue: throttleQueue,
  integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
  messageBody: sfn.TaskInput.fromObject({
    taskToken: sfn.JsonPath.taskToken,
    record: sfn.JsonPath.entirePayload,
  }),
});

const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 200, // Safe since SQS + Lambda govern the rate
});
distributedMap.itemProcessor(sendToQueue);

// 4. Single-instance Lambda reads from queue
const throttleLambda = new lambda.Function(this, 'ThrottledDelivery', {
  reservedConcurrentExecutions: 1, // Exactly one instance — p-throttle controls rate
  timeout: cdk.Duration.minutes(1),
});
throttleQueue.grantConsumeMessages(throttleLambda);

new lambdaEvents.SqsEventSource(throttleQueue, {
  batchSize: 5, // Timeout-safe batch size
  maxConcurrency: 1,
});
```

---

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

```typescript
// Direct unthrottled inline call to external provider in batch loop without queue or DLQ
for (const item of items) {
  await directExternalApiCall(item); // ❌ Outage/rate-limit fails entire run; unmanaged retries
}
```

---

### References

- [`external-dependency-boundaries.md`](../../apply-engineering-guidelines/rules/external-dependency-boundaries.md) — Canonical Golden Path boundary standard
- [p-throttle npm package](https://www.npmjs.com/package/p-throttle)
- [Step Functions task tokens](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token)
- [SQS event source for Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Lambda reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
