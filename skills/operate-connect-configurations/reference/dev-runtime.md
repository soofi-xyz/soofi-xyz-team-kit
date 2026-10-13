# Connect dev runtime

How to reach and drive the deployed `Connect-dev` stack. The Connect
repository's `docs/runbooks/dev-verification.md` and
`docs/runtime-environment.md` are authoritative when they differ.

## Target

| Item | Value |
| --- | --- |
| Stack | `Connect-dev` |
| Account | `951132547414` (development) |
| Region | `us-east-2` only |
| Deploy | Pull requests to `main` in `Spring-Oaks-Capital-LLC/connect` run the shared DEV CI/CD workflow; do not deploy by hand |

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
test "$(aws sts get-caller-identity --query Account --output text)" = 951132547414
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
| `PUT` / `PATCH /connect/partners/{partner}/credentials/{name}` | Replace or merge credential values (responses carry key names only) |
| `GET /connect/partners/{partner}/credentials/{name}` | Key set/unset flags, version, EventBridge Connection state |
| `POST /connect/partners/{partner}/credentials/{name}/import` | Copy values from Account |
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
  partner's auth header; batched webhooks reply once per batch window.
- **Job or lookup.** Call the API with a `callback.url` you control (a
  verification endpoint that checks the reply signature) or a task token.

## Credentials

- Set partner credentials only through the credentials API. Connect stores HTTP
  auth in its own EventBridge Connections and SFTP auth in its own connector
  secrets; never create or tag secrets for Connect. Read source secrets, never
  change them. Verify the routes exist in the target before use; a missing
  route is a `lapras` gap.
- Values by profile: `basic` and SFTP `password` as `{username, password}`;
  `api_key` and `bearer` as `{value}`; `oauth2_client_credentials` as
  `{client_id, client_secret}`; SFTP `private_key` as `{username, private_key}`;
  PGP as `{private_key, passphrase}`; table-ingestion `jdbc` as
  `{username, password}`.
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
- SFTP in Lambda goes through a Transfer Family connector
  (`transfer_connector_id` on the connection). The partner must allowlist the
  connector's static egress IPs. A listing of a missing directory ends after
  `listingTimeoutMs` (default 60 s); LIST returns empty, and PUT or MOVE into it
  fail with `NotFound`.
- `assume_role` connections may name roles in other accounts only, and the
  partner's trust policy must name the Connect worker role that uses it.

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
