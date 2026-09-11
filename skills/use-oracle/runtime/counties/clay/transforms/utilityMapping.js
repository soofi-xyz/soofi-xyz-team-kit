// Utility mapping script
// Reads input.html, parses building hints for HVAC, and writes owners/utilities_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function readHtml(filepath) {
  const html = fs.readFileSync(filepath, "utf8");
  return cheerio.load(html);
}

const PARCEL_SELECTOR = "#ctlBodyPane_ctl00_ctl01_dynamicSummary_rptrDynamicColumns_ctl00_pnlSingleValue";
const BUILDING_SECTION_TITLE = "Buildings";

function textTrim(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function getParcelId($) {
  let parcelIdText = $(PARCEL_SELECTOR).text().trim();
  if (parcelIdText) {
    return parcelIdText;
  }
  return null;
}

function collectBuildings($) {
  const buildings = [];
  const section = $("section")
    .filter(
      (_, s) =>
        textTrim($(s).find(".module-header .title").first().text()) ===
        BUILDING_SECTION_TITLE,
    )
    .first();

  if (!section.length) return buildings;
  
  $(section).find(".block-row").each((_, blockRow) => {
    const building = {};
    
    $(blockRow).find(".two-column-blocks").each((__, columnBlock) => {
      $(columnBlock).find("table tbody tr").each((___, tr) => {
        const label = textTrim($(tr).find("th strong").first().text());
        const value = textTrim($(tr).find("td span").first().text());
        if (label) building[label] = value;
      });
    });
    
    if (Object.keys(building).length) buildings.push(building);
  });
  
  return buildings;
}

function inferHVAC(building) {
  let cooling_system_type = null;
  let heating_system_type = null;
  let hvac_system_configuration = null;
  let hvac_equipment_component = null;
  let hvac_condensing_unit_present = null;

  const ac = (building["Air Conditioning"] || "").toUpperCase();
  const heat = (building["Heat"] || "").toUpperCase();
  const heatingType = (building["Heating Type"] || "").toUpperCase();
  
  if (ac.includes("CENTRAL")) cooling_system_type = "CentralAir";
  
  // Map heating system types
  const heatText = `${heat} ${heatingType}`.toUpperCase();
  if (heatText.includes("ELECTRIC") && heatText.includes("FURNACE")) heating_system_type = "ElectricFurnace";
  else if (heatText.includes("ELECTRIC")) heating_system_type = "Electric";
  else if (heatText.includes("GAS") && heatText.includes("FURNACE")) heating_system_type = "GasFurnace";
  else if (heatText.includes("GAS")) heating_system_type = "Gas";
  else if (heatText.includes("DUCTLESS")) heating_system_type = "Ductless";
  else if (heatText.includes("RADIANT")) heating_system_type = "Radiant";
  else if (heatText.includes("SOLAR")) heating_system_type = "Solar";
  else if (heatText.includes("HEAT PUMP")) heating_system_type = "HeatPump";
  else if (heatText.includes("CENTRAL") || heatText.includes("AIR DUCTED") || heatText.includes("ENG F AIR")) heating_system_type = "Central";
  else if (heatText.includes("BASEBOARD")) heating_system_type = "Baseboard";

  if (cooling_system_type === "CentralAir") {
    hvac_system_configuration = "SplitSystem";
    hvac_equipment_component = "CondenserAndAirHandler";
    hvac_condensing_unit_present = true;
  }

  return {
    cooling_system_type,
    heating_system_type,
    hvac_system_configuration,
    hvac_equipment_component,
    hvac_condensing_unit_present
  };
}

function defaultUtility(parcelId, buildingNumber, totalBuildings) {
  return {
    source_http_request: {
      method: "GET",
      url: "https://qpublic.schneidercorp.com/application.aspx",
      multiValueQueryString: {
        AppID: ["1207"],
        LayerID: ["36374"],
        PageTypeID: ["4"],
        PageID: ["13872"],
        Q: ["47389550"],
        KeyValue: [parcelId]
      }
    },
    request_identifier: parcelId,
    building_number: buildingNumber,
    utility_index: buildingNumber,
    // number_of_buildings: totalBuildings,
    cooling_system_type: null,
    heating_system_type: null,
    public_utility_type: null,
    sewer_type: null,
    water_source_type: null,
    plumbing_system_type: null,
    plumbing_system_type_other_description: null,
    electrical_panel_capacity: null,
    electrical_wiring_type: null,
    hvac_condensing_unit_present: null,
    electrical_wiring_type_other_description: null,
    solar_panel_present: false,
    solar_panel_type: null,
    solar_panel_type_other_description: null,
    smart_home_features: null,
    smart_home_features_other_description: null,
    hvac_unit_condition: null,
    solar_inverter_visible: false,
    hvac_unit_issues: null,
    electrical_panel_installation_date: null,
    electrical_rewire_date: null,
    hvac_capacity_kw: null,
    hvac_capacity_tons: null,
    hvac_equipment_component: null,
    hvac_equipment_manufacturer: null,
    hvac_equipment_model: null,
    hvac_installation_date: null,
    hvac_seer_rating: null,
    hvac_system_configuration: null,
    plumbing_system_installation_date: null,
    sewer_connection_date: null,
    solar_installation_date: null,
    solar_inverter_installation_date: null,
    solar_inverter_manufacturer: null,
    solar_inverter_model: null,
    water_connection_date: null,
    water_heater_installation_date: null,
    water_heater_manufacturer: null,
    water_heater_model: null,
    well_installation_date: null,
  };
}

function buildUtilityFromBuilding(building, idx, totalBuildings, parcelId) {
  const buildingNumber = idx + 1;
  const base = defaultUtility(parcelId, buildingNumber, totalBuildings);
  const hvac = inferHVAC(building);

  return {
    ...base,
    ...hvac,
  };
}

function buildUtilitiesFromBuildings(buildings, parcelId) {
  const totalBuildings = buildings.length || null;
  return buildings.map((b, idx) =>
    buildUtilityFromBuilding(b, idx, totalBuildings, parcelId),
  );
}

function main() {
  const inputPath = path.resolve("input.html");
  const $ = readHtml(inputPath);
  const parcelId = getParcelId($);
  if (!parcelId) throw new Error("Parcel ID not found");
  const buildings = collectBuildings($);
  const utilities = buildUtilitiesFromBuildings(buildings, parcelId);

  const outDir = path.resolve("owners");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "utilities_data.json");
  const outObj = {};
  outObj[`property_${parcelId}`] = { utilities };
  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}
