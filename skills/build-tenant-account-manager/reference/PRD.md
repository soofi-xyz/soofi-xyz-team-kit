# Account implementation contract

Use **Account** as the product identity, Kangaskhan as builder and Blissey as
configurer. Treat this contract as required behavior, not evidence that an API,
provider or deployment exists. Discover the target repository, revision and
deployed capabilities before implementation or invocation.

Account helps a person establish a Prism identity and connect it to one backing
AWS account. It either requests a Prism-managed AWS Organizations member account
or adopts an existing customer-owned AWS account without changing its ownership.
It verifies Prism's cross-account service access and emits the non-secret manifest
Environment needs for setup.

## Product boundaries

Account owns:

- Prism Account identity and confirmation.
- Account/service key lifecycle.
- The backing AWS account record.
- Explicit new-account request or existing-account adoption.
- Verification that Prism can assume its authorized cross-account service role.
- A non-secret bootstrap manifest and guarded Account offboarding.

Account does not own:

- Domains, hosted zones, certificates, shared routing or initial Prism platform
  installation. **Environment** owns these.
- IAM Identity Center, customer AWS Console users, permission sets or account
  assignments. **Access** will own these and is currently unassigned.
- Account product registration in Prism Marketplace. **Registeel** operates that
  catalog registration.
- Product bundle execution, partner credentials or arbitrary tenant-plane
  administration. Those remain with Deploy, Connect and the owning products.

Do not recreate out-of-scope behavior under a convenient Account endpoint. Report
an unassigned Access dependency rather than minting temporary console users.

## Plain-language onboarding

For onboarding, the first user-facing question is:

> Which AWS setup do you want?
> - Let Prism create and manage an AWS account for me
> - Use an AWS account the client already owns
> - Help the client create a new AWS account that stays outside Prism

If the person is unsure, explain ownership, billing and organization-policy
differences, then ask them to choose. Do not infer internal/external status.

Do not begin by asking a non-technical person for an AWS profile, region, role
ARN, endpoint, payload or API key. Explain the selected route using the literal
headings **Prism does**, **You do**, and **Expect**.

### No existing AWS account

- **Prism does:** creates or reuses the Prism Account identity, submits a request
  for a Prism-managed member account in Prism's AWS Organization, monitors AWS
  until a 12-digit ID is available, verifies Prism's service role and prepares
  the bootstrap manifest.
- **You do:** provide only the organization/display name, desired subdomain and
  confirmation that you are authorized to request it. A customer identity may
  separately need a contact email for Prism confirmation; Account generates and
  controls the unique AWS root address.
- **Expect:** account creation can remain pending. The member account is managed
  under Prism organization policy; it is not a personal AWS login. Access ready
  does not mean customer console access or platform installation.

Perform no provider effect until the person explicitly chooses and authorizes the
Prism-managed route.

### Existing AWS account

- **Prism does:** keeps ownership and organization placement unchanged, records
  the account through a deployed adoption capability, verifies the authenticated
  requester's authorization and tests the least-privilege cross-account role.
- **You do:** provide the 12-digit AWS account ID and confirm authorization for
  that exact account. The ID is an identifier, not a secret.
- **Expect:** a valid ID or accepted request is not access readiness. The customer
  may need to configure role trust using non-secret, deployment-specific
  instructions. Prism never needs access keys, passwords or session tokens in chat.

If real adoption, its status/results or its live cross-account handshake is not
deployed, fail before partial writes with this user-facing result:

> Existing AWS account adoption is not available in this deployment. Nothing was
> adopted or changed.

A fake adapter, optional `aws_account_id` field, direct storage write or manual STS
call does not satisfy deployed adoption.

### New client-owned account outside Prism

This is a third onboarding journey but not a third Account provider strategy.
Guide the client through the official AWS signup flow one screen or decision at a
time. The client supplies its own unique root email and account name and enters
payment, phone verification, captcha, password, recovery and MFA information
directly with AWS. Never collect, proxy, log or retain those values.

After AWS creates the account, collect only the resulting 12-digit account ID,
desired subdomain, preferred operating region and authorized contact. Then
continue through the deployed existing-account adoption contract. If live
adoption or its cross-account role setup is unavailable, produce that non-secret
configuration handoff and stop without attaching or changing the account.

Explain that the client owns and pays for the account and that it remains outside
Prism's AWS Organization. Signup alone does not install Prism or grant Prism
access.

