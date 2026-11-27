#!/bin/bash
# Launch mortgage document workers on EC2.
# Usage: aws/launch-workers.sh <instance-type> "<tasks for machine 1>" ["<tasks for machine 2>" ...]
#   Each argument after the instance type is one machine's TASKS, e.g. "dallas:2026:0/4 tarrant:2026:0/4".
# Needs AWS_PROFILE with rights in account 904370092316. Run from skills/use-oracle/runtime.
# Machines terminate themselves when their tasks finish.
set -eu
export AWS_REGION=${AWS_REGION:-us-east-2}
BUCKET=${BUCKET:-elephant-mortgage-documents-904370092316}
TYPE=$1; shift
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=mortgage-docs-worker --query 'SecurityGroups[0].GroupId' --output text)
for tasks in "$@"; do
  ud=$(sed -e "s|__TASKS__|$tasks|" -e "s|__BUCKET__|$BUCKET|g" aws/worker-user-data.sh)
  id=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" \
    --iam-instance-profile Name=mortgage-docs-worker --security-group-ids "$SG" \
    --instance-initiated-shutdown-behavior terminate \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=40,VolumeType=gp3,DeleteOnTermination=true}' \
    --metadata-options HttpTokens=required \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=mortgage-docs-worker},{Key=Project,Value=mortgage-data-group},{Key=Tasks,Value=$tasks}]" \
    --user-data "$ud" --query 'Instances[0].InstanceId' --output text)
  echo "$id $tasks"
done
