---
title: Promote, roll back and retire generations
impact: CRITICAL
tags: vector-search, generation, activation, rollback, retire, lambda
---

## Promote, roll back and retire generations

GraphQL `search` reads only the generation the ACTIVE pointer names. Every
pointer change goes through the `VectorGenerationControl` Lambda; never edit
the DynamoDB registry or OpenSearch indexes by hand. Ask before every
`activate` (without `dryRun`), `rollback` and `retire`.

```text
BUILDING --finalize--> READY --activate--> ACTIVE --(next activation demotes)--> READY --retire--> RETIRED
BUILDING --retire (no backfill execution running)--> RETIRED
```

### Invoke

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
FN=$(aws ssm get-parameter --name /persist/opensearch/vector-generation-control-function-name --query Parameter.Value --output text)
control() { aws lambda invoke --function-name "$FN" --cli-binary-format raw-in-base64-out --payload "$1" /tmp/control.json >/dev/null && jq . /tmp/control.json; }

control '{"action":"status"}'
control '{"action":"activate","generation":"g2","expectedActive":"g1","dryRun":true}'
control '{"action":"activate","generation":"g2","expectedActive":"g1"}'
control '{"action":"activate","generation":"g2","expectedActive":"g1","evaluation":{"setId":"notes-known-10","recallAt5":0.9}}'
control '{"action":"rollback","expectedActive":"g2"}'
control '{"action":"retire","generation":"g1"}'
```

Requests are strict: unknown fields are rejected. The response is JSON with
`outcome` (`STATUS`, `WOULD_ACTIVATE`, `BLOCKED`, `ACTIVATED`, `ROLLED_BACK`,
`RETIRED`), `activeBefore`, `activeAfter`, `gates[]` (`gate`, `passed`,
`detail`), `cleanup` (retire) and `generations[]` (status, profile, model,
recorded documents, cursor, `lagSeconds`). It never contains source text.

### `status`

Read it first and last. Note which generation is ACTIVE, which is the new one
(`READY` after its backfill), its `lagSeconds` and `cursor`.

### `activate`

- Pass `expectedActive` with the generation `status` reported as ACTIVE, so the
  call is refused if someone moved the pointer meanwhile. Omit it only for the
  very first activation, when nothing is ACTIVE.
- Run with `"dryRun": true` first. `WOULD_ACTIVATE` means every gate passed;
  `BLOCKED` means nothing was written. Explain each failed gate's `detail`.
- The real call moves the pointer, demotes the old ACTIVE to `READY` and
  records it as `previousGeneration`, the only rollback target.

| Gate | Passes when | If it fails |
| --- | --- | --- |
| `status` | The target is `READY` | Wait for the backfill to finish; a failed run is resumed, not activated |
| `profile` | Its embedding profile is registered and matches the recorded model, dimensions and metric | Engine/profile issue: route to Conkeldurr |
| `stream_cursor` | The stream poller created the generation's cursor | Wait a few minutes after `READY`; check the poller is running |
| `stream_lag` | Seconds since the cursor last caught up or applied a commit ≤ 300 | The poller replays from W0 after a long build; wait until `lagSeconds` ≤ 300 in `status` |
| `stream_failures` | `VectorStreamGenerationFailures` for the generation summed over 900 s is 0 (an unreadable metric fails) | Find the poller error in its logs, fix the cause, then wait 15 clean minutes |
| `index_documents` | The live index count is above 0 | The build wrote nothing: check counters and the allowlist |
| `source_rows` | The backfill recorded counters and `extractionFailures` is 0 | Route the undecodable rows to Conkeldurr; do not force activation |
| `evaluation` | Optional `{ setId, recallAt5 }` with `recallAt5` ≥ 0.85; passes when not supplied | Improve or reconsider the declaration; do not lower the bar |

### `rollback`

Activates the pointer's `previousGeneration` through the same gates, fenced on
`expectedActive` (the current ACTIVE). Use it when the new generation returns
wrong or missing results. Only one step back is recorded.

### `retire`

- Refuses the ACTIVE generation.
- `READY` → `RETIRED` at once. A `BUILDING` generation can be retired only while
  no `PersistVectorBackfillWorkflow` execution is running; stop that execution
  first.
- The first call marks it retired and returns `cleanup.state` `PENDING_GRACE`
  with `cleanupAfter` (600 s later). Call `retire` again after `cleanupAfter` to
  delete the generation's stream cursor and index; repeat while it reports
  `PENDING_LEASE`, until `COMPLETE`.
- Retiring the `previousGeneration` removes the rollback target. Keep it until
  the user accepts the new generation, then retire it: every non-retired
  generation is kept current by the poller and costs embeddings on every change.

A failed control action publishes `VectorGenerationControlFailed` and fires
`VectorGenerationControlFailuresAlarm`; a `BLOCKED` result is a refusal, not a
failure, and the pointer did not move.
