# Console capability map

Use Chandelure to implement Console and Vivillon to configure existing
capabilities. Follow the [shared workflow](../../SKILL.md). These 6 areas are a
starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `application-contract` — validate a declarative application | Verified identity/version conventions | Deliver versioned schemas and API validation for applications, routes, layouts, themes, components, bindings, actions and access policies. Exercise a minimal catalog, a different layout, an unknown component and executable configuration. | Trace validation and immutable artifact writes; verify invalid input creates no selectable revision and no credentials or executable code enter the artifact. |
| `renderer-shell` — render reusable pages | Application contract | Deliver the web shell, navigation, loading/error states and safe component registry. Configure catalog, table, detail, filter, review and state-timeline pages without custom application code. | Inspect the selected runtime/configuration digests, CDN request and browser telemetry; compare two layouts on the same runtime. |
| `identity-and-bindings` — call product APIs safely | Renderer shell and verified Account/public API contracts | Deliver authenticated route/component/action enforcement and typed server-side adapters. Configure Model, Persist and System bindings plus an unauthorized route/action. | Trace Account context and correlated upstream calls; verify denial is enforced server-side and no direct database or browser credential access occurs. |
| `model-network` — explore a composed model | Model resolved-composition and view contracts | Deliver graph rendering from the declared top vertex with cycle-safe traversal, canonical identities, relationship/state detail and accessible base/extension styling. Configure different depth/filter/style choices and an unresolved reference. | Compare the rendered graph with the pinned Model release/digest; verify missing composition data fails explicitly rather than being inferred by Console. |
| `configuration-delivery` — update without rebuilding | Valid application revision and compatible runtime | Deliver immutable configuration publication, atomic selection, refresh/invalidation and rollback independent of runtime assets. Configure a visible change, incompatible revision and rollback. | Inspect configuration object digest, active pointer/invalidation and client refresh telemetry; prove the runtime artifact did not change and rollback restores the prior revision. |
| `product-delivery` — package and operate Console | Cumulative runtime and configuration acceptance | Deliver Build-ready source/provenance, Marketplace metadata, Deploy-compatible runtime/configuration assets, health and correlated observability. Configure a Model Governance Console and an Operations Graph Explorer on one runtime. | Verify Build artifact identity, Marketplace publication and Deploy installation separately; open both applications, compare selected configurations and confirm health/rollback without claiming unavailable upstream readiness. |

Read [the product contract](../../../build-console-product/reference/PRD.md) and
[synthetic test data](../../../build-console-product/reference/test-data.md).
Discover actual schemas, routes, auth, statuses and test adapters from the target
revision. Exercise each piece through the supported API and hosted runtime. Direct
AWS inspection supports evidence; it does not replace API/browser use. Start with
faked upstream products, then use live dependencies only within authorized scope.
Give one invocation and at most three inspection steps, collect the person's
redacted request ID and observation, and wait for that feedback before advancing.

Keep Model composition and view semantics with Dialga/Jirachi, Persist queries
with Conkeldurr/Uxie, System execution with Zygarde/Celebi and Account identity
with Kangaskhan/Blissey. Build creates artifacts, Marketplace publishes them and
Deploy installs them; Console does not absorb those product responsibilities.
