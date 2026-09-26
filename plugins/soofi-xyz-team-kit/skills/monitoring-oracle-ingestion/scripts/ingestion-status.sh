#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ingestion-status.sh [--window-minutes 60]

Prints a consolidated status report for oracle-node ingestion tracks:
Lee appraisal prepare, Lee permit harvest, and Sunbiz corporate transform.
Set AWS_PROFILE=elephant-oracle-node and AWS_REGION=us-east-1 unless your shell
already has equivalent credentials/region configured.
USAGE
}

WINDOW_MINUTES=60
while [[ $# -gt 0 ]]; do
  case "$1" in
    --window-minutes)
      WINDOW_MINUTES="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 127
fi

APPRAISAL_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/848665034107/elephant-oracle-node-prepare-queue-lee"
APPRAISAL_QUEUE_NAME="elephant-oracle-node-prepare-queue-lee"
APPRAISAL_EVENT_SOURCE_UUID="8629af85-abed-4c92-b850-34b658383da1"
APPRAISAL_FUNCTION_NAME="elephant-oracle-node-DownloaderFunction-8GbNMvP3cL1H"

PERMIT_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/848665034107/elephant-oracle-node-permit-harvest-queue"
PERMIT_QUEUE_NAME="elephant-oracle-node-permit-harvest-queue"
PERMIT_DLQ_URL="https://sqs.us-east-1.amazonaws.com/848665034107/elephant-permit-harvest-PermitHarvestDeadLetterQueue-y0H4KiJoMez6"
PERMIT_FUNCTION_NAME="elephant-permit-harvest-PermitHarvestWorkerFunctio-FMP5YTblMFul"

PERMIT_JOB_PREFIX="s3://elephant-oracle-node-environmentbucket-mmsoo3xbdi80/permit-harvest/lee-permit-backfill-20260525"
SUNBIZ_SUMMARY_S3_URI="s3://elephant-oracle-node-environmentbucket-mmsoo3xbdi80/permit-harvest/sunbiz-lee-corporate-quarterly-2026q2-expanded/lexicon-transform/business-registration-v1/summary.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_UTC="$(date -u -d "${WINDOW_MINUTES} minutes ago" +%Y-%m-%dT%H:%M:%SZ)"

queue_attrs() {
  local queue_url="$1"
  aws sqs get-queue-attributes --queue-url "$queue_url" --attribute-names All \
    | jq '.Attributes | {
        visible: (.ApproximateNumberOfMessages | tonumber),
        notVisible: (.ApproximateNumberOfMessagesNotVisible | tonumber),
        delayed: (.ApproximateNumberOfMessagesDelayed | tonumber),
        visibilityTimeoutSeconds: (.VisibilityTimeout | tonumber)
      }'
}

sqs_deleted_sum() {
  local queue_name="$1"
  aws cloudwatch get-metric-statistics \
    --namespace AWS/SQS \
    --metric-name NumberOfMessagesDeleted \
    --dimensions "Name=QueueName,Value=${queue_name}" \
    --start-time "$START_UTC" \
    --end-time "$NOW_UTC" \
    --period 300 \
    --statistics Sum \
    | jq '[.Datapoints[].Sum] | add // 0'
}

lambda_concurrency_max() {
  local function_name="$1"
  aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name ConcurrentExecutions \
    --dimensions "Name=FunctionName,Value=${function_name}" \
    --start-time "$START_UTC" \
    --end-time "$NOW_UTC" \
    --period 300 \
    --statistics Maximum \
    | jq '[.Datapoints[].Maximum] | max // 0'
}

event_source_summary() {
  local uuid="$1"
  aws lambda get-event-source-mapping --uuid "$uuid" \
    | jq '{state: .State, batchSize: .BatchSize, maximumConcurrency: (.ScalingConfig.MaximumConcurrency // null)}'
}

