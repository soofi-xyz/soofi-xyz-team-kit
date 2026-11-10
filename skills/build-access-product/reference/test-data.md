# Access test data

Use this synthetic data for every Access check in
[the verification reference](verification.md) and for the Access checks that
Persist, Connect and Console run. All names are fixtures on reserved example
domains. Never substitute a real person, company domain, credential or record.

## Fake identity provider

Automated checks cannot sign in with real Google accounts. Run them against a
fake identity provider the test controls:

- It is a standards-following sign-in issuer with its own signing keys, an
  authorize endpoint, a token endpoint and published keys.
- The test chooses, per sign-in, the subject, email, verified-email flag and
  hosted-domain claim it returns, and can replay or tamper with a code.
- At the fake level it runs in-process. At the deployed level it runs as a test
  service, and the **test environment's** provider configuration names it as
  the issuer. The Access code path is identical for the fake issuer and Google:
  only the configured issuer and client differ. Add no branch, flag or header
  that changes behavior for tests.
- Capability discovery reports the configured issuer. A non-test environment
  must report Google's issuer; check `SI-11` proves it.

One human check (`SI-H1`) uses real Google. Nothing else does.

## People

The allowed hosted domain for the test environment is `access-test.example`.

| Key | Email | Hosted-domain claim | Role | Used as |
| --- | --- | --- | --- | --- |
| `admin` | `admin@access-test.example` | `access-test.example` | `administrator` | The only administrator at the start of a run |
| `alice` | `alice@access-test.example` | `access-test.example` | `member` | Owner of `item-1`; connected to `scope-a` |
| `bob` | `bob@access-test.example` | `access-test.example` | `member` | Same role as alice, owns nothing, connected to nothing |
| `carol` | `carol@access-test.example` | `access-test.example` | `viewer` (by invitation) | Narrower role; receives a role grant |
| `dave` | `dave@access-test.example` | `access-test.example` | `member` | Disabled during the run |
| `erin` | `erin@access-test.example` | `access-test.example` | none | Signs in without an invitation |
| `personal` | `someone@personal-mail.example` | absent | none | A personal account; must be refused |
| `outsider` | `eve@other-company.example` | `other-company.example` | none | Another company; must be refused |
| `spoof` | `mallory@access-test.example` | absent | none | Right email suffix, no hosted-domain claim; must be refused |

Give each person a distinct, stable subject at the fake provider. Access must
identify them by its own stable user identifier, never by email.

## Applications

| Name | Redirect addresses | Sign-out addresses |
| --- | --- | --- |
| `app-one` | `https://app-one.access-test.example/callback` | `https://app-one.access-test.example/signed-out` |
| `app-two` | `https://app-two.access-test.example/callback`, `https://app-two.access-test.example/alt-callback` | `https://app-two.access-test.example/signed-out` |
| `app-direct` | `https://app-direct.access-test.example/callback` | `https://app-direct.access-test.example/signed-out` |

`app-direct` is registered by a direct API call and is never part of a bundle.
Addresses that must be refused for `app-one`: the registered address with
`/extra` appended, with a trailing slash, with an added query string, with
`http` in place of `https`, and with the host in another letter case plus a
different path.

## Roles and a fixture product

Permission checks use a fixture product so they do not depend on another
product being deployed.

- Product `fixture` declares one resource type, `fixture:item`, with actions
  `read`, `use` and `manage`.
- `administrator` may perform every action.
- `member` may `read` any `fixture:item`.
- `viewer` may perform no action on its own; it receives one role grant in
  the sharing checks.
- `fixture:destroy` is an undeclared action and must be rejected.

Resources: `fixture:item/item-1` owned by `alice`; `fixture:item/item-2` owned
by `bob`.

The fixture product also declares `fixture:secret`, **private to its owner**,
with actions `use`, `manage` and `remove`. Resources: `fixture:secret/secret-a`
owned by `alice`; `fixture:secret/secret-env` owned by the environment.

## Service identity

`fixture-service`, allowed `read` on `fixture:item` and nothing else.

## Graph fixture

Record-access checks use a fixture lexicon so they do not depend on the open
Model decisions. These labels are fixtures; never add them to a deployed lexicon.

| Kind | Label | Carries access |
| --- | --- | --- |
| Record | `fixture_user` | — |
| Record | `fixture_group` | — |
| Record | `fixture_scope` (the anchor) | — |
| Record | `fixture_item` | — |
| Edge | `fixture_member_of` (user → group) | yes |
| Edge | `fixture_can_access` (user or group → scope) | yes |
| Edge | `fixture_contains` (scope → item) | yes |
| Edge | `fixture_related` (item → item) | **no** |

Records and edges:

- `scope-a` contains `item-a1` and `item-a2`. `scope-b` contains `item-b1`.
- `item-a1` is `fixture_related` to `item-b1`. This ordinary edge exists to
  prove it grants nothing.
- `group-g` exists with `carol` as a member.
- Each item has a text field. `item-a1` and `item-b1` both contain the phrase
  `quarterly fixture report`, so one search matches both sides.
- At the start of a run no user is connected to any scope.

## Leak markers

Before a run, generate a fresh random marker and embed it in every secret the
run handles, in the form `LEAKCHECK-<random>-<name>`:

- the provider client secret (`…-client`)
- the service identity's secret (`…-service`)
- an invitation code, if invitations carry one (`…-invite`)

Also record, in memory only, every authorization code, access token, identity
token and refresh token issued during the run. The leak scan in
[verification](verification.md#leak-scan) searches for all of them.

## Cleanup

Every run removes what it created: users, invitations, applications, roles,
grants, record connections, service identities and fixture graph records. A run
that cannot clean up reports exactly what remains.
