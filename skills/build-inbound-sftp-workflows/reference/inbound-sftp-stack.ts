// @ts-nocheck
import * as cdk from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";
import { aws_events_targets as targets } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_s3 as s3 } from "aws-cdk-lib";
import { aws_secretsmanager as secretsmanager } from "aws-cdk-lib";
import { aws_transfer as transfer } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface InboundSftpStackProps extends cdk.StackProps {
  targetBucketName: string;
  sftpSecretArn: string;
  remoteDirectoryPath: string;
  localDirectoryBasePrefix: string;
  scheduleExpression?: string;
  scheduleEnabled?: boolean;
  maxParallelTransfers?: number;
}

export class InboundSftpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InboundSftpStackProps) {
    super(scope, id, props);

    const targetBucket = s3.Bucket.fromBucketName(
      this,
      "TargetBucket",
      props.targetBucketName,
    );

    const sftpSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "SftpSecret",
      props.sftpSecretArn,
    );

    const connectorRole = new iam.Role(this, "SftpConnectorRole", {
      assumedBy: new iam.ServicePrincipal("transfer.amazonaws.com"),
    });

    connectorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject",
          "s3:ListBucket",
        ],
        resources: [targetBucket.bucketArn, targetBucket.arnForObjects("*")],
      }),
    );

    connectorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [sftpSecret.secretArn],
      }),
    );

    const connector = new transfer.CfnConnector(this, "SftpConnector", {
      accessRole: connectorRole.roleArn,
      loggingRole: connectorRole.roleArn,
      url: cdk.Fn.sub(
        "sftp://{{resolve:secretsmanager:${SecretArn}:SecretString:Url}}",
        {
          SecretArn: sftpSecret.secretArn,
        },
      ),
      sftpConfig: {
        userSecretId: sftpSecret.secretArn,
      },
      tags: [
        {
          key: "Name",
          value: `${cdk.Aws.STACK_NAME}-connector`,
        },
        {
          key: "Direction",
          value: "SFTP-to-S3",
        },
      ],
    });

    const pollerRole = new iam.Role(this, "InboundPollerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });

    pollerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "transfer:StartDirectoryListing",
          "transfer:DescribeDirectoryListing",
          "transfer:StartFileTransfer",
          "transfer:DescribeConnector",
        ],
        resources: [connector.attrArn],
      }),
    );

    pollerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [targetBucket.bucketArn, targetBucket.arnForObjects("*")],
      }),
    );

    const pollerFunction = new lambda.Function(this, "InboundPollerFunction", {
      functionName: `${cdk.Aws.STACK_NAME}-daily-poller`,
      code: lambda.Code.fromAsset("poller"),
      handler: "index.lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      role: pollerRole,
      environment: {
        CONNECTOR_ID: connector.attrConnectorId,
        TARGET_BUCKET: props.targetBucketName,
        REMOTE_DIRECTORY_PATH: props.remoteDirectoryPath,
        LOCAL_DIRECTORY_BASE_PREFIX: props.localDirectoryBasePrefix,
        MAX_PARALLEL_TRANSFERS: String(props.maxParallelTransfers ?? 20),
      },
    });

    new events.Rule(this, "DailySchedule", {
      description: "Daily inbound SFTP listing and transfer starter",
      enabled: props.scheduleEnabled ?? true,
      schedule: events.Schedule.expression(
        props.scheduleExpression ?? "cron(0 12 * * ? *)",
      ),
      targets: [new targets.LambdaFunction(pollerFunction)],
    });

    new cdk.CfnOutput(this, "ConnectorId", {
      description: "The Connector ID",
      value: connector.attrConnectorId,
    });

    new cdk.CfnOutput(this, "PollerFunctionArn", {
      description: "ARN of the daily inbound poller Lambda",
      value: pollerFunction.functionArn,
    });

    new cdk.CfnOutput(this, "PollerFunctionName", {
      description: "Name of the daily inbound poller Lambda",
      value: pollerFunction.functionName,
    });

    new cdk.CfnOutput(this, "DailyScheduleExpression", {
      description: "EventBridge schedule expression for automatic inbound polling",
      value: props.scheduleExpression ?? "cron(0 12 * * ? *)",
    });
  }
}
