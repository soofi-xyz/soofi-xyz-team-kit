# Jigglypuff MCP Contract

This is the contract `Spring-Oaks-Capital-LLC/jigglypuff-agent` must implement
so Cursor users can call Jigglypuff directly instead of through Asana. The kit
only documents it; the Jigglypuff repository owns the implementation, tests and
deployment. Build DEV first, certify it, then PROD.

Implementation:
[jigglypuff-agent#116](https://github.com/Spring-Oaks-Capital-LLC/jigglypuff-agent/pull/116)
(ADR 0011). DEV runs it; PROD stays off until `PROD_ENABLE_MCP_SERVER=true`
after DEV certification.

The MCP server is a new front door to capabilities Jigglypuff already has. Reuse
the existing runtime tools and their gates instead of writing parallel logic:

| MCP tool | Existing Jigglypuff capability |
| --- | --- |
| `validate_email_html` | linked-HTML executable-content and variable checks |
| `render_email_preview` | `renderEmailPreview` / `renderTemplatePreview` |
| `create_email_template_pr` | `createOrUpdateGithubTemplatePullRequest` |
| `add_files_to_template_pr` | `updateEmailTemplateSourcePullRequest`, `updateEmailTemplateTextPullRequest`, `updateEmailTemplateSubjectPullRequest` |
| `adopt_template_pr` | PR adoption (jigglypuff-agent PR #111) |
| `upload_email_image`, `export_figma_assets` | email image hosting (jigglypuff-agent PR #112, `content/email-images.ts`) |
| `certify_template` | `certifyTemplateRendering` |
| `request_template_approval` | `requestTemplateApproval` |
| `get_template_pr_status` | template PR and approval state tables |
| `translate_email_template` | Jigglypuff's Spanish translation flow |

There is deliberately no merge, approve or activate tool.

## Transport

- Remote MCP over **Streamable HTTP**, served from the Jigglypuff stack in each
  environment's AWS account. One endpoint per environment:
  - DEV: read from the stack output (see [DEV values](#dev-values)); it changes
    when the stack is recreated
  - PROD: not provisioned until PROD enablement (see the open questions)
- Stateless request/response is sufficient; no tool needs server-initiated
  messages. Long work (asset export, certification) returns within the request
  when it fits the platform timeout, otherwise returns a `job_id` that
  `get_template_pr_status` reports on.
- Limit request bodies to what the tools need (base64 images up to 1 MB each
  plus HTML); reject larger bodies before parsing.
- Users add the server in Cursor with its URL, the public Cognito client id and
  scopes. The client id is not a secret.

### DEV values

Do not treat the DEV endpoint or client id as permanent. Read them from the
Jigglypuff stack output `McpServerMcpCursorConfig`, which prints the exact
Cursor entry. Use the profile selected through your verified AWS access flow
for DEV account `951132547414`:

```bash
AWS_PROFILE=<selected-profile> aws cloudformation describe-stacks \
  --region us-east-2 --stack-name JigglypuffAgentStack \
  --query "Stacks[0].Outputs[?starts_with(OutputKey,'McpServerMcpCursorConfig')].OutputValue" \
  --output text
```

Example output as of 2026-11-01 (DEV):

```json
{
  "mcpServers": {
    "jigglypuff-dev": {
      "url": "https://9to5x3py18.execute-api.us-east-2.amazonaws.com/mcp",
      "auth": {
        "CLIENT_ID": "5esdg99f25e2k4el2ijjovff6t",
        "scopes": ["openid", "profile", "email"]
      }
    }
  }
}
```

Until jigglypuff-agent#116 merges, any other Jigglypuff PR's DEV deploy
replaces the stack without the MCP server. Re-deploy #116 to DEV to restore it;
the endpoint and client id may change, so read the stack output again and
update `mcp.json`.

Add the entry to this kit's `mcp.json` only once DEV sign-in and the tools are
certified and the values are stable (#116 merged).

## Authentication and authorization

Follow the MCP authorization specification (OAuth 2.1). No shared API keys, no
static tokens in `mcp.json`, and no service identity acting for an anonymous
user.

### Existing Spring Oaks sign-in

Reuse the company sign-in that already exists; do not create a new identity
provider or a new Entra app registration. The facts below were observed in the
`Spring-Oaks-Capital-LLC/hoothoot-agent` repository and have not been verified
against the live AWS or Entra configuration. Confirm them in the account before
building.

- Spring Oaks user single sign-on is an AWS Cognito broker per environment,
  each federated to Microsoft Entra ID through a Cognito custom identity
  provider named `AzureAD`, all in region `us-east-2`:

| Environment | AWS account | User pool | Hosted UI | Evidence (hoothoot-agent) |
| --- | --- | --- | --- | --- |
| DEV | `951132547414` | `us-east-2_7tpH6X78q` | `https://hoothoot-report-dev-951132547414.auth.us-east-2.amazoncognito.com` | `infra/legacy/app.ts:18,863`; `reports/new-curve-builder/refresh/deployment-environment.ts:40,70`; `test/portfolio-approval-dev.test.ts:20` |
| PROD | `014948052063` | `us-east-2_aM3jiFwEM` | `https://hoothoot-report-prod-014948052063.auth.us-east-2.amazoncognito.com` | `infra/legacy/app.ts:17,34`; `docs/seller-media-transfer-deployment-baseline.md:22`; `infra/lib/report-app-env.ts:10`; `infra/platform/app.ts:18` |

- Hoothoot adds app clients to these pools from its own CDK: it imports the
  pool with `UserPool.fromUserPoolId` and adds a `UserPoolClient` per report
  with authorization code, no client secret, scopes `openid profile email` and
  supported identity provider `AzureAD` (`infra/lib/hoothoot-agent-stack.ts:768,791`;
  `infra/lib/sms-delivery-today-stack.ts:837,842`). Its browser clients add
  PKCE and `identity_provider=AzureAD`
  (`reports/sms-dnt-compliance/app/public/auth.js:97,146`).
- Hoothoot authorizes users with Cognito groups
  (`infra/lib/hoothoot-agent-stack.ts:936,1001`). No resource servers, custom
  scopes or pre-token-generation Lambda were found.
- Hoothoot APIs validate tokens with API Gateway HTTP JWT authorizers using the
  Cognito issuer and the app-client id as audience
  (`infra/lib/hoothoot-agent-stack.ts:850`). The shared catalog validates
  Cognito JWTs (JWKS, issuer, audience, expiry) in CloudFront Lambda@Edge
  (`infra/lib/hoothoot-data-domain-stack.ts:55,293,311,341`).
- Hoothoot has no MCP server or client. Its Microsoft Graph access is a
  separate app-only client-credentials grant, not user sign-in; do not copy it
  for Jigglypuff.

### Default design

- **Authorization server:** the existing Cognito broker in each environment's
  own account. Jigglypuff DEV deploys to `951132547414` and PROD to
  `014948052063` (Jigglypuff CI/CD), the same accounts as the DEV and PROD
  pools, so no cross-account access and no Hoothoot change are needed.
- **App client:** Jigglypuff's own CDK imports that environment's pool with
  `UserPool.fromUserPoolId`, as Hoothoot does, and adds a **new Jigglypuff
  `UserPoolClient`**: public (no secret), authorization code with PKCE plus
  refresh token, supported identity provider `AzureAD` only, scopes
  `openid profile email`, and Cursor's two fixed callbacks
  (`http://localhost:8787/callback` and
  `https://www.cursor.com/agents/mcp/oauth/callback`, per
  [Cursor's MCP docs](https://cursor.com/docs/context/mcp#static-redirect-url)).
  Read the DEV client id from the stack output (see [DEV values](#dev-values)).
  No resource server or custom scope.
  Do not reuse a Hoothoot app client.
- **OAuth metadata proxy:** Cognito publishes only OpenID Connect discovery,
  without `code_challenge_methods_supported` or the `none` token auth method,
  and returns 400 at every RFC 8414 location; MCP clients must refuse an
  authorization server that does not advertise PKCE. So the MCP endpoint
  publishes its own RFC 9728 protected-resource metadata and RFC 8414
  authorization-server metadata. Its `/oauth2/authorize` checks client,
  redirect URI, PKCE, `resource` and scopes, then redirects to the Cognito
  hosted UI with `identity_provider=AzureAD`; `/oauth2/token` forwards only the
  grant fields. It stores nothing, and the tokens stay Cognito's.
- **Unauthenticated calls:** answer `401` with
  `WWW-Authenticate: Bearer resource_metadata="..."` so Cursor starts its
  browser sign-in.
- **Access model:** no per-user Cognito group work. Derive roles from the
  signed-in identity and Jigglypuff configuration:
  - **Read and Author:** any authenticated Spring Oaks user federated through
    the `AzureAD` identity provider (`identities[].providerName` = `AzureAD`;
    the Cognito `username` starts with `AzureAD_`) whose `email` domain is on
    the environment's allowed-domain list, default `springoakscapital.com`.
    Compare the whole domain after `@`, case-insensitively; never match a
    suffix. No group is needed.
  - **Maintainer:** an Author whose email is on the short per-environment
    allow-list in Jigglypuff configuration, `JIGGLYPUFF_MCP_MAINTAINER_EMAILS`
    (comma-separated, compared case-insensitively). Optionally also accept
    members of the legacy `jigglypuff-templates-maintainer` Cognito group. An
    empty list and no group means no maintainers.
  - Do not use per-role resource-server scopes: Cognito grants any scope the
    app client permits, so scopes alone do not authorize a user.

| Role | Who | Tools |
| --- | --- | --- |
| `Templates.Read` | Any allowed-domain `AzureAD` user | `validate_email_html`, `render_email_preview`, `get_template_pr_status` |
| `Templates.Author` | Any allowed-domain `AzureAD` user | Read, plus `upload_email_image`, `export_figma_assets`, `create_email_template_pr`, `add_files_to_template_pr`, `certify_template`, `translate_email_template`, `request_template_approval` |
| `Templates.Maintainer` | `JIGGLYPUFF_MCP_MAINTAINER_EMAILS` (optionally the legacy group) | Author, plus `adopt_template_pr` for PRs Jigglypuff did not create |

Approval and merge are not roles here. Approvers act on the Asana approval
tasks, and Jigglypuff merges only after every task is complete, exactly as in
the Asana path. Broad Author access is safe because every write lands in a
Jigglypuff-owned, inactive PR behind the same gates and human approvals.

### Token validation

- Accept only Cognito access tokens (`token_use` = `access`) whose issuer is
  that environment's pool (DEV:
  `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_7tpH6X78q`; PROD:
  `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_aM3jiFwEM`), whose
  client is that environment's Jigglypuff app client, with a valid signature
  from the pool JWKS (`<issuer>/.well-known/jwks.json`), and unexpired. Then
  read the identity from `userInfo` and apply the access model above. Cognito
  access tokens carry
  the client in `client_id`, not `aud`; check `client_id` (API Gateway JWT
  authorizers accept either).
- DEV and PROD use different pools and app clients. DEV rejects PROD tokens and
  PROD rejects DEV tokens; the issuer and `client_id` checks each enforce this.
- Reject ID tokens and tokens from Hoothoot or any other app client with
  `401`. Answer `403` for a valid token whose user is not federated through
  `AzureAD`, has no email or an email outside the allowed domains, or calls a
  Maintainer tool without being a maintainer.
- **No token passthrough:** never forward the user's token to GitHub, Asana or
  AWS. Jigglypuff calls them with its own credentials and records the user.

### Audit

Record every call with request id, timestamp, environment, tool, result, token
issuer, `client_id`, Cognito `sub`, `username`, `email`, the federated Entra
identity when present (`identities[].providerName` = `AzureAD` and its
`userId`), SHA-256 of the input, repository, branch, PR number, head commit and
Asana task, plus the role granted and why (domain, maintainer list or legacy
group). The access token carries `sub`, `username` and `cognito:groups`;
read `email` and `identities` from the Cognito `userInfo` endpoint (no
pre-token-generation trigger exists to add them to the token). Keep the audit
store append-only. Add `Requested-by: <email>` to commit messages and name the
requester in the PR body.

### Who does what

- **Jigglypuff (its CDK and runtime):** creates the app client and callback
  URLs in each environment's pool, owns the allowed-domain list and
  `JIGGLYPUFF_MCP_MAINTAINER_EMAILS` per environment, and implements the
  metadata proxy, token validation, access checks and audit. Changing the
  maintainer list is a reviewed Jigglypuff configuration change.
- **AWS/Cognito admin** (DEV `951132547414`, PROD `014948052063`): reviews the
  Jigglypuff deployment that adds the app client. No per-user group
  assignment.
- **Entra admin:** not needed. No new Entra app registration and no group
  claims are required.
- **Hoothoot:** no change.

### Open questions

Resolved by jigglypuff-agent#116: the redirect URIs (both Cursor callbacks),
client registration (a pre-registered public client in `mcp.json` `auth`, since
Cognito has no dynamic client registration), and Cursor metadata and
`resource` compatibility (the OAuth metadata proxy).

1. **PROD enablement.** Certify DEV first: Cursor sign-in end to end, a Figma
   email rebuilt under a scratch template name, certification, an approval
   request in a test Asana task, and the audit records. Then set
   `PROD_ENABLE_MCP_SERVER=true`, record the PROD URL and client id here, and
   add the entries to this kit's `mcp.json`.
2. **Entra group automation (optional, future).** If Read or Author access
   ever needs to narrow below the whole domain, or the maintainer list grows,
   map roles from Entra groups passed through `AzureAD` (a group claim plus a
   pre-token-generation trigger). Not planned; the domain and email
   allow-list model needs no IT work.

## Gates every tool enforces

Every tool runs as the signed-in user and enforces the same gates as the Asana
path; there is no bypass flag.

- Repository allow-list: only `Spring-Oaks-Capital-LLC/templates-inventory`
  (and its configured DEV equivalent, if any). Branches are Jigglypuff-owned.
- Image host: HTML images must use the environment's public image base
  (`https://images.springoakscapital.com` in PROD); no data URIs, SVG, relative
  or temporary Figma URLs.
- Alt text: every `<img>` has an `alt` attribute; empty means decorative.
- Executable HTML rejected: scripts, event handlers, forms, iframes, embeds,
  `javascript:` URLs, meta refresh.
- Declared variables equal the variables the HTML and subject reference.
- Approval binds to PR number plus head commit; a new commit invalidates
  earlier approvals and previews.
- No merge without every approval task complete; no tool merges.
- DEV and PROD separation: separate endpoints, app clients, buckets and short-URL
  services; DEV previews never mint PROD links.
- Server-side fetches only reach the Figma temporary asset hosts
  (`www.figma.com/api/mcp/asset/...` and the signed asset storage hosts) over
  HTTPS, with size and time limits. Jigglypuff never calls Figma's MCP or REST
  API.

## Common shapes

Every successful result includes `environment`, `request_id` and the requester
`email`. Errors are MCP tool errors with `code` and `message`; gate failures list
each failed check.

`Asset`:

```json
{
  "name": "logo",
  "source_url": "https://www.figma.com/api/mcp/asset/<id>",
  "css_width": 205,
  "css_height": 91,
  "crop": { "left": 0, "top": 0, "width": 99.51, "height": 112.09 },
  "fit": "fill",
  "alt": "Spring Oaks Capital LLC"
}
```

`crop` is the image's placement inside its wrapper box in percent, as in
Figma's absolutely positioned image wrappers; omit it for a plain fill.

`HostedImage`:

```json
{
  "name": "logo",
  "url": "https://images.springoakscapital.com/email/welcome_transfer_notice/<sha256>.png",
  "key": "email/welcome_transfer_notice/<sha256>.png",
  "sha256": "<64 hex>",
  "content_type": "image/png",
  "width": 410,
  "height": 182,
  "bytes": 19866,
  "already_existed": false,
  "alt": "Spring Oaks Capital LLC"
}
```

## Tools

### `upload_email_image`

Input: `template_name` (`^[a-z0-9][a-z0-9_-]{0,99}$`), `name`, and exactly one
of `image_base64` (PNG, JPEG, GIF or WebP) or `source_url` (a Figma temporary
asset URL fetched server side); optional `alt`.

Output: `HostedImage`.

Rules: detect the format from bytes; reject SVG and anything over 1 MB or 3000
px per side; key `email/<template_name>/<sha256>.<ext>`; immutable cache
headers; idempotent for identical bytes.

### `export_figma_assets`

Input: `template_name`, `assets: Asset[]`, optional `scale` (default 2).

Output: `images: HostedImage[]`, `manifest` (name to file name).

Rules: download each temporary URL server side; rasterize SVG to PNG at `scale`
times the CSS box; resize and crop raster images exactly as rendered; output
PNG only; then upload as `upload_email_image` does. Fail the whole call when any
asset fails, and name the failed asset.

### `validate_email_html`

Input: `html`, `subject`, `declared_variables[]`, optional
`required_variables` (default `["unsubscribe_url"]`), optional
`image_exceptions[]`.

Output: `ok`, `errors[]`, `warnings[]`, `referenced_variables[]`,
`missing_declarations[]`, `unused_declarations[]`, `images[]` (src, alt),
`links[]`.

Rules: the Console
[Email HTML target](../../build-console-product/reference/component-authoring.md#email-html-target)
checks plus the gates above; variables come from the Nunjucks syntax tree only,
excluding filters, tests, loop and `set` variables; flag leftover placeholders
such as lorem ipsum, TODO or `{{ IMG_BASE }}`.

### `render_email_preview`

Input: `html` or (`pr_number` and `template_name`), `subject`,
`cases: [{ name, data }]`, optional `widths` (default mobile 393 and desktop
1024).

Output: per case and width a private short-lived `preview_url`,
`screenshot_url`, the rendered subject, `broken_images[]` and render errors.

Rules: render with Jigglypuff's Nunjucks environment (`autoescape: true`,
`throwOnUndefined: true`, `usd`, `date` and `default` filters) so previews fail
where a send would. New-template mode previews body `html` with the canonical
Terms and Footer appended, as `create_email_template_pr` will write it
(jigglypuff-agent#122).

### `create_email_template_pr`

Input: `figma_url`, `template_name`, `subject`, `html`,
`declared_variables[]`, optional `template_type` (only `consumer_facing`),
optional `language` (default `english`), optional
`query: { reference_template, fields[] }`, optional `asana_task_url`, optional
`description_notes`.

Output: `pr_url`, `pr_number`, `branch`, `head_sha`, `files[]`,
`content_sha256`, `source_template_id`, `variables[]`, `query_fields[]`,
`validator: { ok, output }`.

Rules: `html` and `declared_variables[]` cover the body only; Jigglypuff
appends its canonical, reviewed Terms and Footer and adds the ending's
variables (jigglypuff-agent#122). Validate first; write
`email/consumer_facing/html/<name>.html`,
`<name>__english.json` and, with `query`, `<name>__english.query.json` per
[email-conventions.md](email-conventions.md); `source_system: FILE_IMPORT`;
`source_template_id` = UUIDv5 of the canonical frame URL; `active: false`; run
the inventory validator before pushing; refuse an existing `template_name`
(use `add_files_to_template_pr`). The PR body names the Figma link, requester,
variables, query note, image hosting state and next steps.

### `add_files_to_template_pr`

Input: `pr_number`, and one of: full `html` replacement, exact
`replacements: [{ old, new }]`, `subject`, `query`, or `activate: true`.

Output: `head_sha`, `files[]`, `content_sha256`, `validator`, and
`invalidated_approvals[]`.

Rules: only Jigglypuff-owned PRs; keep unrelated bytes; callers never replace or
edit the generated Terms and Footer; refresh
`content_sha256` atomically with the HTML; `activate` requires hosted images
and a passing certification on the current head.

### `adopt_template_pr`

Input: `pr_url`, `asana_task_url`.

Output: `pr_number`, `branch`, `head_sha`, `checks[]` (what Jigglypuff
verified before taking over).

Rules: `Templates.Maintainer` only; validate the files; record ownership in the
PR state table. PRs created by `create_email_template_pr` never need this.

### `certify_template`

Input: `pr_number`, `template_name`, optional `debt_identifiers[]`.

Output: per permutation (English/Spanish preference, CA/non-CA) the debt used,
`status` (`rendered`, `missing_data`, `failed`), a private preview link, and the
certified `head_sha`.

### `translate_email_template`

Input: `pr_number`, `template_name`, `target_language` (`spanish`).

Output: added files, `head_sha`, and the strings that need legal review.

Rules: translate visible copy only; keep variables, links, conditionals and
markup identical; legal text comes from approved Spanish wording, not free
translation.

### `request_template_approval`

Input: `pr_number`, `asana_task_url`.

Output: approval tasks created (legal always; engineering query review when the
PR contains a `.query.json`), each with its Asana URL and the bound `head_sha`.

Rules: requires a certification on the current head; humans approve in Asana.

### `get_template_pr_status`

Input: `pr_number` or `job_id`.

Output: PR state, `head_sha`, owner, checks, certification per permutation,
approval tasks with state and bound commit, image hosting state, `active`, and
job progress.

## Acceptance for the Jigglypuff implementation

- Sign-in from Cursor works through the Cognito broker federated to Entra ID,
  and an allowed-domain `AzureAD` user can use every Read and Author tool with
  no group. A non-`AzureAD` user, an email outside the allowed domains or a
  look-alike domain (for example `springoakscapital.com.evil.test`), and a
  non-maintainer calling `adopt_template_pr` each get 403. A DEV token is
  rejected by PROD and a PROD token by DEV; a Hoothoot token is rejected.
- Rebuilding PR
  [templates-inventory#346](https://github.com/Spring-Oaks-Capital-LLC/templates-inventory/pull/346)
  through the tools produces the same HTML bytes, `content_sha256`,
  `source_template_id` (`e49ed9c6-16e1-55fd-8386-a0d7f74875fb`), variables and
  query.
- Every gate has a negative test: foreign repository, foreign image host,
  missing alt, script or event handler, undeclared or unused variable, stale
  approval after a new commit, merge attempt without approvals.
- Audit records exist for every call with the requester's identity.
