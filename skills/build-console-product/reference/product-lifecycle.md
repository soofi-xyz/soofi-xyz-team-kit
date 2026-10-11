# Console project, review and component lifecycle

Use this contract with [component authoring](component-authoring.md) and the
[product contract](PRD.md). Implement these capabilities in the Console service;
Vivillon configures them through supported APIs. Treat named records and operations
below as required contracts, not claims of deployed schemas or routes. Publish
versioned schemas and API documentation in the implementation repository.

## Project configuration

Persist a tenant-scoped `ConsoleProject` with immutable configuration revisions.
Require project ID, schema version, revision/digest, owning tenant, display name,
repository connection ID, repository identity, default branch, Figma connection
references, allowed source paths, supported outputs and component conventions.
Record styling system, reusable component imports, token sources, asset/font
policy, component entrypoints and React props/event conventions where applicable.
Keep credentials in the owning connection service's secret store; authorize use
of each connection separately from access to the project. Treat revocation as a
connection-required job failure, never a reason to borrow another user's token.

Use named execution profiles for package manager/lockfile, pinned toolchain,
install/build/typecheck/design/behavior commands, working directories, preview
entry route and viewports. Configure command argument templates and allowed
network destinations administratively; jobs select profiles and validated
parameters, not arbitrary shell commands. For HTML allow a static preview profile
without a React build. Require dependency changes to appear in review evidence.

Define and enforce precedence:

1. Service/tenant policy sets ceilings and permissions that no project or job can
   widen: writable paths, tools, network, spend, retention bounds and connections.
2. A pinned project revision supplies defaults and narrows those policies.
3. A job may override only fields explicitly marked overridable in the schema,
   such as target nodes, selected output, viewports and change instructions.
   Reject forbidden overrides rather than silently dropping them.

Expose authenticated create/read/list, validate/update with expected revision,
archive and connection-status operations. Resolve each job to an immutable
configuration snapshot containing effective settings and provenance. Changes to
a project must not change running jobs. Archive prevents new submissions; apply
retention policy to existing work rather than deleting history immediately.

Example shape for the implementation schema (values are synthetic):

```yaml
schemaVersion: 1
projectId: customer-portal
repository:
  connectionId: repository-connection-1
  name: example/customer-portal
  defaultBranch: main
figmaConnectionId: figma-connection-1
outputs: [html, react]
allowedPaths: [src/components, src/styles, public/design-assets]
conventions:
  styling: css-modules
  componentImports: [src/components/shared]
executionProfileId: portal-design-checks
reviewPolicyId: component-review
operationsPolicyId: authoring-standard
```

Return validation issues and supported configuration choices through the API.
Keep example IDs visibly synthetic; Vivillon resolves real IDs before a user run.

## Authoring and review experience

Provide a user-facing authoring workspace backed by the same HTTP contracts as
external clients. Support project/connection selection, create versus edit,
HTML versus React, Figma links, base revision, target paths and instructions.
Display resolved configuration, required access and estimated/bounded work before
submission. Keep authentication and account membership with Account; enforce
Console permissions for project administration, authoring, reviewing, applying
changes and requesting promotion server-side.

Show durable job history and progress, connection/input requests, cancellation,
retry eligibility, structured failures and follow-up instructions. Require an
explicit reference to the parent job and source/artifact revision for follow-ups.
Produce a new candidate revision; do not mutate the accepted result or conflate
conversation history with component history. Reconnection and retries preserve
job identity/idempotency rules and explain which work will rerun.

Provide before/after previews at selected viewports, scoped source/dependency
and asset diffs, Figma provenance and separate visual, behavior, accessibility
and build results. Show unavailable checks as unavailable. Offer request-changes,
accept, export, open/update PR and request-promotion actions only when supported
and authorized. Keep terminal generation status separate from review/delivery
status: model success does not mean accepted, applied or deployed.

Persist a review decision against the exact candidate digest, base revision,
project revision, evidence digest, actor, timestamp and comment. Implement
`pending → accepted | changes_requested | rejected`; a new candidate or changed
base/evidence makes the old decision inapplicable to the new candidate. Define
required reviewer roles in the project policy. Never allow a model/tool result
to grant its own review authority. Disable application/promotion until configured
checks pass and a permitted reviewer accepts the exact candidate.

Host previews on an isolated origin with no Console authentication cookies or
service credentials. Enforce viewer authorization, restrictive sandbox/CSP and
short-lived asset access, with expiry and immediate revocation. Keep downloads
and job evidence tenant-scoped. Test isolation with controlled fixtures, including
an unauthorized viewer and attempted access from preview code to the control API.

## Component identity and history

Assign a stable tenant/project/component ID independently of file paths. Record
immutable candidate revisions with parent revision, source/base digest, Figma
provenance, output type, public interface schema, dependency lockfile digest,
asset manifest, toolchain/model/prompt versions and test/review evidence. Renaming
a file preserves component identity; forking explicitly creates a new identity.
List/read history and compare revisions through the API; do not rewrite history.

Package assets by digest with relative paths, media types, sizes and origin/license
metadata. Require permission for font/asset redistribution; report missing rights
as a packaging issue. Download transient Figma assets into the authorized artifact
store before links expire; do not ship localhost URLs, expiring design URLs or
secret-bearing URLs. Bound size and validate paths/media. Record font fallback
behavior and test the final packaged result, not just a network-connected preview.

Distinguish generated source candidates, reviewed source revisions and released
runtime components. Assign semantic release versions only to immutable released
interfaces; breaking prop/event/slot changes require an explicit compatibility
change and migration guidance. Record supported renderer versions and output
format. Pin dependencies; do not fetch arbitrary packages at application render.

