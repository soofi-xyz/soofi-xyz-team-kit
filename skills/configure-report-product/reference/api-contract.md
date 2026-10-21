# Report API summary

On the environment's shared domain under `/report`; every route needs the shared
`x-api-key`. `requirements/swagger.yml` in `prismteam-ai/report` is authoritative.

| Route | Result |
| --- | --- |
| `GET /reports` | Every report: id, title, latest version, schedule, `generatedAt`, `outputs` location |
| `POST /reports/validate` | `{valid, problems: [{path, message}]}`; saves nothing |
| `PUT /reports/{id}` | Save: `201` created (version 1), `200` updated or unchanged; body `{id, version, outcome, schedule, ledger, outputs}`. `400` invalid, `409` another save or a running refresh would change a source's columns |
| `GET /reports/{id}`, `GET /reports/{id}/versions` | The current configuration and version; every version |
| `DELETE /reports/{id}` | Removes the report, its schedule, versions, refreshes and outputs; never the ledger. `409` while a refresh runs |
| `GET /reports/{id}/status` | Summary plus `published` (refresh, version, `generatedAt`), `refreshing` and `lastRefresh` |
| `POST /reports/{id}/refreshes` | `202 {refreshId, status: RUNNING}`; `409` while another runs |
| `GET /reports/{id}/refreshes`, `GET /reports/{id}/refreshes/{refreshId}` | The 20 latest refreshes; one refresh: `status` (`RUNNING`, `SUCCEEDED`, `FAILED`), `trigger`, `version`, `window`, `estimatedCostUsd`, `sourceRows`, `datasetRows`, `error` |
| `GET /reports/{id}/outputs` | `{bucket, prefix, manifestUri, manifest}`; `404 NOT_REFRESHED` before the first published refresh |

Outputs (contract `report-output-1`): `outputs/<report>/latest/manifest.json` and
`outputs/<report>/latest/<dataset>.json`, plus each refresh's own copies under
`outputs/<report>/refreshes/<refresh>/` for 90 days. A dataset file has `columns`
(`name`, Athena `type`) and `rows` as objects keyed by column name.
