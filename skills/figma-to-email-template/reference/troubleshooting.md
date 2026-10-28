# Troubleshooting

## "You don't have edit access to this file"

The Figma account signed in to Cursor's Figma MCP cannot edit the file and has
no Dev Mode access. Call `whoami` to see which account is connected. Either ask
the file owner to share the file with that account as **can edit**, or
disconnect Figma in **Settings > MCP** and sign in with an account that already
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

## Asana attachments from a sandboxed tool

Sandboxed tool runners (for example Executor) cannot read files from the user's
machine or fetch arbitrary URLs, so they cannot attach local PNGs to an Asana
task. In the interim Asana path, ask the user to drag the PNGs onto the task.
The Jigglypuff MCP removes this step: upload images with `upload_email_image` or
`export_figma_assets` instead.

## Jigglypuff DEV is missing a feature

Jigglypuff DEV runs one branch at a time, and its DEV deployment workflow only
runs for pull requests to `main`. When a test needs two unmerged Jigglypuff
branches, merge them into one integration branch and deploy that, and check
which branch deployed last before blaming the template.

## The Jigglypuff MCP rejects a call

- 401: sign in again from Cursor's MCP settings; the Entra ID session expired.
- 403: the signed-in user lacks the role for that tool, or is calling PROD with
  a DEV token. Ask IT to assign the Entra group.
- Gate errors (image host, alt text, executable HTML, variables): fix the HTML;
  do not look for another path around the gate.
