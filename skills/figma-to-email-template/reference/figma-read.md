# Reading An Email Frame Through The Figma MCP

All Figma reads go through the Figma MCP connected in the user's Cursor. Figma
only serves approved MCP clients, and Cursor is one of them. Jigglypuff, Console
and local scripts must not call Figma's MCP or REST API for design reads.

## Check access first

1. Call `whoami`. Report the signed-in email, team and seat type.
2. Confirm the account can edit the file or has Dev Mode access on a paid seat.
   Figma's MCP server refuses `create_session` and `get_design_context` with
   "you don't have edit access to this file" otherwise; reading without a
   session fails the same way.
3. Warn about quota. Figma limits MCP calls heavily on View and Collab seats (a
   handful a month); Dev and Full seats get far more. One email takes about
   three to five calls (`whoami`, `create_session`, optional `get_metadata`,
   `get_design_context`). See Figma's
   [rate limits page](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).
4. If access was granted to a different account (for example a company address
   rather than a personal one), ask the user to disconnect Figma in **Settings >
   MCP** and sign in again with that account, then repeat `whoami`.

## Pick the right node

- Parse the link: `https://www.figma.com/design/<fileKey>/<name>?node-id=54-624`
  is file `<fileKey>`, node `54:624`. For `/design/<fileKey>/branch/<branchKey>/`
  links, read from the branch key.
- Call `create_session` with the file key and a short description, and pass the
  returned session id to later calls.
- Sections and pages return sparse metadata. Call `get_metadata` on them, list
  the child frames, and pick the frame that is the complete email. Several
  frames in one section usually mean several templates; read one per template.
- Call `get_design_context` with a screenshot on the chosen frame.

## Keep from the read

- The screenshot, to compare previews against.
- Every asset: the temporary URL, the target name you will give it, the
  rendered CSS width and height, and the crop when the image sits in an
  absolutely positioned wrapper (left, top, width and height as percentages of
  the wrapper). Pass these unchanged to `export_figma_assets`.
- Text exactly as designed, including disclosures, so legal text is not
  re-typed from memory.
- The frame's node URL. Jigglypuff derives the template's `source_template_id`
  from it.

Temporary asset URLs expire after seven days. Export and host the images in the
same working session. URLs served from `localhost:3845` by the Figma desktop app
only resolve on the user's machine; Jigglypuff cannot fetch them, so upload
those images as bytes with `upload_email_image`.
