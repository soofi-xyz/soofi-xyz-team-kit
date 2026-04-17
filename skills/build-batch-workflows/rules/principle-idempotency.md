---
title: Idempotency and Recoverability
impact: HIGH
tags: idempotency, retry, redrive, recovery, step-functions, distributed-map
---

## Idempotency and Recoverability

Every batch workflow MUST be retriable, redrivable, and recoverable. The core rule: **never do the same work twice.**

Achieve this at the **Step Functions Distributed Map level**, not at the Lambda level. Distributed Map tracks which child executions succeeded and which failed — on redrive, only failed items are retried.

### Requirements

1. **Redrivable:** Use Distributed Map's built-in redrive to retry only failed child executions from the point of failure.
2. **Retriable:** Configure `Retry` policies on individual states within the Distributed Map item processor to handle transient errors.
### How It Works

1. Distributed Map processes each item as an independent child execution.
2. If some items fail, the map execution enters a `FAILED` state.
3. **Redrive** the execution — only failed items are retried. Succeeded items are skipped automatically.

### ✅ Correct

```typescript
// CDK: Distributed Map with retry and redrive
const processStep = new tasks.LambdaInvoke(this, 'ProcessRecord', {
  lambdaFunction: processLambda,
  resultPath: '$.result',
});

// Retry transient errors within each child execution
processStep.addRetry({
  errors: ['States.TaskFailed', 'Lambda.ServiceException'],
  interval: cdk.Duration.seconds(2),
  maxAttempts: 3,
  backoffRate: 2,
});

const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 40,
  itemReader: new sfn.S3JsonItemReader({
    bucket: inputBucket,
    key: sfn.JsonPath.stringAt('$.inputKey'),
  }),
});

distributedMap.itemProcessor(processStep);

// After failure, redrive from the Step Functions console or via API:
// aws stepfunctions redrive-execution --execution-arn <arn>
// Only failed child executions are retried — succeeded items are skipped.
```

### ❌ Incorrect

```typescript
// No retry policy — transient errors immediately fail the entire workflow
const processStep = new tasks.LambdaInvoke(this, 'ProcessRecord', {
  lambdaFunction: processLambda,
});
// Missing: addRetry() for transient errors
```

```typescript
// Re-processing everything from scratch on failure
// instead of using Distributed Map redrive
const allRecords = await s3.getObject({ Bucket: bucket, Key: inputKey });
for (const record of allRecords) {
  await process(record); // Re-processes already completed records
}
```

### References

- [Step Functions redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)
- [Distributed Map error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)

