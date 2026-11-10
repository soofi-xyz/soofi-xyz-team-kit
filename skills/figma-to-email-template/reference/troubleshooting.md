# Troubleshooting

## Figma MCP not connected / no Figma tools available

Symptoms: the agent has no Figma tools (`whoami`, `get_metadata`,
`get_design_context`), says Figma is not connected, or a Figma call returns an
authentication error.

1. Open **Cursor Settings > Tools & MCP**. If Figma is missing, install it with
   `/add-plugin figma` in a chat, or add a custom server with URL
   `https://mcp.figma.com/mcp`
   ([Figma setup guide](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)).
2. Click **Connect** next to Figma and click **Allow access** in the browser.
3. Run **Developer: Reload Window**.
4. Ask the agent to call `whoami` and confirm the account and seat.

A personal Figma account connects fine but fails on the design with "you don't
have edit access to this file". To switch accounts, disconnect Figma in
**Cursor Settings > Tools & MCP**, sign in to figma.com in the browser with the
work account that can edit (or has Dev Mode access to) the file, then click
**Connect** again and confirm with `whoami`.

## Jigglypuff MCP not available

Expected until it ships. The Jigglypuff server joins this kit's `mcp.json` only
after its DEV server is certified, so there is nothing to enable yet. Stop
before PR creation, as the skill's
[When the Jigglypuff MCP is unavailable](../SKILL.md#when-the-jigglypuff-mcp-is-unavailable)
section describes. Do not open the PR with `gh`; only
`create_email_template_pr` adds the canonical Terms and Footer.

## jigglypuff-dev suddenly fails to connect / 404 / host not found

DEV was redeployed. Until jigglypuff-agent#116 merges, another Jigglypuff PR's
DEV deploy removes the MCP server, and re-deploying #116 recreates it with a new
endpoint and client id.

1. Read the current entry from the `McpServerMcpCursorConfig` stack output, as
   shown in the contract's
   [DEV values](jigglypuff-mcp-contract.md#dev-values). If the output is
   missing, the MCP server is not deployed; ask the Jigglypuff owners to
   re-deploy #116 to DEV.
2. Replace the `jigglypuff-dev` `url` and `auth.CLIENT_ID` in your
   `~/.cursor/mcp.json` with the new values.
3. In **Cursor Settings > Tools & MCP**, disconnect `jigglypuff-dev`, click
   **Connect** and sign in again.

## "You don't have edit access to this file"

The Figma account signed in to Cursor's Figma MCP cannot edit the file and has
no Dev Mode access. Call `whoami` to see which account is connected. Either ask
the file owner to share the file with that account as **can edit**, or
disconnect Figma in **Cursor Settings > Tools & MCP** and sign in with an account that already
has edit or Dev Mode access. Access granted to a different email address does
not help until Cursor is signed in as that address.

## Figma MCP calls stop working mid-month

View and Collab seats allow only a handful of Figma MCP calls a month. Count the
calls before starting (about three to five per email) and ask for a Dev or Full
seat when several frames are queued. Do not retry failed reads in a loop.

## The section returned almost nothing

Sections and pages return sparse metadata. Call `get_metadata`, pick the child
email frame, and read that frame instead.

## Inventory validator errors

- `template_id must be a UUID` or `is missing template_id`: the metadata is not
  `FILE_IMPORT`. The validator treats every other `source_system` (including
  `FIGMA`) as an inline-body seller template that needs `template_id`. Use
  `source_system: "FILE_IMPORT"` with a UUID `source_template_id`.
- `template_identifier must match source_system and source_template_id`: set it
  to `FILE_IMPORT:<source_template_id>`.
- `html_file_path must reference an existing consumer_facing/html file`: linked
  HTML must live under `email/consumer_facing/html/`.
- `content_sha256 does not match`: recompute after the last HTML edit.

## Images are broken in previews

The HTML points at content-addressed URLs that are not uploaded yet. Upload
through `export_figma_assets` or `upload_email_image`; the URLs start working
without changing the HTML because they are derived from the image bytes.

## Jigglypuff DEV is missing a feature

Jigglypuff DEV runs one branch at a time, and its DEV deployment workflow only
runs for pull requests to `main`. When a test needs two unmerged Jigglypuff
branches, merge them into one integration branch and deploy that, and check
which branch deployed last before blaming the template.

## The Jigglypuff MCP rejects a call

- 401: the Cognito session expired. Sign in again from Cursor's MCP settings;
  Cursor's MCP OAuth flow goes through the Cognito hosted UI and on to Entra ID
  through the `AzureAD` identity provider.
- 403: you signed in with an account that is not a Spring Oaks work account
  (`@springoakscapital.com`) or not through Microsoft, or you called a
  maintainer tool such as `adopt_template_pr` without being on that
  environment's maintainer list. Disconnect Jigglypuff in **Cursor Settings >
  Tools & MCP**, click **Connect** again and choose your Spring Oaks Microsoft
  account. For maintainer tools, ask the Jigglypuff owners to add your email to
  `JIGGLYPUFF_MCP_MAINTAINER_EMAILS`, or ask Jigglypuff in Asana to adopt the
  PR instead. No Cognito group or IT request is needed.
- 401 right after signing in: you are probably calling one environment with
  the other's token. Check the server URL, then reconnect.
- Gate errors (image host, alt text, executable HTML, variables): fix the HTML;
  do not look for another path around the gate.
