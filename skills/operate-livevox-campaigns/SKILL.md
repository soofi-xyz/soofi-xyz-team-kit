---
name: operate-livevox-campaigns
description: "Operates SOC call campaigns across Solver, Integrate, LiveVox, and legacy MDC: inventories current campaigns, checks states and stats, safely starts or stops campaigns, refills remaining hours with graph-filtered data, deduplicates debt IDs, and verifies uploads. Use for manual campaign operations, LiveVox incidents, agent starvation, MDC replacement, same-day refill, top-up, or remaining-hours scheduling. Triggers on: LiveVox, MDC, campaign, deactivate, stop campaign, refill, top up, remaining hours, P1, P2, P3, watchdog, agent starvation. Do NOT use for changing solver algorithms or business rules."
---

# Operate LiveVox campaigns

Use this runbook for production campaign operations spanning:

```
Persist graph + Lexicon rules
  -> Filter
  -> SolverWorkflow
  -> S3 scheduled_calls
  -> IntegrateStateMachine
  -> LiveVox + legacy MDC automation
```

Treat every `PLAY`, `STOP`, Solver execution, Integrate execution, and S3
publication as a production change.

## Non-negotiable principles

1. **Inventory before mutation.** Search LiveVox across every relevant state,
   paginate all results, join realtime stats, and show the exact campaign IDs
   and intended actions before writing.
2. **Use Eastern business time.** Campaign dates and hours are US/Eastern.
   Never derive the business date or target hour from the operator's local
   timezone.
3. **Use graph-filtered populations.** Source debtor data from Persist through
   Filter and Lexicon/rules. Never refill from raw ETL, Interprose tables, a
   user-provided CSV, or an unverified partial snapshot.
4. **Never double dial.** Build one debt-ID exclusion set covering every
   campaign already delivered that day. Validate zero overlap before upload.
5. **Use only deployed retirement semantics.** Manual operations use the state
   update `STOP`; version-aware replacement is separate and uses a deactivate
   endpoint. Never substitute one for the other. Re-fetch after every action.
6. **Do not guess through missing evidence.** A missing stats row is normal for
   unbuilt campaigns; a failed search, unknown state, incomplete Filter run, or
   untraceable S3 source is a blocker.
7. **Keep P1 special.** P1 has a schedule window and may auto-start. P2+ has no
   schedule and stays READY until the watchdog or a supervisor starts it.
8. **Verify the real system.** A successful API response is not enough. Re-read
   LiveVox state, campaign IDs, rows, and stats; record Step Functions
   execution ARNs and anomalies.
9. **Do not expose secrets or PII.** Never print, log, paste, or return debt
   IDs, debtor rows, phone numbers, exclusion contents, LiveVox credentials,
   or `sessionId`. “IDs” in reports means campaign IDs and execution ARNs.

## Choose the operation

| Situation | Operation |
| --- | --- |
| Need to know what exists | Read-only inventory |
| P2+ is READY and the active tier is exhausted/starved | Start next tier |
| MDC and Solver overlap in the same hour | Controlled handoff |
| Active campaign is from an ended hour | Deactivate overdue campaign |
| Future MDC/old Solver campaigns would overlap a replacement | Future-hour replacement |
| Today's schedule is underfilled because Solver used a partial pool | Emergency remaining-hours refill |
| New same-day payfails arrived and supported top-up workflow is live | Versioned payfail top-up |

For exact LiveVox endpoints, states, naming, and MDC checks, read
[reference/livevox-operations.md](reference/livevox-operations.md).

For the remaining-hours and current-hour continuation procedure, read
[reference/emergency-refill.md](reference/emergency-refill.md).

## Phase 0 — establish authority and target

This phase gates every later phase.

1. Confirm the requested environment, Eastern business date, current Eastern
   hour, target service, and target hours.
2. Resolve the AWS profile and resources by name in `us-east-2`; do not copy an
   account ID or ARN from an old incident. Run `aws sts get-caller-identity`
   with the selected profile and verify the account against the approved
   environment.
3. Resolve the LiveVox secret name from
   `/integrate/livevox-secret-name`. Never print the secret.
4. Confirm whether the watchdog is live, disabled, or dry-run. During manual
   surgery, account for actions it may take between reads.
5. State whether the user approved read-only inspection, campaign state
   changes, campaign uploads, or all three. Read-only permission does not
   authorize `PLAY`, `STOP`, Solver, or Integrate.
6. Record the deployed Solver and Integrate stack/commit versions before
   relying on optional behavior such as versioned replacement.

## Phase 1 — produce the inventory

Search today's campaigns across:

`LOADING`, `SCHEDULED_UNBUILT`, `READY_UNBUILT`, `SCHEDULED`, `READY`,
`PLAYING`, `PAUSED`, `REPORTED`, and `DONE`.

Join campaign search results with realtime campaign stats by campaign ID.
Classify:

- legacy MDC (`FOUNDRY...` but not a Solver name);
- Solver P1 (`FOUNDRY_SOLVER_<date>_<hour>_QC`);
- Solver P2+ (`FOUNDRY_SOLVER_P<n>_<date>_<hour>_QC`);
- versioned replacements (`..._V<n>_<date>_<hour>_QC`) only when deployed
  replacement support is proven.

Return a compact inventory before proposing a write:

```
Eastern date/hour:
Campaign ID | owner (MDC/Solver) | hour | priority/version | status
loaded | completed | remaining | schedule window | proposed action
```

