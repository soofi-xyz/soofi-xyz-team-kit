#!/usr/bin/env bash
set -euo pipefail

SUNBIZ_SUMMARY_S3_URI="${SUNBIZ_SUMMARY_S3_URI:-s3://elephant-oracle-node-environmentbucket-mmsoo3xbdi80/permit-harvest/sunbiz-lee-corporate-quarterly-2026q2-expanded/lexicon-transform/business-registration-v1/summary.json}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 127
fi

aws s3 cp "$SUNBIZ_SUMMARY_S3_URI" - \
  | jq --arg summaryS3Uri "$SUNBIZ_SUMMARY_S3_URI" '{
      summaryS3Uri: $summaryS3Uri,
      schemaVersion,
      transformedAt,
      sourceJobId,
      sourceManifestS3Uri,
      stoppedAfterMaxChunks,
      stoppedAfterMaxRecords,
      partRecordLimit,
      counters,
      outputPartCount: (.outputParts | length)
    }'
