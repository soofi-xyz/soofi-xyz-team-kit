---
name: configure-report-product
description: "Configure and test reports on an existing Report deployment: write a report-1 configuration (sources, Athena SQL datasets, refresh schedule and cost limit), validate it, put it in a configuration bundle, save it, start a refresh, follow it and check the JSON outputs, through the API or the Report MCP tools. Use Bronzor; route service gaps to Bronzong."
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Configure Report

Use `bronzor`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Report capability map](../guide-product-work/reference/iterations/report.md) and
[the Report API summary](reference/api-contract.md).

Report is deployed; this skill drives its HTTP API and never changes its code. The
authoritative product is [`prismteam-ai/report`](https://github.com/prismteam-ai/report).
Write configurations from its
[configuration contract](https://github.com/prismteam-ai/report/blob/main/docs/configuration-contract.md),
its [JSON Schema](https://github.com/prismteam-ai/report/blob/main/schemas/report-configuration.schema.json)
and its [examples](https://github.com/prismteam-ai/report/tree/main/examples)
(`portal-performance.json` from Persist, `complaint-status-daily.json` from Athena). Read
outputs with its [output contract](https://github.com/prismteam-ai/report/blob/main/docs/outputs.md).
These win over this skill when they differ; read them from the default branch
(`git show origin/main:<path>`) without switching the user's checkout.

Report runs queries and writes JSON; it shows nothing. A request for a page, chart or
table on screen is Console work for `vivillon`, which reads the outputs.

## Prerequisites

1. Require `REPORT_API_KEY` (the environment's shared API key) in the user's terminal.
   Check presence with exactly this command and no other expansion of the variable:

   ```bash
   if [ -n "${REPORT_API_KEY:-}" ]; then echo "REPORT_API_KEY set (${#REPORT_API_KEY} chars)"; else echo "REPORT_API_KEY unset"; fi
   ```

   If it is unset, stop, and ask the user to set it from a teammate or from the shared
   usage plan's key in their own terminal (`export REPORT_API_KEY=...`). Never read the key
   from AWS yourself, print it, or ask for it in chat.
2. Find the shared domain and confirm the key with a read-only call that prints only the
   status code (`200` accepted, `403` rejected):

   ```bash
   REPORT_URL="https://$(aws ssm get-parameter --name /account/env-parameters --query Parameter.Value --output text | jq -r .domain.fqdn)/report"
   curl -sS -o /dev/null -w '%{http_code}\n' -H "x-api-key: $REPORT_API_KEY" "$REPORT_URL/reports"
   ```

3. Confirm the AWS profile's account and region before any AWS inspection.

## Write and validate a configuration

1. Start from the example closer to the request. Give the report a lower-case `id`
   (`^[a-z][a-z0-9-]{1,62}$`); it names the outputs, `outputs/<id>/latest/`.
2. Declare each source's `columns` with Athena types and lower-case names; they become the
   ledger table `report_ledger.<id-with-underscores>__<source>`. A source's columns cannot
   change while a refresh runs.
3. Write datasets as one Athena `SELECT` each. They read a source by its id (this
   refresh's rows), an earlier dataset by its id, or a whole ledger as
   `{{ledger.<source>}}`; queries may use only `{{window.start}}`, `{{window.end}}`,
   `{{window.startDate}}` and `{{window.endDate}}`. Every dataset becomes a JSON file, at
   most `maxRows` rows (default 1,000, up to 100,000).
4. Set `refresh`: `schedule` (`rate(...)`, six-field `cron(...)` or `manual`), `timezone`,
   `window.lookbackDays`, `costLimitUsd` and `timeoutMinutes`.
5. Put no credentials, tokens or personal data in a configuration; reports have none.
6. Validate without saving and fix every problem it lists:

   ```bash
   curl -sS -X POST -H "x-api-key: $REPORT_API_KEY" -H 'content-type: application/json' \
     --data-binary @report.json "$REPORT_URL/reports/validate" | jq .
   ```

   `{"valid": true, "problems": []}` is the pass. A problem's `path` is a JSON Pointer
   into the configuration.

## Put it in a bundle

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md).
A report ships as a CONFIGURATION bundle repository made from
`prismteam-ai/configuration-bundle-template`, like
[`prismteam-ai/portal-performance-report`](https://github.com/prismteam-ai/portal-performance-report):

- `report/<id>.json`: the configuration, with per-install values as parameters such as
  `"schedule": "{{parameter:refreshSchedule}}"`.
- `bundle.json`: `configurations` with `product: report`, `kind: report`, the `id` and its
  `source`; `parameters` with safe defaults (`manual`, so review installs do not refresh);
  `secrets: {}`.
- `marketplace.product.json`: `bundle_type: CONFIGURATION` and a dependency on the Report
  product's `report` component.

The repository's CI validates the bundle; merging to `main` publishes it (Registeel owns
publication, Skarmory installation through a Deploy subscription, whose `configuration`
sets the parameters). Open the PR and work it until checks and reviews are clean; the
user merges. Never push or merge yourself.

## Save, refresh and check

1. Save (in a test environment, or when installing by hand) and read the result:

   ```bash
   curl -sS -X PUT -H "x-api-key: $REPORT_API_KEY" -H 'content-type: application/json' \
     --data-binary @report.json "$REPORT_URL/reports/<id>" | jq '{version, outcome, schedule, ledger}'
   ```

   Expect `201` and `CREATED` for a new report, `200` with `UPDATED` or `UNCHANGED`
   otherwise. Saving over a bundle-installed report changes it until the next install;
   tell the user, and restore the bundle's parameters afterwards.
2. Start a refresh only within the requested scope: each one runs real Persist and Athena
   queries and costs up to `costLimitUsd`.

   ```bash
   curl -sS -X POST -H "x-api-key: $REPORT_API_KEY" "$REPORT_URL/reports/<id>/refreshes" | tee /tmp/report-refresh.json
   ```

   `202` with `RUNNING` is acceptance only; `409` means one is already running.
3. Follow it until it is no longer `RUNNING`:

   ```bash
   curl -sS -H "x-api-key: $REPORT_API_KEY" "$REPORT_URL/reports/<id>/refreshes/$(jq -r .refreshId /tmp/report-refresh.json)" \
     | jq '{status, estimatedCostUsd, sourceRows, datasetRows, error}'
   ```

   `SUCCEEDED` with the expected `datasetRows` is completion. On `FAILED`, read
   `error.code` and `error.message` (cost limit, scan bound, `maxRows`, query error).
4. Check the outputs: `GET $REPORT_URL/reports/<id>/outputs` returns the bucket, prefix and
   newest manifest; its `refreshId` must be the refresh you started, and each dataset's
   `rowCount` and `columns` what the configuration intends. With AWS access, list
   `s3://<bucket>/outputs/<id>/latest/` (bucket in SSM `/report/Report/output-bucket`).
5. Give the user at most three AWS inspection steps from the capability map (the `Refresh`
   execution, the Athena queries, the output files), then wait for their redacted refresh
   id and observation in a guided walkthrough.

## Use the MCP tools

Connect clients with [the MCP client setup](../configure-persist-product/reference/mcp-client-setup.md)
once [the Report MCP server](../build-report-product/reference/mcp-server.md) is
deployed. `validate_config`, `save_config` (`confirm: true`), `refresh_and_wait`,
`get_status` and `get_outputs` follow the same rules as the API steps above; check
each result against the API before relying on it.

## Hand off

A missing capability, a wrong validation, a failing refresh step that is not the
configuration's fault, or an output that breaks `docs/outputs.md` goes to `bronzong` with a
redacted reproducer (configuration, refresh id, error). Never edit Report code to make one
report pass.
