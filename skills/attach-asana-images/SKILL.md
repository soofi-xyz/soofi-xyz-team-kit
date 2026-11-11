---
name: attach-asana-images
description: "Attach an image or screenshot to an Asana task and optionally show it in the task description, through the Asana API. Use when someone asks to add a picture, screenshot, diagram or other file to a story, task or bug in Asana, from any agent client."
---

# Attach Images To Asana Tasks

Attaching a file is an Asana API call, `POST /attachments`, so the steps are the same in Amp,
Cursor, Claude Code, Codex and Copilot. The client only changes how you get the file onto disk and
which Asana credential you have.

Ask before uploading. Asana notifies the task's assignee and followers.

## 1. Get the image as a local file

The upload sends the file's bytes. A URL is not enough when it needs a login: Amp attachment URLs
(`https://ampcode.com/user-content/...`) return `401` without one.

| Where the image is | How to get a file |
| --- | --- |
| Amp attachment URL | `amp files get <attachment-url> -o image.png` |
| A file in your workspace | Use its path. |
| Pasted into the chat in another client, or on the person's machine only | Ask the person to save it and give you the path. |

## 2. Find the task gid

Use the gid you already have, such as the `taskGid` a story-creation tool returned. Otherwise take
the number after `/task/` in the task's URL.

## 3. Upload it

Use the first path that is available.

**A. curl with the person's Asana personal access token.** This is the simplest path, and the
file never passes through the chat. The person sets `ASANA_PAT` in their own environment. Never ask
for the token in the chat or print it.

```bash
curl -sS https://app.asana.com/api/1.0/attachments \
  -H "Authorization: Bearer $ASANA_PAT" \
  -F "parent=$TASK_GID" \
  -F "file=@image.png;type=image/png"
```

The response's `data.gid` is the attachment gid.

**B. Executor's Asana app, with no token.** Call `tools.asana.attachments.createAttachmentForObject`.
Executor programs cannot read files or fetch URLs, so the file goes into the call as base64, and
every byte passes through the chat:

1. Shrink the image first. A screenshot usually stays readable at
   `magick in.png -resize 900x -colors 32 PNG8:out.png`, about 15–20 KB. View the result before
   uploading.
2. Call it with `{ contentType: "multipart/form-data", body: { parent: TASK_GID, name: "image.png", file: "<base64>" } }`.
3. Executor asks the person to approve the upload. Show them the request; never approve for them.

**C. Ask the person.** Give them the file and the task link, and ask them to drag the image into
the task.

Asana's own MCP server (`mcp.asana.com`) lists and reads attachments, but has no upload tool. Check
its `tools/list` in case that has changed; otherwise use A, B or C.

## 4. Show it in the description (optional)

An attached image appears in the task's attachments. To show it inside the description, add an
`<img>` tag that points at the attachment and update the task's `html_notes`:

```html
<body>…existing description…<img data-asana-gid="ATTACHMENT_GID" /></body>
```

- Read the current `html_notes` first and send it back unchanged apart from the new tag.
- Attach the image to the same task first; the tag cannot point at another task's attachment.
- Inline images do not appear in the task's image thumbnails, but `GET /attachments` still lists
  them.

## Do not

- Do not attach screenshots as `external` URL attachments. They show as a link, not an image, and
  break when the URL needs a login or expires.
- Do not paste base64 or HTML into Asana comments.

Sources: [Upload an attachment](https://developers.asana.com/reference/createattachmentforobject),
[Rich text: inline images](https://developers.asana.com/docs/rich-text#inline-images),
[Asana MCP tools](https://developers.asana.com/docs/mcp-tools-reference).
