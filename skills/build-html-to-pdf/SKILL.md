---
name: build-html-to-pdf
description: "Build HTML-to-PDF generation workflows on AWS Lambda using Playwright and Chromium. Covers typed request contracts, template registries, deterministic HTML rendering, Lambda Chromium packaging, PDF metadata and policy, and verification. Use when building or refactoring server-side PDF generation, print-first HTML templates, Lambda PDF renderers, or Chromium-based document generation. Triggers on: html to pdf, pdf generation, pdf renderer, chromium pdf, playwright pdf, lambda chromium, server-side pdf, print html, document rendering."
---

# Building HTML To PDF

Build HTML-first PDF generation workflows on AWS Lambda using Playwright and Chromium.

Follow `apply-engineering-guidelines` for repository-wide standards on TypeScript, CDK, testing, and observability.

## Architecture Boundary

Standardize on one render boundary:

- Lambda is the runtime
- Chromium is the PDF engine
- Playwright is the browser control layer
- HTML is the only layout source

Do NOT expand this skill to support office-document conversion, LibreOffice, Gotenberg, or multiple browser engines.

Read `rules/architecture-lambda-chromium-boundary.md`.

## Workflow: Five Phases

Follow these phases in order. Do NOT skip ahead.

### Phase 1 — Define the Request Contract

Define the generation contract before implementing templates or renderers.

- Require `templateId`, `data`, `pdf`, and `renderer.html`
- Keep output file naming and metadata explicit
- Do not let callers choose arbitrary file paths
- Do not accept raw caller-supplied HTML as renderer input

Read `rules/implementation-request-contract.md`.

### Phase 2 — Validate Before Rendering

Validate the request envelope and template-specific payload before any HTML generation starts.

- Reject malformed requests early
- Fail on missing required print fields
- Forbid unexpected properties where contract stability matters

Read `rules/implementation-request-contract.md`.

### Phase 3 — Render Deterministic HTML

Render HTML from a known template registry, not from ad hoc strings.

- Resolve the template from `templateId`
- Bind validated data only
- Inject print CSS once
- Resolve packaged or embedded assets predictably
- Keep the HTML as a string until browser rendering begins

Read `rules/implementation-html-rendering.md`.

### Phase 4 — Render PDF With Chromium

Keep the Chromium stage focused on browser execution.

- Launch headless Chromium through Playwright
- Create a page and load the HTML
- Wait for a stable ready state
- Call `page.pdf()`

Do not mix template lookup, schema validation, or business formatting rules into the browser layer.

Read `rules/implementation-chromium-pdf-rendering.md`.

### Phase 5 — Apply PDF Policy And Verify Output

Apply post-render PDF rules after Chromium returns bytes.

- Set metadata such as title, language, and keywords
- Run optional PDF validation
- Return warnings only for optional skipped checks
- Verify representative multi-page samples, not just one-page smoke cases

Read `rules/delivery-runtime-packaging-and-verification.md`.

## Non-Negotiables

1. **HTML is the only source of layout truth.** Do not treat office documents as the upstream layout format.
2. **Lambda is the only runtime.** Do not split the core render path across mixed compute patterns.
3. **Chromium is the only PDF engine.** Do not support multiple browser engines in one skill.
4. **Fonts and assets are deployment artifacts.** Do not depend on runtime discovery for critical rendering inputs.
5. **Validation happens before rendering.** Do not let templates consume untyped payloads.

## Output Contract

Return:

- PDF bytes or a stored artifact location
- resolved output file name
- warnings when optional checks were skipped
- enough metadata for downstream tracing and debugging

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Lambda / Chromium / HTML boundary | `rules/architecture-lambda-chromium-boundary.md` | CRITICAL |
| Request contract and validation | `rules/implementation-request-contract.md` | CRITICAL |
| Deterministic HTML rendering | `rules/implementation-html-rendering.md` | CRITICAL |
| Chromium PDF rendering | `rules/implementation-chromium-pdf-rendering.md` | CRITICAL |
| Runtime packaging and verification | `rules/delivery-runtime-packaging-and-verification.md` | HIGH |
