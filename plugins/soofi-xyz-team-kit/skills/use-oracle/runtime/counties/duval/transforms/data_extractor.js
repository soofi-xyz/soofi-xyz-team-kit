#!/usr/bin/env node
/*
  Data extraction script per evaluator spec.
  - Reads: input.html, unnormalized_address.json
           owners/owner_data.json, owners/utilities_data.json, owners/layout_data.json
  - Writes: data/*.json for available, schema-compliant objects.

  Notes:
  - Owners/Utilities/Layout are sourced strictly from the owners/*.json files.
  - Sales/Tax/Property/Deed/File are sourced from input.html.
  - Address is sourced from unnormalized_address.json and input.html.
  - Emits error JSON for unknown enum values when mapping is required.
*/

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Working directory constants
const WORKING_DIR = process.cwd();
const SCRIPT_DIR = __dirname;

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
/**
 * Stamped onto every lexicon entity (not relationship files). Address oneOf
 * "unnormalized format" requires source_http_request + request_identifier +
 * unnormalized_address; without the first two, AJV falls through to the
 * structured-address branch and rejects unnormalized_address.
 * @type {{ source_http_request: { method: string, url: string | null }, request_identifier: string } | null}
 */
let lexiconProvenance = null;

function isRelationshipRecord(obj) {
  return Boolean(
    obj &&
      typeof obj === "object" &&
      obj.from &&
      obj.to &&
      typeof obj.from === "object" &&
      typeof obj.to === "object" &&
      obj.from["/"] &&
      obj.to["/"],
  );
}

/**
 * Lexicon `source_http_request.url` forbids `?query`. COJ captures use
 * `Detail.aspx?RE=`; move that into `multiValueQueryString`.
 */
function lexiconSourceHttpRequest(seed, unnormalizedAddress, requestIdentifier) {
  const raw =
    (seed && seed.source_http_request) ||
    (unnormalizedAddress && unnormalizedAddress.source_http_request) ||
    {};
  const fallback = "https://paopropertysearch.coj.net/Basic/Detail.aspx";
  let url = raw.url || fallback;
  let multiValueQueryString = raw.multiValueQueryString || null;
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      if (!multiValueQueryString) {
        const moved = {};
        for (const [key, value] of parsed.searchParams.entries()) {
          if (!moved[key]) moved[key] = [];
          moved[key].push(value);
        }
        multiValueQueryString = moved;
      }
      url = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
  } catch {
    url = fallback;
  }
  const request = {
    method: raw.method || "GET",
    url,
  };
  if (multiValueQueryString && Object.keys(multiValueQueryString).length > 0) {
    request.multiValueQueryString = multiValueQueryString;
  } else if (requestIdentifier && /Detail\.aspx$/i.test(url)) {
    request.multiValueQueryString = { RE: [requestIdentifier] };
  }
  return request;
}

function writeJSON(relPath, obj) {
  const outPath = path.join("data", relPath);
  ensureDir(path.dirname(outPath));
  const payload =
    lexiconProvenance && !isRelationshipRecord(obj)
      ? { ...obj, ...lexiconProvenance }
      : obj;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
}
function unlinkIfExists(relPath) {
  const p = path.join("data", relPath);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function unlinkSeries(baseName) {
  if (!baseName.endsWith(".json")) return;
  let index = 1;
  while (true) {
    const rel =
      index === 1
        ? baseName
        : baseName.replace(/\.json$/, `_${index}.json`);
    const p = path.join("data", rel);
    if (!fs.existsSync(p)) break;
    fs.unlinkSync(p);
    index += 1;
  }
}
function unlinkByPrefix(prefix) {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) return;
  fs.readdirSync(dataDir).forEach((name) => {
    if (name.startsWith(prefix) && name.endsWith(".json")) {
      fs.unlinkSync(path.join(dataDir, name));
    }
  });
}

function sanitizeNameForRelationship(pathStr) {
  return pathStr
    .replace(/^\.\/+/, "")
    .replace(/\.json$/i, "")
    .replace(/[^\w]+/g, "_");
}

function relationshipFileName(fromPath, toPath) {
  const fromName = sanitizeNameForRelationship(fromPath);
  const toName = sanitizeNameForRelationship(toPath);
  return `relationship_${fromName}_has_${toName}.json`;
}

