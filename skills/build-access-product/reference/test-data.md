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
- The issuer is fixed when the environment is installed and cannot be changed
  through the Access API, even with the environment key. Only an environment
  installed as a test environment may name the fake issuer; every other
  install uses Google's. Capability discovery reports the issuer; checks
  `SI-15`, `SI-18` and `SI-19` prove these rules.
- A second fake issuer, `rogue`, has its own keys and is never configured. It
  can present any subject and claims, and must never sign anyone in.

One human check (`SI-H1`) uses real Google. Nothing else does.

## People

Sign-in in the test environment is open (no allowed domains). `SI-6`
restricts it to `access-test.example` for its run and then removes the
restriction. Every person below has a verified email except `unverified`.

| Key | Email | Hosted-domain claim | Role once `permissions` is done | Used as |
| --- | --- | --- | --- | --- |
| `admin` | `admin@access-test.example` | `access-test.example` | `administrator` | Made an administrator by the environment key in `PM-1` |
| `alice` | `alice@access-test.example` | `access-test.example` | `member` | Owner of `item-1` and `secret-a`; connected to `scope-a` |
| `bob` | `bob@access-test.example` | `access-test.example` | `member` | Same role as alice, owns `item-2`, connected to nothing |
| `carol` | `carol@access-test.example` | `access-test.example` | `viewer` | Invited without a role, assigned `viewer` later; member of `group-g` |
| `dave` | `dave@access-test.example` | `access-test.example` | none | Disabled during the run |
| `erin` | `erin@access-test.example` | `access-test.example` | none | Signs in without an invitation and never gets a role |
| `frank` | `frank@access-test.example` | `access-test.example` | `viewer` | Invited with a role |
| `grace` | `grace@access-test.example` | `access-test.example` | none | Invited with a role on an already expired invitation |
| `personal` | `someone@personal-mail.example` | absent | none | A personal account; signs in with no role, and is refused while sign-in is restricted |
| `outsider` | `eve@other-company.example` | `other-company.example` | none | Another company; refused while sign-in is restricted to `access-test.example` |
| `spoof` | `mallory@access-test.example` | absent | none | Right email suffix, no hosted-domain claim; refused while sign-in is restricted |
| `unverified` | `uma@personal-mail.example` | absent | none | Email not verified by the provider; always refused |

Until `permissions` is done nobody has a role, and administrative calls use the
environment key.

Give each person a distinct, stable subject at the fake provider. Access must
identify them by its own stable user identifier, never by email.

## Applications

| Name | Redirect addresses | Sign-out addresses |
| --- | --- | --- |
| `app-one` | `https://app-one.access-test.example/callback` | `https://app-one.access-test.example/signed-out` |
| `app-two` | `https://app-two.access-test.example/callback`, `https://app-two.access-test.example/alt-callback` | `https://app-two.access-test.example/signed-out` |
| `app-direct` | `https://app-direct.access-test.example/callback` | `https://app-direct.access-test.example/signed-out` |

All three are address sets on the environment's one sign-in client. Signing in
through any of them yields a token with the same audience.
`app-direct` is registered by a direct API call and is never part of a bundle.
Addresses that must be refused for `app-one`: the registered address with
`/extra` appended, with a trailing slash, with an added query string, with
`http` in place of `https`, and with the host in another letter case plus a
different path.

## Roles and a fixture product

Permission checks use a fixture product so they do not depend on another
product being deployed.

- Product `fixture` declares the resource type `fixture:item` with actions
  `read`, `use` and `manage` on one item, and the type-level action `create`,
  which applies to the type and not to any one item. Its shareable actions are
  `read` and `use`.
- `administrator` may perform every action.
- `member` may `create` a `fixture:item` and `read` any of them.
- `viewer` may perform no action on its own; it receives one role grant in
  the sharing checks.
- `fixture:destroy` is an undeclared action and must be rejected.

Resources: `fixture:item/item-1` owned by `alice`; `fixture:item/item-2` owned
by `bob`.

The fixture product also declares `fixture:secret`, **private to its owner**,
with actions `use`, `manage` and `remove`. Its only shareable action is `use`. Resources: `fixture:secret/secret-a`
owned by `alice`; `fixture:secret/secret-env` owned by the environment.

## Service identity

`fixture-service`, allowed `read` on `fixture:item` and nothing else.

## Graph fixture

Record-access checks use a fixture lexicon so they do not depend on the open
Model decisions. These labels are fixtures; never add them to a deployed lexicon.

| Kind | Label | Carries access | Written by |
| --- | --- | --- | --- |
| Record | `fixture_user` | — | Access only |
| Record | `fixture_group` (a published role) | — | Access only |
| Record | `fixture_scope` (the anchor) | — | Ordinary ingest |
| Record | `fixture_item` | — | Ordinary ingest |
| Grant edge | `fixture_can_access` (user or group → scope) | yes | Access only |
| Structural edge | `fixture_contains` (scope → item, that direction only) | yes | Ordinary ingest |
| Ordinary edge | `fixture_related` (item → item) | **no** | Ordinary ingest |

Records and edges:

- `scope-a` contains `item-a1` and `item-a2`. `scope-b` contains `item-b1`.
- `item-a1` is `fixture_related` to `item-b1`. This ordinary edge exists to
  prove it grants nothing.
- `group-g` is the group record Access publishes for the `viewer` role. Nothing
  in the graph says who holds that role: `carol` and `frank` reach it because
  their tokens carry `viewer`. The run loads scopes, items and their
  `fixture_contains` edges with the environment key; Access writes everything
  marked "Access only".
- Each item has a text field. `item-a1` and `item-b1` both contain the phrase
  `quarterly fixture report`, so one search matches both sides. Only `item-a2`
  contains `annual fixture summary`.
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

A deployed run shares its test environment with whatever is already installed
there, such as a registered Console application and other products' service
identities. It never requires the environment to be empty.

- Give every fixture name a suffix unique to the run (people's emails and
  subjects, roles, applications, the service identity, graph record
  identifiers), so a run cannot collide with another run or with leftovers.
  The names in this file are shown without the suffix.
- Start by checking that none of this run's suffixed names exists, and stop if
  one does.
- Fixture people start with no role and no permission. Checks before
  `permissions` rely on that, not on the environment having no administrator.
- Remove everything the run created: users, invitations, applications, roles,
  grants, record connections, service identities and fixture graph records.
  Touch nothing else. A run that cannot clean up reports exactly what remains;
  the next run's fresh suffix is not blocked by it.

Checks about an environment's first or last administrator need an environment
with no other administrator, so they run at the fake level only, on fresh state.
