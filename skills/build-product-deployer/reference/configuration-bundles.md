# Configuration bundles

Use **configuration bundle** for a versioned set of configurations installed
through Transform, Connect and System APIs. Apply this contract when building,
packaging, reviewing, installing or authoring these bundles. Treat it as required
implementation scope; inspect target revisions before claiming deployed support.
Editing this kit does not implement or deploy the installer.

Use **configuration bundle** in product language and `CONFIGURATION` as the
bundle/component type alongside `SERVICE`. Use `/configuration` for Build's
type-specific start/status alias; retain `/builds` as the generic route.
Align Build, Marketplace and Deploy request/response schemas, manifests,
provenance, catalog metadata, callbacks and subscription records with this name.

Treat `DATA` and `/data` as legacy contracts to migrate, not compatibility values
for new bundles. Inspect the target revision before calling the new contract;
hand missing migration support to the relevant builder instead of falling back
to the legacy type. Migrate mutable metadata while preserving identities and
references. Keep historical evidence and immutable artifact bytes/digests intact;
rebuild and publish a new release when an old artifact needs the new type. Retire
legacy write inputs/routes with a clear migration error. Verify the full
Build → Marketplace → Deploy path before claiming the migration is complete.

## Ownership

| Product / agents | Responsibility |
| --- | --- |
| Deploy / Corviknight, Skarmory | Build, install and operate the shared provider with Deploy service infrastructure; own typed API adapters, run results and Puller integration |
| Build / Tinkaton, Metang | Produce and verify configuration assets and portable CDK assemblies with provenance |
| Marketplace / Regigigas, Registeel | Register, review and publish compatible bundles; verify review-environment prerequisites |
| Transform / Kecleon, Silvally | Own mapping API semantics and author/validate mapping configurations |
| Connect / Lapras, Wingull | Own flow, partner-configuration and activation API semantics and author/validate their configurations |
| System / Zygarde, Celebi | Own definition, template, flow and waterfall API semantics and compose their configurations |

Keep these assignments in the product catalog. Do not add a configuration product
or platform owner. Use a synthetic integration for installer acceptance; do not
add Model as a pilot. Preserve existing Model dependencies where a target product
actually requires them.

## Packaging and execution

1. Keep the supported CDK cloud assembly artifact. Include immutable configuration
   files and custom-resource declarations referencing an installed shared Deploy
   provider. Do not generate a Lambda or executable installer per bundle. SQL
   mapping text remains Transform configuration validated by Transform; reject
   arbitrary shell commands, lifecycle hooks and bundle-supplied adapter code.
2. Implement the provider in TypeScript/CDK under Deploy's engineering standards.
   Use a shared provider per target account/region and compatible provider contract.
   Allow separate Transform, Connect and System adapter functions for scoped IAM
   and maintenance. Keep their code and releases with Deploy, outside consuming
   bundle stacks. Version provider contracts and preserve compatibility with
   installed bundles; plan explicit migrations for breaking changes.
3. Package the provider as part of Deploy's service infrastructure and provision it
   through Deploy's normal installation/update lifecycle. Keep that infrastructure
   independent of the provider it installs. Have Deploy verify account/region,
   provider version, discovery and scoped target API access before accepting a
   dependent configuration installation. Install the same prerequisites in
   Marketplace review environments.
4. Have Build validate and hash configuration assets without calling target APIs.
   Have Deploy verify artifact and payload identity, publish staged assets and run
   the assembly through its authenticated run/status/result surface. Have
   CloudFormation invoke the provider; reuse the same execution machinery for all
   bundles. A direct provider invocation alone does not satisfy API acceptance.
5. Resolve service endpoints and credential references from the verified target
   environment. Authorize the caller, stack/component and configuration namespace.
   Allow only typed configuration operations for the three APIs, with scoped roles
   or credentials; do not accept arbitrary destination URLs or embedded credentials.
   Call supported APIs, never target databases, canonical S3 objects or SSM writes
   as an installation shortcut.

Map the following logical information onto verified artifact/resource schemas;
these are requirements, not a new wire schema or promised API fields:

- Bundle/component identity, immutable release and provider contract requirement.
- Per-configuration product, stable logical identity, owned or referenced status,
  version/revision, payload location and digest, and target parameter bindings.
- Dependencies and references to prerequisite configurations and compatible APIs.
- Supported activation, explicit reapplication and retirement policies.

Bind changed payload digests and relevant target parameters to custom-resource
properties so configuration changes trigger updates without changing service code.
Keep logical and physical resource identity stable across normal updates. Resolve
temporary artifact access without changing pinned content. Reject unsupported
schemas, missing dependencies, cycles and incompatible providers before API writes.
Detect conflicting ownership and concurrent changes through atomic API conditions
or durable claims; a preflight read alone does not prevent a race.

## Lifecycle and evidence