function titleCaseNamePart(part) {
  if (!part) return null;
  const trimmed = String(part).trim();
  if (trimmed === "") return null;

  // Remove invalid characters like "/" that don't match the schema pattern
  // Pattern allows: letters, spaces, hyphens, apostrophes, commas, and periods
  const cleaned = trimmed
    .replace(/[^a-zA-Z\s\-',.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "") return null;

  // Roman numerals and common suffixes that should stay uppercase
  const preserveUppercase = new Set([
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
    "JR", "SR", "ESQ", "PHD", "MD", "DDS", "DVM", "LLC", "INC", "LTD", "LP", "LLP"
  ]);

  const result = cleaned
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      // Check if the word (without trailing punctuation) should be preserved in uppercase
      const wordUpper = word.replace(/[,.]$/g, "").toUpperCase();
      const trailingPunct = word.match(/[,.]$/)?.[0] || "";

      if (preserveUppercase.has(wordUpper)) {
        return wordUpper + trailingPunct;
      }

      return word
        .split(/([-',.])/)
        .map((segment) =>
          /[-',.]/.test(segment)
            ? segment
            : segment.charAt(0).toUpperCase() + segment.slice(1),
        )
        .join("");
    })
    .join(" ");

  // Remove any trailing or leading separators that don't belong
  const finalResult = result
    .replace(/^[\s\-',.]+/, "")  // Remove leading separators
    .replace(/[\s\-',.]+$/, "");  // Remove trailing separators

  return finalResult || null;
}

function cleanMoneyToNumber(str) {
  if (str == null) return null;
  const s = String(str).replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}
function toISODate(mdyyyy) {
  if (!mdyyyy) return null;
  const m = String(mdyyyy).trim();
  const parts = m.split("/");
  if (parts.length === 3) {
    const [mm, dd, yyyy] = parts;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m;
  return null;
}
function enumError(value, pathStr) {
  const err = {
    type: "error",
    message: `Unknown enum value ${value}.`,
    path: pathStr,
  };
  console.error(JSON.stringify(err));
  throw new Error(err.message + " at " + pathStr);
}
function safeParseNumber(value) {
  if (value == null) return null;
  const numeric = String(value).replace(/[^0-9.\-]/g, "");
  if (!numeric) return null;
  const n = Number(numeric);
  return Number.isNaN(n) ? null : n;
}
function mapStructureForm(propertyUseText, buildingTypeText) {
  const source = `${propertyUseText || ""} ${buildingTypeText || ""}`.toLowerCase();
  if (!source.trim()) return null;
  if (source.includes("townhouse") || source.includes("rowhouse") || source.includes("row house"))
    return "TownhouseRowhouse";
  if (source.includes("duplex")) return "Duplex";
  if (source.includes("triplex")) return "Triplex";
  if (source.includes("quad") || source.includes("fourplex") || source.includes("4-plex"))
    return "Quadplex";
  if (source.includes("loft")) return "Loft";
  if (source.includes("apartment") || source.includes("condo")) return "ApartmentUnit";
  if (source.includes("semi-det") || source.includes("semi detached"))
    return "SingleFamilySemiDetached";
  if (source.includes("manufactured") || source.includes("mobile"))
    return "ManufacturedHomeOnLand";
  if (source.includes("multi") && source.includes("10"))
    return "MultiFamilyMoreThan10";
  if (source.includes("multi") && source.includes("5"))
    return "MultiFamily5Plus";
  if (source.includes("multi")) return "MultiFamilyLessThan10";
  if (source.includes("single family")) return "SingleFamilyDetached";
  return null;
}
function mapPropertyUsageType(propertyUseText) {
  if (!propertyUseText) return "Unknown";
  const normalized = propertyUseText.toLowerCase();
  if (/agric|farm|orchard|grove|timber|hay|grazing|poultry|crop/.test(normalized))
    return "Agricultural";
  if (/industrial|manufactur|warehouse/.test(normalized)) return "Industrial";
  if (/office/.test(normalized)) return "OfficeBuilding";
  if (/retail|store|commercial|shopping/.test(normalized)) return "RetailStore";
  if (/church/.test(normalized)) return "Church";
  if (/public school/.test(normalized)) return "PublicSchool";
  if (/school/.test(normalized)) return "PrivateSchool";
  if (/hospital/.test(normalized))
    return normalized.includes("public") ? "PublicHospital" : "PrivateHospital";
  if (/hotel|motel/.test(normalized)) return "Hotel";
  if (/golf/.test(normalized)) return "GolfCourse";
  if (/club|lodge/.test(normalized)) return "ClubsLodges";
  if (/utility/.test(normalized)) return "Utility";
  if (/residential|single family|townhouse|duplex|triplex|quad|multi|condo|apartment/.test(normalized))
    return "Residential";
  if (/vacant|transitional/.test(normalized)) return "TransitionalProperty";
  return "Unknown";
}
function determinePropertyType(heatedAreaValue, propertyUseText, buildingTypeText) {
  const area = safeParseNumber(heatedAreaValue);
  if (area && area > 0) {
    if (
      /condo|apartment|unit/.test((propertyUseText || "").toLowerCase()) ||
      /unit/.test((buildingTypeText || "").toLowerCase())
    ) {
      return "Unit";
    }
    return "Building";
  }
  const source = `${propertyUseText || ""} ${buildingTypeText || ""}`.toLowerCase();
  if (/manufactured|mobile/.test(source)) return "ManufacturedHome";
  if (/vacant|land|lot/.test(source)) return "LandParcel";
  return "Building";
}
function mapUnitsType(unitsCount) {
  const n = safeParseNumber(unitsCount);
  if (n == null || n <= 0) return null;
  const whole = Math.round(n);
  if (!Number.isFinite(whole)) return null;
  if (whole === 1) return "One";
  if (whole === 2) return "Two";
  if (whole === 3) return "Three";
  if (whole === 4) return "Four";
  if (whole >= 2 && whole <= 4) return "TwoToFour";
  if (whole >= 1 && whole <= 4) return "OneToFour";
  return null;
}

function normalizeFeatureValue(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ");
}

function createEnumMap(values) {
  const map = new Map();
  values.forEach((value) => {
    if (!value) return;
    const normalized = normalizeFeatureValue(value);
    if (!map.has(normalized)) map.set(normalized, value);
  });
  return map;
}

function findEnumMatch(enumMap, rawValue) {
  const normalizedInput = normalizeFeatureValue(rawValue);
  if (!normalizedInput) return null;
  if (enumMap.has(normalizedInput)) return enumMap.get(normalizedInput);
  for (const [normalizedKey, canonical] of enumMap.entries()) {
    if (normalizedInput === normalizedKey) return canonical;
    if (
      normalizedInput.length >= 3 &&
      (normalizedKey.includes(normalizedInput) || normalizedInput.includes(normalizedKey))
    ) {
      return canonical;
    }
  }
  return null;
}

// Maps primary exterior wall materials to secondary accent/trim types
function mapPrimaryToSecondaryWallMaterial(primaryMaterial) {
  if (!primaryMaterial) return null;

  const mapping = {
    "Brick": "Brick Accent",
    "Natural Stone": "Stone Accent",
    "Manufactured Stone": "Stone Accent",
    "Stucco": "Stucco Accent",
    "Vinyl Siding": "Vinyl Accent",
    "Wood Siding": "Wood Trim",
    "Fiber Cement Siding": "Wood Trim",
    "Metal Siding": "Metal Trim",
    "Concrete Block": "Decorative Block",
    "EIFS": "Stucco Accent",
  };

  return mapping[primaryMaterial] || null;
}

const LAYOUT_SPACE_TYPE_VALUES = [
  "Building",
  "Living Room",
  "Family Room",
  "Great Room",
  "Dining Room",
  "Kitchen",
  "Breakfast Nook",
  "Pantry",
  "Primary Bedroom",
  "Secondary Bedroom",
  "Guest Bedroom",
  "Children's Bedroom",
  "Nursery",
  "Full Bathroom",
  "Three-Quarter Bathroom",
  "Half Bathroom / Powder Room",
  "En-Suite Bathroom",
  "Jack-and-Jill Bathroom",
  "Primary Bathroom",
  "Laundry Room",
  "Mudroom",
  "Closet",
  "Bedroom",
  "Walk-in Closet",
  "Mechanical Room",
  "Storage Room",
  "Server/IT Closet",
  "Home Office",
  "Library",
  "Den",
  "Study",
  "Media Room / Home Theater",
  "Game Room",
  "Home Gym",
  "Music Room",
  "Craft Room / Hobby Room",
  "Prayer Room / Meditation Room",
  "Safe Room / Panic Room",
  "Wine Cellar",
  "Bar Area",
  "Greenhouse",
  "Attached Garage",
  "Detached Garage",
  "Carport",
  "Workshop",
  "Storage Loft",
  "Porch",
  "Screened Porch",
  "Sunroom",
  "Deck",
  "Patio",
  "Pergola",
  "Balcony",
  "Terrace",
  "Gazebo",
  "Pool House",
  "Outdoor Kitchen",
  "Lobby / Entry Hall",
  "Common Room",
  "Utility Closet",
  "Elevator Lobby",
  "Mail Room",
  "Janitor's Closet",
  "Pool Area",
  "Indoor Pool",
  "Outdoor Pool",
  "Hot Tub / Spa Area",
  "Shed",
  "Lanai",
  "Open Porch",
  "Enclosed Porch",
  "Attic",
  "Enclosed Cabana",
  "Attached Carport",
  "Detached Carport",
  "Detached Utility Closet",
  "Jacuzzi",
  "Courtyard",
  "Open Courtyard",
  "Screen Porch (1-Story)",
  "Screen Enclosure (2-Story)",
  "Screen Enclosure (3-Story)",
  "Screen Enclosure (Custom)",
  "Lower Garage",
  "Lower Screened Porch",
  "Stoop",
  "First Floor",
  "Second Floor",
  "Third Floor",
  "Fourth Floor",
  "Floor",
  "Basement",
  "Sub-Basement",
  "Living Area",
];
const LAYOUT_SPACE_TYPE_ENUMS = createEnumMap(LAYOUT_SPACE_TYPE_VALUES);
const EXTERIOR_LAYOUT_TYPES = new Set([
  "Porch",
  "Screened Porch",
  "Open Porch",
  "Enclosed Porch",
  "Deck",
  "Patio",
  "Pergola",
  "Balcony",
  "Terrace",
  "Gazebo",
  "Pool House",
  "Outdoor Kitchen",
  "Pool Area",
  "Outdoor Pool",
  "Hot Tub / Spa Area",
  "Shed",
  "Lanai",
  "Screen Porch (1-Story)",
  "Screen Enclosure (2-Story)",
  "Screen Enclosure (3-Story)",
  "Screen Enclosure (Custom)",
  "Lower Screened Porch",
  "Courtyard",
  "Open Courtyard",
  "Stoop",
  "Attached Carport",
  "Detached Carport",
  "Carport",
]);

const STRUCTURE_ENUM_VALUES = {
  roof_design_type: [
    "Gable",
    "Hip",
    "Flat",
    "Mansard",
    "Gambrel",
    "Shed",
    "Saltbox",
    "Butterfly",
    "Bonnet",
    "Clerestory",
    "Dome",
    "Barrel",
    "Combination",
  ],
  roof_material_type: [
    "Manufactured",
    "EngineeredWood",
    "Terazzo",
    "Brick",
    "Wood",
    "CinderBlock",
    "Concrete",
    "Shingle",
    "Composition",
    "Linoleum",
    "Stone",
    "CeramicTile",
    "Block",
    "WoodSiding",
    "ImpactGlass",
    "Carpet",
    "Marble",
    "Vinyl",
    "Tile",
    "PouredConcrete",
    "Metal",
    "Glass",
    "Laminate",
  ],
  exterior_wall_material_primary: [
    "Brick",
    "Natural Stone",
    "Manufactured Stone",
    "Stucco",
    "Vinyl Siding",
    "Wood Siding",
    "Fiber Cement Siding",
    "Metal Siding",
    "Concrete Block",
    "EIFS",
    "Log",
    "Adobe",
    "Precast Concrete",
    "Curtain Wall",
  ],
  flooring_material_primary: [
    "Solid Hardwood",
    "Engineered Hardwood",
    "Laminate",
    "Luxury Vinyl Plank",
    "Sheet Vinyl",
    "Ceramic Tile",
    "Porcelain Tile",
    "Natural Stone Tile",
    "Carpet",
    "Area Rugs",
    "Polished Concrete",
    "Bamboo",
    "Cork",
    "Linoleum",
    "Terrazzo",
    "Epoxy Coating",
  ],
  attachment_type: ["Attached", "SemiDetached", "Detached"],
};
const STRUCTURE_ENUM_MAP = Object.fromEntries(
  Object.entries(STRUCTURE_ENUM_VALUES).map(([field, values]) => [
    field,
    createEnumMap(values),
  ]),
);

const UTILITY_ENUM_VALUES = {
  cooling_system_type: [
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
  ],
  heating_system_type: [
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
  ],
  heating_fuel_type: [
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
  ],
  water_source_type: ["Well", "Aquifer", "Public"],
  sewer_type: ["Sanitary", "Public", "Combined", "Septic"],
};
const UTILITY_ENUM_MAP = Object.fromEntries(
  Object.entries(UTILITY_ENUM_VALUES).map(([field, values]) => [
    field,
    createEnumMap(values),
  ]),
);

const PROPERTY_USE_DEFAULT_MAPPING = {
  property_type: "Building",
  property_usage_type: "Commercial",
  structure_form: null,
  ownership_estate_type: "FeeSimple",
  build_status: "Improved",
};

const PROPERTY_USE_MAPPINGS = {
  "0000": {
    property_type: "LandParcel",
    property_usage_type: "Residential",
    build_status: "VacantLand",
  },
  "0041": {
    property_type: "Unit",
    property_usage_type: "Residential",
    structure_form: "ApartmentUnit",
    ownership_estate_type: "Condominium",
    build_status: "VacantLand",
  },
  "0100": {
    property_type: "Building",
    property_usage_type: "Residential",
    structure_form: "SingleFamilyDetached",
  },
  "0200": {
    property_type: "ManufacturedHome",
    property_usage_type: "Residential",
    structure_form: "ManufacturedHomeOnLand",
  },
  "0300": {
    property_type: "Building",
    property_usage_type: "Residential",
    structure_form: "MultiFamilyMoreThan10",
  },
  "0310": {
    property_type: "Building",
    property_usage_type: "Residential",
    structure_form: "MultiFamilyMoreThan10",
  },
  "0400": {
    property_type: "Unit",
    property_usage_type: "Residential",
    structure_form: "ApartmentUnit",
    ownership_estate_type: "Condominium",
  },
  "0500": {
    property_type: "Unit",
    property_usage_type: "Residential",
    structure_form: "ApartmentUnit",
    ownership_estate_type: "Cooperative",
  },
  "0600": {
    property_type: "Building",
    property_usage_type: "HomesForAged",
  },
  "0691": {
    property_type: "Building",
    property_usage_type: "HomesForAged",
  },
  "0700": {
    property_type: "Building",
    property_usage_type: "Residential",
  },
  "0800": {
    property_type: "Building",
    property_usage_type: "Residential",
    structure_form: "MultiFamilyLessThan10",
  },
  "0810": {
    property_type: "Building",
    property_usage_type: "Residential",
    structure_form: "MultiFamilyLessThan10",
  },
  "0991": {
    property_type: "LandParcel",
    property_usage_type: "ResidentialCommonElementsAreas",
  },
  "0994": {
    property_type: "LandParcel",
    property_usage_type: "ResidentialCommonElementsAreas",
  },
  "1000": {
    property_type: "LandParcel",
    property_usage_type: "Commercial",
    build_status: "VacantLand",
  },
  "1001": {
    property_type: "LandParcel",
    property_usage_type: "Commercial",
  },
  "1040": {
    property_type: "LandParcel",
    property_usage_type: "Commercial",
  },
  "1140": {
    property_type: "Unit",
    property_usage_type: "RetailStore",
    ownership_estate_type: "Condominium",
  },
  "1191": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1192": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1193": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1194": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1196": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1200": {
    property_type: "Building",
    property_usage_type: "Commercial",
  },
  "1210": {
    property_type: "Building",
    property_usage_type: "Residential",
  },
  "1295": {
    property_type: "Building",
    property_usage_type: "Residential",
  },
  "1391": {
    property_type: "Building",
    property_usage_type: "DepartmentStore",
  },
  "1392": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1393": {
    property_type: "Building",
    property_usage_type: "DepartmentStore",
  },
  "1491": {
    property_type: "Building",
    property_usage_type: "Supermarket",
  },
  "1492": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1493": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1494": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1500": {
    property_type: "Building",
    property_usage_type: "ShoppingCenterRegional",
  },
  "1642": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "1691": {
    property_type: "Building",
    property_usage_type: "ShoppingCenterCommunity",
  },
  "1692": {
    property_type: "Building",
    property_usage_type: "ShoppingCenterCommunity",
  },
  "1700": {
    property_type: "Building",
    property_usage_type: "OfficeBuilding",
  },
  "1740": {
    property_type: "Unit",
    property_usage_type: "OfficeBuilding",
    ownership_estate_type: "Condominium",
  },
  "1742": {
    property_type: "Building",
    property_usage_type: "OfficeBuilding",
  },
  "1800": {
    property_type: "Building",
    property_usage_type: "OfficeBuilding",
  },
  "1840": {
    property_type: "Unit",
    property_usage_type: "OfficeBuilding",
    ownership_estate_type: "Condominium",
  },
  "1910": {
    property_type: "Building",
    property_usage_type: "Commercial",
  },
  "1940": {
    property_type: "Unit",
    property_usage_type: "MedicalOffice",
    ownership_estate_type: "Condominium",
  },
  "1942": {
    property_type: "Building",
    property_usage_type: "MedicalOffice",
  },
  "1991": {
    property_type: "Building",
    property_usage_type: "MedicalOffice",
  },
  "2000": {
    property_type: "Building",
    property_usage_type: "TransportationTerminal",
  },
  "2191": {
    property_type: "Building",
    property_usage_type: "Restaurant",
  },
  "2192": {
    property_type: "Building",
    property_usage_type: "Restaurant",
  },
  "2200": {
    property_type: "Building",
    property_usage_type: "Restaurant",
  },
  "2300": {
    property_type: "Building",
    property_usage_type: "FinancialInstitution",
  },
  "2591": {
    property_type: "Building",
    property_usage_type: "Commercial",
  },
  "2592": {
    property_type: "Building",
    property_usage_type: "Commercial",
  },
  "2691": {
    property_type: "Building",
    property_usage_type: "ServiceStation",
  },
  "2692": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2693": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2694": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2791": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2792": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2794": {
    property_type: "Building",
    property_usage_type: "AutoSalesRepair",
  },
  "2891": {
    property_type: "LandParcel",
    property_usage_type: "TransportationTerminal",
  },
  "2892": {
    property_type: "Building",
    property_usage_type: "TransportationTerminal",
  },
  "2893": {
    property_type: "LandParcel",
    property_usage_type: "MobileHomePark",
  },
  "2900": {
    property_type: "Building",
    property_usage_type: "WholesaleOutlet",
  },
  "3000": {
    property_type: "Building",
    property_usage_type: "RetailStore",
  },
  "3100": {
    property_type: "Building",
    property_usage_type: "Theater",
  },
  "3200": {
    property_type: "Building",
    property_usage_type: "Theater",
  },
  "3300": {
    property_type: "Building",
    property_usage_type: "Entertainment",
  },
  "3400": {
    property_type: "Building",
    property_usage_type: "Entertainment",
  },
  "3500": {
    property_type: "Building",
    property_usage_type: "Entertainment",
  },
  "3600": {
    property_type: "LandParcel",
    property_usage_type: "Recreational",
  },
  "3700": {
    property_type: "LandParcel",
    property_usage_type: "RaceTrack",
  },
  "3800": {
    property_type: "LandParcel",
    property_usage_type: "GolfCourse",
  },
  "3940": {
    property_type: "Unit",
    property_usage_type: "Hotel",
    ownership_estate_type: "Condominium",
  },
  "3991": {
    property_type: "Building",
    property_usage_type: "Hotel",
  },
  "3992": {
    property_type: "Building",
    property_usage_type: "Hotel",
  },
  "3993": {
    property_type: "Building",
    property_usage_type: "Hotel",
  },
  "3994": {
    property_type: "Building",
    property_usage_type: "Hotel",
  },
  "3995": {
    property_type: "Building",
    property_usage_type: "Hotel",
  },
  "4000": {
    property_type: "LandParcel",
    property_usage_type: "Industrial",
    build_status: "VacantLand",
  },
  "4001": {
    property_type: "LandParcel",
    property_usage_type: "Industrial",
  },
  "4040": {
    property_type: "LandParcel",
    property_usage_type: "Industrial",
  },
  "4100": {
    property_type: "Building",
    property_usage_type: "LightManufacturing",
  },
  "4200": {
    property_type: "Building",
    property_usage_type: "HeavyManufacturing",
  },
  "4300": {
    property_type: "Building",
    property_usage_type: "LumberYard",
  },
  "4400": {
    property_type: "Building",
    property_usage_type: "PackingPlant",
  },
  "4500": {
    property_type: "Building",
    property_usage_type: "Cannery",
  },
  "4600": {
    property_type: "Building",
    property_usage_type: "LightManufacturing",
  },
  "4700": {
    property_type: "Building",
    property_usage_type: "MineralProcessing",
  },
  "4800": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4840": {
    property_type: "Unit",
    property_usage_type: "Warehouse",
    ownership_estate_type: "Condominium",
  },
  "4842": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4891": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4892": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4893": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4894": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4895": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4897": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4898": {
    property_type: "Building",
    property_usage_type: "Utility",
  },
  "4899": {
    property_type: "Building",
    property_usage_type: "Warehouse",
  },
  "4900": {
    property_type: "LandParcel",
    property_usage_type: "OpenStorage",
  },
  "5000": {
    property_type: "LandParcel",
    property_usage_type: "Agricultural",
  },
  "5100": {
    property_type: "LandParcel",
    property_usage_type: "DrylandCropland",
    build_status: "VacantLand",
  },
  "5200": {
    property_type: "LandParcel",
    property_usage_type: "CroplandClass2",
    build_status: "VacantLand",
  },
  "5300": {
    property_type: "LandParcel",
    property_usage_type: "CroplandClass3",
    build_status: "VacantLand",
  },
  "5400": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "5500": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "5600": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "5700": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "5800": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "5900": {
    property_type: "LandParcel",
    property_usage_type: "TimberLand",
    build_status: "VacantLand",
  },
  "6000": {
    property_type: "LandParcel",
    property_usage_type: "NativePasture",
    build_status: "VacantLand",
  },
  "6100": {
    property_type: "LandParcel",
    property_usage_type: "ImprovedPasture",
    build_status: "VacantLand",
  },
  "6200": {
    property_type: "LandParcel",
    property_usage_type: "Rangeland",
    build_status: "VacantLand",
  },
  "6300": {
    property_type: "LandParcel",
    property_usage_type: "PastureWithTimber",
    build_status: "VacantLand",
  },
  "6400": {
    property_type: "LandParcel",
    property_usage_type: "GrazingLand",
    build_status: "VacantLand",
  },
  "6500": {
    property_type: "LandParcel",
    property_usage_type: "GrazingLand",
    build_status: "VacantLand",
  },
  "6600": {
    property_type: "LandParcel",
    property_usage_type: "OrchardGroves",
    build_status: "VacantLand",
  },
  "6700": {
    property_type: "LandParcel",
    property_usage_type: "Poultry",
    build_status: "VacantLand",
  },
  "6800": {
    property_type: "LandParcel",
    property_usage_type: "LivestockFacility",
    build_status: "VacantLand",
  },
  "6900": {
    property_type: "LandParcel",
    property_usage_type: "Agricultural",
  },
  "7000": {
    property_type: "LandParcel",
    property_usage_type: "GovernmentProperty",
    build_status: "VacantLand",
  },
  "7100": {
    property_type: "Building",
    property_usage_type: "Church",
  },
  "7200": {
    property_type: "Building",
    property_usage_type: "PrivateSchool",
  },
  "7300": {
    property_type: "Building",
    property_usage_type: "PrivateHospital",
  },
  "7400": {
    property_type: "Building",
    property_usage_type: "HomesForAged",
  },
  "7500": {
    property_type: "Building",
    property_usage_type: "NonProfitCharity",
  },
  "7691": {
    property_type: "Building",
    property_usage_type: "MortuaryCemetery",
  },
  "7692": {
    property_type: "LandParcel",
    property_usage_type: "MortuaryCemetery",
  },
  "7693": {
    property_type: "LandParcel",
    property_usage_type: "MortuaryCemetery",
  },
  "7700": {
    property_type: "Building",
    property_usage_type: "ClubsLodges",
  },
  "7800": {
    property_type: "Building",
    property_usage_type: "SanitariumConvalescentHome",
  },
  "7900": {
    property_type: "Building",
    property_usage_type: "CulturalOrganization",
  },
  "8000": {
    property_type: "LandParcel",
    property_usage_type: "GovernmentProperty",
    build_status: "VacantLand",
  },
  "8100": {
    property_type: "Building",
    property_usage_type: "Military",
  },
  "8200": {
    property_type: "LandParcel",
    property_usage_type: "ForestParkRecreation",
  },
  "8300": {
    property_type: "Building",
    property_usage_type: "PublicSchool",
  },
  "8400": {
    property_type: "Building",
    property_usage_type: "CulturalOrganization",
  },
  "8500": {
    property_type: "Building",
    property_usage_type: "PublicHospital",
  },
  "8600": {
    property_type: "Building",
    property_usage_type: "GovernmentProperty",
  },
  "8700": {
    property_type: "Building",
    property_usage_type: "GovernmentProperty",
  },
  "8800": {
    property_type: "Building",
    property_usage_type: "GovernmentProperty",
  },
  "8900": {
    property_type: "Building",
    property_usage_type: "GovernmentProperty",
  },
  "9000": {
    property_type: "LandParcel",
    property_usage_type: "Unknown",
    ownership_estate_type: "Leasehold",
    build_status: "VacantLand",
  },
  "9100": {
    property_type: "Building",
    property_usage_type: "Utility",
  },
  "9200": {
    property_type: "LandParcel",
    property_usage_type: "MineralProcessing",
  },
  "9300": {
    property_type: "LandParcel",
    property_usage_type: "Unknown",
    ownership_estate_type: "SubsurfaceRights",
    build_status: "VacantLand",
  },
  "9400": {
    property_type: "LandParcel",
    property_usage_type: "TransportationTerminal",
    ownership_estate_type: "RightOfWay",
    build_status: "VacantLand",
  },
  "9500": {
    property_type: "LandParcel",
    property_usage_type: "RiversLakes",
    build_status: "VacantLand",
  },
  "9600": {
    property_type: "LandParcel",
    property_usage_type: "TransitionalProperty",
    build_status: "VacantLand",
  },
  "9700": {
    property_type: "LandParcel",
    property_usage_type: "ForestParkRecreation",
  },
  "9700A": {
    property_type: "LandParcel",
    property_usage_type: "ForestParkRecreation",
  },
  "9700B": {
    property_type: "LandParcel",
    property_usage_type: "ForestParkRecreation",
  },
  "9800": {
    property_type: "Building",
    property_usage_type: "Utility",
  },
  "9900": {
    property_type: "LandParcel",
    property_usage_type: "Residential",
    build_status: "VacantLand",
  },
  "9999": {
    property_type: "LandParcel",
    property_usage_type: "Unknown",
    build_status: "VacantLand",
  },
  SERVICECENTER: {
    property_type: "Building",
    property_usage_type: "GovernmentProperty",
  },
};

function getDuvalPropertyUseMapping(rawCode) {
  if (!rawCode) return null;
  const trimmed = rawCode.trim();
  const directMatch =
    Object.prototype.hasOwnProperty.call(PROPERTY_USE_MAPPINGS, trimmed) &&
    PROPERTY_USE_MAPPINGS[trimmed];
  if (directMatch) {
    return { ...PROPERTY_USE_DEFAULT_MAPPING, ...directMatch };
  }
  const numericMatch =
    /^\d+$/.test(trimmed) && trimmed.length < 4
      ? PROPERTY_USE_MAPPINGS[trimmed.padStart(4, "0")]
      : null;
  if (numericMatch) {
    return { ...PROPERTY_USE_DEFAULT_MAPPING, ...numericMatch };
  }
  const normalized = trimmed.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (normalized) {
    const normalizedMatch = PROPERTY_USE_MAPPINGS[normalized];
    if (normalizedMatch) {
      return { ...PROPERTY_USE_DEFAULT_MAPPING, ...normalizedMatch };
    }
  }
  return null;
}


function textOrNull(t) {
  if (!t) return null;
  const s = String(t).trim();
  return s === "" ? null : s;
}

function parseAddressPartsFromFull(fullAddr) {
  if (!fullAddr) return {};
  const out = {
    street_number: null,
    street_name: null,
    street_suffix_type: null,
    street_pre_directional_text: null,
    street_post_directional_text: null,
    unit_identifier: null,
    city_name: null,
    state_code: null,
    postal_code: null,
    plus_four_postal_code: null,
  };
  const partsComma = String(fullAddr).split(/\s*,\s*/);
  let line1 = null,
    city = null,
    stateZip = null;
  if (partsComma.length === 3) {
    [line1, city, stateZip] = partsComma;
  } else if (partsComma.length === 2) {
    [line1, stateZip] = partsComma;
  } else {
    line1 = partsComma[0];
    stateZip = partsComma.slice(1).join(",");
  }
  if (line1) {
    const parts = line1.trim().split(/\s+/);
    if (parts.length >= 2) {
      out.street_number = parts.shift();
      const directionalSet = new Set([
        "N",
        "S",
        "E",
        "W",
        "NE",
        "NW",
        "SE",
        "SW",
      ]);
      if (parts.length > 0) {
        const firstToken = parts[0].toUpperCase();
        if (directionalSet.has(firstToken)) {
          out.street_pre_directional_text = firstToken;
          parts.shift();
        }
      }
      let suffix = null;
      if (parts.length >= 2) suffix = parts.pop();
      const name = parts.join(" ");
      out.street_name = name ? name.toUpperCase() : null;
      if (suffix) {
        const sfxUpper = suffix.toUpperCase();
        const map = {
          ST: "St",
          STREET: "St",
          AVE: "Ave",
          AVENUE: "Ave",
          BLVD: "Blvd",
          BOULEVARD: "Blvd",
          RD: "Rd",
          ROAD: "Rd",
          DR: "Dr",
          DRIVE: "Dr",
          LN: "Ln",
          LANE: "Ln",
          CT: "Ct",
          COURT: "Ct",
          CIR: "Cir",
          CIRCLE: "Cir",
          HWY: "Hwy",
          HIGHWAY: "Hwy",
          PL: "Pl",
          PLACE: "Pl",
          TER: "Ter",
          TERRACE: "Ter",
          WAY: "Way",
          PKWY: "Pkwy",
          RDG: "Rdg",
          RIDGE: "Rdg",
          RUN: "Run",
          LOOP: "Loop",
        };
        out.street_suffix_type = map[sfxUpper] || sfxUpper;
      }
    }
  }
  if (city) out.city_name = city.trim().toUpperCase();
  if (stateZip) {
    const m = stateZip.match(/^([A-Z]{2})\s+(\d{5})(?:-(\d{4}))?$/i);
    if (m) {
      out.state_code = m[1].toUpperCase();
      out.postal_code = m[2];
      out.plus_four_postal_code = m[3] || null;
    }
  }
  return out;
}
function parseCityStateZipFromHtml($) {
  const line2 = textOrNull(
    $("#ctl00_cphBody_lblPrimarySiteAddressLine2").text(),
  );
  if (!line2)
    return {
      city_name: null,
      state_code: null,
      postal_code: null,
      plus_four_postal_code: null,
    };
  const cleaned = line2.replace(/-+$/, "").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 3) {
    const city = parts.slice(0, parts.length - 2).join(" ");
    const state = parts[parts.length - 2];
    const zip = parts[parts.length - 1].slice(0, 5);
    return {
      city_name: city.toUpperCase(),
      state_code: state.toUpperCase(),
      postal_code: zip,
      plus_four_postal_code: null,
    };
  }
  return {
    city_name: null,
    state_code: null,
    postal_code: null,
    plus_four_postal_code: null,
  };
}
function parsePLSTrsFromLegalRows(legalRows) {
  for (const r of legalRows) {
    const m = String(r).match(/(\d{1,2})-(\d+)([NS]?)-(\d+)([EW]?)/i);
    if (m) {
      const section = m[1];
      const township = m[2] + (m[3] ? m[3].toUpperCase() : "");
      const range = m[4] + (m[5] ? m[5].toUpperCase() : "");
      return { section, township, range };
    }
  }
  return { section: null, township: null, range: null };
}
function parseLotFromLegalRows(legalRows) {
  for (const r of legalRows) {
    const m = String(r).match(/\bLOT\s+(\S+)/i);
    if (m) return m[1];
  }
  return null;
}


const DEED_CODE_MAP = {
  AG: "Contract for Deed",
  AS: "Assignment of Contract",
  BS: "Bargain and Sale Deed",
  CE: "Miscellaneous",
  CD: "Correction Deed",
  CT: "Miscellaneous",
  DL: "Deed in Lieu of Foreclosure",
  GD: "Grant Deed",
  GF: "Gift Deed",
  JT: "Joint Tenancy Deed",
  LB: "Lady Bird Deed",
  LD: "Lady Bird Deed",
  MS: "Miscellaneous",
  PB: "Miscellaneous",
  PR: "Personal Representative Deed",
  QC: "Quitclaim Deed",
  RD: "Miscellaneous",
  RW: "Right of Way Deed",
  SD: "Sheriff's Deed",
  SM: "Special Master’s Deed",
  SW: "Special Warranty Deed",
  TD: "Tax Deed",
  TO: "Transfer on Death Deed",
  TR: "Trustee's Deed",
  WD: "Warranty Deed",
};

const DEED_KEYWORD_PATTERNS = [
  { regex: /special\s+warranty/i, result: "Special Warranty Deed" },
  { regex: /\bwarranty\b/i, result: "Warranty Deed" },
  { regex: /quit[\s-]*claim/i, result: "Quitclaim Deed" },
  { regex: /\bgrant\b/i, result: "Grant Deed" },
  { regex: /bargain/i, result: "Bargain and Sale Deed" },
  { regex: /lady\s+bird/i, result: "Lady Bird Deed" },
  { regex: /transfer\s+on\s+death|tod\b/i, result: "Transfer on Death Deed" },
  { regex: /sheriff/i, result: "Sheriff's Deed" },
  { regex: /\btax\b/i, result: "Tax Deed" },
  { regex: /trustee/i, result: "Trustee's Deed" },
  { regex: /personal\s+representative/i, result: "Personal Representative Deed" },
  { regex: /correction/i, result: "Correction Deed" },
  { regex: /lieu\s+of\s+foreclosure/i, result: "Deed in Lieu of Foreclosure" },
  { regex: /life\s+estate/i, result: "Life Estate Deed" },
  { regex: /joint\s+tenancy/i, result: "Joint Tenancy Deed" },
  { regex: /tenancy\s+in\s+common/i, result: "Tenancy in Common Deed" },
  { regex: /community\s+property/i, result: "Community Property Deed" },
  { regex: /\bgift\b/i, result: "Gift Deed" },
  { regex: /interspousal/i, result: "Interspousal Transfer Deed" },
  { regex: /wild\s+deed?/i, result: "Wild Deed" },
  { regex: /special\s+master/i, result: "Special Master’s Deed" },
  { regex: /court\s+order/i, result: "Court Order Deed" },
  { regex: /quiet\s+title/i, result: "Quiet Title Deed" },
  { regex: /administrator/i, result: "Administrator's Deed" },
  { regex: /guardian/i, result: "Guardian's Deed" },
  { regex: /receiver/i, result: "Receiver's Deed" },
  { regex: /right\s+of\s+way/i, result: "Right of Way Deed" },
  { regex: /vacation\s+of\s+plat/i, result: "Vacation of Plat Deed" },
  { regex: /assignment\s+of\s+contract/i, result: "Assignment of Contract" },
  { regex: /release\s+of\s+contract/i, result: "Release of Contract" },
  { regex: /contract\s+for\s+deed/i, result: "Contract for Deed" },
];

function mapDeedType(instr) {
  if (!instr) return null;
  const raw = String(instr).trim();
  if (raw === "") return null;
  const prefix = raw.split(/[-:]/)[0].trim();
  if (/^[A-Z]{1,4}$/i.test(prefix)) {
    const code = prefix.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(DEED_CODE_MAP, code)) {
      return DEED_CODE_MAP[code];
    }
  }

  const description = raw.replace(/^[^:-]+[:-]\s*/, "");
  const keywordSource = (description ? `${description} ${raw}` : raw).toLowerCase();
  for (const { regex, result } of DEED_KEYWORD_PATTERNS) {
    if (regex.test(keywordSource)) return result;
  }

  if (keywordSource.includes("agreement") && keywordSource.includes("deed")) {
    return "Contract for Deed";
  }
  if (keywordSource.includes("conservation")) return "Miscellaneous";
  if (keywordSource.includes("certificate") && keywordSource.includes("title"))
    return "Miscellaneous";
  if (keywordSource.includes("plat")) return "Miscellaneous";
  if (keywordSource.includes("revoc")) return "Miscellaneous";
  if (keywordSource.includes("misc")) return "Miscellaneous";
  return "Miscellaneous";
}

function extractRecordedDocumentDetails(bookHref, bookPageText) {
  const details = {
    book: null,
    page: null,
    volume: null,
    instrumentNumber: null,
  };
  const assignIfPresent = (key, value) => {
    if (value == null) return;
    const trimmed = String(value).trim();
    if (trimmed) details[key] = trimmed;
  };

  if (bookHref) {
    try {
      const url = new URL(bookHref, "http://example.com/");
      const params = {};
      url.searchParams.forEach((value, key) => {
        params[key.toLowerCase()] = value;
      });
      assignIfPresent("book", params.book || params.bk);
      assignIfPresent("page", params.page || params.pg);
      assignIfPresent("volume", params.volume || params.vol);
      assignIfPresent(
        "instrumentNumber",
        params.instrument || params.inst || params.instrumentnumber || params.doc,
      );
    } catch (err) {
      // Ignore URL parsing errors and fall back to text parsing.
    }
  }

  if (bookPageText) {
    const text = String(bookPageText);
    if (!details.book || !details.page) {
      const combo = text.match(/(\d{1,7})\s*[-/]\s*(\d{1,7})/);
      if (combo) {
        assignIfPresent("book", combo[1]);
        assignIfPresent("page", combo[2]);
      }
    }
    if (!details.book) {
      const bookMatch = text.match(/\bbook\s*[:#]?\s*([A-Za-z0-9]+)/i);
      if (bookMatch) assignIfPresent("book", bookMatch[1]);
    }
    if (!details.page) {
      const pageMatch = text.match(/\bpage\s*[:#]?\s*([A-Za-z0-9]+)/i);
      if (pageMatch) assignIfPresent("page", pageMatch[1]);
    }
    if (!details.volume) {
      const volumeMatch = text.match(/\bvol(?:ume)?\s*[:#]?\s*([A-Za-z0-9]+)/i);
      if (volumeMatch) assignIfPresent("volume", volumeMatch[1]);
    }
    if (!details.instrumentNumber) {
      const instMatch = text.match(/\binst(?:rument)?\.?\s*(?:no\.?|#|number)?\s*[:#]?\s*([A-Za-z0-9]+)/i);
      if (instMatch) assignIfPresent("instrumentNumber", instMatch[1]);
    }
  }

  return details;
}
function fileDocTypeForDeedType(deedType) {
  if (!deedType) return "Title";
  const map = {
    "Warranty Deed": "ConveyanceDeedWarrantyDeed",
    "Special Warranty Deed": "ConveyanceDeed",
    "Quitclaim Deed": "ConveyanceDeedQuitClaimDeed",
    "Quit Claim": "ConveyanceDeedQuitClaimDeed",
    "Bargain and Sale Deed": "ConveyanceDeedBargainAndSaleDeed",
    "Grant Deed": "ConveyanceDeed",
    "Contract for Deed": "ConveyanceDeed",
    "Right of Way Deed": "ConveyanceDeed",
  };
  const mapped = map[deedType];
  if (mapped) return mapped;
  if (deedType.includes("Warranty")) return "ConveyanceDeed";
  return "Title";
}

function extractStructure($) {
  const result = {
    architectural_style_type: null,
    attachment_type: null,
    ceiling_condition: null,
    ceiling_height_average: null,
    ceiling_insulation_type: null,
    ceiling_structure_material: null,
    ceiling_surface_material: null,
    exterior_door_installation_date: null,
    exterior_door_material: null,
    exterior_wall_condition: null,
    exterior_wall_condition_primary: null,
    exterior_wall_condition_secondary: null,
    exterior_wall_insulation_type: null,
    exterior_wall_insulation_type_primary: null,
    exterior_wall_insulation_type_secondary: null,
    exterior_wall_material_primary: null,
    exterior_wall_material_secondary: null,
    finished_base_area: null,
    finished_basement_area: null,
    finished_upper_story_area: null,
    flooring_condition: null,
    flooring_material_primary: null,
    flooring_material_secondary: null,
    foundation_condition: null,
    foundation_material: null,
    foundation_repair_date: null,
    foundation_type: null,
    foundation_waterproofing: null,
    gutters_condition: null,
    gutters_material: null,
    interior_door_material: null,
    interior_wall_condition: null,
    interior_wall_finish_primary: null,
    interior_wall_finish_secondary: null,
    interior_wall_structure_material: null,
    interior_wall_structure_material_primary: null,
    interior_wall_structure_material_secondary: null,
    interior_wall_surface_material_primary: null,
    interior_wall_surface_material_secondary: null,
    number_of_buildings: null,
    number_of_stories: null,
    primary_framing_material: null,
    roof_age_years: null,
    roof_condition: null,
    roof_covering_material: null,
    roof_date: null,
    roof_design_type: null,
    roof_material_type: null,
    roof_structure_material: null,
    roof_underlayment_type: null,
    secondary_framing_material: null,
    siding_installation_date: null,
    structural_damage_indicators: null,
    subfloor_material: null,
    unfinished_base_area: null,
    unfinished_basement_area: null,
    unfinished_upper_story_area: null,
    window_frame_material: null,
    window_glazing_type: null,
    window_installation_date: null,
    window_operation_type: null,
    window_screen_material: null,
  };
  const nob = textOrNull($("#ctl00_cphBody_lblNumberOfBuildings").text());
  if (nob) result.number_of_buildings = Number(nob);
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingAttributes tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const label = textOrNull($(tds[0]).text());
        const code = textOrNull($(tds[1]).text());
        if (label && /stories/i.test(label)) {
          const n = Number(code);
          if (!Number.isNaN(n)) result.number_of_stories = n;
        }
      }
    },
  );
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingArea tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 4) {
        const type = textOrNull($(tds[0]).text());
        const gross = textOrNull($(tds[1]).text());
        if (type && /base area/i.test(type)) {
          if (gross) result.finished_base_area = Number(gross);
        }
        if (type && /finished upper story/i.test(type)) {
          if (gross) result.finished_upper_story_area = Number(gross);
        }
      }
    },
  );
  let floorPrim = null,
    floorSec = null;
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingElements tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const element = textOrNull($(tds[0]).text());
        const detail = textOrNull($(tds[2]).text());
        if (!element || !detail) return;
        if (/roof struct/i.test(element)) {
          // If both words present, prefer Gable per reviewer guidance
          if (/gable/i.test(detail) && /hip/i.test(detail))
            result.roof_design_type = "Gable";
          else if (/gable/i.test(detail)) result.roof_design_type = "Gable";
          else if (/hip/i.test(detail)) result.roof_design_type = "Hip";
        }
        if (/roofing cover/i.test(element)) {
          if (/asph|comp\s*shng/i.test(detail)) {
            result.roof_material_type = "Composition";
            result.roof_covering_material = "Architectural Asphalt Shingle";
          }
        }
        if (/exterior wall/i.test(element)) {
          if (/horizontal\s+lap/i.test(detail)) {
            result.exterior_wall_material_primary =
              result.exterior_wall_material_primary || "Fiber Cement Siding";
          }
          if (/vertical\s+sheet/i.test(detail)) {
            if (result.exterior_wall_material_primary)
              result.exterior_wall_material_secondary = "Wood Trim";
            else result.exterior_wall_material_primary = "Wood Siding";
          }
        }
        if (/interior wall/i.test(element)) {
          if (/drywall/i.test(detail))
            result.interior_wall_surface_material_primary = "Drywall";
        }
        if (/int flooring/i.test(element)) {
          if (/carpet/i.test(detail)) {
            if (!floorPrim) floorPrim = "Carpet";
            else if (!floorSec) floorSec = "Carpet";
          }
          if (/cer\s*clay\s*tile|cer\s*tile|tile/i.test(detail)) {
            if (!floorPrim) floorPrim = "Ceramic Tile";
            else if (!floorSec) floorSec = "Ceramic Tile";
          }
        }
      }
    },
  );
  result.flooring_material_primary = floorPrim;
  result.flooring_material_secondary = floorSec;
  const bType = textOrNull(
    $("#ctl00_cphBody_repeaterBuilding_ctl00_lblBuildingType").text(),
  );
  if (bType && /townhouse/i.test(bType)) result.attachment_type = "Attached";
  return result;
}

