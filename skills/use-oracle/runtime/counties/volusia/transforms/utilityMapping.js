// Utility mapping script
// Extracts per-building utility data from input.html and writes owners/utilities_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const UTILITY_PROPERTY_KEYS = [
  "source_http_request",
  "request_identifier",
  "cooling_system_type",
  "electrical_panel_capacity",
  "electrical_panel_installation_date",
  "electrical_rewire_date",
  "electrical_wiring_type",
  "electrical_wiring_type_other_description",
  "heating_fuel_type",
  "heating_system_type",
  "hvac_capacity_kw",
  "hvac_capacity_tons",
  "hvac_condensing_unit_present",
  "hvac_equipment_component",
  "hvac_equipment_manufacturer",
  "hvac_equipment_model",
  "hvac_installation_date",
  "hvac_seer_rating",
  "hvac_system_configuration",
  "hvac_unit_condition",
  "hvac_unit_issues",
  "plumbing_fixture_count",
  "plumbing_fixture_quality",
  "plumbing_fixture_type_primary",
  "plumbing_system_installation_date",
  "plumbing_system_type",
  "plumbing_system_type_other_description",
  "public_utility_type",
  "sewer_connection_date",
  "sewer_type",
  "smart_home_features",
  "smart_home_features_other_description",
  "solar_installation_date",
  "solar_inverter_installation_date",
  "solar_inverter_manufacturer",
  "solar_inverter_model",
  "solar_inverter_visible",
  "solar_panel_present",
  "solar_panel_type",
  "solar_panel_type_other_description",
  "water_connection_date",
  "water_heater_installation_date",
  "water_heater_manufacturer",
  "water_heater_model",
  "water_source_type",
  "well_installation_date",
];

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(label) {
  return cleanText(label).toLowerCase().replace(/[:]/g, "");
}

function extractValueFromStrong($, strongEl) {
  const $strong = $(strongEl);

  const $columnWrapper = $strong.closest("div");
  if ($columnWrapper.length > 0) {
    const siblingValue = $columnWrapper
      .nextAll()
      .filter((_, sibling) => $(sibling).find("strong").length === 0)
      .map((_, sibling) => cleanText($(sibling).text()))
      .get()
      .find((text) => text.length > 0);
    if (siblingValue) return siblingValue;
  }

  const parentNextValue = $strong
    .parent()
    .nextAll()
    .map((_, sibling) => cleanText($(sibling).text()))
    .get()
    .find((text) => text.length > 0);
  if (parentNextValue) return parentNextValue;

  const $tableCell = $strong.closest("td");
  if ($tableCell.length > 0) {
    const tableValue = $tableCell
      .nextAll("td")
      .map((_, sibling) => cleanText($(sibling).text()))
      .get()
      .find((text) => text.length > 0);
    if (tableValue) return tableValue;
  }

  const parentText = cleanText($strong.parent().text());
  const labelText = cleanText($strong.text());
  if (parentText.length > labelText.length) {
    const remainder = cleanText(parentText.replace(labelText, ""));
    if (remainder) return remainder.replace(/^[:\s]+/, "");
  }

  return null;
}

function findValueByLabel($, label) {
  const target = normalizeLabel(label);
  let value = null;
  let found = false;

  $("strong").each((_, strongEl) => {
    if (found) return false;
    const candidate = normalizeLabel($(strongEl).text());
    if (candidate === target) {
      value = extractValueFromStrong($, strongEl);
      found = true;
      return false;
    }
    return undefined;
  });

  if (found) return value;

  $("div, td, th").each((_, node) => {
    if (value) return;
    const nodeText = normalizeLabel($(node).text());
    if (nodeText === target) {
      const siblingValue = $(node)
        .nextAll()
        .map((__, sibling) => cleanText($(sibling).text()))
        .get()
        .find((text) => text.length > 0);
      if (siblingValue) value = siblingValue;
    }
  });

  return value;
}

function getAltKey($) {
  let altkey = $("input#altkey").val();
  if (!altkey) {
    $("div.col-sm-5").each((_, el) => {
      const labelText = cleanText($(el).text());
      if (/alternate key/i.test(labelText)) {
        const valueText = cleanText($(el).next().text());
        if (valueText) altkey = valueText.replace(/[^0-9]/g, "");
      }
    });
  }
  return altkey ? String(altkey) : null;
}

function getParcelId($) {
  const raw = findValueByLabel($, "Parcel ID");
  return raw ? raw.replace(/[^0-9]/g, "") : null;
}

