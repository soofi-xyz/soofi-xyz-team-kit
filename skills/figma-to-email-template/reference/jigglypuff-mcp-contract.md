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
- Users add the server in Cursor with its URL only:

```json
{
  "mcpServers": {
    "jigglypuff-dev": { "url": "https://<jigglypuff-dev-host>/mcp" }
  }
}
```

Add the entry to this kit's `mcp.json` only once the DEV URL and sign-in are
certified.

## Authentication and authorization

Follow the MCP authorization specification (OAuth 2.1). No shared API keys, no
static tokens in `mcp.json`, and no service identity acting for an anonymous
user.

- **Identity provider:** company single sign-on through Microsoft Entra ID, the
  directory Spring Oaks already uses for My Apps and MFA.
- **Resource server:** the MCP endpoint publishes OAuth Protected Resource
  Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`, naming the
  Entra authorization server, and answers unauthenticated calls with `401` and
  `WWW-Authenticate: Bearer resource_metadata="..."` so Cursor starts its
  browser sign-in.
- **Token validation:** accept only Entra v2 access tokens whose issuer is the
  Spring Oaks tenant, whose audience is that environment's Jigglypuff API, with a
  valid signature (tenant JWKS), unexpired, carrying the required delegated
  scope and an app role for the tool. DEV and PROD use separate audiences, so a
  DEV token fails in PROD.
- **No token passthrough:** never forward the user's token to GitHub, Asana or
  AWS. Jigglypuff calls them with its own credentials and records the user.
- **Roles** (Entra app roles assigned through groups):

| Role | Tools |
| --- | --- |
| `Templates.Read` | `validate_email_html`, `render_email_preview`, `get_template_pr_status` |
| `Templates.Author` | Read, plus `upload_email_image`, `export_figma_assets`, `create_email_template_pr`, `add_files_to_template_pr`, `certify_template`, `translate_email_template`, `request_template_approval` |
| `Templates.Maintainer` | Author, plus `adopt_template_pr` for PRs Jigglypuff did not create |

  Approval and merge are not roles here. Approvers act on the Asana approval
  tasks, and Jigglypuff merges only after every task is complete, exactly as in
  the Asana path.
- **Audit:** record every call with request id, timestamp, environment, tool,
  result, user object id (`oid`), tenant (`tid`), user principal name, client id
  (`azp`), SHA-256 of the input, repository, branch, PR number, head commit and
  Asana task. Keep the audit store append-only. Add `Requested-by: <upn>` to
  commit messages and name the requester in the PR body.

### Open questions for the Entra setup

Fill these in from the existing company Entra configuration before building:

1. **Tenant:** the Spring Oaks tenant id and whether the existing Hoothoot (or
   other internal app) registration pattern applies.
2. **App registrations:** one Jigglypuff API registration per environment
   (application ID URI, exposed delegated scope such as `Templates.Use`, app
   roles above) and who owns them in IT.
3. **Client registration:** Entra does not support OAuth Dynamic Client
   Registration. Decide between a pre-registered public client for Cursor
   (client id configured in Cursor if Cursor supports static OAuth client
   settings for remote servers), or an authorization facade in front of Entra
   that supports registration (for example Amazon Bedrock AgentCore Identity or
   a small broker).
4. **Redirect URIs:** the exact Cursor MCP OAuth callback URI(s) to register,
   verified against current Cursor behavior.
5. **Groups:** which Entra groups map to `Templates.Read`, `Templates.Author`
   and `Templates.Maintainer`, per environment.
6. **Conditional access and MFA:** whether the existing policies apply as-is to
   the new app and to Cursor's browser sign-in.

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
- DEV and PROD separation: separate endpoints, audiences, buckets and short-URL
  services; DEV previews never mint PROD links.
- Server-side fetches only reach the Figma temporary asset hosts
  (`www.figma.com/api/mcp/asset/...` and the signed asset storage hosts) over
  HTTPS, with size and time limits. Jigglypuff never calls Figma's MCP or REST
  API.

## Common shapes

Every successful result includes `environment`, `request_id` and the requester
`upn`. Errors are MCP tool errors with `code` and `message`; gate failures list
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

- Sign-in from Cursor works with Entra ID; a user without a role gets 403; a
  DEV token is rejected by PROD.
- Rebuilding PR
  [templates-inventory#346](https://github.com/Spring-Oaks-Capital-LLC/templates-inventory/pull/346)
  through the tools produces the same HTML bytes, `content_sha256`,
  `source_template_id` (`e49ed9c6-16e1-55fd-8386-a0d7f74875fb`), variables and
  query.
- Every gate has a negative test: foreign repository, foreign image host,
  missing alt, script or event handler, undeclared or unused variable, stale
  approval after a new commit, merge attempt without approvals.
- Audit records exist for every call with the requester's identity.
