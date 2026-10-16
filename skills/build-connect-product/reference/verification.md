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
  or `required_claims`.

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
| Pagination | Each style; `MaxPages` stop; `Collect: file` lands JSONL; resume on retry |
| Signed-token webhooks | A valid RS256 token from the JWKS passes; missing token, malformed token, unknown `kid`, bad signature, wrong `iss` or `aud`, expired or not-yet-valid token, and a `required_claims` mismatch each answer `401 WebhookUnauthorized` with only the reason logged; an unreachable or non-JWKS key endpoint answers `503`; keys are reused within the bounded `max-age` and an unknown `kid` refetches at most once per 60 s; schema rejects `signed_token` with a `credential` or `header`, a non-HTTPS `jwks_url`, or no `required_claims` |
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
