// Utility mapping script
// - Read input.html (fallback to embedded) and parse with cheerio
// - Extract utilities per schema and write to owners/utilities_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const fallbackHtml = `<!DOCTYPE html><html><body>
<div id="details_value">
  <div id="propDetail"><table>
    <tr><th>RE #</th><td><span id="ctl00_cphBody_lblRealEstateNumber">002060-8295</span></td></tr>
  </table></div>
</div>
<div id="details_buildings">
  <div class="propBuildingElements">
    <table class="gridview" id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingElements">
      <tr><th>Element</th><th>Code</th><th>Detail</th></tr>
      <tr><td class="col_element">Heating Fuel</td><td>4</td><td>4 Electric</td></tr>
      <tr><td class="col_element">Heating Type</td><td>4</td><td>4 Forced-Ducted</td></tr>
      <tr><td class="col_element">Air Cond</td><td>3</td><td>3 Central</td></tr>
    </table>
  </div>
</div>
</body></html>`;

const FEATURE_MAPPINGS = [
  {
    matchers: [/^POL/i, /^PLX/i, /POOL/i],
    layout: { spaceType: "Outdoor Pool", isExterior: true, isFinished: false },
    accessory: { type: "Pool" },
  },
  {
    matchers: [
      /^SPAC/i,
      /^SPAR/i,
      /^SPAB/i,
      /^JAC/i,
      /HOT\s*TUB/i,
      /JACUZZI/i,
      /\bSPA\b(?=.*(HOT|TUB|JACUZZI))/i,
    ],
    layout: { spaceType: "Hot Tub / Spa Area", isExterior: true, isFinished: false },
    accessory: { type: "Hot Tub" },
  },
  {
    matchers: [
      /^SCP/i,
      /^SCN/i,
      /^SC[A-Z]/i,
      /^FSP/i,
      /^FDS/i,
      /^UDS/i,
      /^USP/i,
      /SCREEN(?:ED)?\s*PORCH/i,
    ],
    layout: { spaceType: "Screened Porch", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^FEP/i, /^ENCL?/i, /ENCLOSED PORCH/i],
    layout: { spaceType: "Enclosed Porch", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^FOP/i, /^OP(?!P)/i, /OPEN\s+PORCH/i],
    layout: { spaceType: "Open Porch", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^DCK/i, /^DC/i, /DECK/i],
    layout: { spaceType: "Deck", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^PTO/i, /^PAT/i, /PATIO/i],
    layout: { spaceType: "Patio", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^BAL/i, /^LOG/i, /BALCONY/i],
    layout: { spaceType: "Balcony", isExterior: true, isFinished: false },
  },
  {
    matchers: [/^CAB/i, /CABANA/i],
    layout: { spaceType: "Enclosed Cabana", isExterior: true, isFinished: false },
    accessory: { type: "Cabana" },
  },
  {
    matchers: [/^GZ/i, /GAZEBO/i],
    layout: { spaceType: "Gazebo", isExterior: true, isFinished: false },
    accessory: { type: "Gazebo" },
  },
  {
    matchers: [/^CP/i, /^CPP/i, /CARPORT/i],
    layout: { spaceType: "Detached Carport", isExterior: true, isFinished: false },
    accessory: { type: "Carport" },
  },
  {
    matchers: [/^FCP/i, /^FDC/i, /DET\s*CARPORT/i],
    layout: { spaceType: "Detached Carport", isExterior: true, isFinished: false },
    accessory: { type: "Carport" },
  },
  {
    matchers: [/^FGR/i, /^FDG/i, /GARAGE/i],
    layout: { spaceType: "Detached Garage", isExterior: true, isFinished: false },
    accessory: { type: "Garage" },
  },
  {
    matchers: [/^GR/i],
    layout: { spaceType: "Detached Garage", isExterior: true, isFinished: false },
    accessory: { type: "Garage" },
  },
  {
    matchers: [/^SH/i, /^TS/i, /^HS/i, /^ST/i, /SHED/i],
    layout: { spaceType: "Shed", isExterior: true, isFinished: false },
    accessory: { type: "Shed" },
  },
  {
    matchers: [/^GH/i, /GREENHOUSE/i],
    layout: { spaceType: "Greenhouse", isExterior: true, isFinished: true },
    accessory: { type: "Greenhouse" },
  },
  {
    matchers: [/^MZ/i, /LOFT/i],
    layout: { spaceType: "Storage Loft", isExterior: false, isFinished: true },
    accessory: { type: "Storage Loft" },
  },
  {
    matchers: [/^RB/i, /GAME ROOM/i],
    layout: { spaceType: "Game Room", isExterior: false, isFinished: true },
  },
  {
    matchers: [/^PV/i, /PAV(?:E|ING)/i],
    accessory: { type: "Paved Surface" },
  },
  {
    matchers: [/^FCL/i, /^FCB/i, /^FC/i, /^FW/i, /FENCE/i],
    accessory: { type: "Fence" },
  },
  {
    matchers: [/^WM/i, /WALL/i],
    accessory: { type: "Retaining Wall" },
  },
  {
    matchers: [/^LP/i, /LIGHT\s*POLE/i],
    accessory: { type: "Light Pole" },
    utilitySmartFeature: "Exterior Lighting",
  },
  {
    matchers: [/^FP/i, /FIREPLACE/i],
    utilitySmartFeature: "Fireplace",
  },
  {
    matchers: [/^EL/i, /ELEVATOR/i],
    utilitySmartFeature: "Elevator",
  },
  {
    matchers: [/^ES\d/i, /ESCALATOR/i],
    utilitySmartFeature: "Escalator",
  },
  {
    matchers: [/^FE(?!NC)/i, /FREIGHT\s+ELEV/i],
    utilitySmartFeature: "Freight Elevator",
  },
  {
    matchers: [/^SDS/i, /^SWS/i, /SPRINKLER/i],
    utilitySmartFeature: "Fire Sprinkler System",
  },
  {
    matchers: [/^SN/i, /SAUNA/i],
    utilitySmartFeature: "Sauna",
  },
  {
    matchers: [/^SV/i, /^VAL/i, /SOUND/i, /AUDIO/i],
    utilitySmartFeature: "Sound System",
  },
  {
    matchers: [/^SOL/i, /SOLAR/i],
    utilityAdjustments: { solarPanelPresent: true },
  },
];

const CODE_MATCHER_CACHE = new Map();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createCodeMatcher(code) {
  if (code == null) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return null;
  if (!CODE_MATCHER_CACHE.has(normalized)) {
    CODE_MATCHER_CACHE.set(
      normalized,
      new RegExp(`^${escapeRegex(normalized)}$`, "i"),
    );
  }
  return CODE_MATCHER_CACHE.get(normalized);
}

function pushExactCodeMapping(codes, descriptor = {}) {
  if (!Array.isArray(codes) || codes.length === 0) return;
  const matchers = codes
    .map(createCodeMatcher)
    .filter((regex) => regex instanceof RegExp);
  if (matchers.length === 0) return;

  const mapping = { matchers };
  if (descriptor.layout && descriptor.layout.spaceType) {
    const { spaceType, isExterior = false, isFinished = false } =
      descriptor.layout;
    mapping.layout = {
      spaceType,
      isExterior,
      isFinished,
    };
  }
  if (descriptor.accessory && descriptor.accessory.type) {
    mapping.accessory = {
      type: descriptor.accessory.type,
    };
  }
  if (descriptor.utilitySmartFeature) {
    mapping.utilitySmartFeature = descriptor.utilitySmartFeature;
  }
  if (descriptor.utilityAdjustments) {
    mapping.utilityAdjustments = Object.assign(
      {},
      descriptor.utilityAdjustments,
    );
  }
  if (descriptor.structureAdjustments) {
    mapping.structureAdjustments = Object.assign(
      {},
      descriptor.structureAdjustments,
    );
  }

  FEATURE_MAPPINGS.push(mapping);
}

pushExactCodeMapping(["ADD", "ADT", "APT", "AD", "ADP", "ADX"], {
  layout: { spaceType: "Living Area", isFinished: true },
});

pushExactCodeMapping(["AOF", "FOF", "GOF", "LOF", "MOF"], {
  layout: { spaceType: "Office Room", isFinished: true },
});

const BUSINESS_AREA_CODES = [
  "BUA",
  "BUB",
  "BUC",
  "BUD",
  "BUE",
  "BUF",
  "BUG",
  "BUH",
  "BUI",
  "BUJ",
  "BUK",
  "BUL",
  "BUM",
  "BUN",
  "BUO",
  "BUP",
  "BUQ",
  "BUR",
  "BUS",
  "BUT",
  "BUU",
];

pushExactCodeMapping(BUSINESS_AREA_CODES, {
  layout: { spaceType: "Common Room", isFinished: true },
});

pushExactCodeMapping(["BRA", "BRG", "BRS"], {
  layout: { spaceType: "Bar Area", isFinished: true },
});

pushExactCodeMapping(["BA", "BAL", "BP"], {
  layout: { spaceType: "Balcony", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["BAS"], {
  layout: { spaceType: "Floor", isFinished: true },
});

pushExactCodeMapping(["BSM", "SFB", "UBM"], {
  layout: { spaceType: "Basement", isFinished: false },
});

pushExactCodeMapping(["FBM"], {
  layout: { spaceType: "Basement", isFinished: true },
});

pushExactCodeMapping(["BRCK"], {
  structureAdjustments: { exterior_wall_material_primary: "Brick" },
});

pushExactCodeMapping(["FAT", "FHS"], {
  layout: { spaceType: "Attic", isFinished: true },
});

pushExactCodeMapping(["FST"], {
  layout: { spaceType: "Storage Room", isFinished: true },
});

pushExactCodeMapping(["SC"], {
  layout: { spaceType: "Storage Room", isFinished: true },
});

pushExactCodeMapping(["UST"], {
  layout: { spaceType: "Storage Room", isFinished: false },
});

pushExactCodeMapping(["ST"], {
  layout: { spaceType: "Storage Room", isFinished: false },
});

pushExactCodeMapping(["FDU"], {
  layout: {
    spaceType: "Detached Utility Closet",
    isExterior: true,
    isFinished: true,
  },
});

pushExactCodeMapping(["UDU"], {
  layout: {
    spaceType: "Detached Utility Closet",
    isExterior: true,
    isFinished: false,
  },
});

const FINISHED_UPPER_STORY_CODES = Array.from({ length: 20 }, (_, index) =>
  `FU${String.fromCharCode(65 + index)}`,
);

FINISHED_UPPER_STORY_CODES.forEach((code, idx) => {
  const floorNumber = idx + 2;
  const spaceType = "Floor";
  pushExactCodeMapping([code], {
    layout: { spaceType, isFinished: true },
  });
});

pushExactCodeMapping(["UUS"], {
  layout: { spaceType: "Floor", isFinished: false },
});

pushExactCodeMapping(["KTA", "KTG"], {
  layout: { spaceType: "Kitchen", isFinished: true },
});

pushExactCodeMapping(["LBA", "LBG"], {
  layout: { spaceType: "Lobby / Entry Hall", isFinished: true },
});

pushExactCodeMapping(["RSA", "RSG"], {
  layout: { spaceType: "Dining Room", isFinished: true },
});

pushExactCodeMapping(["SDA"], {
  layout: { spaceType: "Common Room", isFinished: true },
});

pushExactCodeMapping(["SPA"], {
  layout: { spaceType: "Plant Floor", isFinished: true },
});

pushExactCodeMapping(["MEZ", "LF", "MZSC6", "MZWC6", "MZWR7"], {
  layout: { spaceType: "Storage Loft", isFinished: true },
});

pushExactCodeMapping(
  ["CAN", "CDN", "CDCC2", "CDMC2", "CDMR2", "CDWC2", "CDWR2"],
  {
    layout: { spaceType: "Porch", isExterior: true, isFinished: false },
  },
);

pushExactCodeMapping(["CLP", "ULP"], {
  layout: { spaceType: "Patio", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["CVPC2", "CVPR2", "OPP"], {
  layout: { spaceType: "Patio", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["STP"], {
  layout: { spaceType: "Stoop", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["ASP", "SLB", "SL", "MHPC3", "MHPR5"], {
  accessory: { type: "Paved Surface" },
});

pushExactCodeMapping(
  ["UCP", "UDC", "CP", "CPP", "CPAC2", "CPAR2", "CPMC2", "CPMR2", "CPWC2", "CPWR2"],
  {
    layout: {
      spaceType: "Detached Carport",
      isExterior: true,
      isFinished: false,
    },
    accessory: { type: "Carport" },
  },
);

pushExactCodeMapping(["UDG", "UGR"], {
  layout: {
    spaceType: "Detached Garage",
    isExterior: true,
    isFinished: false,
  },
  accessory: { type: "Garage" },
});

pushExactCodeMapping(["UCB"], {
  layout: {
    spaceType: "Enclosed Cabana",
    isExterior: true,
    isFinished: false,
  },
  accessory: { type: "Cabana" },
});

pushExactCodeMapping(["UEP"], {
  layout: { spaceType: "Enclosed Porch", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["UOP"], {
  layout: { spaceType: "Open Porch", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["EP", "GP", "GPP", "GPX"], {
  layout: { spaceType: "Enclosed Porch", isExterior: true, isFinished: false },
});

pushExactCodeMapping(["SO", "SFRC2", "SFRR2"], {
  layout: { spaceType: "Sunroom", isFinished: true },
});

pushExactCodeMapping(
  ["SCNA", "SCNF", "SCNG", "SEFP", "SCNC5", "SCNR3"],
  {
    layout: {
      spaceType: "Screen Enclosure (Custom)",
      isExterior: true,
      isFinished: false,
    },
  },
);

pushExactCodeMapping(["SP", "SPP", "SPX", "SCPC2", "SCPR2"], {
  layout: { spaceType: "Screened Porch", isExterior: true, isFinished: false },
});

pushExactCodeMapping(
  ["BCWC5", "BCWR6"],
  {
    accessory: { type: "Boat Cover" },
  },
);

pushExactCodeMapping(
  ["BS", "BSP", "BSPP", "BSS", "BSVC5", "BSVR6"],
  {
    accessory: { type: "Boat Slip" },
  },
);

pushExactCodeMapping(
  [
    "BHAC1",
    "BHCC1",
    "BHPC1",
    "BHPR6",
    "BHSC1",
    "BHWC1",
    "BHWR6",
  ],
  {
    accessory: { type: "Bulkhead" },
  },
);

pushExactCodeMapping(["BVMC6"], {
  layout: { spaceType: "Safe Room / Panic Room", isFinished: true },
});

pushExactCodeMapping(["BVRC6"], {
  layout: { spaceType: "Storage Room", isFinished: true },
});

pushExactCodeMapping(
  [
    "CRCC2",
    "CRCR2",
    "CSDC2",
    "CSDR2",
    "CSSR2",
    "DACC2",
    "DACR2",
    "HSDC2",
    "HSDR2",
    "HSSC2",
    "HSSR2",
    "STCC2",
    "STCR2",
    "STDC2",
    "STDR2",
    "STSC2",
    "STSR2",
  ],
  {
    accessory: { type: "Barn" },
  },
);

pushExactCodeMapping(
  [
    "DHCC5",
    "DHCR6",
    "DHWC5",
    "DHWR6",
    "DLWC5",
    "DLWR6",
    "DMCC5",
    "DMCR6",
    "DMWC5",
    "DMWR6",
    "DK",
    "RWDC1",
  ],
  {
    accessory: { type: "Dock" },
  },
);

pushExactCodeMapping(["PHCR2", "PHDR2"], {
  accessory: { type: "Poultry House" },
});

pushExactCodeMapping(["DKWC2", "DKWR2"], {
  layout: { spaceType: "Deck", isExterior: true, isFinished: false },
});

pushExactCodeMapping(
  ["ESDC2", "ESDR2", "ESSC2", "ESSR2", "ESMR2"],
  {
    accessory: { type: "Shed" },
  },
);

pushExactCodeMapping(["FVYC1"], {
  accessory: { type: "Fence" },
});

pushExactCodeMapping(
  ["GBCC2", "GBCR2", "GBDC2", "GBDR2", "GBSR2"],
  {
    accessory: { type: "Barn" },
  },
);

pushExactCodeMapping(["GLSC1", "GLSR5"], {
  accessory: { type: "Guardrail" },
});

pushExactCodeMapping(["GOFC5", "GOMC5"], {
  accessory: { type: "Golf Course" },
});

pushExactCodeMapping(
  ["GRBC2", "GRBR2", "GRCC2", "GRCR2", "GRMC2", "GRMR2", "GRWC2", "GRWR2"],
  {
    accessory: { type: "Garage" },
  },
);

pushExactCodeMapping(["LITC1", "LITR5"], {
  accessory: { type: "Exterior Lighting" },
  utilitySmartFeature: "Exterior Lighting",
});

pushExactCodeMapping(["RBCC5", "RBCR2"], {
  accessory: { type: "Sports Court" },
});

pushExactCodeMapping(["RELC6", "RELR7"], {
  utilitySmartFeature: "Elevator",
});

pushExactCodeMapping(
  ["ESAC6", "ESAR7", "ESCC6", "ESCR7", "ESHC6", "ESHR7", "ESRC6", "ESRR7"],
  {
    utilitySmartFeature: "Elevator",
  },
);

pushExactCodeMapping(["RRSC1", "RRSR5"], {
  accessory: { type: "Railroad Spur" },
});

pushExactCodeMapping(["SIMR5"], {
  accessory: { type: "Site Improvement" },
});

pushExactCodeMapping(["SNAC5", "SNAR7"], {
  utilitySmartFeature: "Sauna",
});

pushExactCodeMapping(["SPAC5", "SPAR3"], {
  layout: { spaceType: "Hot Tub / Spa Area", isExterior: true, isFinished: false },
  accessory: { type: "Hot Tub" },
});

pushExactCodeMapping(
  ["TCAC5", "TCAR5", "TCCC5", "TCCR5", "TCLC5", "TCLR5"],
  {
    accessory: { type: "Tennis Court" },
  },
);

pushExactCodeMapping(
  ["TSCC2", "TSCR2", "TSDR2", "TSSC2", "TSSR2"],
  {
    accessory: { type: "Shed" },
  },
);

pushExactCodeMapping(
  ["UTCC2", "UTCR2", "UTDC2", "UTDR2", "UTSC2", "UTSR2"],
  {
    accessory: { type: "Utility Building" },
  },
);

function classifyExtraFeature(feature) {
  if (!feature) return null;
  const code = feature.code ? String(feature.code).trim().toUpperCase() : "";
  const description = feature.description
    ? String(feature.description).trim().toUpperCase()
    : "";

  const layoutMatches = [];
  const accessoryMatches = [];
  const smartFeatureSet = new Set();
  const utilityAdjustments = {};
  const structureAdjustments = {};

  FEATURE_MAPPINGS.forEach((mapping) => {
    const matched =
      mapping.matchers &&
      mapping.matchers.some(
        (regex) =>
          (code && regex.test(code)) || (description && regex.test(description)),
      );
    if (!matched) return;

    if (mapping.layout) {
      layoutMatches.push({
        spaceType: mapping.layout.spaceType,
        isExterior: mapping.layout.isExterior ?? false,
        isFinished: mapping.layout.isFinished ?? false,
      });
    }

    if (mapping.accessory) {
      accessoryMatches.push({
        type: mapping.accessory.type,
      });
    }

    if (mapping.utilitySmartFeature) {
      smartFeatureSet.add(mapping.utilitySmartFeature);
    }

    if (mapping.utilityAdjustments) {
      Object.entries(mapping.utilityAdjustments).forEach(([key, value]) => {
        utilityAdjustments[key] = value;
      });
    }

    if (mapping.structureAdjustments) {
      Object.entries(mapping.structureAdjustments).forEach(([key, value]) => {
        structureAdjustments[key] = value;
      });
    }
  });

  if (
    layoutMatches.length === 0 &&
    accessoryMatches.length === 0 &&
    smartFeatureSet.size === 0 &&
    Object.keys(utilityAdjustments).length === 0 &&
    Object.keys(structureAdjustments).length === 0
  ) {
    return null;
  }

  return {
    layout: layoutMatches,
    accessoryStructures: accessoryMatches,
    utilitySmartFeatures: Array.from(smartFeatureSet),
    utilityAdjustments,
    structureAdjustments,
  };
}

const UTILITY_FIELDS = [
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
  "plumbing_system_installation_date",
  "plumbing_system_type",
  "plumbing_system_type_other_description",
  "public_utility_type",
  "request_identifier",
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

function createUtilityRecord() {
  const base = {};
  UTILITY_FIELDS.forEach((field) => {
    base[field] = null;
  });
  // Set default boolean values for solar_panel_present and solar_inverter_visible
  base.solar_panel_present = false;
  base.solar_inverter_visible = false;
  return base;
}

function loadHtml() {
  const primary = path.join(process.cwd(), "input.html");
  if (fs.existsSync(primary)) return fs.readFileSync(primary, "utf8");
  const alternate = path.join(process.cwd(), "0020608295R.html");
  if (fs.existsSync(alternate)) return fs.readFileSync(alternate, "utf8");
  return fallbackHtml;
}

function textTrim($, sel) {
  return ($(sel).text() || "").trim();
}

function parseNumber(value) {
  if (value == null) return null;
  const numeric = String(value).replace(/[^0-9.\-]/g, "");
  if (!numeric) return null;
  const n = Number(numeric);
  return Number.isNaN(n) ? null : n;
}

function extractExtraFeatures($) {
  const features = [];
  $("#ctl00_cphBody_gridExtraFeatures tr").each((index, row) => {
    if (index === 0) return;
    const tds = $(row).find("td");
    if (tds.length < 3) return;
    const code = $(tds[1]).text().trim();
    const description = $(tds[2]).text().trim();
    features.push({
      code,
      description,
    });
  });
  return features;
}

const UTILITY_ENUMS = {
  heatingSystemType: new Set([
    "ElectricFurnace",
    "Electric",
    "GasFurnace",
    "Ductless",
    "Radiant",
    "Solar",
    "HeatPump",
    "Central",
    "Baseboard",
    "Gas",
  ]),
  heatingFuelType: new Set([
    "Electric",
    "NaturalGas",
    "Propane",
    "Oil",
    "Kerosene",
    "WoodPellet",
    "Wood",
    "Geothermal",
    "Solar",
    "DistrictSteam",
    "Other",
  ]),
  coolingSystemType: new Set([
    "CeilingFans",
    "Electric",
    "Ductless",
    "Hybrid",
    "CentralAir",
    "WindowAirConditioner",
    "WholeHouseFan",
    "CeilingFan",
    "GeothermalCooling",
    "Zoned",
  ]),
};

function ensureEnum(value, set) {
  if (value == null) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized !== "string") return null;
  return set.has(normalized) ? normalized : null;
}

function getBuildingNumberFromNode($, buildingNode, fallback) {
  if (!buildingNode || typeof buildingNode.prevAll !== "function")
    return fallback;
  const header = buildingNode.prevAll("h3").first();
  if (header && header.length > 0) {
    const text = header.text().trim();
    const match = text.match(/(\d+)/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num)) return num;
    }
  }
  const span = buildingNode.find("span[id$='lblBuildingNumber']").first();
  if (span && span.length > 0) {
    const text = span.text().trim();
    const match = text.match(/(\d+)/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num)) return num;
    }
  }
  return fallback;
}

function filterExtraFeaturesByBuilding(extraFeatures, buildingNumber) {
  if (!Array.isArray(extraFeatures) || extraFeatures.length === 0)
    return [];
  if (buildingNumber == null) return extraFeatures;
  const target = Number(buildingNumber);
  if (!Number.isFinite(target)) return extraFeatures;
  return extraFeatures.filter((feature) => {
    if (!feature) return false;
    const value = feature.buildingNumber ?? feature.building_number ?? null;
    if (value == null || value === "") return true;
    const num = Number(value);
    return Number.isFinite(num) ? num === target : false;
  });
}

function computeUtilityRecord(details, extraFeatures) {
  if (!Array.isArray(details) || details.length === 0) return null;

  const det = (name) => {
    const entry = details.find(
      (d) => d.element && d.element.toLowerCase() === name.toLowerCase(),
    );
    return entry ? entry.detail : "";
  };

  const heatingType = det("Heating Type");
  let heatingSystemRaw = null;
  if (/none/i.test(heatingType)) {
    heatingSystemRaw = null;
  } else if (/forced/i.test(heatingType) && /duct/i.test(heatingType)) {
    heatingSystemRaw = "Central";
  } else if (/heat\s*pump/i.test(heatingType)) {
    heatingSystemRaw = "HeatPump";
  } else if (/forced/i.test(heatingType) && /not\s*duct/i.test(heatingType)) {
    heatingSystemRaw = "Radiant";
  }
  const heating_system_type = ensureEnum(
    heatingSystemRaw,
    UTILITY_ENUMS.heatingSystemType,
  );

  const heatingFuel = det("Heating Fuel");
  let heatingFuelRaw = null;
  if (/electric/i.test(heatingFuel)) heatingFuelRaw = "Electric";
  else if (/gas/i.test(heatingFuel)) heatingFuelRaw = "NaturalGas";
  else if (/propane/i.test(heatingFuel)) heatingFuelRaw = "Propane";
  else if (/oil/i.test(heatingFuel)) heatingFuelRaw = "Oil";
  else if (/kerosene/i.test(heatingFuel)) heatingFuelRaw = "Kerosene";
  else if (/none/i.test(heatingFuel)) heatingFuelRaw = null;
  const heating_fuel_type = ensureEnum(
    heatingFuelRaw,
    UTILITY_ENUMS.heatingFuelType,
  );

  const airConditioning = det("Air Cond");
  let coolingSystemRaw = null;
  if (/none/i.test(airConditioning)) coolingSystemRaw = null;
  else if (/central/i.test(airConditioning)) coolingSystemRaw = "CentralAir";
  else if (/pack/i.test(airConditioning)) coolingSystemRaw = "CentralAir";
  else if (/wall/i.test(airConditioning))
    coolingSystemRaw = "WindowAirConditioner";
  else if (/ductless|mini\s*split/i.test(airConditioning))
    coolingSystemRaw = "Ductless";
  const cooling_system_type = ensureEnum(
    coolingSystemRaw,
    UTILITY_ENUMS.coolingSystemType,
  );

  const utility = createUtilityRecord();
  utility.heating_system_type = heating_system_type;
  utility.heating_fuel_type = heating_fuel_type;
  utility.cooling_system_type = cooling_system_type;
  utility.hvac_condensing_unit_present = cooling_system_type
    ? cooling_system_type === "CentralAir"
      ? "Yes"
      : "No"
    : null;

  const smartHomeFeatures = new Set();
  let hasSolarPanel = false;
  let solarInverterVisible = false; // Default to false
  const utilityAdjustments = {};
  (extraFeatures || []).forEach((feature) => {
    const classification = classifyExtraFeature(feature);
    if (!classification) return;
    if (Array.isArray(classification.utilitySmartFeatures)) {
      classification.utilitySmartFeatures.forEach((label) => {
        if (label) smartHomeFeatures.add(String(label));
      });
    }
    if (
      classification.utilityAdjustments &&
      typeof classification.utilityAdjustments === "object"
    ) {
      Object.entries(classification.utilityAdjustments).forEach(
        ([key, value]) => {
          if (value == null) return;
          if (key === "solarPanelPresent" && value) {
            hasSolarPanel = true;
            return;
          }
          if (key === "solarInverterVisible") {
            solarInverterVisible = Boolean(value);
            return;
          }
          utilityAdjustments[key] = value;
        },
      );
    }
  });
  if (smartHomeFeatures.size > 0) {
    utility.smart_home_features = Array.from(smartHomeFeatures);
  }
  utility.solar_panel_present = hasSolarPanel;
  utility.solar_inverter_visible = solarInverterVisible;
  
  Object.entries(utilityAdjustments).forEach(([key, value]) => {
    if (key === "solarPanelPresent" || key === "solarInverterVisible") return; // Already handled
    if (value == null) return;
    if (Object.prototype.hasOwnProperty.call(utility, key)) {
      if (utility[key] == null) utility[key] = value;
    } else {
      utility[key] = value;
    }
  });

  return utility;
}

function extractUtilityFromBuilding($, buildingNode, extraFeatures) {
  if (!buildingNode || buildingNode.length === 0) return null;
  const details = [];
  buildingNode
    .find("table[id$='gridBuildingElements'] tr")
    .each((i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        details.push({
          element: $(tds[0]).text().trim(),
          detail: $(tds[2]).text().trim(),
        });
      }
    });
  return computeUtilityRecord(details, extraFeatures);
}

function extractUtilityFallback($, extraFeatures) {
  const details = [];
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingElements tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        details.push({
          element: $(tds[0]).text().trim(),
          detail: $(tds[2]).text().trim(),
        });
      }
    },
  );
  return computeUtilityRecord(details, extraFeatures);
}

function main() {
  const html = loadHtml();
  const $ = cheerio.load(html);

  const reId = textTrim($, "#ctl00_cphBody_lblRealEstateNumber") || "unknown";
  const propKey = `property_${reId}`;
  const extraFeatures = extractExtraFeatures($);

  const buildingSections = $("#details_buildings .actualBuildingData");
  const totalBuildings =
    parseNumber(textTrim($, "#ctl00_cphBody_lblNumberOfBuildings")) ||
    (buildingSections.length > 0 ? buildingSections.length : null);

  const utilities = [];

  if (buildingSections.length > 0) {
    buildingSections.each((index, element) => {
      const buildingNode = $(element);
      const buildingNumber = getBuildingNumberFromNode(
        $,
        buildingNode,
        index + 1,
      );
      const filteredFeatures = filterExtraFeaturesByBuilding(
        extraFeatures,
        buildingNumber,
      );
      const record = extractUtilityFromBuilding(
        $,
        buildingNode,
        filteredFeatures,
      );
      if (!record) return;
      const entry = {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : index + 1,
        building_index: index + 1,
        total_buildings: totalBuildings != null ? totalBuildings : null,
        record,
      };
      utilities.push(entry);
    });
  }

  if (utilities.length === 0) {
    const record = extractUtilityFallback(
      $,
      filterExtraFeaturesByBuilding(extraFeatures, null),
    );
    if (record) {
      utilities.push({
        building_number: 1,
        building_index: 1,
        total_buildings: totalBuildings != null ? totalBuildings : null,
        record,
      });
    }
  }

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "utilities_data.json");
  const out = {};
  out[propKey] = utilities;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote utilities data for ${propKey} -> ${outPath} (${utilities.length} building entries)`,
  );
}

main();