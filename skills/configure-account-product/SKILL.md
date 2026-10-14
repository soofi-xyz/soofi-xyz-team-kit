---
name: configure-account-product
description: "Guide and configure a particular Account identity, key lifecycle, AWS account create-or-adopt provisioning and bootstrap handoff through an existing API. Use Blissey; route missing service behavior to Kangaskhan."
---

# Configure Account

Use `blissey`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Account capability map](../guide-product-work/reference/iterations/account.md).
Read the relevant [Account contract](../build-tenant-account-manager/reference/PRD.md)
and [synthetic test data](../build-tenant-account-manager/reference/test-data.md).

## Start with one understandable choice

For onboarding, ask only this first unless the answer is already explicit:

> Which AWS setup do you want?
> - Let Prism create and manage an AWS account for me
> - Use an AWS account the client already owns
> - Help the client create a new AWS account that stays outside Prism

If they are unsure, compare account ownership, payer responsibility and
organization-policy control, then ask them to choose. Do not infer the route from
their email domain, company name or presumed internal/external status.

Do not first ask for an AWS profile, role ARN, region, endpoint, payload or API
key. After the answer, explain the selected route using the literal headings
**Prism does**, **You do**, and **Expect**.

### Prism-managed AWS account

- **Prism does:** create or reuse the Prism Account identity, request a
  Prism-managed AWS Organizations member account, wait for AWS, record its
  12-digit ID, verify Prism's service role and produce the bootstrap manifest.
- **You do:** provide the organization/display name, desired subdomain and
  confirmation that you are authorized to request it. A customer identity may
  separately need a contact email for Prism confirmation; Account generates the
  platform-managed AWS root address. Do not ask for root email or credentials.
- **Expect:** the request may remain pending while AWS creates the account.
  `Access ready` completes Account's work; Environment still owns domains,
  certificates and initial platform installation.

Explain that the new AWS account lives inside Prism's AWS Organization and is
managed under Prism organization policy. Do not imply it is a personal login or
that Account grants customer console access.

### Existing client-owned AWS account

- **Prism does:** keep customer ownership and organization placement unchanged,
  record the account through the deployed adoption operation, verify request
  authorization and test the least-privilege cross-account role.
- **You do:** provide the 12-digit AWS account ID and confirm authorization to
  onboard it. The ID is not a secret, but authorization is still required.
- **Expect:** an accepted ID is not access readiness. If role setup is required,
  provide the deployment's non-secret, tailored instructions after explaining
  why; never request access keys, passwords or session tokens.

### New client-owned AWS account outside Prism

- **Prism does:** guide the official AWS signup, prepare the non-secret onboarding
  checklist and, after creation, continue through the existing-account route.
- **You do:** use a client-controlled unique root email and account name, enter
  payment and phone details directly with AWS, complete root MFA, then provide the
  resulting 12-digit account ID, desired subdomain and authorized contact.
- **Expect:** the client owns and pays AWS directly. Signup alone neither installs
  Prism nor grants Prism access; the deployed adoption provider and cross-account
  role verification are still required.

Guide one signup screen or decision at a time, but have the person complete
passwords, payment, phone verification, captcha, MFA and recovery steps directly
on AWS pages. Never collect or retain those values. After signup, return a
non-secret configuration summary containing account ID, subdomain, operating
region, authorized contact and the cross-account role ARN only when it exists.

For either client-owned route, require evidence that the deployed service supports
**real** adoption, not just a local fake or an optional account-id field. It must
expose authenticated adoption, status/results and a cross-account identity check.
If any part is absent, stop:

> Existing AWS account adoption is not available in this deployment. Nothing was
> adopted or changed.

Record a builder handoff to `kangaskhan`. Do not create a new account, write
storage directly or call STS/IAM outside the Account service as a workaround.

## Configure the verified service

1. After the explanation, discover the existing API, target revision, auth,
   caller/account authorization, capabilities, provider mode and lifecycle state.
   Keep required, implemented and runtime-observed behavior separate. Ask for a
   selected AWS profile only from a technical operator when an authorized
   inspection needs one; do not make a non-technical user choose it.
2. Select only the requested feature pieces. Use the conversational fixtures to
   demonstrate a baseline, materially different supported route and relevant
   invalid/recovery cases inside each piece. A poll or retry is not a new feature.
3. Use only the supported HTTP API for identity, account keys, explicit
   create-or-adopt requests, access-readiness verification, bootstrap-manifest
   retrieval and guarded offboarding. Preserve stable identifiers, ownership,
   authorization and idempotency rules.
4. Use a discovered fake-enabled test deployment before authorized live effects.
   Require the API/read-back evidence to identify fake versus live provider mode.
   Missing safe test behavior is a builder dependency, not permission to call a
   real provider.
5. For each async request, report these milestones separately:
   - **Account identity**
   - **Request**
   - **AWS account created or recorded**
   - **Access ready**
   - **Platform installed** — read only from Environment; never infer it.

   Translate each state into what happened, who acts next, whether retry is safe
   and the next non-secret action. A `202` proves only request acceptance.
6. Give a technical operator one copyable invocation and at most three correlated
   inspection steps only after the plain-language explanation. Have the person
   run the baseline/variant, read back state and return redacted IDs plus their
   observation. Wait for that evidence before advancing.
7. Keep keys, tokens and credentials in the approved local credential store,
   never chat, committed payloads or evidence. Treat real create/adopt, key
   revocation and offboarding as explicit effects authorized for the exact target.
8. Keep boundaries explicit:
   - **Account:** identity, keys, AWS account record/provisioning, Prism
     cross-account service readiness and bootstrap manifest.
   - **Environment:** domains, certificates and initial platform installation.
   - **Access:** IAM Identity Center and customer AWS Console assignments;
     currently unassigned, so report the ownership gap.
   - **Prism Marketplace:** Registeel operates Account catalog registration.

Return configured state, redacted IDs, expected/actual results, user/AWS evidence,
fake/live status, every lifecycle milestone, cleanup and unresolved dependencies.
