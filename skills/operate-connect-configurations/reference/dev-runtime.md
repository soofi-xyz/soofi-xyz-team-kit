# Connect dev runtime

How to reach and drive the deployed `Connect-dev` stack. The Connect
repository's `docs/runbooks/dev-verification.md` and
`docs/runtime-environment.md` are authoritative when they differ.

## Target

| Item | Value |
| --- | --- |
| Stack | `Connect-dev` |
| Account | The account hosting the target Connect deployment; get it from the user or the deployment's Environment/Account records and never assume a default |
| Region | `us-east-2` only |
| Deploy | Pull requests to the default branch of the Connect repository that owns the target stack run its DEV CI/CD workflow; do not deploy by hand |

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
CONNECT_ACCOUNT=<target-account-id>
test "$(aws sts get-caller-identity --query Account --output text)" = "$CONNECT_ACCOUNT"
aws cloudformation describe-stacks --stack-name Connect-dev \
  --query 'Stacks[0].[StackStatus,Outputs]'
```

Stack outputs: `ApiUrl`, `LandingBucketName`, `DropZoneBucketName`,
`AlarmTopicArn`, `WarningTopicArn`, `OpsTopicArn`,
`OperatorRedrivePolicyArn`.

## API

All routes except partner webhooks use IAM authorization: sign requests with
SigV4 (service `execute-api`, region `us-east-2`) using credentials of a
principal in the dev account that is allowed `execute-api:Invoke`. Attach the
managed policy from the `ApiInvokePolicyArn` stack output to the role you use,
or use a role that already allows it. Principals in other accounts are refused.

```bash
API_URL=$(aws cloudformation describe-stacks --stack-name Connect-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
curl -sS --aws-sigv4 "aws:amz:us-east-2:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H "x-amz-security-token: $AWS_SESSION_TOKEN" \
  -H 'content-type: application/json' \
  "${API_URL%/}/connect/jobs/<job_id>"
```

Export short-lived credentials for the selected profile first (for example
`eval "$(aws configure export-credentials --format env)"`), or sign from code
with `@smithy/signature-v4` as the Connect repo's dev suite does. Never print
the credentials.

| Method and route | Purpose |
| --- | --- |
| `POST /connect/flows` | Register a flow version (returns 201) |
| `GET /connect/flows/{name}/versions/{version}` | Read a registered flow |
| `PUT /connect/partner-configurations/{configuration_id}` | Create or replace a partner configuration |
| `GET /connect/partner-configurations/{configuration_id}` | Read it |
| `PUT /connect/activations/{activation_id}` | Create or replace an activation |
| `GET /connect/activations/{activation_id}` | Read it |
| `POST /connect/activations/{activation_id}/enable` and `/disable` | Switch it at runtime |
| `PUT /connect/partners/{partner}/credentials/{name}` | Set `{profile, values}`, replacing all values (responses carry key names only) |
| `PATCH /connect/partners/{partner}/credentials/{name}` | Merge `{values}` into an existing credential |
| `GET /connect/partners/{partner}/credentials` and `.../{name}` | `state` (`SET` / `MISSING`), key set/unset flags, version, `updated_at`, `used_by` |
| `DELETE /connect/partners/{partner}/credentials/{name}` | Delete a credential nothing names (`409 CredentialInUse` otherwise) |
| `POST /connect/partners/{partner}/flows/{flow}/jobs` | Start a job (`transaction_id` is the idempotency key) |
| `POST /connect/partners/{partner}/lookups/{lookup}` | Synchronous lookup (`kind: lookup` flows) |
| `POST /connect/partners/{partner}/uploads` | Presigned PUT for a file the product delivers |
| `GET /connect/jobs/{job_id}` | Job status, errors and manifest pointer |
| `POST /connect/webhooks/{configuration_id}/{webhook}` | Partner webhook ingress (unsigned; the webhook's own auth applies) |

Connect has no delete API: disable activations; flows and configurations stay
registered.

## Triggers in dev

- **Schedule.** Enable the activation, then invoke the schedule target exactly
  as EventBridge Scheduler would, and disable it again:

```bash
aws lambda invoke --function-name connect-dev-schedule \
  --cli-binary-format raw-in-base64-out \
  --payload '{"activation_id":"<id>","scheduled_time":"<iso-8601>"}' /dev/stdout
```

- **Drop zone.** Put the object under the activation's prefix in
  `DropZoneBucketName`; the bucket notification starts the job. The bucket is
  SSE-KMS, so ETags are not content hashes: a byte-identical re-upload is a new
  object to the ledger.
- **Webhook.** Post the partner's payload to the webhook route with the
  partner's auth header; batched webhooks reply once per batch window. A
  `signed_token` webhook accepts only a token the partner signed, so trigger
  it from the partner side (for example publish one test message to the topic
  behind the push subscription) and read the ingress log's rejection reason on
  a `401`.
- **Job or lookup.** Call the API with a `callback.url` you control (a
  verification endpoint that checks the reply signature) or a task token.

## Credentials

- Set partner credentials only through the credentials API. Connect main stores
  each credential in its own Secrets Manager prefix
  (`connect/<stage>/credentials/<partner>/<name>`); never create, tag or edit
  secrets for Connect. Read source secrets, never change them. Verify the routes
  exist in the target before use; a missing route is a `lapras` gap.
- Values by profile (Connect main): `basic` as `{username, password}`; `api_key`
  as `{api_key}`; `bearer` as `{token}`; `oauth2_client_credentials` and
  `token_call` as `{client_id, client_secret}`; `oauth2_refresh_token` as
  `{client_id, client_secret, refresh_token}`; `oauth2_jwt_bearer` as
  `{client_email, private_key, private_key_id?}`; `client_certificate` as
  `{cert, key, ca?}`; SFTP `password` as `{password}` and `private_key` as
  `{private_key}` (the SFTP `username` is a connection field);
  `connection_string`; `sas`; `pgp_key` as `{private_key, passphrase?}`;
  `webhook_secret` and `signing_secret` as `{secret}`. Unknown keys are
  rejected. Table-ingestion `jdbc` applies only where the target defines it.
- Set values without printing them, for example:

```bash
aws secretsmanager get-secret-value --secret-id <source-secret> \
  --query SecretString --output text \
  | jq '{profile: "basic", values: {username: .Username, password: .Password}}' \
  | curl -sS -X PUT --aws-sigv4 "aws:amz:us-east-2:execute-api" \
      --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
      -H "x-amz-security-token: $AWS_SESSION_TOKEN" \
      -H 'content-type: application/json' --data @- \
      "${API_URL%/}/connect/partners/<partner>/credentials/<name>"
```

- For `oauth2_jwt_bearer`, take the three keys straight from the
  service-account key file the partner admin issued (its names match the
  profile). Keep the file out of the repository and the conversation, and
  delete local copies after the `PUT`:

```bash
jq '{profile: "oauth2_jwt_bearer",
     values: {client_email, private_key, private_key_id}}' <key-file.json> \
  | curl -sS -X PUT --aws-sigv4 "aws:amz:us-east-2:execute-api" \
      --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
      -H "x-amz-security-token: $AWS_SESSION_TOKEN" \
      -H 'content-type: application/json' --data @- \
      "${API_URL%/}/connect/partners/<partner>/credentials/<name>" \
  | jq '{state, keys, version}'
