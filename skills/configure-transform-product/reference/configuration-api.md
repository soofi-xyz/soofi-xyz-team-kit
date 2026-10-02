# Transform configuration and run API

Transform registers mapping versions and starts runs through its own HTTP API.
Use it for every configuration and run; never write mappings to S3 or SSM
directly.

## Access

- Base URL: SSM parameter `/<stackName>/api-url` (for example
  `/TransformPipelineStack/api-url`) in the target account and region.
- Every route uses IAM SigV4 (service `execute-api`).
- Stack outputs name the managed policies: `ApiInvokePolicyArn` (run routes),
  `ConfigReadPolicyArn` (validate, get, list) and `ConfigWritePolicyArn`
  (register).
- Responses use `{ "ok": true, "data": ... }` or
  `{ "ok": false, "error": { "type": ..., "message": ... } }`.

## Configuration routes

| Route | Body | Result |
| --- | --- | --- |
| `POST /transform/mappings/validate` | `{rule, queries}` | `200 {mapping_id, version, files: [{path, sha256}]}`; stores nothing |
| `PUT /transform/mappings/{mapping_id}/versions/{version}` | `{rule, queries}` | `201` created; `200` identical content already registered; `409 MappingVersionConflict` for different content |
| `GET /transform/mappings/{mapping_id}/versions/{version}` | none | `rule`, `files` with `sha256`, `created_at`, `created_by`; `404 MappingNotFound` |
| `GET /transform/mappings/{mapping_id}/versions` | none | registered versions with `created_at`, `created_by` |

`queries` maps each declared query path to its SQL, for example
`{"queries/vertex-debt.sql": "<sql>"}`. Validation rules:

- the rule follows the schema-free mapping rule contract;
- `rule.id` equals `<from>-to-<to>` and the path `mapping_id`; `rule.version`
  equals the path `version`; `status` is `ENABLED`;
- every query path is `queries/*.sql` and is included in the body (no Lexicon
  paths); each declared `sha256` matches its SQL;
- SQL returns no engine-generated columns;
- each SQL file is at most 1 MiB and the body at most 5 MB.

Versions are immutable. To change a mapping, register a new version.

The `mapping.json` digest is the sha256 of the stored compact JSON, so it
differs from a pretty-printed local file with identical content (SQL digests
are byte-for-byte); compare content or use the digests validate/register
return.

## Run routes

| Route | Body | Result |
| --- | --- | --- |
| `POST /transform/runs` | v1 or v2 Transform request, optional `transaction_id` (`^[A-Za-z0-9_-]{1,80}$`) | `202 {run_id, status}`; the same `transaction_id` and body after the run finished returns `200` with the existing run; a different body returns `409 RunConflict` |
| `GET /transform/runs/{run_id}` | none | `status` `RUNNING`, `AWAITING_APPROVAL` (with `predicted_cost_usd`, `cost_ceiling_usd`), `SUCCEEDED` (`result` is the workflow success envelope), `FAILED`, `TIMED_OUT` or `ABORTED` (with `error`, `cause`); `404 RunNotFound` |
| `POST /transform/runs/{run_id}/approval` | `{approved, reviewedBy, comment?}` | `200`; `409 NotAwaitingApproval` |

`transaction_id` becomes the run id and the execution name.

## Resolution order

- A schema-free v2 run looks up `<from>-to-<to>@<mappingVersion>` in
  Transform's registry first and reads exactly the registered S3 object
  versions.
- An unregistered version falls back to Lexicon's
  `/lexicon/transform-mappings-uri` while the stack's `lexiconMappingFallback`
  is `true` (the default during migration).
- v1 requests are unchanged and still read Lexicon's published mappings.

## Configuration repositories

Keep one repository per integration (for example, one repository for the
Lexicon to Interprose integration). Transform mappings live under `transform/`:

```text
transform/mappings/<mapping_id>/<version>/
  mapping.json
  queries/*.sql
```

Git is the source of truth. Validate on pull requests (`ConfigReadPolicyArn`)
and register on merge (`ConfigWritePolicyArn`). Transform's
`scripts/publish-mappings.ts` implements both steps.

## Examples

With the helper, which fills each query's `sha256` from the bundle files:

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
export TRANSFORM_API_URL="$(aws ssm get-parameter --name /TransformPipelineStack/api-url \
  --query Parameter.Value --output text)"
H=skills/configure-transform-product/scripts/transform_api.py
python3 "$H" validate <repo>/transform
python3 "$H" register <repo>/transform
python3 "$H" get <mapping-id> <version>
python3 "$H" get <mapping-id> <version> --root <repo>/transform
python3 "$H" list <mapping-id>
python3 "$H" start request.json --transaction-id <run-id>
python3 "$H" status <run-id>
python3 "$H" approve <run-id> --approve --reviewed-by <name> --comment "<reason>"
```

The helper needs `botocore`, prints JSON and exits non-zero on any non-2xx
response. `register` reports each version as `created`, `unchanged` or
`failed`; `get --root` reports each file as `content matches` or
`content differs` and exits non-zero on any difference.

With curl:

```bash
curl -sS --aws-sigv4 "aws:amz:us-east-2:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H "x-amz-security-token: $AWS_SESSION_TOKEN" \
  "${TRANSFORM_API_URL%/}/transform/mappings/<mapping-id>/versions"
```