function extractLot($, legalRows, totalAreaStr) {
  let lot_area_sqft = null;
  const ta = textOrNull(totalAreaStr);
  const taNumber = safeParseNumber(ta);
  if (taNumber != null && taNumber > 0)
    lot_area_sqft = Math.round(taNumber);
  return {
    lot_type: null,
    lot_length_feet: null,
    lot_width_feet: null,
    lot_area_sqft,
    landscaping_features: null,
    view: null,
    fencing_type: null,
    fence_height: null,
    fence_length: null,
    driveway_material: null,
    driveway_condition: null,
    lot_condition_issues: null,
  };
}

function extractExtraFeatures($) {
  const features = [];
  $("#ctl00_cphBody_gridExtraFeatures tr").each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find("td");
    if (tds.length < 3) return;
    const code = textOrNull($(tds[1]).text());
    const description = textOrNull($(tds[2]).text());
    const buildingText =
      tds.length > 3 ? textOrNull($(tds[3]).text()) : null;
    const buildingNumber = buildingText != null ? safeParseNumber(buildingText) : null;
    const length = tds.length > 4 ? safeParseNumber($(tds[4]).text()) : null;
    const width = tds.length > 5 ? safeParseNumber($(tds[5]).text()) : null;
    const totalUnits =
      tds.length > 6 ? safeParseNumber($(tds[6]).text()) : null;
    const value = tds.length > 7 ? textOrNull($(tds[7]).text()) : null;
    features.push({
      code,
      description,
      buildingNumber:
        Number.isFinite(buildingNumber) && buildingNumber > 0
          ? Number(buildingNumber)
          : null,
      buildingNumberRaw: buildingText,
      length,
      width,
      totalUnits,
      value,
      name: description || code || buildingText || null,
      detail: code || description || null,
    });
  });
  return features;
}

