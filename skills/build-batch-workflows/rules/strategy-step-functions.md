---
title: Step Functions Distributed Map Strategy
impact: CRITICAL
tags: step-functions, distributed-map, data-movement, rename, transform, lambda
---

## Step Functions Distributed Map Strategy

Use Step Functions with Distributed Map for workflows that move data between systems, rename fields, apply simple transforms, or route records. This is the default choice when no heavy computation is required.

### When to Use

- Field renames and schema mapping
- Data movement between S3 buckets or to external systems
- Record-level filtering and routing
- Fan-out processing where each record is independent

### Architecture

```
S3 (input) → Step Function
               ├── Cost Prediction (Lambda)
               ├── Distributed Map
               │     ├── Validate Input (inline)
               │     ├── Transform (Lambda)
               │     └── Write to Target (Lambda)
               └── Emit Metrics (Lambda)
```

### Key Settings

- Set `MaxConcurrency` on the Distributed Map to control parallelism.
- Use `ItemReader` to read directly from S3 (CSV, JSON, or manifest).
### ✅ Correct

```typescript
// CDK definition for Distributed Map with concurrency control
const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  maxConcurrency: 40,
  itemReader: new sfn.S3JsonItemReader({
    bucket: inputBucket,
    key: sfn.JsonPath.stringAt('$.inputKey'),
  }),
});

distributedMap.itemProcessor(processLambdaStep);
```

### ❌ Incorrect

```typescript
// No MaxConcurrency — unbounded parallelism overwhelms target systems
const distributedMap = new sfn.DistributedMap(this, 'ProcessRecords', {
  // maxConcurrency not set — defaults to unlimited
});
```

```typescript
// Using standard Map instead of Distributed Map for large datasets
// Standard Map has a 40-item limit and runs in a single execution
const map = new sfn.Map(this, 'ProcessRecords', {
  maxConcurrency: 10,
});
```

### References

- [Distributed Map state](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-asl-use-map-state-distributed.html)
- [Step Functions CDK constructs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions-readme.html)
