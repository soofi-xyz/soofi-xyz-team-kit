# Connect — architecture

Connect is the only layer that talks to systems outside the company. It hides
each partner's transport, auth, file-drop and callback quirks behind one
declarative flow specification that a compiler turns into AWS Step Functions
state machines, and behind one job API that every product calls the same way.

Adding a partner of a known kind is a configuration release. Adding a new kind
of storage or auth is one driver. Adding a verb is rare and needs evidence.

## 1. Boundary

Connect talks to **external systems only**: partner REST/XML APIs, partner
webhooks, partner SFTP servers, partner Azure Blob containers, partner-owned S3
buckets, and Connect-owned drop zones that partners write into.

Connect does **not**:

- read or write Persist/Neptune, Lexicon, Transform or any product database;
- publish to EventBridge, SNS or product queues, or start product workflows;
- call internal services (Jigglypuff, Filter, Solver and similar);
- parse business layouts, classify documents, run OCR/LLM steps, compute
  offers, or unpack business archives;
- start from internal events. Products call the job API instead.

Its only interface to internal systems is the job contract in §5: a status API,
a reply to the caller's callback, and file pointers in S3. Everything after that
belongs to the calling product.

Treat a vendor-hosted system the company uses (for example Interprose's REST API,
its customer S3 bucket or its source database) as external.

Table ingestion ([table-ingestion/PRD.md](table-ingestion/PRD.md)) is part of
Connect. It reads registered external source tables and files, reads its own
source registrations from Lexicon, and chains its own workflows through
Connect-owned events. Its run ends at `EXTRACTED`; the calling product runs
Transform/Persist and calls Connect's acknowledgement boundary to commit the
checkpoint. Connect never invokes Transform or Persist. Treat a bucket, database or service the
company owns as internal, even when a partner originally produced the data.

## 2. Concepts

| Concept | Meaning |
| --- | --- |
| **Partner** | An external organization or system. Namespace for connections, flows and lookups. |
| **Connection** | A named, typed endpoint of a partner (`http`, `sftp`, `azure_blob`, `s3`, `drop_zone`). Carries location, auth profile and the name of its credential. The type selects a driver. |
| **Credential** | Named secret values of a partner (for example `username`/`password`, an API key, OAuth client credentials, a refresh token, a service-account key, an SFTP key, a PGP key). Set only through the credentials API (§7); connections, keys, webhooks and subscribers name it. |
| **Partner configuration** | Per tenant and environment: binds a flow's connection aliases to concrete connections, and holds partner parameters (prefixes, cutoffs, key credentials, allowed actions). One flow serves many partner configurations. |
| **Flow** | A versioned, multi-step, asynchronous interaction written from verbs. Compiled to a STANDARD state machine. |
| **Lookup** | A single synchronous `CALL`. Compiled to an EXPRESS state machine and answered inline. |
| **Activation** | Runtime binding of flow + partner configuration + trigger + subscriber, with an `enabled` switch. Schedules, drop zones and partner webhooks are activations. |
| **Job** | One execution of a flow against one partner configuration. Has a `job_id`, status and a result manifest. |

The formal shapes are in [flow-spec.md](flow-spec.md). The verb, connection and
option catalog is in [blocks.md](blocks.md).

## 3. Build-time pipeline: spec → state machine

```text
POST flow spec
  → validate against contracts/flow.schema.json (exact error paths)
  → semantic checks (aliases declared, verbs allowed on the connection type,
    options valid for the verb, loops closed, limits present)
  → rewrite legacy task types to verbs (blocks.md §6)
  → expand verbs into ASL (native HTTP Task, worker Lambda or container task)
  → inject plumbing: auth resolution, default Retry/Catch, ledger commit,
    ReplyBack / ReplyBackError, metrics, dry-run short-circuit
  → validate ASL with the Step Functions validator
  → create or update the state machine; store the flow version
```

The compiler is itself a Step Functions workflow. Authors never write retries,
reply-back, metrics or auth plumbing; the compiler adds them to every flow.