function featureValueCandidates(feature) {
  const out = [];
  if (!feature) return out;
  ["name", "detail", "code", "description", "value"].forEach((key) => {
    const value = feature[key];
    if (value) out.push(value);
  });
  return out;
}

function normalizeBuildingNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (Number.isFinite(value)) {
    const num = Number(value);
    return num > 0 ? num : fallback;
  }
  const numeric = safeParseNumber(value);
  if (Number.isFinite(numeric) && numeric > 0) return Number(numeric);
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return fallback;
}

function filterExtraFeaturesByBuilding(features, buildingNumber) {
  if (!Array.isArray(features) || features.length === 0) return [];
  if (buildingNumber == null) return features;
  const target = Number(buildingNumber);
  if (!Number.isFinite(target)) return features;
  return features.filter((feature) => {
    if (!feature) return false;
    const value = feature.buildingNumber ?? feature.building_number ?? feature.buildingNumberRaw ?? null;
    if (value == null || value === "") return true;
    const num = Number(value);
    if (Number.isFinite(num)) return num === target;
    const parsed = safeParseNumber(value);
    return Number.isFinite(parsed) ? parsed === target : false;
  });
}

function applyExtraFeaturesToUtility(features, utilityRecord) {
  if (!Array.isArray(features) || features.length === 0 || !utilityRecord)
    return;
  features.forEach((feature) => {
    featureValueCandidates(feature).forEach((value) => {
      const normalized = normalizeFeatureValue(value);
      if (!normalized || normalized.length < 3) return;
      Object.entries(UTILITY_ENUM_MAP).forEach(([field, enumMap]) => {
        if (!enumMap) return;
        if (utilityRecord[field] != null && utilityRecord[field] !== "") return;
        const match = findEnumMatch(enumMap, value);
        if (match) utilityRecord[field] = match;
      });
    });
  });
}

