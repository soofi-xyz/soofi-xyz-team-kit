# Schedule API summary

On the environment's shared domain under `/schedule`; every route needs the shared
`x-api-key`. `requirements/swagger.yml` in `prismteam-ai/schedule` is authoritative once it
exists; verify each route against the deployed revision before relying on it.

| Route | Result |
| --- | --- |
| `GET /schedules` | Every schedule: id, title, channel, latest version, run schedule, last published run |
| `POST /schedules/validate` | `{valid, problems: [{path, message}]}`; saves nothing |
| `PUT /schedules/{id}` | Save: `201` created (version 1), `200` updated or unchanged; body `{id, version, outcome, schedule}`. `400` invalid, `409` while a run is in progress |
| `GET /schedules/{id}`, `GET /schedules/{id}/versions` | The current configuration and version; every version |
| `DELETE /schedules/{id}` | Removes the schedule, its timer, versions and outputs; never the ledger. `409` while a run is in progress |
| `POST /schedules/{id}/runs` | Body `{runDate?, mode: live|simulate, overrides?, sourceUris?}`. `202 {runId, status: RUNNING}`; `409` while another runs |
| `GET /schedules/{id}/runs`, `GET /schedules/{id}/runs/{runId}` | The latest runs; one run: `status` (`RUNNING`, `SUCCEEDED`, `FAILED`), `mode`, `trigger`, `version`, `runDate`, `estimatedCostUsd`, `summary`, `error` |
| `GET /schedules/{id}/runs/{runId}/results` | `{bucket, prefix, manifest}`; `404` before the run published |

Outputs (contract `schedule-output-1`): `selected.jsonl`, `overflow.jsonl`, `summary.json`
and `manifest.json` (written last) under `outputs/<schedule>/runs/<run-date>/<run-id>/`,
copied to `outputs/<schedule>/latest/` for live runs. Simulations write under
`simulations/` and never touch the ledger.
