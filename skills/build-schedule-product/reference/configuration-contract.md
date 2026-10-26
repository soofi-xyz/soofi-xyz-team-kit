# Schedule configuration contract `schedule-1`

This is the starting contract. Once `prismteam-ai/schedule` exists, its
`docs/configuration-contract.md` and `schemas/schedule-configuration.schema.json` are
authoritative; keep this file only as the seed and update it when the contract moves.

A schedule decides **who** to contact on a run date, **through which contact** and,
optionally, **in which hour**. Everything business-specific (who belongs to a cohort,
what counts as "reached", which hours are legal, how a subject ranks) comes from data
through the configuration's queries and column roles. The engine never names a channel,
a cohort, a campaign or a client.

## Shape

```jsonc
{
  "contract": "schedule-1",
  "id": "voicemail-cohort-a",                 // ^[a-z][a-z0-9-]{1,62}$, names ledger rows and outputs
  "title": "Daily voicemail rotation over Cohort A",
  "channel": "voicemail",                     // free label copied to every action; no behavior attached

  "run": {
    "schedule": "cron(0 7 ? * MON-FRI *)",    // rate(...), six-field cron(...) or manual
    "timezone": "America/New_York",           // defines run.date
    "costLimitUsd": 5,
    "timeoutMinutes": 60
  },

  "sources": [
    { "id": "cohort_a", "kind": "athena-sql", "sql": "SELECT … WHERE … ", "maxScanGiB": 50, "maxRows": 2000000 },
    { "id": "reached",  "kind": "athena-sql", "sql": "SELECT subject_id, reached_at FROM …", "maxScanGiB": 20 }
  ],

  "selections": [
    {
      "id": "cohort_a_daily",
      "source": "cohort_a",
      "columns": { "subject": "subject_id", "contact": "phone_number" },
      "count": 25000,
      "rotation": { "history": "reached", "cooldown": "P1D", "order": "least_recently_reached" },
      "rank": [{ "column": "balance", "order": "desc" }]
    }
  ],

  "output": { "passthrough": ["phone_number", "postal_code"] }
}
```

## Sources

| Kind | Fields | Notes |
| --- | --- | --- |
| `athena-sql` | `sql` (one `SELECT`), `maxScanGiB`, `maxRows` | Read-only. May reference `{{run.date}}`, `{{run.timezone}}` and `{{ledger.actions}}` |
| `persist-gremlin` | `query`, `maxRows` | Through Persist's async query API with the stack's IAM role |
| `s3-json` | `uri` (object or prefix of `{"results": [...]}` documents), `maxRows` | For callers that hand over already prepared rows; `uri` usually comes from a run override |

Sources hold no credentials. Every source is cost-estimated before any data is read; the
run stops above `costLimitUsd`.

## Selections

Selections run **in list order** and share one run: a subject chosen by an earlier
selection is not chosen again by a later one (first match wins). List order is
precedence.

| Field | Required | Meaning |
| --- | --- | --- |
| `source` | yes | Source whose rows are this selection's candidates (one row per subject, or per subject and contact) |
| `columns.subject` | yes | Subject identity column |
| `columns.contact` | no | Contact column; when several rows share a subject, `rank` picks one contact unless `contactsPerSubject` > 1 |
| `columns.allowedHours` / `columns.utcOffset` | no | Used by `delivery`; ignored otherwise |
| `count` | one of | Exact number to select; fewer when candidates run out (reported as `shortfall`) |
| `weeklyTarget` + `rotation.history` | one of | Select every candidate whose attempts in the last 7 days are below the target, up to `capacity` |
| `exclude` | no | List of source ids; subjects present in any of them are dropped (reason `EXCLUDED_BY_SOURCE`) |
| `rotation.history` | no | Source with `subject_id, reached_at` rows, or `"ledger"` for this schedule's own published selections. Default `"ledger"` |
| `rotation.cooldown` | no | ISO-8601 duration; subjects reached within it are not eligible (reason `COOLDOWN`) |
| `rotation.order` | no | `least_recently_reached` (never reached first, then oldest) is the only value in `schedule-1` |
| `rank` | no | Ordered `{column, order, nulls}` keys applied after rotation order |
| `contactsPerSubject` | no | Default 1 |

Ordering inside a selection is always total:
rotation order → `rank` keys → `sha256(schedule id, run.date, subject)`. Two runs of the
same configuration version over the same data and date produce the same selection.

## Delivery (optional)

Without `delivery` a run produces one daily list. With it, every selected action also
gets a campaign hour:

```jsonc
"delivery": {
  "clock": { "timezone": "America/New_York", "hoursByDay": { "mon-thu": [8, 22], "fri": [8, 17] } },
  "recipientWindow": { "local": ["08:00", "21:00"], "ambiguousOffset": "overflow" },  // or "all_must_allow"
  "capacity": { "hourly": { "8-11": 55000, "12-16": 70000 }, "daily": 650000 },
  "allocation": "earliest_deadline"                                                   // or "min_cost_flow"
}
```

Legal hours = clock hours ∩ recipient-local window (via `columns.utcOffset`) ∩
`columns.allowedHours` when present. Actions with no legal hour or no remaining capacity
become overflow with a typed reason. Never trim configured clock hours in the engine; an
hour that has already passed is overflow with `HOUR_PASSED`, not a silent change.

## Run request

`POST /schedules/{id}/runs` with an optional body:

```json
{ "runDate": "2026-10-27", "mode": "live", "overrides": { "selections.cohort_a_daily.count": 20000 }, "sourceUris": { "prepared": "s3://…" } }
```

`mode: "simulate"` runs everything and writes outputs under `simulations/` but never
writes the ledger or moves the published pointer.

## Ledger and rotation

- Every live run appends its selected actions to the append-only ledger with `run_id`.
- One published run per (schedule, run date). A re-run of the same date publishes a new
  run; the ledger view `{{ledger.actions}}` and `rotation.history: "ledger"` only read
  rows of each date's published run, so a retry never looks like an earlier contact.
- Failed, timed-out and simulated runs never count.

## Outputs `schedule-output-1`

Under `outputs/<schedule>/runs/<run-date>/<run-id>/`, copied to `outputs/<schedule>/latest/`
with the manifest last:

| File | Rows |
| --- | --- |
| `selected.jsonl` | `action_id` (`sha256(schedule, run.date, selection, subject, contact)`), `schedule`, `version`, `run_date`, `channel`, `selection`, `subject`, `contact`, `hour` (with delivery), `sequence`, passthrough columns |
| `overflow.jsonl` | `subject`, `contact`, `selection`, `stage` (`source`, `selection`, `delivery`), `reason` |
| `summary.json` | Per selection: `candidates`, `excluded` by reason, `cooldown`, `taken_by_earlier_selection`, `selected`, `shortfall`; per hour with delivery; resolved configuration version and overrides |
| `manifest.json` | Run id, version, counts, file list with SHA-256, written last |
