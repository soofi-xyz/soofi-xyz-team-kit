---
name: build-tenant-account-manager
description: "Build or maintain the Account HTTP API, identity and key lifecycle, safe AWS account create-or-adopt provisioning, cross-account readiness and bootstrap-manifest handoff. Use Kangaskhan for implementation and Blissey for existing-service configuration."
disable-model-invocation: true
---

# Build Account

Use `kangaskhan`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Account capability map](../guide-product-work/reference/iterations/account.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `blissey` with [configure-account-product](../configure-account-product/SKILL.md)
for account-specific operations through an existing deployment.

## Scope and contract

Read [the Account PRD](reference/PRD.md) for the relevant capability before coding.
Verify the target repository, revision, deployed contract and environment; the PRD
is a blueprint and does not prove shipped behavior. Preserve working caller
contracts and record discrepancies before changing them. Use the existing Account
entity model; do not add competing customer/environment APIs from older designs.

Deliver an HTTP API with authentication, per-account authorization, idempotency,
validated requests, correlated errors and capability discovery. Keep documented
public signup and signed confirmation callbacks explicitly scoped; they do not
permit unauthenticated account administration. Expose submission, status and
results for async work; AWS workflows and CLIs support rather than replace the API.

Own Account identity and confirmation, account/service keys, the backing AWS
account record, explicit create-or-adopt provisioning, Prism cross-account
service-access verification, bootstrap-manifest output and guarded Account
offboarding. Keep these boundaries:

- Environment owns domain and certificate lifecycle, shared routing and initial
  platform installation.
- Access owns IAM Identity Center and customer AWS Console assignments. It is
  currently unassigned; do not fill that gap with temporary IAM users in Account.
- Registeel operates Account registration in Prism Marketplace.
- Connect owns partner credentials.

Do not ask a non-technical person for an AWS profile, role ARN or raw API fields
before explaining three user journeys: Prism creates a managed member account,
Prism uses an existing client-owned account, or the client first creates a new
standalone AWS account outside Prism. A technical operator may select and verify
a profile later for an authorized deployment or inspection.

## Safe create-or-adopt contract

Model provisioning as a discriminated request, never as ambiguous optional
`aws_account_id` behavior:

- `PRISM_MANAGED`: request a new member account in Prism's AWS Organization.
  Require only the Prism Account identity, desired subdomain and explicit
  authorization. Generate the platform-managed AWS root address from immutable
  Account identity; do not ask the customer to supply it. Reject an existing AWS
  account ID.
- `EXISTING_AWS_ACCOUNT`: keep ownership and organization placement unchanged.
  Require a 12-digit AWS account ID and authorization for that exact target.
  Reject create-only fields and never fall back to Organizations account creation.

The new standalone client-owned journey is not a third provider strategy. AWS
signup happens directly between the client and AWS; after signup, continue through
`EXISTING_AWS_ACCOUNT`. Supply only non-secret requirements and configuration
handoff fields. Never collect root passwords, payment details, phone verification,
captcha, MFA codes or recovery links.

Scope idempotency to the Account identity plus strategy. A retry of the same
request may resume or return the original result; a different strategy or AWS
account ID must conflict rather than reuse prior work. Enforce uniqueness so one
AWS account cannot be silently attached to multiple Prism Account identities.

For adoption, verify authorization at the API boundary and prove the configured
cross-account role with `sts:GetCallerIdentity` or an equivalent service-owned
handshake. The returned account must equal the requested 12-digit ID. A valid ID,
stored record, successful synthesis or fake STS response is not live adoption.
Advertise live adoption only when its deployed provider, status/results and
handshake are available; otherwise fail before partial writes with a stable
`CAPABILITY_NOT_DEPLOYED`-style error and a plain recovery message.

## Lifecycle and recovery contract

Represent these milestones independently in read-back:

1. **Account identity** — the Prism identity exists.
2. **Request** — a create/adopt request was accepted and has a stable request ID.
3. **AWS account created or recorded** — Organizations returned a new ID, or an
   existing ID passed record/ownership checks.
4. **Access ready** — Prism assumed the configured service role and verified the
   expected AWS account.
5. **Platform installed** — owned by Environment. Account may report
   `NOT_CHECKED` or an externally sourced Environment result, never infer success.

Each status/result must include a short user-facing message, `next_actor`
(`PRISM`, `CUSTOMER`, `ENVIRONMENT` or `SUPPORT`), a non-secret `next_action`,
whether retrying the same request is safe, and a correlation ID. Distinguish
pending provider work, customer action required, retryable provider failure,
terminal authorization/conflict failure and success. Do not expose SDK exceptions,
credentials, role session data or internal stack details to non-technical users.

## Build each feature piece

1. Select and order capabilities from the map. Include at least four increments
   for a full build; narrow fixes select only their relevant pieces. Bring the
   minimal HTTP handler, diagnostics and authorized test deployment into the
   first usable path; do not finish every internal module before the user tries it.
2. Use [conversational test data and dependency fakes](reference/test-data.md).
   Explain the selected create/adopt path, then implement it with request and
   authorization checks plus observable milestone transitions. Keep real
   Organizations, STS/IAM trust changes, mail, key changes and account
   closure/movement out of fake acceptance.
3. Test the baseline and supported variant, invalid/unauthorized input, duplicate
   and conflicting strategy, provider pending/failure, role-not-ready, retry and
   recovery behavior inside the piece. Verify effects, idempotency and redaction,
   not just HTTP status. Assert fake provider call counts and read back results.
4. Have the user invoke the increment through the API. Provide actual account,
   region, resource names and at most three AWS inspection steps. Wait for their
   request ID and observation before implementing the next piece. Fix and repeat
   the current check if its evidence disagrees with the expected result.
5. Rerun cumulative acceptance for selected features, then use authorized real
   dependencies only where requested. Real provider adapters must be gated off by
   default and require explicit deployment configuration plus authorization for
   the exact target/effect. Discover controls from the target repository; a
   reference command is not permission to create, invite, move or close accounts.
   Keep the gate closed in this plugin-kit work.

Return changes, API/configuration examples, automated and human evidence,
mock-versus-live results, cleanup and the next checkpoint. Keep reusable product
code in its target repository; this kit contains instructions and test inputs.
