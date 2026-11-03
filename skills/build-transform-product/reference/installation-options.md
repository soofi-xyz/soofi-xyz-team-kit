# Installation options: output scope, transactions and active versions

Use this reference when a Transform installation must work for a product flow
without hand-made AWS changes. It covers two needs found on SOC DEV, where the
voice-mail flow worked only after manual edits:

- **Writing run output into another product's bucket.** The flow writes batch
  output into Connect's drop zone
  (`s3://connect-drop-zone-<account>-<region>/voapps/voice-mail-batch/*`,
  SSE-KMS with the bucket's default key) so Connect picks it up. The Glue job
  role got an inline IAM policy by hand.
- **Serving transactions with one chosen javascript version.** The SSM
  parameter `/<stackName>/transactions/runtime-config` was edited by hand to
  `{"enabled": true, "activeVersions": {...}}`. The parameter had to exist before
  the route would serve, and `POST /transform/transactions` returns
  `409 AmbiguousMapping` as soon as a second javascript version of the pair is
  registered.

A hand-made change is lost on the next install, cannot be reviewed, and does not
exist in the next environment. Give each need a supported install parameter or
API so the installer (Deploy) or the configuration owner (Silvally) can set it.

## Compatibility rule

Keep every existing install, configuration and caller working exactly as
before unless it opts in:

- Add only optional parameters and fields. Defaults reproduce today's
  behaviour, and no parameter becomes required.
- Do not make validation stricter by default. A check that would reject
  something accepted today runs only after the installer opts in, or it logs a
  warning instead of failing.
- Keep existing runtime configuration valid and authoritative. Hand-set SSM
  values keep working after the upgrade.
- Never pick a version implicitly. "Newest version wins" changes what existing
  callers receive the moment someone registers a version, so it is not a
  default.
- Write a test that runs the default install and the unchanged inputs and
  asserts today's results. List what existing users see after the upgrade in a
  **Compatibility** section of the pull request.

## Output write scope (`OutputS3WriteArns`)

Batch output prefixes are chosen per request, so the Glue role writes, and the
metrics reporter reads, any bucket in the install account
(`aws:ResourceAccount` = the install account). This stays the default.

Add an optional install parameter that lists more S3 locations runs may write
to, as object ARN prefixes ending in `*`. Use the same format as
`TransactionInputS3ObjectArns`:

```text
OutputS3WriteArns=arn:aws:s3:::connect-drop-zone-<account>-us-east-2/voapps/voice-mail-batch/*
```

- **Empty (default):** no new grant and no new check. Requests behave exactly
  as before.
- **Non-empty:**
  - Grant the Glue job role write (`s3:PutObject`, multipart abort and
    list-parts) and read on those prefixes. Grant it bucket listing too, because
    Spark checks whether the output path exists.
  - Grant the reporter read and list. It reads `_metadata.json` and the quality
    outcomes from the output prefix, so a run whose reporter cannot read them
    fails after Glue has spent money.
  - Make each grant a conditional policy, created only when the parameter is
    set.
- **Pre-run check:** with the parameter set, `POST /transform/runs` rejects an
  output prefix outside the allowed scope with `400 ValidationError`, before the
  run starts. The scope is the install account plus the listed prefixes.
  - A prefix under a listed ARN passes without an AWS call.
  - For any other prefix, check the bucket owner with
    `HeadBucket(ExpectedBucketOwner=<install account>)`.
  - Keep install-account buckets allowed, so opting in for one cross-product
    location does not break the install's other callers.
- **Encryption:** the parameter grants no KMS permissions.
  - SSE-S3 and SSE-KMS with the bucket's default `aws/s3` key need no extra
    IAM in the same account.
  - A customer-managed key needs its owner's key policy or grant to allow these
    roles. It also needs identity permissions in the install account:
    `kms:GenerateDataKey` and `kms:Decrypt` for the Glue role, and `kms:Decrypt`
    for the reporter. Document both requirements.
  - A bucket in another account needs its owner's bucket policy. If the bucket
    uses SSE-KMS, it also needs a customer-managed key, because `aws/s3` cannot
    be used across accounts.
  - Report the owner-side changes to the owning product, for example Connect.
- Do not widen the default grant, and do not add per-request IAM roles.

## Enabling transactions (`TransactionsEnabled`)

The engine is still selected only by the registered mapping
(`engine: "javascript"`) and the transaction route. Whether the route serves is
an installation default, plus a runtime override:

- Add install parameter `TransactionsEnabled` with values `enabled` and
  `disabled`, defaulting to `disabled`. Pass it to the transaction Lambda as an
  environment variable.
- Keep the SSM runtime configuration optional, and make its `enabled` field
  optional. When the parameter exists and sets `enabled`, that value wins. This
  keeps hand-set installs and the runtime kill switch working. Otherwise the
  install parameter decides.
- Do not let the stack create or own the SSM parameter. Installs that already
  set it by hand would fail with `AlreadyExists`, or have their values
  overwritten on update.

## Choosing the active javascript version (`activate`)

Several javascript versions of one pair stay ambiguous unless something chooses
one explicitly:

1. An SSM `activeVersions` pin wins. This is unchanged.
2. Otherwise, the most recently activated version wins.
3. Otherwise, the only registered javascript version is used.
4. Otherwise, the route returns `409 AmbiguousMapping`, unchanged, and the
   message says how to activate a version.

Activation is opt-in at registration: `PUT /transform/mappings/{id}/versions/{v}`
with `{ rule, module, "activate": true }`.

- Record `activatedAt` and `activatedBy` on the version item. Return
  `activated_at` from register, get and list.
- Registering identical content again with `activate: true` re-activates that
  version. This is the rollback path. A changed body still returns `409`, and
  the activation is not recorded.
- Activation does not change version content or digests, and versions stay
  immutable.
- Accept `activate` only for `javascript` bodies. A `spark-sql` body keeps its
  strict `{ rule, queries }` schema.
- Never fall back to the newest version by number or by registration time.

## Run secret parameters (`RunCredentialPathPrefix`)

A Spark mapping sometimes needs a credential in its output, for example the
Basic password the SOC voice-mail hourly mapping puts into Connect postback
requests. Today an operator stages that password in an S3 parameters file
before every run. That puts the value in an input object, the run's pinned
input snapshot and anything that copies them. Pass secrets by reference
instead, the same way extraction connections do:

- Accept an optional `secretParameters` on v2 run requests only:
  `{ "<name>": "secretsmanager:<name>" | "ssm:/<SecureString name>" }`.
  - Names are lowercase SQL column names, 1 to 20 per request.
  - References use the same schema as extraction connections: names, not ARNs.
- Add an install parameter `RunCredentialPathPrefix`. Use the same format and rules
  as `ExtractionCredentialPathPrefix`, but default it to empty, which turns the
  feature off.
  - When the prefix is set, grant only the Glue job role
    `secretsmanager:GetSecretValue` and `ssm:GetParameter` under it, through a
    conditional policy.
  - Grant no KMS permissions: secrets use the AWS managed keys.
- Reject a reference outside the prefix (or any `secretParameters` when the
  prefix is empty) with `400 ValidationError` before `StartExecution`. Repeat
  the check in the resolver, because direct `StartExecution` callers skip the
  API.
- Pin only the references in the plan. The Glue job resolves the values at run
  time and exposes them as a one-row view, `source_secret_parameters`, with one
  non-null string column per name. Mappings join it with `CROSS JOIN`.
- Keep values out of the plan, the Step Functions input, run status, logs,
  `_metadata.json` and quality files.
  - A missing or blank secret fails the run before any output is written.
  - The error names the parameter and its reference, never the value, and
    drops the AWS exception text.
  - A mapping that selects a secret column into its own output dataset writes
    it there by design; say so in the documentation.
- Reject the request when a mapping input's view is already
  `source_secret_parameters`. That check applies only when the request sends
  secrets, so existing mappings are unaffected.
- Prove: references are forwarded but not resolved before Glue; the prefix
  scope, including a sibling such as `transform/runs-other/` against
  `transform/runs/`; the default install still rejects the field; the view's
  rows and columns come from real Spark; failure messages contain no value; and
  a plan without secrets registers no view.

## Acceptance

- Default parameters synthesize no new IAM statements without a condition. The
  default install accepts any output prefix with no S3 call. Transactions return
  `503` when the SSM parameter is missing, and serve when SSM enables them. Two
  javascript versions still return `409` until one is chosen.
- With `OutputS3WriteArns` set, a listed prefix, an install-account bucket and a
  rejected foreign bucket each behave as described. A near-miss prefix, such as
  `voice-mail-batch-other` against `voice-mail-batch/*`, is not covered.
- With `TransactionsEnabled=enabled`, the route serves without an SSM parameter.
  SSM `{"enabled": false}` still disables it.
- An activated version is served over the newest one. An SSM pin overrides an
  activation. Re-activating an older version rolls back.
- Live: run the SOC flow on DEV with the manual inline policy and hand-made SSM
  values removed, then report the evidence separately from local tests.
