# Marketplace capability map

Use Regigigas for service features and Registeel for supported catalog operations.
Apply the [shared workflow](../../SKILL.md). These six capabilities have separate
user-visible outcomes; derive the scoped plan and dependency order from the target
[operation contract](../../../operate-marketplace/reference/api-contract.md).
Use only authorized catalog objects and genuine CDK cloud-assembly bundles that
the Build service built from a product's merged default branch.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `catalog-registration` — register and discover a product | Existing parent hierarchy or authorization to create it | Deliver catalog registration/read-back; configure the requested hierarchy/product and test invalid parent and duplicate behavior. | Inspect correlated API logs and identifiers/relationships; verify safe rejection and idempotency. |
| `component-associations` — bind a configuration/component | Catalog registration | Deliver supported configuration/component registration and associations; configure only authorized entries and vary permitted bindings. | Inspect validation/registration logs and read-back; prove bindings reference the correct catalog objects. |
| `bundle-publication` — submit a cloud-assembly bundle | Registered component and an authorized cloud-assembly bundle | Deliver bundle intake, immutable provenance and publication request; configure a valid publication plus an invalid artifact case. | Inspect intake logs, bundle identity and review handoff; distinguish accepted publication from VALID status. |
| `review-lifecycle` — understand validation status | Bundle publication | Deliver asynchronous review, supported settings and failure diagnostics; configure allowed review policy variants and inspect success/failure. | Follow the actual review execution/worker logs to terminal status; identify the failing check and corrected review. |
| `rollback` — select a prior valid bundle | Existing VALID versions | Deliver supported rollback/provenance; configure rollback between authorized test versions and a disallowed target. | Inspect rollback logs and active-version read-back; verify provenance and rejection of invalid targets. |
| `publication-notifications` — observe a publication event | Supported publication transition | Deliver supported notification routing/delivery; configure a test destination and a failed/retried delivery case where available. | Inspect publication and delivery logs independently; compare event identity, recipient test receipt and retry outcome. |

Keep tests within each feature. Registering one component usually selects one
component-association piece with relevant prerequisite evidence. Do not add extra
components, publication, rollback or notifications to make the count larger.
Verify a negative request cannot create unwanted state before asking the person
to submit it. Missing artifacts/access leave the affected checkpoint pending.
Discover the actual execution surface: synchronous API logs are sufficient where
no Step Functions workflow exists. Do not invent endpoints or waive review gates.

Apply the [configuration-bundle contract](../../../build-product-deployer/reference/configuration-bundles.md)
inside component registration, publication, review and prior-release selection.
Exercise supported wire-type consistency, missing/incompatible provider or target
API prerequisites, terminal configuration read-back and failed application.
Keep catalog rollback separate from configuration reversal; report review gaps
rather than bypassing them.
