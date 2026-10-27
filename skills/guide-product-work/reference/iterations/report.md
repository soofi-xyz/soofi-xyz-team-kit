# Report capability map

Apply [stable stack identity](../../../build-product-deployer/reference/stack-identity.md)
to synthesis, review and installation: one stack, `Report`, with no deployment stage,
updated in place whether it was deployed directly or installed from Marketplace.

Use Bronzong to implement Report and Bronzor to configure reports on an existing
deployment. Follow the [shared workflow](../../SKILL.md). These 10 areas are a starting
inventory, not a fixed iteration count. Order dependencies and split independently
useful features further. Use at least four pieces for a full-product build; narrow work
selects only relevant pieces. Keep automated tests and user/AWS feedback inside each
piece, not as a final testing phase.

Report runs each report's queries on a schedule and writes the results as JSON files. It
holds no report: every report is a configuration (contract `report-1`). It shows nothing:
Console reads the outputs and draws them.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `configuration` — validate, save and version a report | Shared API domain and key | Deliver `POST /reports/validate`, `PUT`/`GET`/`DELETE /reports/{id}` and `/versions` against `schemas/report-configuration.schema.json`. Exercise both repository examples, an unchanged save (no new version), and a refused configuration (unknown property, mixed-case or colliding columns, CTE named like a source). | Read the DynamoDB report and version items and the Glue table each source creates (`report_ledger.<report>__<source>`); confirm a refused save writes nothing. |
| `cost-gate` — estimate and refuse before reading data | Saved configuration | Deliver the plan step: lock, window, metadata-only estimate at $5/TiB. Compare a cheap report with one whose `costLimitUsd` is below its estimate. | Inspect the Refresh execution's Plan output (`estimatedCostUsd`) and the refresh record; confirm an over-limit refresh fails before any source query runs. |
| `athena-sources` — append Athena rows to the ledger | Cost gate | Deliver `athena-sql` sources as an `UNLOAD` through Step Functions' Athena integration in workgroup `Report`, with `maxScanGiB`. Compare a source inside and above its scan bound. | Follow the Athena query execution and `ledger/<report>/<source>/run_date=…/<refresh-id>/` objects; confirm files are never replaced and the scan check fails the refresh. |
| `persist-sources` — append Persist Gremlin rows | Cost gate; Persist in the account | Deliver `persist-gremlin` sources through Persist's async Gremlin API, `split: day`, `maxRows`. Compare one query with a per-day split, and a Persist failure. | Inspect the Persist job ids in the source step and the ledger files; confirm a failed query fails the refresh and keeps the previous outputs. |
| `datasets` — shape ledger rows with Athena SQL | A source in the ledger | Deliver datasets with the sources and earlier datasets in front as `WITH` clauses, `{{ledger.<source>}}` and window variables, `maxRows`. Compare a dataset over this refresh's rows with one over the whole ledger, and one above `maxRows`. | Read the Athena executions of the dataset steps and the staged results; confirm the row cap fails the refresh instead of cutting a file. |
| `outputs` — publish every dataset as JSON | Datasets | Deliver the publish step: dataset files and manifest under `outputs/<report>/refreshes/<refresh>/`, then `latest/` with the manifest last, stale files removed, `GET /reports/{id}/outputs`. Compare a refresh after renaming a dataset, a retried publish and a refresh overtaken by a newer one. | List `outputs/<report>/` in the bucket named by SSM `/report/Report/output-bucket`; check `refreshId` in each file and the history tag `report-output=history`. |
| `schedule-recovery` — refresh on schedule and recover | Outputs | Deliver EventBridge Scheduler schedules per report, `manual`, timeouts, the reconciler for `TIMED_OUT`/`ABORTED` executions and the alarms. Exercise a schedule change, a timed-out refresh and deleting a report. | Inspect the schedule in group `Report`, the failed refresh record and alarms `RefreshFailed`, `ScheduleDeadLetters`, `ReconcileDeadLetters`, `ApiErrors`; confirm delete removes outputs and schedule but never the ledger. |
| `mcp-read` — read reports from Claude Code and Cursor | Configuration; outputs; shared API domain and key | Deliver [the Report MCP server](../../../build-report-product/reference/mcp-server.md) at `/report/mcp` with `list_reports`, `get_report`, `list_versions`, `get_status` and `get_outputs`; connect both clients. | Inspect the MCP Lambda's logs; compare each tool result with its HTTP route and confirm the key appears in no result or log. |
| `mcp-validate-save` — validate and save through MCP | MCP read | Deliver `validate_config` and `save_config` requiring `confirm: true`; exercise an invalid configuration, an unconfirmed save and a confirmed save. | Read the saved DynamoDB version and `GET /reports/{id}`; confirm the refused saves wrote nothing. |
| `mcp-refresh` — refresh and wait through MCP | MCP validate/save; schedule-recovery | Deliver `refresh_and_wait` within `costLimitUsd` and the wait limit; exercise a completed refresh, an over-limit refresh and a wait that ends while `RUNNING`. | Follow the Refresh execution and the output manifest's `refreshId`; confirm the cost gate refused before any source query. |

The baseline seven areas are deployed in `prismteam-ai/report`; its `README.md`,
`docs/configuration-contract.md`, `docs/outputs.md` and `requirements/swagger.yml` are
authoritative over this map. Bronzor operates them through
[the Report API summary](../../../configure-report-product/reference/api-contract.md).

Discover actual routes, statuses and resource names from the target revision and stack
outputs. Exercise each piece through the HTTP API, including submission (`POST
/reports/{id}/refreshes`, `202`), status and results for refreshes. Direct AWS
inspection supports evidence; it does not replace API use. Give one invocation and at
most three AWS inspection steps, collect the person's redacted refresh id and
observation, and wait for that feedback before implementing or configuring the next
piece. Keep local tests (including the Trino comparison), synthesis, deployed refreshes
over test data and refreshes over live Persist or Athena data distinct.

Keep publication with Registeel, installation with Skarmory, and showing reports with
Vivillon (Console). A succeeded refresh proves its outputs were written, not that a
Console page reads them.

Apply [the configuration-bundle contract](../../../build-product-deployer/reference/configuration-bundles.md)
when a report is installed from a bundle: Deploy saves it through `PUT /reports/{id}`
(201 created, 200 updated or unchanged).

Apply [the shared API domain contract](../shared-api-domain.md) within the relevant
pieces: base path `report`, the shared usage plan, no public routes.
