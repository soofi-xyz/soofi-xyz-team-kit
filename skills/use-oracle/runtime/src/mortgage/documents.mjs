/**
 * Mortgage source documents: fetch each recorded document from the county portal and
 * stream it straight to S3 (no local copies), with a small index.json beside it.
 *
 * Layout: s3://<bucket>/documents/<ST>/<county>/<year>/<instrument>/document.pdf (or page-0001.png ...)
 *         s3://<bucket>/documents/<ST>/<county>/<year>/<instrument>/index.json
 * A document whose index.json already exists with the same sha256 is skipped, so runs
 * resume. Credentials come from the AWS credential chain (AWS_PROFILE).
 *
 * @module src/mortgage/documents
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createAcclaimSession } from "./acclaim.mjs";
import { INTERACTIVE_CHALLENGE_TEXT, InteractiveChallengeError } from "./publicsearch.mjs";

export const HILLSBOROUGH_DOCUMENT_URL =
  "https://publicaccess.hillsclerk.com/Public/ORIUtilities/OverlayWatermark/api/Watermark/";

/**
 * @param {{ state: string, county: string, instrumentNumber: string }} record - Index record.
 * @returns {string} S3 key prefix for the record.
 */
export function documentPrefix(record) {
  const safe = String(record.instrumentNumber).replace(/[^A-Za-z0-9._-]/g, "_");
  // Grouped by recording year so a county's documents can be read or shipped a year at a time.
  const year = /^\d{4}/.exec(String(record.recordDate ?? ""))?.[0] ?? "unknown-year";
  return `documents/${record.state}/${record.county}/${year}/${safe}`;
}

/**
 * Read index records from a harvest run's windows directory.
 *
 * @param {string} windowsDir - <output>/<county>/<jobId>/windows.
 * @param {{ from?: string, to?: string }} [range] - Optional ISO date bounds on recordDate.
 * @returns {Promise<Record<string, any>[]>} Records, newest first.
 */
export async function readIndexRecords(windowsDir, range = {}) {
  const files = (await readdir(windowsDir)).filter((name) => name.endsWith(".jsonl"));
  const records = [];
  for (const file of files) {
    const text = await readFile(path.join(windowsDir, file), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (range.from && (record.recordDate ?? "") < range.from) continue;
      if (range.to && (record.recordDate ?? "") > range.to) continue;
      records.push(record);
    }
  }
  return records.sort((a, b) => String(b.recordDate).localeCompare(String(a.recordDate)));
}

/**
 * Document fetchers per vendor. Each returns { bytes, contentType, sourceUrl }.
 *
 * @param {string} vendor - Profile vendor.
 * @param {{ baseUrl: string, bookType?: string }} profile - County profile.
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {(record: Record<string, any>) => Promise<{ bytes: Uint8Array, contentType: string, sourceUrl: string }>}
 *   Fetcher.
 */
