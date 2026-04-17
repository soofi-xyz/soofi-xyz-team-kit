---
title: Service Metrics
impact: CRITICAL
tags: metrics, cloudwatch, powertools, observability, monitoring, alarms, lexicon, dashboard
---

## Service Metrics

Every service MUST emit custom metrics that reflect its business-level work. Use **Powertools Metrics** (`@aws-lambda-powertools/metrics` / `aws_lambda_powertools.Metrics`) — do NOT publish metrics via raw CloudWatch SDK calls.

### Non-Negotiable: Lexicon Registration + Dashboard

These two rules can **NEVER** be violated. A metric that exists in code but is missing from either the Lexicon or the Dashboard is a broken deployment.

1. **Every metric MUST be registered in the Lexicon** — add an entry to [`cloudwatch-metrics.json`](https://github.com/Spring-Oaks-Capital-LLC/lexicon/blob/main/src/data/cloudwatch-metrics.json) in the [Lexicon repo](https://github.com/Spring-Oaks-Capital-LLC/lexicon). If a metric is not in the Lexicon, it does not officially exist.
2. **Every metric MUST be displayed on the Main Dashboard** — add a widget to the [Main Dashboard repo](https://github.com/Spring-Oaks-Capital-LLC/main-dashboard). If a metric is not on the dashboard, it is invisible to the team.

When adding a new metric, the PR MUST include changes to **all three**:
- The service code (emit the metric)
- The Lexicon (`cloudwatch-metrics.json` entry)
- The Main Dashboard (widget/panel)

### Required Metrics Per Service

Every service MUST emit at minimum:

| Metric | When to emit | Unit |
| --- | --- | --- |
| `{Item}Processed` | Each successfully processed item | Count |
| `{Item}Failed` | Each failed item | Count |
| `ProcessingDuration` | Per invocation or per-item | Milliseconds |

Replace `{Item}` with the domain noun the service handles (e.g., `OrderProcessed`, `RecordIngested`, `NotificationSent`, `FileConverted`).

### Naming Conventions

- Use **PascalCase** for metric names: `OrderProcessed`, not `order_processed`.
- Use the **service name** as the `namespace`: `Metrics({ namespace: 'PaymentService' })`.
- Add **dimensions** to slice metrics: `service`, `environment`, `operation`.

### Metric Dimensions

Add dimensions to make metrics filterable. At minimum include:

- `service` — the service name (set via Powertools `serviceName`)
- Additional dimensions as relevant: `operation`, `status`, `source`

### ✅ Correct

```typescript
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const metrics = new Metrics({ serviceName: 'order-service', namespace: 'OrderService' });

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const start = Date.now();
    try {
      await processOrder(JSON.parse(record.body));
      metrics.addMetric('OrderProcessed', MetricUnit.Count, 1);
      metrics.addMetric('ProcessingDuration', MetricUnit.Milliseconds, Date.now() - start);
    } catch (error) {
      metrics.addMetric('OrderFailed', MetricUnit.Count, 1);
      throw error;
    }
  }
  metrics.publishStoredMetrics();
};
```

```python
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
import time

metrics = Metrics(service="ingestion-service", namespace="IngestionService")

@metrics.log_metrics
def handler(event, context):
    for record in event["Records"]:
        start = time.time()
        try:
            process_record(record)
            metrics.add_metric(name="RecordIngested", unit=MetricUnit.Count, value=1)
            duration_ms = (time.time() - start) * 1000
            metrics.add_metric(name="ProcessingDuration", unit=MetricUnit.Milliseconds, value=duration_ms)
        except Exception:
            metrics.add_metric(name="RecordFailed", unit=MetricUnit.Count, value=1)
            raise
```

### ❌ Incorrect

```typescript
// No business metrics — only Lambda-level defaults exist
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    await processOrder(JSON.parse(record.body));
  }
  // Service processes orders but emits zero custom metrics
};
```

```typescript
// Raw CloudWatch SDK instead of Powertools Metrics
import { CloudWatch } from '@aws-sdk/client-cloudwatch';
const cw = new CloudWatch({});
await cw.putMetricData({ ... }); // Do NOT do this — use Powertools Metrics
```

```typescript
// Metric emitted in code but NOT registered in Lexicon and NOT on Dashboard
// This is a violation — all three must be updated together
metrics.addMetric('OrderProcessed', MetricUnit.Count, 1);
// ❌ Missing: cloudwatch-metrics.json entry in Lexicon repo
// ❌ Missing: widget in Main Dashboard repo
```

### References

- [Lexicon — cloudwatch-metrics.json](https://github.com/Spring-Oaks-Capital-LLC/lexicon/blob/main/src/data/cloudwatch-metrics.json)
- [Main Dashboard repo](https://github.com/Spring-Oaks-Capital-LLC/main-dashboard)
- [Powertools Metrics — TypeScript](https://docs.aws.amazon.com/powertools/typescript/latest/core/metrics/)
- [Powertools Metrics — Python](https://docs.powertools.aws.dev/lambda/python/latest/core/metrics/)
- [CloudWatch custom metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/publishingMetrics.html)
