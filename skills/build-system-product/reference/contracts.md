# System composition artifacts

Use contract version **2** for compositions. The checker rejects unsupported
versions rather than silently reinterpreting their ownership or execution mode.

A composition manifest declares `systemId`, outcome, products, configuration
references, workflow ownership, success criteria, dependencies and inactive deploy
posture. The runtime mode is `system-service`. Do not invent another Product
runtime or an alternative thin-package execution mode.

Use canonical product IDs and catalog-assigned roles. Keep Model or Deploy
`reference-only` when only their external artifacts/results are prerequisites,
rather than executable steps in this composition. Assigned agents do not prove
a deployed API or compatible System leaf contract. Route Model configuration to
Jirachi and Deploy runs to Skarmory only after verifying both. Registered Lexicon
language/mapping artifacts may be Transform configuration without invoking Model.
Do not assign Model/Deploy work to Persist.

Every workflow step names a declared product, a resolving configRef and the
assigned configurer for that product. Artifact ownership must agree with workflow
ownership. Prefer Celebi for System, Wingull for Connect, Silvally for Transform,
Uxie for Persist and Meditite for Rule. Keep builder work in the target product's
implementation plan, outside the configuration workflow.

Pin remote artifact references with a SHA-256 digest. Keep local references inside
the package. Declare every file in `emits/`. Never embed secrets, JDBC strings or
Spark SQL in the manifest; keep executable/configuration details in the owning
product's referenced artifacts.

Keep every runnable flow template-backed. The checker validates template names,
transitions, flow bindings, leaf contracts and references. It accepts System's API
payloads as they are: a definition, template or flow is named by its API path, so
set that name as the configRef `name`; a template keeps `StartAt` and `States` at
its top level; a flow names its `template` and `definition`. A kit `product-*`
artifact kind names a compatibility configuration shape, not a separate product.
Use `persist-ingest` rather than the removed historical collection API concept.

A `Batch` runs at most 4 items at once unless it sets `MaxConcurrency` (1 to
1000) or `MaxConcurrency.$` (a dotted path read when the batch starts); see
[batch concurrency](../../configure-system-product/reference/batch-concurrency.md).
For `MaxConcurrency.$` the compiler writes `$.steps.<Batch>.concurrency` at the
batch's name (4 when the value is missing or null), checks it there and fails
that state itself with `System.InvalidMaxConcurrency`, then runs
`<Batch>.System.Map` with `MaxConcurrencyPath`. Step Functions caps a state name
at 80 characters and a System step name is up to 64, so keep a new generated
suffix to 16 characters.

Compiled state machines contain no `Fail` state, so a redrive
(`POST /invocations/{id}/redrive`, Step Functions' `RedriveExecution`) resumes at
the step that failed; see
[failures and redrive](../../configure-system-product/reference/failures-and-redrive.md).
The compiler drops a `Catch` into a `Fail` state and the service reports the
`Fail` state's `Error` from the execution history's last entered state; it
refuses a template that reaches a `Fail` state any other way. `FailWhen` steps
compile to JSONata states whose `Output` raises `$error("[System.Fail <ERROR>]
<cause>")`; the service reads the last marker in the cause. Every `Batch` is a
Distributed Map with STANDARD children, never an inline Map, and an
`OUTPUTS_JSONL` batch is followed by `<Batch>.System.Results`, a built-in Lambda
that merges every attempt's succeeded files into
`merged/<Step>/<map run>/SUCCEEDED.jsonl` for `succeededResultsUri`. The API role
needs `states:RedriveExecution` and `states:GetExecutionHistory` on template
executions, and the workflow role `states:RedriveExecution` for Map Run
children.

Every invocation record carries `source`: `{"type": "api"}` or, for a flow
started by an [S3 trigger](s3-triggers.md), `{"type": "s3", "triggerId",
"triggerRevision", "bucket", "key", "versionId", "sequencer", "eventTime"}`. A
configuration bundle may contain `s3-trigger` documents pinned to their flow.

Run:

```bash
python3 scripts/check-system-manifest.py path/to/system.manifest.json
python3 scripts/test-build-system-product-contract.py
```

Schema checks do not invoke System. Mark unperformed runtime criteria deferred;
complete mock acceptance separately with actual responses and trace evidence.
