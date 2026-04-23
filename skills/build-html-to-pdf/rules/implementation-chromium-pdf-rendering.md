---
title: Chromium PDF Rendering
impact: CRITICAL
tags: chromium, playwright, pdf, lambda, browser, rendering
---

## Chromium PDF Rendering

Keep the browser stage narrow. Its job is to load already-rendered HTML and return PDF bytes.

### Required Flow

1. launch headless Chromium
2. create a page
3. load the HTML
4. wait for a stable ready state
5. call `page.pdf()`
6. close resources cleanly

### Renderer Responsibilities

The Chromium renderer should own:

- browser launch flags
- page creation
- HTML loading
- stability waits
- PDF generation options
- bounded timeouts and cleanup

The Chromium renderer should not own:

- template lookup
- schema validation
- business formatting decisions
- output storage policy

### Required PDF Defaults

- prefer `preferCSSPageSize: true`
- enable print backgrounds when the template requires them
- make margins and page size explicit in CSS first
- keep runtime knobs under `renderer.html`

### Correct

```typescript
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage();

await page.setContent(html, { waitUntil: 'networkidle' });

const pdfBuffer = await page.pdf({
  preferCSSPageSize: true,
  printBackground: true,
});
```

### Incorrect

```typescript
const template = loadTemplate(templateId);
const html = renderTemplate(template, rawData);

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.setContent(html);

if (request.title) {
  injectPdfPolicyIntoHtml(page, request.title);
}
```
