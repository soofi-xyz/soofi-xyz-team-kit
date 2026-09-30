# Persist capability map

Use Conkeldurr to implement capabilities and Uxie to configure existing ones.
Derive the scoped plan using the [shared workflow](../../SKILL.md). These ten
capability areas are a starting inventory, not a fixed count for either agent.
Select requested features, order dependencies, and split further where a usable
capability needs its own checkpoint. Apply tests and user/AWS feedback to every
selected piece; do not reserve failure testing for the end.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `fact-ingestion` — store and retrieve facts | Approved model and IDs | Deliver the minimal validated ingestion/read-back path; configure one vertex type and compare valid, invalid and repeated input. | Inspect ingest logs/execution and read back the exact fact; prove validation and stable identity. |
| `relationships` — connect facts | Fact ingestion | Deliver edge validation and a minimal relationship read; configure related records and edges, including a missing endpoint. | Inspect endpoint validation/write logs and the actual relationship query; compare complete IDs and rejection. |
| `graph-queries` — select and project graph data | Ingested facts; relationships for traversals | Deliver supported read-only Gremlin queries, projections and explain behavior; run different selectors and an empty result. | Inspect correlated query logs and query/explain output; identify why the selected facts match. |
| `async-ingestion` — submit a staged ingest job | Fact ingestion and bulk-loading workers for the documented runtime | Deliver async submission, validation, queue processing and completion; configure small staged fixtures with a failure and corrected replay. | Follow the actual workflow/consumer logs from accepted request to read-back; distinguish acceptance from completion. |
| `bulk-loading` — load graph files | IDs, relationship integrity and staging | Deliver Neptune CSV/bulk loading; configure node/edge file bindings and load a bounded fixture. | Inspect loader/workflow status, failed-file diagnostics and final graph counts; verify safe replay. |
| `event-ingestion` — consume a produced graph fact | Fact ingestion; async/bulk path for routed larger events | Deliver the `GraphFactProduced` envelope, validated routing and correlation; configure supported event-source bindings and valid, invalid and duplicate test events. | Trace event ID through handler, queue/workflow when selected, and graph read-back; inspect rejected/skipped events and DLQ behavior separately from outbound triggers. |
| `async-queries` — manage long-running reads | Graph queries | Deliver supported query submission, status, result retrieval and cancellation; vary query shape and exercise a failed/cancelled run. | Inspect the query execution/status store and result pointer; distinguish cancellation, failure and completion. |
| `index-rebuild` — initialize or backfill derived facts | Ingested facts and governed index definition | Deliver supported initial materialization/rebuild; configure dry-run and authorized write variants with matching/nonmatching records. | Inspect rebuild/shard execution and summary, read the initial index values and verify the bootstrap watermark/checkpoint. |
| `index-maintenance` — keep derived facts current | Initialized index and valid stream checkpoint | Deliver incremental maintenance; configure source changes and interrupted/replayed processing. | Follow poller/materializer logs and index read-back; verify freshness, idempotency and checkpoint advancement only after completed writes. |
| `triggers` — emit a configured occurrence | Ingested facts and change delivery | Deliver governed trigger evaluation/delivery; configure a predicate with matching/nonmatching changes and duplicate delivery. | Inspect actual evaluation and EventBridge/SQS consumer logs, occurrence identity and any DLQ; prove no duplicate effect. |

Use [current-scope reconciliation](../../../build-persist-service/reference/current-scope.md)
and relevant [implementation details](../../../build-persist-service/reference/PRD.md).
Do not combine indexes and triggers into one generic “downstream effect”. Discover
supported publication procedures; never assume runtime CRUD or a state machine.
Table order is not deployment order: verify the target async implementation and
complete its bulk-loading dependency before claiming an end-to-end async ingest.
For the documented index runtime, complete rebuild/bootstrap before incremental
maintenance; a missing/expired checkpoint must remain an explicit recovery gap.
GraphQL and full-text search in the older reference are additional candidate
features only when the target contract and requested scope require them; give
such features their own pieces instead of silently omitting or restoring them.
A relationships-only task selects that capability and its prerequisite evidence;
it does not require implementing bulk loading, indexes or triggers.
