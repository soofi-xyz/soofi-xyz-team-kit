# Account conversational test data and dependency fakes

Use these synthetic fixtures with the
[capability map](../../guide-product-work/reference/iterations/account.md).
Map them to the target revision's validated schema; they do not promise route or
payload names. Keep every identifier attached to fake adapters. Never send the
example 12-digit IDs, `.invalid` emails or fixture authorization references to a
live AWS provider.

## Conversation fixture: opening branch

For onboarding, the first user-facing question is:

> Which AWS setup do you want?
> - Let Prism create and manage an AWS account for me
> - Use an AWS account the client already owns
> - Help the client create a new AWS account that stays outside Prism

Assert that the response before this question does not ask for an AWS profile,
region, role ARN, API route, JSON payload, access key, password or token.
For “I am not sure,” assert that the agent compares ownership, payer and
organization-policy control without inferring internal/external status.

## Conversation fixture: no existing AWS account

Expected explanation:

- **Prism does:** creates the Prism Account identity, requests a Prism-managed
  AWS Organizations member account, waits for its ID, verifies Prism service
  access and prepares the bootstrap manifest.
- **You do:** provide only the organization/display name, desired subdomain and
  authorization to request the account. Account generates the platform-managed
  AWS root address; it is not customer input.
- **Expect:** AWS creation may remain pending. Access readiness is not customer
  console access and is not platform installation.

Minimum non-secret input:

```json
{
  "strategy": "PRISM_MANAGED",
  "display_name": "Amber Fixture",
  "subdomain": "amber-fixture",
  "authorization_reference": "fixture-auth-create-a"
}
```

Require an explicit authorized `PRISM_MANAGED` choice before any provider effect.
Test a duplicate request, deterministic root-address reconciliation, Organizations
pending, retryable provider failure and terminal failure. The fixture
`authorization_reference` represents verified caller context; do not add it to a
deployed request body unless that deployment's contract defines it.

## Conversation fixture: existing client-owned AWS account

Expected explanation:

- **Prism does:** leaves customer ownership and organization placement unchanged,
  records the existing account through the deployed adoption capability and
  verifies Prism's least-privilege cross-account role.
- **You do:** provide the 12-digit AWS account ID and confirm authorization.
  Explain that the ID is not secret; never request credentials.
- **Expect:** a valid ID or accepted request is not access readiness. The customer
  may need to configure trust using non-secret instructions from the deployment.

Minimum non-secret input:

```json
{
  "strategy": "EXISTING_AWS_ACCOUNT",
  "aws_account_id": "111122223333",
  "authorization_reference": "fixture-auth-adopt-b"
}
```

Use a second Account identity, caller and fake AWS account ID `444455556666` for
ownership conflicts. Test malformed IDs, unauthorized callers, an ID already
attached elsewhere, unavailable live adoption, role-not-ready, wrong-account STS
identity, transient STS failure and successful access verification. The explicit
unavailable result is:

> Existing AWS account adoption is not available in this deployment. Nothing was
> adopted or changed.

Assert that unavailable adoption performs zero repository, Organizations and STS
write effects and never falls back to `PRISM_MANAGED`.

## Conversation fixture: new client-owned AWS account outside Prism

Expected explanation:

- **Prism does:** guides official AWS signup, prepares the non-secret handoff and
  continues through existing-account adoption after AWS creates the account.
- **You do:** enter client-controlled root email, payment, phone verification,
  captcha, password and MFA directly with AWS; afterward provide only the
  12-digit ID, desired subdomain and authorized contact.
- **Expect:** the client owns and pays AWS directly. Signup does not install Prism
  or grant Prism access.

Assert that the agent advances one signup screen or decision at a time but stops
for every sensitive field and verification. It must never request, echo or retain
payment data, passwords, phone codes, captcha answers, MFA codes or recovery
links. After simulated signup, use this non-secret handoff:

```json
{
  "strategy": "EXISTING_AWS_ACCOUNT",
  "aws_account_id": "777788889999",
  "subdomain": "client-fixture",
  "preferred_region": "us-east-2",
  "authorized_contact": "fixture-contact@example.invalid"
}
```

Then exercise the same capability-not-deployed, authorization, uniqueness,
role-not-ready, wrong-account and success cases as an existing client-owned
account. The agent must not call Prism Organizations `CreateAccount` for this
route.

## Plain-language status fixture

Use an equivalent shape supported by the target contract:

```json
{
  "provider_mode": "FAKE",
  "correlation_id": "fixture-request-001",
  "milestones": {
    "account_identity": "READY",
    "request": "ACCEPTED",
    "aws_account_created_or_recorded": "PENDING",
    "access_ready": "NOT_STARTED",
    "platform_installed": "NOT_CHECKED"
  },
  "message": "Prism accepted the account request and is waiting for AWS.",
  "next_actor": "PRISM",
  "next_action": "No action is needed now. Check this request again later.",
  "retry_safe": true
}
```

Exercise `ACTION_REQUIRED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` and `READY`.
Messages name the outcome and next owner without raw SDK errors. Platform
installation remains `NOT_CHECKED` unless read from Environment; Account never
sets it from manifest creation or cross-account access.

## Fake external effects within each feature

| Dependency | Fake behavior to control | Observable acceptance |
| --- | --- | --- |
| Identity and authorization | Authorized/unauthorized callers, existing identity lookup, confirmation success/expiry/replay | Rejection causes no downstream effect; tokens and personal data stay out of evidence. |
| Organizations account provider | Request/pending/success/failure, duplicate email and stable request token | One authorized `PRISM_MANAGED` request creates at most one fake account; status stays pending until the provider returns an ID. |
| Existing-account adoption provider | Capability unavailable/available, uniqueness conflict and authorization result | Unavailable or unauthorized adoption writes no attachment and never invokes create. Evidence names fake/live mode. |
| Cross-account role verifier | Not ready, access denied, transient failure, expected identity and wrong 12-digit identity | Only an identity equal to the requested account marks access ready. No credentials or session material enters output. |
| Account/service key provider | One-time mint, metadata list, overlap, revocation and injected rotation failure | Plaintext appears only in the approved one-time channel; failed rotation preserves a working old key. |
| Bootstrap manifest builder | Access ready/incomplete/unauthorized and another account's caller | Output contains only stable, non-secret Account/Environment handoff values; no domains, certificates, credentials or install-success claim. |
| Environment status reader | Unknown, pending, ready and unavailable | Account labels this as Environment-owned evidence and never derives platform-installed from Account state. |
| Account offboarding provider | Remaining Account-owned consumers, clean disable, partial failure and replay | Fakes prove order and recovery; no Environment resource, Identity Center assignment, organization movement or account closure occurs. |

Implement these as target-repository dependency adapters and focused tests; this
file does not supply a runtime. Fail closed when the selected fake is unavailable.
Real Organizations, STS/IAM trust mutation, key revocation, account movement or
closure stays behind explicit deployment gates and exact-target authorization.

For every selected feature, record input identity, provider mode, redacted HTTP
result, request/execution ID, milestone changes, expected versus actual effects,
user observation and cleanup. Verify side-effect counts. Never treat a local fake,
deployed fake, synthesis or accepted request as live AWS creation/adoption.