permit_event_source_summary() {
  aws lambda list-event-source-mappings --function-name "$PERMIT_FUNCTION_NAME" \
    | jq '.EventSourceMappings[0] | {state: .State, batchSize: .BatchSize, maximumConcurrency: (.ScalingConfig.MaximumConcurrency // null), uuid: .UUID}'
}

reserved_concurrency() {
  local function_name="$1"
  local response
  response="$(aws lambda get-function-concurrency --function-name "$function_name" 2>/dev/null || true)"
  if [[ -z "$response" ]]; then
    printf 'null\n'
    return
  fi
  jq '.ReservedConcurrentExecutions // null' <<<"$response"
}

eta_hours_from_rate() {
  local backlog="$1"
  local processed="$2"
  jq -n --argjson backlog "$backlog" --argjson processed "$processed" --argjson windowMinutes "$WINDOW_MINUTES" '
    if $processed <= 0 then null
    else (($backlog / ($processed / $windowMinutes)) / 60)
    end
  '
}

APPRAISAL_ATTRS="$(queue_attrs "$APPRAISAL_QUEUE_URL")"
APPRAISAL_DELETED="$(sqs_deleted_sum "$APPRAISAL_QUEUE_NAME")"
APPRAISAL_EVENT_SOURCE="$(event_source_summary "$APPRAISAL_EVENT_SOURCE_UUID")"
APPRAISAL_CONCURRENCY_MAX="$(lambda_concurrency_max "$APPRAISAL_FUNCTION_NAME")"
APPRAISAL_RESERVED="$(reserved_concurrency "$APPRAISAL_FUNCTION_NAME")"
APPRAISAL_BACKLOG="$(jq -n --argjson attrs "$APPRAISAL_ATTRS" '$attrs.visible + $attrs.notVisible + $attrs.delayed')"
APPRAISAL_ETA_HOURS="$(eta_hours_from_rate "$APPRAISAL_BACKLOG" "$APPRAISAL_DELETED")"

PERMIT_ATTRS="$(queue_attrs "$PERMIT_QUEUE_URL")"
PERMIT_DLQ_ATTRS="$(queue_attrs "$PERMIT_DLQ_URL")"
PERMIT_DELETED="$(sqs_deleted_sum "$PERMIT_QUEUE_NAME")"
PERMIT_EVENT_SOURCE="$(permit_event_source_summary)"
PERMIT_CONCURRENCY_MAX="$(lambda_concurrency_max "$PERMIT_FUNCTION_NAME")"
PERMIT_RESERVED="$(reserved_concurrency "$PERMIT_FUNCTION_NAME")"
PERMIT_BACKLOG="$(jq -n --argjson attrs "$PERMIT_ATTRS" '$attrs.visible + $attrs.notVisible + $attrs.delayed')"
PERMIT_QUEUE_ETA_HOURS="$(eta_hours_from_rate "$PERMIT_BACKLOG" "$PERMIT_DELETED")"

PERMIT_EXTRACTED="$(${SCRIPT_DIR}/s3-prefix-count.sh --s3-uri "${PERMIT_JOB_PREFIX}/lee/extracted/permits/" --window-minutes "$WINDOW_MINUTES")"
PERMIT_RAW_DETAILS="$(${SCRIPT_DIR}/s3-prefix-count.sh --s3-uri "${PERMIT_JOB_PREFIX}/lee/raw/permit-details/" --window-minutes "$WINDOW_MINUTES")"
PERMIT_DETAIL_SUMMARIES="$(${SCRIPT_DIR}/s3-prefix-count.sh --s3-uri "${PERMIT_JOB_PREFIX}/lee/permit-details/" --window-minutes "$WINDOW_MINUTES")"
PERMIT_LISTS="$(${SCRIPT_DIR}/s3-prefix-count.sh --s3-uri "${PERMIT_JOB_PREFIX}/lee/permit-lists/" --window-minutes "$WINDOW_MINUTES")"

