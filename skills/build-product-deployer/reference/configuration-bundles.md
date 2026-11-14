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

Every configuration write an installer sends carries Deploy provenance; follow
[configuration provenance: repo-linked Deploy installs](../../guide-product-work/reference/configuration-provenance.md).

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
| Console / Chandelure, Vivillon | Own application, revision and publication API semantics and author application manifests (bundle kind pending; see [Console application payloads](#console-application-payloads)) |
| Access / Aegislash, Doublade | Own application API semantics and author application documents (bundle kind pending; see [Access application payloads](#access-application-payloads)) |
| Inference / Beheeyem, Elgyem | Own configuration API and version semantics and author `inference-1` configurations (see [Inference configuration payloads](#inference-configuration-payloads)) |
| Enact / Zoroark, Zorua | Own agent API and version semantics and author agent directories (see [Enact agent payloads](#enact-agent-payloads)) |
| Rule / Gallade, Meditite | Own selection, candidate-scope and projection configuration semantics (no bundle kind until Rule has an API; see [Products without a bundle kind](#products-without-a-bundle-kind)) |

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

## Transform mapping payloads

A Transform mapping configuration's `source` folder holds `mapping.json` and the
files it pins. Select the payload by the rule's `engine` (absent means
`spark-sql`) and never infer it from which files happen to exist:

| `engine` | Pinned files | Request body |
| --- | --- | --- |
| `spark-sql` | Every `outputs[].queries[]` `{ path, sha256 }` under `queries/` | `{ rule, queries: { "<path>": "<SQL text>" } }` |
| `javascript` | `module` `{ path: "mapping.js", sha256 }`; no `outputs` or `queries` | `{ rule, module: { "mapping.js": "<source>" } }` |

- Verify every pinned file's sha256 against the bundle bytes before any write, and
  reject a pinned file that is missing, a `javascript` rule with `queries` or a
  `spark-sql` rule with `module`, and an unknown `engine`.
- Reject a file in a `javascript` mapping's folder that nothing pins. Keep
  `spark-sql` folders as before: files the rule does not reference (such as a
  README) are left behind, not sent, because installed bundles rely on it.
- Treat the `javascript` rule's `output` (`graph`/`graphson` or `json`/`json`)
  and `inputs` as Transform semantics: pass them through unchanged and let
  Transform validate them.
- Call `POST /transform/mappings/validate`, then
  `PUT /transform/mappings/{mapping_id}/versions/{version}` with the same body:
  `201` created, `200` identical content, `409` changed content under an existing
  version (a failure: the bundle must publish a new version).
- Read the version back and compare `engine` and the pinned digests (`mapping.js`
  or every query) before reporting it applied. Report `version` in run results
  for both engines.
- Registering a `javascript` mapping does not enable transactions or pin
  `activeVersions`; those are Transform installation settings, not bundle
  configuration. Do not write SSM or Transform's buckets to set them.

## Console application payloads

Target contract: Build's `CONFIGURATION_KINDS` and Deploy's adapters do not yet
include `console`. Console's API already has every primitive the adapter needs, on
`https://<shared domain>/console` with the shared `x-api-key` (scopes
`console:configure` and `console:publish`); do not ask Chandelure for new ones.
Paths below are relative to `/console`.

- **Bundle entry:** `product: "console"`, `kind: "application"`, `source` a
  `ConsoleApplicationManifest` JSON file (`schemaVersion: "1.0"`). The manifest's
  `applicationId` is the logical identity; Build rejects a manifest whose
  `applicationId` repeats in the bundle, and validates it against the manifest
  schema in `prismteam-ai/console` `requirements/swagger.yml` without calling Console.
- **Account:** read `accountId` from `GET /session`; never take it from the
  bundle or a parameter.
- **Apply:** `GET /accounts/{accountId}/applications/{applicationId}`; on `404`,
  `POST /accounts/{accountId}/applications` with `{ applicationId, title }`. Then
  `POST …/{applicationId}/revisions` with the manifest and an `Idempotency-Key`
  derived from the manifest digest, so a replay returns the same immutable revision.
- **Activate:** `GET …/{applicationId}/active`. Skip publishing when its
  `manifestDigest` already equals the revision's. Otherwise
  `POST …/revisions/{revisionId}/publish` with `If-Match` set to the active ETag, or
  `*` for the first publication; treat `412` as a concurrent change to surface, not
  retry blindly.
- **Read back:** require `/active` to show the revision's `revisionId` and
  `manifestDigest`; report both in the run result.
- **Retire or restore:** use `POST …/rollback` only for an explicit restore intent.
  Console has no application delete; report retirement as unsupported rather than
  claiming removal.

## Access application payloads

Target contract: Build's `CONFIGURATION_KINDS` and Deploy's adapters do not yet
include `access`, and Access's application API is requested build scope.
Aegislash ships the API below first; then Tinkaton adds the kind and Corviknight
the adapter, following the deployed API where it differs. Paths are relative to
`https://<shared domain>/access`, with the shared `x-api-key`.

- **Bundle entry:** `product: "access"`, `kind: "application"`, `source` an
  application JSON document. Its `name` is the logical identity; Build rejects a
  repeated `name` and validates the document against the application schema in
  the Access repository's `requirements/swagger.yml` without calling Access.
- **Document:** the application's name, title, exact redirect addresses and
  exact sign-out addresses. An application is a set of addresses on the
  environment's one sign-in client, not a separate client or audience. Every address is `https` with no wildcard. The
  document carries no client secret, token, user, role or grant; Build rejects
  one that does.
- **Apply:** `GET /applications/{name}`, then `PUT /applications/{name}` with
  the document: created, replaced, or unchanged for identical content. An
  invalid document fails the install before any write.
- **Read back:** `GET /applications/{name}` must return the bundle's addresses
  exactly; report `name` and the document digest in the run result.
- **Retire:** `DELETE /applications/{name}` when a release drops an application
  that this component owns. Its addresses stop working for sign-in at once, so
  report it as an explicit effect and never remove an application another
  component or a direct registration claims. Removal signs nobody out: the
  sign-in session is shared by every application in the environment.
- Installing an application signs nobody in and changes no user, role or grant.
  Roles, users, grants and the Google sign-in client are set through the Access
  API by Doublade, never from a bundle.

## Inference configuration payloads

Build (`CONFIGURATION_KINDS`) and Deploy's adapters support product `inference`, kind
`configuration`; there is no `inference` kind. See
[the Inference status table](../../guide-product-work/reference/iterations/inference.md#status)
for where they are installed. Paths below are relative to
`https://<shared domain>/inference`, with the shared `x-api-key`.

- **Bundle entry:** `product: "inference"`, `kind: "configuration"`, `source` an `inference-1` JSON
  file. Its `name` is the logical identity and its `version` (semver) the immutable
  revision; Build rejects a repeated `name` and validates the document against
  `schemas/inference-configuration.schema.json` without calling Inference.
- **Apply:** `GET /configurations/{name}?version=<version>`, then
  `PUT /configurations/{name}`: `201 CREATED`, `200 UPDATED` (new version or rollback to a
  saved one), `200 UNCHANGED`; `400` invalid and `409 VERSION_CONFLICT` (changed content
  under a saved version: the bundle must publish a new version) fail the install.
- **Read back:** `GET /configurations/{name}` must return the bundle's version with
  byte-identical canonical content; report `name` and `version` in the run result.
- **Retire or restore:** Inference has no delete; restoring an earlier release saves its
  version again, which makes it current. Report retirement as unsupported.
- Installing a configuration starts no run and calls no model.

## Enact agent payloads

Product `enact`, kind `agent`: Deploy's adapter (prismteam-ai/deploy#85) and Build's kind
(prismteam-ai/build#57) are merged. See
[the Enact status table](../../guide-product-work/reference/iterations/enact.md#status) for where
they are merged and installed. The contract is `docs/agent-contract.md` in prismteam-ai/enact.
Paths below are relative to `https://<shared domain>/enact`, with the shared `x-api-key`.

- **Bundle entry:** `product: "enact"`, `kind: "agent"`, `source` one JSON file holding the whole
  agent document `{ "manifest": …, "files": … }`, the exact `PUT /agents/{name}` body.
  `manifest.name` is the logical identity and `manifest.version` (semver) the immutable version.
  Build validates the document against Enact's `schemas/agent-definition.schema.json` and the
  contract's other rules without calling Enact, rejects a repeated name and any
  `{{parameter:…}}` or `{{secret:…}}` placeholder, including one written with JSON escapes
  (a version has one digest in every environment), and records `name`, `version` and `digest`: `sha256:` and the SHA-256 of the
  document's canonical JSON, keys sorted at every level. Whether the agent's repositories are
  allowed in an environment is Enact's check on save.
- **Preflight:** Deploy fails the install before any write unless the document's
  `manifest.name`, `manifest.version` and canonical digest equal the entry's `name`, `version`
  and `digest`.
- **Apply:** `GET /agents/{name}?version=<version>`: that version saved with another digest is a
  conflict before any write. Then `PUT /agents/{name}`: `201 CREATED`, `200 UPDATED` (a new
  version, or a saved one made current again), `200 UNCHANGED` (writes nothing). `400
  INVALID_DEFINITION` and `409 VERSION_CONFLICT` (changed content under a saved version: the
  bundle must publish a new version) fail the install; `409 CONCURRENT_CHANGE` wrote nothing and
  is retried a bounded number of times.
- **Read back:** `GET /agents/{name}` must return the bundle's version as `current`, with the
  same `digest` and a byte-identical canonical document; report `name`, `version` and `digest` in
  the run result.
- **Retire or restore:** Enact has no agent delete; restoring an earlier release saves its version
  again, which makes it current. Report retirement as unsupported.
- Installing an agent starts no run and calls no model. Never write Enact's DynamoDB or S3 stores.

## Products without a bundle kind

- **Rule:** the existing service has no shared-domain HTTP API, so there is
  nothing for an adapter to call. Gallade first ships a `/rule` API with stable
  configuration identity, validation, versioned registration and read-back. Only
  then do Tinkaton add a `rule` kind and Corviknight a Rule adapter, following
  that API's contract. Do not install Rule configuration through Step Functions,
  S3 or SSM.
- **Documentation:** not a configuration bundle. A product's own repository
  carries its documentation: Build packs `requirements/swagger.yml` and
  `requirements/mcp.json`, and Marketplace sends them to `POST /publications`. Unown
  extends that same path to overviews, media, guides and navigation, with Tinkaton
  packing and Regigigas forwarding the new files. Do not add a `documentation` kind.

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

Deliver every configuration in this order, through product APIs on the shared
domain with the shared `x-api-key` and no AWS credentials:

1. **Bundle PR (configurer):** change the repository created from
   `prismteam-ai/configuration-bundle-template`; its CI validates the bundle and
   publishes it to Marketplace when the PR merges.
2. **Publish (Registeel):** confirm the Marketplace publish and that the bundle
   is `VALID`; Puller installs only the newest `VALID` bundle.
3. **Subscribe (Skarmory):** create or update the Deploy Puller subscription
   with `POST /deploy/puller/subscriptions` (or `PATCH` an existing one) and
   `update_policy: AUTO`, then read the install back with
   `GET /deploy/puller/installs/{product_id}/{component_id}`.
4. **Verify (configurer):** read the installed configuration back through the
   product API and compare it with the bundle.
5. **Clean up (configurer):** remove direct test registrations that are not in
   the bundle through the product API.

Before merging, check what the install will replace:

- Deploy writes each document by name (System, Report and Schedule `PUT`, and
  Connect partner configurations and activations `PUT`), so it overwrites a
  same-named direct registration that no other component claims.
- A Transform mapping whose content changed needs a new version; reusing a
  registered version returns `409` and fails the install.
- A committed activation with `"enabled": false` disables the live activation
  of the same name.
- An Inference configuration becomes the current version for runs, including over
  one a configurer saved directly.
- An Enact agent version becomes current for runs, including over one saved directly; a
  version already saved with other content fails the install until the bundle publishes a new
  version.
- A Console application publishes over the active revision of the same
  `applicationId`, including one a configurer published directly.
- An Access application replaces the same-named application's redirect and
  sign-out addresses, including one a configurer registered directly; an address
  dropped from the document stops working for sign-in at once.

## Synthetic acceptance

Materialize these recipes in target test suites using their actual schemas. Use
fake configuration APIs first, then the real test run API/provider with controlled
adapters. Keep user-run API and AWS observations inside each feature increment.

| Scenario | Required observation |
| --- | --- |
| Baseline | Install a fixture mapping, Connect flow/partner configuration and System flow referencing them; read back all applied identities and make zero business-run calls |
| Mapping engines | Install a bundle with a `spark-sql` and a `javascript` mapping; read back each version's `engine` and digests; reject a `javascript` mapping whose `mapping.js` bytes differ from `module.sha256`, an unpinned file in a `javascript` folder and a mixed `module`/`queries` rule before any write |
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
