# Console product contract

## 1. Purpose

Console creates and modifies HTML, email HTML or React components from Figma via MCP, using
Amazon Bedrock AgentCore Runtime and the pi coding harness. Read the required
[component authoring contract](component-authoring.md) for inputs, HTTP jobs,
architecture, artifacts and acceptance. Console also provides the reusable Prism web runtime. It turns a governed, versioned
application manifest into an authenticated UI made from supported components and
typed product API bindings. One runtime must render materially different
applications without application-specific forks.

Console Configuration is not a second product. It is an immutable application
artifact operated through Console by Vivillon. Chandelure owns the reusable
runtime and configuration service.

Begin a full build with the [Figma client registration checkpoint](component-authoring.md#first-step-register-and-verify-the-console-figma-client).
Require approved Console client access and a verified OAuth/MCP read before
downstream authoring implementation.

Read [project configuration and component lifecycle](product-lifecycle.md) as a
required part of this contract. Support standalone component export and optional
reviewed promotion into the governed renderer.

## 2. Ownership

Console owns:

- Figma MCP intake, HTML/React generation and scoped existing-component edits;
- the AgentCore/pi authoring runtime, HTTP job API, previews and test evidence;
- versioned projects, effective execution policy and user authoring/review flows;
- component history, packaged assets, export and reviewed repository application;
- registry promotion coordination, tenant quotas, retention and operations;

- the `ConsoleApplicationManifest` schema and compatibility policy;
- the renderer shell and accessible component registry;
- route, layout, navigation, theme and presentation behavior;
- typed data/action binding validation and runtime adapters;
- route, component and action authorization enforcement;
- immutable configuration revisions, active selection, refresh and rollback;
- browser/runtime telemetry and explicit loading, empty and error states.

Console does not own:

- identity, credentials or authorization claims, which belong to Account;
- vocabulary, model composition, top-vertex semantics or view meaning, which
  belong to Model;
- facts, graph storage or query execution, which belong to Persist;
- workflow orchestration, which belongs to System;
- report queries, refreshes and dataset computation, which belong to Report;
- source builds, catalog publication or installation, which belong to Build,
  Marketplace and Deploy respectively.

Console must call owning products through supported public APIs. It must not read
their databases or write Model/Persist data directly. A declared mutation is a
typed action against an owning product's public API.

## 3. Inputs and outputs

### Inputs

- Account-issued caller identity, account and scopes.
- A `ConsoleApplicationManifest` containing:
  - schema version, application identity and runtime compatibility;
  - routes, navigation, pages and layouts;
  - registered component instances and presentation options;
  - typed product data bindings and actions;
  - access policies and refresh behavior;
  - theme tokens and accessible base/extension graph styles.
- Pinned or controlled-current upstream product references.
- Model-owned view definitions and resolved effective-model metadata.
- Data and action results returned by public product APIs.
- Report dataset files published under Report's `report-output-1` reader
  contract (`docs/outputs.md` in `prismteam-ai/report`).

Configuration must be declarative. Inline JavaScript, remote executable code,
credentials, unrestricted URLs and unregistered components/adapters are invalid.

### Outputs

- Rendered authenticated web applications.
- Immutable runtime artifacts with Build provenance.
- Immutable application configuration artifacts with content digests.
- A deployment selection that identifies compatible runtime and configuration
  versions atomically.
- Correlated configuration, authorization, upstream-call and browser telemetry.

## 4. Required product surface

For authoring, expose authenticated asynchronous submission, status, cancellation
and result retrieval as defined in [component authoring](component-authoring.md).
Keep generated source separate from declarative configuration. Also expose the
project, connection-status, candidate/history, review, export/application, promotion,
usage and deletion operations defined in [the lifecycle contract](product-lifecycle.md).
Include submission/status/results for every asynchronous operation, tenant and
role authorization, idempotency and expected-revision checks.

The implemented Console configuration contract must expose authenticated operations to:

1. discover supported schema, components, adapters and runtime versions;
2. create/read tenant-scoped application identities;
3. submit and validate an idempotent configuration revision;
4. read validation issues and compatibility results;
5. publish an immutable valid revision with optimistic concurrency protection;
6. select/read the active compatible runtime/configuration pair;
7. roll back to a prior published configuration;
8. read application/runtime health without exposing secrets.

Exact deployed routes are authoritative only when present in the target
revision's OpenAPI contract. Submission, publication and rollback must return
stable request/revision identities and correlation IDs.

Recommended scopes are `console:read`, `console:configure` and
`console:publish`. Product actions additionally require the owning product's
authorization. Hiding a route or component is not an authorization control.

## 5. Runtime architecture

Host component authoring in AgentCore Runtime with pi as specified in the
[authoring architecture](component-authoring.md). The following surfaces describe
the governed renderer/configuration path, not the coding agent.

Use these logical surfaces unless the target repository has a verified stronger
pattern:

- a static React renderer hosted behind HTTPS through CloudFront;
- immutable runtime assets addressed by version and digest;
- an API Gateway/Lambda configuration and adapter API;
- DynamoDB application/revision/idempotency metadata;
- immutable S3 configuration artifacts;
- an atomic active-selection record;
- structured logs, metrics and traces carrying account, application, revision
  and correlation identities without sensitive payloads.

Keep runtime and configuration releases independent. Publishing a configuration
must not rebuild the renderer. Refresh may use ETag polling, invalidation or a
verified equivalent, but clients must switch only to a complete compatible
revision and retain a rollback path.

## 6. Component and binding contract

The MVP component registry must include:

- application navigation and route layout;
- catalog, table, filters and pagination;
- detail panel and key/value facts;
- review panel;
- state timeline and status badges;
- network graph with relationship detail;
- loading, empty, unsupported, unauthorized and upstream-error states.

### Report visualization components

The registry must also include generic, configuration-driven report components.
Derive the set from the visuals existing reports use, not from one report:

- `reportHeader`: title, subtitle, summary, static metadata and the dataset's
  generated-at time and window;
- `callout`: tone, title, body and items, optionally from a dataset column;
- `kpiGrid`: cards with a measure, format, note, tone thresholds and an optional
  comparison (difference, percent change or value) with good/bad direction;
- `factList`: labelled measures;
- `dataTable`: formatted columns, alignment, search, sorting, pagination, group
  and totals rows, status badges, in-cell meters and CSV export of visible rows;
- `barList`: ranked or progress bars with limit, order and tone thresholds;
- `chart`: bar, line or area; vertical or horizontal; grouped, stacked or 100%
  stacked series; legend and value labels;
- `funnel`: stages from rows or from columns of one row, with conversion rates;
- `heatmap`: row, column and value mapping with an intensity scale.

Components map dataset columns declaratively: column references, row filters,
aggregates (`first`, `sum`, `avg`, `min`, `max`, `count`), value formats
(number, integer, currency, percent, ratio, duration, date, datetime), tone
rules and a full-width span. Charts render as accessible SVG without
configuration-supplied code. A mapped column missing from the dataset renders an
explicit unsupported-mapping state; inline preview data is validated at
submission. Page-wide filters, tabs, scatter and waterfall charts are later
increments.

### Report dataset binding

Register a `report` product adapter with a read operation `read-dataset`
(`reportId`, `datasetId`; required scope `report:read`). It reads
`outputs/<report>/latest/manifest.json`, then the dataset's `refreshKey`, so one
page never mixes refreshes. It rejects any `contractVersion` other than
`report-output-1`, a file whose report, dataset or refresh does not match its
manifest, and objects above a bounded size, and returns Console's generic
tabular dataset (`columns`, `rows`, `generatedAt`, `window`). The output bucket
is resolved from Report's SSM parameter (`/report/<stack>/output-bucket`) at
deploy time, never from configuration, and Console holds only `s3:GetObject` on
`outputs/*`. Without that parameter the deployment keeps a fail-closed adapter.
Report's output files are its published reader contract; Console must not read
its ledger, staging or Athena results.

Every data binding names a registered product adapter and operation, typed input
mapping, output contract and bounded refresh/pagination policy. Every action
names a registered owning-product operation, confirmation behavior, required
scope and result presentation. Configuration cannot supply raw credentials or
an arbitrary network destination.

## 7. Model network behavior

Console consumes a resolved effective model and Model-owned view definition. It
does not merge base and extension manifests.

The network view must:

- start at the extension's declared top vertex;
- traverse only relationships allowed by the view definition and configured
  depth/filter limits;
- preserve canonical definition identities;
- handle cycles without duplicate or unbounded traversal;
- distinguish base, imported and extension concepts with accessible styles and
  a legend;
- show vertices, relationships and state-machine details;
- update after a compatible published configuration or Model view revision;
- fail explicitly on missing top vertices, unresolved references and unsupported
  composition/view versions.

## 8. Security and reliability

- Enforce tenant and resource authorization server-side for configuration,
  data bindings and actions.
- Resolve upstream services through approved environment/service metadata, not
  configuration-supplied URLs.
- Apply CSP, safe output encoding and dependency security checks to the runtime.
- Bound graph traversal, pagination, retries, timeouts and response sizes.
- Never place credentials, tokens or sensitive upstream payloads in static
  assets, configuration artifacts, URLs or telemetry.
- Make configuration submission idempotent and publication/selection
  concurrency-safe.
- Keep a complete audit of publisher, digest, compatibility decision, active
  selection and rollback.

## 9. Product integrations

- **Account:** identity, account context, roles/scopes and service authorization.
- **Model:** resolved model composition plus declarative graph/catalog/detail/
  review view definitions.
- **Persist:** bounded graph/fact queries through its public query contract.
- **System:** typed workflow invocation and status operations for configured
  actions.
- **Callers of the authoring job API:** external systems such as Jigglypuff call
  the `email-html` target through the shared domain with an environment key and
  keep their own repository, approval and delivery steps.
- **Report:** read-only `report-output-1` dataset files and manifests from the
  `outputs/` prefix of Report's output bucket.
- **Build:** source validation and immutable runtime artifact/provenance.
- **Marketplace:** Console bundle catalog, review, publication and rollback.
- **Deploy:** runtime/API/CDN installation and compatible configuration delivery.

A successful step in one product is not evidence that the next integration is
ready.

## 10. User story

### Context

Console is assigned to Chandelure (build) and Vivillon (configure). Product-specific UIs risk duplicating
rendering, access and deployment behavior. The existing Model UI is a prototype,
while Model composition contract V1 defines base/extension manifests but does
not yet establish a deployed runtime composition resolver.

### Description

Build Console for Figma-driven component creation/editing and as a reusable
configuration-driven runtime with Chandelure and Vivillon, and integrate it with current Prism
products through public contracts. Prove reuse by rendering two materially
different applications from independent configurations on one runtime.

### Acceptance criteria

Require the four HTML/React create/edit paths, Figma MCP access, deployed
AgentCore/pi execution, preserved behavior, responsive evidence and job recovery
acceptance in [component authoring](component-authoring.md), plus the following
renderer/configuration checks.

1. Versioned schemas validate routes, layouts, components, themes, bindings,
   actions and access policies; executable or credential-bearing configuration
   is rejected.
2. The generic component registry renders catalog, table/filter, detail, review,
   state timeline and network views with complete loading/error states.
3. A Model network starts at the declared top vertex, preserves identities and
   visibly distinguishes base and extension concepts.
4. Account authorization protects configuration operations, routes, components,
   data and actions server-side.
5. Model, Persist and System are accessed only through verified public APIs.
6. Runtime and configuration artifacts are immutable, independently versioned,
   digest-verified, compatibility-checked and atomically selectable.
7. A published configuration update appears without rebuilding the runtime;
   rollback restores the preceding revision.
8. Build produces runtime provenance, Marketplace publishes the bundle and
   Deploy installs it without Console absorbing those responsibilities.
9. The same runtime renders:
   - a Model Governance Console with catalog, composed network, definition
     detail and review views; and
   - an Operations Graph Explorer with Persist fact traversal, filters, details
     and an optional System action.
10. The same runtime renders an existing Report output (pilot
    `portal-performance`) and a materially different report configuration
    using only report components and `report` bindings, with values matching
    the source dataset files.
11. Tests cover schema/component compatibility, cycles and traversal bounds,
    unresolved Model references, authorization denial, upstream failures,
    refresh, atomic selection and rollback.

### Authoring lifecycle acceptance

Require all cumulative cases in [the lifecycle contract](product-lifecycle.md):
project policy resolution, reviewed follow-ups, portable asset exports, idempotent
PR application/conflicts/reverts, optional registry promotion and compatible
rollback, tenant isolation, fair queues, budget limits, expiry, deletion and restore.
Keep source-only export independent of Model/Persist readiness. Treat those
services as dependencies only for applications that use their bindings.

### Demo script

1. Sign in as a Model reviewer and open the Model Governance Console.
2. Select a pinned extension release and show the top vertex, imported base
   concepts, extension concepts, relationships and distinct styling.
3. Open catalog, detail and review views generated from governed definitions.
4. Publish a configuration-only presentation change and show it without a
   renderer rebuild.
5. Open the Operations Graph Explorer as an operations user on the same runtime.
6. Traverse bounded Persist facts, filter results and open a detail view.
7. Show a restricted review route or System action denied server-side.
8. Show runtime/configuration digests, Build provenance, Marketplace publication,
   Deploy installation and rollback to the prior configuration.

## 11. Dependencies and non-goals

Dependencies:

- Model runtime composition resolution and resolved-model/view APIs;
- a bounded Persist graph-query contract;
- Report's `report-output-1` output contract and output-bucket SSM parameter;
- Account browser and service authorization contracts;
- Build, Marketplace and Deploy support for the selected artifact shapes.

Out of scope for the MVP:

- arbitrary runtime-loaded plugins or configuration-supplied JavaScript;
  permit reviewed generated source only through the compiled registry lifecycle;
- a drag-and-drop application designer;
- Model composition, Transform, Rule or System execution inside Console;
- direct graph/model writes or direct database access;
- migration of every legacy UI.

Record unresolved choices—configuration registry ownership, refresh mechanism,
graph library, traversal limits and pinned-versus-controlled-current policy—in
the Console repository. Do not silently resolve them inside an application
configuration.
