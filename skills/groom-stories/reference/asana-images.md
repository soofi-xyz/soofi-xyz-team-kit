---
title: Add an image to an Asana story
impact: medium
tags: [asana, images, attachments, kirlia]
---

# Add An Image To An Asana Story

Kirlia's `create_story` takes the title, story sections, project and assignee. It has no image
field. Create the story first, then attach the image to the task it returns, and show it in the
description if the person wants it there.

Use this only after the person asked for the story in Asana and confirmed the draft. Ask before
uploading, because Asana notifies the assignee and followers.

## 1. Get the image as a local file

The upload sends the file's bytes. A URL the person pasted is not enough when it needs a login:
Amp attachment URLs (`https://ampcode.com/user-content/...`) return `401` without one.

- Amp: `amp files get <attachment-url> -o story-image.png`
- Anywhere else: ask the person to save the image to disk and give you the path.

## 2. Upload it to the task

Use `taskGid` from the `create_story` result as the parent.

**With an Asana personal access token** (the person's own `ASANA_PAT`). This is the easiest path,
and the file never passes through the chat.

```bash
curl -sS https://app.asana.com/api/1.0/attachments \
  -H "Authorization: Bearer $ASANA_PAT" \
  -F "parent=$TASK_GID" \
  -F "file=@story-image.png;type=image/png"
```

The response's `data.gid` is the attachment gid. Never print or ask for the token in the chat.

**Without a token, through Executor's Asana app** (`tools.asana.attachments.createAttachmentForObject`).
Executor programs cannot read files or fetch URLs, so the file goes into the call as base64
in `body.file`, and every byte passes through the chat:

1. Shrink the image first. A screenshot usually stays readable at
   `magick in.png -resize 900x -colors 32 PNG8:out.png`, about 15–20 KB. View the result before
   uploading.
2. Call it with `{ contentType: "multipart/form-data", body: { parent: TASK_GID, name: "story-image.png", file: "<base64>" } }`.
3. Executor asks the person to approve the upload. Show them the request; never approve for them.

When neither path works, give the person the file and the task link, and ask them to drag the
image into the task.

## 3. Show it in the description (optional)

An attached image appears under the task's attachments. To show it inside the description, add an
`<img>` tag that points at the attachment, then update the task's `html_notes`:

```html
<body>…existing description…<img data-asana-gid="ATTACHMENT_GID" /></body>
```

- Read the current `html_notes` first and send it back unchanged apart from the new tag.
- The image must already be attached to the same task.
- Inline images do not show in the task's image thumbnails, but `GET /attachments` still lists them.

## Do not

- Do not attach screenshots as `external` URL attachments. They show as a link, not an image, and
  break when the URL needs a login or expires.
- Do not paste base64 or HTML payloads into Asana comments.

Sources: [Upload an attachment](https://developers.asana.com/reference/createattachmentforobject),
[Rich text: inline images](https://developers.asana.com/docs/rich-text#inline-images).
