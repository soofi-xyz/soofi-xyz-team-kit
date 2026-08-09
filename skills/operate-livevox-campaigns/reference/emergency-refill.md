# Emergency remaining-hours refill

Use this procedure only when today's call supply is materially underfilled and
the supported automatic top-up/replace workflow cannot solve it in time.

All hours and dates below are US/Eastern.

## Preconditions

Do not start Solver until all are true:

- the complete Filter execution is `SUCCEEDED` with zero failed or
  tolerated-failed items;
- `aggregated-statistics.json` and `parts/results/` exist;
- failed-file counts and population size are understood;
- the source represents graph/Persist data evaluated through current
  Lexicon/rules;
- every campaign already delivered today is mapped to an originating Solver
  output or another row-level artifact;
- target hours are explicitly approved.

Do not upload any `30pct-completed`, `remaining-70pct`, or similar partial
snapshot under this skill. If a partial population was already uploaded outside
this runbook, include its delivered debt IDs in the same-day exclusion set, but
use only the complete Filter output for the refill.

## 1. Diagnose the shortage

Compare:

- normal complete Filter population;
- population used by today's Solver execution;
- Solver input/processed/scheduled counters;
- rows delivered by Integrate;
- LiveVox loaded/completed/remaining by hour.

Classify the failure:

| Cause | Correct response |
| --- | --- |
| Solver scheduled every available candidate but input was partial | Refill from complete Filter output |
| Filter output itself is small | Fix/investigate upstream; do not manufacture rows |
| Campaigns exist but LiveVox has no dialable records | Investigate timezone/compliance/starvation |
| P2+ exists in READY | Start tiers/watchdog; no new Solver run |
| Future campaigns already contain enough rows | Do not refill |

## 2. Build the same-day exclusion set

Trace every already delivered campaign to its headerless 13-column Solver CSV.
The first column is `debt_id`.

Collect IDs from:

- completed and active earlier hours;
- current-hour stopgap P1/P2;
- future campaigns that will remain in LiveVox;
- any manual upload outside the main Solver run.

Create a private temporary directory outside every repository with restrictive
permissions. Never print or return the IDs. Create a unique JSON array of
nonblank strings:

```python
import csv
import json
from pathlib import Path

ids: set[str] = set()
source_rows = 0
for path in Path("already-delivered").rglob("*.csv"):
    with path.open(newline="") as handle:
        for row in csv.reader(handle):
            source_rows += 1
            if len(row) != 13:
                raise ValueError(f"{path}: expected 13 columns, got {len(row)}")
            debt_id = row[0].strip()
            if not debt_id:
                raise ValueError(f"{path}: blank debt_id")
            ids.add(debt_id)

Path("exclude_debt_ids.json").write_text(
    json.dumps(sorted(ids), separators=(",", ":"))
)

print({"source_rows": source_rows, "unique_debt_ids": len(ids)})
```

Upload it only to an approved private Solver/incident bucket and record its URI,
count, owner, and expiry. Delete local ID files after verification. The Solver
input `exclude_debt_ids_s3_uri` expects exactly this JSON array.

## 3. Run Solver for remaining hours

Use the complete Filter `parts/results/` prefix:

```json
{
  "input_s3_uri": "s3://<complete-filter-run>/parts/results/",
  "selected_day_of_week": "<EASTERN_WEEKDAY>",
  "schedule_hours": [12, 13, 14, 15, 16, 17, 18, 19, 20],
  "payfail_autodetect": true,
  "enable_score_tiers": true,
  "tier_size": 15000,
  "enable_phone_rotation": false,
  "exclude_debt_ids_s3_uri": "s3://<incident-prefix>/exclude_debt_ids.json"
}
```

Set only the hours still needed. Do not recompute completed hours. Keep
`payfail_autodetect` and score-tier settings aligned with today's campaign
contract.

Monitor:

1. Step Functions execution status.
2. Distributed Map enrichment `itemCounts`.
3. Glue job status and application logs.
4. `or_solver phase=schedule_complete` counters.
5. S3 output partitions.

Solver writes hour partitions before all final actions, so plausible CSVs may
remain after a failed job. Never publish until the execution is `SUCCEEDED` and
the authoritative `run_summaries/` JSON exists. Treat every failed/timed-out
prefix as tainted and start a new execution with a new prefix; incident approval
cannot waive this completeness gate.

For solver e2e/changed code, compare total workflow duration and Glue
`ExecutionTime` to a comparable baseline and report the delta.

## 4. Validate the output

Read the single JSON part under `<solver-run-root>/run_summaries/`. Require it
to identify the current output URI/business date and reconcile its
per-hour/per-priority counts against the CSV files. Then independently validate
the files:

