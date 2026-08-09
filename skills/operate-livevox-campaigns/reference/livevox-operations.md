# LiveVox operations reference

Use this reference only after completing Phase 0 of the parent skill.

## Resolve runtime configuration

Use AWS resource discovery in `us-east-2`:

```bash
aws stepfunctions list-state-machines \
  --profile <approved-profile> \
  --region us-east-2

aws ssm get-parameter \
  --name /integrate/livevox-secret-name \
  --profile <approved-profile> \
  --region us-east-2
```

Retrieve the named Secrets Manager value only inside the process that logs in.
Never print or persist its `LV-Access`, `clientName`, `userName`, `password`,
or the returned LiveVox `sessionId`.
The Integrate implementation in `src/livevox/client.ts` is the executable
reference; use it instead of inventing alternate request shapes.

## LiveVox API contract

Login:

```http
POST {base}/session/login
LV-Access: <secret field>
Content-Type: application/json

{"clientName":"...","userName":"...","password":"..."}
```

Use the returned `sessionId` as `LV-Session` on every later request, keep it
process-local, and discard it when the operation ends.

Search campaigns (paginate until `next` is null):

```http
POST {base}/campaign/campaigns/search?count=1000&offset=0
LV-Session: <session id>
Content-Type: application/json

{
  "dateRange": {"from": <epoch-ms>, "to": <epoch-ms>},
  "state": [
    "LOADING",
    "SCHEDULED_UNBUILT",
    "READY_UNBUILT",
    "SCHEDULED",
    "READY",
    "REPORTED",
    "DONE",
    "PLAYING",
    "PAUSED"
  ]
}
```

Use an Eastern business-date window with the same ±1-day tolerance as the
Integrate client. The response array is `campaign` (singular), campaign IDs may
be strings, and search rows do not carry reliable completion stats.

Read realtime campaign stats:

```http
POST {base}/realtime/campaign/stats
LV-Session: <session id>
Content-Type: application/json

{}
```

Join `stats[]` to search results by campaign ID. Preserve:

- `uploaded`: source rows known to LiveVox;
- `loaded`: records admitted into the dialer;
- `completed`: records worked/resolved;
- `remaining`: records pending to dial.

A missing stats row is expected for an unbuilt/deactivated campaign. A partial
row missing `loaded` or `completed` is transient build state; do not coerce it
into a completion decision.

Change state:

```http
PUT {base}/campaign/campaigns/{campaignId}/state
LV-Session: <session id>
Content-Type: application/json

{"state":"PLAY"}
```

or:

```json
{"state":"STOP"}
```

Use only `PLAY` and `STOP` for manual state operations. This runbook does not
use a DELETE endpoint.

Version-aware replacement is a separate deployed capability. It stamps
`_V<n>` names and retires supported superseded versions through:

```http
POST {base}/campaign/campaigns/{campaignId}/deactivate
LV-Session: <session id>
```

Treat it as unavailable unless the target Integrate deployment is proven to
contain replacement support and the Solver output contains a valid
`topup_mode` summary. Never invent `_V<n>` names or replace the deactivate
request with manual STOP calls.

## State interpretation

| State | Meaning for operators | Safe default |
| --- | --- | --- |
| `LOADING` | LiveVox is ingesting/building | Wait; do not infer 0 rows |
| `SCHEDULED_UNBUILT` | P1 has a schedule but is not built | Do not start/bypass |
| `READY_UNBUILT` | P2+ exists but is not built | Startable only as the next contiguous tier under the same predecessor gates as READY |
| `SCHEDULED` | Built P1 awaiting its window | STOP if approved replacement would overlap |
| `READY` | Built P2+ waiting for PLAY | Start only in contiguous tier order |
| `PLAYING` | Active dialing | STOP only for approved handoff/overdue hour |
| `PAUSED` | Active campaign that may resume | Treat as active for replacement |
| `REPORTED` | Terminal/reporting | No dialing risk; retain unless explicitly retired |
| `DONE` | Terminal | No dialing risk; retain unless explicitly retired |
| missing after STOP | Deactivated/removed from search | Successful re-check |

Do not compare completion against `uploaded`: LiveVox may scrub records at
load time, leaving `loaded < uploaded` permanently. While PLAYING, use
`completed / loaded` only after `loaded` has stopped moving long enough to
clear the ramp-stability gate.

