---
name: configure-access-product
description: "Set up and test Google sign-in, registered applications, users, roles, service identities and grants on resources and records through an existing Access API. Use Doublade; route missing service behavior to Aegislash."
---

# Configure Access

Use `doublade`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Access capability map](../guide-product-work/reference/iterations/access.md).
Read the relevant sections of [the Access build contract](../build-access-product/SKILL.md)
for the token, permission and record-access rules.

Access is configured through its HTTP API on `https://<shared domain>/access`.
Discover the deployed routes, claims and capabilities from the target revision's
API description before calling anything. This skill names outcomes, not routes;
a capability in the map is not evidence that it is deployed. Route a missing or
defective capability to `aegislash` with a redacted reproducer and continue with
independent configuration.

## Before the first call

1. Confirm which environment this is and that the person is authorized to
   administer its users. One environment is one company; never configure one
   environment's users or roles from another's values.
2. Explain the outcome in plain language first: who will be able to sign in,
   what each role will allow, and who will see which resource or records. Ask
   for technical values only after the person agrees with that outcome.
3. Check that the base URL and the administrator credential are available to the
   agent without printing either. Never ask the person to paste a key, token,
   client secret or password into chat.

## Lanes

| Lane | Do | Read back |
| --- | --- | --- |
| Google sign-in | Guide the operator through creating the sign-in client in the company's own Google console, then register it with Access. Sign-in is open to any verified Google account; set allowed domains only if the operator wants to restrict it. | Provider status without the secret; one successful test sign-in with a personal account; with a restriction set, one successful company account and one rejected outside-domain account. |
| Application | Register the application with its exact redirect and sign-out addresses. Put it in the configuration-bundle repository once the deployment supports the `access` `application` kind. | The stored addresses; a rejected sign-in start for an unregistered address. |
| Users | Invite people with an initial role; disable or remove on request. | User status, role and the audit record. Confirm the user's record appears in Persist. |
| Roles | Define roles from the resource types and actions each product declares; assign them. Start from the smallest role that does the job. | The role definition and a fresh token's roles for one assigned user. |
| Resource grant | Share one named resource, such as a Connect credential, with a user or role; revoke on request. Act for whoever may share it: the owner for a personal resource, an administrator for an environment-owned one. For a Connect credential: confirm its owner from Connect's metadata, have that owner (signed in) grant `use` on the named credential to the person or role, then have the recipient start the flow. | The grant list and audit record. The recipient's flow runs after the grant and is refused after revoking; an administrator's attempt to use or share a personal credential is refused. |
| Record access | Connect a user or a role to the anchor records they should read. | With two test users, Persist's GraphQL and its search return the connected records to one and nothing to the other; repeat after revoking. |
| Service identity | Create a named caller for one product-to-product path with only the actions it needs; rotate on request. | Metadata only. The secret is delivered once to the operator, never to chat or evidence. |

In every lane exercise a baseline, a materially different supported setup, and
an invalid or unauthorized request. Treat each product API read-back as the
inspection checkpoint.

## Rules

- Never remove or demote the last administrator, and never widen a role to make
  a test pass. Report the missing action instead.
- Grant record access only through the Access API. Do not write user or access
  edges into Persist directly.
- Do not hand the environment's shared key to an application that runs in a
  browser or on a user's device. Those use tokens.
- A product that does not yet enforce Access cannot separate users. Say so, name
  that product's builder, and do not present Access setup as enforcement.
- For applications in a bundle, follow [the configuration-bundle handoff](../build-product-deployer/reference/configuration-bundles.md#target-api-and-authoring-handoffs).
  Use direct API writes for testing only and remove them afterwards. Roles,
  users and grants are API-only.
- Remove test users, invitations, applications, grants and service identities
  when the check is done, and say what was removed.

## Return

Return the lane, the Access revision and capabilities checked, what was
configured (identifiers and role names, no secrets), each read-back and negative
result, the person's observations, cleanup, gaps handed to `aegislash` or to
another product's builder, and what still depends on the environment key.
