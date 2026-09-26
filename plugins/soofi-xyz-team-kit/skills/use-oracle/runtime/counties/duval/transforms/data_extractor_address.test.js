"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const SCRIPT_PATH = path.join(__dirname, "data_extractor.js");

test("address.json carries lexicon provenance so unnormalized oneOf can match", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "duval-address-"));
  try {
    writeFileSync(
      path.join(tempDirectory, "input.html"),
      `<html><body>
        <span id="ctl00_cphBody_lblRealEstateNumber">0000010005R</span>
        <span id="ctl00_cphBody_lblPropertyUse">0000 Vacant</span>
        <span id="ctl00_cphBody_lblPrimarySiteAddressLine1">N US 301 HWY</span>
        <span id="ctl00_cphBody_lblPrimarySiteAddressLine2">JACKSONVILLE FL 32234</span>
      </body></html>`,
      "utf8",
    );
    writeFileSync(
      path.join(tempDirectory, "unnormalized_address.json"),
      JSON.stringify({
        full_address: "N US 301 HWY, JACKSONVILLE FL 32234",
        county_jurisdiction: "Duval",
        latitude: 30.35,
        longitude: -81.95,
        request_identifier: "0000010005R",
      }),
      "utf8",
    );
    writeFileSync(
      path.join(tempDirectory, "property_seed.json"),
      JSON.stringify({
        parcel_id: "0000010005",
        request_identifier: "0000010005R",
        source_http_request: {
          method: "GET",
          url: "https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=0000010005R",
        },
      }),
      "utf8",
    );

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempDirectory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const address = JSON.parse(
      readFileSync(path.join(tempDirectory, "data", "address.json"), "utf8"),
    );
    assert.equal(
      address.unnormalized_address,
      "N US 301 HWY, JACKSONVILLE FL 32234",
    );
    assert.equal(address.request_identifier, "0000010005R");
    assert.equal(address.source_http_request.method, "GET");
    assert.equal(
      address.source_http_request.url,
      "https://paopropertysearch.coj.net/Basic/Detail.aspx",
    );
    assert.deepEqual(address.source_http_request.multiValueQueryString, {
      RE: ["0000010005R"],
    });
    assert.equal(address.county_name, "Duval");
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
