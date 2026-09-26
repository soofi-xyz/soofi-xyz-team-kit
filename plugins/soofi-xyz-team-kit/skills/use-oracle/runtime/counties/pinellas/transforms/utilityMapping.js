const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extractStrap($, rawHtml) {
  let strap = null;
  const scriptsText = $("script")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");
  const match = scriptsText.match(/var\s+g_strap\s*=\s*"(\d+)"/);
  if (match) strap = match[1];
  if (!strap) {
    const pn = $("#pacel_no").text().trim();
    if (pn) strap = pn.replace(/\D/g, "");
  }
  return strap || "unknown_id";
}

function parseIntSafe(txt) {
  if (txt == null) return null;
  const numeric = String(txt).replace(/[^0-9-]/g, "");
  if (!numeric) return null;
  const value = parseInt(numeric, 10);
  return Number.isNaN(value) ? null : value;
}

function getStructuralValue($, $panel, label) {
  const lowerLabel = label.toLowerCase();
  const row = $panel
    .find("table.table-bordered")
    .filter((_, tbl) => {
      const header = $(tbl).find("thead th").first().text().trim().toLowerCase();
      return header.includes("structural elements");
    })
    .first()
    .find("tbody tr")
    .filter((_, tr) => {
      const key = $(tr).find("td").first().text().trim().toLowerCase();
      return key.startsWith(lowerLabel);
    })
    .first();

  if (!row.length) return null;
  return row.find("td").eq(1).text().trim() || null;
}

function mapCoolingSystemType(raw) {
  const text = (raw || "").trim().toLowerCase();
  if (!text) return null;

  if (text.includes("central") || text.includes("heat & cooling pkg") || text.includes("ac package")) {
    return "CentralAir";
  }
  if (text.includes("window")) {
    return "WindowAirConditioner";
  }
  if (text.includes("ductless") || text.includes("mini split") || text.includes("mini-split")) {
    return "Ductless";
  }
  if (text.includes("whole house fan")) {
    return "WholeHouseFan";
  }
  if (text.includes("ceiling fans")) {
    return "CeilingFans";
  }
  if (text.includes("ceiling fan")) {
    return "CeilingFan";
  }
  if (text.includes("geothermal")) {
    return "GeothermalCooling";
  }
  if (text.includes("hybrid")) {
    return "Hybrid";
  }
  if (text.includes("zoned")) {
    return "Zoned";
  }
  if (text.includes("electric")) {
    return "Electric";
  }
  return null;
}

function mapHeatingSystemType(raw) {
  const text = (raw || "").trim().toLowerCase();
  if (!text) return null;

  if (text.includes("heat & cooling pkg") || text.includes("central")) {
    return "Central";
  }
  if (text.includes("heat pump")) {
    return "HeatPump";
  }
  if (text.includes("electric furnace")) {
    return "ElectricFurnace";
  }
  if (text.includes("electric")) {
    return "Electric";
  }
  if (text.includes("gas furnace")) {
    return "GasFurnace";
  }
  if (text.includes("gas")) {
    return "Gas";
  }
  if (text.includes("radiant")) {
    return "Radiant";
  }
  if (text.includes("baseboard")) {
    return "Baseboard";
  }
  if (text.includes("solar")) {
    return "Solar";
  }
  if (text.includes("ductless") || text.includes("mini split") || text.includes("mini-split")) {
    return "Ductless";
  }
  if (text.includes("oil")) {
    return "Oil";
  }
  return null;
}

function buildUtilities($, strap) {
  const utilities = [];

  $("div.panel-body[id^='structural_']").each((idx, panelEl) => {
    const $panel = $(panelEl);
    const buildingNumber = idx + 1;

    const coolingRaw = getStructuralValue($, $panel, "Cooling");
    const heatingRaw = getStructuralValue($, $panel, "Heating");
    const fixturesRaw = getStructuralValue($, $panel, "Fixtures");

    const utility = {
      request_identifier: strap,
      source_http_request: {
        method: "GET",
        url: `https://www.pcpao.gov/property-details?s=${strap}`,
      },
      building_number: buildingNumber,
      cooling_system_type: mapCoolingSystemType(coolingRaw),
      heating_system_type: mapHeatingSystemType(heatingRaw || coolingRaw),
      plumbing_fixture_count: parseIntSafe(fixturesRaw),
      public_utility_type: null,
      sewer_type: null,
      water_source_type: null,
      plumbing_system_type: null,
      plumbing_system_type_other_description: null,
      electrical_panel_capacity: null,
      electrical_wiring_type: null,
      hvac_condensing_unit_present: null,
      electrical_wiring_type_other_description: null,
      solar_panel_present: null,
      solar_panel_type: null,
      solar_panel_type_other_description: null,
      smart_home_features: null,
      smart_home_features_other_description: null,
      hvac_unit_condition: null,
      solar_inverter_visible: null,
      hvac_unit_issues: null,
    };

    utilities.push(utility);
  });

  return utilities;
}

(function main() {
  try {
    const rawHtml = fs.readFileSync("input.html", "utf8");
    const $ = cheerio.load(rawHtml);

    const strap = extractStrap($, rawHtml);
    const utilities = buildUtilities($, strap);

    const outDir = path.join("owners");
    ensureDir(outDir);
    const outPath = path.join(outDir, "utilities_data.json");

    const key = `property_${strap}`;
    const payload = {};
    payload[key] = { utilities };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote utility data for ${key} to ${outPath}`);
  } catch (err) {
    console.error("Error building utility data:", err);
    process.exit(1);
  }
})();
