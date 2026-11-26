import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { requireMortgageProfile } from "../src/counties/mortgage-profiles.mjs";
import {
  createAcclaimSession,
  parseAcclaimAmount,
  parseAcclaimDate,
  parseAcclaimDetails,
} from "../src/mortgage/acclaim.mjs";
import {
  harvestMortgageDocuments,
  parseInstrumentList,
} from "../src/mortgage/harvest.mjs";
import {
  pinAndVerify,
  pinConfigFromEnv,
  sha256Hex,
} from "../src/mortgage/ipfs-pin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const detailsHtml = await readFile(
  path.join(here, "fixtures/mortgage/acclaim-details.html"),
  "utf8",
);
const pdfBytes = new TextEncoder().encode("%PDF-1.4\nfake scanned mortgage\n%%EOF");
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const directory = await mkdtemp(path.join(tmpdir(), "mortgage-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Fake Acclaim portal plus Kubo RPC/gateway.
 *
 * @param {{ docType?: string, gatewayBytes?: Uint8Array }} [options]
 */
function fakeFetch(options = {}) {
  const calls = [];
  const html = options.docType
    ? detailsHtml.replace("MTG - MORTGAGE", options.docType)
    : detailsHtml;
  /** @type {typeof fetch} */
  const impl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, method: init.method ?? "GET", headers: init.headers });
    if (href.includes("/search/Disclaimer")) {
      return init.method === "POST"
        ? new Response("", {
            status: 302,
            headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/" },
          })
        : new Response("<form></form>", { status: 200 });
    }
    if (href.includes("/Details/GetDocumentByInstrumentNumber/")) {
      return new Response("<html></html>", { status: 200 });
    }
    if (href.includes("/details/JumpToInstrumentNumber/2/")) {
      return new Response(html, { status: 200 });
    }
    if (href.includes("/Image/StartImageRetrieval/")) {
      return new Response("ok", { status: 200 });
    }
    if (href.includes("/Image/DocumentPdfAllPages/")) {
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    if (href.startsWith("https://rpc.example/api/v0/add")) {
      return new Response(
        `${JSON.stringify({ Name: "x.pdf", Hash: CID, Size: "42" })}\n`,
        { status: 200 },
      );
    }
    if (href === `https://gateway.example/ipfs/${CID}`) {
      return new Response(options.gatewayBytes ?? pdfBytes, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, calls };
}

const pinConfig = {
  api: "https://rpc.example",
  gateway: "https://gateway.example",
  token: "dGVzdA==",
};

describe("parseAcclaimDetails", () => {
  it("parses index facts from an Acclaim detail page", () => {
    const facts = parseAcclaimDetails(detailsHtml);
    expect(facts).toEqual({
      transactionItemId: "TESTITEMID0000000000000000000000",
      instrumentNumber: "2025000001",
      recordDate: "2025-06-04",
      bookType: "OR",
      book: "20000",
      page: "100",
      pageCount: 21,
      docTypeCode: "MTG",
      docType: "MORTGAGE",
      grantors: ["DOE JANE", "ROE JOHN"],
      grantees: [
        "BANK OF AMERICA N A",
        "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC",
      ],
      consideration: 255000,
      executionDate: "2025-05-23",
      legalDescriptions: ["L 1 EXAMPLE SUBDIVISION"],
    });
  });

  it("fails closed when the session lost the document", () => {
    expect(() => parseAcclaimDetails("<html>error</html>")).toThrow(
      /no transaction item id/,
    );
  });

  it("parses dates and amounts", () => {
    expect(parseAcclaimDate("5/23/2025 12:00:00 AM")).toBe("2025-05-23");
    expect(parseAcclaimDate("")).toBeNull();
    expect(parseAcclaimAmount("$1,234.50")).toBe(1234.5);
    expect(parseAcclaimAmount("n/a")).toBeNull();
  });
});

describe("createAcclaimSession", () => {
  it("accepts the disclaimer once and carries the session cookie", async () => {
    const { impl, calls } = fakeFetch();
    const session = createAcclaimSession({
      baseUrl: "https://or.example/",
      fetchImpl: impl,
    });
    const details = await session.fetchDetails("2025000001");
    await session.fetchDetails("2025000001").catch(() => {});
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].href).toBe(
      "https://or.example/search/Disclaimer?st=/search/SearchTypeInstrumentNumber",
    );
    const jump = calls.find((call) => call.href.includes("JumpToInstrumentNumber"));
    expect(jump.headers.cookie).toContain("ASP.NET_SessionId=abc");
    expect(details.url).toBe(
      "https://or.example/Details/GetDocumentByInstrumentNumber/OR/2025000001",
    );
  });

  it("rejects a mismatched instrument and non-PDF documents", async () => {
    const { impl } = fakeFetch();
    const session = createAcclaimSession({ baseUrl: "https://or.example", fetchImpl: impl });
    await expect(session.fetchDetails("2025000002")).rejects.toThrow(
      /returned instrument 2025000001/,
    );
    await expect(session.fetchDetails("12a")).rejects.toThrow(/Invalid instrument/);
    const htmlOnly = createAcclaimSession({
      baseUrl: "https://or.example",
      fetchImpl: async () => new Response("<html>", { status: 200 }),
    });
    await expect(htmlOnly.fetchDocumentPdf("X")).rejects.toThrow(/did not return a PDF/);
  });
});

