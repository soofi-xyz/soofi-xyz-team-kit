---
title: Cost Prediction Gate
impact: CRITICAL
tags: cost, prediction, approval, budget, guard, step-functions, metrics
---

## Cost Prediction Gate

Every batch workflow MUST begin with a cost prediction step that estimates processing cost before any data is touched.

### How It Works

1. **Step 1 of every workflow** is a Lambda that calculates estimated cost based on input data volume.
2. Compare estimated cost against a **cost ceiling** (configured per workflow).
3. If estimated cost **≤ ceiling** → proceed automatically.
4. If estimated cost **> ceiling** → pause the workflow and require manual approval.

**Ask the user:** "What is the cost ceiling (in USD) for this workflow?"

### Architecture

```
Step Function Start
  └── Cost Prediction (Lambda)
        ├── ≤ ceiling → Continue to processing
        └── > ceiling → Wait for Approval (callback task)
                          ├── Approved → Continue
                          └── Rejected / Timeout → Fail
```

### Cost Prediction Metric

The cost prediction Lambda MUST emit a `CostPredicted` metric every time it runs. Use Powertools Metrics with a `service` dimension whose value matches the CDK `project_name` tag used for the stack.

| Metric | Unit | Dimension |
| --- | --- | --- |
| `CostPredicted` | None (USD value) | `service` = value of the CDK `project_name` tag |

### What to Estimate

- **Lambda invocations:** count × average duration × price per GB-second
- **Glue DPU-hours:** estimated DPUs × estimated duration
- **S3 requests:** GET/PUT request counts
- **Data transfer:** if moving data across regions or to external systems

### ✅ Correct

```typescript
// Cost prediction Lambda
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const SERVICE_NAME = 'my-batch-service'; // Must match CDK project_name tag

const metrics = new Metrics({ serviceName: SERVICE_NAME, namespace: SERVICE_NAME });

interface CostInput {
  recordCount: number;
  avgRecordSizeBytes: number;
  costCeilingUsd: number;
  taskToken?: string;
}

export const handler = async (event: CostInput) => {
  const estimatedLambdaInvocations = event.recordCount;
  const estimatedDurationSec = 0.5; // avg per record
  const lambdaCostPerInvocation = 0.0000002 + (128 / 1024) * estimatedDurationSec * 0.0000166667;
  const estimatedCost = estimatedLambdaInvocations * lambdaCostPerInvocation;

  // Emit cost prediction metric — dimension "service" matches CDK project_name tag
  metrics.addDimension('service', SERVICE_NAME);
  metrics.addMetric('CostPredicted', MetricUnit.None, estimatedCost);
  metrics.publishStoredMetrics();

  if (estimatedCost > event.costCeilingUsd) {
    return {
      status: 'APPROVAL_REQUIRED',
      estimatedCostUsd: estimatedCost.toFixed(4),
      ceilingUsd: event.costCeilingUsd,
      message: `Estimated cost $${estimatedCost.toFixed(4)} exceeds ceiling $${event.costCeilingUsd}. Manual approval required.`,
    };
  }

  return {
    status: 'APPROVED',
    estimatedCostUsd: estimatedCost.toFixed(4),
  };
};
```

```typescript
// CDK: Cost gate with approval wait
const costPrediction = new tasks.LambdaInvoke(this, 'PredictCost', {
  lambdaFunction: costPredictionLambda,
  resultPath: '$.costEstimate',
});

const waitForApproval = new tasks.LambdaInvoke(this, 'WaitForApproval', {
  lambdaFunction: approvalLambda,
  integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
  payload: sfn.TaskInput.fromObject({
    taskToken: sfn.JsonPath.taskToken,
    estimatedCost: sfn.JsonPath.stringAt('$.costEstimate.Payload.estimatedCostUsd'),
  }),
  timeout: cdk.Duration.hours(24),
});

const isOverBudget = new sfn.Choice(this, 'OverBudget?')
  .when(
    sfn.Condition.stringEquals('$.costEstimate.Payload.status', 'APPROVAL_REQUIRED'),
    waitForApproval.next(processData)
  )
  .otherwise(processData);

const workflow = costPrediction.next(isOverBudget);
```

### ❌ Incorrect

```typescript
// No cost gate — workflow starts processing immediately
const workflow = new sfn.StateMachine(this, 'BatchWorkflow', {
  definitionBody: sfn.DefinitionBody.fromChainable(processData), // Skips cost check
});
```

### References

- [Step Functions callback pattern](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token)
- [AWS pricing calculator](https://calculator.aws/)
