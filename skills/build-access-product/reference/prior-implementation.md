# Lessons from the earlier sign-in service

An earlier Access service wrapped one managed user directory per environment
behind a REST API of about fifty functions. It covered sign-in only. Use it as a
catalogue of flows and of mistakes; do not port its code.

## What it did

| Capability | Behavior | Decision |
| --- | --- | --- |
| Email and password | Registration, emailed confirmation link, sign-in, refresh, change and reset password, sign-out | Remove; sign-in is Google only unless the user asks otherwise |
| Federated sign-in | Four consumer identity providers, one configuration per environment, accounts linked by email | Keep Google only |
| Applications | An application was a directory client with one redirect and one sign-out address; the service hosted the callback | Keep the concept; match addresses exactly |
| Invitations | A stored one-time code; an invited person was confirmed automatically | Keep; bind the invitation to an email and an initial role |
| Users | List, read, delete, and profile lookup by token | Keep; require an administrator permission |
| Token check | An endpoint that asked the directory about the token on every call | Replace with offline verification |
| Authorization | Three fixed groups: administrator, confirmed, unconfirmed | Replace with roles and grants in the permission store |
| Person record at sign-up | A record for each user was looked up and created in the graph data service inside the sign-up step, so a data-service failure broke registration | Keep the record; publish it after sign-in, asynchronously, with retry |
| Company grouping | A "company" record derived from the email's domain | Remove; an environment is the company |
| Sign-in address | A separate sign-in domain per environment, plus per-customer-domain callback registration | Remove; serve sign-in on the shared domain |
| Platform plumbing | Usage metrics, a daily chat digest, per-brand email templates | Remove |

## Defects to avoid

Each of these was present in deployed code. Treat each as a required negative test.

1. **Test bypass in production.** Handlers returned a success response when the
   request's user agent named a test tool. The token check answered "valid" for
   any such request.
2. **Unverified tokens.** Claims were read with signature verification turned
   off, and validity was delegated to a network call.
3. **Fail-open check.** The token check treated every response other than two
   specific rejections as valid, including server errors.
4. **Unprotected administration.** Listing and deleting users required neither a
   key nor a token. An authorizer was defined and attached to no route.
5. **Credentials in logs.** Sign-in and registration logged the whole request,
   including the password.
6. **Tokens in URLs.** The callback returned access, identity and refresh tokens
   in the redirect address.
7. **Long-lived, weakly bound sessions.** Day-long access tokens, the implicit
   flow enabled, cross-site cookies, no second factor.
8. **Lookup by scan.** Every request listed all applications to find one by
   name, and callback registration slept between updates to avoid throttling.
   Store the application-to-client mapping and read it by key.
9. **Email as identity.** Users were found by filtering on email. Use the stable
   user identifier.
10. **Sign-up coupled to another service.** Registration called the data service
    inline. Publish user records after the fact; sign-in must succeed without it.

## What it never had

Roles, grants on a specific resource, a connection between a user and the
records they may read, service identities, an audit trail, and any way for
another product to tell two users apart. These are the new work, described in
[the build contract](../SKILL.md).
