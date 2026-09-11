// Utility mapping script
// Reads input.html, parses with cheerio, and writes owners/utilities_data.json per schema

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function readInputHtml() {
  const inputPath = path.join(process.cwd(), "input.html");
  return fs.readFileSync(inputPath, "utf8");
}

function textNormalize(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function main() {
  const html = readInputHtml();
  const $ = cheerio.load(html);

  // Alt Key as property id
  const altKeyCell = $('td.property_field:contains("Alternate Key:")').first();
  const altKey =
    textNormalize(altKeyCell.next("td.property_item").text()) || null;
  const propKey = altKey ? `property_${altKey}` : "property_unknown";

  // Central A/C: Yes/No -> map to cooling system
  const summaryTable = $(".property_building_summary").first();
  let cooling_system_type = null;
  let hvac_condensing_unit_present = null; // string type per schema
  let hvac_unit_condition = null;
  let hvac_unit_issues = null;

  const acCell = summaryTable
    .find("td")
    .filter((i, el) => /Central A\/C:/i.test($(el).text()))
    .first();
  if (acCell.length) {
    const acText = textNormalize(acCell.text());
    if (/Central A\/C:\s*Yes/i.test(acText)) {
      cooling_system_type = "CentralAir";
      hvac_condensing_unit_present = "Yes";
    } else if (/Central A\/C:\s*No/i.test(acText)) {
      cooling_system_type = null; // unknown
      hvac_condensing_unit_present = "No";
    }
  }

  // Other utilities not present in the HTML, set to null or sensible defaults per schema
  const utility = {
    cooling_system_type: cooling_system_type || null,
    heating_system_type: null,
    public_utility_type: null,
    sewer_type: null,
    water_source_type: null,
    plumbing_system_type: null,
    plumbing_system_type_other_description: null,
    electrical_panel_capacity: null,
    electrical_wiring_type: null,
    hvac_condensing_unit_present: hvac_condensing_unit_present || null,
    electrical_wiring_type_other_description: null,
    solar_panel_present: false,
    solar_panel_type: null,
    solar_panel_type_other_description: null,
    smart_home_features: null,
    smart_home_features_other_description: null,
    hvac_unit_condition: hvac_unit_condition || null,
    solar_inverter_visible: false,
    hvac_unit_issues: hvac_unit_issues || null,
  };

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "utilities_data.json");

  const payload = {};
  payload[propKey] = utility;

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} for ${propKey}`);
}

try {
  main();
} catch (err) {
  console.error("Error in utilityMapping:", err.message);
  process.exit(1);
}
