---
title: Asana API Gotchas
impact: high
tags:
  - asana
  - api
---

# Asana API gotchas

## Project duplication vs task POST

Template-instantiated initiative projects reject direct `POST /tasks` with custom type GIDs.

**Correct:** duplicate an existing AC task, then rename.

**Incorrect:** create AC tasks via POST with `AC_CUSTOM_TYPE_GID` on a freshly duplicated project.

## Project privacy

**Correct:** `privacy_setting: public_to_workspace`

**Incorrect:** `public: true` on project PUT — returns "Cannot write this property".

## Reference GIDs

| Resource | GID |
| --- | --- |
| AVE reference (Story + AC types) | `1215689031697627` |

Confirm portfolio and template GIDs from `.env.local` or `manage-initiatives.mjs discover` — do not hardcode production GIDs in code changes unless the user provides them.

## Enum custom fields

Category enum creation requires a workspace member PAT with `custom_fields:write`. Bot tokens may fail — create enums in Asana UI first, then re-run `--apply-category`.