## 4. Run-time pipeline: job

```text
Trigger (API call | schedule | drop-zone object | partner webhook)
  → resolve activation / partner configuration (credentials stay in their
    store; the job carries credential names, never values)
  → create job_id, persist the request, return 202 for API calls
  → run the compiled flow: verbs, waits, loops, choices
  → land every fetched payload in the Connect bucket as file pointers
  → write result manifest; commit ledger claims for succeeded items
  → reply to the caller callback or the activation subscriber; emit metric
```

Batch invocation reuses the same flow: the caller supplies items (inline array
or a file pointer) plus `maximum_concurrency`, and Connect fans out one job per
item or chunk.

## 5. Caller contract

Every product sees the same shapes, whatever the partner does inside:

- `POST /partners/{partner}/flows/{flow}/jobs` → `202 {job_id}`;
- `POST /partners/{partner}/lookups/{lookup}` → `200 {result}` inline;
- `GET /jobs/{job_id}` → status and result manifest;
- reply to `callback.url` (HTTPS, HMAC-signed) or `callback.task_token`
  (caller's Step Functions execution waits), for API-triggered jobs;
- reply to the activation's subscriber URL for unattended runs (schedule,
  drop zone, partner webhook), because they have no caller.

A result manifest lists landed files (`s3Uri`, `sha256`, `size`,
`contentType`, source path and connection), extracted values, per-item status
and sanitized errors. It never contains credentials.

## 6. Runtime operability

- Create, update, dry-run and version flows, partner configurations, connections,
  credentials and activations through the API. Never require a CDK deploy per partner,
  schedule, drop zone or feature.
- Deploy shared runtime capacity once (compiler, workers, drivers, webhook
  ingress, scheduler group, drop-zone bucket) in an inactive state; activate
  per partner at runtime.
- Enable or disable an activation without redeploying. A disabled activation
  keeps its ledger.

## 7. Credentials

Connect owns partner credentials. Operators set values through the credentials
API; flows, partner configurations, activations, configuration bundles, logs and
evidence carry only credential names. Connect writes each credential into the
store its runtime needs ([aws-runtime.md](aws-runtime.md) §6); operators never
create, tag or reference those stores.

- `PUT /partners/{partner}/credentials/{credential}` with
  `{profile, values}` → replace all values; create the backing store on first
  write.
- `PATCH /partners/{partner}/credentials/{credential}` with `{values}` → merge
  the supplied keys and keep the rest.
- `GET /partners/{partner}/credentials` and
  `GET /partners/{partner}/credentials/{credential}` → `state` (`SET` or
  `MISSING` for a name a configuration uses but nobody set), profile, key names
  with set/unset flags, version, `updated_at` and `used_by` (the configurations,
  webhooks and activations naming it). Never return values.
- `DELETE /partners/{partner}/credentials/{credential}` → `409`
  (`CredentialInUse`) while a partner configuration, webhook or activation
  names it.
- Account import (`POST .../credentials/{credential}/import`) is a design
  target. Connect main does not ship the route; verify it in the target before
  relying on it.

Profiles and their keys (Connect main `src/credentials/profiles.ts`):

| Profile | Required keys | Optional keys |
| --- | --- | --- |
| `basic` | `username`, `password` | — |
| `api_key` | `api_key` | — |
| `bearer` | `token` | — |
| `oauth2_client_credentials`, `token_call` | `client_id`, `client_secret` | — |
| `oauth2_refresh_token` | `client_id`, `client_secret`, `refresh_token` | — |
| `oauth2_jwt_bearer` | `client_email`, `private_key` | `private_key_id` |
| `client_certificate` | `cert`, `key` | `ca` |
| `password` (SFTP) | `password` | — |
| `private_key` (SFTP) | `private_key` | — |
| `connection_string`, `sas` (Azure) | `connection_string` / `sas` | — |
| `pgp_key` (`keys.*`) | `private_key` | `passphrase` |
| `webhook_secret` (`header_secret`, `hmac_sha256` webhooks; the registration token and each per-hook secret of `hmac_sha256_handshake`) | `secret` | — |
| `signing_secret` (subscriber signing) | `secret` | — |

