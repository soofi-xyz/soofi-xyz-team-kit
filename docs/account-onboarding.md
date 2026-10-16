# Account onboarding

Use **Blissey** (`/blissey`) to start or continue Account onboarding. Blissey
explains the choices, gathers only the information needed for the selected route,
and uses capabilities that are actually available in the target Account service.

Use **Kangaskhan** (`/kangaskhan`) only when Blissey finds missing service
behavior, an unavailable capability or a defect. Kangaskhan builds and fixes
Account; it is not the normal onboarding agent.

## Start with one choice

Blissey's first question is:

> Which AWS setup do you want?
> - Let Prism create and manage an AWS account for me
> - Use an AWS account the client already owns
> - Help the client create a new AWS account that stays outside Prism

If you are unsure, ask Blissey to compare ownership, billing and organization
policy. Blissey will not guess from your email address or company name.

## 1. Prism-managed AWS account

This is the common route when an internal Prism user needs a new account managed
inside Prism's AWS Organization.

- **Prism does:** creates the Prism Account identity, requests the AWS account,
  waits for AWS to return its 12-digit ID, verifies Prism service access and
  prepares a non-secret bootstrap manifest.
- **You do:** provide the organization or display name, desired subdomain and
  confirmation that you are authorized to make the request.
- **Expect:** AWS account creation can remain pending. The account is governed by
  Prism's organization policy; it is not a personal AWS login. Prism access
  readiness does not mean that a customer has Console access or that the platform
  is installed.

You do **not** need to know an AWS profile to begin. If an authorized AWS
inspection is needed later, Blissey will ask a technical operator to select and
verify the appropriate profile.

Copyable prompt:

```text
/blissey Let Prism create and manage an AWS account for us. The display name is
<organization name>, the desired subdomain is <subdomain>, and I confirm that I
am authorized to request it. Start with the plain-language steps; I do not have
an AWS profile selected.
```

## 2. Existing client-owned AWS account (external users)

- **Prism does:** leaves ownership and AWS Organization placement unchanged,
  records the account only through a deployed adoption capability, verifies the
  requester's authorization and tests Prism's least-privilege cross-account role.
- **You do:** provide the 12-digit AWS account ID, desired subdomain and
  confirmation that you are authorized to onboard that exact account. Follow any
  non-secret, deployment-specific role instructions Blissey provides.
- **Expect:** the client continues to own and pay for the account. A valid account
  ID or an accepted request does not prove that Prism has access.

The 12-digit account ID is an identifier, not a secret. Passwords, access keys
and session tokens are never needed in chat.

Copyable prompt:

```text
/blissey Use an AWS account the client already owns. The AWS account ID is
<12-digit account ID>, the desired subdomain is <subdomain>, and I confirm that I
am authorized to onboard this exact account. First verify that live adoption is
available, and do not ask me for AWS credentials.
```

## 3. New client-owned AWS account (external users)

- **Prism does:** guides the official AWS signup one decision at a time, prepares
  the non-secret handoff and then follows the same deployed adoption path used
  for an existing client-owned account.
- **You do:** choose a client-controlled root email and account name, then
  complete signup directly with AWS. After AWS creates the account, give Blissey
  only the non-secret handoff listed below.
- **Expect:** the client owns and pays for the account, and it remains outside
  Prism's AWS Organization. AWS signup alone neither grants Prism access nor
  installs the Prism platform.

Passwords, payment details, phone verification, captcha, recovery steps and MFA
stay directly between the client and AWS. Enter them only on AWS pages. Never
send them to Blissey, Prism or a support handoff.

Copyable prompt:

```text
/blissey Help the client create a new AWS account that stays outside Prism.
Guide us through the official AWS signup one decision at a time and pause for
passwords, payment, phone verification, captcha and MFA to be completed directly
with AWS. Our desired subdomain is <subdomain>, preferred region is <region>, and
authorized contact is <contact>.
```

## What to prepare

Share only the items for your route:

- **Prism-managed:** organization or display name, desired subdomain, and a clear
  confirmation that you are authorized to request the account. A contact email
  may be requested separately for Prism identity confirmation; it is not the AWS
  root address.