function applyExtraFeaturesToStructure(features, structureRecord) {
  if (!Array.isArray(features) || features.length === 0 || !structureRecord)
    return;
  features.forEach((feature) => {
    featureValueCandidates(feature).forEach((value) => {
      const normalized = normalizeFeatureValue(value);
      if (!normalized || normalized.length < 3) return;

      const roofMatch = findEnumMatch(STRUCTURE_ENUM_MAP.roof_design_type, value);
      if (roofMatch && !structureRecord.roof_design_type)
        structureRecord.roof_design_type = roofMatch;

      const roofMaterialMatch = findEnumMatch(
        STRUCTURE_ENUM_MAP.roof_material_type,
        value,
      );
      if (roofMaterialMatch && !structureRecord.roof_material_type)
        structureRecord.roof_material_type = roofMaterialMatch;

      const wallMatch = findEnumMatch(
        STRUCTURE_ENUM_MAP.exterior_wall_material_primary,
        value,
      );
      if (wallMatch) {
        if (!structureRecord.exterior_wall_material_primary)
          structureRecord.exterior_wall_material_primary = wallMatch;
        else if (
          structureRecord.exterior_wall_material_primary !== wallMatch &&
          !structureRecord.exterior_wall_material_secondary
        )
          structureRecord.exterior_wall_material_secondary = mapPrimaryToSecondaryWallMaterial(wallMatch);
      }

      const floorMatch = findEnumMatch(
        STRUCTURE_ENUM_MAP.flooring_material_primary,
        value,
      );
      if (floorMatch && !structureRecord.flooring_material_primary)
        structureRecord.flooring_material_primary = floorMatch;

      const attachmentMatch = findEnumMatch(
        STRUCTURE_ENUM_MAP.attachment_type,
        value,
      );
      if (attachmentMatch && !structureRecord.attachment_type)
        structureRecord.attachment_type = attachmentMatch;
    });
  });
}

function extractMailingAddress($) {
  const mailingList = $("#ownerName .data ol").first();
  if (!mailingList.length) return null;

  const lines = [];
  mailingList.find("span").each((_, span) => {
    const txt = textOrNull($(span).text());
    if (txt) lines.push(txt);
  });

  const cleanedLines = lines.filter((line) => line && line.trim() !== "");
  if (cleanedLines.length === 0) return null;

  // Join all lines into a single unnormalized address string
  const unnormalized_address = cleanedLines.join(", ");

  return {
    // street_number: null,
    // street_name: null,
    // street_suffix_type: null,
    // street_pre_directional_text: null,
    // street_post_directional_text: null,
    // unit_identifier: null,
    // city_name: null,
    // state_code: null,
    // postal_code: null,
    // plus_four_postal_code: null,
    // county_name: null,
    // country_code: "US",
    latitude: null,
    longitude: null,
    // lot: null,
    // municipality_name: null,
    // range: null,
    // route_number: null,
    // section: null,
    // township: null,
    // block: null,
    unnormalized_address: unnormalized_address, // Add the full unnormalized address
  };
}

// ============================================================================
// CSV and Polygon Geometry Helpers
// ============================================================================

const NORMALIZE_EOL_REGEX = /\r\n/g;

/**
 * Parse CSV content into rows (array of arrays).
 */
