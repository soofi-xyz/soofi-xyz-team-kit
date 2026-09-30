# Account capability map

Use Kangaskhan to implement Account capabilities and Blissey to configure existing
ones. Follow the [shared workflow](../../SKILL.md). These nine areas form a starting
inventory, not a fixed iteration count. Select scope, order dependencies and split
independently useful features further where needed. Keep tests and user/AWS
feedback inside every piece; narrow work need not cover the entire map.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `identity` — create and read an account | Verified HTTP/auth contract | Deliver minimal create/read/update/search with authorization and stable identity; exercise customer and organization fixtures, invalid input and an unauthorized read. | Trace API request and storage logs; read back kind, identity and version, confirm rejection has no write and credentials are redacted. |
| `confirmation` — activate a customer identity | Identity | Deliver signed confirmation and replay/expiry handling with mocked mail; exercise valid, expired, tampered and repeated callbacks. | Inspect the send/wait/resume states and account/key activation; compare first completion and replay without exposing tokens. |
| `account-keys` — manage caller credentials | Identity and required confirmation | Deliver mint/list/revoke and scoped authorization; exercise two keys, a revoked-key call and another account's caller. | Inspect API authorization and key-state changes; verify one-time mint output is handled locally and no plaintext reaches logs or evidence. |
| `provisioning` — make an account ready | Confirmed identity and provider configuration | Deliver create-or-adopt AWS account workflow with the canonical DNS/certificate work required for readiness; configure fake new and pre-provisioned accounts, duplicate starts and provider failure. | Follow submission, polling, DNS validation and terminal status through the API and workflow; an accepted request or mock account ID does not prove real readiness. |
| `custom-domains` — configure additional domain metadata | Provisioned account | Deliver supported domain/certificate configuration beyond canonical provisioning; vary supported canonical/alias settings and simulate validation failure. | Inspect domain workflow, DNS/ACM results and API read-back; verify no product route mapping is created by Account. |
| `bootstrap-handoff` — retrieve installation inputs | Provisioning | Deliver authorized bootstrap-manifest retrieval; compare ready and incomplete accounts and reject a caller from another account. | Inspect API checks and a redacted manifest comparison; validate required identifiers without logging bootstrap credentials or claiming stacks were installed. |
| `service-key-rotation` — replace a service credential | Provisioning and existing shared usage-plan binding | Deliver rotation, overlap and old-key retirement; exercise configured grace periods, concurrent rotation and a failed binding update with fakes. | Trace binding/retirement states; verify new-key usability, old-key rejection after grace and the supported recovery outcome. |
| `maintenance-access` — grant temporary access | Provisioning and verified identity/approval integration | Deliver approved, single-use, expiring sessions with mocked identity, mail and IAM; exercise approval, denial, expiry and repeated redemption. | Inspect approval/wait/cleanup states and redacted audit records; verify denial/expiry prevents use and cleanup runs. Do not fabricate owner approval or bypass required MFA. |
| `disable` — retire an account safely | Provisioning and verified consumer-removal prerequisites | Deliver guarded disable, teardown and final status; exercise a fake account with remaining consumers, a clean account and a partial provider failure. | Inspect prerequisite rejection, teardown order and terminal read-back; a blocked account must retain its resources. Mock account closure for acceptance; real closure requires explicit scope. |

Use the [Account contract](../../../build-tenant-account-manager/reference/PRD.md)
and [synthetic fixtures](../../../build-tenant-account-manager/reference/test-data.md).
The map specifies required outcomes, not deployed endpoints. Discover exact routes,
auth, statuses and test adapters in the target revision. Exercise each feature
through the Account HTTP API; direct Lambda/workflow calls support diagnostics.
Provide submission/status/results for async capabilities, and route a missing API
surface to Kangaskhan. Reuse one execution implementation behind those surfaces.

Include canonical DNS in the first complete provisioning path; custom-domain
management is the separate extension. Keep provisioning and disable separate:
one creates readiness, the other enforces consumer cleanup before teardown.
Observe selected features through real test-stack executions with mocked external
effects before authorized live dependencies. Finish with cumulative acceptance.
