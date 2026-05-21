---
title: Historical And Webhook Ingestion
impact: HIGH
tags: [rag, ingestion, backfill, webhook, batch]
---

# Historical And Webhook Ingestion

Use this rule after the AWS RAG corpus model and OpenSearch index are defined. Load historical data first, then add incremental source refresh.

## Historical Backfill

Use `../build-batch-workflows/` to choose the ingestion strategy from data shape and volume:

- Step Functions Distributed Map for API pagination, file movement, lightweight transforms, and OpenSearch bulk load workers.
- Glue PySpark only for large joins, deduplication, heavy transforms, or very large file sets.
- Glue plus Step Functions when Glue prepares normalized JSONL and Step Functions handles delivery, rate limits, and per-record retries.

The backfill must include:

- cost prediction gate before processing all data
- small test pipeline over 10 to 100 records
- idempotent source IDs, chunk IDs, and event IDs
- dead-letter or failed-record S3 prefix
- progress metrics: sources processed, chunks embedded, chunks indexed, failures, retries, and duration
- replay command or runbook for a single source, date range, or failed batch

## Webhook Ingestion

After historical data is loaded, design incremental ingestion for each data source:

- verify webhook signatures before accepting events
- write raw webhook events to an event ledger before processing
- dedupe by provider event ID and source version
- fetch full source records when webhook payloads are partial
- handle create, update, delete, restore, and permission/scope changes
- update source records, chunks, links, embeddings, and OpenSearch documents atomically enough to avoid stale retrieval
- put failed or rate-limited events on SQS with retry and DLQ behavior

If a source has no webhook support, use EventBridge Scheduler plus an incremental poller with cursors and the same ingestion contract.

## Verification

Before calling ingestion ready:

- historical test backfill loads a small approved sample
- golden queries pass against OpenSearch after backfill
- webhook fixtures cover create, update, delete, duplicate, retry, and bad signature cases
- metrics, logs, traces, alarms, DLQs, and replay commands exist
- secrets, raw PII, and local databases are not committed
