# Intake questions and confirmation gates

## Focused questions

After intent resolution, ask only the questions whose answers discovery did not
already prove. Use the structured question tool (`AskQuestion`) with the
resolver's `questions[]` entries: `id`, `prompt`, `options[]`, `allowMultiple`,
and `default`. Show the default as the first option. Ask them in this order and
stop to wait after each batch. Several independent questions may share one
tool call.

| Id | When asked | Options | Default |
| --- | --- | --- | --- |
| `mapping-choice` | status `AMBIGUOUS`, `NO_MAPPING`, or `UNKNOWN_LANGUAGE` | ranked candidates plus `none` (stop and report the gap) | none; the user must choose |
| `environment` | no `in dev`/`in prod` hint | `dev`, `prod-read-only` | `dev` |
| `mapping-version` | more than one enabled version, no version hint, and the version was not defaulted by `latest-published-semver` (its `notice` is shown instead) | each `id@version` with its outputs | the resolver's selection |
| `upstream-source` | `UpstreamSourceUnresolved` | candidate producers, `existing-graph-export` | the selected profile's first workflow step when it is a candidate, else none |
| `direction-mode` | an inverse mapping exists and no mode hint | `round-trip`, `one-way` | `round-trip` for `X -> <hub>`; `one-way` for `<hub> -> Y` |
| `cross-source-step` | a `<hub> -> Y` mapping consumes forward outputs | each downstream mapping, `none` | none |
| `persist-policy` | always, unless the profile fixes it | `forbidden`, `required` | `forbidden` |
| `source-window` | before any staging, after the read-only candidate comparison, unless the owner chose the most recent full UTC day with real data per slice | recommended window, longer complete range (when allowed), `stop` | none; the user must choose |
| `empty-slice` | a slice has no real PROD data on the chosen day | the nearest UTC day with data (from `source_window.py data-days`), `stop` | none; the user must choose |
| `canary-gate` | after the DEV canary passed its comparison with the PROD actual, unless the owner pre-approved the full run | `run-full-window`, `stop` | none; the user must choose |

Rules:

- `prod-read-only` limits the run to metadata and existing sanitized evidence.
  It can never select staging, deployment, or execution, so it ends `BLOCKED`
  with the source-window recommendation as its handoff, never `READY`.
- A profile's `validationWorkflow.persistPolicy` overrides the question, and a
  user answer cannot weaken it. When the profile says `forbidden`, skip the
  question.
- Every run aiming for `READY` asks the separate `source-window` day-or-range
  confirmation question before any staging, after Silvally has compared recent
  complete UTC days read-only (`source_window.py recommend`). Options are the
  recommended window first, a longer contiguous complete range when
  `allowLongerRange` is true, and `stop` (the run ends `BLOCKED`). A staging
  approval does not answer it, and there is no default.
- The data is always the confirmed PROD-derived window; there is no dataset
  question and no local or synthetic option.
- The `canary-gate` question shows the canary's execution ids, S3 inputs and
  outputs, row counts and comparison, and waits. Never auto-proceed. When the
  canary comparison failed, do not ask it: report `NOT_READY` (or `BLOCKED`)
  and do not suggest the full run.
- Owner decisions stated up front in the request (`ownerDecisions`: full-run
  pre-approval for a passing canary, acceptance of Transform product changes
  as out of scope, a per-job cost ceiling, the most recent full UTC day with
  real data per slice, blanket approval of this run's DEV writes, staging real
  sensitive values to DEV) answer the matching question; do not ask it again.
- The canary gate is per slice: one slice's failed canary stops only that
  slice, and each slice gets its own window and verdict.
- The user's answers become `CONFIRMED` material facts. Silvally never marks a
  fact `CONFIRMED` from a default the user did not see.

## Operations that require a confirmation gate

Present one operation card and stop with `APPROVAL_REQUIRED` before **each** of
these. Approval of one card never covers another, a retry, or a changed card.
The only exception is the owner's `blanketDevWrites` decision, which approves
this run's DEV staging and execution cards; each approval still records the
card's own digest, and it never covers a PROD operation.

| Operation | Typical command | Environment |
| --- | --- | --- |
| staging copy of the canary or the full confirmed PROD-derived window | `stage_evidence_package.py upload` / `put-object` under `inputs/<language>-<purpose>/<window>_<version>/` | DEV |
| manifest publication | `put-object` of `manifest.json` with `IfNoneMatch: *` | DEV |
| DEV deployment of a pinned candidate | the owning repository's documented deploy command (for example `npm run cdk:deploy`) | DEV only; Deploy owns the result |
| Transform execution (canary, then full window) | `transform_runs.py start` (`aws stepfunctions start-execution` on the DEV Transform state machine); a full-stage start also needs an approved `--canary-gate` | DEV |
| cost-approval callback | `aws stepfunctions send-task-success` for a paused cost gate | DEV |
| Persist canary | the documented Persist ingest surface, bounded | DEV, only when `persistPolicy` is `required` |

Read-only work (materializing checkouts, running the resolver, reading CI
results, and reading S3, SSM, CloudWatch Logs or Iceberg) needs no card; it
never executes a mapping. PROD mutation has no card; it is
always refused and handed off.

## Operation card

Render the card verbatim, then compute
`operationDigest = sha256(canonical JSON of the card without operationDigest)`.

```json
{
  "operation": "start-transform-execution",
  "environment": "dev",
  "region": "<region>",
  "accountAlias": "<dev-profile>",
  "reads": [
    "s3://<dev-transform-data-bucket>/inputs/<package>/<window>_v1/<table>/ (manifest sha256:…)",
    "s3://<registry-bucket>/transform-mappings/<id>/<version>/mapping.json (sha256:…)"
  ],
  "writes": [
    "s3://<dev-transform-data-bucket>/runs/<executionId>/plan.json",
    "s3://<dev-transform-data-bucket>/outputs/silvally-<profile-or-mapping>/<runId>/<case>/<executionId>/"
  ],
  "runs": "states:StartExecution <state-machine-arn> name=<executionId>",
  "request": { "contractVersion": 2, "from": "<source>", "to": "<target>", "mappingVersion": "<x.y.z>", "outputDatasets": ["<dataset>"], "…": "…" },
  "costCeilingUsd": 5,
  "expectedEffect": "one Glue run; <dataset> in its registered format with _metadata.json",
  "containment": "new unique execution name and output prefix; nothing is overwritten; delete the output prefix to roll back",
  "evidenceIds": ["exec-<case>"],
  "operationDigest": "sha256:…"
}
```

Continue only after the user explicitly approves this `operationDigest`. Record
the approver, time, scope, and result in `approvals[]` and
`executionSteps[].approvalOperationDigest`.
