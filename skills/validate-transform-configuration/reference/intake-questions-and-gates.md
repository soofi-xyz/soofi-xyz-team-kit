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
| `environment` | no `in dev`/`in prod` hint | `dev`, `prod-read-only`, `synthetic-local` | `dev` |
| `mapping-version` | more than one enabled version, no version hint, and the version was not defaulted by `latest-published-semver` (its `notice` is shown instead) | each `id@version` with its outputs | the resolver's selection |
| `upstream-source` | `UpstreamSourceUnresolved` | candidate producers, `existing-graph-export` | the selected profile's first workflow step when it is a candidate, else none |
| `test-dataset` | always | profile evidence (including `planned` placeholders), then `prod-derived-full-utc-day`, `sanitized-edge-cases`, `synthetic-fixture` | first `ready` profile evidence, else the full UTC day |
| `direction-mode` | an inverse mapping exists and no mode hint | `round-trip`, `one-way` | `round-trip` for `X -> <hub>`; `one-way` for `<hub> -> Y` |
| `cross-source-step` | a `<hub> -> Y` mapping consumes forward outputs | each downstream mapping, `none` | none |
| `persist-policy` | always, unless the profile fixes it | `forbidden`, `required` | `forbidden` |
| `source-window` | always before the final PROD-derived validation, after the read-only candidate comparison | recommended window, longer complete range (when allowed), `stop` | none; the user must choose |

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
  `allowLongerRange` is true, and `stop` (the run ends `BLOCKED`). Neither
  `test-dataset`, `environment: synthetic-local` nor a staging approval
  answers it, and there is no default.
- Choosing `synthetic-local`, `synthetic-fixture` or `sanitized-edge-cases`
  selects an earlier phase only. Say so when asking, and continue to the
  final PROD-derived validation afterwards.
- The user's answers become `CONFIRMED` material facts. Silvally never marks a
  fact `CONFIRMED` from a default the user did not see.

## Operations that require a confirmation gate

Present one operation card and stop with `APPROVAL_REQUIRED` before **each** of
these. Approval of one card never covers another, a retry, or a changed card.

| Operation | Typical command | Environment |
| --- | --- | --- |
| staging copy of a sanitized package (including the confirmed PROD-derived window) | `stage_evidence_package.py upload` / `put-object` under `inputs/<language>-<purpose>/<window>_<version>/` | DEV |
| manifest publication | `put-object` of `manifest.json` with `IfNoneMatch: *` | DEV |
| DEV deployment of a pinned candidate | the owning repository's documented deploy command (for example `npm run cdk:deploy`) | DEV only; Deploy owns the result |
| Transform execution | `aws stepfunctions start-execution` on the DEV Transform state machine | DEV |
| cost-approval callback | `aws stepfunctions send-task-success` for a paused cost gate | DEV |
| Persist canary | the documented Persist ingest surface, bounded | DEV, only when `persistPolicy` is `required` |

Local work (materializing checkouts, `cdk synth`, Spark tests, running the
resolver, and reading S3 or SSM) needs no card. PROD mutation has no card; it is
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
