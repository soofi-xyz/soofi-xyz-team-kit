---
name: monitoring-oracle-ingestion
description: Monitors oracle-node ingestion tracks for Lee appraisal, Lee permits, and Sunbiz corporate data, including queue health, S3 artifact counts, and rough ETAs. Use when asked for ingestion status, ETA, backlog, permit harvest progress, appraisal queue progress, or Sunbiz transform status in this repo.
---

# Monitoring Oracle Ingestion

Use this skill to produce repeatable status/ETA updates for the three active oracle-node data tracks:

- Lee County appraisal website prepare queue
- Lee County permit harvest queue and S3 artifacts
- Sunbiz quarterly corporate ZIP extraction and lexicon transform

## Quick start

Run the status script from the repo root:

```bash
AWS_PROFILE=elephant-oracle-node AWS_REGION=us-east-1 \
  skills/monitoring-oracle-ingestion/scripts/ingestion-status.sh
```

For a different recent-throughput window:

```bash
AWS_PROFILE=elephant-oracle-node AWS_REGION=us-east-1 \
  skills/monitoring-oracle-ingestion/scripts/ingestion-status.sh --window-minutes 120
```

## Workflow

1. Run `scripts/ingestion-status.sh` first. It checks SQS queue attributes, Lambda event-source state/concurrency, SQS delete rates, permit S3 artifact counts, and the Sunbiz transform summary.
2. Treat SQS counts as approximate. AWS reports SQS CloudWatch metrics at one-minute intervals and Lambda SQS mappings hide messages during the visibility timeout while batches are in-flight.
3. For appraisal ETA, if the event-source mapping is disabled, report the track as paused and do not present a live ETA. If enabled, use current backlog divided by recent message-deletion rate.
4. For permit ETA, call out that the queue is dynamic because list-window work can enqueue more split/detail work. Present the current-queue drain ETA as a lower bound and the recent extracted-permit rate as the useful throughput signal.
5. For permit list-window completeness, run `scripts/permit-list-progress.mjs`. It reads `links.json` summaries and estimates the remaining split-tree work needed to reach terminal one-day windows.
6. For Sunbiz, use `scripts/sunbiz-summary.sh` when only the final transformed counters are needed. Current quarterly corporate business-registration scope is complete when `invalidRecordCount` is zero and `transformedRecordCount` equals `sourceRecordCount`.

## Helper scripts

- `scripts/ingestion-status.sh` prints one consolidated status report.
- `scripts/permit-list-progress.mjs` estimates Lee permit list-window split progress and ETA from S3 summaries.
- `scripts/s3-prefix-count.sh` counts S3 objects under a prefix and objects modified in the last N minutes.
- `scripts/sunbiz-summary.sh` prints the current Sunbiz lexicon transform summary counters.

## Reporting guidance

Keep user-facing updates concise:

- status: running / paused / complete / blocked
- key backlog count
- current throughput window
- ETA or why ETA is not meaningful
- caveat when a track is dynamically discovering more work
