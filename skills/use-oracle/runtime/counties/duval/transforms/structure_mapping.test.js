"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const SCRIPT_PATH = path.join(__dirname, "structureMapping.js");

function building(number, exteriorWall, roofStructure, roofCovering) {
  return `
    <div class="actualBuildingData">
      <span id="building_${number}_lblBuildingNumber">Building ${number}</span>
      <span id="building_${number}_lblYearBuilt">2000</span>
      <table id="building_${number}_gridBuildingElements">
        <tr><th>Element</th><th>Code</th><th>Detail</th></tr>
        <tr><td>Exterior Wall</td><td>1</td><td>${exteriorWall}</td></tr>
        <tr><td>Roof Struct</td><td>1</td><td>${roofStructure}</td></tr>
        <tr><td>Roofing Cover</td><td>1</td><td>${roofCovering}</td></tr>
      </table>
    </div>`;
}

test("maps Duval structure labels containing spaces and periods", () => {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "duval-structure-"));
  try {
    writeFileSync(
      path.join(tempDirectory, "input.html"),
      `<html><body>
        <span id="ctl00_cphBody_lblRealEstateNumber">123456-7890</span>
        <span id="ctl00_cphBody_lblNumberOfBuildings">3</span>
        <div id="details_buildings">
          ${building(1, "15 Concrete Blk", "4 Wood Truss", "4 Built Up")}
          ${building(2, "17 C.B.", "5 Wood Rafter", "6 Conc Tile")}
          ${building(3, "20 Face Brick", "9 Bar J", "12 Modular Metal")}
        </div>
      </body></html>`,
      "utf8",
    );

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempDirectory,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const output = JSON.parse(
      readFileSync(
        path.join(tempDirectory, "owners", "structure_data.json"),
        "utf8",
      ),
    );
    const records = output["property_123456-7890"].map((item) => item.record);

    assert.deepEqual(
      records.map((record) => record.exterior_wall_material_primary),
      ["Concrete Block", "Concrete Block", "Brick"],
    );
    assert.deepEqual(
      records.map((record) => record.roof_covering_material),
      ["Built-Up Roof", "Concrete Tile", "Metal Standing Seam"],
    );
    assert.deepEqual(
      records.map((record) => record.roof_structure_material),
      ["Wood Truss", "Wood Rafter", "Steel Truss"],
    );
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
