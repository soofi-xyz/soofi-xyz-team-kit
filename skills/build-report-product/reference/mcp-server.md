# Report MCP server

Requested 2026-10-27. This is implementation guidance, not evidence of deployed
support. Verify the target revision before claiming any tool exists.

Engineers and analysts in Claude Code or Cursor list, validate, save, refresh and
read reports through typed MCP tools. The server ships inside Report and is
installed with every Marketplace install; nothing is installed locally. Persist
ships its own server at `/persist/mcp`
([Persist MCP server](../../build-persist-service/reference/mcp-server.md)).

## Endpoint and transport

- Serve `https://<shared domain>/report/mcp` as stateless MCP Streamable HTTP
  from its own Lambda, behind the shared `x-api-key` and usage plan. Keep
  `marketplace.shared-api.json` free of public MCP routes.
- Call Report's management code in process, not its own HTTP API, so the key is
  never forwarded. Never put the key in tool arguments, results, errors or logs.
- Log each tool call with tool, report id, refresh id, duration and outcome.

## Tools

Schemas come from the configuration contract and `requirements/swagger.yml`; a
contract test fails when a tool and its route disagree.

| Tool | Route | Notes |
| --- | --- | --- |
| `list_reports` | `GET /reports` | |
| `get_report` | `GET /reports/{id}` | |
| `list_versions` | `GET /reports/{id}/versions` | |
| `validate_config` | `POST /reports/validate` | Returns every problem. |
| `save_config` | `PUT /reports/{id}` | The only write. Annotate `destructiveHint`; require `confirm: true`, validate first and return the saved version. |
| `refresh_and_wait` | `POST /reports/{id}/refreshes`, `GET …/refreshes/{refreshId}` | Starts a refresh within the configuration's `costLimitUsd` and a configured wait limit; returns `RUNNING` with the refresh id when the wait ends first. |
| `get_status` | `GET /reports/{id}/status` | |
| `get_outputs` | `GET /reports/{id}/outputs` | Manifest, `refreshId`, dataset row counts and columns. |

Refuse deletes and password changes. Explain errors plainly: key, `Forbidden`,
validation problems, cost limit, scan bound, `maxRows`, wait timeout.

## Configuration

Hold enabled tools, the refresh wait limit and poll interval in Report's
configuration so changes take effect without a redeploy.

## Feature pieces

| Piece | Delivers | Acceptance |
| --- | --- | --- |
| `mcp-read` | Endpoint, auth, logging, `list_reports`, `get_report`, `list_versions`, `get_status`, `get_outputs` | Claude Code and Cursor list the Report tools with the documented setup; reads match the HTTP API. |
| `mcp-validate-save` | `validate_config`, confirmed `save_config` | An invalid configuration lists its problems; a save without `confirm` is refused; a confirmed save returns the version `GET` reads back. |
| `mcp-refresh` | `refresh_and_wait` | Validate, save, refresh, wait for `SUCCEEDED` and read outputs and status, all through tools; an over-limit refresh fails at the cost gate. |
