# Configure structured extraction with Vercel or another provider

Use these as target contract examples, not proof that a deployment implements
these fields or endpoints. First discover the deployed extraction and connection
APIs and their contract versions. If support is missing, hand the gap to Kecleon;
do not submit these payloads through the SQL-only `transform_api.py` helper.
Follow the [shared extraction contract](../../build-transform-product/reference/non-deterministic-extraction.md)
for pinning, authentication, validation and replay semantics.

## Native Vercel AI Gateway from an AWS worker

Prefer the native adapter for Vercel. Select an existing managed secret containing
an AI Gateway API key, verify worker access without displaying the value, and
register a connection shaped like this through the supported Transform API:

```json
{
  "id": "vercel-extraction-dev",
  "version": "1.0.0",
  "adapter": "vercel-gateway",
  "auth": {
    "type": "api-key",
    "secretRef": "<authorized-managed-secret-reference>"
  }
}
```

Omit `baseURL` so the native SDK uses its own protocol endpoint. Do not insert
`https://ai-gateway.vercel.sh/v1` here. For a verified Vercel-hosted worker with
runtime token refresh, replace `auth` with `{ "type": "vercel-oidc" }`; ensure
ambient API keys do not override that choice. Do not assume an AWS workload IAM
role authenticates to Vercel or copy a short-lived local OIDC token into AWS.
See [native adapter](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)
and [authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok).

Select an available `creator/model` identifier with verified structured-output
support and register this extraction configuration, replacing the placeholder:

```json
{
  "id": "contact-extraction-vercel",
  "version": "1.0.0",
  "engine": "structured-extraction",
  "connectionRef": { "id": "vercel-extraction-dev", "version": "1.0.0" },
  "model": { "modelId": "<verified-creator/model-id>" },
  "outputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": ["string", "null"] },
      "email": { "type": ["string", "null"] }
    },
    "required": ["name", "email"],
    "additionalProperties": false
  },
  "instructions": "Extract the contact name and email from the source. Preserve spelling. Use null for missing facts; never invent values.",
  "inference": { "maxOutputTokens": 512, "timeoutMs": 30000, "maxRetries": 0 }
}
```

Use the deployment's discovered run envelope to reference this exact configuration
revision and supply `input` as `Contact: Ada Lovelace. Email: ada@example.test.`.
Expect `{"name":"Ada Lovelace","email":"ada@example.test"}`. For
`Contact: Ada Lovelace.`, expect `{"name":"Ada Lovelace","email":null}`.
Treat these as explanatory fixtures; use authorized production-derived evidence
for Silvally's configuration-readiness verdict and preserve its existing gates.
Do not invent run route names or claim registration alone proves live support.

## Vercel through the generic compatible endpoint

Use this alternative when the user needs the OpenAI chat-completions protocol.
Register a separate connection revision/identity:

```json
{
  "id": "vercel-compatible-dev",
  "version": "1.0.0",
  "adapter": "openai-compatible",
  "baseURL": "https://ai-gateway.vercel.sh/v1",
  "auth": {
    "type": "api-key",
    "secretRef": "<authorized-managed-secret-reference>"
  }
}
```

Publish a new extraction revision referencing this connection; retain the verified
Vercel `creator/model` identifier. Verify endpoint/model JSON Schema support using
[Vercel's structured-output contract](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs).
For another compatible gateway, change the registered URL, secret reference and
model ID to that service's verified values; do not infer compatibility from a URL.

## Direct Bedrock

Keep native AWS authentication as a separate adapter:

```json
{
  "id": "bedrock-dev",
  "version": "1.0.0",
  "adapter": "amazon-bedrock",
  "region": "<verified-deployment-region>",
  "auth": { "type": "aws-credential-chain" }
}
```

Reference this connection from an extraction revision with its verified Bedrock
model/inference-profile ID. Confirm account, region and scoped workload role access
through the existing AWS flow; use `AWS_PROFILE=<selected-profile>` for authorized
operator inspection without storing a developer profile in the connection.

## Register, run and inspect

1. Verify deployed support for the chosen adapter, auth mode, model and schema.
   Resolve data-handling permission for the selected gateway/upstream provider.
2. Validate/register/read back the connection and extraction revisions through
   supported HTTP operations, confirming both digests. Apply existing operation
   approvals; registration must not invoke a model.
3. Pin routing policy explicitly: do not assume zero SDK retries disables gateway
   failover. Use supported allowlists when upstream identity must be fixed; hand
   missing routing controls to Kecleon instead of promising a fixed provider.
4. Submit the authorized bounded string sample, poll status and inspect the JSON,
   schema validation, connection/model identity, actual routing when available,
   usage and costs. Keep secrets and raw input out of normal logs.
5. Retry the completed execution identity and verify the saved result is returned
   without new inference. Publish a new immutable revision for connection/model,
   schema or instruction changes; use a new execution identity for fresh inference.

Return configuration validity, publication and observed execution separately.
Do not claim `READY` from these illustrative samples or waive production-derived
canary/full-window, confidence or human-review requirements for non-deterministic
configuration readiness.
