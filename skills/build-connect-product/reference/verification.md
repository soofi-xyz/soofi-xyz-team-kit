# Connect — verification

Prove the block architecture in the target repository. Report three evidence
levels separately: local tests, synthesized infrastructure, and a live run in a
named environment. A specification, a mocked unit test or a synthesized stack
does not prove a live partner integration.

## 1. Contract tests

- Validate every file under `examples/` against
  [`contracts/flow.schema.json`](contracts/flow.schema.json) with a Draft
  2020-12 validator, using the matching `$defs` entry per folder (`flows` →
  `Flow`, `partners` → `PartnerConfiguration`, `activations` → `Activation`,
  `jobs/*.request.json` → `JobRequest`, `jobs/*.result.json` →
  `ResultManifest`).
- Cross-check examples: every activation's flow allows its trigger, every flow
  alias is bound with an accepted type, every verb is supported by every
  accepted type, every declared webhook has partner auth, every required
  partner parameter is present.
- Negative cases must fail with an exact path: provider-named verb, `Map`
  without `Concurrency`, write outside `$.vars`, missing `limits`, unknown
  option, state without `Next`/`End`, `CALL` without `Path`, inline limit above
  256 KB, auth profile without `credential`, a Secrets Manager ARN or literal secret
  value in place of a credential name, non-HTTPS base URL, a field from
  another connection type, activation without subscriber, internal trigger
  type such as `eventbridge`, `oauth2_refresh_token` or `oauth2_jwt_bearer`
  without `token_url`, a non-HTTPS `token_url`, a credential `PUT` with an
  unknown key or a missing required key for its profile, a `signed_token`
  webhook that names a `credential` or lacks `issuer`, `jwks_url`, `audience`
  or `required_claims`, an `hmac_sha256_handshake` credential name longer than
  60 characters or containing `--`, a `handshake_header` on another secret
  scheme.

## 2. Compiler tests

- Each verb × accepted connection type compiles to the target in
  [aws-runtime.md](aws-runtime.md) §1, and the result passes the Step Functions
  validator.
- Injected plumbing is present on every task: retries, catch to
  `ReplyBackError`, ledger commit/release where a ledger is used, metric,
  manifest write, reply.
- Legacy aliases produce the same canonical form as the hand-written v3
  equivalent (golden files per row of [blocks.md](blocks.md) §6).
- A flow that references Persist, EventBridge, SNS, a product queue or an
  internal URL is rejected.

For value-expression changes, use TypeScript TDD in the product repository:

- First reproduce the intended opted-in Format result as a failing test, then
  implement the shared CALL/POLL compiler fix. Separate that local reproduction
  from the reported SOC DEV campaign-name observation and pin the source revision.
- Test absent and false `EvaluateFormat` with existing paths, nested objects,
  ordinary Format-shaped payloads (including malformed shapes previously
  accepted) and literal arrays; require unchanged results and acceptance.
- With `EvaluateFormat: true`, prove the same path and Format value resolves in
  JSON bodies, multipart `Body.fields`, `Query`, `PathParameters`, `Headers`
  and `Subject`, for CALL and POLL.Call. For job `job-42`, require `dev-job-42`,
  not serialized Format JSON or the literal `$.job.job_id` string.
- Exercise mixed literal/path arguments, escaping and invalid opted-in
  expressions; check explicit diagnostics without leaking values. Preserve
  literal arrays outside Format Args, nested ordinary objects, scalar values
  and existing supported expressions. Prove that expression-shaped data loaded
  from state stays data, including Format-shaped objects and path-like strings.
  Do not extend evaluation to structural fields or introduce stricter validation
  for non-opted-in flows.
- Check compiled ASL and execute against an HTTP fake that captures decoded
  JSON, multipart fields/files, query and path values. Assert evaluation occurs
  before existing serialization and URL encoding, including `/`, spaces and
  non-ASCII characters; preserve file bytes and content type. A compiler
  snapshot alone does not prove the outbound request.