## HTTP service contract

Deliver one authenticated HTTP service with:

- Capability discovery that identifies supported create/adopt operations,
  fake/live provider mode and whether live effects are enabled.
- Authorized identity create/read/update/confirmation.
- Authorized account/service key mint/list/revoke/rotate.
- Provisioning submission with an explicit create-or-adopt strategy.
- Provisioning status and terminal result read-back by stable request ID.
- Access-readiness recheck where customer action is required.
- Authorized bootstrap-manifest retrieval.
- Guarded Account offboarding.

Preserve compatible routes in an existing service. The capability groups above
are required outcomes, not permission to invent route names while configuring a
deployment. Direct workflow, Lambda, database and CLI calls support diagnostics;
they do not replace API acceptance.

Authenticate every administrative route and authorize the caller for the Prism
Account identity and exact AWS account effect. Scope public signup/confirmation
routes narrowly. Return a correlation ID on every non-static response. Never put
keys, tokens, credentials or role-session data in errors, logs or status objects.

## Create-or-adopt request

Use a discriminated strategy rather than inferring intent from an optional field:

```ts
type ProvisioningStrategy =
  | {
      kind: "PRISM_MANAGED";
      subdomain: string;
    }
  | {
      kind: "EXISTING_AWS_ACCOUNT";
      subdomain: string;
      aws_account_id: string;
    };
```

Authorization is deployment-specific and must be verified from the authenticated
caller and operator policy. A client-supplied boolean or body field is not proof.
Validate the AWS account ID as exactly 12 digits, but treat syntax only as input
validation.

### Prism-managed create

- Reject an existing AWS account ID and adopt-only fields.
- Submit account creation only to the configured Prism Organizations parent.
- Persist the provider request identity before polling so retries do not submit a
  second account.
- Treat provider pending as pending, not failure or readiness.
- Record the returned 12-digit ID only after Organizations reports success.
- Do not create a member account merely for a smoke test.

### Existing-account adoption

- Reject create-only fields and never fall back to account creation.
- Verify the caller is authorized for the exact target account before attachment.
- Enforce uniqueness so one AWS account cannot be silently attached to multiple
  active Prism Account identities.
- Keep customer ownership and current AWS Organization unchanged.
- Verify the configured cross-account role from Prism's service plane. The
  resulting `GetCallerIdentity` account, or equivalent verified identity, must
  equal the requested 12-digit ID.
- Store no customer AWS credentials. Return tailored non-secret role/trust setup
  instructions only when the deployed service supports that setup contract.

Scope idempotency to the Prism Account identity plus strategy and target. Repeating
the same authorized request returns or resumes its original request. A changed
strategy, subdomain or AWS account ID conflicts instead of reusing earlier work.

## Data and lifecycle

Keep separate records for:

- **Account identity:** stable `account_id`, identity kind/contact fields,
  confirmation state, version and lifecycle timestamps.
- **Account keys:** owning `account_id`, one-way fingerprint, kind, status and
  timestamps. Return plaintext only through the approved one-time channel.
- **Provisioning request:** stable request ID, strategy, idempotency identity,
  provider mode, provider request reference, target AWS account ID when known,
  milestone states, recovery metadata and correlation.
- **AWS account link:** `account_id`, 12-digit AWS account ID, source
  (`PRISM_MANAGED` or `EXISTING_AWS_ACCOUNT`) and cross-account access state.
- **Bootstrap manifest:** stable, non-secret Account and AWS account identifiers,
  verified Prism service-role/access handles and supported Environment handoff
  coordinates. Do not include credentials, domains, certificates or an
  installation-success claim.

Do not place domains, certificate inventory, Identity Center assignments,
temporary console credentials or Environment installation state in Account-owned
records.

## Milestones and recovery

Expose these milestones independently:

1. **Account identity** — the Prism identity exists.
2. **Request** — the create/adopt request was accepted.
3. **AWS account created or recorded** — a new ID was returned or an existing
   account passed record/ownership checks.
4. **Access ready** — Prism verified the configured service role against that ID.
5. **Platform installed** — Environment proved installation. Account reports
   `NOT_CHECKED` unless it is displaying an explicitly sourced Environment result.

Support milestone states equivalent to:

