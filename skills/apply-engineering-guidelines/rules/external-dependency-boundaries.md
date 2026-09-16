---
title: External Dependency Boundaries (Sync vs Queued)
impact: CRITICAL
tags: external-api, sync, async, sqs, dlq, throttling, idempotency, adapter, resilience
---

## External Dependency Boundaries

Workflows and services that call external APIs (third-party services, vendor webhooks, external partner endpoints, and external provider APIs like Interprose, SMS/email gateways, payment networks, or external bureaus) MUST adhere to a consistent dependency boundary design.

### Canonical Decision Rule

1. **Default to Asynchronous (Queued):** Any call to an external dependency MUST be handled asynchronously through a queued boundary (SQS queue or Step Functions event/task queue) whenever ANY of the following conditions hold:
   - **Rate or concurrency limits exist:** The target has request-per-second, request-per-minute, or maximum concurrent connection caps.
   - **Outage, throttling, or retry resilience matters:** The external service is outside our availability envelope; transient errors, timeouts, or downtime must not fail the upstream business process or exhaust workflow timeouts.
   - **Side-effect and idempotency requirements:** The call creates, mutates, or charges an external resource and requires atomic at-least-once delivery with deduplication.
   - **Provider migration or multi-vendor likelihood:** The external provider is swappable or likely to change (e.g. communications, document processing, enrichment). Calls MUST pass through an adapter boundary behind the queue.

2. **Synchronous Exception Criteria:** A direct synchronous call is permitted ONLY when ALL of the following criteria are met:
   - **Immediate user/caller response required:** An interactive user or client is waiting in a synchronous request-response cycle where the response payload is mandatory to complete the HTTP transaction.
   - **Low volume and high reliability:** The call volume is bounded and does not risk cascade failure.
   - **Documented timeout and recovery strategy:** The call MUST enforce a strict client timeout ($\le 5$ seconds default), a circuit-breaker or bulkhead partition, and a clear fallback/recovery behavior if the external call fails or times out.

### Mandatory Queue-Based Recommendations

Every queued external-dependency boundary MUST incorporate the following safeguards:

1. **Bounded Consumer Concurrency:**
   - Enforce hard limits on worker concurrency (e.g., Lambda `reservedConcurrentExecutions`, Step Functions `MaxConcurrency`, or single-worker queue consumers with `p-throttle`) to strictly guarantee the target external rate limit is never exceeded.
2. **Atomic Idempotency:**
   - Every external call with side effects MUST compute an idempotent key (e.g., deterministic hash of payload + entity ID + sequence number) verified against an atomic store (such as DynamoDB conditional writes with TTL) before executing the call.
3. **Retries with Exponential Backoff and Jitter:**
   - Transient failures (HTTP 429, 500, 502, 503, 504, socket timeouts) MUST use exponential backoff with full jitter. Never retry non-retriable errors (HTTP 400, 401, 403, 404, 422).
4. **Consumer and Delivery DLQs:**
   - The queue MUST have a Dead-Letter Queue (DLQ) with a defined `maxReceiveCount` (typically 3 to 5).
   - If downstream delivery uses SNS, EventBridge, or Lambda async destinations, configure delivery DLQs to capture payload failures.
5. **Timeout-Safe Batch Sizing:**
   - Consumer batch size (e.g., SQS `batchSize`) must be calibrated so that processing the entire batch under worst-case p99 external latency never approaches the consumer Lambda or task timeout.
6. **Queue Depth, Age, Failure, and DLQ Monitoring:**
   - Every DLQ MUST have a CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` connected to PagerDuty/SNS (per `observability-dlq-alarms`).
   - Monitor `ApproximateAgeOfOldestMessage` on the primary queue to catch lag or consumer starvation before SLAs are breached.
7. **Staged Rollout and Redrive Procedures:**
   - Every queued integration MUST provide a documented redrive procedure (e.g., SQS StartMessageMoveTask or replay CLI script) to drain poisoned messages after a defect or outage is resolved.

### Adapter Boundary for Migrations

When integrating with external providers that may be replaced or augmented with secondary providers (e.g., email/SMS delivery, CRM/servicing APIs, verification providers):
- Decouple the internal domain model from the external provider's API.
- Define a TypeScript interface/adapter in front of the provider SDK.
- The queue message body carries internal canonical contracts; the worker adapter translates from internal canonical schema to external vendor payload.

---

### ✅ Correct (Queued External Boundary)

```typescript
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvents from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export class ExternalDispatchBoundary extends Construct {
  constructor(scope: Construct, id: string, props: { channelTopic: cdk.aws_sns.ITopic }) {
    super(scope, id);

    // 1. DLQ with CloudWatch Alarm per observability-dlq-alarms
    const dlq = new sqs.Queue(this, 'ExternalDispatchDlq', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const dlqAlarm = new cloudwatch.Alarm(this, 'ExternalDispatchDlqAlarm', {
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cwActions.SnsAction(props.channelTopic));
    dlqAlarm.addOkAction(new cwActions.SnsAction(props.channelTopic));

    // 2. Main processing queue with DLQ attachment
    const queue = new sqs.Queue(this, 'ExternalDispatchQueue', {
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
    });

    // 3. Worker with bounded concurrency strictly within external provider limits.
    // NOTE: reservedConcurrentExecutions: 5 enforces the provider's *concurrency* cap (max 5 parallel calls).
    // For *time-window rate limits* (e.g. 20 req/sec), use reservedConcurrentExecutions: 1 with p-throttle
    // (see principle-throttling Strategy 2) so independent workers do not multiply the rate limit.
    const worker = new lambda.Function(this, 'ExternalDispatchWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist/worker'),
      timeout: cdk.Duration.seconds(60), // Well below queue visibility timeout
      reservedConcurrentExecutions: 5,   // Bounded concurrency matches vendor parallel connection cap
    });

    worker.addEventSource(new lambdaEvents.SqsEventSource(queue, {
      batchSize: 5, // Timeout-safe batch size
      maxConcurrency: 5,
    }));
  }
}
```

---

### ❌ Incorrect (Unbounded Direct Inline Calls)

```typescript
// BAD: Calling external third-party API directly from batch Step Function or loop
// ❌ No queue boundary
// ❌ No rate-limit protection (burst will trigger 429 / IP ban)
// ❌ Unhandled external outage fails the entire pipeline execution
// ❌ No idempotency key; retries create duplicate external operations
export const handler = async (event: { debts: Array<{ id: string; amount: number }> }) => {
  for (const debt of event.debts) {
    await fetch('https://external-vendor.com/api/v1/settlements', {
      method: 'POST',
      body: JSON.stringify(debt),
    });
  }
};
```

---

### References

- [`principle-throttling.md`](../../build-batch-workflows/rules/principle-throttling.md) — Detailed queuing, concurrency control, and rate-limiting patterns
- [`observability-dlq-alarms.md`](./observability-dlq-alarms.md) — Standard self-resolving DLQ alarms
- [`observability-pagerduty-alerting.md`](./observability-pagerduty-alerting.md) — Critical failure alerting
