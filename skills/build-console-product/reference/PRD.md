# Console product contract

## 1. Purpose

Console is where a Prism environment's business apps and dashboards run. It
serves one design system, hosts apps assembled only from that design system,
signs people in through Access and is the only data path an app has to other
products. Every app in an environment looks the same because it cannot be built
from anything else.

Console delivers:

- the **design system**: shared components and tokens, served to apps and
  dashboards at runtime, so a component change reaches every app without
  rebuilding it;
- the **app kit**: the package an app is built with, and the check that refuses
  anything outside the design system;
- **app hosting**: immutable app versions with publish, read-back and rollback;
- the **design-system configuration**: each environment's tokens, switched-on
  components and active component packs;
- **dashboards**: the existing JSON `ConsoleApplicationManifest` renderer.

An agent is the author. A business person describes the app and reviews a
preview; they do not write code. Vivillon builds apps and configures an
existing Console. Chandelure builds and maintains Console itself.

Read [the design system](design-system.md), [the app kit](app-kit.md) and
[the sign-in contract](google-sign-in.md) as required parts of this contract.
Each ends with the tests that define done for its pieces.

## 2. Ownership

Console owns:

- the design system: base components, tokens, the gallery and their versions;
- runtime sharing: immutable builds, the pointer per major version and their
  caching rules;
- the app kit: component types, the local copy, the data hooks, the JSX wrapper
  that refuses raw elements, the check tool, the scaffold and the build settings;
- app hosting: app identities, immutable versions, active selection, rollback
  and the shell that loads the active app after sign-in;
- the design-system configuration and its revisions;
- installing, activating and rolling back component packs in an environment;
- the `ConsoleApplicationManifest` schema, the dashboard renderer and its
  compatibility policy;
- registered product operations, typed binding and action validation, and the
  server-side adapters that call other products;
- route, binding and action authorization enforcement;
- signing people in through Access as a registered application, its own
  session, sign-out and the route inventory, as defined in
  [the sign-in contract](google-sign-in.md);
- browser and runtime telemetry and explicit loading, empty, denied and error
  states.

Console does not own:

- an authoring runtime. Console runs no coding agent, authoring job API,
  project store or review workspace. Agents that build apps or components run
  on Enact or in an editor; their tools, repositories and limits are Enact
  agent configuration (`zoroark` builds, `zorua` configures);
- who a person is, who may sign in and what each role may open, which belong
  to Access (`aegislash` builds, `doublade` configures);
- the company's Prism identity, API keys and operator credentials, which belong
  to Account;
- vocabulary, model composition, top-vertex semantics or view meaning, which
  belong to Model;
- facts, graph storage or query execution, which belong to Persist;
- workflow orchestration, which belongs to System;
- report queries, refreshes and dataset computation, which belong to Report;
- rule evaluation, inference, scheduling or any other product's computation,
  including "what if" runs of them;
- building sources, checking them as a publish gate, catalog review or
  installation, which belong to Build, Marketplace and Deploy.

Console calls owning products through supported public APIs. It never reads
their databases and never writes Model or Persist data directly. A declared
mutation is a typed action against an owning product's public API.

## 3. Inputs and outputs

### Inputs

- The signed-in person's Access identity, roles and current Access token, which
  bindings forward to other products so each applies its own per-user rules.
  Account-issued account context and service scopes apply to operator and
  configuration calls only, never to a signed-in person's data.
- An app version: built static files, their digests and a build record naming
  the app, the design-system version range it needs, the components and packs
  it uses, and its declared bindings and actions.
- A design-system configuration revision for the environment.
- A component pack build and its component manifest.
- A `ConsoleApplicationManifest` for a dashboard: schema version, application
  identity, runtime compatibility, routes, navigation, layouts, registered
  component instances, typed bindings and actions, access policies and refresh
  behavior.
- Data and action results returned by public product APIs.
- Report dataset files published under Report's `report-output-1` reader
  contract (`docs/outputs.md` in `prismteam-ai/report`).

A dashboard manifest and a design-system configuration are declarative: inline
JavaScript, remote executable code, credentials, unrestricted URLs and
unregistered components or adapters are invalid. App and pack code is
JavaScript and is accepted only as a build that passed the check in Build and
review in Marketplace.

### Outputs

- Authenticated apps and dashboards rendered with the environment's design
  system.
- Immutable runtime, design-system, pack, app and configuration artifacts with
  content digests.
- An active selection per app, per dashboard, per pack and for the
  design-system configuration, each readable and reversible.
- Correlated configuration, authorization, upstream-call and browser telemetry.

## 4. Required product surface

Expose authenticated operations to:

1. discover the runtime version, design-system version, installed packs,
   switched-on components and registered product operations;
2. create and read tenant-scoped app and dashboard identities;
3. submit an idempotent app version or dashboard revision and read its
   validation and compatibility result;
