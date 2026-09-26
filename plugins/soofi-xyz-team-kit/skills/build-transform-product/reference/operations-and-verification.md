# Transform operations and verification

Use [PRD.md](PRD.md) as the product contract. Discover the target checkout,
deployment and supported request versions before operating a service. Keep
project-specific observations in the task's evidence, outside this reusable spec.

For a new product, execute [from-scratch.md](from-scratch.md) and preserve its
acceptance evidence. Use [aws-workflow.md](aws-workflow.md) for the required
state transitions, permissions, pricing model, deployment and recovery commands.

## 1. Discover and prepare

1. Confirm repository/revision, instructions, request schemas, stack, active job
   script and requested outcome. Verify deployed support for the planned request.
2. For AWS work, reuse the verified selected profile, represented in examples
   as `AWS_PROFILE=<selected-profile>`. Check account/environment/region explicitly.
   Discover state-machine, catalog, bucket and queue pointers from actual outputs.
3. Resolve the current enabled source/target registrations and the single
   directional SQL mapping. Validate named input bindings against the language
   definitions and the mapping's format/shape/profile compatibility.
4. For graph mappings, inspect `graph` blocks and the actual SQL ID/endpoint
   expressions. Follow [graph-mappings.md](graph-mappings.md), including exact
   endpoint matches and complete-export vertex membership.
5. Pin definition/SQL/configuration digests and source artifacts into an execution
   plan. Verify S3/KMS access and output scope. Submit with a fresh execution name
   and run prefix only within the existing authorization.

Publish compatible language/mapping configuration through Lexicon and verify the
published artifacts before execution. Change the engine only when capabilities
or contracts require it. Deploy code/infrastructure through the target's CDK/CI
flow. A local SQL edit is not a published configuration release.

## 2. Admission, execution and recovery

Size exactly the selected objects across Parquet, JSONL, CSV and Excel. Model compressed
bytes versus processing expansion and query complexity when calibrating costs.
Preserve the effective ceiling and estimation assumptions. Validate configuration
before a possible approval wait, then execute the pinned plan without refreshing
moving aliases. Validate approval decisions; do not raise ceilings to bypass them.
Keep task tokens and source records out of reports.

Track resolution, source/schema validation, admission, approval, SQL, graph
reference validation, writing and reporting as distinct phases. Preserve failed
dataset/query identities and sanitized diagnostics. A parser option or successful
Spark action alone does not prove schema or graph conformance.

Keep partial paths and failed-plan evidence. Inspect successful outputs or loads
before retrying; use fresh prefixes for full replay. Recover reporting separately
when data is already valid, without double-emitting counters. Retain deterministic
graph IDs and pinned input/reference snapshots across replay.

## 3. Compatibility and deployment

Inventory actual callers and resource identities before changing an existing
service. Version requests, plans, metadata and configuration explicitly. Reject
unsupported versions before workflow states can discard fields. Add compatibility
adapters only for discovered requirements; never fall back to a default pair
when `from`, `to` or a mapping cannot be resolved.

Publish required catalog/definition versions before activating their consumers.
Verify the deployed script and state-machine definition after activation. Retain
compatible configuration/deployment revisions for rollback; keep stateful data
and prior run evidence intact.

## 4. Implementation checks

Implement the command interface in the from-scratch guide for a new product.
For an existing service, use its declared setup, typecheck, lint, test and CDK
synthesis commands. Keep TypeScript tests for resolution/contracts/workflow
wiring and real Spark fixtures for SQL/readers/writers/graph validation. Select a Spark runtime
compatible with the configured Glue version. Do not assume unit tests execute
Spark or that any specific toolchain version is already installed.

For changes confined to this plugin, run plugin validation and label document or
agent checks accurately; do not report runtime integration tests as completed.

## 5. Acceptance matrix

Use bounded fixtures for independently registered source/target languages. Assert
decoded values/schema and graph identities, not only generated object paths.

| Scenario | Required proof |
| --- | --- |
| Sixteen format combinations | Every Parquet/JSONL/CSV/Excel input converts to each output encoding through its own mapping |
| Mixed-format joins | CSV, JSONL/Parquet and Excel-sheet tables can feed one registered SQL mapping |
| Excel sheets | Each sheet binds to one dataset; a missing sheet or an over-ceiling dataset fails before success |
| Multiple outputs | Preserve separate target datasets and types; combine only declared same-table fragments |
| Tabular output | No invented graph fields, IDs, labels or graph-store dependency |
| Schema fidelity | Preserve null/empty strings, numeric precision, dates, Unicode and allowed nested types |
| CSV/JSONL | Verify quoting/null/header semantics, malformed-input errors and serialization compatibility |
| Exact direction | Reverse conversion needs its own mapping; missing/disabled/ambiguous pairs fail before Glue |
| Configurability | A new compatible registered language pair runs without Python changes |
| Vertex IDs | Validate canonical `~id` aliases and explicit `idColumn` bindings; detect missing/duplicate IDs |
| Edge endpoints | Validate `~from`/`~to` or bound aliases against the referenced vertex IDs, including prefixes and case |
| Graph properties | Check labels, typed property bindings, reserved-header collisions and repeatable edge IDs |
| Graph profile | Only the explicit profile applies Neptune headers/layout; ordinary CSV remains ordinary CSV |
| Replay | Alias changes do not alter pinned plans; partial writes cannot publish success |
| Compatibility | Legacy callers are served through the explicit `contractVersion` adapter; a request carrying versions, mapping IDs, formats or options is rejected, never silently downgraded |

## 6. Completion evidence

Return concrete language/mapping versions and definition digests, input identity and
formats, graph role/reference bindings when relevant, output shape/profile/format,
per-dataset paths/counts, validation outcomes, workflow/Glue IDs and deployment
revision. Distinguish requirements, code, local fixtures and live evidence.
Tabular delivery completes at its validated output contract; verify any requested
Persist load independently.
