# Flow schedules

A flow schedule starts a System flow on a cron. It replaces a hand-made EventBridge
rule, a custom Step Functions workflow or any outside caller that only calls
`POST /flows/{name}/invocations` on a timer. Those are legacy and not allowed for
new work.

## When to use one

- A flow must run at a time of day or on a calendar, such as daily before
  00:00 America/New_York, so its results are ready before another job starts.
- The flow takes the same input every time, apart from the run's business date
  and a run key.
- A run must never overlap the previous scheduled run of the same flow.

Use an event or S3 trigger when the work starts because something happened, and
the API when a caller decides when to start.

## Configure

The schedule is part of the flow file in the configuration bundle repository,
which Deploy installs through `PUT /flows/{name}`. A direct save is test-only:
send it to `https://<shared domain>/system` with the shared `x-api-key`, never
SigV4.

```json
"schedule": {
  "cron": "cron(0 22 * * ? *)",
  "timezone": "America/New_York",
  "input": { "callDate.$": "$.runDate", "batchId.$": "$.runKey", "mode": "daily" },
  "runDateOffsetDays": 1,
  "enabled": true
}
```

- `cron`: an EventBridge Scheduler expression, `cron(minutes hours day-of-month
  month day-of-week year)`. One of the two day fields must be `?`.
- `timezone`: the IANA name the cron and the run date are read in. A local time
  the spring-forward change removes does not run. A time the fall-back change
  repeats runs once.
- `input`: the run's input. A key ending in `.$` reads a per-run value, and any
  other key is a literal:
  - `$.runDate`: the scheduled date in `timezone` plus `runDateOffsetDays`, as
    `YYYY-MM-DD`. 22:00 New York on 2026-11-03 with offset 1 gives `2026-11-04`.
  - `$.runKey`: `schedule:<flow>:<scheduled time UTC>`, unique per run. It is
    also the run's idempotency key.
  - `$.scheduledTime`: the scheduled time in UTC.
- `runDateOffsetDays`: an integer, default 0.
- `enabled`: default true.

The input must pass the definition's `inputSchema`. A refused time is recorded
as `REJECTED` and in `GET /flows/{name}/rejections`.

A save refuses a bad expression, timezone, `.$` path or offset (400) and sets up
nothing. Saving the flow without `schedule` deletes the Scheduler schedule.

## What System does

- It keeps one EventBridge Scheduler schedule per scheduled flow, in the stack's
  group (output `FlowScheduleGroupName`). Nothing is created by hand.
- At each time `FlowScheduleFn` starts the flow through the same path as the
  API, keyed by `runKey`. A repeated delivery returns the first run.
- The run's `source` is `{"type": "schedule", scheduledTime, runKey, runDate}`.
- No overlap: while a run the schedule started is running, the time is skipped
  and recorded with a reason, not queued. API-started runs do not count.
- A time that could not be started is retried, then lands in
  `FlowScheduleDlqUrl`, with an alarm.

## Switch it off and on

```http
PUT /flows/{name}/schedule/enabled
{"enabled": false}
```

The schedule stays in Scheduler, disabled. The next save of the flow file sets
`enabled` to what the file says, so keep `"enabled": false` in the file to keep
it off across deploys.

## Verify

1. Read back: `GET /flows/{name}` shows `schedule` with defaults filled in, and
   `scheduleStatus.nextRunAt` in the expected UTC instant (check one date in
   winter and one in summer when the timezone has DST).
2. Short test schedule first: save a copy of the flow directly (test-only, on
   the shared domain with the shared `x-api-key`) with `cron(0/5 * * * ? *)`
   (or every minute), wait for two times, and check
   `scheduleStatus.recentRuns`:
   - `STARTED` with an `invocationId`, within a minute of `scheduledTime`;
   - `GET /invocations/{id}` shows `source.type: "schedule"` and the expected
     `runDate`.
3. Overlap: make a run outlast the interval (a long product step or a `Wait`).
   The next time must be `SKIPPED` with `invocation <id> from <time> is still
   running`, and no second run may exist.
4. Disable with the switch; no new `STARTED` may appear after it, and
   `nextRunAt` disappears.
   System has no delete route for flows, so then save the test copy without
   `schedule` to remove its Scheduler schedule.
5. Then put the real cron in the flow file and install it through the normal
   Marketplace and Puller path, never by `cdk deploy` or a hand-made rule.

On an install without schedules (an older System), a save with `schedule` is
refused: `CONFIGURATION_INVALID` for the unknown field, or
`SCHEDULES_NOT_ENABLED`. Upgrade System first.
