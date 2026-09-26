---
title: Request Contract And Validation
impact: CRITICAL
tags: contract, validation, schema, zod, request, output
---

## Request Contract And Validation

Define the generation contract before implementing templates or browser code.

### Required Request Shape

At minimum, require:

- `templateId` — identifies the HTML template
- `data` — validated template payload
- `pdf` — file name, title, language, keywords, and optional validation settings
- `renderer.html` — Chromium runtime knobs such as timeout

Keep the contract explicit and stable.

### Validation Order

Validate in this order:

1. generation request envelope
2. template-specific schema selected by `templateId`
3. required print metadata
4. output policy toggles and optional validation settings

Reject malformed input before template lookup or HTML rendering starts.

### Required Constraints

- Disallow arbitrary output file paths
- Disallow raw caller-provided HTML as renderer input
- Disallow selecting unrelated render backends
- Forbid extra properties when contract stability matters
- Make locale, language, and formatting inputs explicit when they affect output

### Output Contract

Return:

- PDF bytes or a stored artifact reference
- resolved output file name
- metadata needed for downstream tracing
- warnings only for optional skipped checks

### Correct

```typescript
import { z } from 'zod';

const GenerationRequest = z.object({
  templateId: z.string().min(1),
  data: z.unknown(),
  pdf: z.object({
    fileName: z.string().min(1),
    title: z.string().optional(),
    language: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    validatePdf: z.boolean().optional(),
  }),
  renderer: z.object({
    html: z.object({
      timeoutMs: z.number().int().positive().optional(),
    }),
  }),
});
```

### Incorrect

```typescript
const request = JSON.parse(event.body ?? '{}');

const html = request.html;
const outputPath = request.outputPath;
const engine = request.engine ?? 'chromium';
```
