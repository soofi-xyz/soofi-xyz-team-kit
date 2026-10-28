---
name: figma-to-email-template
description: "Turn a Figma email frame into a Jigglypuff-owned templates-inventory pull request from Cursor: read the frame through the Figma MCP in Cursor, then call Jigglypuff's hosted MCP tools to export and host images, validate, preview, create the PR, certify, translate and request approval. Use when a requester shares a Figma email design or frame link and wants it added or updated as an email template."
---

# Figma Frame To Email Template

Use this skill in Cursor when someone wants a Figma email design turned into a
template in `Spring-Oaks-Capital-LLC/templates-inventory`. Wigglytuff and
Jigglypuff own this workflow; follow
[manage-channel-templates](../manage-channel-templates/SKILL.md) for the
inventory contract and PR review rules.

The flow has three parts:

1. Read the design through the **Figma MCP connected in the user's Cursor**.
2. Call **Jigglypuff's hosted MCP server** for everything after the read: image
   export and hosting, validation, previews, the pull request, certification,
   translation and the approval request.
3. Leave approval and merge to the humans in Asana. Jigglypuff creates and owns
   the PR, so it needs no adoption step.

Do not call Figma from anything except the Figma MCP in Cursor. Figma only
serves approved MCP clients; Cursor is approved, while Jigglypuff, Console and
local scripts are not. Do not build a local server or script to replace a
Jigglypuff tool; the gates live in Jigglypuff so every path enforces them the
same way.

## One-time setup

This workflow uses **two MCP servers** in Cursor: Figma's, to read the design,
and Jigglypuff's, to do everything after the read. Walk a new user through
these steps once, in order.