SUNBIZ_SUMMARY="$(SUNBIZ_SUMMARY_S3_URI="$SUNBIZ_SUMMARY_S3_URI" ${SCRIPT_DIR}/sunbiz-summary.sh)"

jq -n \
  --arg generatedAt "$NOW_UTC" \
  --argjson windowMinutes "$WINDOW_MINUTES" \
  --argjson appraisalAttrs "$APPRAISAL_ATTRS" \
  --argjson appraisalDeleted "$APPRAISAL_DELETED" \
  --argjson appraisalEventSource "$APPRAISAL_EVENT_SOURCE" \
  --argjson appraisalConcurrencyMax "$APPRAISAL_CONCURRENCY_MAX" \
  --argjson appraisalReserved "$APPRAISAL_RESERVED" \
  --argjson appraisalEtaHours "$APPRAISAL_ETA_HOURS" \
  --argjson permitAttrs "$PERMIT_ATTRS" \
  --argjson permitDlqAttrs "$PERMIT_DLQ_ATTRS" \
  --argjson permitDeleted "$PERMIT_DELETED" \
  --argjson permitEventSource "$PERMIT_EVENT_SOURCE" \
  --argjson permitConcurrencyMax "$PERMIT_CONCURRENCY_MAX" \
  --argjson permitReserved "$PERMIT_RESERVED" \
  --argjson permitQueueEtaHours "$PERMIT_QUEUE_ETA_HOURS" \
  --argjson permitExtracted "$PERMIT_EXTRACTED" \
  --argjson permitRawDetails "$PERMIT_RAW_DETAILS" \
  --argjson permitDetailSummaries "$PERMIT_DETAIL_SUMMARIES" \
  --argjson permitLists "$PERMIT_LISTS" \
  --argjson sunbiz "$SUNBIZ_SUMMARY" \
  '{
    generatedAt: $generatedAt,
    windowMinutes: $windowMinutes,
    appraisal: {
      status: (if $appraisalEventSource.state == "Enabled" then "running" else "paused" end),
      queue: $appraisalAttrs,
      eventSource: $appraisalEventSource,
      lambda: {reservedConcurrency: $appraisalReserved, maxConcurrentExecutionsInWindow: $appraisalConcurrencyMax},
      messagesDeletedInWindow: $appraisalDeleted,
      etaHoursAtCurrentDeleteRate: (if $appraisalEventSource.state == "Enabled" then $appraisalEtaHours else null end),
      note: (if $appraisalEventSource.state == "Enabled" then "ETA uses recent SQS delete rate." else "Event source is disabled; backlog is not draining, so live ETA is paused." end)
    },
    permits: {
      status: (if $permitEventSource.state == "Enabled" then "running" else "paused" end),
      queue: $permitAttrs,
      deadLetterQueue: $permitDlqAttrs,
      eventSource: $permitEventSource,
      lambda: {reservedConcurrency: $permitReserved, maxConcurrentExecutionsInWindow: $permitConcurrencyMax},
      messagesDeletedInWindow: $permitDeleted,
      currentQueueDrainEtaHours: $permitQueueEtaHours,
      s3Artifacts: {
        extractedPermits: $permitExtracted,
        rawPermitDetails: $permitRawDetails,
        detailSummaries: $permitDetailSummaries,
        permitLists: $permitLists
      },
      note: "ETA is a lower bound for currently queued work because list-window tasks can discover and enqueue more split/detail work."
    },
    sunbiz: {
      status: (if ($sunbiz.counters.invalidRecordCount == 0 and $sunbiz.counters.transformedRecordCount == $sunbiz.counters.sourceRecordCount) then "complete" else "needs_attention" end),
      summary: $sunbiz,
      etaHours: 0,
      note: "Quarterly corporate business-registration ZIP extraction and lexicon transform are complete; corevent.zip is a separate follow-up scope."
    }
  }'
