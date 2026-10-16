# Connect — blocks

A flow is built from three layers. Keep each concern in its layer:

| Layer | Holds | Never holds |
| --- | --- | --- |
| **Verb** (`ResourceDefinition.Type`) | The action: list, fetch, call, wait | Provider names, formats, hosts, credentials |
| **Connection type** (driver) | How one kind of system is reached and authenticated | Business rules, tenant parameters |
| **Option** | Behavior shared by several verbs: matching, ledger, pagination, files, retries | Anything specific to one partner |

Partner-specific values live in the partner configuration and reach the flow as
`$.partner.*` or connection aliases. Structural authority for everything below is
[`contracts/flow.schema.json`](contracts/flow.schema.json).

## 1. State model

Every state reads inputs by JSONPath and writes outputs by name. The compiler
reserves these roots:

| Root | Content |
| --- | --- |
| `$.request` | Caller payload, validated against the flow's `parameters` schema |
| `$.partner` | Resolved partner parameters (never secret values) |
| `$.trigger` | Trigger facts: schedule time, drop-zone file, webhook event batch |
| `$.job` | `job_id`, `transaction_id`, `started_at`, flow version |
| `$.vars` | Values written by `Extract.Save` and `SaveOutputTo` |
| `$.item`, `$.index` | Current element inside a `Map` |

Authors must not write to `$.request`, `$.partner`, `$.trigger` or `$.job`.
`SaveOutputTo` must start with `$.vars.`.

## 2. Verbs

### File-store verbs

Valid on `sftp`, `azure_blob`, `s3` and `drop_zone` connections. The driver
declares which verbs it supports (§3); the compiler rejects the rest.

| Verb | Required | Optional | Output |
| --- | --- | --- | --- |
| `LIST` | `Connection` | `Match`, `Ledger`, `MaxItems` | Array of `FileRef` (source path, size, etag, modified time) |
| `FETCH` | `Connection`, `Path` or `File` | `Verify` (size, checksum), `Decode`, `Runner` | Landed `FileRef` in the Connect bucket |
| `PUT` | `Connection`, `From`, `Path` | `Overwrite` (`never` \| `always` \| `if_changed`), `Encrypt` | Remote `FileRef` |
| `MOVE` | `Connection`, `Path` or `File`, `To` | `IfExists` (`skip` \| `fail` \| `overwrite`) | Remote `FileRef` |
| `DELETE` | `Connection`, `Path` or `File` | — | Deleted path. Requires `allow_delete: true` on the partner configuration |

### API verbs

Valid on `http` connections.

| Verb | Required | Optional | Output |
| --- | --- | --- | --- |
| `CALL` | `Connection`, `Method`, `Path` | `PathParameters`, `Query`, `Headers`, `Body`, `Subject`, `RequestFormat` (`json` \| `xml` \| `form` \| `multipart` \| `base64` \| `binary`), `Response`, `Paginate`, `Idempotency`, `Extract`, `AcceptStatus` | Parsed body inline, or a landed `FileRef` |
| `POLL` | `Call` (a `CALL` definition), `Until` (Choice rule) | `IntervalSeconds`, `Backoff` (`linear` \| `exponential`), `MaxAttempts` | Final `CALL` output |
| `WAIT_FOR_WEBHOOK` | `Webhook` (declared on the flow), `Correlate` (`ValuePath`, `ExpectedPath`) | `Conditions`, `TimeoutSeconds`, `EarlyArrival` (`reject` \| `buffer`), `SaveResponseToFile` | Webhook body inline or as `FileRef` |

