# Jigglypuff MCP Contract

This is the contract `Spring-Oaks-Capital-LLC/jigglypuff-agent` must implement
so Cursor users can call Jigglypuff directly instead of through Asana. The kit
only documents it; the Jigglypuff repository owns the implementation, tests and
deployment. Build DEV first, certify it, then PROD.

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
  - DEV: `https://<jigglypuff-dev-host>/mcp` (open question: host)
  - PROD: `https://<jigglypuff-prod-host>/mcp` (after DEV certification)
- Stateless request/response is sufficient; no tool needs server-initiated
  messages. Long work (asset export, certification) returns within the request
  when it fits the platform timeout, otherwise returns a `job_id` that
  `get_template_pr_status` reports on.
- Limit request bodies to what the tools need (base64 images up to 1 MB each
  plus HTML); reject larger bodies before parsing.
- Users add the server in Cursor with its URL and, with the pre-registered
  client (see the open questions), the public Cognito client id and scopes. The
  client id is not a secret:

```json
{
  "mcpServers": {
    "jigglypuff-dev": {
      "url": "https://<jigglypuff-dev-host>/mcp",
      "auth": {
        "CLIENT_ID": "<jigglypuff-dev-cognito-client-id>",
        "scopes": ["openid", "profile", "email", "jigglypuff-mcp/tools"]
      }
    }
  }
}
```

Add the entry to this kit's `mcp.json` only once the DEV URL and sign-in are
certified.

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
  `UserPoolClient`**: public (no secret), authorization code with PKCE only,
  supported identity provider `AzureAD`, scopes `openid profile email` plus one
  resource-server scope for the MCP API (for example `jigglypuff-mcp/tools`),
  and the Cursor callback URLs listed in the open questions. The same CDK
  creates that resource server; it is the only new pool-level resource, since
  Hoothoot uses none. Do not reuse a Hoothoot app client.
- **Resource server:** the MCP endpoint publishes OAuth Protected Resource
  Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`, naming the
  Cognito authorization server for that environment, and answers
  unauthenticated calls with `401` and
  `WWW-Authenticate: Bearer resource_metadata="..."` so Cursor starts its
  browser sign-in.
- **Roles (default):** map roles from the `cognito:groups` claim in the access
  token, the pattern Hoothoot already uses. Jigglypuff's CDK creates one
  Cognito group per role in each environment's pool
  (`jigglypuff-templates-read`, `jigglypuff-templates-author`,
  `jigglypuff-templates-maintainer`), and a Cognito admin assigns users to
  them.
- **Roles (alternative):** populate those groups automatically from Entra group
  membership passed through `AzureAD`, using a pre-token-generation trigger.
  Nothing like it exists today; see the open questions. Do not use per-role
  resource-server scopes: Cognito grants any scope the app client permits, so
  scopes alone do not authorize a user.

| Role | Tools |
| --- | --- |
| `Templates.Read` | `validate_email_html`, `render_email_preview`, `get_template_pr_status` |
| `Templates.Author` | Read, plus `upload_email_image`, `export_figma_assets`, `create_email_template_pr`, `add_files_to_template_pr`, `certify_template`, `translate_email_template`, `request_template_approval` |
| `Templates.Maintainer` | Author, plus `adopt_template_pr` for PRs Jigglypuff did not create |

Approval and merge are not roles here. Approvers act on the Asana approval
tasks, and Jigglypuff merges only after every task is complete, exactly as in
the Asana path.

### Token validation

- Accept only Cognito access tokens (`token_use` = `access`) whose issuer is
  that environment's pool (DEV:
  `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_7tpH6X78q`; PROD:
  `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_aM3jiFwEM`), whose
  client is that environment's Jigglypuff app client, with a valid signature
  from the pool JWKS (`<issuer>/.well-known/jwks.json`), unexpired, carrying the
  MCP resource-server scope and a role for the tool. Cognito access tokens carry
  the client in `client_id`, not `aud`; check `client_id` (API Gateway JWT
  authorizers accept either).
- DEV and PROD use different pools and app clients. DEV rejects PROD tokens and
  PROD rejects DEV tokens; the issuer and `client_id` checks each enforce this.
- Reject ID tokens, tokens from Hoothoot or any other app client, and tokens
  without a role group.
- **No token passthrough:** never forward the user's token to GitHub, Asana or
  AWS. Jigglypuff calls them with its own credentials and records the user.

### Audit

Record every call with request id, timestamp, environment, tool, result, token
issuer, `client_id`, Cognito `sub`, `username`, `email`, the federated Entra
identity when present (`identities[].providerName` = `AzureAD` and its
`userId`), SHA-256 of the input, repository, branch, PR number, head commit and
Asana task. The access token carries `sub`, `username` and `cognito:groups`;
read `email` and `identities` from the Cognito `userInfo` endpoint (no
pre-token-generation trigger exists to add them to the token). Keep the audit store append-only. Add
`Requested-by: <email>` to commit messages and name the requester in the PR
body.

### Who does what

- **Jigglypuff (its CDK and runtime):** creates the app client, resource server
  and scope, callback and logout URLs, and role groups in each environment's
  pool, and implements the resource metadata, token validation, role checks and
  audit.
- **AWS/Cognito admin** (DEV `951132547414`, PROD `014948052063`): reviews the
  Jigglypuff deployment that changes the pool and assigns users to the role
  groups.
- **Entra admin:** needed only to automate group membership from Entra, if the
  `AzureAD` federation must pass group claims. No new Entra app registration is
  required.
- **Hoothoot:** no change.

### Open questions

1. **Cursor redirect URIs.** Cursor's
   [MCP documentation](https://cursor.com/docs/context/mcp#static-redirect-url)
   lists fixed callbacks: `http://localhost:8787/callback` for the desktop app
   and `https://www.cursor.com/agents/mcp/oauth/callback` for web and Cursor
   Agents. Confirm which surfaces Spring Oaks users sign in from and register
   only those on each app client.
