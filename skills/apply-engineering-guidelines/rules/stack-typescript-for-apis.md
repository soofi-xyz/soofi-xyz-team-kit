---
title: TypeScript for All Services
impact: CRITICAL
tags: typescript, language, api, lambda, serverless, node, batch, step-functions
---

## TypeScript for All Services

**TypeScript is the default and required language for ALL services** — APIs, Lambdas, batch jobs, Step Functions, and any other workload. The only exception is PySpark + AWS Glue jobs (see `stack-python-for-data`).

### Standards

- Use **esbuild** for bundling to minimize cold starts.
- Use [**AWS Lambda Powertools for TypeScript**](https://docs.aws.amazon.com/powertools/typescript/latest/) on every Lambda for standardized logging, tracing, and metrics.
- Type checking via **`tsc`** — esbuild does NOT type-check.
- Formatting: **Prettier**
- Linting: **ESLint**

### ✅ Correct

```typescript
// Lambda handler using Powertools
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics } from '@aws-lambda-powertools/metrics';

const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

export const handler = async (event: APIGatewayProxyEvent) => {
  logger.info('Processing request', { path: event.path });
  // business logic
};
```

### ❌ Incorrect

```javascript
// Plain JavaScript without types — violates Golden Path
// No Powertools — missing structured logging and tracing
exports.handler = async (event) => {
  console.log(event);
  // business logic
};
```

### References

- [AWS Lambda Powertools for TypeScript](https://docs.aws.amazon.com/powertools/typescript/latest/)
