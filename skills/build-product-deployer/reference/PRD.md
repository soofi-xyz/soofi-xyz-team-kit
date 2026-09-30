# Deploy implementation scope

Use **Deploy** as the product name, Corviknight as builder and Skarmory as
configurer. Follow the [capability map](../../guide-product-work/reference/iterations/deploy.md)
and [synthetic test data](test-data.md) for feature increments and user/AWS checks.
Conkeldurr owns Persist and Zygarde owns System, not Deploy.

The supplied 2026-09-30 comparison describes a small, stateless IAM SigV4 run
service: `POST /deploy/run` and run-status retrieval. Inspect the target revision
for the exact request and status contract before implementation or invocation.
Do not infer the complete current payload from the historical token-deploy API.

Preserve stateless execution and separate subscriber installation history/keys
from run execution. The comparison places that state in a subscriber-side puller;
attribute that functionality to Marketplace/Deploy rather than adding Puller to
the product ontology. Discover and document the actual ownership within those
products before changing their integration. Physical packages may stay separate.

Use the selected AWS profile and confirm account/region. Validate Build artifact
compatibility, idempotency, failure reporting and state boundaries. Test in the
authorized environment and distinguish synthesis from a completed deployment.

Expose the authenticated HTTP run boundary and observable status/results. Verify
caller permissions and artifact/target scope before writes; test terminal results
against CloudFormation events. Reuse current execution machinery. Keep run
diagnostics separate from subscriber desired state, installation history and keys.
Do not add old review, token-deploy or rollback routes without a scoped requirement.
Use fakes first, then the actual test API with controlled adapters and authorized
live effects. Wait for user observations inside each selected capability piece.