export function documentFetcher(vendor, profile, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (vendor === "acclaim") {
    const session = createAcclaimSession({ baseUrl: profile.baseUrl, bookType: profile.bookType, fetchImpl });
    return async (record) => {
      const details = await session.fetchDetails(String(record.instrumentNumber));
      const pdf = await session.fetchDocumentPdf(details.facts.transactionItemId);
      return { bytes: pdf.bytes, contentType: "application/pdf", sourceUrl: details.url };
    };
  }
  if (vendor === "hillsclerk-ori") {
    return async (record) => {
      const key = record.source?.documentKey;
      if (!key) throw new Error(`No document key for ${record.requestIdentifier}`);
      const url = `${HILLSBOROUGH_DOCUMENT_URL}${encodeURIComponent(key)}`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`Hillsborough document returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Hillsborough did not return a PDF");
      return { bytes, contentType: "application/pdf", sourceUrl: url };
    };
  }
  throw new Error(`No document fetcher for vendor ${vendor} yet`);
}

/**
 * @param {any} page - Puppeteer page.
 * @returns {Promise<boolean>} True when the page shows an interactive human check.
 */
async function isChallenge(page) {
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  return INTERACTIVE_CHALLENGE_TEXT.test(text);
}

/**
 * @param {string} chromePath - Chrome executable.
 * @param {string} url - Page to open.
 * @returns {Promise<{ browser: any, page: any }>} Browser and page.
 */
async function openBrowserPage(chromePath, url) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: false, defaultViewport: { width: 1365, height: 900 } });
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(url, { waitUntil: "networkidle2" });
  return { browser, page };
}

/**
 * Fetch a same-origin URL from inside the page (cookies and challenge clearance apply).
 *
 * @param {any} page - Puppeteer page.
 * @param {string} url - URL.
 * @returns {Promise<Buffer | null>} Body.
 */
async function fetchInPage(page, url) {
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u);
    if (!r.ok) return null;
    const a = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
    return btoa(s);
  }, url);
  return b64 ? Buffer.from(b64, "base64") : null;
}

/**
 * Browser-backed fetchers. Each stream launches its own Chrome lazily.
 *
 * @param {string} vendor - Profile vendor.
 * @param {{ county: string, host?: string, baseUrl: string }} profile - Profile.
 * @param {{ chromePath: string, pageConcurrency?: number }} options - Chrome and parallel pages.
 * @returns {(record: Record<string, any>) => Promise<{ files: { name: string, bytes: Buffer, contentType: string }[], sourceUrl: string }>}
 *   Fetcher.
 */
export function browserDocumentFetcher(vendor, profile, options) {
  let session = null;
  const pageConcurrency = options.pageConcurrency ?? 6;
  const pageDelayMs = options.pageDelayMs ?? 0;
  const pad = (n) => `page-${String(n).padStart(4, "0")}.png`;

  const withClose = (fn) => Object.assign(fn, { close: async () => { if (session) await session.browser.close().catch(() => {}); } });

  if (vendor === "publicsearch") {
    // The site's own "fetch-a-document" answer carries signed URLs for every page.
    const docs = new Map();
    const start = async () => {
      if (session) await session.browser.close().catch(() => {});
      session = await openBrowserPage(options.chromePath, `https://${profile.host}/`);
      const cdp = await session.page.createCDPSession();
      await cdp.send("Network.enable");
      cdp.on("Network.webSocketFrameReceived", (event) => {
        const data = event.response.payloadData;
        if (!data.includes('"type":"document"')) return;
        try {
          const message = JSON.parse(data);
          if (message.type === "document" && Array.isArray(message.payload?.urls)) docs.set(String(message.payload.id), message.payload.urls);
        } catch {}
      });
      await session.page.waitForFunction(() => Boolean(globalThis.socket)).catch(async (error) => {
        if (await isChallenge(session.page)) throw new InteractiveChallengeError(profile.host);
        throw error;
      });
    };
    // Re-open the document to get a fresh set of signed page URLs (they expire quickly, so
    // the later pages of a long document need re-signing part way through).
    const freshUrls = async (docId) => {
      docs.delete(docId);
      await session.page.evaluate((id) => { history.pushState({}, "", `/doc/${id}`); dispatchEvent(new PopStateEvent("popstate")); }, docId);
      let urls = null;
      for (let i = 0; i < 60 && !urls; i += 1) { urls = docs.get(docId) ?? null; if (!urls) await new Promise((r) => setTimeout(r, 250)); }
      return urls;
    };
    return withClose(async (record) => {
      if (!session || !session.browser.connected) await start();
      const docId = String(record.source?.docId);
      let urls = await freshUrls(docId);
      if (!urls) {
        if (await isChallenge(session.page)) throw new InteractiveChallengeError(profile.host);
        await start();
        throw new Error(`no page list for doc ${docId}`);
      }
      const files = new Array(urls.length);
      // Signed URLs expire, so fetch in rounds: each round re-signs and retries only the
      // pages still missing, newest URLs first. Give up after a few rounds.
      for (let round = 0; round < 6; round += 1) {
        const missing = [];
        for (let i = 0; i < files.length; i += 1) if (!files[i]) missing.push(i);
        if (missing.length === 0) break;
        if (round > 0) {
          const fresh = await freshUrls(docId);
          if (fresh && fresh.length === urls.length) urls = fresh;
        }
        let m = 0;
        await Promise.all(Array.from({ length: Math.min(pageConcurrency, missing.length) }, async () => {
          while (m < missing.length) {
            const i = missing[m]; m += 1;
            let bytes = null;
            for (let attempt = 1; attempt <= 3 && !bytes; attempt += 1) {
              bytes = await fetchInPage(session.page, urls[i]);
              if (!bytes) await new Promise((r) => setTimeout(r, 500 * attempt));
            }
            if (bytes) files[i] = { name: pad(i + 1), bytes, contentType: "image/png" };
            if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
          }
        }));
      }
      const firstMissing = files.findIndex((f) => !f);
      if (firstMissing !== -1) {
        if (await isChallenge(session.page)) throw new InteractiveChallengeError(profile.host);
        throw new Error(`page ${firstMissing + 1} of doc ${docId} failed`);
      }
      return { files, sourceUrl: `https://${profile.host}/doc/${docId}` };
    });
  }

  if (vendor === "maricopa-recorder-api") {
    // Unofficial PDF from the legacy recorder site (same-origin, behind Cloudflare). The
    // endpoint throttles under load, returning a redirect instead of the PDF, so a failed
    // fetch is usually transient: retry with back-off and a fresh page before giving up.
    const open = async () => { session = await openBrowserPage(options.chromePath, "https://legacy.recorder.maricopa.gov/recdocdata/"); };
    return withClose(async (record) => {
      if (!session || !session.browser.connected) await open();
      const url = `https://legacy.recorder.maricopa.gov/recdocdata/unofficialpdfdocs.aspx?rec=${encodeURIComponent(record.instrumentNumber)}&suf=&pg=1&isAffidavit=false&cls=RecorderDocuments`;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const bytes = await fetchInPage(session.page, url).catch(() => null);
        if (bytes && bytes.subarray(0, 5).toString() === "%PDF-") {
          return { files: [{ name: "document.pdf", bytes, contentType: "application/pdf" }], sourceUrl: url };
        }
        // Throttled or redirected: wait, re-open the page (fresh session), and try again.
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          await session.browser.close().catch(() => {});
          await open();
        }
      }
      throw new Error(`no PDF for ${record.instrumentNumber}`);
    });
  }

  if (vendor === "aumentum-recorder") {
    // Full pages from the LEADTOOLS viewer: PN = page, region = the page's own size.
    const ensure = async () => {
      if (session && session.browser.connected) return;
      session = await openBrowserPage(options.chromePath, `${profile.baseUrl}/`);
      const accept = await session.page.$('a[href*="lnkAccept"]');
      if (accept) await Promise.all([session.page.waitForNavigation({ waitUntil: "networkidle2" }), accept.click()]);
    };
    const tileUrl = (page) => page.evaluate(() => {
      let s = null;
      const walk = (w) => { try { for (const e of w.performance.getEntriesByType("resource")) if (/leadgen.*WIV=true/.test(e.name)) s = e.name; for (let k = 0; k < w.frames.length; k += 1) walk(w.frames[k]); } catch {} };
      walk(window);
      return s;
    });
    const fullPage = (t, p) => {
      const u = new URL(t);
      const w = u.searchParams.get("OIW") ?? "2550";
      const h = u.searchParams.get("OIH") ?? "4200";
      for (const [k, v] of Object.entries({ PN: p, SRL: 0, SRT: 0, SRW: w, SRH: h, SIW: w, SIH: h })) u.searchParams.set(k, String(v));
      return u.toString();
    };
    // The viewer only serves a document after a search ran in this session.
    let searchedDay = null;
    const searchDay = async (isoDay) => {
      if (searchedDay === isoDay) return;
      const p = session.page;
      await p.goto(`${profile.baseUrl}/RealEstate/SearchEntry.aspx`, { waitUntil: "networkidle2" });
      await p.evaluate((day) => {
        const [y, m, d] = day.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        ig_controls.cphNoMargin_f_ddcDateFiledFrom.set_value(date);
        ig_controls.cphNoMargin_f_ddcDateFiledTo.set_value(date);
        const box = document.querySelector('input[name$="dclDocType$53"]');
        if (box) box.checked = true;
      }, isoDay);
      await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }), p.click('input[name$="SearchButtons1$btnSearch"]')]);
      searchedDay = isoDay;
    };
    return withClose(async (record) => {
      await ensure();
      await searchDay(record.recordDate ?? "2026-11-02");
      const page = await session.browser.newPage();
      page.setDefaultTimeout(90_000);
      try {
        // The viewer keeps loading tiles, so wait for the document, not for network idle.
        await page.goto(record.source.detailUrl, { waitUntil: "domcontentloaded" });
        let tile = null;
        for (let i = 0; i < 40 && !tile; i += 1) {
          const t = await tileUrl(page);
          if (t) { const probe = await fetchInPage(page, fullPage(t, 1)); if (probe && probe.length > 10_000) tile = t; }
          if (!tile) await new Promise((r) => setTimeout(r, 750));
        }
        if (!tile) throw new Error(`viewer did not load ${record.instrumentNumber}`);
        const pages = await page.evaluate(() => Number((document.body.innerText.match(/# Pages in Image:\s*(\d+)/) || [])[1] || 1));
        const files = [];
        for (let p = 1; p <= pages; p += 1) {
          const bytes = await fetchInPage(page, fullPage(tile, p));
          if (!bytes) throw new Error(`page ${p} of ${record.instrumentNumber} failed`);
          files.push({ name: pad(p), bytes, contentType: "image/png" });
        }
        return { files, sourceUrl: record.source.detailUrl };
      } finally {
        await page.close().catch(() => {});
      }
    });
  }
  throw new Error(`No browser document fetcher for vendor ${vendor}`);
}

/**
 * Fetch documents for index records and store them in S3.
 *
 * @param {{
 *   records: Record<string, any>[],
 *   fetchDocument: (record: Record<string, any>) => Promise<{ bytes: Uint8Array, contentType: string, sourceUrl: string }>,
 *   s3: { send: (command: any) => Promise<any> },
 *   commands: { PutObjectCommand: any, GetObjectCommand: any },
 *   bucket: string,
 *   limit: number,
 *   delayMs?: number,
 *   concurrency?: number,
 *   makeFetcher?: () => (record: Record<string, any>) => Promise<{ bytes: Uint8Array, contentType: string, sourceUrl: string }>,
 *   now?: () => Date,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} input - Run inputs.
 * @returns {Promise<{ stored: number, skipped: number, failed: number, bytes: number }>} Summary.
 */
export async function storeDocuments(input) {
  const now = input.now ?? (() => new Date());
  const delayMs = input.delayMs ?? 2_000;
  const concurrency = Math.max(1, input.concurrency ?? 1);
  // One fetcher per stream so each keeps its own portal session.
  const makeFetcher = input.makeFetcher ?? (() => input.fetchDocument);
  const counts = { stored: 0, skipped: 0, failed: 0, bytes: 0 };
  const queue = input.records.slice(0, input.limit);
  let next = 0;

  async function worker() {
    const fetchDocument = makeFetcher();
    try {
      await drain(fetchDocument);
    } finally {
      // Browser-backed fetchers hold a Chrome; close it so the run can exit.
      await fetchDocument.close?.().catch(() => {});
    }
  }

  async function drain(fetchDocument) {
    let requested = 0;
    while (next < queue.length && !counts.challenge) {
      const record = queue[next];
      next += 1;
      const prefix = documentPrefix(record);
      try {
        const existing = await input.s3
          .send(new input.commands.GetObjectCommand({ Bucket: input.bucket, Key: `${prefix}/index.json` }))
          .then(async (out) => JSON.parse(await out.Body.transformToString()))
          .catch(() => null);
        if (existing?.sha256 || existing?.files) {
          counts.skipped += 1;
          continue;
        }
        if (requested > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        requested += 1;
        const started = Date.now();
        const document = await fetchDocument(record);
        // A document is one PDF (bytes) or a list of page images (files).
        const parts = document.files ?? [
          { name: `document.${document.contentType === "application/pdf" ? "pdf" : "bin"}`, bytes: document.bytes, contentType: document.contentType },
        ];
        const files = [];
        for (const part of parts) {
          const digest = createHash("sha256").update(part.bytes).digest("hex");
          await input.s3.send(
            new input.commands.PutObjectCommand({
              Bucket: input.bucket,
              Key: `${prefix}/${part.name}`,
              Body: part.bytes,
              ContentType: part.contentType,
              ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
            }),
          );
          files.push({ key: `${prefix}/${part.name}`, bytes: part.bytes.byteLength, sha256: digest });
        }
        const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
        const sha256 = files.length === 1 ? files[0].sha256 : createHash("sha256").update(files.map((f) => f.sha256).join("")).digest("hex");
        const index = {
          requestIdentifier: record.requestIdentifier,
          county: record.county,
          state: record.state,
          instrumentNumber: record.instrumentNumber,
          recordDate: record.recordDate,
          docType: record.docType ?? null,
          sourceUrl: document.sourceUrl,
          objectKey: files[0].key,
          contentType: parts[0].contentType,
          bytes: totalBytes,
          pages: files.length > 1 ? files.length : undefined,
          files,
          sha256,
          fetchSeconds: Math.round((Date.now() - started) / 100) / 10,
          storedAt: now().toISOString(),
        };
        await input.s3.send(
          new input.commands.PutObjectCommand({
            Bucket: input.bucket,
            Key: `${prefix}/index.json`,
            Body: JSON.stringify(index, null, 2),
            ContentType: "application/json",
          }),
        );
        counts.stored += 1;
        counts.bytes += totalBytes;
        input.onProgress?.({ event: "document_stored", instrument: record.instrumentNumber, recordDate: record.recordDate, bytes: index.bytes, seconds: index.fetchSeconds, stored: counts.stored });
      } catch (error) {
        if (error?.code === "INTERACTIVE_CHALLENGE") {
          // Stop every worker: the site wants a human check, which is never clicked or solved.
          counts.challenge = String(error.message);
          input.onProgress?.({ event: "document_challenge_stop", instrument: record.instrumentNumber, error: counts.challenge });
          break;
        }
        counts.failed += 1;
        input.onProgress?.({ event: "document_failed", instrument: record.instrumentNumber, error: String(error?.message ?? error) });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return counts;
}