function parseCsv(content) {
  const rows = [];
  let current = '';
  let row = [];
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      row.push(current);
      current = '';
    } else if (char === '\n' && !insideQuotes) {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a polygon string (either raw JSON coordinates or GeoJSON object) into a Polygon/MultiPolygon.
 */
function parsePolygon(value) {
  if (!value) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (isGeoJsonGeometry(parsed)) {
    return parsed;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const depth = coordinatesDepth(parsed);
  if (depth === 4) {
    return { type: 'MultiPolygon', coordinates: parsed };
  }

  if (depth === 3) {
    return { type: 'Polygon', coordinates: parsed };
  }

  if (depth === 2) {
    return { type: 'Polygon', coordinates: [parsed] };
  }

  return null;
}

function coordinatesDepth(arr, depth = 0) {
  if (!Array.isArray(arr) || !arr.length) return depth;
  return coordinatesDepth(arr[0], depth + 1);
}

function isGeoJsonGeometry(value) {
  return (
    value &&
    typeof value === 'object' &&
    (value.type === 'Polygon' || value.type === 'MultiPolygon') &&
    Array.isArray(value.coordinates)
  );
}

function toNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * Minimal Geometry model that mirrors the Elephant Geometry class.
 */
class Geometry {
  constructor({ latitude, longitude, polygon, request_identifier }) {
    this.latitude = latitude ?? null;
    this.longitude = longitude ?? null;
    this.polygon = polygon ?? null;
    this.request_identifier = request_identifier ?? null;
  }

  /**
   * Build a Geometry instance from a CSV record.
   */
  static fromRecord(record) {
    return new Geometry({
      latitude: toNumber(record.latitude),
      longitude: toNumber(record.longitude),
      polygon: parsePolygon(record.parcel_polygon),
      request_identifier: record.request_identifier || null
    });
  }
}

/**
 * Split MultiPolygons into separate Polygon geometries.
 */
function splitGeometry(record) {
  const baseGeometry = Geometry.fromRecord(record);
  const { polygon } = baseGeometry;

  if (!polygon || polygon.type !== 'MultiPolygon') {
    return [baseGeometry];
  }

  return polygon.coordinates.map((coords, index) => {
    const identifier = baseGeometry.request_identifier
      ? `${baseGeometry.request_identifier}#${index + 1}`
      : null;

    return new Geometry({
      latitude: baseGeometry.latitude,
      longitude: baseGeometry.longitude,
      polygon: {
        type: 'Polygon',
        coordinates: coords,
      },
      request_identifier: identifier,
    });
  });
}

/**
 * Load CSV content from input.csv or seed.csv in working/scripts/parent directories.
 */
function loadGeometryCsvContent() {
  const parentDir = path.dirname(SCRIPT_DIR);
  const candidates = [
    path.join(WORKING_DIR, "input.csv"),
    path.join(SCRIPT_DIR, "input.csv"),
    path.join(parentDir, "input.csv"),
    path.join(WORKING_DIR, "seed.csv"),
    path.join(SCRIPT_DIR, "seed.csv"),
    path.join(parentDir, "seed.csv"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, "utf8");
      } catch (err) {
        console.warn(`Unable to read geometry CSV at ${candidate}: ${err.message}`);
      }
    }
  }

  return null;
}

/**
 * Read the provided CSV content and return Geometry instances.
 */
function createGeometryInstances(csvContent) {
  const rows = parseCsv(csvContent.replace(NORMALIZE_EOL_REGEX, '\n'));

  if (!rows.length) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const records = dataRows.map((row) =>
    header.reduce((acc, col, idx) => {
      acc[col] = row[idx] || '';
      return acc;
    }, {})
  );

  return records.flatMap((record) => splitGeometry(record));
}

/**
 * Write geometry_parcel_<index>.json and relationship_parcel_has_geometry_parcel_<index>.json files.
 * @param {Geometry[]} geometries - Array of Geometry instances
 */
function createParcelGeometries(geometries) {
  if (!geometries || !geometries.length) {
    return;
  }

  geometries.forEach((geom, geomIndex) => {
    // Build Elephant Geometry payload with polygon array for PARCEL
    const geometry = {
      latitude: geom.latitude ?? null,
      longitude: geom.longitude ?? null,
    };

    if (geom.polygon && Array.isArray(geom.polygon.coordinates)) {
      const exteriorRing = geom.polygon.coordinates[0] || [];
      const polygon = exteriorRing.map((coordinate) => ({
        longitude: coordinate[0],
        latitude: coordinate[1],
      }));
      if (polygon.length) {
        geometry.polygon = polygon;
      }
    }

    const geometryFile = `geometry_parcel_${geomIndex}.json`;
    const relationshipFile = `relationship_parcel_has_geometry_parcel_${geomIndex}.json`;

    writeJSON(geometryFile, geometry);

    const relationship = {
      from: { "/": "./parcel.json" },
      to: { "/": `./${geometryFile}` },
    };
    writeJSON(relationshipFile, relationship);
  });
}

/**
 * Create layout/building geometries from CSV building_polygon column
 * @param {string} csvContent - CSV content
 */
function createLayoutGeometries(csvContent) {
  const rows = parseCsv(csvContent.replace(NORMALIZE_EOL_REGEX, '\n'));

  if (!rows.length) {
    return;
  }

  const [header, ...dataRows] = rows;

  // Check if building_polygon column exists
  const buildingPolygonIdx = header.indexOf('building_polygon');
  if (buildingPolygonIdx === -1) {
    return; // No building polygon data
  }

  let layoutGeomIndex = 0;
  dataRows.forEach((row, rowIdx) => {
    const buildingPolygonValue = row[buildingPolygonIdx];
    if (!buildingPolygonValue) return;

    const polygon = parsePolygon(buildingPolygonValue);
    if (!polygon) return;

    // Create geometry for each layout
    const geometry = {
      latitude: null,
      longitude: null,
    };

    if (Array.isArray(polygon.coordinates)) {
      const exteriorRing = polygon.type === 'Polygon'
        ? polygon.coordinates[0]
        : polygon.coordinates[0]?.[0];

      if (exteriorRing) {
        const polygonArray = exteriorRing.map((coordinate) => ({
          longitude: coordinate[0],
          latitude: coordinate[1],
        }));
        if (polygonArray.length) {
          geometry.polygon = polygonArray;
        }
      }
    }

    const geometryFile = `geometry_layout_${layoutGeomIndex + 1}.json`;
    const relationshipFile = `relationship_layout_${layoutGeomIndex + 1}_has_geometry_layout_${layoutGeomIndex + 1}.json`;

    writeJSON(geometryFile, geometry);

    const relationship = {
      from: { "/": `./layout_${layoutGeomIndex + 1}.json` },
      to: { "/": `./${geometryFile}` },
    };
    writeJSON(relationshipFile, relationship);

    layoutGeomIndex++;
  });
}

// ============================================================================
// End of CSV and Polygon Geometry Helpers
// ============================================================================

