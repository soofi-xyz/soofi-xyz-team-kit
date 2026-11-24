# Console synthetic test data

Use synthetic identities and mocked product APIs until the relevant live
integration is explicitly authorized. These fixtures define expected behavior;
they do not prove that Console or an upstream API is deployed.

Fixture names below are the ones the tests in [the design system](design-system.md),
[the app kit](app-kit.md) and [the sign-in contract](google-sign-in.md) use.
Keep every name, number and record synthetic.

## Design-system fixtures

| Fixture | What it is | Used by |
| --- | --- | --- |
| `tokens-a` | The default token set, in the debt-collection demo's look | DS-3, DC-1, DC-4 |
| `tokens-b` | A materially different token set: other ground, text, primary and radii, all still valid | DS-3, DC-1, DC-4, DC-5, RS-2, AD-4 |
| `tokens-invalid` | Two revisions: one with a color token set to `12px`, one with an unknown key | DC-2 |
| `button-variant-unknown` | A source file giving `Button` a variant that does not exist | DS-4 |
| second design-system build | The same components with a visibly different `Button`, and one lazily loaded component | SH-3, SH-4, SH-5, AD-5 |
| `v3` build | A next major version that removes a prop `sample-app` uses | SH-6 |

## App fixtures

| Fixture | What it is | Used by |
| --- | --- | --- |
| `sample-app` | Two pages built only from the kit: stats, a card, a switch, a button, a `Badge`, a table bound to a Report dataset, a list bound to a Persist read and one action; a hook and a context from a design-system component | AK-2, SH, AH, DC, DH, AD-1, AD-2, CS |
| `sample-app-two` | A materially different app: other pages, a chart and a form, no shared page with `sample-app` | AH-2, CS-16, CS-17 |
| `pack-app` | `sample-app` plus one page that uses `Sparkline` from `sample-pack` | CP-1, CP-2 |
| `compact-app` | `sample-app` with a compact density chosen in its settings | DC-6 |
| reference app | The debt-collection demo's Rules step, rebuilt from the kit | RA-1 to RA-4 |

Each app carries one sample-data file per binding, so it runs locally with no
network (AK-1).

### Violation apps

One app per rule, each identical to `sample-app` except for a single violation.
Each must fail the check with exactly its rule.

| Fixture | The one violation | Rule | Used by |
| --- | --- | --- | --- |
| `violation-raw-element` | renders a `<div>` | `raw-element` | AK-3, AD-3 |
| `violation-class-name` | passes `className` to `Button` | `class-name` | AK-4 |
| `violation-off-scale` | sets `gap="13px"` on `Stack` | `off-scale-value` | AK-5 |
| `violation-css-file` | imports a style file | `css-file` | AK-6 |
| `violation-dependency` | imports another interface library | `foreign-dependency` | AK-7 |
| `violation-fetch` | calls `fetch("https://example.invalid")` | `network-call` | AK-8 |
| `violation-dom` | calls `document.createElement("div")` | `dom-access` | AK-9 |

Two hand-built bundles bypass the check on purpose, to prove the browser-side
refusals: one calls the JSX wrapper with the string tag `div` (AK-10); the
others import `createElement` from React and import `react-dom` (AK-11).

## Component pack fixtures

| Fixture | What it is | Used by |
| --- | --- | --- |
| `sample-pack` 1.0.0 | Adds `Sparkline`; replaces the base `Badge` with a visibly different one whose props match | CP-1, CP-3, CP-5, AD-7 |
| `sample-pack` 1.1.0 | The same pack with a visibly different `Sparkline` | CP-6 |
| `bad-pack` | A `Badge` replacement that requires a prop the base `Badge` does not have | CP-4, AD-7 |

## Environments and people

- **Environment A:** `tokens-a`, `sample-pack` installed and its `Badge`
  replacement active.
- **Environment B:** `tokens-b`, no pack.

In the repository A and B are two installed stand-ins; deployed, they are two
dev environments or two installs the user names.

Use the people from [the Access test data](../../build-access-product/reference/test-data.md).
`alice` is connected to `scope-a` (`item-a1`, `item-a2`) and holds the role for
`sample-app` only; `bob` has the same role and is connected to nothing; `dave`
is disabled during the run. DH-2 and CS-12 read the same Persist items.

For the company logo (`CB-1` to `CB-10`) add three people who open `brand-app`
only: `pia@prismteam.ai` (Prism), `cora@companyb.example` (Company B, also
holding `companyb-demo`) and `omar@other.example` (no company record).
Persist holds one `company` record, `company-b` (`domain: companyb.example`,
`name: Company B`, `logo_url:
https://logos.companyb.example/companyb.png`), reachable only from the
`companyb-demo` role's group. The logo host serves a 1x1 PNG there and SVG
bytes at `/logo.svg`.

## Data fixtures for apps

- **Report dataset:** `sample-report` / `accounts`, two refreshes with different
  row counts, in Report's `report-output-1` shape (DH-1).
- **Persist read:** a registered read that lists the items the caller is
  connected to, faked upstream in the repository (DH-2, DH-3).
- **Undeclared binding:** `other-binding`, registered in Console and declared by
  `sample-app-two` only (DH-3).
- **Action:** `mark-reviewed`, whose fake upstream records the caller (DH-5).
- **Slow upstream:** the Persist fake delayed beyond the operation's timeout
  (DH-6).
- **Reference app rows:** 200 synthetic accounts, each with the list of rules
  that hold it back on text and on email. At least 12 are held back by exactly
  one rule, so RA-2 has a known expected count.

## Dashboard fixtures

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

### Report dashboards

Use the Console repository's `portal-performance` and `inventory-controls`
fixtures for the reskin (RS-1 to RS-3). Their manifests do not change.

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

## Access sign-in fixtures

Sign in through the fake Access in Console's `test/support/fake-access.ts`,
shared by the unit tests and the `installed-access` Playwright project. Never
call a real Access or Google from automated tests. Its people follow
[the Access test data](../../build-access-product/reference/test-data.md):
`alice` and `bob` hold `member` and the role for `sample-app`, and `dave`
holds no role. The sign-in checks and what each expects are `CS-1` to `CS-17`
in [the sign-in contract](google-sign-in.md#definition-of-done-for-access-sign-in).

**Builder change test:** with Access sign-in on, add one new page to a fixture
application and change an existing page's layout. Both routes must send a
visitor without a session to Access and render for `alice`, and the sign-in
suite and route inventory must pass without editing the guard.

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
- design-system version and digest, and the active pack versions;
- app version and digest, with the check result from its build record;
- browser route/component observed;
- correlated upstream adapter call or expected denial;
- AWS resource/log inspected;
- refresh or rollback result;
- whether evidence is local, mocked deployment or authorized live integration.
