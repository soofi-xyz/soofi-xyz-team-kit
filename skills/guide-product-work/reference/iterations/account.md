# Account capability map

Use Kangaskhan to implement Account capabilities and Blissey to configure existing
ones. Follow the [shared workflow](../../SKILL.md). Start onboarding with one
three-way question: Prism-managed account, existing client-owned account, or new
client-owned account outside Prism. Do not infer the answer from email/company
identity or lead with AWS profiles, roles or API details. Explain the selected
route with **Prism does / You do / Expect** before collecting minimum non-secret
inputs.

These capabilities form a starting inventory, not a fixed iteration count. Select
scope, order dependencies and split independently useful features where needed.
Keep automated tests and user/AWS feedback inside every piece.

## Product boundaries

| Product | Owns |
| --- | --- |
| **Account** | Prism identity, account/service keys, backing AWS account record, explicit create-or-adopt provisioning, Prism cross-account service-access readiness, bootstrap manifest and guarded Account offboarding. |
| **Environment** | Domain and certificate lifecycle, shared routing and initial Prism platform installation. |
| **Access** | IAM Identity Center and customer AWS Console assignments. Access is currently unassigned; report the gap instead of implementing console access in Account. |
| **Prism Marketplace** | Account product/catalog registration, operated by Registeel. |

## User-visible milestones

Never summarize all progress as “onboarded.” Report:

1. **Account identity** — the Prism identity exists.
2. **Request** — create or adopt was accepted; work may still be pending.
3. **AWS account created or recorded** — AWS returned a new account ID, or the
   existing account passed record and ownership checks.
4. **Access ready** — Prism verified its cross-account service role against the
   expected 12-digit AWS account ID.
5. **Platform installed** — Environment proved initial installation. Account
   never infers or owns this milestone.

Every pending/action-required/failure result says what happened, who acts next,
whether the same request is safe to retry and the next non-secret action.

## Feature inventory

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | Acceptance |
| --- | --- | --- | --- |
| `identity` — create, confirm and read a Prism Account identity | Verified HTTP/auth contract | Deliver authorized create/read/update plus signed confirmation where supported. Configure a baseline identity, a materially different supported identity and unauthorized/duplicate input. | Read back the stable identity/version. Rejected input has no write; tokens, keys and credentials stay out of logs and chat. |
| `account-keys` — manage caller and service credentials | Identity and required confirmation | Deliver mint/list/revoke/rotate with one-time secret delivery and scoped authorization. Exercise overlap, revoked use, another account's caller and failed rotation recovery. | Read back metadata only. Verify plaintext never reaches storage/logs/evidence and failed rotation preserves a working prior key. |
| `provisioning-request` — choose create or adopt explicitly | Identity, capability discovery and authorization | Deliver mutually exclusive `PRISM_MANAGED` and `EXISTING_AWS_ACCOUNT` requests, scoped idempotency and plain status/results. Exercise strategy conflicts, duplicate submission and an undeployed live capability. | An accepted request has a stable ID but does not claim an AWS account or access. Create never accepts an existing ID; adopt never falls back to create. |
| `prism-managed-account` — request a new Organizations member account | Authorized `PRISM_MANAGED` request and provider configuration | Use a fake Organizations provider first, then a separately gated live provider. Configure identity, desired subdomain and authorization only; Account generates the platform-managed root address. Exercise pending, duplicate, provider failure and recovery. | Provider/effect counts and fake/live mode are observable. Store the returned 12-digit ID only after success; never create or close an account for a smoke test. |
| `client-owned-account-guidance` — help create a standalone AWS account | Explicit client-owned-new choice; no Prism provider effect | Guide official AWS signup one screen/decision at a time while AWS directly collects root email, payment, phone verification, captcha, password and MFA. After creation, prepare the non-secret existing-account handoff. | No sensitive value enters chat/evidence and Prism Organizations receives zero calls. The handoff contains account ID, subdomain, region and authorized contact, then follows deployed adoption. |
| `existing-account-adoption` — record a customer-owned AWS account | Authorized `EXISTING_AWS_ACCOUNT` request and deployed adoption provider | Validate the 12-digit ID, uniqueness and requester authorization without changing ownership or organization. Exercise fake success, unauthorized caller, conflicting owner and capability-not-deployed. | Real acceptance requires the deployed adoption path. A fake result or stored ID cannot be reported as live adoption; unsupported adoption fails before partial writes. |
| `access-readiness` — verify Prism service access | AWS account created/recorded and configured cross-account role | Deliver a least-privilege role handshake whose returned identity must equal the recorded account ID. Exercise not-yet-configured trust, wrong-account response, retryable STS failure and success. | Only a successful live handshake marks access ready. Return plain owner/recovery guidance without credentials or raw SDK errors. Do not create customer console assignments. |
| `bootstrap-handoff` — retrieve Environment inputs | Access ready | Deliver authorized, non-secret manifest retrieval. Compare complete/incomplete states and reject another account's caller. Include stable identity/account/access handles needed by Environment, not domains, certificates or install success. | Redacted schema validation passes; secret values are absent. Manifest availability does not mean Environment installed the platform. |
| `offboarding` — disable Account-owned access safely | Existing Account-owned keys/record and explicit authorization | Revoke or retire Account-owned credentials/access and update the record with guarded, idempotent recovery. Keep Environment resources, customer console assignments and customer-owned organization placement outside this workflow. | Fakes prove order, blocked prerequisites and retry behavior. Live account movement/closure stays separately gated and is never implied by disabling a Prism Account. |

Use the [Account contract](../../../build-tenant-account-manager/reference/PRD.md)
and [synthetic fixtures](../../../build-tenant-account-manager/reference/test-data.md).
The map specifies required outcomes, not deployed endpoints. Discover exact routes,
auth, statuses, provider mode and test adapters in the target revision. Exercise
each feature through the Account HTTP API; direct Lambda/workflow calls support
diagnostics. Route missing API behavior to Kangaskhan. A specification, local
fixture, fake provider, synthesis or accepted request does not prove live adoption
or access. Keep live external effects gated and finish with cumulative acceptance.
