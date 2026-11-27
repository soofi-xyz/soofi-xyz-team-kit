#!/bin/bash
# EC2 user data for a mortgage document worker (Ubuntu 24.04). launch-workers.sh fills in
# __TASKS__ and __BUCKET__. Installs Node 22, Google Chrome, Xvfb and the AWS CLI, pulls the
# runtime bundle from S3 and starts worker-run.sh as ubuntu.
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y xvfb curl ca-certificates unzip fonts-liberation
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y /tmp/chrome.deb
curl -fsSL -o /tmp/awscli.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install
mkdir -p /opt/mortgage && chown ubuntu:ubuntu /opt/mortgage
sudo -u ubuntu bash -c '
  set -eux
  cd /opt/mortgage
  aws s3 cp s3://__BUCKET__/worker-code/runtime.tgz - | tar xz
  cd runtime && npm ci --omit=dev --no-audit --no-fund
'
echo "ubuntu ALL=(root) NOPASSWD: /usr/sbin/shutdown" > /etc/sudoers.d/worker-shutdown
sudo -u ubuntu env TASKS="__TASKS__" BUCKET="__BUCKET__" AWS_REGION=us-east-2 \
  nohup bash /opt/mortgage/runtime/aws/worker-run.sh > /opt/mortgage/worker.out 2>&1 &
