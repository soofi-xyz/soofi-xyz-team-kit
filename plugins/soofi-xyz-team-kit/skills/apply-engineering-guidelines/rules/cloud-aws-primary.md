---
title: AWS Cloud and CDK Infrastructure
impact: CRITICAL
tags: aws, cdk, infrastructure, iac, region, cost, tagging, serverless
---

## AWS Cloud and CDK Infrastructure

### Cloud Standards

- **Provider:** AWS
- **Primary region:** `us-east-2`
- AWS-first. Adopt third-party only when AWS cannot meet requirements.

### CDK Standards (HARD REQUIREMENT)

- **CDK is the ONLY permitted IaC tool.** Do NOT use Terraform, Pulumi, SAM, CloudFormation YAML/JSON, Serverless Framework, or any other IaC tool. This is non-negotiable.
- Deploy via **`cdk deploy`**.
- Author CDK in the **same language as the service** (TypeScript service → TypeScript CDK, Python pipeline → Python CDK).

### Cost Awareness

- Tag all resources with `project_name`.


### ✅ Correct

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class MyApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'us-east-2' },
      tags: { project_name: 'my-api-service' },
    });

    new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist'),
      tracing: lambda.Tracing.ACTIVE, // X-Ray enabled
    });
  }
}
```

### ❌ Incorrect

```yaml
# Raw CloudFormation YAML — use CDK instead
# No cost-tracking tags
# Hardcoded to us-east-1 instead of us-east-2
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: nodejs20.x
      Handler: index.handler
```

```typescript
// Deploying with `cdk synth` + manual CloudFormation upload — use `cdk deploy`
```

### References

- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/v2/guide/)