## Export and repository application

Support two delivery destinations without requiring renderer adoption:

- **Export:** return authorized immutable source/archive/patch artifacts with
  checksums, base revision, dependency/assets manifest and reproducible commands.
  Allow unaccepted candidates to be exported only if policy permits, visibly
  labelled unreviewed; export never changes repository or deployment state.
- **Repository:** apply an accepted candidate to a scoped branch and create/update
  a PR through the verified repository connection. Preserve target-branch policy;
  do not merge automatically. Require expected base and candidate digests. Return
  operation ID, branch/commit/PR identity, status and typed conflict information.

Make repository writes idempotent by tenant/project/candidate/destination and
record a durable operation ledger before issuing side effects. Reconcile provider
results after timeouts before retrying so one request produces one logical PR.
Check the base immediately before application; on drift create a conflict result,
not a force overwrite. Resolve against the new base into a new candidate, rerun
affected checks and require a new review. Include unrelated-file preservation in
the diff acceptance test. Cancellation cannot undo an already completed commit;
report completed effects and remaining work accurately.

Provide source rollback as a new reviewed revert candidate/PR against the current
head. Preserve intervening changes and expose conflicts. Never reset shared branch
history. Runtime rollback instead selects a compatible previous immutable release
through Deploy and Console's active-selection API; keep the two operations distinct.

## Promotion into the governed renderer

Make renderer promotion optional and explicit. Exported HTML/React components
satisfy standalone authoring use cases. A generated file is not yet a registered
Console component and cannot be executed by adding source to application config.

For promotion, validate the reviewed component's interface, accessibility, allowed
dependencies, asset bundle, data/action bindings and renderer compatibility.
Implement a typed registry descriptor: component ID/version, props/events/slots
schema, output type, runtime compatibility and immutable artifact/provenance IDs.
React components enter the compiled registry through the build. For HTML, accept
only markup/styles/assets supported by a trusted renderer adapter with declared
slots/events; reject arbitrary script/event-handler injection. An unsupported
HTML feature remains export-only until the reusable adapter is deliberately built.

Submit reviewed source and descriptors to Build through its supported API. Verify
result provenance, source digest and test evidence, then hand catalog publication
to Marketplace and installation to Deploy through their APIs. Track separate
promotion states (`requested`, `building`, `built`, `publishing`, `published`,
`installing`, `installed`, `failed`) and downstream operation IDs. Reconcile retries
without duplicate releases; verify actual installed runtime digest and registry
entry before declaring a component selectable. Do not implement those products'
engines inside Console or invent unsupported artifact contracts.

A component addition changes the runtime and needs a runtime release. A layout,
theme or props change using an already installed compatible component changes only
the application manifest. Validate compatibility and atomically select the runtime/
configuration pair. On failure keep the prior pair active; rollback only to a pair
whose components and configuration remain compatible. Keep incompatible revisions
inspectable but unselectable. Never evaluate configuration-supplied JavaScript.

## Production operations

Persist versioned tenant policies for per-job time/token/tool/spend limits,
per-tenant running/queued job limits, queue wait deadline, preview TTL, artifact/
conversation/audit retention and storage limits. Require explicit values during
environment setup; do not ship unlimited production defaults. Use the tenant policy
as an upper bound on project configuration and snapshot it into each job.

Enforce concurrency through durable leases and bounded retries. Schedule fairly
across tenants; cap one tenant's queue and prevent starvation. Record reservations
and actual model, execution and storage usage by job/tenant, release unused
reservations on terminal outcomes, and reconcile interrupted work. Fail or pause
at the configured budget boundary with typed status; do not rely on model judgment
to enforce cost. Show estimates separately from measured cost and billing lag.

Expire previews and revoke their access automatically. Delete source snapshots,
assets, logs and memory according to each data class's policy, including explicit
project/connection deletion handling and applicable retention holds. Return a
deletion operation/status and verify actual cleanup. Keep minimal audit metadata
only under its declared retention policy; do not retain private source in traces.

Define measurable queue-delay, completion, availability and recovery objectives
for the selected environment. Provide dashboards/alerts for queue age, lease loss,
MCP/model failures, spend/quota rejection, failed cleanup and promotion failures.
Document owner, diagnostic steps and recovery actions. Exercise restore/replay of
job metadata and immutable artifacts; prove no duplicated writes or lost decisions.

## Cumulative acceptance

Require each capability's user/API/browser and AWS evidence in the iteration map.
Finish with these end-to-end cases, preserving separate evidence levels:

1. Configure two projects with different output/style/test profiles. Run the same
   request shape and prove pinned effective settings, permitted overrides and
   rejection of privilege-widening overrides and stale project updates.
2. Create and edit HTML and React, inspect before/after previews, request changes,
   accept a new candidate and verify old approval cannot authorize that candidate.
3. Export a standalone component with all assets and run it without Figma asset
   URLs. Apply an accepted change through a PR; repeat after a timeout, advance
   the base concurrently, and prove idempotency, conflict handling and safe revert.
4. Promote a compatible reviewed component through Build/Marketplace/Deploy, then
   use it in a manifest. Reject an unregistered or incompatible component. Change
   only props/theme without a runtime rebuild; roll back a compatible pair.
5. Exercise tenant/role denial, preview isolation/revocation/expiry, disconnected
   credentials, quota rejection, competing tenant queues, budget exhaustion,
   interrupted workers, retention cleanup and backup restoration.

Record project/policy revisions, candidate and evidence digests, reviewer identity,
source/export/PR IDs, downstream release IDs, active pair, measured usage, cleanup
and observed user results. A missing dependency leaves its acceptance pending;
local mocks never establish publication, installation or production readiness.
