# Quiq SMS end-to-end chain calibration

Use only with the `quiq-sms-end-to-end` chain of `reference/chains.json` (`test quiq to interprose for sms`,
`test sms end to end`). This dossier records sanitized expectations from earlier DEV evidence, not runtime evidence of a
new run.

## Chain

1. Source: PROD Quiq BI exports (`so-quiq-events`, `quiq-inbound/bi-data/springoakscapital/<day>/`), bridged through
   the PROD SendContextTable (`providerMessageId`) and the processed batch (`sms-lifecycle/processed-batches/<sentAt
   date>/<batchId>.json`, item by `message_id`) to debt, phone, interaction and rendered body; phone location from
   `graph_call_outputs.phone_number`. Normalized to the `quiq` `lifecycle` dataset (`reference/chain-sources.json`).
2. `quiq-to-lexicon` (latest; 1.0.0 on 2026-10-01, `mapping.json` SHA-256 prefix `4bc43c9d`) → Neptune CSV under
   `vertices/` and `edges/` (nine datasets).
3. DEV `PersistNeptuneCsvWorkflow` with `s3_uri` = that output, `maxConcurrency` 2, `waitForIndexCatchup` true.
4. Bounded DEV Persist export rooted at the run's `text_message` `interaction_identifier` values: nine Parquet graph
   tables plus `hydrated_text_message_artifact`.
5. `lexicon-to-interprose@2.0.0` (SHA-256 prefix `b9219f31`), `outputDatasets: ["sms_log"]`.
6. `compare_datasets.py source-baseline` against the source events.

## Earlier DEV evidence (2026-09-19 window, run-20260923T133500Z)

- Source: 130,892 observations; 130,321 accepted; quarantine 501 `missing_debt` (opt events) and 70
  `missing_send_context`; all accepted rows SMS, OUTBOUND, template unknown.
- Forward: 69,896 debts, 69,897 phones, 69,945 messages, 0 templates, 130,321 status edges, 69,945 artifact edges.
- Persist load: SUCCEEDED in 4,128 s; 209,738 vertices and 340,156 edges read back; rehash 8,452 DPU-seconds (about
  $1.03).
- Export: 117 queries of at most 600 message ids; 549,894 graph rows; 69,945 hydrated bodies; zero orphan endpoints.
- Projection: 130,321 `sms_log` rows, nine fields matching the accepted source multiset; $0.35.

## Expectations for a new window

- Every accepted QUIQ SMS lifecycle row appears once in `sms_log` with matching debt, phone, body, sent time,
  vendor result, tracking code, te_id and interaction identifier; `txt_msg_template_id` is empty
  (`TemplateMetadataUnresolved` counts the rows whose send context names a template).
- Exclusions are counted, never hidden: MMS, non-QUIQ, rows without a hydrated body, quarantine reasons.
- SendContext rows expire by TTL: an old window shows a growing `missing_send_context`; use the most recent full day.
- Loaded DEV elements remain as residue; reloading the same day merges into the same elements.
