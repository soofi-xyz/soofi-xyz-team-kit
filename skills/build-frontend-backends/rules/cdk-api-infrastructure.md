---
title: CDK API Infrastructure
impact: CRITICAL
tags: cdk, api-gateway, lambda, custom-domain, trpc, infrastructure, typescript
---

# CDK API Infrastructure

The tRPC backend deploys as a **Lambda function** behind **API Gateway HTTP API (v2)** with a **custom domain** and base path mapping. All infrastructure is defined in CDK (TypeScript). Follow `apply-engineering-guidelines` for CDK conventions.

## Custom Domain Mapping

API domains are determined by the AWS account:

| Account ID | Domain | Purpose |
| --- | --- | --- |
| `014948052063` | `api.springoakscapital.com` | **Production** |
| `951132547414` | `api-dev.ai.springoakscapital.com` | **Development** |

Each app gets a **base path** on the shared domain to maintain backward compatibility. For example, if your app is called `my-app`, the API is available at:

- **Production:** `https://api.springoakscapital.com/my-app`
- **Development:** `https://api-dev.ai.springoakscapital.com/my-app`

The base path MUST match the app name and MUST NOT change after initial deployment to preserve backward compatibility.

## CDK Stack Template

**apps/api/cdk/lib/api-stack.ts:**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

// Domain config per account
const DOMAIN_CONFIG: Record<string, { domainName: string }> = {
  '014948052063': { domainName: 'api.springoakscapital.com' },
  '951132547414': { domainName: 'api-dev.ai.springoakscapital.com' },
};

interface ApiStackProps extends cdk.StackProps {
  /** Base path on the custom domain (e.g., "my-app") */
  basePath: string;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, {
      ...props,
      env: { region: 'us-east-2', account: props.env?.account },
      tags: { project_name: props.basePath },
    });

    // Lambda function
    const handler = new nodejs.NodejsFunction(this, 'TrpcHandler', {
      entry: '../src/handler.ts',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: props.basePath,
        POWERTOOLS_METRICS_NAMESPACE: props.basePath,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    });

    // HTTP API
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.basePath}-api`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      'LambdaIntegration',
      handler,
    );

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Custom domain mapping
    const accountId = cdk.Stack.of(this).account;
    const domainConfig = DOMAIN_CONFIG[accountId];

    if (domainConfig) {
      // Look up the existing custom domain (created once per account)
      const domainName = apigwv2.DomainName.fromDomainNameAttributes(
        this,
        'Domain',
        {
          name: domainConfig.domainName,
          regionalDomainName: '', // populated by CloudFormation
          regionalHostedZoneId: '', // populated by CloudFormation
        },
      );

      new apigwv2.ApiMapping(this, 'ApiMapping', {
        api: httpApi,
        domainName,
        stage: httpApi.defaultStage!,
        apiMappingKey: props.basePath, // e.g., "my-app"
      });
    }

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: domainConfig
        ? `https://${domainConfig.domainName}/${props.basePath}`
        : httpApi.apiEndpoint,
    });
  }
}
```

**apps/api/cdk/bin/app.ts:**

```typescript
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

new ApiStack(app, 'MyAppApiStack', {
  basePath: 'my-app',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-2',
  },
});
```

## Key Requirements

- **Region:** Always `us-east-2`
- **Runtime:** `NODEJS_22_X` (or latest LTS)
- **Tracing:** `lambda.Tracing.ACTIVE` (X-Ray enabled)
- **Tags:** `project_name` on every stack
- **Observability:** Powertools Logger, Tracer, and Metrics environment variables
- **Bundling:** Use `NodejsFunction` with esbuild for automatic TypeScript bundling
- **Source maps:** Enable `sourceMap: true` + `NODE_OPTIONS: '--enable-source-maps'`

## Base Path Backward Compatibility

Once a base path is chosen and deployed, it MUST NOT change. The base path becomes part of the API contract:

- Frontend apps store the full URL including the base path
- External integrations may reference the URL
- Changing it breaks all existing clients

Choose the base path carefully during initial setup. Use the app name (lowercase, hyphenated).

## ✅ Correct

```typescript
// TypeScript CDK with proper domain mapping
new ApiStack(app, 'MyAppApiStack', {
  basePath: 'my-app',
  env: { account: '014948052063', region: 'us-east-2' },
});
// Result: https://api.springoakscapital.com/my-app
```

## ❌ Incorrect

```typescript
// ❌ Wrong region
env: { region: 'us-east-1' }

// ❌ No tracing
tracing: lambda.Tracing.DISABLED

// ❌ No project_name tag
// Every stack MUST have tags: { project_name: '...' }

// ❌ Hardcoded domain without account-based lookup
const domain = 'api.springoakscapital.com'; // What about dev?

// ❌ Python CDK for a TypeScript service
// CDK language MUST match the service language → TypeScript

// ❌ Using SAM, Serverless Framework, or raw CloudFormation
// CDK is the ONLY permitted IaC tool
```

## References

- [AWS CDK API Gateway v2](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigatewayv2-readme.html)
- [CDK NodejsFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
- [Engineering Guidelines — CDK Standards](../../../apply-engineering-guidelines/rules/cloud-aws-primary.md)
