# qPublic (Schneider Geospatial)

Appraiser/assessor portal used by many counties (for example Cobb GA, Clay FL, St. Johns FL).
Verified end to end on Cobb County, GA, 2026-11-25.

## URLs and county IDs

- Search page: `https://qpublic.schneidercorp.com/Application.aspx?AppID=<AppID>&LayerID=<LayerID>&PageTypeID=2&PageID=<searchPageID>`
- Parcel report: `https://qpublic.schneidercorp.com/Application.aspx?AppID=<AppID>&LayerID=<LayerID>&PageTypeID=4&PageID=<reportPageID>&KeyValue=<parcel id>`
- A `Q=<number>` parameter on links copied from a browser is a session/search token. Leave
  it out.

Find the IDs from the assessor's "property search" link (NETR lists it too). The report
`PageID` is not on the search page: ask the operator to open one parcel in a normal browser
and paste the URL, or read it from an existing flow or transform. That is faster than
probing through the challenge.

| County | AppID | LayerID | Search PageID | Report PageID | KeyValue |
|---|---|---|---|---|---|
| Cobb, GA | 1051 | 23951 | 9967 | 9969 | bare 11-digit PIN, e.g. `20000300270` (display `20-0003-0-027-0`); keep as text |
| Clay, FL | 830 | 15008 | — | 6754 | `PIN_DSP` |
| St. Johns, FL | 1207 | 23272 | — | 9728 | `PARCEL_ID` |

## Access

- The whole `qpublic.schneidercorp.com` domain is behind a Cloudflare managed challenge:
  `curl` always gets 403. It is **not** a geo-block or an IP ban: the same browser profile
  works from a US hosting IP, through WARP and through Mullvad alike.
- Use the approved browser profile from
  [`../source-access.md`](../source-access.md#3-approved-browser-profile). No VPN or proxy is
  needed for qPublic itself.
- **Session rule: 2 reports per browser context.** The first navigation returns 403 and
  the challenge clears by itself in ~2–3.6 s; the second report reuses the clearance (HTTP
  200, ~0.7–2 s); the third is re-challenged and never clears in that context. Open a fresh
  context before the third request. Do not add delays; back to back is fine.
- What fails: Playwright default user agent, Obscura (any mode), Lightpanda,
  `elephant-cli prepare` 1.x and 2 (they throw on the first 403). See
  [`../source-access.md`](../source-access.md#3-approved-browser-profile).
- Record the operator's approval for the browser runner and the vendor-terms check in the
  county findings before a full run.

## Readiness condition

Ready when `document.title` contains `Report: <KeyValue>` **and** the body contains
`Assessed Values`. On 81/81 complete Cobb reports this held, and on 0/8 partial shells.

- Do not wait on `.sectionTitle`: it is missing on many reports.
- Do not stop at the title: after a challenge clears the title switches first and the page
  can still be a ~98 KB shell. Complete reports were 150–180 KB.

## Record inventory (Cobb)

Sections, in page order: Composite Summary (parcel number, property address, class,
acres, land sq ft, neighborhood, tax district, subdivision), Owner (name, mailing address,
"Owner Info Last Updated"), Appraised Values (land, building, total, class, LUC) by year
2016–current, Assessed Values (40% of fair market) by year, Tax Information links, Notice
of Assessment, Residential or Commercial Improvement Information (year built, structure,
sq ft), Accessory Information, Permits (date, number, amount, purpose), Sales Information
(date, price, instrument, deed book/page, validity, grantor, grantee, deed link), Photos,
Sketches.

- The footer line `No data available for the following modules: …` names the sections
  that are absent for this parcel. Parse it instead of guessing.
- In a 50-parcel Cobb sample: residential improvements 42, commercial 5, sales 44,
  **permits 21**. The permits section carries **city** permits too (Acworth `BC-…`,
  Kennesaw `RP-…`, Marietta `BLDG…`, Powder Springs `…PDR-…`, Smyrna), back to 2000, but
  no contractor. Use it as permit evidence for cities whose own portals are blocked, and
  keep contractor identity from the official license lookup.
- qPublic adds what the county GIS layer lacks: LUC, value history, sales and deeds,
  buildings, permits, photos. The GIS layer adds geometry and is the bulk parcel list.

## Measured throughput (Cobb, 2026-11-25, VM hosting IP, no proxy)

| Workers | Parcels | Complete | Retries | Wall | Rate |
|---|---|---|---|---|---|
| 1 | 20 | 20 | 0 | 35.0 s | 1.75 s/parcel, ~2,060/h |
| 4 | 20 | 20 | 0 | 16.2 s | 0.81 s/parcel, ~4,440/h |

Sustained behaviour over thousands of parcels is not yet measured; run step 4 of
[`../source-access.md`](../source-access.md#5-measure-throughput) before sizing a full
county.

## Reference runner (Playwright)

```js
// one browser per worker; queue = [[pin], ...]; profile from source-access.md
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
async function freshContext(browser) {
  const ctx = await browser.newContext({ userAgent: UA, extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  await ctx.route('**/*', r => ['image','stylesheet','font','media','websocket'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  return { ctx, page: await ctx.newPage(), used: 0 };
}
async function capture(s, url, pin) {
  await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); // first status is 403
  s.used++;
  return s.page.waitForFunction(p => document.title.includes('Report: ' + p) && document.body.innerHTML.includes('Assessed Values'),
    pin, { timeout: 15000 }).then(() => true, () => false);
}
// per parcel: if (!s || s.used >= 2) s = await freshContext(browser);
//             ok = await capture(s, url, pin); if (!ok) { s = await freshContext(browser); ok = await capture(s, url, pin); }
```

Launch: `chromium.launch({ executablePath: <chromium_headless_shell>, headless: true, args: ['--no-sandbox','--disable-web-security','--disable-features=site-per-process','--hide-scrollbars'] })`.
Write the page HTML to the capture path only when `ok` is true.