function extractBuildingCards($) {
  const cardsByIndex = new Map();
  $("h5").each((_, headingEl) => {
    const $heading = $(headingEl);
    const text = cleanText($heading.text());
    const match = text.match(/Card\s*\(Bldg\)\s*#\s*(\d+)/i);
    if (!match) return;
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index)) return;

    const sectionNodes = [];
    let $cursor = $heading.next();
    while ($cursor.length > 0) {
      const cursorText = cleanText($cursor.text());
      if ($cursor.is("h5") && /Card\s*\(Bldg\)\s*#/i.test(cursorText)) break;
      sectionNodes.push($cursor);
      $cursor = $cursor.next();
    }

    if (!cardsByIndex.has(index)) {
      cardsByIndex.set(index, {
        buildingIndex: index,
        heading: $heading,
        sectionNodes,
      });
    }
  });
  return Array.from(cardsByIndex.values()).sort(
    (a, b) => a.buildingIndex - b.buildingIndex,
  );
}

function findValueWithinSection($, sectionNodes, label) {
  const target = normalizeLabel(label);
  for (const $section of sectionNodes) {
    let resolved = null;
    $section.find("strong").each((_, strongEl) => {
      const candidate = normalizeLabel($(strongEl).text());
      if (candidate === target && resolved == null) {
        const value = extractValueFromStrong($, strongEl);
        if (value) {
          resolved = value;
          return false;
        }
      }
      return undefined;
    });
    if (resolved != null) return resolved;
  }
  return null;
}

function gatherGlobalUtilitySignals($) {
  return {
    hvacText: findValueByLabel($, "HVAC") || null,
    heatMethodText: findValueByLabel($, "Heat Method") || null,
    heatSourceText: findValueByLabel($, "Heat Source") || null,
    plumbingText: findValueByLabel($, "Plumbing") || null,
    sewerText: findValueByLabel($, "Sewer") || null,
    waterText: findValueByLabel($, "Water") || null,
    electricText: findValueByLabel($, "Electric") || null,
    pageText: cleanText($("body").text()).toLowerCase(),
  };
}

function gatherUtilitySignalsForCard($, card, globalSignals) {
  const signals = {
    hvacText:
      findValueWithinSection($, card.sectionNodes, "HVAC") ||
      globalSignals.hvacText,
    heatMethodText:
      findValueWithinSection($, card.sectionNodes, "Heat Method") ||
      globalSignals.heatMethodText,
    heatSourceText:
      findValueWithinSection($, card.sectionNodes, "Heat Source") ||
      globalSignals.heatSourceText,
    plumbingText:
      findValueWithinSection($, card.sectionNodes, "Plumbing") ||
      globalSignals.plumbingText,
    sewerText:
      findValueWithinSection($, card.sectionNodes, "Sewer") ||
      globalSignals.sewerText,
    waterText:
      findValueWithinSection($, card.sectionNodes, "Water") ||
      globalSignals.waterText,
    electricText:
      findValueWithinSection($, card.sectionNodes, "Electric") ||
      globalSignals.electricText,
  };

  signals.sectionText = card.sectionNodes
    .map(($section) => cleanText($section.text()).toLowerCase())
    .join(" ");
  signals.globalText = globalSignals.pageText;

  return signals;
}

function createBaseUtilityEntry() {
  const entry = {};
  UTILITY_PROPERTY_KEYS.forEach((key) => {
    entry[key] = null;
  });
  return entry;
}

function getSignalText(context, keys = [], options = {}) {
  const { fallback = true } = options;
  for (const key of keys) {
    const value = context.signals[key];
    if (value) return value;
  }
  if (fallback) {
    if (context.signals.sectionText) return context.signals.sectionText;
    if (context.signals.globalText) return context.signals.globalText;
  }
  return null;
}

function parseYearFromText(text) {
  if (!text) return null;
  const match = text.match(/(19|20)\d{2}/);
  return match ? `${match[0]}` : null;
}

