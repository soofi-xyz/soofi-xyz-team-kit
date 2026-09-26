---
title: Lambda Chromium HTML Boundary
impact: CRITICAL
tags: architecture, lambda, chromium, playwright, html, pdf
---

## Lambda Chromium HTML Boundary

Keep the render boundary fixed:

- **Lambda** is the only runtime
- **Chromium** is the only PDF engine
- **Playwright** is the browser control layer
- **HTML** is the only layout source

Use this boundary when designing the contract, runtime packaging, and tests.

### Required Decisions

- Put the full generation workflow behind a Lambda-friendly request contract
- Author layouts in HTML and CSS first
- Keep Chromium launch and `page.pdf()` inside the Lambda execution path
- Package fonts and static assets with the deployment artifact

### Do Not Support

- `ODT`, `OTT`, `DOCX`, or other office-document conversion
- LibreOffice or Gotenberg in the main render path
- multiple browser engines in the same skill or runtime contract
- arbitrary caller-selected render backends

### Why This Boundary Exists

- It keeps layout, runtime, and output assumptions deterministic
- It prevents the contract from expanding into unrelated document-generation paths
- It simplifies packaging, testing, and troubleshooting

### Correct

```typescript
type PdfGenerationRequest = {
  templateId: string;
  data: unknown;
  pdf: {
    fileName: string;
    title?: string;
    language?: string;
  };
  renderer: {
    html: {
      timeoutMs?: number;
    };
  };
};
```

### Incorrect

```typescript
type PdfGenerationRequest = {
  templateId?: string;
  html?: string;
  docxUrl?: string;
  engine: 'chromium' | 'webkit' | 'libreoffice';
  outputPath: string;
};
```