function main() {
  const inputHtmlPath = "input.html";
  const unnormalizedAddressPath = "unnormalized_address.json";
  const ownersPath = path.join("owners", "owner_data.json");
  const utilitiesPath = path.join("owners", "utilities_data.json");
  const structuresPath = path.join("owners", "structure_data.json");
  const layoutPath = path.join("owners", "layout_data.json");

  let html;
  try {
    html = fs.readFileSync(inputHtmlPath, "utf8");
  } catch (err) {
    const altPath = "0020608295R.html";
    if (fs.existsSync(altPath)) html = fs.readFileSync(altPath, "utf8");
    else throw err;
  }
  const $ = cheerio.load(html);
  const unnormalizedAddress = fs.existsSync(unnormalizedAddressPath)
    ? readJSON(unnormalizedAddressPath)
    : null;
  const propertySeed = fs.existsSync("property_seed.json")
    ? readJSON("property_seed.json")
    : null;
  const ownersData = fs.existsSync(ownersPath) ? readJSON(ownersPath) : null;
  const utilitiesData = fs.existsSync(utilitiesPath)
    ? readJSON(utilitiesPath)
    : null;
  const structuresData = fs.existsSync(structuresPath)
    ? readJSON(structuresPath)
    : null;
  const layoutData = fs.existsSync(layoutPath) ? readJSON(layoutPath) : null;
  const layoutFileRefs = [];
  const layoutIdToPath = new Map();
  let buildingLayoutRefs = [];
  const utilityFileRefs = [];
  const structureFileRefs = [];

  ensureDir("data");
  // Clean up duplicates from older runs
  unlinkIfExists("relationship_deed_file.json");
  unlinkIfExists("relationship_sales_deed.json");
  unlinkByPrefix("relationship_");
  unlinkByPrefix("person_");
  unlinkByPrefix("company_");
  unlinkIfExists("utility.json");
  unlinkIfExists("structure.json");
  unlinkByPrefix("utility_");
  unlinkByPrefix("structure_");
  unlinkByPrefix("layout_");

  const htmlParcelNumber = textOrNull(
    $("#ctl00_cphBody_lblRealEstateNumber").text(),
  );
  const parcelIdentifier =
    htmlParcelNumber ||
    (unnormalizedAddress ? unnormalizedAddress.request_identifier : null);
  const requestIdentifier =
    (propertySeed && propertySeed.request_identifier) ||
    (unnormalizedAddress && unnormalizedAddress.request_identifier) ||
    parcelIdentifier ||
    "";
  lexiconProvenance = {
    source_http_request: lexiconSourceHttpRequest(
      propertySeed,
      unnormalizedAddress,
      requestIdentifier,
    ),
    request_identifier: requestIdentifier,
  };
  const propertyKey = parcelIdentifier ? `property_${parcelIdentifier}` : null;
  const propertyUseText = textOrNull($("#ctl00_cphBody_lblPropertyUse").text());
  const subdivision = textOrNull($("#ctl00_cphBody_lblSubdivision").text());
  const totalAreaRaw = textOrNull($("#ctl00_cphBody_lblTotalArea1").text());
  const mailingAddress = extractMailingAddress($);
  const extraFeatures = extractExtraFeatures($);

  const legalRows = [];
  $("#ctl00_cphBody_gridLegal tr").each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find("td");
    if (tds.length >= 2) {
      const desc = textOrNull($(tds[1]).text());
      if (desc) legalRows.push(desc);
    }
  });
  const legalDescription = legalRows.length ? legalRows.join("; ") : null;

  let zoning = null;
  $("#ctl00_cphBody_gridLand tr").each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find("td");
    if (tds.length >= 10) {
      const z = textOrNull($(tds[3]).text());
      if (z) zoning = z;
    }
  });

  const yearBuilt = textOrNull(
    $("#ctl00_cphBody_repeaterBuilding_ctl00_lblYearBuilt").text(),
  );
  let heatedAreaTotal = null;
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingArea tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 4) {
        const type = textOrNull($(tds[0]).text());
        if (type && type.toLowerCase() === "total") {
          const heatedStr = textOrNull($(tds[2]).text());
          if (heatedStr) heatedAreaTotal = heatedStr;
        }
      }
    },
  );

  let unitsCount = null;
  $("#ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingAttributes tr").each(
    (i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const label = textOrNull($(tds[0]).text());
        const code = textOrNull($(tds[1]).text());
        if (label && /rooms\s*\/\s*units/i.test(label)) {
          const asNum = Number(code);
          if (!Number.isNaN(asNum)) unitsCount = asNum;
        }
      }
    },
  );

  const buildingTypeText = textOrNull(
    $("#ctl00_cphBody_repeaterBuilding_ctl00_lblBuildingType").text(),
  );
  let structureForm = mapStructureForm(propertyUseText, buildingTypeText);
  let propertyUsageType = mapPropertyUsageType(propertyUseText);
  let propertyTypeCategory = determinePropertyType(
    heatedAreaTotal,
    propertyUseText,
    buildingTypeText,
  );
  const numberOfUnitsType = mapUnitsType(unitsCount);
  let ownershipEstateType = null;
  let buildStatus = null;

  const propertyUseCodeMatch = propertyUseText
    ? propertyUseText.match(/^\s*([0-9]{1,4})/)
    : null;
  const propertyUseCode = propertyUseCodeMatch
    ? propertyUseCodeMatch[1]
    : propertyUseText;
  const propertyUseMappingEntry =
    getDuvalPropertyUseMapping(propertyUseCode) ||
    getDuvalPropertyUseMapping(propertyUseText);
  if (propertyUseMappingEntry) {
    if (propertyUseMappingEntry.property_type)
      propertyTypeCategory = propertyUseMappingEntry.property_type;
    if (propertyUseMappingEntry.property_usage_type)
      propertyUsageType = propertyUseMappingEntry.property_usage_type;
    if (propertyUseMappingEntry.structure_form !== undefined)
      structureForm =
        propertyUseMappingEntry.structure_form != null
          ? propertyUseMappingEntry.structure_form
          : structureForm;
    if (propertyUseMappingEntry.ownership_estate_type)
      ownershipEstateType = propertyUseMappingEntry.ownership_estate_type;
    if (propertyUseMappingEntry.build_status)
      buildStatus = propertyUseMappingEntry.build_status;
  }

  if (!buildStatus) {
    const heatedAreaNumber = safeParseNumber(heatedAreaTotal);
    buildStatus =
      propertyTypeCategory === "LandParcel" &&
      (heatedAreaNumber == null || heatedAreaNumber === 0)
        ? "VacantLand"
        : "Improved";
  }

  if (parcelIdentifier && propertyTypeCategory) {
    const heatedAreaNumber = safeParseNumber(heatedAreaTotal);
    const heatedAreaString =
      heatedAreaNumber != null && heatedAreaNumber >= 10
        ? String(Math.round(heatedAreaNumber))
        : null;
    const totalAreaNumber = safeParseNumber(totalAreaRaw);
    const totalAreaString =
      totalAreaNumber != null && totalAreaNumber >= 10
        ? String(Math.round(totalAreaNumber))
        : null;
    const propertyPayload = {
      parcel_identifier: parcelIdentifier,
      property_type: propertyTypeCategory,
      property_structure_built_year: yearBuilt ? Number(yearBuilt) : null,
      property_effective_built_year: null,
      property_legal_description_text: legalDescription || null,
      number_of_units_type: numberOfUnitsType,
      number_of_units: unitsCount != null ? Number(unitsCount) : null,
      structure_form: structureForm,
      property_usage_type: propertyUsageType,
      ownership_estate_type: ownershipEstateType,
      build_status: buildStatus,
      livable_floor_area: heatedAreaString,
      area_under_air: heatedAreaString,
      subdivision: subdivision || null,
      total_area: totalAreaString,
      zoning: zoning || null,
    };
    writeJSON("property.json", propertyPayload);
  }

  const trs = parsePLSTrsFromLegalRows(legalRows);
  const lotStr = parseLotFromLegalRows(legalRows);
  const fullAddress = unnormalizedAddress && unnormalizedAddress.full_address
    ? unnormalizedAddress.full_address
    : null;

  writeJSON("address.json", {
    unnormalized_address: fullAddress,
    county_name: "Duval",
    lot: lotStr || null,
    range: trs.range,
    section: trs.section,
    township: trs.township,
  });

  // Create property_has_address relationship
  writeJSON("relationship_property_has_address.json", {
    from: { "/": "./property.json" },
    to: { "/": "./address.json" },
  });

  // 1. ALWAYS create point-based geometry for address (latitude/longitude)
  const geometry = {
    request_identifier: parcelIdentifier || "",
    latitude: unnormalizedAddress?.latitude ?? null,
    longitude: unnormalizedAddress?.longitude ?? null
  };
  writeJSON("geometry.json", geometry);

  // Create relationship between address and geometry
  writeJSON("relationship_address_has_geometry.json", {
    from: { "/": "./address.json" },
    to: { "/": "./geometry.json" }
  });

  // 2. Create parcel polygon geometries from CSV (if available)
  const geometryCsv = loadGeometryCsvContent();
  if (geometryCsv) {
    try {
      const instances = createGeometryInstances(geometryCsv);
      if (instances.length) {
        createParcelGeometries(instances);
        console.log(`Created ${instances.length} geometry_parcel_<index>.json files from CSV`);
      }
    } catch (err) {
      console.warn(`Unable to build parcel geometry from CSV: ${err.message}`);
    }

    // 3. Create layout/building polygon geometries from CSV (if available)
    try {
      createLayoutGeometries(geometryCsv);
      console.log(`Created layout geometry files from CSV`);
    } catch (err) {
      console.warn(`Unable to build layout geometry from CSV: ${err.message}`);
    }
  }

  // Create parcel.json
  const parcel = {
    request_identifier: parcelIdentifier || "",
    parcel_identifier: parcelIdentifier || ""
  };
  writeJSON("parcel.json", parcel);

  const sales = [];
  $("#ctl00_cphBody_gridSalesHistory tr").each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find("td");
    if (tds.length >= 6) {
      const bookPageAnchor = $(tds[0]).find("a");
      const bookPage = textOrNull($(tds[0]).text());
      const bookHref = bookPageAnchor.attr("href")
        ? String(bookPageAnchor.attr("href"))
        : null;
      const saleDate = toISODate(textOrNull($(tds[1]).text()));
      const salePrice = cleanMoneyToNumber($(tds[2]).text());
      const deedInstr = textOrNull($(tds[3]).text());
      const deedType = mapDeedType(deedInstr);
      const recordDetails = extractRecordedDocumentDetails(bookHref, bookPage);
      if (saleDate && salePrice != null && salePrice > 0) {
        sales.push({
          bookPage,
          bookHref,
          ownership_transfer_date: saleDate,
          purchase_price_amount: salePrice,
          deedType,
          book: recordDetails.book,
          page: recordDetails.page,
          volume: recordDetails.volume,
          instrumentNumber: recordDetails.instrumentNumber,
        });
      }
    }
  });

  const saleFileRefs = [];
  sales.forEach((s, idx) => {
    const saleFileName = `sales_history_${idx + 1}.json`;
    const salePath = `./${saleFileName}`;
    writeJSON(saleFileName, {
      ownership_transfer_date: s.ownership_transfer_date,
      purchase_price_amount: s.purchase_price_amount,
    });
    saleFileRefs.push({
      path: salePath,
      index: idx,
      sale: s,
    });

    let deedPath = null;
    if (s.deedType) {
      const deedFileName = `deed_${idx + 1}.json`;
      deedPath = `./${deedFileName}`;
      const deedRecord = { deed_type: s.deedType };
      if (s.book) deedRecord.book = s.book;
      if (s.page) deedRecord.page = s.page;
      if (s.volume) deedRecord.volume = s.volume;
      if (s.instrumentNumber) deedRecord.instrument_number = s.instrumentNumber;
      writeJSON(deedFileName, deedRecord);
      const relName = relationshipFileName(salePath, deedPath);
      writeJSON(relName, {
        from: { "/": salePath },
        to: { "/": deedPath },
      });
    }

    if (s.bookHref) {
      const fileFileName = `file_${idx + 1}.json`;
      const filePath = `./${fileFileName}`;
      writeJSON(fileFileName, {
        document_type: fileDocTypeForDeedType(s.deedType || null),
        file_format: "txt",
        name: s.bookPage || `BookPage_${idx + 1}`,
        original_url: s.bookHref.startsWith("http")
          ? s.bookHref
          : `http://oncore.duvalclerk.com${s.bookHref}`,
        ipfs_url: null,
      });
      if (deedPath) {
        const relName = relationshipFileName(deedPath, filePath);
        writeJSON(relName, {
          from: { "/": deedPath },
          to: { "/": filePath },
        });
      }
    }
  });

  const latestSaleRef =
    saleFileRefs
      .filter((ref) => ref.sale && ref.sale.ownership_transfer_date)
      .sort((a, b) =>
        a.sale.ownership_transfer_date.localeCompare(
          b.sale.ownership_transfer_date,
        ),
      )
      .pop() || null;

  // Also capture property map image as a file record
  const imgSrc = $("#ctl00_cphBody_imgGISImageFound").attr("src");
  if (imgSrc) {
    writeJSON("file_taxmap.json", {
      document_type: "PropertyImage",
      file_format: "png",
      name: "Tax Map",
      original_url: imgSrc.startsWith("http")
        ? imgSrc
        : `https://maps.coj.net${imgSrc}`,
      ipfs_url: null,
    });
  }

  function parseValueFromSpan(id) {
    const txt = textOrNull($(id).text());
    return cleanMoneyToNumber(txt);
  }
  const taxSets = [
    {
      year: 2024,
      building: parseValueFromSpan("#ctl00_cphBody_lblBuildingValueCertified"),
      land: parseValueFromSpan("#ctl00_cphBody_lblLandValueMarketCertified"),
      market: parseValueFromSpan("#ctl00_cphBody_lblJustMarketValueCertified"),
      assessed: parseValueFromSpan(
        "#ctl00_cphBody_lblAssessedValueA10Certified",
      ),
      taxable: parseValueFromSpan("#ctl00_cphBody_lblTaxableValueCertified"),
    },
    {
      year: 2025,
      building: parseValueFromSpan("#ctl00_cphBody_lblBuildingValueInProgress"),
      land: parseValueFromSpan("#ctl00_cphBody_lblLandValueMarketInProgress"),
      market: parseValueFromSpan("#ctl00_cphBody_lblJustMarketValueInProgress"),
      assessed: parseValueFromSpan(
        "#ctl00_cphBody_lblAssessedValueA10InProgress",
      ),
      taxable: parseValueFromSpan("#ctl00_cphBody_lblTaxableValueInProgress"),
    },
  ];
  let taxIndex = 0;
  taxSets.forEach((ts) => {
    if (ts.year && ts.market != null && ts.assessed != null) {
      taxIndex += 1;
      writeJSON(`tax_${taxIndex}.json`, {
        tax_year: ts.year,
        property_assessed_value_amount: ts.assessed,
        property_market_value_amount: ts.market,
        property_building_amount: ts.building != null ? ts.building : null,
        property_land_amount: ts.land != null ? ts.land : null,
        property_taxable_value_amount:
          ts.taxable != null ? ts.taxable : ts.assessed,
        monthly_tax_amount: null,
        period_end_date: null,
        period_start_date: null,
        yearly_tax_amount: null,
        first_year_building_on_tax_roll: null,
        first_year_on_tax_roll: null,
      });
    }
  });

  if (ownersData && propertyKey) {
    const ownerRecord = ownersData[propertyKey];
    if (ownerRecord && ownerRecord.owners_by_date) {
      const currentOwnersRaw = ownerRecord.owners_by_date.current;
      const currentOwners = Array.isArray(currentOwnersRaw)
        ? currentOwnersRaw
        : [];
      const personPaths = [];
      const companyPaths = [];

      currentOwners.forEach((owner) => {
        if (owner.type === "person") {
          const fileName = `person_${personPaths.length + 1}.json`;
          const firstName = titleCaseNamePart(owner.first_name);
          const lastName = titleCaseNamePart(owner.last_name);
          if (!firstName || !lastName) return;
          const payload = {
            first_name: firstName,
            last_name: lastName,
            middle_name: null,
            prefix_name: null,
            suffix_name: null,
            birth_date: null,
            us_citizenship_status: null,
            veteran_status: null,
            request_identifier:
              (unnormalizedAddress && unnormalizedAddress.request_identifier) ||
              parcelIdentifier,
            source_http_request:
              unnormalizedAddress && unnormalizedAddress.source_http_request
                ? unnormalizedAddress.source_http_request
                : null,
          };
          const middleName = titleCaseNamePart(owner.middle_name);
          payload.middle_name = middleName;
          const prefixName = titleCaseNamePart(owner.prefix_name);
          payload.prefix_name = prefixName;
          // Don't apply titleCaseNamePart to suffix - ownerMapping.js already provides it in schema-compliant format
          payload.suffix_name = owner.suffix || null;
          payload.birth_date = owner.birth_date || null;
          payload.us_citizenship_status =
            owner.us_citizenship_status != null
              ? owner.us_citizenship_status
              : null;
          payload.veteran_status =
            owner.veteran_status != null ? Boolean(owner.veteran_status) : null;
          writeJSON(fileName, payload);
          personPaths.push(`./${fileName}`);
        } else if (owner.type === "company") {
          const fileName = `company_${companyPaths.length + 1}.json`;
          writeJSON(fileName, { name: owner.name || null });
          companyPaths.push(`./${fileName}`);
        }
      });

      if (latestSaleRef) {
        personPaths.forEach((personPath) => {
          const relName = relationshipFileName(latestSaleRef.path, personPath);
          writeJSON(relName, {
            from: { "/": latestSaleRef.path },
            to: { "/": personPath },
          });
        });
        companyPaths.forEach((companyPath) => {
          const relName = relationshipFileName(
            latestSaleRef.path,
            companyPath,
          );
          writeJSON(relName, {
            from: { "/": latestSaleRef.path },
            to: { "/": companyPath },
          });
        });
      }

      if (mailingAddress && (personPaths.length > 0 || companyPaths.length > 0)) {
        // Only write mailing_address.json if there are owners to create relationships with
        writeJSON("mailing_address.json", mailingAddress);
        const mailingPath = "./mailing_address.json";
        personPaths.forEach((personPath) => {
        const relName = relationshipFileName(personPath, mailingPath);
        writeJSON(relName, {
          from: { "/": personPath },
          to: { "/": mailingPath },
        });
      });
        companyPaths.forEach((companyPath) => {
          const relName = relationshipFileName(companyPath, mailingPath);
          writeJSON(relName, {
            from: { "/": companyPath },
            to: { "/": mailingPath },
          });
        });
      }
    }
  }

  const utilitiesEntry =
    utilitiesData && propertyKey ? utilitiesData[propertyKey] : null;
  const utilityRecords = [];
  if (Array.isArray(utilitiesEntry)) {
    utilitiesEntry.forEach((entry, idx) => {
      if (!entry) return;
      const record =
        entry && typeof entry.record === "object" ? entry.record : entry;
      if (!record || typeof record !== "object") return;
      const buildingNumber = normalizeBuildingNumber(
        entry.building_number ?? record.building_number,
        idx + 1,
      );
      utilityRecords.push({ record, buildingNumber });
    });
  } else if (utilitiesEntry && typeof utilitiesEntry === "object") {
    const record =
      utilitiesEntry.record && typeof utilitiesEntry.record === "object"
        ? utilitiesEntry.record
        : utilitiesEntry;
    if (record && typeof record === "object") {
      const buildingNumber = normalizeBuildingNumber(
        utilitiesEntry.building_number ?? record.building_number,
        1,
      );
      utilityRecords.push({ record, buildingNumber });
    }
  }

  utilityRecords.forEach((entry, idx) => {
    const fileName = `utility_${idx + 1}.json`;
    const buildingNumber =
      entry.buildingNumber != null ? entry.buildingNumber : idx + 1;
    const record = JSON.parse(JSON.stringify(entry.record));
    if (record && typeof record === "object") {
      if (Object.prototype.hasOwnProperty.call(record, "building_number"))
        delete record.building_number;
      if (Object.prototype.hasOwnProperty.call(record, "total_buildings"))
        delete record.total_buildings;
    }
    const featuresForBuilding = filterExtraFeaturesByBuilding(
      extraFeatures,
      buildingNumber,
    );
    applyExtraFeaturesToUtility(featuresForBuilding, record);
    writeJSON(fileName, record);
    const filePath = `./${fileName}`;
    utilityFileRefs.push({
      filePath,
      buildingNumber,
      record,
    });
  });

  const structuresEntry =
    structuresData && propertyKey ? structuresData[propertyKey] : null;
  const structureRecords = [];
  if (Array.isArray(structuresEntry)) {
    structuresEntry.forEach((entry, idx) => {
      if (!entry) return;
      const record =
        entry && typeof entry.record === "object" ? entry.record : entry;
      if (!record || typeof record !== "object") return;
      const buildingNumber = normalizeBuildingNumber(
        entry.building_number ?? record.building_number,
        idx + 1,
      );
      structureRecords.push({ record, buildingNumber });
    });
  } else if (structuresEntry && typeof structuresEntry === "object") {
    const record =
      structuresEntry.record && typeof structuresEntry.record === "object"
        ? structuresEntry.record
        : structuresEntry;
    if (record && typeof record === "object") {
      const buildingNumber = normalizeBuildingNumber(
        structuresEntry.building_number ?? record.building_number,
        1,
      );
      structureRecords.push({ record, buildingNumber });
    }
  }

  if (structureRecords.length === 0) {
    const fallbackRecord = extractStructure($);
    if (fallbackRecord && typeof fallbackRecord === "object") {
      // Check if the structure has meaningful data
      // Skip if number_of_buildings is 0 or null and no other meaningful data exists
      const hasBuildings = fallbackRecord.number_of_buildings != null &&
                          fallbackRecord.number_of_buildings !== 0;
      const hasMeaningfulData = Object.entries(fallbackRecord).some(([key, value]) => {
        if (key === 'number_of_buildings') return false; // Already checked above
        return value != null && value !== 0;
      });

      if (hasBuildings || hasMeaningfulData) {
        const fallbackNumberText = textOrNull(
          $("#ctl00_cphBody_repeaterBuilding_ctl00_lblBuildingNumber").text(),
        );
        const buildingNumber = normalizeBuildingNumber(
          fallbackRecord.building_number ?? fallbackNumberText,
          1,
        );
        structureRecords.push({
          record: fallbackRecord,
          buildingNumber,
        });
      }
    }
  }

  structureRecords.forEach((entry, idx) => {
    const fileName = `structure_${idx + 1}.json`;
    const buildingNumber =
      entry.buildingNumber != null ? entry.buildingNumber : idx + 1;
    const record = JSON.parse(JSON.stringify(entry.record));
    if (record && typeof record === "object") {
      if (Object.prototype.hasOwnProperty.call(record, "building_number"))
        delete record.building_number;
      if (Object.prototype.hasOwnProperty.call(record, "total_buildings"))
        delete record.total_buildings;
    }
    const featuresForBuilding = filterExtraFeaturesByBuilding(
      extraFeatures,
      buildingNumber,
    );
    applyExtraFeaturesToStructure(featuresForBuilding, record);
    writeJSON(fileName, record);
    const filePath = `./${fileName}`;
    structureFileRefs.push({
      filePath,
      buildingNumber,
      record,
    });
  });

  if (layoutData && propertyKey) {
    const ld = layoutData[propertyKey];
    if (ld && Array.isArray(ld.layouts)) {
      ld.layouts.forEach((entry, idx) => {
        const record = entry && entry.record ? entry.record : entry;
        const localId =
          entry && entry.local_id ? entry.local_id : `layout_${idx + 1}`;
        const parentLocalId =
          entry && entry.parent_local_id ? entry.parent_local_id : null;
        const fileName = `layout_${idx + 1}.json`;
        writeJSON(fileName, record);
        const filePath = `./${fileName}`;
        layoutFileRefs.push({
          localId,
          parentLocalId,
          filePath,
          record,
        });
        layoutIdToPath.set(localId, filePath);
      });
    }
  }
  let layoutFileCounter = layoutFileRefs.length;
  let maxSpaceIndex = layoutFileRefs.reduce((max, entry) => {
    const idx = entry.record && entry.record.space_index;
    const num = idx != null ? Number(idx) : null;
    return Number.isFinite(num) && num > max ? num : max;
  }, 0);

  const existingBuildingEntries = layoutFileRefs.filter((entry) => {
    const spaceType =
      entry.record && entry.record.space_type
        ? String(entry.record.space_type).toLowerCase()
        : "";
    return spaceType === "building";
  });
  const primaryBuildingEntry = existingBuildingEntries[0] || null;

  layoutFileRefs.forEach((entry) => {
    if (!entry.parentLocalId) return;
    const parentPath = layoutIdToPath.get(entry.parentLocalId);
    if (!parentPath) return;
    const relName = relationshipFileName(parentPath, entry.filePath);
    writeJSON(relName, {
      from: { "/": parentPath },
      to: { "/": entry.filePath },
    });
  });

  buildingLayoutRefs = layoutFileRefs.filter((entry) => {
    const spaceType =
      entry.record && entry.record.space_type
        ? String(entry.record.space_type).toLowerCase()
        : "";
    return spaceType === "building";
  });

  const layoutRefsByBuilding = new Map();
  buildingLayoutRefs.forEach((entry) => {
    const layoutBuildingNumber = normalizeBuildingNumber(
      entry.record && entry.record.building_number,
      null,
    );
    if (layoutBuildingNumber == null) return;
    if (!layoutRefsByBuilding.has(layoutBuildingNumber))
      layoutRefsByBuilding.set(layoutBuildingNumber, []);
    layoutRefsByBuilding.get(layoutBuildingNumber).push(entry);
  });

  const layoutTargetsForBuilding = (buildingNumber) => {
    if (buildingNumber != null) {
      const matches = layoutRefsByBuilding.get(buildingNumber);
      if (matches && matches.length > 0) return matches;
    }
    if (buildingLayoutRefs.length > 0) return [buildingLayoutRefs[0]];
    return [];
  };

  structureFileRefs.forEach((structureRef) => {
    const targets = layoutTargetsForBuilding(structureRef.buildingNumber);
    targets.forEach((layoutEntry) => {
      const relName = relationshipFileName(
        layoutEntry.filePath,
        structureRef.filePath,
      );
      writeJSON(relName, {
        from: { "/": layoutEntry.filePath },
        to: { "/": structureRef.filePath },
      });
    });
  });

  utilityFileRefs.forEach((utilityRef) => {
    const targets = layoutTargetsForBuilding(utilityRef.buildingNumber);
    targets.forEach((layoutEntry) => {
      const relName = relationshipFileName(
        layoutEntry.filePath,
        utilityRef.filePath,
      );
      writeJSON(relName, {
        from: { "/": layoutEntry.filePath },
        to: { "/": utilityRef.filePath },
      });
    });
  });

  const lotObj = extractLot($, legalRows, totalAreaRaw);
  writeJSON("lot.json", lotObj);
}

main();