- **Validate:** validate all documents and dependency references first where APIs
  support side-effect-free checks. Keep registrations distinct from activation and
  business execution. Do not start Transform runs, Connect jobs or System invocations
  just because their configurations were installed.
- **Apply:** create or register the requested revision using each API's actual
  semantics. Use returned IDs/versions to resolve dependent configurations. Order
  by the declared dependency graph, not a hardcoded product sequence. Prepare
  inactive configurations and activate entrypoints last where supported; report
  missing staging/activation support explicitly rather than claiming atomic rollout.
- **Replay:** use stable operation identities scoped to target, component/resource,
  lifecycle intent, payload digest and relevant parameters. Repeated delivery of
  the same intent must return or reconcile its prior result. Fence stale completions
  against the current intent and read back actual state before reusing a receipt.
  Restoring a previously installed digest is a new intent, not a cached success
  from that release's original installation. Changed content must create a new immutable version
  or use a supported conditional update. Surface conflicts instead of overwriting
  another bundle's configuration. Make deliberate reapplication explicit under a
  supported contract; do not force every poll with a timestamp change.
- **Complete:** follow accepted asynchronous operations to terminal results and
  read back applied configuration identities/digests. Use bounded provider handlers
  and completion polling. Keep operations within the supported CloudFormation
  custom-resource timeout (at most one hour); surface longer work as a contract gap,
  never a successful install merely because a background task started.
- **Recover:** retain per-resource operation IDs, successful revisions and partial
  failures so a lost response or worker restart can reconcile before retrying.
  Keep configuration truth and revision semantics in the target products, durable
  operation receipts in the installer component, and subscriptions, desired/pending/
  installed bundle identity and history in Puller. Keep the run API free of subscriber
  state. Do not promise cross-API transactions or exactly-once effects without an
  enforceable target API contract.
- **Retire or restore:** delete/deactivate only owned configurations under their
  supported policy, preserving shared references and retained versions. Treat
  unsubscribe, stack deletion, selecting a previous Marketplace release and reversal
  of API effects as distinct operations. Define compensation or forward recovery for
  each adapter, including partially failed Create and rollback events. If reversal
  is unsupported, preserve evidence and report the unresolved state; never claim
  CloudFormation rollback reverted external configuration automatically.

Advance Puller's installed bundle identity only after the declared configuration
operations complete. Preserve the previous installed identity on failure while
also exposing partially applied new revisions; that identity alone does not mean
the environment was restored. Keep consumer readiness and business-flow validation
separate from installation completion. Log safe run/resource/operation IDs and
versions, not credentials, signed URLs or sensitive configuration payloads.

## Target API and authoring handoffs

Have Kecleon, Lapras and Zygarde verify validation, stable registration identity,
version/conflict semantics, read-back, authorization and any async status contract.
Implement missing primitives in their products. Have Corviknight adapt to those
contracts rather than implementing product logic or a second configuration store.

Use Silvally for mappings, Wingull for Connect documents and Celebi for System
composition. Pin references and preserve each agent's existing validation and
approval requirements. Hand source corrections to product/configuration owners,
Build defects to Tinkaton and publication to Registeel. Bundle installation and
synthetic installer tests do not replace Silvally's production-derived readiness
gates or authorize partner traffic or business executions.

## Synthetic acceptance

Materialize these recipes in target test suites using their actual schemas. Use
fake configuration APIs first, then the real test run API/provider with controlled
adapters. Keep user-run API and AWS observations inside each feature increment.

| Scenario | Required observation |
| --- | --- |
| Baseline | Install a fixture mapping, Connect flow/partner configuration and System flow referencing them; read back all applied identities and make zero business-run calls |
| Type migration | Build, publish and install with `CONFIGURATION` in requests, metadata and artifacts; migrate existing mutable metadata without identity/reference changes, preserve historical artifact hashes, and reject retired legacy writes/routes with migration guidance |
| Changed configuration | Change one document with unchanged provider/service code; verify changed asset digest, intended resource update and preserved unaffected configurations |
| Shared provider | Install two bundles using the same provider; verify no per-bundle Lambda and no ownership collision or cross-bundle mutation |
| Replay and conflict | Retry identical delivery and concurrent triggers; reconcile one owned outcome, reject changed immutable content and conflicting claims |
| Preflight failure | Tamper with payload bytes or vary provider/API compatibility, namespace, missing dependency and cycle; verify rejection before configuration writes |
| Partial failure and recovery | Succeed on one configuration, fail the next, lose a response and restart; expose partial effects, reconcile before retry, and keep Puller installed state truthful |
| Completion and activation | Simulate accepted/running/failed/timed-out operations; do not mark installed or activate dependent entrypoints early |
| Retirement and previous release | Preserve externally owned/shared configurations; verify supported deactivation/restore or report unsupported compensation without claiming rollback |

Use the baseline as an installer protocol fixture, not a claim of domain correctness
or a production-ready integration. Report local checks, synthesis, deployed mocked
execution, user observations and authorized live effects separately.
