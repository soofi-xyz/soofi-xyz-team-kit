# Google sign-in for a production environment

The steps an operator takes in Google Cloud and in Access so that people sign in
to an environment with Google. The operator does every step that touches a
secret. The agent explains each step, checks the read-backs and never sees the
client secret.

Access asks Google for `openid email profile` and nothing else. It returns
people to one address: `https://<shared domain>/access/sign-in/callback`.

## Before you start

- The operator has the Owner or OAuth Config Editor role on a Google Cloud
  project in the company's own Google organization, not a personal account.
  Give the project at least two owners, so one person leaving does not lock the
  company out.
- Use one Google Cloud project, and one sign-in client, per environment. Never
  share a client between a test and a production environment.
- Check that the environment uses Google: `GET /access/capabilities` shows
  `identity_provider.issuer` as `https://accounts.google.com` and no
  `test: true`. The issuer is fixed at install from the SSM parameter
  `/access/identity-provider`; if it names a test issuer, remove the parameter
  and install Access again before anyone real signs in.
- The company controls the domain the shared domain sits under, and can prove
  it in Google Search Console. Brand verification (step 4) needs it.

## 1. Branding

In Google Cloud console → **Google Auth Platform → Branding**:

- App name: what people see, such as `Example Co`.
- User support email: a group mailbox, not one person's.
- App home page, privacy policy and terms of service: pages on the company's
  own domain.
- Authorized domains: the company's registrable domain, such as `example.com`
  for `account.example.com`.
- Developer contact: a group mailbox.

## 2. Audience

**Google Auth Platform → Audience**:

- **User type: External.** Access lets any verified Google account sign in and
  restricts with allowed domains (step 6). Choose **Internal** only when every
  person is in one Google Workspace organization and this project belongs to it.
  Internal refuses everyone else at Google, before Access sees them.
- **Publishing status: In production** (**Publish app**). In Testing, Google
  shows a warning that the app is being tested. Only listed test users (at most
  100) can sign in when an app asks for more than `openid email profile`.

## 3. Data access

**Google Auth Platform → Data Access**: keep only `openid`, `.../auth/userinfo.email`
and `.../auth/userinfo.profile`. They are non-sensitive, so no app verification
is needed. Adding any other scope brings verification and is never needed by
Access.

## 4. Brand verification

An External app in production shows its name and logo on Google's consent
screen only after brand verification. Submit it from **Verification Center**.
Google checks that the home page and privacy policy are on a domain the company
has verified in Search Console. It usually takes a few business days. Sign-in
works while it is pending, without the name and logo.

## 5. The client

**Google Auth Platform → Clients → Create client**:

- Application type: **Web application**.
- Name: `Access <environment>`, such as `Access production`.
- Authorized JavaScript origins: none. Access exchanges Google's code on its
  server.
- Authorized redirect URIs: exactly `https://<shared domain>/access/sign-in/callback`,
  with no trailing slash and nothing else.

Google shows the client secret **once**, when the client is created. The
operator keeps the dialog open and goes straight to step 6, then closes it.
Never paste the secret into chat, a ticket, a file or a shell command line.

## 6. Register it with Access

The operator runs this with the environment key. The secret is read from a
silent prompt, so it is not in the shell history or the process list:

```bash
read -rs GOOGLE_CLIENT_SECRET
curl -sS -X PUT "https://$SHARED_DOMAIN/access/identity-provider" \
  -H "x-api-key: $ACCESS_API_KEY" -H 'content-type: application/json' \
  --data-binary @- <<EOF
{"client_id": "1234-abc.apps.googleusercontent.com",
 "client_secret": "$GOOGLE_CLIENT_SECRET",
 "allowed_domains": ["example.com"]}
EOF
unset GOOGLE_CLIENT_SECRET
```

- `allowed_domains` is optional. Absent or empty, any verified Google account
  may sign in. Set, only accounts whose Google hosted-domain (`hd`) claim is
  listed may sign in: Google Workspace and Cloud Identity accounts. Personal
  `gmail.com` accounts have no hosted domain, so any restriction refuses all of
  them. At most 20 lower-case domains.
- A restriction also ends existing sessions and refresh tokens of accounts it
  now refuses.
- `PUT` replaces the whole setting. Send `allowed_domains` again on every
  change, or the restriction is removed.

Read it back: `GET /access/identity-provider` shows `configured: true`, the
client id and the allowed domains, and never the secret. The change is audited.

## 7. Check it

Register a test application first (the application lane). Then:

1. Sign in with a company account: it works, and a user with no role appears in
   `GET /access/users`.
2. Without a restriction, sign in with a personal Google account: it works.
3. With a restriction, sign in with an account from another domain: Access
   refuses it at the callback, and no user is created.
4. Ask the person whether Google's consent screen shows the company's name.
   Without brand verification it does not; that is the only difference.

Remove the test application and any test users when done.

## Rotating the client secret

1. **Clients →** the client → **Add secret**. The old secret keeps working.
2. Run step 6 with the same `client_id`, the new secret and the same
   `allowed_domains`.
3. Sign in once to check it.
4. In Google, disable the old secret, then delete it.

Rotate when someone who saw a secret leaves, after any suspected leak, and on
the company's schedule.

## When it fails

| What the person sees | Cause | Fix |
| --- | --- | --- |
| Google: `Error 400: redirect_uri_mismatch` | The client's redirect URI differs from `https://<shared domain>/access/sign-in/callback` | Correct the URI exactly, including the scheme and no trailing slash |
| Google: `Access blocked: … has not completed the Google verification process` | Extra scopes, or Testing with an account not on the test user list | Keep only the three scopes; publish the app |
| Google: the app is restricted to users within its organization | User type is Internal | Change to External, or sign in with an account from that organization |
| Access refuses at the callback | The account's domain is not in `allowed_domains`, or its email is not verified | Add the domain, or use a verified account |
| Every sign-in fails after a change | A wrong secret was registered | Run step 6 again with the right secret |
