# Console synthetic test data

Use synthetic identities and mocked product APIs until the relevant live
integration is explicitly authorized. These fixtures define expected behavior;
they do not prove that Console or an upstream API is deployed.

## Application fixtures

### Model Governance Console

- Application: `model-governance`
- Runtime constraint: `>=1.0.0 <2.0.0`
- Routes: model catalog, composed network, definition detail, review
- Model release: `urn:prism:model:demo-soc:1.0.0`
- Top vertex: `demo.soc#vertex/debt`
- Base concepts: person, company, communication
- Extension concepts: debt, account, payment
- Roles:
  - `model-reader`: catalog, network and detail
  - `model-reviewer`: reader access plus review route/action

Expected: graph traversal starts at debt, imported base concepts retain their
canonical identities, base/extension styling and legend are visible, and a
reader receives a server-side denial for review operations.

### Operations Graph Explorer

- Application: `operations-explorer`
- Same runtime version as `model-governance`
- Routes: graph search, fact table, entity detail
- Persist binding: bounded fact traversal with cursor pagination
- Optional System action: `replay-approved-run`
- Role: `operations-user`

Expected: the application uses a different manifest and page composition without
a renderer fork. Fact traversal is bounded and the System action requires its
own scope.

## Configuration variants

1. **Presentation update:** add a graph legend and one approved detail field.
   Expected: publish a new configuration digest, refresh the client without
   changing the runtime digest, then roll back to the prior revision.
2. **Different layout:** replace a two-column catalog/detail page with a table
   route and side panel using registered components only.
3. **Pinned upstream:** bind to the explicit Model release above.
4. **Controlled current:** use only if the discovered Console contract supports
   a governed current pointer; otherwise reject it rather than silently pinning.

## Invalid and unauthorized fixtures

| Case | Input | Expected result |
| --- | --- | --- |
| Arbitrary code | Component property containing inline JavaScript | Validation rejection; no revision becomes selectable |
| Unknown component | `componentType: "custom-html-runner"` | Unsupported-component issue |
| Arbitrary destination | Binding with an unregistered external URL | Validation rejection |
| Embedded credential | API key in a binding header | Validation rejection and redacted logs |
| Missing top vertex | Model network without resolved top-vertex identity | Explicit dependency/validation failure |
| Unresolved reference | Relationship points to an absent definition | Explicit Model dependency failure; no inferred node |
| Runtime mismatch | Configuration requires Console 2.x on runtime 1.x | Compatibility rejection |
| Unauthorized route | `model-reader` opens review | Server-side `FORBIDDEN`; no upstream review call |
| Cross-account application | Caller account differs from application account | Server-side `FORBIDDEN` |

## Upstream failure fixtures

- Model returns an unsupported composition/view version.
- Persist returns an expired cursor and a bounded timeout.
- System accepts an action but later returns a failed terminal status.
- Account context is absent, expired or lacks the action scope.

Console must present typed safe states with correlation IDs. It must not expose
upstream payloads, credentials or stack traces.

## Evidence matrix

For each selected capability record:

- runtime version and digest;
- configuration revision and digest;
- account/application identity and redacted request ID;
- validation/compatibility result;
- browser route/component observed;
- correlated upstream adapter call or expected denial;
- AWS resource/log inspected;
- refresh or rollback result;
- whether evidence is local, mocked deployment or authorized live integration.
