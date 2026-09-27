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
| `mapping-version` | more than one enabled version and no version hint | each `id@version` with its outputs | the resolver's selection |
| `upstream-source` | `UpstreamSourceUnresolved` | candidate producers, `existing-graph-export` | none |
| `test-dataset` | always | profile evidence, then `prod-derived-full-utc-day`, `sanitized-edge-cases`, `synthetic-fixture` | first ready profile evidence, else the full UTC day |
| `direction-mode` | an inverse mapping exists and no mode hint | `round-trip`, `one-way` | `round-trip` for `X -> lexicon`; `one-way` for `lexicon -> Y` |
| `cross-source-step` | a `lexicon -> Y` mapping consumes forward outputs | each downstream mapping, `none` | none |
| `persist-policy` | always, unless the profile fixes it | `forbidden`, `required` | `forbidden` |

Rules:

- `prod-read-only` limits the run to metadata and existing sanitized evidence.
  It can never select staging, deployment, or execution.
- A profile's `validationWorkflow.persistPolicy` overrides the question, and a
  user answer cannot weaken it. When the profile says `forbidden`, skip the
  question.
- A `sourceWindowPolicy` adds the separate day-or-range confirmation question
  before any staging. Neither `test-dataset` nor a staging approval answers it.
- The user's answers become `CONFIRMED` material facts. Silvally never marks a
  fact `CONFIRMED` from a default the user did not see.

## Operations that require a confirmation gate

Present one operation card and stop with `APPROVAL_REQUIRED` before **each** of
these. Approval of one card never covers another, a retry, or a changed card.

| Operation | Typical command | Environment |
| --- | --- | --- |
| staging copy of a sanitized package | `aws s3 cp` / `put-object` under `inputs/<language>-<purpose>/<window>_<version>/` | DEV |
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
  "region": "us-east-2",
  "accountAlias": "socdev",
  "reads": [
    "s3://<dev-transform-data-bucket>/inputs/decision-prod-derived/2026-09-26T000000Z_2026-09-27T000000Z_v1/derived/ (6 tables, ≈268 KiB, manifest sha256:…)",
    "s3://<lexicon-bucket>/transform-mappings/decision-to-lexicon/1.0.0/mapping.json (sha256:…)"
  ],
  "writes": [
    "s3://<dev-transform-data-bucket>/runs/<executionId>/plan.json",
    "s3://<dev-transform-data-bucket>/outputs/silvally/<runId>/<executionId>/"
  ],
  "runs": "states:StartExecution <state-machine-arn> name=<executionId>",
  "request": { "contractVersion": 2, "from": "decision", "to": "lexicon", "mappingVersion": "1.0.0", "…": "…" },
  "costCeilingUsd": 5,
  "expectedEffect": "one Glue run; 4 output datasets and _metadata.json",
  "containment": "new unique execution name and output prefix; nothing is overwritten; delete the output prefix to roll back",
  "evidenceIds": ["exec-forward-decision"],
  "operationDigest": "sha256:…"
}
```

Continue only after the user explicitly approves this `operationDigest`. Record
the approver, time, scope, and result in `approvals[]` and
`executionSteps[].approvalOperationDigest`.