```

- For `oauth2_refresh_token`, set `{client_id, client_secret, refresh_token}`
  from where the consent flow stored them, the same way. When the partner
  rotates the refresh token, `PATCH` only `refresh_token`.
- SFTP in Lambda goes through a Transfer Family connector
  (`transfer_connector_id` on the connection). The partner must allowlist the
  connector's static egress IPs. A listing of a missing directory ends after
  `listingTimeoutMs` (default 60 s); LIST returns empty, and PUT or MOVE into it
  fail with `NotFound`.
- `assume_role` connections may name roles in other accounts only, and the
  partner's trust policy must name the Connect worker role that uses it.

## Values that must match

Check each pair before the first dev run; a mismatch fails at the partner, not
in Connect's validation.

| Partner side | Connect side | Mismatch shows as |
| --- | --- | --- |
| OAuth token endpoint | Connection `auth.token_url` (`https://oauth2.googleapis.com/token` for Google) | `AuthFailed`, HTTP 4xx |
| Service-account key file | Credential keys `client_email`, `private_key`, `private_key_id` | `AuthFailed` (`invalid_grant` or key parse failure) |
| Scopes granted to the service account's client id (domain-wide delegation) or consented by the user | Connection `auth.scopes` (subset of the grant; leave off for Google refresh tokens) | `AuthFailed` (`unauthorized_client` or `invalid_scope`) |
| The user whose data is read | Connection `auth.subject` or CALL `Subject`, and the `parameters` pattern that pins it | `AuthFailed`, or 403/404 from the API |
| Event subscription target (Workspace Events `targetResource` user) | The same user as the subject, inside the pinned pattern | Events for one user, reads as another (403/404) |
| Push endpoint URL | `<ApiUrl>/connect/webhooks/<configuration_id>/<webhook>` with the configuration's id and webhook name | `401` (unknown configuration or webhook), Pub/Sub redelivers |
| Push audience (defaults to the push endpoint URL) | `signed_token.audience`, character for character | `401` (`audience_mismatch` in Connect logs) |
| Push authentication service account | `required_claims.email` (plus `email_verified: true`) | `401` (`claim_mismatch`) |
| Token issuer actually sent | `signed_token.issuer` (`https://accounts.google.com`, or `accounts.google.com` without the scheme) | `401` (`issuer_mismatch`) |
| Signing keys | `signed_token.jwks_url` (`https://www.googleapis.com/oauth2/v3/certs` for Google) | `401` (`key_unknown`), or `503` when unreachable |
| Payload unwrapping on the push subscription | Flow and consumer expect the raw event JSON as the body | Body is the Pub/Sub envelope with base64 `message.data` |
| Enabled activation for the webhook | Activation `enabled: true` before push starts | `404`, Pub/Sub redelivers |

## Existing dev verification

`just e2e` in the Connect repo runs setup, the SMS, DSA and M2D proofs, and
teardown against `Connect-dev`, and it runs in CI after every deploy. Reuse its
helpers (`scripts/dev/`, `test/dev/harness.ts`): the verification endpoint for
signed replies and fake partners, the Transfer Family test SFTP server, and
the credential setup scripts. Do not run two suites at once; setup refuses while
another run's SFTP server is younger than 3 hours.

## Paging and alarms

Dev runs with `PAGING_MODE=disabled`: terminal failures log and count
`pages_suppressed` instead of paging. Check the `Connect` CloudWatch namespace
(`jobs_started`, `items_failed`, `pages_suppressed`) for the run.
