# Console product contract

## 1. Purpose

Console is the reusable Prism web runtime. It turns a governed, versioned
application manifest into an authenticated UI made from supported components and
typed product API bindings. One runtime must render materially different
applications without application-specific forks.

Console Configuration is not a second product. It is an immutable application
artifact operated through Console by Vivillon. Chandelure owns the reusable
runtime and configuration service.

## 2. Ownership

Console owns:

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

The implemented Console contract must expose authenticated operations to:

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
- **Build:** source validation and immutable runtime artifact/provenance.
- **Marketplace:** Console bundle catalog, review, publication and rollback.
- **Deploy:** runtime/API/CDN installation and compatible configuration delivery.

A successful step in one product is not evidence that the next integration is
ready.

## 10. User story

### Context

Prism has no assigned Console product. Product-specific UIs risk duplicating
rendering, access and deployment behavior. The existing Model UI is a prototype,
while Model composition contract V1 defines base/extension manifests but does
not yet establish a deployed runtime composition resolver.

### Description

Build Console as a reusable configuration-driven runtime, assign Chandelure as
its builder and Vivillon as its configurer, and integrate it with current Prism
products through public contracts. Prove reuse by rendering two materially
different applications from independent configurations on one runtime.

### Acceptance criteria

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
10. Tests cover schema/component compatibility, cycles and traversal bounds,
    unresolved Model references, authorization denial, upstream failures,
    refresh, atomic selection and rollback.

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
- Account browser and service authorization contracts;
- Build, Marketplace and Deploy support for the selected artifact shapes.

Out of scope for the MVP:

- arbitrary plugins or customer JavaScript;
- a drag-and-drop application designer;
- Model composition, Transform, Rule or System execution inside Console;
- direct graph/model writes or direct database access;
- migration of every legacy UI.

Record unresolved choices—configuration registry ownership, refresh mechanism,
graph library, traversal limits and pinned-versus-controlled-current policy—in
the Console repository. Do not silently resolve them inside an application
configuration.