A `signed_token` webhook names no credential: the webhook ingress verifies the
sender's token against public keys fetched from `jwks_url`
([flow-spec.md](flow-spec.md) §2).

Validate `values` against the profile's required keys and reject unknown keys. Responses, errors and
audit records contain key names, version and caller, never values. A rotation
takes effect on the next call of running and new jobs without redeploying a
flow. Accept flows, partner configurations and activations that name a
credential that is missing or incomplete, so operators can create them before
credentials exist; report the missing credential names and unset keys on read.
A job that needs such a credential fails before any partner request.

Keep non-secret auth settings (`header`, `prefix`, `token_url`, `token_path`,
`scopes`, `subject`, `audience`, `role_arn`, `external_id`) and SFTP
`username` on the connection; keep only secret values in the credential.

### Callers and credential owners (Access)

Access publishes no client library. Connect implements the per-user checks
itself, following [Access's product integration](../../build-access-product/reference/product-integration.md)
and its operator setup in [configure-access-product](../../configure-access-product/SKILL.md):

- **Verify every bearer token with `jose`** (`createRemoteJWKSet` on
  `https://<shared domain>/access/keys`, `jwtVerify`): issuer
  `https://<shared domain>/access` and audience `https://<shared domain>`, both
  configured, never read from the token; `RS256` only; `sub`, `exp` and `iat`
  required; 60 s clock tolerance; `token_use` is `access`; `roles` is a string
  array; `principal_kind` is `user` (default) or `service`. Cache keys at most
  5 minutes with an unknown-key cooldown of at most 30 s. Any failure is `401`
  and nothing starts. Identify a person by `sub` (the Access `user_id`), never
  by email.
- **Ask `POST /access/decisions`** with Connect's own service identity
  (granted `access:decision:read`, `access:resource:manage` and
  `access:resource:remove`; token from `POST /access/service-token`) and the
  caller's own token in `caller.token`. The operator hands the identity to
  Connect with the environment key, as the credential
  `PUT /connect/partners/access/credentials/service-identity` with profile
  `oauth2_client_credentials` (`client_id` the identity's name, `client_secret`
  its secret). Credentials of partner `access` are the environment's alone: no
  token caller reads, sets, removes or uses them, whatever its roles, and they
  are not registered in Access. Until it is set, every token caller is refused
  and the environment key works as before.
  Ask one question per resource. Treat any error, timeout or non-`200` as a
  deny; never fall back to allow.
- **Declare** product `connect` once, exactly as Connect's
  `src/access/declaration.ts` has it: type `credential`, `private`, with
  `read`, `use` (shareable), `manage`, `remove`, and the type-level `create`
  and `list`; type `flow` with `start`; type `configuration` with the
  type-level `read` and `manage`; type `job` with the type-level `read`; and
  type `upload` with the type-level `create`. `read` is declared because
  Access lets administrators and the environment reach only `read` and
  `remove` on a person's resource of a private type. The `member`-style role
  grants `connect:credential:create` and `connect:flow:start`.
- **Decide the environment key in Connect.** A request with only the key is
  the environment: it may do everything except use, share or change a person's
  credential. Record it as `environment`.
- **Own every credential.** Creating one with a token makes its `sub` the owner;
  with the key, `environment`. Register the owner with
  `PUT /access/resources/connect/credential/{resource_id}` on every `PUT` and
  `PATCH` (so a credential that is not registered yet becomes shareable once
  it is written), and remove it with the credential. Sharing goes through
  Access with the owner's own token, on the `resource_id` the credential's
  summary shows; Connect stores no grants.
- **Give every credential its own resource id.** The store gives a credential
  a `resource_id` (a UUID) when it is created and keeps it for the
  credential's life; Access knows the credential only by it. A credential
  created later under the same name has another, so what Access still holds
  for a removed credential (its owner record and shares, when the removal
  never reached Access) names nothing and never applies to the new one, and a
  delayed or repeated request for one credential never changes Access for
  another. Never key an Access resource by a name that can be reused. A
  credential stored before resource ids existed keeps `{partner}.{credential}`,
  which no later credential can have: Access ids allow no `/`, and Connect
  identifiers have no `.`.
- **Let Connect's store decide who created a name.** Create with a create-only
  write, so the second of two concurrent creators gets `409` and changes
  nothing. Then register the owner. When Access does not confirm that, answer
  `503` and leave the credential stored; never remove it again, since a retry
  may already have replaced it. Its owner uses it. Do not promise that it
  cannot be shared: Access may hold the owner already, with only its answer
  lost. The next `PUT` or `PATCH` by whoever manages it registers it otherwise.
- **Say what was read when writing.** Replace or merge an existing credential
  only in the exact stored state the caller was authorized on, checked by the
  store together with the write (`409` when it was changed, removed or
  recreated meanwhile). In Secrets Manager, write the new value as a staged
  version and move `AWSCURRENT` to it with `UpdateSecretVersionStage` and
  `RemoveFromVersionId` set to the version that was read. An in-memory store
  checks and writes with no `await` in between. On removal, remove the Access
  record first.
- **Pre-flight a job** before any partner or storage call: `start` on the flow
  (resource owner `environment`) and `use` on every credential the job's
  connections and DECRYPT keys name, each owner read from Connect's own records
  at that moment, never from a cache. The `403` names the flow or credential,
  never a value. A `transaction_id` belongs to the caller who used it first: a
  repeat by another caller is `409`, never the first caller's job or result.
- **Keep the environment's names.** Only the environment key sets a credential
  that a configuration already names (`409` for a person). Refuse an activation
  whose flow, subscriber or webhook names a person's credential, and a partner
  configuration whose webhook does. The webhook ingress and every job Connect
  starts or starts again on its own act as the environment and never read a
  person's credential.
- **One reading of who is calling.** The authorizer refuses a credential header
  sent twice with different values and passes on which credential it accepted;
  the API function refuses a request it would read differently.

## 8. Lineage and what changes

The design keeps the Staircase Connector model that the
[Connect service PRD](../../build-connect-service/reference/PRD.md) already ports
to TypeScript/CDK: vendors, flows, lookups, an ASL-shaped spec with
`ResourceDefinition.Type`, a compiler workflow, JSONPath state, `Extract.Save`,
injected retries and reply-back, file pointers for large responses, webhook
correlation by payload value, per-tenant partner configuration and
Connect-owned partner credentials set through its API.

It changes five things that blocked reuse:

1. **Verbs instead of provider/format types.** `GET_JSON`, `POST_XML`,
   `GET_FILE`, `SFTP` and similar collapse into `CALL` and file verbs whose
   provider comes from the connection. Legacy names remain as compile-time
   aliases.
2. **Auth on the connection, not the flow.** One partner's flows share one
   auth profile; the flow names only the connection alias.
3. **Open loops.** `Map` bodies accept any verb and any number of states, with
   items from state or from a landed file (JSON array, JSONL, CSV).
4. **Per-item file dedupe.** A ledger option on `LIST` and drop-zone triggers
   skips already-landed files of a file source, with cutoffs, leases and
   explicit replay. It is not a cursor: configurations stay memoryless, each
   job is described by its request (scope plus window or item ids) and never
   carries a position between jobs. Record dedupe belongs downstream.
5. **Triggers facing partners.** Schedules, drop zones and partner-initiated
   webhooks start jobs through activations; before, only the job API did.

Also added: pagination on `CALL`, `POLL` in place of the
`PROGRESSIVE_WAITING` + `Wait` + `Choice` idiom, webhook early-arrival
buffering and batching, `DECRYPT`/`DECODE`, and a `Runner` option that moves
heavy work from Lambda to a container task.
