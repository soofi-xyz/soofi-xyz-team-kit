#!/usr/bin/env node
/*
  Data extractor for property package.
  - Reads: input.html, unnormalized_address.json, property_seed.json
           owners/owner_data.json, owners/utilities_data.json, owners/layout_data.json
  - Writes: JSON files in ./data per schemas (without performing schema validation)

  Notes:
  - Owners, utilities, and layout are sourced strictly from the owners/*.json inputs
  - All other data are parsed from input.html (with county assist from unnormalized_address)
  - Missing/unknown values are set to null where schema allows
  - Idempotent: clears ./data before writing
*/

const fs = require("fs");
const path = require("path");
let cheerio;
try {
  cheerio = require("cheerio");
} catch (e) {
  cheerio = null;
}

// Global constants for path references
const WORKING_DIR = process.cwd();
const SCRIPT_DIR = __dirname;

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function clearDir(p) {
  if (!fs.existsSync(p)) return;
  for (const f of fs.readdirSync(p)) fs.unlinkSync(path.join(p, f));
}
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function readText(p) {
  return fs.readFileSync(p, "utf8");
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function parseCurrency(str) {
  if (str == null) return null;
  const s = String(str).replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? Number(n.toFixed(2)) : null;
}
function toISODate(mdY) {
  if (!mdY) return null;
  const m = mdY.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [_, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
function properCaseName(s) {
  if (!s) return s;
  // Convert to lowercase first, then capitalize first letter of each word
  // Words are separated by space, hyphen, apostrophe, comma, or period
  const lower = s.toLowerCase();
  return lower.replace(/(^|[\s\-',.])([a-z])/g, (match, separator, letter) => {
    return separator + letter.toUpperCase();
  });
}

function cleanName(s) {
  if (!s) return null;
  // Remove characters not allowed by pattern: ^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$
  // Keep only: letters, spaces, hyphens, apostrophes, commas, and periods
  let cleaned = String(s).replace(/[^a-zA-Z\s\-',.]/g, '');
  // Remove consecutive separators (e.g., -- becomes -)
  cleaned = cleaned.replace(/[\s\-',.]{2,}/g, (match) => match[0]);
  // Remove leading and trailing separators
  cleaned = cleaned.replace(/^[\s\-',.]+|[\s\-',.]+$/g, '');
  cleaned = cleaned.trim();
  if (!cleaned) return null;
  // Apply proper case
  return properCaseName(cleaned);
}

function canonicalDeedKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLOWED_DEED_TYPES = [
  "Warranty Deed",
  "Special Warranty Deed",
  "Quitclaim Deed",
  "Grant Deed",
  "Bargain and Sale Deed",
  "Lady Bird Deed",
  "Transfer on Death Deed",
  "Sheriff's Deed",
  "Tax Deed",
  "Trustee's Deed",
  "Personal Representative Deed",
  "Correction Deed",
  "Deed in Lieu of Foreclosure",
  "Life Estate Deed",
  "Joint Tenancy Deed",
  "Tenancy in Common Deed",
  "Community Property Deed",
  "Gift Deed",
  "Interspousal Transfer Deed",
  "Wild Deed",
  "Special Master's Deed",
  "Court Order Deed",
  "Contract for Deed",
  "Quiet Title Deed",
  "Administrator's Deed",
  "Guardian's Deed",
  "Receiver's Deed",
  "Right of Way Deed",
  "Vacation of Plat Deed",
  "Assignment of Contract",
  "Release of Contract",
  "Miscellaneous",
];

const DEED_TYPE_KEY_MAP = new Map();
ALLOWED_DEED_TYPES.forEach((type) => {
  DEED_TYPE_KEY_MAP.set(canonicalDeedKey(type), type);
});

const DEED_TYPE_SYNONYMS = new Map(
  [
    ["general warranty", "Warranty Deed"],
    ["general warranty deed", "Warranty Deed"],
    ["warranty", "Warranty Deed"],
    ["special warranty", "Special Warranty Deed"],
    ["quit claim", "Quitclaim Deed"],
    ["quitclaim", "Quitclaim Deed"],
    ["grant", "Grant Deed"],
    ["bargain and sale", "Bargain and Sale Deed"],
    ["ladybird", "Lady Bird Deed"],
    ["ladybird deed", "Lady Bird Deed"],
    ["lady bird", "Lady Bird Deed"],
    ["transfer on death", "Transfer on Death Deed"],
    ["tod deed", "Transfer on Death Deed"],
    ["sheriff deed", "Sheriff's Deed"],
    ["sheriff sale deed", "Sheriff's Deed"],
    ["trustee deed", "Trustee's Deed"],
    ["trustees deed", "Trustee's Deed"],
    ["personal representative", "Personal Representative Deed"],
    ["personal rep", "Personal Representative Deed"],
    ["correction", "Correction Deed"],
    ["deed in lieu", "Deed in Lieu of Foreclosure"],
    ["life estate", "Life Estate Deed"],
    ["joint tenancy", "Joint Tenancy Deed"],
    ["tenancy in common", "Tenancy in Common Deed"],
    ["community property", "Community Property Deed"],
    ["gift", "Gift Deed"],
    ["interspousal transfer", "Interspousal Transfer Deed"],
    ["wild", "Wild Deed"],
    ["special master deed", "Special Master's Deed"],
    ["court order", "Court Order Deed"],
    ["contract for", "Contract for Deed"],
    ["quiet title", "Quiet Title Deed"],
    ["administrator deed", "Administrator's Deed"],
    ["administratrix deed", "Administrator's Deed"],
    ["guardian deed", "Guardian's Deed"],
    ["guardians deed", "Guardian's Deed"],
    ["receiver deed", "Receiver's Deed"],
    ["receivers deed", "Receiver's Deed"],
    ["right of way", "Right of Way Deed"],
    ["right-of-way", "Right of Way Deed"],
    ["vacation of plat", "Vacation of Plat Deed"],
    ["assignment of contract deed", "Assignment of Contract"],
    ["release of contract deed", "Release of Contract"],
    ["assignment of contract", "Assignment of Contract"],
    ["release of contract", "Release of Contract"],
    ["misc", "Miscellaneous"],
    ["misc deed", "Miscellaneous"],
  ].map(([alias, target]) => [canonicalDeedKey(alias), target]),
);

function normalizeDeedType(rawType) {
  if (!rawType) return null;
  const key = canonicalDeedKey(rawType);
  if (!key) return null;

  if (DEED_TYPE_KEY_MAP.has(key)) {
    return DEED_TYPE_KEY_MAP.get(key);
  }
  if (DEED_TYPE_SYNONYMS.has(key)) {
    return DEED_TYPE_SYNONYMS.get(key);
  }

  const keyNoDeed = key.replace(/\bdeed\b$/, "").trim();
  if (keyNoDeed) {
    if (DEED_TYPE_SYNONYMS.has(keyNoDeed)) {
      return DEED_TYPE_SYNONYMS.get(keyNoDeed);
    }
    const rebuiltKey = canonicalDeedKey(`${keyNoDeed} deed`);
    if (DEED_TYPE_KEY_MAP.has(rebuiltKey)) {
      return DEED_TYPE_KEY_MAP.get(rebuiltKey);
    }
  }

  return null;
}

function mapLandUseToPropertyType(landUseDescription) {
  if (!landUseDescription) return "SingleFamily";

  const desc = landUseDescription.toUpperCase();

  // Map Lake County land use codes to property types
  if (desc.includes("VACANT RESIDENTIAL")) return "VacantLand";
  if (desc.includes("SINGLE FAMILY")) return "SingleFamily";
  if (
    desc.includes("MANUFACTURED HOME SUB") ||
    desc.includes("MANUFACTURED SUB")
  )
    return "ManufacturedHousing";
  if (desc.includes("MANUFACTURED HOME") && !desc.includes("SUB"))
    return "MobileHome";
  if (desc.includes("MULTI FAMILY >9") || desc.includes("MULTI FAMILY >=10"))
    return "MultiFamilyMoreThan10";
  if (
    desc.includes("MULTI FAMILY <5") ||
    desc.includes("MULTI FAMILY >4 AND <10") ||
    desc.includes("MULTI FAMILY <=9")
  )
    return "MultiFamilyLessThan10";
  if (desc.includes("CONDOMINIUM") || desc.includes("CONDO"))
    return "Condominium";
  if (desc.includes("CO-OP")) return "Cooperative";
  if (desc.includes("RETIREMENT HOME")) return "Retirement";
  if (desc.includes("MISC RESIDENTIAL") || desc.includes("MIGRANT"))
    return "MiscellaneousResidential";
  if (desc.includes("TIMESHARE")) return "Timeshare";
  if (desc.includes("TOWNHOUSE")) return "Townhouse";
  if (desc.includes("DUPLEX")) return "Duplex";
  if (desc.includes("PUD")) return "Pud";
  if (desc.includes("MOBILE HOME")) return "MobileHome";
  if (
    desc.includes("RESIDENTIAL COMMON ELEMENTS") ||
    desc.includes("COMMON ELEMENTS")
  )
    return "ResidentialCommonElementsAreas";

  // Default to SingleFamily for unrecognized codes
  return "SingleFamily";
}

function getUnitsType(units) {
  if (!units || units === 1) return "One";
  if (units === 2) return "Two";
  if (units === 3) return "Three";
  if (units === 4) return "Four";
  if (units >= 2 && units <= 4) return "TwoToFour";
  if (units >= 1 && units <= 4) return "OneToFour";
  return null;
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

    writeJSON(path.join("data", geometryFile), geometry);

    const relationship = {
      from: { "/": "./parcel.json" },
      to: { "/": `./${geometryFile}` },
    };
    writeJSON(path.join("data", relationshipFile), relationship);
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

    writeJSON(path.join("data", geometryFile), geometry);

    const relationship = {
      from: { "/": `./layout_${layoutGeomIndex + 1}.json` },
      to: { "/": `./${geometryFile}` },
    };
    writeJSON(path.join("data", relationshipFile), relationship);

    layoutGeomIndex++;
  });
}

// ============================================================================
// End of CSV and Polygon Geometry Helpers
// ============================================================================

function main() {
  const dataDir = path.join(".", "data");
  ensureDir(dataDir);
  clearDir(dataDir);

  // Inputs
  const inputHtml = readText("input.html");
  const addrSeed = readJSON("unnormalized_address.json");
  const propSeed = readJSON("property_seed.json");

  // Owner-related JSON sources
  const ownerPath = path.join("owners", "owner_data.json");
  const utilitiesPath = path.join("owners", "utilities_data.json");
  const layoutPath = path.join("owners", "layout_data.json");

  const ownerData = fs.existsSync(ownerPath) ? readJSON(ownerPath) : null;
  const utilitiesData = fs.existsSync(utilitiesPath)
    ? readJSON(utilitiesPath)
    : null;
  const layoutData = fs.existsSync(layoutPath) ? readJSON(layoutPath) : null;

  const altKey =
    (propSeed &&
      propSeed.source_http_request &&
      propSeed.source_http_request.multiValueQueryString &&
      propSeed.source_http_request.multiValueQueryString.AltKey &&
      propSeed.source_http_request.multiValueQueryString.AltKey[0]) ||
    (addrSeed &&
      addrSeed.source_http_request &&
      addrSeed.source_http_request.multiValueQueryString &&
      addrSeed.source_http_request.multiValueQueryString.AltKey &&
      addrSeed.source_http_request.multiValueQueryString.AltKey[0]) ||
    null;
  const ownerKey = altKey ? `property_${altKey}` : null;

  // HTML parsing
  let $ = null;
  if (cheerio) {
    $ = cheerio.load(inputHtml);
  }

  // Helper: find cell by label in General Information table
  function extractGeneral() {
    if (!$) return {};
    const result = {};
    // Parcel Number
    const rows = $("table.property_head").first().find("tr");
    rows.each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 4) {
        const label = $(tds[2]).text().trim();
        const val = $(tds[3]).text().trim();
        if (/Parcel Number/i.test(label)) result.parcelNumber = val || null;
      }
    });

    // Property Location block
    rows.each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 4) {
        const label = $(tds[0]).text().trim();
        if (/Property Location:/i.test(label)) {
          const addrHtml = $(tds[1]).html() || "";
          const addrText = addrHtml
            .replace(/<br\s*\/?>(?=\s*|$)/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .trim();
          result.propertyLocationRaw = addrText; // e.g., "31729 PARKDALE DR\nLEESBURG FL, 34748"
        }
      }
    });

    // Property Description
    rows.each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 2) {
        const label = $(tds[0]).text().trim();
        if (/Property Description:/i.test(label)) {
          result.legalDescription = $(tds[1]).text().trim() || null;
        }
      }
    });

    return result;
  }

  function extractPropertyTypeFromLandData() {
    if (!$) return { propertyType: null, units: null };

    let landUseDescription = null;
    let units = null;

    // Extract from Land Data table
    $("#cphMain_gvLandData tr.property_row").each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 2) {
        const landUseText = $(tds[1]).text().trim();
        if (landUseText) {
          landUseDescription = landUseText.toUpperCase();
        }
      }
    });

    // Also check for units in building summary if available
    $("table.property_building_summary td").each((i, td) => {
      const text = $(td).text().trim();
      const unitMatch = text.match(/Units:\s*(\d+)/i);
      if (unitMatch) {
        units = parseInt(unitMatch[1], 10);
      }
    });

    const propertyType = mapLandUseToPropertyType(landUseDescription);

    return { propertyType, units };
  }

  // Extract Living Area, Year Built, Building/Land Values, Sales, and derive structure hints
  function extractBuildingAndValues() {
    if (!$) return {};
    const out = {
      yearBuilt: null,
      livingArea: null,
      buildingValue: null,
      landValue: null,
      assessedValue: null,
      taxableValue: null,
      marketValue: null,
      taxYear: null,
      sales: [],
      deeds: [],
      files: [],
      structure: {
        number_of_stories: null,
        exterior_wall_material_primary: null,
        exterior_wall_material_secondary: null,
        primary_framing_material: null,
      },
    };

    // Summary table with Year Built and Total Living Area
    $("table.property_building_summary td").each((i, td) => {
      const t = $(td).text().replace(/\s+/g, " ").trim();
      let m;
      m = t.match(/Year Built:\s*(\d{4})/i);
      if (m) out.yearBuilt = parseInt(m[1], 10);
      m = t.match(/Total Living Area:\s*([0-9,\.]+)/i);
      if (m) out.livingArea = m[1].replace(/[,]/g, "").trim();
    });

    // Building Value
    $("div.property_building table")
      .first()
      .find("tr")
      .first()
      .find("td")
      .each((i, td) => {
        const text = $(td).text();
        const m = text.match(/Building Value:\s*\$([0-9,\.]+)/i);
        if (m) out.buildingValue = parseCurrency(m[0].split(":")[1]);
      });

    // Land Value (from Land Data table)
    $("#cphMain_gvLandData tr.property_row").each((i, tr) => {
      const tds = $(tr).find("td");
      if (tds.length >= 9) {
        const lv = $(tds[8]).text();
        const parsed = parseCurrency(lv);
        if (parsed != null) out.landValue = parsed;
      }
    });

    // Tax values
    const estRows = $("#cphMain_gvEstTax tr").toArray();
    if (estRows.length > 1) {
      // First data row after header
      const tds = $(estRows[1]).find("td");
      if (tds.length >= 6) {
        const market = $(tds[1]).text();
        const assessed = $(tds[2]).text();
        const taxable = $(tds[3]).text();
        out.marketValue = parseCurrency(market);
        out.assessedValue = parseCurrency(assessed);
        out.taxableValue = parseCurrency(taxable);
      }
    }

    // Tax year from the red note text or globally from HTML
    let noteText = "";
    $("div.red").each((i, el) => {
      noteText += $(el).text() + " ";
    });
    let mYear = noteText.match(
      /Values shown below are\s+(\d{4})\s+CERTIFIED VALUES/i,
    );
    if (!mYear)
      mYear = inputHtml.match(
        /Values shown below are\s+(\d{4})\s+CERTIFIED VALUES/i,
      );
    if (mYear) out.taxYear = parseInt(mYear[1], 10);

    // Sales History: Book/Page, Sale Date, Instrument, Sale Price
    // Track which deed indices have corresponding files
    out.deedToFileMap = [];

    $("#cphMain_gvSalesHistory tr").each((i, tr) => {
      if (i === 0) return; // header
      const tds = $(tr).find("td");
      if (tds.length < 6) return;
      const bookPageLink = $(tds[0]).find("a");
      const bookPageText = bookPageLink.text().trim(); // e.g., "3072 / 319"
      const docUrl = bookPageLink.attr("href") || null;
      const saleDateRaw = $(tds[1]).text().trim(); // mm/dd/yyyy
      const instrument = $(tds[2]).text().trim();
      const salePriceRaw = $(tds[5]).text().trim();

      const sale = {
        ownership_transfer_date: toISODate(saleDateRaw),
        purchase_price_amount: parseCurrency(salePriceRaw),
      };

      out.sales.push(sale);

      const deed = { deed_type: instrument || null };
      const deedIndex = out.deeds.length;
      out.deeds.push(deed);

      // Skip creating file objects for invalid book/page data (e.g., "NO** / DATA", "N/A", "NONE")
      // These entries have invalid URLs that cannot be processed
      // Check for patterns like: NO**, **/**, N/A, NONE, UNKNOWN, or missing book/page numbers
      const isInvalidBookPage = !bookPageText ||
                                /\*\*/.test(bookPageText) ||
                                /^(N\/?A|NONE|UNKNOWN)$/i.test(bookPageText.trim());

      if (!isInvalidBookPage) {
        const fileObj = {
          document_type: /Warranty Deed/i.test(instrument)
            ? "ConveyanceDeedWarrantyDeed"
            : null,
          file_format: null,
          name: bookPageText ? `Official Records ${bookPageText}` : null,
        };

        // original_url is omitted and will be populated by the process

        const fileIndex = out.files.length;
        out.files.push(fileObj);

        // Map this deed to its file
        out.deedToFileMap.push({ deedIndex, fileIndex });
      }
    });

    // Residential Building Characteristics (Sections) for stories and exterior wall types
    const secTable = $("table#cphMain_repResidential_gvBuildingSections_0");
    if (secTable && secTable.length) {
      const firstDataRow = secTable
        .find("tr")
        .not(".property_table_head")
        .first();
      const tds = firstDataRow.find("td");
      if (tds.length >= 4) {
        const extText = (tds.eq(1).text() || "").trim();
        const storiesText = (tds.eq(2).text() || "").trim();
        if (storiesText) {
          const sNum = parseFloat(storiesText);
          if (!isNaN(sNum)) out.structure.number_of_stories = Math.round(sNum);
        }
        if (extText) {
          const U = extText.toUpperCase();
          let primary = null;
          let secondary = null;
          let framing = null;

          const has = (kw) => U.indexOf(kw) !== -1;
          if (has("BLOCK") || has("CONCRETE BLOCK")) framing = "Concrete Block";

          if (has("STUCCO")) primary = "Stucco";
          if (!primary && has("VINYL") && has("SIDING"))
            primary = "Vinyl Siding";
          if (!primary && has("WOOD") && has("SIDING")) primary = "Wood Siding";
          if (!primary && has("FIBER") && has("CEMENT"))
            primary = "Fiber Cement Siding";
          if (!primary && has("BRICK")) primary = "Brick";
          if (!primary && (has("BLOCK") || has("CONCRETE BLOCK")))
            primary = "Concrete Block";

          if (has("BRICK") && primary !== "Brick") secondary = "Brick Accent";
          if (
            !secondary &&
            (has("BLOCK") || has("CONCRETE BLOCK")) &&
            primary !== "Concrete Block"
          )
            secondary = "Decorative Block";
          if (!secondary && has("STUCCO") && primary !== "Stucco")
            secondary = "Stucco Accent";

          out.structure.exterior_wall_material_primary = primary;
          out.structure.exterior_wall_material_secondary = secondary || null;
          out.structure.primary_framing_material = framing || null;
        }
      }
    }

    return out;
  }

  function buildPropertyJson() {
    const propertyInfo = extractPropertyTypeFromLandData();

    const property = {
      parcel_identifier: general.parcelNumber || propSeed.parcel_id || null,
      property_structure_built_year: bx.yearBuilt || null,
      livable_floor_area: bx.livingArea ? String(bx.livingArea) : null,
      property_legal_description_text: general.legalDescription || null,
      property_type: propertyInfo.propertyType, // Now extracted from Land Data
      number_of_units_type: getUnitsType(propertyInfo.units), // Dynamic based on extracted units
      number_of_units: propertyInfo.units || 1, // Default to 1 if not found
      area_under_air: null,
      property_effective_built_year: null,
      subdivision: null,
      total_area: null,
      zoning: null,
    };

    // Remove undefined properties
    Object.keys(property).forEach((k) => {
      if (property[k] === undefined) delete property[k];
    });

    return property;
  }

  // Execute extractions in proper order
  const general = extractGeneral();
  const bx = extractBuildingAndValues();

  // Address parsing
  function parseAddress() {
    let raw = (general.propertyLocationRaw || addrSeed.full_address || "")
      .replace(/\r/g, "")
      .trim();
    raw = raw.replace(/\n/g, ", ").replace(/\s+/g, " ").trim();

    let street_number = null,
      street_name = null,
      street_suffix_type = null,
      city_name = null,
      state_code = null,
      postal_code = null;

    const m =
      raw.match(
        /^(\d+)\s+([^,]+?)\s+([A-Za-z]+)\s*,\s*([A-Z\s\-']+)\s*,?\s*([A-Z]{2})\s*,?\s*(\d{5})(?:-?(\d{4}))?$/i,
      ) ||
      raw.match(
        /^(\d+)\s+([^,]+?)\s+([A-Za-z]+),\s*([A-Z\s\-']+)\s*,\s*([A-Z]{2})\s*(\d{5})(?:-?(\d{4}))?$/i,
      ) ||
      raw.match(
        /^(\d+)\s+([^,]+?)\s+([A-Za-z]+),\s*([A-Z\s\-']+)\s*([A-Z]{2})\s*,\s*(\d{5})(?:-?(\d{4}))?$/i,
      );

    if (m) {
      street_number = m[1];
      street_name = (m[2] || "").trim().replace(/\s+/g, " ").toUpperCase();
      street_suffix_type = (m[3] || "").trim();
      city_name = (m[4] || "").trim().toUpperCase();
      state_code = (m[5] || "").trim().toUpperCase();
      postal_code = (m[6] || "").trim();
    } else {
      const fa = (addrSeed.full_address || "").trim();
      const parts = fa.split(",");
      if (parts.length >= 3) {
        const street = parts[0].trim();
        const city = parts[1].trim();
        const stZip = parts[2].trim();
        const st = stZip.match(/([A-Z]{2})/)?.[1] || null;
        const zip = stZip.match(/(\d{5})/)?.[1] || null;
        const streetParts = street.split(/\s+/);
        street_number = streetParts.shift();
        street_suffix_type = streetParts.pop() || null;
        street_name = streetParts.join(" ").toUpperCase();
        city_name = city.toUpperCase();
        state_code = st;
        postal_code = zip;
      }
    }

    const suffixMap = {
      STREET: "St",
      ST: "St",
      AVENUE: "Ave",
      AVE: "Ave",
      BOULEVARD: "Blvd",
      BLVD: "Blvd",
      ROAD: "Rd",
      RD: "Rd",
      LANE: "Ln",
      LN: "Ln",
      DRIVE: "Dr",
      DR: "Dr",
      COURT: "Ct",
      CT: "Ct",
      PLACE: "Pl",
      PL: "Pl",
      TERRACE: "Ter",
      TER: "Ter",
      CIRCLE: "Cir",
      CIR: "Cir",
      WAY: "Way",
      LOOP: "Loop",
      PARKWAY: "Pkwy",
      PKWY: "Pkwy",
      PLAZA: "Plz",
      PLZ: "Plz",
      TRAIL: "Trl",
      TRL: "Trl",
      BEND: "Bnd",
      BND: "Bnd",
      CRESCENT: "Cres",
      CRES: "Cres",
      MANOR: "Mnr",
      MNR: "Mnr",
      SQUARE: "Sq",
      SQ: "Sq",
      CROSSING: "Xing",
      XING: "Xing",
      PATH: "Path",
      RUN: "Run",
      WALK: "Walk",
      ROW: "Row",
      ALLEY: "Aly",
      ALY: "Aly",
      BEACH: "Bch",
      BCH: "Bch",
      BRIDGE: "Br",
      BRG: "Br",
      BROOK: "Brk",
      BRK: "Brk",
      BROOKS: "Brks",
      BRKS: "Brks",
      BUG: "Bg",
      BG: "Bg",
      BUGS: "Bgs",
      BGS: "Bgs",
      CLUB: "Clb",
      CLB: "Clb",
      CLIFF: "Clf",
      CLF: "Clf",
      CLIFFS: "Clfs",
      CLFS: "Clfs",
      COMMON: "Cmn",
      CMN: "Cmn",
      COMMONS: "Cmns",
      CMNS: "Cmns",
      CORNER: "Cor",
      COR: "Cor",
      CORNERS: "Cors",
      CORS: "Cors",
      CREEK: "Crk",
      CRK: "Crk",
      COURSE: "Crse",
      CRSE: "Crse",
      CREST: "Crst",
      CRST: "Crst",
      CAUSEWAY: "Cswy",
      CSWY: "Cswy",
      COVE: "Cv",
      CV: "Cv",
      CANYON: "Cyn",
      CYN: "Cyn",
      DALE: "Dl",
      DL: "Dl",
      DAM: "Dm",
      DM: "Dm",
      DRIVES: "Drs",
      DRS: "Drs",
      DIVIDE: "Dv",
      DV: "Dv",
      ESTATE: "Est",
      EST: "Est",
      ESTATES: "Ests",
      ESTS: "Ests",
      EXPRESSWAY: "Expy",
      EXPY: "Expy",
      EXTENSION: "Ext",
      EXT: "Ext",
      EXTENSIONS: "Exts",
      EXTS: "Exts",
      FALL: "Fall",
      FALL: "Fall",
      FALLS: "Fls",
      FLS: "Fls",
      FLAT: "Flt",
      FLT: "Flt",
      FLATS: "Flts",
      FLTS: "Flts",
      FORD: "Frd",
      FRD: "Frd",
      FORDS: "Frds",
      FRDS: "Frds",
      FORGE: "Frg",
      FRG: "Frg",
      FORGES: "Frgs",
      FRGS: "Frgs",
      FORK: "Frk",
      FRK: "Frk",
      FORKS: "Frks",
      FRKS: "Frks",
      FOREST: "Frst",
      FRST: "Frst",
      FREEWAY: "Fwy",
      FWY: "Fwy",
      FIELD: "Fld",
      FLD: "Fld",
      FIELDS: "Flds",
      FLDS: "Flds",
      GARDEN: "Gdn",
      GDN: "Gdn",
      GARDENS: "Gdns",
      GDNS: "Gdns",
      GLEN: "Gln",
      GLN: "Gln",
      GLENS: "Glns",
      GLNS: "Glns",
      GREEN: "Grn",
      GRN: "Grn",
      GREENS: "Grns",
      GRNS: "Grns",
      GROVE: "Grv",
      GRV: "Grv",
      GROVES: "Grvs",
      GRVS: "Grvs",
      GATEWAY: "Gtwy",
      GTWY: "Gtwy",
      HARBOR: "Hbr",
      HBR: "Hbr",
      HARBORS: "Hbrs",
      HBRS: "Hbrs",
      HILL: "Hl",
      HL: "Hl",
      HILLS: "Hls",
      HLS: "Hls",
      HOLLOW: "Holw",
      HOLW: "Holw",
      HEIGHTS: "Hts",
      HTS: "Hts",
      HAVEN: "Hvn",
      HVN: "Hvn",
      HIGHWAY: "Hwy",
      HWY: "Hwy",
      INLET: "Inlt",
      INLT: "Inlt",
      ISLAND: "Is",
      IS: "Is",
      ISLANDS: "Iss",
      ISS: "Iss",
      ISLE: "Isle",
      SPUR: "Spur",
      JUNCTION: "Jct",
      JCT: "Jct",
      JUNCTIONS: "Jcts",
      JCTS: "Jcts",
      KNOLL: "Knl",
      KNL: "Knl",
      KNOLLS: "Knls",
      KNLS: "Knls",
      LOCK: "Lck",
      LCK: "Lck",
      LOCKS: "Lcks",
      LCKS: "Lcks",
      LODGE: "Ldg",
      LDG: "Ldg",
      LIGHT: "Lgt",
      LGT: "Lgt",
      LIGHTS: "Lgts",
      LGTS: "Lgts",
      LAKE: "Lk",
      LK: "Lk",
      LAKES: "Lks",
      LKS: "Lks",
      LANDING: "Lndg",
      LNDG: "Lndg",
      MALL: "Mall",
      MEWS: "Mews",
      MEADOW: "Mdw",
      MDW: "Mdw",
      MEADOWS: "Mdws",
      MDWS: "Mdws",
      MILL: "Ml",
      ML: "Ml",
      MILLS: "Mls",
      MLS: "Mls",
      MANORS: "Mnrs",
      MNRS: "Mnrs",
      MOUNT: "Mt",
      MT: "Mt",
      MOUNTAIN: "Mtn",
      MTN: "Mtn",
      MOUNTAINS: "Mtns",
      MTNS: "Mtns",
      OVERPASS: "Opas",
      OPAS: "Opas",
      ORCHARD: "Orch",
      ORCH: "Orch",
      OVAL: "Oval",
      PARK: "Park",
      PASS: "Pass",
      PIKE: "Pike",
      PLAIN: "Pln",
      PLN: "Pln",
      PLAINS: "Plns",
      PLNS: "Plns",
      PINE: "Pne",
      PNE: "Pne",
      PINES: "Pnes",
      PNES: "Pnes",
      PRAIRIE: "Pr",
      PR: "Pr",
      PORT: "Prt",
      PRT: "Prt",
      PORTS: "Prts",
      PRTS: "Prts",
      PASSAGE: "Psge",
      PSGE: "Psge",
      POINT: "Pt",
      PT: "Pt",
      POINTS: "Pts",
      PTS: "Pts",
      RADIAL: "Radl",
      RADL: "Radl",
      RAMP: "Ramp",
      REST: "Rst",
      RIDGE: "Rdg",
      RDG: "Rdg",
      RIDGES: "Rdgs",
      RDGS: "Rdgs",
      ROADS: "Rds",
      RDS: "Rds",
      RANCH: "Rnch",
      RNCH: "Rnch",
      RAPID: "Rpd",
      RPD: "Rpd",
      RAPIDS: "Rpds",
      RPDS: "Rpds",
      ROUTE: "Rte",
      RTE: "Rte",
      SHOAL: "Shl",
      SHL: "Shl",
      SHOALS: "Shls",
      SHLS: "Shls",
      SHORE: "Shr",
      SHR: "Shr",
      SHORES: "Shrs",
      SHRS: "Shrs",
      SKYWAY: "Skwy",
      SKWY: "Skwy",
      SUMMIT: "Smt",
      SMT: "Smt",
      SPRING: "Spg",
      SPG: "Spg",
      SPRINGS: "Spgs",
      SPGS: "Spgs",
      SQUARES: "Sqs",
      SQS: "Sqs",
      STATION: "Sta",
      STA: "Sta",
      STRAVENUE: "Stra",
      STRA: "Stra",
      STREAM: "Strm",
      STRM: "Strm",
      STREETS: "Sts",
      STS: "Sts",
      THROUGHWAY: "Trwy",
      TRWY: "Trwy",
      TRACE: "Trce",
      TRCE: "Trce",
      TRAFFICWAY: "Trfy",
      TRFY: "Trfy",
      TRAILER: "Trlr",
      TRLR: "Trlr",
      TUNNEL: "Tunl",
      TUNL: "Tunl",
      UNION: "Un",
      UN: "Un",
      UNIONS: "Uns",
      UNS: "Uns",
      UNDERPASS: "Upas",
      UPAS: "Upas",
      VIEW: "Vw",
      VIEWS: "Vws",
      VILLAGE: "Vlg",
      VLG: "Vlg",
      VILLAGES: "Vlgs",
      VLGS: "Vlgs",
      VALLEY: "Vl",
      VLY: "Vl",
      VALLEYS: "Vlys",
      VLYS: "Vlys",
      WAYS: "Ways",
      VIA: "Via",
      WELL: "Wl",
      WL: "Wl",
      WELLS: "Wls",
      WLS: "Wls",
      CROSSROAD: "Xrd",
      XRD: "Xrd",
      CROSSROADS: "Xrds",
      XRDS: "Xrds",
    };
    if (street_suffix_type) {
      const key = street_suffix_type.toUpperCase();
      if (suffixMap[key]) street_suffix_type = suffixMap[key];
    }

    const countyName = addrSeed.county_jurisdiction || null;

    return {
      street_number: street_number || null,
      street_name: street_name || null,
      street_suffix_type: street_suffix_type || null,
      street_pre_directional_text: null,
      street_post_directional_text: null,
      city_name: city_name || null,
      municipality_name: null,
      state_code: state_code || null,
      postal_code: postal_code || null,
      plus_four_postal_code: null,
      country_code: "US",
      county_name: countyName || null,
      unit_identifier: null,
      latitude: null,
      longitude: null,
      route_number: null,
      township: null,
      range: null,
      section: null,
      block: null,
      lot: null,
    };
  }

  // Build unnormalized address for address.json
  const unnormalizedAddressStr = (general.propertyLocationRaw || addrSeed.full_address || "")
    .replace(/\r/g, "")
    .replace(/\n/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  // When using unnormalized_address, only include that field (oneOf constraint)
  const addr = {
    unnormalized_address: unnormalizedAddressStr || null,
  };

  // Write address.json
  writeJSON(path.join(dataDir, "address.json"), addr);
  console.log(addr)

  // 1. ALWAYS create point-based geometry for address (latitude/longitude)
  const seed = propSeed || {};
  const unAddr = addrSeed || {};
  const parcelIdentifier = general.parcelNumber || propSeed.parcel_id || null;

  const geometry = {
    source_http_request: {
      method: "GET",
      url: seed.source_http_request?.url || ""
    },
    request_identifier: parcelIdentifier || seed.parcel_id || "",
    latitude: unAddr.latitude ?? null,
    longitude: unAddr.longitude ?? null
  };
  writeJSON(path.join(dataDir, "geometry.json"), geometry);

  // Create relationship between address and geometry
  const relAddressGeometry = {
    from: { "/": "./address.json" },
    to: { "/": "./geometry.json" }
  };
  writeJSON(path.join(dataDir, "relationship_address_has_geometry.json"), relAddressGeometry);

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

  // Create relationship_property_has_address.json
  writeJSON(path.join(dataDir, "relationship_property_has_address.json"), {
    from: { "/": "./property.json" },
    to: { "/": "./address.json" },
  });

  // property.json
  const property = buildPropertyJson();
  Object.keys(property).forEach((k) => {
    if (property[k] === undefined) delete property[k];
  });
  writeJSON(path.join(dataDir, "property.json"), property);

  // parcel.json (parcelIdentifier already declared above in geometry section)
  const parcel = {
    source_http_request: propSeed?.source_http_request || {
      method: "GET",
      url: ""
    },
    request_identifier: propSeed?.request_identifier || parcelIdentifier || "",
    parcel_identifier: parcelIdentifier || ""
  };
  writeJSON(path.join(dataDir, "parcel.json"), parcel);

  // lot.json
  const lot = {
    lot_type: null,
    lot_length_feet: null,
    lot_width_feet: null,
    lot_area_sqft: null,
    landscaping_features: null,
    view: null,
    fencing_type: null,
    fence_height: null,
    fence_length: null,
    driveway_material: null,
    driveway_condition: null,
    lot_condition_issues: null,
  };
  writeJSON(path.join(dataDir, "lot.json"), lot);

  // Create relationship_property_has_lot.json
  writeJSON(path.join(dataDir, "relationship_property_has_lot.json"), {
    from: { "/": "./property.json" },
    to: { "/": "./lot.json" },
  });

  // tax_*.json
  if (
    bx.taxYear ||
    bx.marketValue ||
    bx.assessedValue ||
    bx.taxableValue ||
    bx.buildingValue ||
    bx.landValue
  ) {
    const tax = {
      tax_year: bx.taxYear || null,
      property_assessed_value_amount:
        bx.assessedValue != null ? bx.assessedValue : null,
      property_market_value_amount:
        bx.marketValue != null ? bx.marketValue : null,
      property_building_amount:
        bx.buildingValue != null ? bx.buildingValue : null,
      property_land_amount: bx.landValue != null ? bx.landValue : null,
      property_taxable_value_amount:
        bx.taxableValue != null ? bx.taxableValue : null,
      monthly_tax_amount: null,
      period_end_date: null,
      period_start_date: null,
      yearly_tax_amount: null,
      first_year_on_tax_roll: null,
      first_year_building_on_tax_roll: null,
    };
    const taxName = `tax_${tax.tax_year || "1"}.json`;
    writeJSON(path.join(dataDir, taxName), tax);
    if (tax.tax_year && fs.existsSync(path.join(dataDir, "tax_1.json"))) {
      try {
        fs.unlinkSync(path.join(dataDir, "tax_1.json"));
      } catch (e) {}
    }
  }

  // Read structure data from owners/structure_data.json
  let structureData = null;
  try {
    structureData = fs.existsSync(path.join("owners", "structure_data.json"))
      ? readJSON(path.join("owners", "structure_data.json"))
      : null;
  } catch (e) {
    structureData = null;
  }

  // Structure handling - write structure_1.json from owners data
  if (structureData && ownerKey && structureData[ownerKey]) {
    const structure = {
      ...structureData[ownerKey],
      // Merge with parsed data
      exterior_wall_material_primary:
        structureData[ownerKey].exterior_wall_material_primary ||
        bx.structure.exterior_wall_material_primary ||
        null,
      exterior_wall_material_secondary:
        structureData[ownerKey].exterior_wall_material_secondary ||
        bx.structure.exterior_wall_material_secondary ||
        null,
      primary_framing_material:
        structureData[ownerKey].primary_framing_material ||
        bx.structure.primary_framing_material ||
        null,
      number_of_stories:
        structureData[ownerKey].number_of_stories ||
        bx.structure.number_of_stories ||
        null,
    };
    writeJSON(path.join(dataDir, "structure_1.json"), structure);
  }

  // Utility handling - write utility_1.json from utilities_data
  if (utilitiesData && ownerKey && utilitiesData[ownerKey]) {
    writeJSON(path.join(dataDir, "utility_1.json"), utilitiesData[ownerKey]);
  }

  // layout_*.json from layout_data
  let layoutCount = 0;
  if (
    layoutData &&
    ownerKey &&
    layoutData[ownerKey] &&
    Array.isArray(layoutData[ownerKey].layouts)
  ) {
    const layouts = layoutData[ownerKey].layouts;
    layouts.forEach((lay, idx) => {
      const name = `layout_${idx + 1}.json`;
      writeJSON(path.join(dataDir, name), lay);
      layoutCount++;
    });

    // Create relationships: property→layout for each layout
    for (let i = 1; i <= layoutCount; i++) {
      writeJSON(path.join(dataDir, `relationship_property_has_layout_${i}.json`), {
        from: { "/": "./property.json" },
        to: { "/": `./layout_${i}.json` },
      });
    }

    // Create relationships: layout→structure and layout→utility
    // For single building, connect layout_1 to structure_1 and utility_1
    if (layoutCount > 0) {
      if (fs.existsSync(path.join(dataDir, "structure_1.json"))) {
        writeJSON(path.join(dataDir, "relationship_layout_1_has_structure_1.json"), {
          from: { "/": "./layout_1.json" },
          to: { "/": "./structure_1.json" },
        });
      }
      if (fs.existsSync(path.join(dataDir, "utility_1.json"))) {
        writeJSON(path.join(dataDir, "relationship_layout_1_has_utility_1.json"), {
          from: { "/": "./layout_1.json" },
          to: { "/": "./utility_1.json" },
        });
      }
    }
  }

  // If no layouts, connect structure and utility directly to property
  if (layoutCount === 0) {
    if (fs.existsSync(path.join(dataDir, "structure_1.json"))) {
      writeJSON(path.join(dataDir, "relationship_property_has_structure_1.json"), {
        from: { "/": "./property.json" },
        to: { "/": "./structure_1.json" },
      });
    }
    if (fs.existsSync(path.join(dataDir, "utility_1.json"))) {
      writeJSON(path.join(dataDir, "relationship_property_has_utility_1.json"), {
        from: { "/": "./property.json" },
        to: { "/": "./utility_1.json" },
      });
    }
  }

  // Owners: person_*.json or company_*.json
  // Note: Only generate owner files if there are sales to link them to
  let personFiles = [];
  let companyFiles = [];

  // Check if there are sales first before generating owner files
  const hasSales = bx.sales && bx.sales.length > 0;

  if (
    ownerData &&
    ownerKey &&
    ownerData[ownerKey] &&
    ownerData[ownerKey].owners_by_date &&
    Array.isArray(ownerData[ownerKey].owners_by_date.current) &&
    hasSales
  ) {
    const owners = ownerData[ownerKey].owners_by_date.current;
    const hasCompany = owners.some((o) => o.type === "company");
    const hasPerson = owners.some((o) => o.type === "person");

    if (hasPerson && !hasCompany) {
      let personIndex = 1;
      owners.forEach((o) => {
        if (o.type !== "person") return;
        const first = cleanName(o.first_name);
        const last = cleanName(o.last_name);
        const middle = cleanName(o.middle_name);

        // Only create person if we have valid first_name and last_name (both required by schema)
        // Ensure they are strings and not null/undefined
        if (!first || !last || typeof first !== 'string' || typeof last !== 'string') {
          console.warn(`Skipping person with invalid name: first="${o.first_name}", last="${o.last_name}"`);
          return;
        }

        const person = {
          birth_date: null,
          first_name: first,
          last_name: last,
          middle_name: middle || null,
          prefix_name: null,
          suffix_name: null,
          us_citizenship_status: null,
          veteran_status: null,
        };

        const file = `person_${personIndex}.json`;
        writeJSON(path.join(dataDir, file), person);
        personFiles.push(file);
        personIndex++;
      });
    } else if (hasCompany && !hasPerson) {
      let compIndex = 1;
      owners.forEach((o) => {
        if (o.type !== "company") return;
        const company = { name: o.name || null };
        const file = `company_${compIndex}.json`;
        writeJSON(path.join(dataDir, file), company);
        companyFiles.push(file);
        compIndex++;
      });
    }
  }

  // sales_history_*.json, deed_*.json, file_*.json + relationships
  const salesFiles = [];
  const deedFiles = [];
  const fileFiles = [];
  bx.sales.forEach((s, i) => {
    const sName = `sales_history_${i + 1}.json`;
    const salesObj = {
      ownership_transfer_date: s.ownership_transfer_date || null,
      purchase_price_amount:
        s.purchase_price_amount != null ? s.purchase_price_amount : null,
    };
    // Add source_http_request and request_identifier from propSeed
    if (propSeed && propSeed.source_http_request) {
      salesObj.source_http_request = propSeed.source_http_request;
    }
    if (propSeed && propSeed.request_identifier) {
      salesObj.request_identifier = propSeed.request_identifier;
    }
    writeJSON(path.join(dataDir, sName), salesObj);
    salesFiles.push(sName);
  });
  bx.deeds.forEach((d, i) => {
    const dName = `deed_${i + 1}.json`;
    const normalizedDeedType = normalizeDeedType(d.deed_type);
    const deedObj = {};
    if (normalizedDeedType) {
      deedObj.deed_type = normalizedDeedType;
    }
    // Add request_identifier from propSeed (but NOT source_http_request as it's not in deed schema)
    if (propSeed && propSeed.request_identifier) {
      deedObj.request_identifier = propSeed.request_identifier;
    }
    writeJSON(path.join(dataDir, dName), deedObj);
    deedFiles.push(dName);
  });
  bx.files.forEach((f, i) => {
    const fName = `file_${i + 1}.json`;
    // Only include properties that are part of the file schema
    const obj = {};
    if (f.document_type !== undefined) obj.document_type = f.document_type;
    if (f.file_format !== undefined) obj.file_format = f.file_format;
    if (f.ipfs_url !== undefined) obj.ipfs_url = f.ipfs_url;
    if (f.name !== undefined) obj.name = f.name;
    if (f.original_url !== undefined) obj.original_url = f.original_url;
    // Add request_identifier from propSeed (file schema allows it)
    if (propSeed && propSeed.request_identifier) {
      obj.request_identifier = propSeed.request_identifier;
    }
    writeJSON(path.join(dataDir, fName), obj);
    fileFiles.push(fName);
  });

  // relationship_deed_*_has_file_*.json (deed → file)
  // Use the mapping to create correct relationships
  if (bx.deedToFileMap && bx.deedToFileMap.length > 0) {
    bx.deedToFileMap.forEach((mapping) => {
      const deedNum = mapping.deedIndex + 1;
      const fileNum = mapping.fileIndex + 1;
      const rel = {
        from: { "/": `./deed_${deedNum}.json` },
        to: { "/": `./file_${fileNum}.json` },
      };
      const relName = `relationship_deed_${deedNum}_has_file_${fileNum}.json`;
      writeJSON(path.join(dataDir, relName), rel);
    });
  }

  // relationship_sales_history_*_has_deed.json (sales → deed)
  for (let i = 0; i < Math.min(salesFiles.length, deedFiles.length); i++) {
    const rel = {
      from: { "/": `./${salesFiles[i]}` },
      to: { "/": `./${deedFiles[i]}` },
    };
    const relName = `relationship_sales_history_${i + 1}_has_deed.json`;
    writeJSON(path.join(dataDir, relName), rel);
  }

  // relationship_sales_history_*_buyer_person_*.json for current owners to most recent sale
  if (personFiles.length > 0 && salesFiles.length > 0) {
    const recentSalesFile = salesFiles[0];
    const saleIdx = 1; // Most recent sale is sales_history_1.json
    personFiles.forEach((pf, idx) => {
      const rel = {
        from: { "/": `./${recentSalesFile}` },
        to: { "/": `./${pf}` },
      };
      const relName = `relationship_sales_history_${saleIdx}_buyer_person_${idx + 1}.json`;
      writeJSON(path.join(dataDir, relName), rel);
    });
  } else if (personFiles.length > 0 && salesFiles.length === 0) {
    // If there are persons but no sales, remove the person files
    // as they would be orphaned without relationships
    personFiles.forEach((pf) => {
      const personPath = path.join(dataDir, pf);
      if (fs.existsSync(personPath)) {
        fs.unlinkSync(personPath);
      }
    });
    personFiles = [];
  }

  // relationship_sales_history_*_buyer_company_*.json for companies to most recent sale
  if (companyFiles.length > 0 && salesFiles.length > 0) {
    const recentSalesFile = salesFiles[0];
    companyFiles.forEach((cf, idx) => {
      const rel = {
        from: { "/": `./${recentSalesFile}` },
        to: { "/": `./${cf}` },
      };
      const saleIdx = 1; // Most recent sale is sales_history_1.json
      const relName = `relationship_sales_history_${saleIdx}_buyer_company_${idx + 1}.json`;
      writeJSON(path.join(dataDir, relName), rel);
    });
  } else if (companyFiles.length > 0 && salesFiles.length === 0) {
    // If there are companies but no sales, remove the company files
    // as they would be orphaned without relationships
    companyFiles.forEach((cf) => {
      const companyPath = path.join(dataDir, cf);
      if (fs.existsSync(companyPath)) {
        fs.unlinkSync(companyPath);
      }
    });
    companyFiles = [];
  }
}

main();
