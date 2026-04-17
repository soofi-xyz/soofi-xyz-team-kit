---
title: Logging, Tracing, and Observability
impact: HIGH
tags: logging, tracing, xray, cloudwatch, observability, structured-logs, json, powertools
---

## Logging, Tracing, and Observability

Use [**AWS Lambda Powertools**](https://docs.aws.amazon.com/powertools/typescript/latest/) for all observability concerns. Do NOT use `console.log`, raw `console.error`, or manual X-Ray SDK calls.

### Required Powertools Modules

| Module | TypeScript | Python |
| --- | --- | --- |
| Logger | `@aws-lambda-powertools/logger` | `aws_lambda_powertools.Logger` |
| Tracer | `@aws-lambda-powertools/tracer` | `aws_lambda_powertools.Tracer` |
| Metrics | `@aws-lambda-powertools/metrics` | `aws_lambda_powertools.Metrics` |

Every Lambda handler MUST initialize all three: **Logger**, **Tracer**, and **Metrics**.

### Logging Standards

| Setting | Standard |
| --- | --- |
| Format | [Structured logging (JSON)](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html) via Powertools Logger |
| Levels | Use Powertools log levels (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
| Retention | **90 days** on all log groups |
| Sink | **AWS CloudWatch** |

### Tracing

- Use **Powertools Tracer** (wraps X-Ray) on every Lambda.
- Enable active tracing on all Lambda functions in CDK (`tracing: lambda.Tracing.ACTIVE`).
- Use `@tracer.captureMethod()` / `tracer.captureMethod` decorators for key downstream calls.

### Security — Non-Negotiable

**NEVER log passwords, tokens, secrets, or PII.**

### ✅ Correct

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'payment-api' });
const tracer = new Tracer({ serviceName: 'payment-api' });
const metrics = new Metrics({ serviceName: 'payment-api', namespace: 'PaymentService' });

export const handler = async (event: APIGatewayProxyEvent) => {
  logger.info('Payment initiated', {
    orderId: event.pathParameters?.orderId,
    amount: body.amount,
    currency: body.currency,
  });

  const subsegment = tracer.getSegment()?.addNewSubsegment('processPayment');
  try {
    const result = await processPayment(body);
    subsegment?.close();
    metrics.addMetric('PaymentProcessed', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    subsegment?.addError(error as Error);
    subsegment?.close();
    metrics.addMetric('PaymentFailed', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    logger.error('Payment failed', { orderId: event.pathParameters?.orderId, error });
    throw error;
  }
};
```

```python
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit

logger = Logger(service="data-pipeline")
tracer = Tracer(service="data-pipeline")
metrics = Metrics(service="data-pipeline", namespace="DataPipeline")

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event, context):
    batch_size = len(event["Records"])
    logger.info("Processing batch", extra={"batch_size": batch_size})
    # process records...
    metrics.add_metric(name="RecordsProcessed", unit=MetricUnit.Count, value=batch_size)
```

### ❌ Incorrect

```typescript
// console.log — unstructured, not searchable, no correlation
console.log('payment for user', userId, 'with token', authToken);
//                                              ^^^ NEVER log secrets!

// No Powertools Logger/Tracer/Metrics — missing structured observability
```

### References

- [AWS Lambda Powertools for TypeScript](https://docs.aws.amazon.com/powertools/typescript/latest/)
- [AWS Lambda Powertools for Python](https://docs.powertools.aws.dev/lambda/python/latest/)
- [Powertools Logger](https://docs.aws.amazon.com/powertools/typescript/latest/core/logger/)
- [Powertools Tracer](https://docs.aws.amazon.com/powertools/typescript/latest/core/tracer/)
- [Powertools Metrics](https://docs.aws.amazon.com/powertools/typescript/latest/core/metrics/)
