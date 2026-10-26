---
name: configure-schedule-product
description: "Configure and test schedules on an existing Schedule deployment: define cohorts and contact history as queries, set daily counts, precedence, rotation and cooldowns, optional hours and capacity, validate, bundle, simulate, run and check the selected and overflow results. Use Klink; route service gaps to Klinklang."
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Configure Schedule

Use `klink`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Schedule capability map](../guide-product-work/reference/iterations/schedule.md) and
[the Schedule API summary](reference/api-contract.md).

This skill drives Schedule's HTTP API and never changes its code. The product is
`prismteam-ai/schedule`. Write configurations from its `docs/configuration-contract.md`,
`schemas/schedule-configuration.schema.json` and `examples/`, read outputs with
`docs/outputs.md`, all from the default branch (`git show origin/main:<path>`) without
switching the user's checkout. Before the repository owns the contract, use
[the seed contract](../build-schedule-product/reference/configuration-contract.md).
Confirm that each feature you use is deployed (the capability map lists what each piece
adds); route a missing feature to `klinklang` instead of working around it.

## Prerequisites

1. Require `SCHEDULE_API_KEY` (the environment's shared API key) in the user's terminal.
   Check presence with exactly this command and no other expansion of the variable:

   ```bash
   if [ -n "${SCHEDULE_API_KEY:-}" ]; then echo "SCHEDULE_API_KEY set (${#SCHEDULE_API_KEY} chars)"; else echo "SCHEDULE_API_KEY unset"; fi
   ```

   If it is unset, stop and ask the user to set it in their own terminal
   (`export SCHEDULE_API_KEY=...`). Never read the key from AWS yourself, print it, or ask
   for it in chat.
2. Find the shared domain and confirm the key with a read-only call that prints only the
   status code (`200` accepted, `403` rejected):

   ```bash
   SCHEDULE_URL="https://$(aws ssm get-parameter --name /account/env-parameters --query Parameter.Value --output text | jq -r .domain.fqdn)/schedule"
   curl -sS -o /dev/null -w '%{http_code}\n' -H "x-api-key: $SCHEDULE_API_KEY" "$SCHEDULE_URL/schedules"
   ```

3. Confirm the AWS profile's account and region before any AWS inspection.

## Write a configuration

Translate the request into data, not questions. Every business definition is a query or a
column the configuration points at:

| The request says | Configure |
| --- | --- |
| "Cohort A is …" | A source whose `SELECT` returns Cohort A's rows, one per subject (or subject and contact) |
| "Select 25,000" | `count: 25000` on the selection |
| "Don't reach yesterday's people today; reach others" | `rotation: {history, cooldown: "P1D", order: "least_recently_reached"}` |
| "Reached means …" | A history source returning `subject_id, reached_at`, or `"ledger"` for this schedule's own published selections |
| "Payfail first, then …" | One selection per group, in precedence order; earlier selections take subjects first |
| "Call these N times a week" | `weeklyTarget` with a history source |
| "Never contact these" | A source listed in the selection's `exclude` |
| "Only in legal hours, at most X per hour" | A `delivery` block; offsets and allowed hours as column roles |

1. Start from the repository example closest to the request. Give the schedule a lower-case
   `id` (`^[a-z][a-z0-9-]{1,62}$`).
2. Write each source as one read-only `SELECT` (or Persist query) with `maxScanGiB` and
   `maxRows`. Use only `{{run.date}}`, `{{run.timezone}}` and `{{ledger.actions}}`. Read
   the tables or graph the user names; when they name a concept without a table, find the
   table, show the query and its row count, and confirm before saving.
3. Map column roles (`subject`, `contact`, `allowedHours`, `utcOffset`) and `rank` keys to
   real columns. Keep passthrough columns to what the downstream consumer needs.
4. Set `run` (`schedule`, `timezone`, `costLimitUsd`, `timeoutMinutes`). Use the hours,
   counts and capacities the user asked for; never drop an hour or lower a count on your
   own. If timing makes one look infeasible, ask first.
5. Put no credentials, tokens or personal data in a configuration.
6. Validate without saving and fix every problem it lists:

   ```bash
   curl -sS -X POST -H "x-api-key: $SCHEDULE_API_KEY" -H 'content-type: application/json' \
     --data-binary @schedule.json "$SCHEDULE_URL/schedules/validate" | jq .
   ```

## Put it in a bundle

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md).
Ship a schedule as a CONFIGURATION bundle repository made from
`prismteam-ai/configuration-bundle-template`: `schedule/<id>.json` with per-install values
as parameters (`"schedule": "{{parameter:runSchedule}}"`, safe default `manual`),
`bundle.json` with `product: schedule`, `kind: schedule`, the `id` and `source`, and
`marketplace.product.json` with `bundle_type: CONFIGURATION` and a dependency on the
Schedule product. Open the PR and work it until checks and reviews are clean; the user
merges. Never push or merge yourself.

## Save, simulate, run and check

1. Save and read the result:

   ```bash
   curl -sS -X PUT -H "x-api-key: $SCHEDULE_API_KEY" -H 'content-type: application/json' \
     --data-binary @schedule.json "$SCHEDULE_URL/schedules/<id>" | jq '{version, outcome, schedule}'
   ```

   Saving over a bundle-installed schedule changes it until the next install; say so.
2. Simulate first. A simulation runs the real queries (and costs up to `costLimitUsd`)
   but writes no ledger rows, so it never affects rotation:

   ```bash
   curl -sS -X POST -H "x-api-key: $SCHEDULE_API_KEY" -H 'content-type: application/json' \
     -d '{"mode":"simulate"}' "$SCHEDULE_URL/schedules/<id>/runs" | tee /tmp/schedule-run.json
   ```

3. Follow it until it is no longer `RUNNING`:

   ```bash
   curl -sS -H "x-api-key: $SCHEDULE_API_KEY" "$SCHEDULE_URL/schedules/<id>/runs/$(jq -r .runId /tmp/schedule-run.json)" \
     | jq '{status, mode, version, runDate, estimatedCostUsd, summary, error}'
   ```

4. Check the summary per selection: `candidates`, `excluded`, `cooldown`,
   `taken_by_earlier_selection`, `selected`, `shortfall`. Check `selected.jsonl` from
   `GET …/runs/<runId>/results` for the expected count, no duplicate subjects, and that
   none of the cooldown subjects appear.
5. Prove rotation with two dates: simulate date D, then run D live (only within the
   requested scope; a live run writes the ledger and its output may be sent), then
   simulate D+1. D+1 must contain none of D's subjects while the cooldown holds, and
   never-reached subjects must lead.
6. Give the user at most three AWS inspection steps from the capability map, then wait for
   their redacted run id and observation in a guided walkthrough.

## Hand off

A missing feature, a wrong validation, a failing step that is not the configuration's
fault, or an output that breaks `docs/outputs.md` goes to `klinklang` with a redacted
reproducer (configuration, run id, error). Never edit Schedule code to make one schedule
pass.