```ts
type MilestoneState =
  | "NOT_STARTED"
  | "PENDING"
  | "ACTION_REQUIRED"
  | "READY"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL"
  | "NOT_CHECKED";

type PlainStatus = {
  correlation_id: string;
  provider_mode: "FAKE" | "LIVE";
  milestones: {
    account_identity: MilestoneState;
    request: MilestoneState;
    aws_account_created_or_recorded: MilestoneState;
    access_ready: MilestoneState;
    platform_installed: MilestoneState;
  };
  message: string;
  next_actor: "PRISM" | "CUSTOMER" | "ENVIRONMENT" | "SUPPORT";
  next_action: string;
  retry_safe: boolean;
};
```

Use plain messages and stable error tags. Distinguish provider work still pending,
customer role/trust action, retryable provider failure, authorization/conflict
failure, unsupported deployed capability and completion. Do not expose raw AWS SDK
exceptions to a non-technical user. Preserve internal diagnostic detail only in
correlated, redacted operator logs.

Retries marked safe must reuse the original idempotency identity. For role-not-ready,
keep the AWS account recorded while access remains action-required. For wrong-account
identity, fail terminally and do not attach or mark access ready. For transient STS
or Organizations errors, preserve completed milestones and retry only the failed
effect.

## Provider architecture and live gates

Define typed interfaces with fake and live bindings for Organizations account
creation, adoption authorization/uniqueness, cross-account role verification,
key providers, manifest construction and Account offboarding.

Use fake providers by default in local and acceptance tests. Evidence must state
provider mode and external-effect counts. Fake account IDs must never reach a live
SDK client. A deployed fake execution proves service behavior only; it does not
prove an AWS account exists or that Prism has access.

Keep live Organizations, STS/IAM trust mutation, key revocation, organization
movement and account closure behind explicit deployment gates that default closed.
Require both:

1. deployment configuration enabling the exact live provider/effect; and
2. authenticated authorization scoped to the exact Account/AWS account target.

Do not let a reference command or successful synthesis enable a live effect.
Account offboarding disables Account-owned keys/access and updates the Account
record. It does not implicitly remove Environment resources, revoke Access-owned
console assignments, move a customer account or close an AWS account.

## Security and secret handling

- Treat a 12-digit AWS account ID, role ARN, request ID and status URL as
  non-secret identifiers, but disclose them only in authorized context.
- Never ask for or log access keys, secret keys, passwords, API key plaintext,
  confirmation tokens, session tokens or bootstrap credentials.
- Keep one-time key material in the approved local secret channel. Persist only a
  one-way fingerprint or encrypted value where the supported contract requires it.
- Redact personal contact data from shared evidence.
- Enforce per-account authorization before reads as well as writes.
- Apply least privilege to the Prism cross-account role and verify the assumed
  identity before any follow-on action.

## Fake-first acceptance

Use [the conversational fixtures](test-data.md). For each selected capability test:

- the baseline and a materially different supported strategy or identity;
- invalid input and an unauthorized caller;
- duplicate submission and changed-strategy conflict;
- pending provider work, retryable failure and terminal failure;
- capability-not-deployed for live existing-account adoption;
- cross-account role not ready, access denied, wrong account and success;
- secret/log redaction and exact external-effect counts.

Follow async runs to terminal state and read back the Account record and result.
Test HTTP behavior and workflow effects together. Local unit tests, synthesis,
deployed fakes and authorized live runs are distinct evidence levels.

Never run a real create/adopt/offboard operation solely to complete acceptance.
When an authorized live exercise is separately requested, verify the target and
gate, then record the provider request, cross-account identity and cleanup without
printing credentials.

## Completion criteria

Account is complete for the scoped capability when:

- Blissey's opening branch can be answered without AWS terminology.
- All three explanations use **Prism does / You do / Expect** and request only minimum
  non-secret inputs.
- Create and adopt are explicit, mutually exclusive and idempotent.
- Real adoption fails clearly and without partial state when not deployed.
- Authorization and exact-account cross-account identity are verified before
  access readiness.
- Status/read-back distinguishes identity, request, account created/recorded,
  access ready and Environment-owned platform installation.
- Every failure provides a plain owner, recovery action and retry safety.
- Fakes cover every external path and live effects remain gated.
- Account stores no Environment domain/certificate/install state and no
  Access-owned console assignment.
- Bootstrap-manifest retrieval is authorized, non-secret and does not claim the
  platform is installed.
