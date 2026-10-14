---
title: Operate searchable fields safely
impact: CRITICAL
tags: vector-search, operations, dev, prod, alarms, data-handling
---

## Operate searchable fields safely

### One ACTIVE generation

- Search serves exactly one generation. A generation contains only the
  embeddings it was built with, so activating a generation built without a
  field removes that field from search.
- The stream poller keeps every `BUILDING`, `READY` and `ACTIVE` generation
  current every minute, starting each one at its own W0. A newly declared
  embedding is logged as "needs a new generation" and ignored until one is built.
- Keep stream lag low: activation needs lag ≤ 300 s, and `VectorStreamLagAlarm`
  fires above 900 s for 15 minutes.

### Shared DEV

- Every Persist or Lexicon PR to `main` deploys its branch to the same DEV
  account. Another PR can replace the DEV Lexicon (dropping your embedding) or
  redeploy or remove the search stack.
- Before a DEV build or promotion, check that nothing else is mid-deploy and
  that the DEV Lexicon still declares your embedding. If another deploy
  interfered, wait for its runs to finish, then rerun your PR's DEV deploy:
  Persist first, then Lexicon.
- DEV keeps a removed eligibility's chunks for 24 hours before deleting them,
  so a temporary Lexicon from another branch does not wipe them. Every other
  stage deletes them on the next poll.
- Do not activate, roll back or retire while a Persist CI run (deploy or E2E)
  is in progress on DEV; a run that reads search would see the pointer move
  under it: `gh run list -R Spring-Oaks-Capital-LLC/persist --status in_progress`.

### DEV first, PROD read-only until approved

- Complete every piece in DEV with user-observed results before proposing PROD.
- In PROD, read-only checks (`status`, `activate` with `dryRun`, count queries,
  searches) are allowed once the user selects the PROD profile. Every write
  (Lexicon or Persist PR merge, bucket grant, backfill, activate, rollback,
  retire) needs explicit approval for that step.
- PROD builds are full-population and include every declared embedding; give
  the user the size and cost estimate before starting.
- Changing an existing embedding's `source_property`, `content`, `version` or
  `chunking.strategy` deletes its chunks from the PROD ACTIVE generation on the
  next poll. Schedule it with the user and build the replacement immediately.

### Alarms and signals

List them with:

```bash
aws cloudwatch describe-alarms --query "MetricAlarms[?contains(AlarmName,'Vector')].[AlarmName,StateValue]" --output table
```

| Alarm | Means |
| --- | --- |
| `VectorBackfillFailuresAlarm` | A backfill execution failed; resume it |
| `VectorBackfillBlobUnreadableAlarm` | Backfill skipped `blob_text` objects for 15 minutes |
| `VectorStreamPollerErrorsAlarm` | A generation's poll failed; its cursor is not advancing |
| `VectorStreamLagAlarm` | A generation is over 15 minutes behind Neptune Streams |
| `VectorStreamBlobUnreadableAlarm` | The poller skipped `blob_text` objects for 15 minutes |
| `VectorGenerationControlFailuresAlarm` | A control action failed; the pointer did not move |

These alarms have no notification action wired yet: check them yourself after
every piece. Poller logs: `Vector stream poll complete` (stop reason, cursor,
lag, counters). Metrics: namespace `persist`, `service=persist-vector-stream`
(`VectorStreamMaxLagSeconds`, `VectorStreamGenerationFailures`,
`VectorStreamEligibilityRemovalsPending`), `service=persist-vector-backfill`,
`service=persist-graphql-search`.

### Data handling

- Never log, paste or commit transcript, message or document text, search
  query text from real users, snippets, or vectors. Report ids, counts,
  statuses and timings.
- Use neutral example names and synthetic values in PRs and instructions.
- Persist logs and control responses already omit text; keep it that way in
  anything you write.
