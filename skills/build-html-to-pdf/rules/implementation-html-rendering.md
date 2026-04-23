---
title: Deterministic HTML Rendering
impact: CRITICAL
tags: html, templates, css, assets, deterministic-rendering, print
---

## Deterministic HTML Rendering

Render HTML from a known template registry or template map.

### Required Approach

- Resolve templates by `templateId`
- Bind only validated data
- Keep template lookup separate from Chromium launch
- Inject print CSS once in the HTML render step
- Keep the rendered result as a string until browser rendering begins

### Asset Rules

Prefer assets in this order:

1. inline critical assets as `data:` URIs
2. package assets beside templates
3. avoid remote assets unless there is a strong reliability requirement and a clear fallback story

Do not make layout-critical rendering depend on live network fetches.

### Print Rules

Always define:

- `@page`
- explicit page size
- explicit page margins
- explicit font stack
- stable page-break behavior for tables, signatures, and legal sections

Do not rely on browser defaults for layout-critical rules.

### Required Boundaries

- Do not pass unvalidated input directly into the template
- Do not mix PDF metadata policy into the HTML render step
- Do not let templates load arbitrary third-party scripts
- Do not make locale-sensitive formatting implicit

### Correct

```typescript
const template = templateCatalog.get(request.templateId);
const templateData = template.schema.parse(request.data);

const html = renderTemplate({
  template,
  data: templateData,
  printCss: sharedPrintCss,
  assetResolver,
});
```

### Incorrect

```typescript
const html = request.html ?? mustache.render(loadFile(request.templatePath), request.data);
```