| Server | What it does | How you sign in | Status |
| --- | --- | --- | --- |
| Figma MCP (Figma's official remote server, `https://mcp.figma.com/mcp`) | Reads the email frame, its screenshot and its image assets | Your Figma account, in the browser, when you click **Connect** | Available now |
| Jigglypuff MCP (Spring Oaks, hosted) | Hosts images, validates, previews, opens the PR, certifies, translates, requests approval | Your Spring Oaks Microsoft work account (Cognito sign-in page, then Microsoft through `AzureAD`) | Not available yet; use the stopgap |

1. **Update the kit.** In Cursor, open **Settings > Plugins**, install or update
   `soofi-xyz-team-kit`, then run **Developer: Reload Window**.
2. **Connect the Figma MCP.** Follow Figma's
   [remote server setup for Cursor](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/):
   1. In a Cursor chat, enter `/add-plugin figma` and click **Add Plugin** (or
      install Figma from the Cursor Marketplace).
   2. Open **Cursor Settings > Tools & MCP**. Under installed MCP servers, click
      **Connect** next to Figma.
   3. In the browser, sign in with the Figma account that can **edit** the
      design file or has **Dev Mode** access to it, then click **Allow access**.
      Check which account the browser is signed in to first; Figma connects that
      one.
   4. Without the plugin, add a custom MCP server with
      `{"mcpServers": {"figma": {"url": "https://mcp.figma.com/mcp"}}}` and
      click **Connect**.
   5. Ask the agent to call Figma's `whoami` tool and confirm the account and
      seat. Use a Dev or Full seat; View and Collab seats get only a handful of
      Figma MCP calls a month.
3. **Connect the Jigglypuff MCP (when it ships).** It is not available yet. It
   will ship in this kit's `mcp.json` once the DEV server is certified (see the
   [contract](reference/jigglypuff-mcp-contract.md)). After that, a plugin
   update is enough: open **Cursor Settings > Tools & MCP**, enable the
   Jigglypuff server, click **Connect** and sign in with your Spring Oaks
   Microsoft work account. Until then, use the
   [stopgap](#interim-path-until-the-jigglypuff-mcp-is-deployed): open the PR
   from Cursor, then in the Asana story attach the exported images and ask
   Jigglypuff to take over the PR.
4. **Sign in to GitHub CLI (stopgap only).** The stopgap opens the PR with
   `gh`. Run `gh auth login` once and confirm with `gh auth status` that the
   account can push branches to `Spring-Oaks-Capital-LLC/templates-inventory`.

## Prerequisites

Check these before reading the design. Read
[reference/figma-read.md](reference/figma-read.md) for the details, and
[One-time setup](#one-time-setup) when anything below is missing.

1. The Figma MCP is connected in Cursor (**Cursor Settings > Tools & MCP**).
   Call `whoami` and tell the user which Figma account and seat it is signed in
   as.
2. That account can **edit** the file or has **Dev Mode** access on a paid seat.
   Without it, Figma rejects reads with "you don't have edit access to this
   file".
3. Warn about seat limits. View and Collab seats get only a handful of Figma MCP
   calls a month, and one email takes several. Prefer a Dev or Full seat.
4. The Jigglypuff MCP server for the target environment is connected and the
   user signed in with company single sign-on (the shared Cognito broker
   federated to Microsoft Entra ID). Start with
   DEV. If the server is not deployed yet, use the interim path below.
5. The user has a template name, a subject and, when known, the Asana user
   story the work belongs to.

## Workflow

### 1. Pick the frame and read it

- Take the Figma link from the requester. Parse the file key and node id
  (`node-id=54-624` is node `54:624`).
- Call `create_session` with the file key and a short task description, then
  reuse the session id.
- If the node is a **section** or page, Figma returns sparse metadata. Use
  `get_metadata` to list its children and pick the child frame that is the full
  email (often named like "Full email"). Confirm the choice with the user when
  several frames look like candidates.
- Call `get_design_context` on that frame with a screenshot. Keep the returned
  asset list: each temporary asset URL, the CSS box it renders in, and any crop
  from Figma's absolutely positioned image wrappers. These URLs expire after
  seven days.
- Make one read per frame and reuse it; every retry costs seat quota.

### 2. Write the email HTML

Write the Nunjucks HTML in Cursor from the design context and screenshot.
Follow the Console
[Email HTML target](../build-console-product/reference/component-authoring.md#email-html-target)
rules; do not restate or loosen them here. Apply the Spring Oaks conventions in
[reference/email-conventions.md](reference/email-conventions.md):

- Reuse variables that existing templates already use; do not invent new data.
- Use the standard links: `tel:+18334183084`, `{{short_url}}`,
  `{{unsubscribe_url}}` and the privacy policy URL.
- Keep legal and disclosure text exactly as designed or as the current template
  has it. Never reword, shorten or "fix" it; flag doubts for legal instead.
- Give every `<img>` an `alt` attribute. Use `alt=""` only for decorative
  images; describe logos and meaningful images.
- Use a placeholder such as `{{ IMG_BASE }}/<asset-name>.png` for images until
  Jigglypuff returns hosted URLs, then replace every placeholder.

### 3. Host the images through Jigglypuff

Call `export_figma_assets` with the asset list from step 1. Jigglypuff fetches
the temporary asset URLs server side, rasterizes SVG to 2x PNG, crops raster
images as rendered, uploads them and returns content-addressed URLs. When a URL
cannot be fetched server side (for example a `localhost:3845` URL from the Figma
desktop app), use `upload_email_image` with the PNG bytes instead. Replace each
placeholder with the returned URL. Never ship SVG, data URIs or Figma URLs.

### 4. Validate and preview

1. Call `validate_email_html` with the HTML, subject and declared variables. Fix
   every error; review every warning with the user.
2. Call `render_email_preview` with sample data for each meaningful permutation
   (for example with and without a store brand or vehicle). Check the mobile
   (393px) and desktop screenshots against the Figma screenshot and report
   broken images.

### 5. Create the pull request

Call `create_email_template_pr`. Pass the Figma node URL, template name,
subject, HTML, declared variables, and, when the email needs debt data, the
existing template whose query to derive from with the fields to keep. Jigglypuff
writes the linked-HTML files, metadata, `content_sha256` and query, runs the
inventory validator and opens the PR on a Jigglypuff-owned branch with
`active: false`. Use `add_files_to_template_pr` for follow-up edits to the same
PR. Read the contract in
[reference/jigglypuff-mcp-contract.md](reference/jigglypuff-mcp-contract.md).

### 6. Certify, translate, request approval

1. Call `certify_template` to render the PR branch for real debts across the
   language and residency permutations. Share the preview links.
2. Call `translate_email_template` when the requester wants Spanish; it adds the
   Spanish variant to the same PR for legal review.
3. Call `request_template_approval` with the Asana user story. Jigglypuff creates
   the legal approval task, and an engineering query review task when the PR
   contains a `.query.json`. Approval binds to the PR head commit.
4. Use `get_template_pr_status` to report approvals, certification and checks.

Approval and merge stay human-gated in Asana. Do not merge, approve, or activate
from Cursor. Activate the template (`active: true`) only after its images are
hosted and certification passes, through a follow-up change on the PR.

## Interim path until the Jigglypuff MCP is deployed

1. Do steps 1 and 2 in Cursor.
2. Export images with Cursor (2x PNG, cropped as rendered) and compute their
   SHA-256. Point the HTML at
   `https://images.springoakscapital.com/email/<template_name>/<sha256>.png`,
   the layout Jigglypuff's image upload produces.
3. Open the templates-inventory PR yourself with `gh`, following the file and
   metadata rules in
   [reference/email-conventions.md](reference/email-conventions.md), and run
   `npm test` in the inventory checkout.
4. In the Asana user story, attach the exported images and ask Jigglypuff to
   take over (adopt) the PR, upload the images, certify with real debts and
   request approvals.

## Hand-off to Jigglypuff

Once the PR exists, Jigglypuff owns it: certification with real debts, legal and
engineering approvals, Spanish translation, image hosting, activation and merge
after approval. Report the PR URL, the variables, the query note, the image
hosting state and the approval tasks to the requester.

## Troubleshooting

Read [reference/troubleshooting.md](reference/troubleshooting.md) for the known
failures: Figma MCP not connected, Jigglypuff MCP not available yet, no edit
access, View-seat limits, validator `template_id` and
`FILE_IMPORT` rules, sandboxed tools that cannot read local files, and DEV
running one Jigglypuff branch at a time.

## Checklist

- Figma account, seat and file access confirmed with `whoami`.
- The child email frame was read once, with a screenshot.
- HTML follows the Email HTML target and Spring Oaks conventions; legal text
  unchanged; alt text on every image.
- Every image is hosted through Jigglypuff; no placeholders, SVG or Figma URLs.
- `validate_email_html` passes and previews match the design.
- The PR is Jigglypuff-owned, `active: false`, certified, and has approval tasks
  in the Asana story.