- Include a **Compatibility** PR section with before/after evidence for
  unchanged installs/configurations/callers and absent/false opt-in cases,
  separate explicit-opt-in results, and any unavailable live evidence. For an
  authorized SOC DEV rerun, record deployed revision, flow version and job ID
  plus a sanitized campaign-name receipt; use a safe fixture, not real recipients.

## 3. Driver conformance

Run the same suite for every driver against a local fake (SFTP container,
Azurite, MinIO or moto) and, before release, a real test account:

- `list` honors `Prefix`, `Pattern`, `ModifiedSince`, `Exclude` and returns
  stable keys for the ledger;
- `fetchToS3` streams without buffering whole objects, verifies size and
  checksum, and handles objects larger than Lambda memory through `container`;
- `put` honors `Overwrite` policies; `move` honors `IfExists` and reports
  atomicity; `delete` is refused without `allow_delete`;
- auth failures, missing objects, throttling and partial transfers map to the
  stable error codes with correct `retryable` flags;
- `describeCapabilities` matches actual behavior.

## 4. Behavior tests

| Area | Must prove |
| --- | --- |
| Ledger | Claim, commit on success, release on failure, lease expiry, two concurrent pollers never both claim one item, `replay` re-admits named items, disabled activation keeps state |
| Path expansion | `{name}` encodes `/` as `%2F`; `{+name}` keeps `/` and encodes each segment; an empty value, or a `{+name}` value with an empty, `.` or `..` segment (including a leading or trailing `/`), fails `ValidationFailed` before any request, in `CALL` and in `POLL` |
| Pagination | Each style; `MaxPages` stop; `Collect: file` lands JSONL; resume on retry |
| Signed-token webhooks | A valid RS256 token from the JWKS passes; missing token, malformed token, unknown `kid`, bad signature, wrong `iss` or `aud`, expired or not-yet-valid token, and a `required_claims` mismatch each answer `401 WebhookUnauthorized` with only the reason logged; an unreachable or non-JWKS key endpoint answers `503`; keys are reused within the bounded `max-age` and an unknown `kid` refetches at most once per 60 s; schema rejects `signed_token` with a `credential` or `header`, a non-HTTPS `jwks_url`, or no `required_claims` |
| Handshake webhooks | `hmac_sha256_handshake` echoes the handshake and stores `<credential>--<hook>` tagged `connect:handshake=true`, with no secret or token in logs or responses; a handshake without the token, with a wrong token or without a valid `hook`, or whose target credential has another profile or is named by a configuration or activation answers `401` and stores nothing; two hooks on one activation each verify only with their own secret; another hook's, an older or the registration token's signature answers `401`; re-handshake replaces the secret; deleting one hook credential revokes only that hook; an `hmac_sha256` webhook given `X-Hook-Secret` still answers `401` and echoes nothing |
| Webhooks | Auth rejection; correlation by value; conditions; `EarlyArrival: buffer` delivers an event that arrives before the wait; batch closes on `max_events` and on `max_seconds` |
| Large payloads | Responses above `MaxInlineBytes` land as files; base64 bodies decode to the right bytes and content type |
| Decrypt | Valid PGP decrypts; wrong key fails non-retryable; plaintext never logged |
| Limits | Timeout, `max_items`, `max_bytes` and `max_cost_usd` stop the job with a `PARTIAL` or `FAILED` manifest |
| Replies | URL callback is signed and retried; task-token callback resumes the caller; unattended runs reach the activation subscriber |
| Credentials | `PUT` replaces and `PATCH` merges values; reads, errors, audit records and manifests never contain values; `DELETE` of a bound credential returns `409`; a flow, partner configuration or activation naming a missing or incomplete credential saves and reports it on read, and its job fails before any partner request; rotation applies to the next call without redeploying; Account import returns only affected key names |
| Renewing tokens | `oauth2_refresh_token` posts `grant_type=refresh_token` with the client id and secret, and sends `scope` only when `scopes` is set; `oauth2_jwt_bearer` signs RS256 with `iss` = `client_email`, `aud` = `audience` or `token_url`, `scope`, `sub` and `kid` = `private_key_id`; a CALL `Subject` overrides `auth.subject`; tokens are reused per subject until 60 s before `expires_in` and two subjects never share a token; concurrent calls share one token request; a rejected exchange is `AuthFailed` with only the status and OAuth error code; a non-PKCS#8 key fails without echoing it; no token, assertion or key appears in logs, errors or manifests |
| Credential stores | Each HTTP profile creates and updates one `connect-*` EventBridge Connection encrypted with the Connect KMS key; one compiled flow calls two partner configurations through their own connections; OAuth tokens refresh without Connect code; HTTP workers read the same connection secret; a `DEAUTHORIZED` connection surfaces as a credential failure; SFTP connectors read the Connect-managed secret |
| Runtime operation | Creating, disabling and re-enabling a schedule, drop zone or webhook activation needs no deploy |