describe("pinAndVerify", () => {
  it("returns a receipt only after the gateway bytes match", async () => {
    const { impl, calls } = fakeFetch();
    const receipt = await pinAndVerify({
      bytes: pdfBytes,
      fileName: "duval-or-2025000001.pdf",
      contentType: "application/pdf",
      config: pinConfig,
      fetchImpl: impl,
    });
    expect(receipt).toMatchObject({
      cid: CID,
      ipfsUrl: `ipfs://${CID}`,
      sha256: sha256Hex(pdfBytes),
      bytes: pdfBytes.byteLength,
    });
    const add = calls.find((call) => call.href.includes("/api/v0/add"));
    expect(add.href).toContain("cid-version=1");
    expect(add.headers.authorization).toBe("Bearer dGVzdA==");
  });

  it("fails when the gateway serves different bytes", async () => {
    const { impl } = fakeFetch({ gatewayBytes: new TextEncoder().encode("other") });
    await expect(
      pinAndVerify({ bytes: pdfBytes, fileName: "a.pdf", config: pinConfig, fetchImpl: impl }),
    ).rejects.toThrow(/hashed to/);
  });

  it("builds a Filebase token from the environment without exposing it", () => {
    const config = pinConfigFromEnv({
      FILEBASE_ACCESS_KEY: "k",
      FILEBASE_SECRET_KEY: "s",
      FILEBASE_BUCKET: "b",
    });
    expect(config.api).toBe("https://rpc.filebase.io");
    expect(Buffer.from(config.token, "base64").toString()).toBe("k:s:b");
    expect(() => pinConfigFromEnv({})).toThrow(/FILEBASE_ACCESS_KEY/);
  });
});

describe("parseInstrumentList", () => {
  it("reads bare instruments, columns and request identifiers", () => {
    expect(parseInstrumentList("2025000001\n2025000002\n2025000001\n", "duval-or")).toEqual([
      "2025000001",
      "2025000002",
    ]);
    expect(
      parseInstrumentList("request_identifier,lender\nduval-or:2025000003,X\n", "duval-or"),
    ).toEqual(["2025000003"]);
    expect(() =>
      parseInstrumentList("request_identifier\nhillsborough-or:1\n", "duval-or"),
    ).toThrow(/does not match prefix/);
  });
});

describe("harvestMortgageDocuments", () => {
  const profile = requireMortgageProfile("duval");
  const fixedNow = () => new Date("2026-11-26T12:00:00.000Z");

  it("writes index, document, pin and a ready marker, then skips on resume", async () => {
    const outputDir = await tempDir();
    const { impl, calls } = fakeFetch();
    const first = await harvestMortgageDocuments({
      profile,
      jobId: "pilot-1",
      instruments: ["2025000001"],
      outputDir,
      pin: pinConfig,
      delayMs: 0,
      fetchImpl: impl,
      now: fixedNow,
    });
    expect(first.counts).toEqual({ ready: 1, skipped: 0, invalid: 0, failed: 0 });

    const dir = path.join(outputDir, "duval", "pilot-1", "2025000001");
    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    expect(index).toMatchObject({
      schemaVersion: "elephant.mortgage-index.v1",
      requestIdentifier: "duval-or:2025000001",
      consideration: 255000,
      grantees: ["BANK OF AMERICA N A", "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC"],
    });
    const ready = JSON.parse(await readFile(path.join(dir, "ready.json"), "utf8"));
    expect(ready.pin).toEqual({ cid: CID, ipfsUrl: `ipfs://${CID}` });
    expect(ready.documentSha256).toBe(sha256Hex(pdfBytes));

    const before = calls.length;
    const second = await harvestMortgageDocuments({
      profile,
      jobId: "pilot-1",
      instruments: ["2025000001"],
      outputDir,
      pin: pinConfig,
      delayMs: 0,
      fetchImpl: impl,
      now: fixedNow,
    });
    expect(second.counts).toEqual({ ready: 0, skipped: 1, invalid: 0, failed: 0 });
    expect(calls.length).toBe(before);
  });

  it("re-captures when a file under the ready marker changed", async () => {
    const outputDir = await tempDir();
    const { impl } = fakeFetch();
    const run = () =>
      harvestMortgageDocuments({
        profile,
        jobId: "pilot-2",
        instruments: ["2025000001"],
        outputDir,
        delayMs: 0,
        fetchImpl: impl,
        now: fixedNow,
      });
    await run();
    await writeFile(
      path.join(outputDir, "duval", "pilot-2", "2025000001", "document.pdf"),
      "tampered",
    );
    expect((await run()).counts.ready).toBe(1);
  });

  it("marks non-mortgage instruments invalid and records failures", async () => {
    const outputDir = await tempDir();
    const deed = fakeFetch({ docType: "D - DEED" });
    const result = await harvestMortgageDocuments({
      profile,
      jobId: "pilot-3",
      instruments: ["2025000001", "2025000009"],
      outputDir,
      delayMs: 0,
      fetchImpl: deed.impl,
      now: fixedNow,
    });
    expect(result.counts).toEqual({ ready: 0, skipped: 0, invalid: 1, failed: 1 });
    const failed = JSON.parse(
      await readFile(
        path.join(outputDir, "duval", "pilot-3", "2025000009", "failed.json"),
        "utf8",
      ),
    );
    expect(failed.error).toMatch(/returned instrument 2025000001/);
  });
});