Also inspect:

- recent Integrate executions and `hourResults`;
- the originating Solver run and the single JSON part in `run_summaries/`;
- the legacy Airflow `livevox_deactivate_previous_hour` and
  `livevox_active_backup` state when MDC is involved.

## Phase 2 — plan one safe transition

### Start the next Solver tier

Use the watchdog's production rules rather than a raw percentage guess:

- stay in the current Eastern hour;
- walk priorities contiguously; never skip P2 to start P3;
- require the target tier to be `READY` or `READY_UNBUILT`;
- treat `loaded = 0` as not built, not exhausted;
- require the predecessor's `loaded > 0` and unchanged for at least 45 seconds
  across observations no more than five minutes apart;
- require either `completed / loaded` at the deployed threshold or current
  starvation evidence matching the deployed watchdog: its configured
  Ready-agent trigger, `playingDialable == 0` sustained for at least 20
  seconds, or its no-pipeline/free-agent fallback;
- never bypass a PLAYING predecessor with `loaded == 0`, or with
  `completed == 0` unless sustained zero-dialable proves nothing remains.

Re-fetch immediately before `PLAY`. If a human or watchdog already started the
tier, treat the goal as achieved and do not send another action.

### Controlled MDC -> Solver handoff

1. Identify the active/scheduled MDC campaign and the exact Solver replacement
   for the same Eastern hour.
2. Confirm the Solver campaign is uploaded and has nonzero rows.
3. Send `STOP` to the MDC campaign.
4. Re-fetch until the MDC campaign is absent or no longer active/scheduled.
5. Start Solver manually only if P1 did not auto-start. A P1 uploaded after its
   schedule start may need `PLAY`; never assume.
6. Verify exactly one campaign family is `PLAYING` for that hour.

### Deactivate campaigns

- `PLAYING` and `PAUSED`: STOP only when overdue or explicitly replaced.
- `SCHEDULED`, `SCHEDULED_UNBUILT`, `READY`, `READY_UNBUILT`: STOP when an
  approved replacement would otherwise overlap.
- `REPORTED` and `DONE`: terminal and not a dialing risk. STOP them only when a
  human explicitly approves retiring historical artifacts (for example, to
  remove malformed names from legacy automation).
- `LOADING`: do not race the build. Wait for a stable state unless the incident
  owner explicitly accepts the risk.

After each STOP, repeat the full search. A deactivated campaign commonly
disappears from search/stats; disappearance is a valid successful re-check.

### Replace future hours

Version-aware replacement is unavailable unless the target Integrate
deployment is proven to support `_V<n>` names and the Solver output carries a
valid `topup_mode` summary. That workflow uploads a versioned replacement and
retires superseded versions through its dedicated deactivate endpoint; manual
`STOP` is not a substitute.

If replacement support is unavailable, do not invent `_V<n>` names or feed an
existing Solver hour through normal Integrate. Use only an approved MDC ->
already-uploaded-Solver handoff, a current-hour continuation, or escalate.

When replacement support is proven:

1. Show every old and new campaign for each hour.
2. Ensure the new output excludes already delivered debt IDs.
3. Prevent two scheduled P1s from reaching the same window.
4. Let the replacement workflow upload first and deactivate only its supported
   superseded states.
5. Re-fetch and verify every retirement.
6. Verify campaign IDs, row counts, names, schedule windows, and that only the
   intended P1 remains scheduled.

Do not improvise naming to avoid a collision. Use continuation priorities for
the current hour or the supported versioned replacement contract.

## Phase 3 — execute with write gates

Before the first write, present:

```
Environment / Eastern date:
Exact campaign IDs to PLAY:
Exact campaign IDs to STOP:
Solver input and target hours:
S3 source and exclusion-list URI:
Expected rows per hour/priority:
Rollback or stop condition:
```

Stop and obtain explicit approval of this exact plan even when it matches the
original request. A broad request such as “refill today” is not approval for
specific production writes. Execute STOPs before PLAYs during a handoff. Use
Integrate for uploads; do not upload campaign files with a one-off LiveVox
implementation.

## Phase 4 — verify and hand off

Require all applicable checks:

- Solver and Integrate executions reached `SUCCEEDED`;
- Solver output counts match the authoritative JSON in `run_summaries/`;
- every CSV has exactly 13 columns;
- debt IDs are unique across already delivered + new files;
- exclusion overlap is zero;
- every Integrate `hourResult` is `ok`;
- `campaignsFailed == 0` and `rowsUploaded` matches local/S3 counts;
- LiveVox search returns expected names, IDs, rows, states, and windows;
- no overlapping MDC/old Solver campaign remains active or scheduled;
- current-hour continuation priorities exist contiguously; each is
  `READY`/`READY_UNBUILT`, or the lowest eligible tier is already `PLAYING`
  with a matching watchdog campaign ID/action in logs;
- at most one campaign is `PLAYING`/`PAUSED` for the target service, and no
  higher tier started out of order;
- future P1s are scheduled for the correct Eastern windows;
- watchdog logs show the expected decision path after the handoff.

Report:

```
Solver execution:
Integrate execution:
Rows by hour/priority:
Campaign IDs:
STOP/PLAY actions:
Duplicate/overlap result:
LiveVox post-state:
Manual follow-up:
```

If Solver was changed or this is an e2e validation run, compare total workflow
and Glue runtime with a comparable baseline and report the delta.
