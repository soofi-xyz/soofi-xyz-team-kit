# HTML capture and parsing: keep only the data, parse it once

These rules apply to every HTML source: appraiser, permit and registry pages, from any
capture route (browser runner, `elephant-cli prepare`, fetcher). They make the transform
faster without changing its output. Cobb County, GA (qPublic) is the worked example, and
every number below was measured there on 2026-11-25 with Elephant CLI 2.0.0-alpha.0
(build `94db3af`) on a 2-vCPU VM.

## Why it matters

Elephant CLI 2 runs transforms on QuickJS, an interpreter without a JIT. It hands
scripts a bundled browser build of cheerio 1.1.2 and starts a fresh JavaScript runtime
for each of the five scripts in scripts mode. HTML parsing therefore dominates:

| Cobb transform, per parcel | Median | p95 |
|---|---:|---:|
| Five scripts, each `cheerio.load()` on the full 177 KB page (parse5) | 1.55 s | 1.77 s |
| Parse once with htmlparser2, full page | 0.16 s | 0.19 s |
| Parse once with htmlparser2, trimmed page (63 KB) | **0.12 s** | 0.15 s |

Output was byte-identical across all three (119 parcels, 12,658 files). At county scale
this decides the run: about 115 CPU-hours of transform for 266,553 parcels becomes about
9. Parsing once is the biggest lever, the parser the second, and trimming the third.

## 1. Capture: keep only the element that holds the data

Each vendor page has one element that contains every data module. The rest is navigation,
script tags, banners and footers. Examples: qPublic `main#maincontent`, 63 KB of a 180 KB
page, of which script tags alone were 70 KB.

1. **Find the container.** Open 3–5 saved pages of different property types. Find the
   smallest element that contains every module (for qPublic, every
   `section[id^=ctlBodyPane_]`). List every selector the transform uses and confirm none
   reaches outside it. The title and `<head>` metadata are the usual exceptions: keep the
   `<title>`.
2. **Check readiness on the full page first.** The readiness condition from
   [`../../use-oracle/reference/source-access.md`](../../use-oracle/reference/source-access.md#4-prove-the-page-is-ready)
   runs before trimming.
3. **Cut, don't rewrite.** Take the `<title>` and the container straight out of the
   captured text, using the parser's start and end offsets, and wrap them in a minimal
   document:
   `<!doctype html><html><head><title>…</title></head><body>` + container + `</body></html>`.
   Do not re-serialize through a DOM library; that changes entities, whitespace and
   attribute order.
4. **Keep the full page for provenance.** Write the trimmed page as the transform input,
   for example `<id>.html` inside `capture.zip`. Store the full page gzipped *outside* the
   transform input (`page.full.html.gz`). Record its sha256, the trim rule (selector,
   input bytes, output bytes, module count) and the trimmed file's sha256 in the capture
   receipt. `source_http_request` stays the request that fetched the page.
5. **Fail closed.** A missing, unclosed or empty container (no modules inside) is a
   RETRYABLE capture failure, never a silently smaller record.
6. **Record the container in the vendor recipe** under
   [`../../use-oracle/reference/cookbooks/`](../../use-oracle/reference/cookbooks/README.md),
   so the next county on that vendor starts from it.

### Prove trimming is safe before adopting it

- Run the existing transform on full and trimmed inputs for every sample and diff the
  output files byte for byte. Any difference blocks adoption until it is explained.
- Validate both outputs against the live manifest and rerun the coverage proof: the
  coverage result must not change.
- Make the transform accept both full and trimmed input with identical output, so old
  full-page captures keep transforming the same way.

## 2. Transform: parse once

- **Never parse the page per script or per mapper.** In scripts mode the five scripts are
  separate programs, and each `cheerio.load()` of the full page cost about 260 ms.
  Parse in one place and hand the parsed document, or plain objects extracted from it, to
  every mapper.
- **Scripts mode:** `data_extractor.js` can parse once and load the other mappers as
  modules (`require('./ownerMapping.js')`). The four required scripts then become no-ops
  when the CLI runs them directly. Pass mapper results in memory, with a JSON round trip
  where the old code wrote intermediate files, so the hand-off stays identical.
- **Handler packages** (`--transform-zip`) parse once by design, but their output layout
  and key order differ from scripts mode. When migrating an existing scripts bundle and
  byte-identical output is the acceptance test, parse once inside scripts mode first.
- A handler package emits no Seed group. The pipeline then has to add one separately
  (a second CLI seed-mode run per parcel), which takes back part of the gain.

## 3. Parser: htmlparser2 instead of parse5

```js
const $ = cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } });
```

This makes cheerio use htmlparser2 in HTML mode instead of its default parse5. Inside
Elephant CLI 2 it parsed the Cobb page about 3× faster: 80–88 ms instead of 271–289 ms
for the full page, 36–44 ms instead of 96–105 ms trimmed. parse5 follows the HTML spec's
tree construction; htmlparser2 does not. Write selectors that give the same answer under
both:

| parse5 behaviour your code may rely on | Under htmlparser2 | Write instead |
|---|---|---|
| Inserts `<tbody>` in every table | No `<tbody>` unless the source has one: `table tbody tr` misses rows | A helper that takes `tbody > tr` when present, else `table > tr`, and the same for `thead` |
| `<noscript>` content is text | `<noscript>` content becomes real elements, so `img` counts change | Exclude `noscript` from element queries: `$('img').filter((i, el) => !$(el).closest('noscript').length)` |
| Adds `<html>`, `<head>` and `<body>` and fixes misnested tags | Keeps the source's structure | Scope lookups to the data container, not to `body` or the whole document |
| — | `.text()` whitespace and entity decoding matched on the Cobb pages | Still compare output on samples |

Browser captures (`page.content()`) are Chrome's own serialization, which already has
every `<tbody>` and repaired nesting, so the differences mostly appear on raw HTTP
captures. Guard against them anyway: the same transform may run on both.

Prove the switch the same way as trimming: compare the container's DOM node for node
under both parsers on every sample, then diff the transform output byte for byte.

## 4. Acceptance checklist

- [ ] Container selector found, and no transform selector reaches outside it.
- [ ] Readiness checked on the full page; full page stored gzipped with sha256; trim rule
      in the receipt; missing or empty container is RETRYABLE.
- [ ] Transform parses once and passes the htmlparser2 options.
- [ ] Byte-identical output: old vs new transform, full vs trimmed input, on every sample.
- [ ] Live-manifest validation 0 error rows; coverage unchanged.
- [ ] Median and p95 transform time per parcel recorded in the county findings and the
      vendor recipe.