```python
import csv
from pathlib import Path

existing = {
    line.strip()
    for line in Path("already-delivered-debt-ids.txt").read_text().splitlines()
    if line.strip()
}
seen = set(existing)
rows = overlaps = duplicates = malformed = 0

for path in Path("new-output").rglob("*.csv"):
    with path.open(newline="") as handle:
        for row in csv.reader(handle):
            rows += 1
            if len(row) != 13:
                malformed += 1
                continue
            debt_id = row[0].strip()
            if not debt_id:
                malformed += 1
                continue
            if debt_id in existing:
                overlaps += 1
            if debt_id in seen:
                duplicates += 1
            seen.add(debt_id)

print(
    {
        "rows": rows,
        "excluded_overlap": overlaps,
        "duplicate_debts": duplicates,
        "bad_column_rows": malformed,
    }
)

if overlaps or duplicates or malformed:
    raise SystemExit("unsafe campaign output")
```

Also require:

- every requested hour exists;
- P1 exists when payfails were scheduled;
- ordinary priorities are contiguous;
- hourly totals are plausible against configured capacity;
- no empty CSV is uploaded;
- total rows equal the sum of per-hour/per-priority rows.

## 5. Continue an already-loaded current hour

If P1/P2 (or deeper tiers) already exist, do not upload another campaign with
the same names and do not replace a campaign that is actively feeding agents.

1. Require exactly one retained Solver campaign at every priority `P1..Pk`.
   Stop on gaps or duplicate versions.
2. Remove every already delivered debt ID from the new output.
3. List the non-empty new partitions in ascending original priority as
   `q1..qn`; remap `q1 -> P{k+1}`, `q2 -> P{k+2}`, and so on. Do not calculate
   the destination as `original_priority + k`: new output may omit P1.
   - Example: existing P1/P2 and new non-empty P2/P3 means new P2 -> P3 and
     new P3 -> P4.
4. Preserve every CSV row byte-for-byte except for removing excluded rows; the
   priority is encoded in the S3 partition path, not the 13-column body.
5. Place only that hour under an isolated prefix:

```text
s3://<incident>/current-hour/scheduled_calls/hour=12/priority=3/part-*.csv
s3://<incident>/current-hour/scheduled_calls/hour=12/priority=4/part-*.csv
```

6. Validate 13 columns, zero overlap, zero duplicate debt IDs, and contiguous
   P3+ priorities.
7. Run Integrate on the isolated root.
8. Verify the complete resulting chain is exactly `P1..P{k+n}` before touching
   future hours.

This continuation changes dial order: newly found payfails cannot be inserted
ahead of an already running P2 without stopping active work. State that tradeoff
explicitly.

## 6. Prepare future hours

For hours with no existing campaigns:

- remove the full same-day exclusion set;
- preserve Solver priorities and names;
- publish them together under a separate isolated root.

For hours with existing campaigns:

- decide whether they remain or are replaced;
- if they remain, add all of their debt IDs to the exclusion set;
- if replaced, first prove the deployed Integrate stack supports versioned
  replacement and that the input has a valid `topup_mode` summary;
- otherwise do not feed the existing Solver hour to normal Integrate. Escalate,
  or obtain approval for an MDC -> already-uploaded-Solver handoff.

Never shift priorities on untouched future hours merely because the current
hour was shifted.

## 7. Upload through Integrate

Point Integrate at a root that contains `scheduled_calls/`:

```json
{
  "input_s3_uri": "s3://<incident-prefix>/current-hour/"
}
```

Upload in this order:

1. current-hour continuation (most urgent);
2. verify campaign IDs and contiguous states;
3. future hours;
4. verify every future P1 schedule window.

Do not point Integrate at a parent prefix containing raw, old, and transformed
outputs together.

## 8. Post-upload verification

From the Integrate output, require:

- every `hourResult.status == "ok"`;
- `campaignsFailed == 0`;
- `rowsUploaded` equals validated rows;
- each result has a campaign ID.

Then inventory LiveVox again and verify:

- current-hour continuation priorities are contiguous; each is
  `READY`/`READY_UNBUILT`, or the lowest eligible tier is already `PLAYING`
  with a matching watchdog campaign ID/action in logs;
- at most one campaign is `PLAYING`/`PAUSED` for the target service, and no
  higher tier started out of order;
- only one active campaign is feeding the service;
- future P1s are SCHEDULED for the intended Eastern windows;
- future P2+ tiers are READY/READY_UNBUILT;
- no retained MDC or old Solver P1 can overlap;
- watchdog logs recognize the new tiers.

Record:

```text
Filter execution / population:
Solver execution / runtime:
Exclusion URI / count:
Rows removed:
Rows uploaded by hour:
Integrate execution:
Campaign IDs:
LiveVox final states:
Known manual follow-up:
```

Delete all local debt-ID/exclusion files after verification. Do not include
their contents in logs or the handoff.