## 5. Use-case acceptance

Run every flow in [use-cases.md](use-cases.md) §1 end to end against fakes with
its partner configuration, then show the reuse test in §3: the DSA intake flow
runs unchanged with the Azure and SFTP partner configurations, and with the
Elevate configuration.

For a live run, record environment, flow version, activation ID, job ID,
result manifest URI and the product callback receipt. Never paste landed
payloads or secrets into evidence.

## 6. Per-user credential acceptance

`user-scoped-credentials` is done only when every check below exists as an
automated test whose name starts with its ID and passes against a mock partner.
Use the people from [the Access test data](../../build-access-product/reference/test-data.md)
and a credential whose value contains a fresh `LEAKCHECK-<random>-connect`
marker. Record one evidence row per check: ID, level (local or deployed),
result, job or request identifier and the Connect revision.

| ID | Do | Pass when |
| --- | --- | --- |
| UC-1 | Set a credential, then read it as its owner, as `admin` and with the environment key | Each read returns state, key names, set/unset flags, owner and `used_by` only; the marker is in none |
| UC-2 | Run a job that uses the credential, one that fails partner auth and one that fails validation; then search every response, job result, manifest, error and log line of the run | The marker appears nowhere |
| UC-3 | `alice` creates a credential; `admin`, signed in, creates one; one is created with the environment key | Owners are `alice`'s user identifier, `admin`'s user identifier and `environment` |
| UC-4 | `alice` starts a flow that uses her credential | The job runs; the mock partner receives the call |
| UC-5 | `bob` starts the same flow | `403` naming the credential, never its value; the mock partner receives zero calls |
| UC-6 | `admin`, signed in, starts the same flow; then it is started with the environment key | `403` for both; zero partner calls |
| UC-7 | `alice` shares her credential with `bob` through Access; he starts the flow; she revokes; he starts it again | Runs, then `403` with zero partner calls |
| UC-8 | `admin` and the environment key each try to share `alice`'s credential and to replace its value | `403` for all four; no grant and no change |
| UC-9 | `admin` reads the metadata of `alice`'s credential, then removes it | Metadata returned without a value; removal succeeds and is audited |
| UC-10 | The environment key and `admin` each start a flow that uses the environment credential | Both run |
| UC-11 | `alice` starts that flow; `admin` shares the environment credential with her; she starts it again | `403` with zero partner calls, then it runs |
| UC-12 | `bob`, holding `use` on one of two credentials a flow names, starts it | `403`; zero partner calls for either connection |
| UC-13 | `alice` creates and enables a schedule activation; then `admin` does, for a flow on the environment credential | `403` for `alice`; allowed for `admin`, with the activation recording who enabled it; its job runs as the environment |
| UC-14 | `admin` creates an activation whose flow names `alice`'s personal credential | Refused at create and at enable; no job starts |
| UC-15 | Make Access's decision helper fail | Every user-started job is refused |
| UC-16 | Call each Connect route with an expired, an edited and an other-environment token | `401` each; nothing started |
| UC-17 | Run the existing environment-key suites against credentials that existed before this piece | Unchanged results; each such credential is owned by `environment` |
| UC-18 | Before per-user checks ship: `alice` calls the credentials, flow and job routes | `403` each. Connect is reachable by the environment key and administrators only |