4. publish an immutable valid version with optimistic concurrency protection;
5. read the active selection and roll back to a prior published version;
6. submit, publish, read and roll back a design-system configuration revision;
7. install, activate, read and roll back a component pack;
8. read a declared binding and invoke a declared action for a signed-in person;
9. read health without exposing secrets.

Exact routes are authoritative only when present in the target revision's
`requirements/swagger.yml`. Submission, publication and rollback return stable
request and version identities and correlation IDs. Put every configuration
write route behind the provenance gate.

Recommended scopes are `console:read`, `console:configure` and
`console:publish`. Product actions additionally require the owning product's
authorization. Hiding a route or component is not an authorization control.

## 5. Runtime architecture

Use these logical surfaces unless the target repository has a verified stronger
pattern:

- a static shell, design system, apps and dashboard renderer served from one
  origin over HTTPS, so they share sign-in and one copy of the components;
- immutable assets addressed by version and digest for the runtime, each
  design-system build, each pack build and each app version;
- one pointer module per major design-system version that Console rewrites on
  install or rollback;
- an HTTP API for configuration, hosting, bindings and actions;
- application, version and idempotency metadata with an atomic active-selection
  record;
- immutable configuration artifacts;
- structured logs, metrics and traces carrying account, app, version and
  correlation identities without sensitive payloads.

Keep runtime, design-system, pack, app and configuration releases independent.
Publishing an app or a configuration must not rebuild the runtime. Installing a
design-system build must not rebuild or republish any app. Clients switch only
to a complete compatible version and keep a rollback path.

## 6. Design system and apps

Follow [the design system](design-system.md) for the components, tokens,
runtime sharing, design-system configuration, component packs and the dashboard
reskin. Follow [the app kit](app-kit.md) for the kit, the guardrails, app
hosting, the data hooks, local development, delivery and the reference app.

Hold these across both:

- An app is built only from the design system. It ships no styles of its own,
  no other interface library and no raw elements.
- A component or token change reaches every app in the environment on the next
  page load with no app rebuild. A breaking change gets a new major version and
  apps on the old one keep working.
- Components may differ per environment: the same base components everywhere,
  configured per environment, plus component packs installed per environment.
- An app publishes only where the design-system version, every component it
  uses and every pack it needs are present and switched on.
- App-supplied JavaScript runs on the shared domain only after the check in
  Build and review before publish.

## 7. Dashboards

Keep the manifest renderer working for existing dashboards. Build new business
apps as apps. Do not extend the manifest schema for app-like behavior unless
the user asks. After the reskin the renderer draws with the design system's
components and takes its look from the environment's design-system
configuration.

The component registry includes navigation and route layout; catalog, table,
filters and pagination; detail panel and key/value facts; review panel; state
timeline and status badges; network graph with relationship detail; and
loading, empty, unsupported, unauthorized and upstream-error states.

### Report visualization components

The registry includes generic, configuration-driven report components. Derive
the set from the visuals existing reports use, not from one report:

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
submission. The same report components are design-system components, so an app
uses them through the app kit.

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

### Model network behavior

Console consumes a resolved effective model and Model-owned view definition. It
does not merge base and extension manifests. The network view must:

- start at the extension's declared top vertex;
- traverse only relationships allowed by the view definition and configured
  depth and filter limits;
- preserve canonical definition identities;
- handle cycles without duplicate or unbounded traversal;
- distinguish base, imported and extension concepts with accessible styles and
  a legend;
- fail explicitly on missing top vertices, unresolved references and unsupported
  composition or view versions.

## 8. Data path

- Apps and dashboards read data and run actions only through Console's API.
  App code never calls another product, another origin or `fetch`.
- Every binding names a registered product adapter and operation, typed input,
  an output contract and a bounded refresh and pagination policy. Every action
  names a registered owning-product operation, confirmation behavior, required
  scope and result presentation. An unregistered operation is refused when the
  version is submitted; a binding an app did not declare is refused when read.
- Console checks route, binding and action scopes on every request before any
  cached value is returned.
- For a signed-in person, Console calls the owning product with that person's
  current Access token and never the shared key.
- Neither configuration nor app code can supply a credential, a header or a
  network destination. Console resolves upstream services from approved
  environment metadata.
- A product that has no registered operation is a dependency gap for
  Chandelure and the owning builder, not something an app works around.

## 9. Security and reliability

- Enforce tenant and resource authorization server-side for configuration,
  hosting, data bindings and actions.
- Keep the browser policy that limits scripts, styles and connections to
  Console's own origin, and apply safe output encoding and dependency security
  checks to the runtime.
- Verify every submitted file against its digest and refuse a version whose
  build record shows a failed or missing check.
- Bound graph traversal, pagination, retries, timeouts and response sizes.
- Require sign-in on every app and dashboard route by default.
- Never place credentials, tokens or sensitive upstream payloads in static
  assets, configuration artifacts, app builds, URLs or telemetry.
- Make submission idempotent and publication and selection concurrency-safe.
- Keep a complete audit of publisher, digest, compatibility decision, active
  selection and rollback.
