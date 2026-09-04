"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const SCRIPT_PATH = path.join(__dirname, "layoutMapping.js");

function runMapping(html, propertyId) {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "duval-layout-"));
  try {
    writeFileSync(path.join(tempDirectory, "input.html"), html, "utf8");

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempDirectory,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const output = JSON.parse(
      readFileSync(
        path.join(tempDirectory, "owners", "layout_data.json"),
        "utf8",
      ),
    );
    return output[`property_${propertyId}`].layouts;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

test("maps effective area and condominium room counts from current Duval markup", () => {
  const layouts = runMapping(
    `<html><body>
      <span id="ctl00_cphBody_lblRealEstateNumber">090177-0592</span>
      <span id="ctl00_cphBody_lblPropertyUse">0400 Residential Condo</span>
      <div id="details_buildings">
        <div class="actualBuildingData">
          <span id="building_1_lblBuildingNumber">Building 1</span>
          <table id="building_1_gridBuildingArea">
            <tr><th>Type</th><th>Gross Area</th><th>Heated Area</th><th>Effective Area</th></tr>
            <tr><td>Base Area</td><td>1320</td><td>1320</td><td>1188</td></tr>
            <tr><td>Total</td><td>1320</td><td>1320</td><td></td></tr>
          </table>
        </div>
      </div>
      <table id="condominium-details">
        <tr><th>Beds</th><td>3</td></tr>
        <tr><th>Baths</th><td>1.5</td></tr>
      </table>
    </body></html>`,
    "090177-0592",
  );
  const records = layouts.map((item) => item.record);
  const building = records.find((record) => record.space_type === "Building");
  const livingArea = records.find(
    (record) => record.space_type === "Living Area",
  );

  assert.equal(building.adjustable_area_sq_ft, 1188);
  assert.equal(livingArea.adjustable_area_sq_ft, 1188);
  const count = (spaceType) =>
    records.filter((record) => record.space_type === spaceType).length;
  assert.equal(count("Building"), 1);
  assert.equal(count("Living Area"), 1);
  assert.equal(count("Primary Bedroom"), 1);
  assert.equal(count("Bedroom"), 2);
  assert.equal(count("Primary Bathroom"), 1);
  assert.equal(count("Full Bathroom"), 0);
  assert.equal(count("Half Bathroom / Powder Room"), 1);
});

test("does not copy parcel-level room counts across multiple buildings", () => {
  const building = (number, attributes) => `
    <div class="actualBuildingData">
      <span id="building_${number}_lblBuildingNumber">Building ${number}</span>
      <table id="building_${number}_gridBuildingArea">
        <tr><th>Type</th><th>Gross Area</th><th>Heated Area</th><th>Effective Area</th></tr>
        <tr><td>Total</td><td>100</td><td>100</td><td></td></tr>
      </table>
      <table id="building_${number}_gridBuildingAttributes">
        <tr><th>Element</th><th>Value</th><th>Detail</th></tr>
        ${attributes}
      </table>
    </div>`;

  const layouts = runMapping(
    `<html><body>
      <span id="ctl00_cphBody_lblRealEstateNumber">123029-0100</span>
      <div id="details_buildings">
        ${building(1, "<tr><td>Baths</td><td>2</td><td></td></tr>")}
        ${building(2, "<tr><td>Restrooms</td><td>4</td><td></td></tr>")}
        ${building(3, "<tr><td>Baths</td><td>0</td><td></td></tr>")}
      </div>
      <table><tr><th>Baths</th><td>26</td></tr></table>
    </body></html>`,
    "123029-0100",
  );
  const bathroomCount = (buildingId) =>
    layouts.filter(
      (item) =>
        item.parent_local_id === buildingId &&
        /Bathroom/.test(item.record.space_type),
    ).length;

  assert.equal(bathroomCount("building_1"), 2);
  assert.equal(bathroomCount("building_2"), 0);
  assert.equal(bathroomCount("building_3"), 0);
  layouts
    .filter((item) => item.record.space_type === "Building")
    .forEach((item) => assert.equal(item.record.adjustable_area_sq_ft, null));
});
