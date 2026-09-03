---
title: Intake And Portal Spec
impact: CRITICAL
tags: [intake, portal-spec, figma, stop-rules]
---

# Intake And Portal Spec

Use this rule during Hoopa stage 1 (**Intake**) and stage 2 (**Normalize**). Convert one `designSource` plus `deliveryContext` into schema-valid `portal-spec.json` with **zero** unresolved `openQuestions` before scaffolding.

## Inputs

### `designSource` (exactly one primary source)

Select exactly one row. Reject mixed primary sources. Ask the user to choose if they supply more than one.

| `sourceType` | Accept when | Read with | On inaccessible input |
| --- | --- | --- | --- |
| `figma` | User supplies a Figma file or frame URL | **Figma MCP**. Prefer section-level frames over a single full-page frame | Stop. Ask for access, a public file, or exported frames/screenshots |
| `portal_url` | User supplies a live portal URL | Fetch public pages for layout, routes, and copy | If sign-in is required, do not bypass auth. Ask for credentials, a session artifact, screenshots, or a `source_repo` |
| `other_design` | User supplies screenshots, written UX notes, a component inventory, or equivalent non-Figma artifacts | Structured notes plus any provided images or docs | Stop if screens and routes cannot be reconstructed. Ask for missing artifacts |
| `source_repo` | User supplies an existing application repository as the design reference | Read routes, components, and styling from the repo the user can access | Stop if the repo is inaccessible. Ask for access or alternate artifacts |

### Figma routing rule

- Route Figma URLs through **Figma MCP**. Do not scrape Figma in a browser or pretend a screenshot is a Figma file.
- Exported frames, PNGs, or PDFs from Figma are **`other_design`**, not `figma`.
- If **Figma MCP cannot read** the file, stop and ask for access or alternate artifacts.

### `deliveryContext` (never invented)

Collect these org-supplied values. Missing items become `openQuestions` entries and block scaffolding.

| Field | Required | Hard stop when missing |
| --- | --- | --- |
| GitHub org, visibility, and repository name | Yes | Stop. Ask for org, visibility, and new repository name |
| Permission to create a new repo | Yes | Stop. Confirm Hoopa should **create a new repo** |
| AWS account and region | Yes, or explicit placeholder permission | Stop. Ask for account/region or permission to emit placeholders |
| Amplify preview target | Yes, or explicit permission to configure preview hosting | Stop. Ask which Amplify app to attach or for permission to configure preview hosting |
| Auth model and API contract | Yes, unless user instructs copy-from-reference | Stop. Ask for auth model and API contract, or name the reference portal/repo to copy |
| `testPersonas` and `datasetRef` | Yes | Stop. Ask for personas and a dataset location for live latency checks |
| BrowserStack credentials | Yes when full-flow verification is required and creds are not in the environment | Stop. Ask for BrowserStack project credentials |

Optional overrides: Lambda memory, timeout, provisioned concurrency, allowed origins, frontend framework.

## Normalize to `portal-spec.json`

After intake succeeds, write `portal-spec.md` and `portal-spec.json` in the target repo. Validate against `reference/portal-spec.schema.json`.

Required top-level fields:

- `sourceType`
- `screens[]`
- `breakpoints[]`
- `auth`
- `apis[]`
- `secrets[]`
- `infra`
- `testPersonas[]`
- `datasetRef`
- `hosting`
- `openQuestions[]`

### Stop-before-scaffold rule

- If `openQuestions` is non-empty, stop and ask the user. **Do not scaffold** past Normalize.
- Only advance to **Create repo** when the spec is schema-valid and `openQuestions` is an empty array.

## Correct vs incorrect intake

**Incorrect: treat exported PNG as Figma**

```text
User: Here is a PNG exported from Figma.
Agent: sourceType = figma
```

**Correct: classify exported art as other design**

```text
User: Here is a PNG exported from Figma.
Agent: sourceType = other_design; capture the image path in designSource artifacts
```

**Incorrect: invent org values**

```text
Missing: GitHub org and repository name
Agent: uses example-org/example-portal and continues to Scaffold
```

**Correct: hard stop with explicit questions**

```text
Missing: GitHub org and repository name
Agent: adds openQuestions entries, stops before scaffold, lists exact missing fields
```

**Incorrect: dual primary sources**

```text
User: Use this Figma URL and also copy https://example.com
Agent: sets sourceType = figma and silently copies the URL
```

**Correct: force a single primary source**

```text
User: Use this Figma URL and also copy https://example.com
Agent: asks which source is primary; records the other as supplemental context only
```

## Example minimal spec (tenant-neutral)

```json
{
  "sourceType": "other_design",
  "screens": [
    {
      "route": "/",
      "purpose": "Marketing landing page",
      "states": ["logged-out"]
    }
  ],
  "breakpoints": [
    { "name": "mobile", "widthPx": 390 },
    { "name": "tablet", "widthPx": 768 },
    { "name": "desktop", "widthPx": 1280 }
  ],
  "auth": { "mode": "none", "callbackEnvKeys": [] },
  "apis": [],
  "secrets": [],
  "infra": {
    "memoryMb": 512,
    "timeoutSeconds": 30,
    "provisionedConcurrency": 0,
    "logRetentionDays": 30
  },
  "testPersonas": [{ "name": "anonymous", "role": "visitor" }],
  "datasetRef": {
    "location": "s3://example-bucket/example-dataset",
    "format": "json"
  },
  "hosting": {
    "mode": "amplify-preview",
    "customDomain": "out_of_scope_v1"
  },
  "openQuestions": []
}
```