- State the limits in the references honestly: the check stops an agent
  drifting, not a person deliberately hiding a bypass, and every app on a major
  version receives a design-system change at once.

## 10. Product integrations

- **Access:** sign-in, the person's identity and roles, and the token Console
  verifies and forwards.
- **Account:** account context, API keys and service authorization for operator
  and configuration calls.
- **Persist:** bounded graph and fact queries through its public query
  contract, per signed-in person.
- **Report:** read-only `report-output-1` dataset files and manifests from the
  `outputs/` prefix of Report's output bucket.
- **Model:** resolved model composition and declarative view definitions.
- **System:** typed workflow invocation and status operations for actions.
- **Enact:** runs the agents that build apps and components; Console receives
  only their reviewed, delivered output.
- **Build:** installs, checks and builds app and pack sources; validates
  dashboard manifests and design-system configuration; holds the registry the
  app kit is installed from.
- **Marketplace:** catalog, review and publication of Console bundles.
- **Deploy:** installs the runtime and every Console bundle kind through
  Console's API.

A successful step in one product is not evidence that the next integration is
ready.

## 11. User story

### Context

A business person who understands the work needs to go from nothing to a
production app without a technical person. The debt-collection demo shows the
kind of app meant: several pages of controls and results in one consistent
look. Today such an app is hand-built, styled per page and hosted outside
Prism with no sign-in or product data.

### Description

Build Console so an agent assembles that kind of app from one design system,
with product data, Access sign-in and delivery through Build, Marketplace and
Deploy, and so a design-system change reaches every app without rebuilding any.

### Acceptance criteria

1. Every design-system component appears in the gallery, works by keyboard and
   passes the accessibility scan; a second token set restyles all of them.
2. An app that uses anything outside the design system fails the check with a
   named rule and cannot be published.
3. A published app's files contain no design-system code; a new design-system
   build and a token change both reach it with no app rebuild, and rollback
   restores the previous look.
4. Two materially different apps run on one runtime with publish, read-back and
   rollback.
5. An environment sets its tokens and switched-on components; the same app
   files look different in two environments; an app that needs a switched-off
   component or a missing pack is refused at publish.
6. An app reads Report and Persist data and runs an action only through
   Console's API, as the signed-in person.
7. Every app and dashboard requires sign-in through Access, with roles per app.
8. An app, a design-system configuration and a component pack each reach an
   environment through Build, Marketplace and Deploy without Console absorbing
   those responsibilities.
9. Existing dashboards still render, with the design system's look.
10. The reference app passes the check, runs behind sign-in on a dev
    environment and is accepted by the designer.

The pieces, their order and their test IDs are in
[the Console capability map](../../guide-product-work/reference/iterations/console.md).
A piece is done only when every test in its table passes.

## 12. Current state

As of 2026-11-20, `prismteam-ai/console` at `d858269` (runtime 1.18.0) has the
dashboard renderer, immutable revisions with publish and rollback, the report
components, the design system, the app kit, runtime sharing and app hosting
(apps uploaded, published, opened at `/console/app/?appId=<id>` behind Google
sign-in and rolled back; no data and no per-app roles yet). The only
registered product operation is `report` /
`read-dataset`. Sign-in is Console's own `google-oidc` policy, a viewer password
or the shared key, not Access. The browser policy is already
`connect-src 'self'; script-src 'self'; style-src 'self'`. Build and Deploy both
carry the `console` `application` bundle kind on their main branches; whether
any environment has it installed is not verified. Build's check for that kind
refuses a manifest with `forms`.

Nothing else in this contract is built;
[the Status table](../../guide-product-work/reference/iterations/console.md#status)
has each piece. Discover the target revision before
relying on any of it, and state requirements as requirements.

## 13. Dependencies and non-goals

Dependencies:

- Access's sign-in, token and role contract, and Account's service
  authorization contract;
- registered public read operations in Persist and the other products apps use;
- Report's `report-output-1` output contract and output-bucket SSM parameter;
- Build support for building and checking app and pack sources and for holding
  the app kit; Marketplace and Deploy support for the new Console bundle kinds;
- Enact, for running the agents that author apps and components;
- Model runtime composition resolution, for Model network dashboards only.

Out of scope:

- any authoring runtime, coding agent, authoring job API, project store, review
  workspace or email HTML generation inside Console;
- configuration-supplied JavaScript in a dashboard manifest or a design-system
  configuration;
- app code that styles itself, brings another interface library or calls a
  product directly;
- a sandboxed frame per app; it is the only defense against deliberate bypass
  and costs shared sign-in and navigation, so add it only when the user asks;
- a drag-and-drop designer;
- another product's computation inside Console;
- a hosting or build path outside Build, Marketplace and Deploy.

Record unresolved choices (package names, exact addresses, the token map, the
pack override rules) in the Console repository. Do not resolve them inside an
app or a configuration.