function parseIsoDateFromText(text) {
  if (!text) return null;
  const normalized = text.toLowerCase();
  const yearMatch = normalized.match(/(19|20)\d{2}/);
  if (yearMatch) return `${yearMatch[0]}-01-01`;
  const dateMatch = normalized.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    const month = dateMatch[1].padStart(2, "0");
    const day = dateMatch[2].padStart(2, "0");
    let year = dateMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function mapSourceHttpRequest() {
  return null;
}

function mapRequestIdentifier() {
  return null;
}

function mapCoolingSystemType(context) {
  const text = getSignalText(context, ["hvacText", "heatMethodText", "heatSourceText"], {
    fallback: false,
  });
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (/mini\s*split|ductless/.test(normalized)) return "Ductless";
  if (/geothermal/.test(normalized)) return "GeothermalCooling";
  if (/window|wall unit/.test(normalized)) return "WindowAirConditioner";
  if (/heat pump/.test(normalized)) return "HeatPump";
  if (/central|a\/c|hvac/.test(normalized)) return "CentralAir";
  return null;
}

function mapElectricalPanelCapacity(context) {
  const text = getSignalText(context, ["electricText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/(\d{2,3})\s*amp/);
  return match ? `${match[1]} Amp` : null;
}

function mapElectricalPanelInstallationDate(context) {
  const text = getSignalText(context, ["electricText"], { fallback: false });
  if (!text || !/panel|electrical/.test(text.toLowerCase())) return null;
  return parseIsoDateFromText(text);
}

function mapElectricalRewireDate(context) {
  const text = getSignalText(context, ["electricText"], { fallback: false });
  if (!text || !/rewire|rewiring/.test(text.toLowerCase())) return null;
  return parseIsoDateFromText(text);
}

function mapElectricalWiringType(context) {
  const text = getSignalText(context, ["electricText"], { fallback: false });
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (/copper/.test(normalized)) return "Copper";
  if (/aluminum/.test(normalized)) return "Aluminum";
  if (/knob/.test(normalized)) return "KnobAndTube";
  if (/cloth/.test(normalized)) return "ClothWrapped";
  return null;
}

function mapElectricalWiringTypeOtherDescription() {
  return null;
}

function mapHeatingFuelType(context) {
  const text =
    context.signals.heatSourceText ||
    context.signals.hvacText ||
    context.signals.heatMethodText ||
    null;
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (/propane/.test(normalized)) return "Propane";
  if (/natural gas|city gas/.test(normalized)) return "NaturalGas";
  if (/gas/.test(normalized)) return "NaturalGas";
  if (/oil/.test(normalized)) return "Oil";
  if (/electric/.test(normalized)) return "Electric";
  if (/solar/.test(normalized)) return "Solar";
  if (/wood/.test(normalized)) return "Wood";
  return null;
}

function mapHeatingSystemType(context) {
  const text =
    context.signals.heatMethodText ||
    context.signals.hvacText ||
    context.signals.heatSourceText ||
    null;
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (/heat pump/.test(normalized)) return "HeatPump";
  if (/radiant/.test(normalized)) return "Radiant";
  if (/steam/.test(normalized)) return "Steam";
  if (/furnace/.test(normalized)) return "Furnace";
  if (/ductless/.test(normalized)) return "Ductless";
  if (/wall heater/.test(normalized)) return "WallUnit";
  if (/central/.test(normalized)) return "Central";
  return null;
}

function mapHvacCapacityKw(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*kw/);
  return match ? Number(match[1]) : null;
}

function mapHvacCapacityTons(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*tons?/);
  return match ? Number(match[1]) : null;
}

function mapHvacCondensingUnitPresent(context) {
  const text = getSignalText(context, ["hvacText", "sectionText"], {
    fallback: true,
  });
  if (!text) return null;
  if (/condensing unit|condenser/.test(text)) return true;
  return null;
}

function mapHvacEquipmentComponent() {
  return null;
}

function mapHvacEquipmentManufacturer(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/(?:manufacturer|brand)[:\s]+([a-z0-9 ]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapHvacEquipmentModel(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  const match = text && text.match(/model[:\s]+([a-z0-9-]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapHvacInstallationDate(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  return parseIsoDateFromText(text);
}

function mapHvacSeerRating(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/seer\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function mapHvacSystemConfiguration(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  if (/split/.test(text)) return "SplitSystem";
  if (/package/.test(text)) return "PackagedUnit";
  if (/zoned/.test(text)) return "Zoned";
  return null;
}

function mapHvacUnitCondition(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  if (/excellent/.test(text)) return "Excellent";
  if (/good/.test(text)) return "Good";
  if (/fair/.test(text)) return "Fair";
  if (/poor|bad/.test(text)) return "Poor";
  return null;
}

function mapHvacUnitIssues(context) {
  const text = getSignalText(context, ["hvacText"], { fallback: false });
  if (!text) return null;
  const issues = [];
  if (/leak/.test(text)) issues.push("Leak");
  if (/rust/.test(text)) issues.push("Rust");
  if (/noise/.test(text)) issues.push("Noise");
  return issues.length ? issues : null;
}

function mapPlumbingFixtureCount(context) {
  const text = getSignalText(context, ["plumbingText"], { fallback: false });
  if (!text) return null;
  const match = text.match(/(\d+)\s*fixture/);
  return match ? Number(match[1]) : null;
}

function mapPlumbingFixtureQuality(context) {
  const text = getSignalText(context, ["plumbingText"], { fallback: false });
  if (!text) return null;
  if (/deluxe|premium/.test(text)) return "High";
  if (/average|standard/.test(text)) return "Average";
  if (/basic/.test(text)) return "Basic";
  return null;
}

function mapPlumbingFixtureTypePrimary(context) {
  const text = getSignalText(context, ["plumbingText"], { fallback: false });
  if (!text) return null;
  if (/sloan/.test(text)) return "CommercialFlushValve";
  if (/low flow/.test(text)) return "LowFlow";
  if (/copper/.test(text)) return "Copper";
  return null;
}

function mapPlumbingSystemInstallationDate(context) {
  const text = getSignalText(context, ["plumbingText"], { fallback: false });
  return parseIsoDateFromText(text);
}

function mapPlumbingSystemType(context) {
  const text = getSignalText(context, ["plumbingText"], { fallback: false });
  if (!text) return null;
  if (/copper/.test(text)) return "Copper";
  if (/pex/.test(text)) return "PEX";
  if (/galvanized/.test(text)) return "Galvanized";
  if (/cpvc/.test(text)) return "CPVC";
  return null;
}

function mapPlumbingSystemTypeOtherDescription() {
  return null;
}

function mapPublicUtilityType(context) {
  const text =
    context.signals.waterText ||
    context.signals.sewerText ||
    context.signals.plumbingText ||
    null;
  if (!text) return null;
  if (/public/.test(text) || /city/.test(text)) return "Public";
  if (/private/.test(text)) return "Private";
  if (/community/.test(text)) return "Community";
  return null;
}

function mapSewerConnectionDate(context) {
  const text = getSignalText(context, ["sewerText"], { fallback: false });
  return parseIsoDateFromText(text);
}

function mapSewerType(context) {
  const text = getSignalText(context, ["sewerText"], { fallback: false });
  if (!text) return null;
  if (/septic/.test(text)) return "Septic";
  if (/public|city/.test(text)) return "Public";
  if (/private/.test(text)) return "Private";
  return null;
}

function mapSmartHomeFeatures(context) {
  const text = getSignalText(context, ["hvacText", "plumbingText"], {
    fallback: false,
  });
  if (!text) return null;
  if (/smart thermostat/.test(text)) return ["SmartThermostat"];
  if (/security system/.test(text)) return ["SmartSecurity"];
  return null;
}

function mapSmartHomeFeaturesOtherDescription() {
  return null;
}

function mapSolarInstallationDate(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  if (!text || !/solar/.test(text)) return null;
  return parseIsoDateFromText(text);
}

function mapSolarInverterInstallationDate(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  if (!text || !/inverter/.test(text)) return null;
  return parseIsoDateFromText(text);
}

function mapSolarInverterManufacturer(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  const match = text && text.match(/inverter manufacturer[:\s]+([a-z0-9 ]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapSolarInverterModel(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  const match = text && text.match(/inverter model[:\s]+([a-z0-9-]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapSolarInverterVisible(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  if (!text) return null;
  if (/inverter/.test(text) && /visible/.test(text)) return true;
  return null;
}

function mapSolarPanelPresent(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  if (!text) return null;
  if (/solar panel/.test(text)) return true;
  return null;
}

function mapSolarPanelType(context) {
  const text = getSignalText(context, ["sectionText"], { fallback: true });
  if (!text) return null;
  if (/photovoltaic/.test(text)) return "Photovoltaic";
  if (/thermal/.test(text)) return "Thermal";
  if (/thin film/.test(text)) return "ThinFilm";
  return null;
}

function mapSolarPanelTypeOtherDescription() {
  return null;
}

function mapWaterConnectionDate(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  return parseIsoDateFromText(text);
}

function mapWaterHeaterInstallationDate(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  return parseIsoDateFromText(text);
}

function mapWaterHeaterManufacturer(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  const match = text && text.match(/heater manufacturer[:\s]+([a-z0-9 ]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapWaterHeaterModel(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  const match = text && text.match(/heater model[:\s]+([a-z0-9-]+)/i);
  return match ? cleanText(match[1]) : null;
}

function mapWaterSourceType(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  if (!text) return null;
  if (/well/.test(text)) return "Well";
  if (/public|city/.test(text)) return "Public";
  if (/surface/.test(text)) return "Surface";
  return null;
}

function mapWellInstallationDate(context) {
  const text = getSignalText(context, ["waterText"], { fallback: false });
  if (!text || !/well/.test(text)) return null;
  return parseIsoDateFromText(text);
}

const UTILITY_MAPPERS = {
  source_http_request: mapSourceHttpRequest,
  request_identifier: mapRequestIdentifier,
  cooling_system_type: mapCoolingSystemType,
  electrical_panel_capacity: mapElectricalPanelCapacity,
  electrical_panel_installation_date: mapElectricalPanelInstallationDate,
  electrical_rewire_date: mapElectricalRewireDate,
  electrical_wiring_type: mapElectricalWiringType,
  electrical_wiring_type_other_description:
    mapElectricalWiringTypeOtherDescription,
  heating_fuel_type: mapHeatingFuelType,
  heating_system_type: mapHeatingSystemType,
  hvac_capacity_kw: mapHvacCapacityKw,
  hvac_capacity_tons: mapHvacCapacityTons,
  hvac_condensing_unit_present: mapHvacCondensingUnitPresent,
  hvac_equipment_component: mapHvacEquipmentComponent,
  hvac_equipment_manufacturer: mapHvacEquipmentManufacturer,
  hvac_equipment_model: mapHvacEquipmentModel,
  hvac_installation_date: mapHvacInstallationDate,
  hvac_seer_rating: mapHvacSeerRating,
  hvac_system_configuration: mapHvacSystemConfiguration,
  hvac_unit_condition: mapHvacUnitCondition,
  hvac_unit_issues: mapHvacUnitIssues,
  plumbing_fixture_count: mapPlumbingFixtureCount,
  plumbing_fixture_quality: mapPlumbingFixtureQuality,
  plumbing_fixture_type_primary: mapPlumbingFixtureTypePrimary,
  plumbing_system_installation_date: mapPlumbingSystemInstallationDate,
  plumbing_system_type: mapPlumbingSystemType,
  plumbing_system_type_other_description:
    mapPlumbingSystemTypeOtherDescription,
  public_utility_type: mapPublicUtilityType,
  sewer_connection_date: mapSewerConnectionDate,
  sewer_type: mapSewerType,
  smart_home_features: mapSmartHomeFeatures,
  smart_home_features_other_description:
    mapSmartHomeFeaturesOtherDescription,
  solar_installation_date: mapSolarInstallationDate,
  solar_inverter_installation_date: mapSolarInverterInstallationDate,
  solar_inverter_manufacturer: mapSolarInverterManufacturer,
  solar_inverter_model: mapSolarInverterModel,
  solar_inverter_visible: mapSolarInverterVisible,
  solar_panel_present: mapSolarPanelPresent,
  solar_panel_type: mapSolarPanelType,
  solar_panel_type_other_description: mapSolarPanelTypeOtherDescription,
  water_connection_date: mapWaterConnectionDate,
  water_heater_installation_date: mapWaterHeaterInstallationDate,
  water_heater_manufacturer: mapWaterHeaterManufacturer,
  water_heater_model: mapWaterHeaterModel,
  water_source_type: mapWaterSourceType,
  well_installation_date: mapWellInstallationDate,
};

function buildUtilityEntry($, card, globalSignals) {
  const entry = createBaseUtilityEntry();
  const signals = gatherUtilitySignalsForCard($, card, globalSignals);
  const context = { signals, buildingIndex: card.buildingIndex };

  UTILITY_PROPERTY_KEYS.forEach((key) => {
    const mapper = UTILITY_MAPPERS[key];
    entry[key] = mapper ? mapper(context) : null;
  });

  entry.building_number = card.buildingIndex;
  return entry;
}

function buildUtilityEntries($) {
  const cards = extractBuildingCards($);
  const globalSignals = gatherGlobalUtilitySignals($);
  
  // Don't create utility if there are no building cards
  if (!cards.length) {
    return [];
  }

  return cards.map((card) => buildUtilityEntry($, card, globalSignals));
}

function main() {
  const inputArg = process.argv[2];
  const inputPath = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : path.join(process.cwd(), "input.html");
  const html = fs.readFileSync(inputPath, "utf8");
  const $ = cheerio.load(html);

  const altkey = getAltKey($);
  const parcelId = getParcelId($);
  const key = parcelId
    ? `property_${parcelId}`
    : altkey
      ? `property_${altkey}`
      : null;

  if (!key) {
    throw new Error("Unable to determine property identifier for utilities data.");
  }

  const utilities = buildUtilityEntries($);

  const outDir = path.join(process.cwd(), "owners");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "utilities_data.json");
  const payload = { [key]: { utilities } };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}