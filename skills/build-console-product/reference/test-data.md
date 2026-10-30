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

## Google sign-in fixtures

Use a fake issuer with a local JWKS and signed test ID tokens. Never call Google
from automated tests. Policy: `allowedDomains: [allowed.example]`,
`sessionSeconds: 900`, `passwordSignIn: disabled`.

| Fixture | Claims or action | Expected |
| --- | --- | --- |
| Allowed user | `email: ana@allowed.example`, `hd: allowed.example`, verified | Session; application and report reads succeed |
| Other domain | `email: bo@other.example`, `hd: other.example` | Denied, `domain_not_allowed`, no session record |
| Personal account | `email: cy@gmail.com`, no `hd` | Denied, `domain_not_allowed` |
| Unverified email | Allowed `hd`, `email_verified: false` | Denied |
| Replayed callback | Same `state` used twice | Second callback denied |
| No session | Any application route or API read | API `UNAUTHORIZED`; renderer redirects to `/auth/google/start` |
| Sign-out | `POST /auth/signout`, then a read | Read rejected and redirected |
| Expiry | Read at 901 seconds | Rejected and redirected |
| Password disabled | `POST /viewer/session` | `NOT_FOUND` |

**Builder change test:** with the policy on, add one new page to a fixture
application and change an existing page's layout. Both routes must redirect
without a session and render with the allowed user, and the sign-in suite and
route inventory must pass without editing the guard.

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

## Component authoring fixtures

Use synthetic design snapshots and MCP fakes for local tests; label them mocked.
For live acceptance, use authorized Figma nodes and record actual IDs/digests.
Do not fabricate a working Figma URL or commit private source/design assets.

| Case | Baseline / variant | Expected evidence |
| --- | --- | --- |
| Create HTML | Responsive card / navigation with mobile menu | Semantic HTML/CSS, no React dependency, preview and breakpoint results |
| Create React | Card with typed props / existing design-system form | Reused components, type/build checks, final-route visual results |
| Edit HTML | Spacing change / icon and button variant change | Scoped patch, unchanged behavior, failing-before/passing-after design assertion |
| Edit React | Responsive layout / follow-up typography edit | Preserved handlers/state/API/analytics and props, session continuity, regression results |
| Figma failure | Denied node / stale or disconnected MCP | Typed issue; no invented design or verified-success claim |
| Recovery | Duplicate submit / interrupted turn | One logical job, restored context and no repeated side effect |
| Isolation | Cross-tenant result / path escape / stale base | Denial or conflict with no unauthorized read/write |
| Cancellation | Cancel during a tool call / cancel queued job | Terminal cancellation, no subsequent application/publication |

Record operation/output, source revision, design provenance, pi/model/runtime
versions, job/session IDs, artifact digests, commands/results, preview screenshots,
LangSmith/AWS correlation and user observations. Keep live MCP, deployed runtime
and mocked fixture evidence distinct.

## Project and delivery acceptance fixtures

Use the [lifecycle acceptance cases](product-lifecycle.md#cumulative-acceptance)
with synthetic tenant/project/connection IDs and deterministic provider fakes.

| Fixture | Expected result |
| --- | --- |
| HTML project versus React/CSS-module project | Different pinned profiles; same request contract; no implicit framework conversion |
| Job changes project or tenant command/network policy | Forbidden override rejected; no execution or privilege widening |
| Project edited during a job | Existing job uses original resolved revision; stale updates conflict |
| Candidate accepted, then changed or rebased | Old acceptance cannot apply/promote new digest; checks and review repeat |
| Export contains expiring Figma/localhost assets | Package assets by digest or report packaging failure |
| PR provider succeeds then times out | Retry reconciles existing PR; no duplicate commit/PR |
| Target branch advances before application/revert | Conflict or newly reviewed candidate; no forced overwrite |
| React registry release / supported HTML adapter release | Build provenance, catalog and installation verified before component selection |
| Unsupported HTML scripts or unknown component version | Export-only or validation rejection; no configuration execution |
| New component versus existing component theme update | New runtime for component addition; configuration-only revision for supported theme change |
| Busy tenant plus small tenant; exhausted budget | Bounded fair scheduling, enforced quotas and attributable usage |
| Preview expiry, disconnect, retention and restore | Access revoked, cleanup verified and durable history restored without duplicate writes |

Record local/provider-fake evidence separately from live repository PRs and
Build/Marketplace/Deploy results. Do not publish fixtures to a real repository or
service merely to satisfy a mocked test.