- **Existing client-owned:** 12-digit AWS account ID, desired subdomain, and a
  clear confirmation that you are authorized to onboard that exact account.
- **New client-owned:** enter the root email and account name only with AWS.
  After signup, share the resulting 12-digit account ID, desired subdomain,
  preferred operating region, authorized contact, and authorization confirmation.

A cross-account role ARN may be part of the later handoff, but only after a
supported deployment provides role-setup instructions. Do not invent or prepare
one upfront.

Do not share passwords, account or service keys, AWS access keys, secret access
keys, session tokens, payment details, phone codes, captcha answers, MFA codes,
recovery links or confirmation tokens. “Non-secret” does not mean “public”; use
the approved business channel for contact information and identifiers.

## What the milestones mean

- **Request accepted:** Account gave the create or adopt request a stable ID.
  Work may still be pending. Acceptance alone does not prove that an AWS account
  exists or that Prism can access it.
- **AWS account ready:** for a Prism-managed route, AWS returned the new 12-digit
  ID. For a client-owned route, the existing account was recorded after the
  required ownership checks. This milestone is formally “AWS account created or
  recorded”; it still does not prove Prism access.
- **Prism access ready:** Prism successfully used its configured cross-account
  service role and verified that it reached the expected AWS account. This is
  service access, not customer AWS Console access.
- **Platform installed:** Environment separately proved the initial Prism
  installation. Account cannot infer or declare this milestone from account
  creation, adoption, access readiness or manifest generation.

## Who owns what

- **Account:** Prism identity and keys, the backing AWS account record,
  create-or-adopt provisioning, Prism cross-account service readiness and the
  bootstrap manifest.
- **Environment:** domains, certificates, shared routing and initial Prism
  platform installation.
- **Access:** IAM Identity Center and customer AWS Console assignments. Access is
  currently unassigned, so Account cannot promise Console access or create a
  temporary substitute.
- **Prism Marketplace:** Account product and catalog registration. Registeel is
  the Marketplace operator for that work.

## If live adoption is not deployed

The guidance in this repository is not proof that a target deployment supports
live existing-account adoption. Blissey checks for authenticated adoption,
status/results and a live cross-account identity check before changing anything.

If those capabilities are unavailable, expect this result:

> Existing AWS account adoption is not available in this deployment. Nothing was
> adopted or changed.

Blissey will not fall back to creating a Prism-managed account, write directly to
storage or treat a fake test result as live adoption. Keep the non-secret handoff
and send the capability gap to Kangaskhan.

## Troubleshooting and handoff

- If a request is pending, use its existing request ID and follow the reported
  next action. Retry only when the status says it is safe; do not submit a
  different route as a workaround.
- If the AWS account is recorded but Prism access is not ready, follow the
  deployment's non-secret role or trust instructions. Never send credentials.
- If Prism access is ready but the platform is not installed, hand the bootstrap
  manifest to Environment rather than asking Account to install the platform.
- If adoption is unavailable or an Account route is broken, give Kangaskhan the
  selected route, deployment and revision if known, redacted request/correlation
  IDs, current milestone, provider mode (`FAKE` or `LIVE`) and exact sanitized
  error. Include no secrets.

## Optional: operator checklist

Before an API operation, verify the target Account service and revision,
authentication, caller authorization, advertised capabilities, provider mode and
live-effect gates. Use the supported Account HTTP API; do not substitute direct
database, Organizations, IAM, STS or workflow calls.

Start with a fake-enabled test deployment when available. Treat a specification,
local test, synthesis, fake provider, stored account ID or HTTP `202` as evidence
only of what it actually proves—not of live AWS creation, adoption or access.

Ask for an AWS profile only when an authorized inspection or deployment needs
one. Use the already selected profile as `AWS_PROFILE=<selected-profile>`, verify
its account and region, and never hardcode a developer's profile name.

For support evidence, retain only redacted request and correlation IDs, provider
mode, milestone states, next actor/action, retry safety and expected versus
observed behavior.