`Path` placeholders take their values from `PathParameters`. `{name}` is one
segment: the value is URL-encoded, so a `/` becomes `%2F`. `{+name}` (RFC 6570
reserved expansion, restricted to `/`; Connect main, PR #26) spans several
segments: the value is split on `/`, each segment is URL-encoded and the
slashes are kept, so a resource name such as
`conferenceRecords/c1/transcripts/t1` fills `/v2/{+name}/entries`. An empty
value, or a `{+name}` value with an empty, `.` or `..` segment (including a
leading or trailing `/`), fails with `ValidationFailed` before any request.
Pin the shape of a `{+name}` value in the flow's `parameters` schema.

`Subject` (a value or JSONPath, often `$.request.user`) is the user an
`oauth2_jwt_bearer` connection acts as for that call; it overrides the
connection's `auth.subject`. `POLL` inherits it from its `Call`. Connect does
not restrict which subject a job may name: pin the allowed users in the flow's
`parameters` schema ([flow-spec.md](flow-spec.md) §1).

`Response` has `Format` (`json` \| `xml` \| `text` \| `binary`), `Mode`
(`inline` \| `file`), `MaxInlineBytes`, and `DecodePath` + `Decode` for bodies
that embed base64 content. `Mode: inline` requires `MaxInlineBytes` within the
Step Functions payload limit; otherwise the compiler forces `file`.

### Transport-encoding verbs

| Verb | Required | Output |
| --- | --- | --- |
| `DECRYPT` | `File`, `Format` (`pgp`), `Key` (reference to a partner-configuration key) | Landed plaintext `FileRef` |
| `DECODE` | `File`, `Format` (`base64` \| `gzip`) | Landed decoded `FileRef` |

Decryption belongs to Connect because it is part of the partner's transfer
contract. Unpacking business archives (ZIP/TAR of documents) belongs to the
product.

### Control states

Native ASL `Choice`, `Wait`, `Pass`, `Fail` stay intact. `Map` is open:

- `Items` is a JSONPath array or `ItemsFrom` a landed `FileRef` with
  `Format` (`json_array` \| `jsonl` \| `csv`);
- the body is any flow definition: several states, any verb, nested `Choice`;
- `Concurrency` is required; the compiler switches to Distributed Map when
  `ItemsFrom` is a file or the declared `MaxItems` exceeds the inline limit;
- a per-item failure is recorded in the result manifest and does not fail the
  job unless `FailOnItemError: true`.

## 3. Connection types (drivers)

| Type | Location fields | Auth profiles | Verbs | Notes |
| --- | --- | --- | --- | --- |
| `http` | `base_url` | `none`, `basic`, `api_key`, `bearer`, `oauth2_client_credentials`, `oauth2_refresh_token`, `oauth2_jwt_bearer`, `token_call`, `client_certificate` | `CALL`, `POLL`, `WAIT_FOR_WEBHOOK` | `egress: default \| static_ip`. Inline calls compile to native HTTP Tasks with an EventBridge Connection |
| `sftp` | `host`, `port`, `root`, `host_key_fingerprint` | `password`, `private_key` | `LIST`, `FETCH`, `PUT`, `MOVE`, `DELETE` | Runs through AWS Transfer Family connectors; no SSH client in Lambda |
| `azure_blob` | `account_url`, `containers` (name or `*` with `exclude`), `root` | `connection_string`, `sas` | `LIST`, `FETCH`, `PUT`, `MOVE`, `DELETE` | Streams to S3; `*` treats each container as a tenant path segment |
| `s3` | `bucket`, `root`, `region` | `assume_role` (`role_arn`, `external_id`) | `LIST`, `FETCH`, `PUT`, `MOVE`, `DELETE` | For partner-owned buckets. `MOVE` is copy + delete and is declared non-atomic |
| `drop_zone` | Connect-owned bucket prefix per partner | Partner write principal or presigned upload | `LIST`, `FETCH`, `MOVE` | Object-created events start activations |

Every driver implements `validate`, `describeCapabilities`, `list`,
`fetchToS3` (streaming, checksum), `put`, `move`, `delete` as applicable, and
passes the driver conformance suite in [verification.md](verification.md).
Capabilities include atomic move, etag availability, server-side copy and
maximum object size; the compiler checks verbs and options against them.

Auth names a Connect credential (`auth.credential`); its values are set only
through the credentials API ([architecture.md](architecture.md) §7). Flows never
name a credential.

### Renewing HTTP tokens

Two `http` auth profiles obtain a short-lived access token before each call and
renew it themselves (implemented in Connect main, PR #29):

| Profile | Credential keys | Connection settings | Token request |
| --- | --- | --- | --- |
| `oauth2_refresh_token` | `client_id`, `client_secret`, `refresh_token` | `token_url` (required), optional `scopes` | `grant_type=refresh_token` with the client id and secret in the form |
| `oauth2_jwt_bearer` | `client_email`, `private_key` (PKCS#8 PEM), optional `private_key_id` | `token_url` (required), optional `scopes` (JWT `scope`), `subject` (JWT `sub`), `audience` (JWT `aud`, defaults to `token_url`) | RS256 assertion (`kid` = `private_key_id`, lifetime 1 h) posted as `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` |

- Use `oauth2_refresh_token` when one user granted access once (delegated
  sign-in). For Google, leave `scopes` off: the refresh token already carries
  the granted scopes.
- Use `oauth2_jwt_bearer` for a service account. For Google, the credential
  keys are the same names as in the service-account key file, `token_url` is
  `https://oauth2.googleapis.com/token`, and `subject` names the user to act as
  through domain-wide delegation.
- The driver reads the token at `$.access_token` and caches it per subject
  (one entry when no subject applies) until 60 s before `expires_in`;
  concurrent calls share one in-flight token request. The cache lives in one
  worker invocation, so each worker task fetches its own token.
- A rejected token request fails with `AuthFailed` (not retryable), carrying
  only the HTTP status and a standard OAuth error code such as
  `invalid_grant`. Key material, assertions and tokens never appear in errors
  or logs.
- A rotated `refresh_token` or key applies to the next call once the
  credential cache (60 s) expires.

## 4. Shared options

| Option | Applies to | Contract |
| --- | --- | --- |
| `Match` | `LIST` | `Prefix`, `Pattern` (glob), `ModifiedSince` (JSONPath, usually `$.partner.cutoff`), `Exclude` |
| `Ledger` | `LIST`, drop-zone and webhook triggers | `Key` (fields of the item, e.g. `path`, `etag`, `size`), `Scope` (default partner + flow), `LeaseSeconds`. Claims on list, commits when the item's branch succeeds, releases on failure. `replay` on the job request re-admits named items |
| `Paginate` | `CALL` | `Style` (`cursor` \| `next_link` \| `offset` \| `page`), the request field and response path for each, `MaxPages`, `Collect` (`inline` \| `file`) |
| `Idempotency` | `CALL`, `PUT` | `KeyPath`, `Header`; the compiler derives a stable key from job and item when absent |
| `Extract` | Any verb with output | `Save: {name: JSONPath}` into `$.vars` |
| `SaveResponseToFile` | `CALL`, `WAIT_FOR_WEBHOOK` | Land the body in S3 and return a `FileRef` |
| `Runner` | `FETCH`, `PUT`, `DECRYPT`, `DECODE` | `auto` \| `lambda` \| `container`. `auto` picks a container task when declared size or time exceeds Lambda limits |
| `Retry` / `Catch` | Any task | Merged after compiler defaults; flow-wide defaults in `delivery_settings` |

## 5. Rules that keep blocks abstract

1. Name verbs for actions. Never create a verb named for a provider, content
   type or partner (`AZURE_BLOB_LIST`, `GET_XML`, `QUIQ_EVENTS`).
2. Put provider specifics in a connection type, tenant specifics in a partner
   configuration, and shared behavior in an option.
3. A new partner of a known kind is configuration only. A new storage or auth
   kind is one driver or auth profile, and every existing flow gains it.
4. Add a verb only when at least two use cases need it and it cannot be
   composed from existing verbs, options and control states. Record the
   evidence in the change.
5. Reject product logic in Connect: business layout parsing, classification,
   graph writes, event publication, internal service calls.
6. Do not add a general `CODE` verb. If a partner quirk cannot be expressed,
   stop and ask whether to add an option, an auth profile or a driver.
7. Keep option names identical across verbs that share them.

## 6. Legacy task types

Accept Connect service / Staircase task types as aliases so existing flows keep
compiling. Rewrite them before expansion and store the canonical form.

| Legacy type | Canonical form |
| --- | --- |
| `GET_JSON`, `POST_JSON`, `PUT_JSON`, `DELETE_JSON`, `HTTP_JSON` | `CALL` with `Method`, `RequestFormat: json`, `Response.Format: json` |
| `GET_XML`, `POST_XML`, `DELETE_XML`, `HTTP_XML` | `CALL` with `Format: xml` |
| `HTTP_ANY` | `CALL` with `Response.Format: binary` |
| `POST_FORM_URL_ENCODED`, `POST/PUT_MULTIPART`, `POST/PUT_BLOB`, `POST_BASE64` | `CALL` with the matching `RequestFormat` |
| `*_WITH_EIP` | Same `CALL` on a connection with `egress: static_ip` |
| `GET_FILE` | `CALL` with `Response.Mode: file` |
| `SFTP` inbound / outbound | `LIST` + `FETCH` / `PUT` on an `sftp` connection |
| `PROGRESSIVE_WAITING` + `Wait` + `Choice` | `POLL` |
| `WEBHOOK_REFERENCE` / `WAIT_FOR_WEBHOOK` v2 | `WAIT_FOR_WEBHOOK` |
| `TOKEN_MANAGEMENT_GET/SET`, `GET_TOKEN`, `SET_TOKEN` | `token_call` auth profile on the connection |
| Flow-level `authorization` | Auth profile on the flow's single `http` connection |

`WIDGET`, `LINK_TRANSFORMATION` and `FAKE_RANGE_CREATOR` stay available as
compatibility types from the Connect service PRD. Do not use them in new flows
without a use case that needs end-user widgets or proxy links.
