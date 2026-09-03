import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'node:path';
import { Construct } from 'constructs';

export interface PortalApiStackProps extends cdk.StackProps {
  apiName: string;
  functionName: string;
  allowedOrigins: string[];
  memorySize?: number;
  timeoutSeconds?: number;
  provisionedConcurrentExecutions?: number;
  secretNames?: string[];
  environment?: Record<string, string>;
}

export class PortalApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PortalApiStackProps) {
    super(scope, id, props);

    const {
      apiName,
      functionName,
      allowedOrigins,
      memorySize = 512,
      timeoutSeconds = 30,
      provisionedConcurrentExecutions = 0,
      secretNames = [],
      environment = {},
    } = props;

    if (allowedOrigins.length === 0) {
      throw new Error('allowedOrigins must contain at least one explicit origin');
    }
    if (allowedOrigins.includes('*')) {
      throw new Error('allowedOrigins cannot contain a wildcard origin');
    }
    if (provisionedConcurrentExecutions < 0) {
      throw new Error('provisionedConcurrentExecutions cannot be negative');
    }

    const logGroup = new logs.LogGroup(this, 'PortalApiLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const handler = new nodejs.NodejsFunction(this, 'PortalApiFunction', {
      functionName,
      entry: path.join(__dirname, '../../src/handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      memorySize,
      timeout: cdk.Duration.seconds(timeoutSeconds),
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
      environment: {
        ...environment,
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: apiName,
        POWERTOOLS_METRICS_NAMESPACE: apiName,
        POWERTOOLS_LOG_LEVEL: 'INFO',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    });

    const executionTarget: lambda.IFunction =
      provisionedConcurrentExecutions > 0
        ? new lambda.Alias(this, 'LiveAlias', {
            aliasName: 'live',
            version: handler.currentVersion,
            provisionedConcurrentExecutions,
          })
        : handler;

    for (const [index, secretName] of secretNames.entries()) {
      const secret = secretsmanager.Secret.fromSecretNameV2(
        this,
        `PortalSecret${index}`,
        secretName,
      );
      secret.grantRead(executionTarget);
    }

    const httpApi = new apigwv2.HttpApi(this, 'PortalHttpApi', {
      apiName,
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
      },
    });

    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      'PortalLambdaIntegration',
      executionTarget,
    );

    httpApi.addRoutes({
      path: '/',
      methods: [apigwv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    new cloudwatch.Alarm(this, 'DurationAlarm', {
      metric: executionTarget.metricDuration({
        statistic: 'p95',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 200,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Portal API Lambda p95 duration is at least 200 ms',
    });

    new cloudwatch.Alarm(this, 'ErrorAlarm', {
      metric: executionTarget.metricErrors({
        statistic: 'sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Portal API Lambda reported one or more errors',
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'FunctionName', {
      value: executionTarget.functionName,
    });
  }
}