2. **Client registration.** Cognito, like Entra, does not support OAuth Dynamic
   Client Registration. Cursor documents
   [static OAuth for remote servers](https://cursor.com/docs/context/mcp#static-oauth-for-remote-servers):
   an `auth` object in `mcp.json` with `CLIENT_ID` (secret optional) and
   `scopes`; without `scopes`, Cursor reads `scopes_supported` from
   `/.well-known/oauth-authorization-server`. Cursor signs in with
   authorization code and PKCE, finds the authorization server through RFC 9728
   metadata and sends an RFC 8707 resource indicator
   ([Authentication](https://cursor.com/docs/context/mcp#authentication)).
   Decide between:
   - **Pre-registered client (preferred):** ship the public Cognito client id
     and scopes in `mcp.json` `auth`. Verify in DEV that Cursor completes
     discovery against Cognito, which publishes OpenID Connect discovery
     (`<issuer>/.well-known/openid-configuration`) rather than RFC 8414
     metadata and serves its endpoints from the hosted UI domain, and that
     Cognito accepts or ignores the `resource` parameter.
   - **Thin authorization proxy:** a Jigglypuff-owned endpoint that publishes
     RFC 9728 protected-resource metadata and RFC 8414 authorization-server
     metadata and forwards authorize and token requests to Cognito. Use it only
     if the pre-registered client fails that DEV check.
3. **Group membership automation.** Whether to keep admin-assigned Cognito
   groups or populate them from Entra groups: which Entra groups map to the
   three roles per environment, whether `AzureAD` already passes group
   membership, and who owns the pre-token-generation trigger if it is added.

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
where a send would.

### `create_email_template_pr`

Input: `figma_url`, `template_name`, `subject`, `html`,
`declared_variables[]`, optional `template_type` (only `consumer_facing`),
optional `language` (default `english`), optional
`query: { reference_template, fields[] }`, optional `asana_task_url`, optional
`description_notes`.

Output: `pr_url`, `pr_number`, `branch`, `head_sha`, `files[]`,
`content_sha256`, `source_template_id`, `variables[]`, `query_fields[]`,
`validator: { ok, output }`.

Rules: validate first; write `email/consumer_facing/html/<name>.html`,
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

Rules: only Jigglypuff-owned PRs; keep unrelated bytes; refresh
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

- Sign-in from Cursor works through the Cognito broker federated to Entra ID; a
  user without a role group gets 403; a DEV token is rejected by PROD and a
  PROD token by DEV; a Hoothoot token is rejected.
- Rebuilding PR
  [templates-inventory#346](https://github.com/Spring-Oaks-Capital-LLC/templates-inventory/pull/346)
  through the tools produces the same HTML bytes, `content_sha256`,
  `source_template_id` (`e49ed9c6-16e1-55fd-8386-a0d7f74875fb`), variables and
  query.
- Every gate has a negative test: foreign repository, foreign image host,
  missing alt, script or event handler, undeclared or unused variable, stale
  approval after a new commit, merge attempt without approvals.
- Audit records exist for every call with the requester's identity.