## Naming and ownership

Solver names supported by the base campaign flow:

```text
FOUNDRY_SOLVER_<yyyyMMdd>_<HH>_QC
FOUNDRY_SOLVER_P<n>_<yyyyMMdd>_<HH>_QC
```

Versioned names
`FOUNDRY_SOLVER[_P<n>]_V<v>_<yyyyMMdd>_<HH>_QC` are valid only when
replacement support is proven in the deployed Integrate stack.

P1 has no `P1` segment. The hour stays second-to-last because legacy Airflow
parses `name.split("_")[-2]` as an integer.

Legacy MDC uses the configured `mdc2_file_name_prefix` (normally `FOUNDRY`).
Do not identify MDC by prefix alone because Solver names also start with
`FOUNDRY`; inventory all names, then classify Solver patterns explicitly and
treat the remaining configured-prefix campaigns as MDC.

Before changing a campaign, parse and verify:

- owner: MDC or Solver;
- Eastern business date;
- hour;
- Solver priority;
- replacement version;
- current state and campaign ID.

Reject malformed/ambiguous names instead of guessing their hour.

## Legacy MDC automation checks

Two Airflow DAGs may act while an operator is working:

- `livevox_deactivate_previous_hour`: runs hourly and retires configured-prefix
  campaigns past their windows;
- `livevox_active_backup`: watches the active pool and may start backup
  campaigns around the 85% convention.

Before a manual handoff:

1. Check recent DAG runs and logs.
2. Record each DAG's coordination owner and next scheduled run time.
3. Determine whether either DAG can touch the target campaign family.
4. Re-read LiveVox immediately before and after each write.
5. Treat a failed STOP followed by an absent/non-active campaign as a benign
   lost race; otherwise fail loudly.

Malformed active campaign names can crash legacy parsing. If a terminal
malformed campaign continues to generate automation errors, obtain explicit
human approval, STOP the exact campaign ID, and verify it disappears. Do not
bulk-retire all historical campaigns by prefix.

## Inventory queries and reports

Always paginate campaign search. Then provide:

```text
Eastern now: 2026-07-24 08:37 ET

ID        owner   hour tier/version status     loaded completed remaining
12345678  MDC     08   -            PLAYING    12000  9000      3000
12345679  Solver  08   P1/v1        REPORTED   3500   3500      0
12345680  Solver  08   P2/v1        READY      15000  0         15000
```

Flag separately:

- more than one `PLAYING`/`PAUSED` campaign for one hour/service;
- more than one scheduled P1 that can reach the same window;
- READY gaps such as P2 missing while P3 exists;
- active campaigns from ended hours;
- campaigns dated outside the current Eastern business date;
- stats counters that are missing, nonnumeric, or still moving.

## Manual start

Before `PLAY`:

1. Confirm the target is the lowest contiguous `READY` or `READY_UNBUILT` tier
   for the current hour.
2. Confirm no higher/lower version is already active.
3. Require the predecessor's `loaded > 0` and unchanged for at least 45 seconds
   across observations no more than five minutes apart.
4. Then require either `completed / loaded` at the deployed threshold or
   current starvation evidence matching the deployed watchdog: configured
   Ready-agent trigger, `playingDialable == 0` sustained for at least 20
   seconds, or its no-pipeline/free-agent fallback.
5. Never bypass a PLAYING predecessor with `loaded == 0`, or with
   `completed == 0` unless sustained zero-dialable proves nothing remains.
6. Re-fetch target state.
7. Send PLAY once.
8. Re-fetch until target becomes PLAYING/terminal or fail loudly.

Do not start next-hour campaigns early to solve a current-hour shortage.

## Manual deactivation

Before `STOP`, show the user:

```text
campaign ID / name:
current state:
reason:
replacement ID/name (if any):
expected post-state:
```

Then:

1. Re-fetch the campaign.
2. Send STOP to the exact ID.
3. Repeat the full paginated search.
4. Accept absent or non-active/non-scheduled as success.
5. If still active/scheduled, stop and escalate; do not continue to upload a
   conflicting P1.

For a current-hour MDC -> Solver handoff, verify the MDC is inactive before
manually PLAYing Solver. For future-hour replacement, verify old scheduled
campaigns cannot auto-start before accepting the new Integrate upload.
