const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  const data = {};
  
  if (lines.length > 1) {
    // Parse CSV line properly handling quoted fields with commas
    const line = lines[1];
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current); // Add the last value
    
    headers.forEach((header, index) => {
      let value = values[index] || '';
      value = value.replace(/^"|"$/g, ''); // Remove surrounding quotes
      // Decode HTML entities
      value = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      data[header] = value;
    });
  }
  
  return data;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Warning: File not found: ${p}, returning empty object`);
      return {};
    }
    throw err;
  }
}
function readText(p) {
  return fs.readFileSync(p, "utf8");
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function parseMoney(str) {
  if (str == null) return null;
  const s = String(str).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const num = Number(s);
  return isNaN(num)
    ? null
    : Number(Number.isInteger(num) ? num : +num.toFixed(2));
}
function getNextTextAfterStrong($, label) {
  let val = null;
  $("strong").each((i, el) => {
    const t = $(el).text().trim();
    if (val == null && t === label) {
      const row = $(el).closest(".row");
      if (row.length) {
        const labelCol = $(el).closest("div");
        const next = labelCol.next();
        if (next && next.length) {
          val = next.text().trim().replace(/\s+/g, " ");
        }
      }
    }
  });
  return val;
}
function sanitizeHttpUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

function toISODate(mmddyyyy) {
  if (!mmddyyyy) return null;
  const m = mmddyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [_, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function getTextOrNull(element) {
  const text = element.text().trim();
  return text || null;
}

function mapImprovementType(raw) {
  if (!raw) return null;
  return raw;
}

const propertyUseCodeMappings=[
  {
    "property_usecode": "0000 VACANT RES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0100 SINGLE FAMILY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "SingleFamilyDetached",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0200 MOBILE HOME",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "ManufacturedHousing",
    "property_usage_type": "Residential",
    "property_type": "ManufacturedHome"
  },
  {
    "property_usecode": "0300 MFR >10 UNITS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyMoreThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0400 CONDOMINIUM",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0500 COOPERATIVES",
    "ownership_estate_type": "Cooperative",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0600 RETIREMENT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Retirement",
    "property_type": "Building"
  },
  {
    "property_usecode": "0700 MISC. RESIDENCE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0800 MFR <10 UNITS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyLessThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0900 RES COMMON ELEMENTS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1000 VACANT COMM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1100 STORES 1 STORY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1200 STORE/OFF/RES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "1300 DEPT STORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1400 SUPERMARKETS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Supermarket",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1500 SH CTR REGIONAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterRegional",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1600 SH CTR CMMITY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterCommunity",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1700 OFFICE 1 STORY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "1800 OFF MULTISTORY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "1900 OFFICE MEDICAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "2000 AIRPORT/MARINA",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "TransportationTerminal",
    "property_type": "Building"
  },
  {
    "property_usecode": "2100 RESTAURANT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Restaurant",
    "property_type": "Building"
  },
  {
    "property_usecode": "2200 REST, DRIVE-IN",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2300 FINANCIAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "FinancialInstitution",
    "property_type": "Building"
  },
  {
    "property_usecode": "2400 INSURANCE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "FinancialInstitution",
    "property_type": "Building"
  },
  {
    "property_usecode": "2500 SERVICE SHOPS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "Building"
  },
  {
    "property_usecode": "2600 SERV STATIONS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ServiceStation",
    "property_type": "Building"
  },
  {
    "property_usecode": "2700 AUTO SALES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "AutoSalesRepair",
    "property_type": "Building"
  },
  {
    "property_usecode": "2800 PKG LT / MH PK",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "MobileHomePark",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2900 WHOLESALER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "WholesaleOutlet",
    "property_type": "Building"
  },
  {
    "property_usecode": "3000 FLORIST/GRN HSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "NurseryGreenhouse",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "3100 DRV-IN THEATER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Theater",
    "property_type": "Building"
  },
  {
    "property_usecode": "3200 ENCL THTR/AUDITORIUM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Theater",
    "property_type": "Building"
  },
  {
    "property_usecode": "3300 NIGHT CLUBS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3400 BOWLING/SKATE/POOL HALL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3500 TOURIST ATTRAC",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3600 CAMPS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "Building"
  },
  {
    "property_usecode": "3700 RACETRACK",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RaceTrack",
    "property_type": "Building"
  },
  {
    "property_usecode": "3800 GOLF COURSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GolfCourse",
    "property_type": "Building"
  },
  {
    "property_usecode": "3900 HOTELS/MOTELS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Hotel",
    "property_type": "Building"
  },
  {
    "property_usecode": "4000 VACANT INDUS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Industrial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4100 LIGHT INDUSTRIAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LightManufacturing",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4200 HEAVY INDUSTRIAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "HeavyManufacturing",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4300 LUMBER YD/MILL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LumberYard",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4400 PACKING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PackingPlant",
    "property_type": "Building"
  },
  {
    "property_usecode": "4500 BOTTLER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Cannery",
    "property_type": "Building"
  },
  {
    "property_usecode": "4600 FOOD PROCESSING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Cannery",
    "property_type": "Building"
  },
  {
    "property_usecode": "4700 MIN PROCESSING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MineralProcessing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4800 WAREH/DIST TERM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4900 OPEN STORAGE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OpenStorage",
    "property_type": "Building"
  },
  {
    "property_usecode": "5000 IMPROVED AGRI",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Agricultural",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5100 CROPLAND CLASS 1",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "DrylandCropland",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5200 CROPLAND CLASS 2",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "CroplandClass2",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5300 CROPLAND CLASS 3",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "CroplandClass3",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5400 TIMBERLAND IDX 90+",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5500 TIMBERLAND IDX 80-89",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5600 TIMBERLAND IDX 70-79",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5700 TIMBERLAND IDX 60-69",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5800 TIMBERLAND IDX 50-59",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5900 TMBR NOT CLSSFD",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6000 GRAZING CLASS I",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6100 GRAZING CLASS II",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6200 GRAZING CLASS III",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6300 GRAZING CLASS IV",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6400 GRAZING CLASS V",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6500 GRAZING CLASS VI",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6600 ORCHARD GROVES/CITRUS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "OrchardGroves",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6700 POUL/BEES/FISH",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LivestockFacility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6800 DAIRIES/FEED LOTS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LivestockFacility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6900 ORN/MISC AGRI",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Agricultural",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7000 VACANT INSTIT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "NonProfitCharity",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7100 CHURCHES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Church",
    "property_type": "Building"
  },
  {
    "property_usecode": "7200 PRV SCHL/COLL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PrivateSchool",
    "property_type": "Building"
  },
  {
    "property_usecode": "7300 PRV HOSPITAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PrivateHospital",
    "property_type": "Building"
  },
  {
    "property_usecode": "7400 HOMES FOR THE AGED",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "HomesForAged",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7500 ORPHNG/NON-PROF",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "NonProfitCharity",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7600 MORT/CEMETERY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MortuaryCemetery",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7700 CLB/LDG/UN HALL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "NonProfitCharity",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7800 SANI/ REST HOME",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "SanitariumConvalescentHome",
    "property_type": "Building"
  },
  {
    "property_usecode": "7900 CULTURAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "CulturalOrganization",
    "property_type": "Building"
  },
  {
    "property_usecode": "8000 VACANT GOVERNMENTAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8100 MILITARY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Military",
    "property_type": "Building"
  },
  {
    "property_usecode": "8200 FOREST/PK/REC",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ForestParkRecreation",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8300 PUBLIC CTY SCHOOL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PublicSchool",
    "property_type": "Building"
  },
  {
    "property_usecode": "8400 COLLEGE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "CulturalOrganization",
    "property_type": "Building"
  },
  {
    "property_usecode": "8500 HOSPITAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PublicHospital",
    "property_type": "Building"
  },
  {
    "property_usecode": "8600 COUNTY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8700 STATE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8800 FEDERAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8900 MUNICIPAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "9000 LEASEHOLD INT",
    "ownership_estate_type": "Leasehold",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Unknown",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9100 UTILITY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9200 MING/PET/GASLND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "MineralProcessing",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9300 SUBSURF RIGHTS",
    "ownership_estate_type": "SubsurfaceRights",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "MineralProcessing",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9400 RIGHTS OF WAY",
    "ownership_estate_type": "RightOfWay",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9500 RIVERS/LAKES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9600 SEWG/WASTE LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "SewageDisposal",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9700 OUTDR REC/PK LD",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9800 CENTRALLY ASSD",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Unknown",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9900 NON AG",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Unknown",
    "property_type": "LandParcel"
  }
]


function extractLegalDescription($) {
  // Find the strong label, then take parent text minus the label
  const strong = $("strong")
    .filter((i, el) => $(el).text().trim() === "Legal Description")
    .first();
  if (strong.length) {
    const parent = strong.parent();
    if (parent && parent.length) {
      const clone = parent.clone();
      clone.find("strong").remove();
      const txt = clone
        .text()
        .trim()
        .replace(/^\s*[:\-]?\s*/, "")
        .replace(/\s+/g, " ");
      return txt || null;
    }
  }
  return null;
}

function extractPropertyValuesByYear($, year) {
  // Search within section-values for blocks containing the year
  const result = { building: null, land: null, market: null };
  $("#section-values")
    .find("*")
    .each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes(String(year))) {
        // Try labeled (mobile) pattern
        const m1 = text.match(/Improvement Value:\s*\$([0-9,]+)/i);
        const m2 = text.match(/Land Value:\s*\$([0-9,]+)/i);
        const m3 = text.match(/Just\/Market Value:\s*\$([0-9,]+)/i);
        if (m1 && m2 && m3) {
          result.building = `$${m1[1]}`;
          result.land = `$${m2[1]}`;
          result.market = `$${m3[1]}`;
          return false;
        }
        // Try unlabeled column pattern: pick first three $ amounts
        const dollars = text.match(/\$[0-9,]+/g);
        if (dollars && dollars.length >= 3) {
          // In Property Values, order is Improvement, Land, Just
          result.building = dollars[0];
          result.land = dollars[1];
          result.market = dollars[2];
          return false;
        }
      }
    });
  return result;
}

function extractWorkingTaxValues($) {
  // From Working Tax Roll Values by Taxing Authority (first ad valorem row)
  const r = { market: null, assessed: null, taxable: null };
  const rows = $("#taxAuthority .row");
  for (let i = 0; i < rows.length; i++) {
    const row = rows.eq(i);
    const text = row.text();
    const dollars = text.match(/\$[0-9,]+/g);
    if (dollars && dollars.length >= 4) {
      r.market = dollars[0];
      r.assessed = dollars[1];
      // dollars[2] is Ex/10CAP
      r.taxable = dollars[3];
      break;
    }
  }
  return r;
}



/**
 * Identify whether a layout record represents a building-level space.
 * @param {LayoutRecord} record - Layout record to evaluate.
 * @returns {boolean} True when the record payload is a building layout.
 */
function isBuildingLayoutRecord(record) {
  if (!record || typeof record !== "object") return false;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return false;
  const type =
    typeof payload.space_type === "string" ? payload.space_type.trim() : "";
  return type.toLowerCase() === "building";
}

/**
 * Remove files whose names satisfy the provided predicate.
 * @param {string} directory - Directory that contains the relationship files.
 * @param {(fileName: string) => boolean} matcher - Predicate identifying files for removal.
 * @returns {void}
 */
function removeFilesByPredicate(directory, matcher) {
  if (!fs.existsSync(directory)) return;
  const entries = fs.readdirSync(directory, { encoding: "utf8" });
  for (const entry of entries) {
    if (matcher(entry)) {
      const target = path.join(directory, entry);
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
  }
}

/** @type {Map<string, Map<string, { fileName: string, isCanonical: boolean }>>} */
const relationshipRegistry = new Map();

/**
 * Write a relationship JSON file with canonical Elephant structure while avoiding duplicate edges.
 * @param {string} directory - Directory to emit the relationship file.
 * @param {string} targetName - File name to write inside the directory.
 * @param {string} fromRef - Relative pointer to the `from` entity JSON (e.g. `./property.json`).
 * @param {string} toRef - Relative pointer to the `to` entity JSON (e.g. `./layout_1.json`).
 * @returns {void}
 */
function writeRelationshipFile(directory, targetName, fromRef, toRef) {
  const resolvedDirectory = path.resolve(directory);
  let directoryRegistry = relationshipRegistry.get(resolvedDirectory);
  if (!directoryRegistry) {
    directoryRegistry = new Map();
    relationshipRegistry.set(resolvedDirectory, directoryRegistry);
  }

  const signature = `${fromRef}->${toRef}`;
  const isCanonical = !/_\d+\.json$/.test(targetName);
  const relationshipBody = {
    from: { "/": fromRef },
    to: { "/": toRef },
  };
  const targetPath = path.join(directory, targetName);
  let existingRecord = directoryRegistry.get(signature);
  if (existingRecord) {
    const existingPath = path.join(directory, existingRecord.fileName);
    if (!fs.existsSync(existingPath)) {
      directoryRegistry.delete(signature);
      existingRecord = undefined;
    }
  }

  if (!existingRecord) {
    directoryRegistry.set(signature, { fileName: targetName, isCanonical });
    writeJSON(targetPath, relationshipBody);
    return;
  }

  if (isCanonical) {
    if (!existingRecord.isCanonical) {
      const priorPath = path.join(directory, existingRecord.fileName);
      if (fs.existsSync(priorPath)) {
        fs.unlinkSync(priorPath);
      }
    }
    directoryRegistry.set(signature, { fileName: targetName, isCanonical: true });
    writeJSON(targetPath, relationshipBody);
    return;
  }

  if (existingRecord.isCanonical) {
    return;
  }

  if (existingRecord.fileName !== targetName) {
    return;
  }

  writeJSON(targetPath, relationshipBody);
}

function normalizeOwnerKey(o) {
  if (!o) return null;
  const fn = (o.first_name || "").trim().toLowerCase();
  const mn = (o.middle_name || "").trim().toLowerCase();
  const ln = (o.last_name || "").trim().toLowerCase();
  return [fn, mn, ln].filter(Boolean).join("|");
}

function normalizeCompanyKey(o) {
  if (!o) return null;
  const name = (o.name || "").trim().toLowerCase();
  return name || null;
}



/**
 * Convert a numeric-like string into an integer or null when unsuitable.
 * @param {string|null|undefined} rawValue - Raw textual value that may contain digits.
 * @returns {number|null} Parsed integer or null when conversion fails.
 */
function toIntegerOrNull(rawValue) {
  if (rawValue == null) return null;
  const numericText = String(rawValue).replace(/[^0-9]/g, "");
  if (numericText.length === 0) return null;
  const parsed = Number.parseInt(numericText, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize a floor label into a key suitable for grouping hierarchy relationships.
 * @param {string|null|undefined} floorLabel - Raw floor label (e.g. `1st Floor`).
 * @returns {string|null} Canonical key used to identify matching floors.
 */
function normalizeFloorKey(floorLabel) {
  if (floorLabel == null) return null;
  const trimmed = String(floorLabel).trim();
  if (trimmed.length === 0) return null;
  const numericMatch = trimmed.match(/(\d+)/);
  if (numericMatch) {
    return numericMatch[1];
  }
  return trimmed.toLowerCase();
}

/**
 * Determine a numeric sort key for floor ordering.
 * Floors with numeric identifiers are ordered ascending; others fall back to lexical order.
 * @param {string} floorKey - Normalized floor key generated by {@link normalizeFloorKey}.
 * @returns {number} Sort key for ordering floors.
 */
function floorSortValue(floorKey) {
  const numericMatch = floorKey.match(/^\d+$/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[0], 10);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Construct the base payload for a building-level layout entry.
 * @param {number|null} totalAreaSqFt - Total enclosed building area in square feet.
 * @param {number|null} livableAreaSqFt - Livable (heated) area in square feet.
 * @returns {LayoutPayload} Building layout payload with placeholder space index (set later).
 */
function createBuildingLayoutPayload(totalAreaSqFt, livableAreaSqFt) {
  return {
    space_type: "Building",
    space_index: null,
    size_square_feet: totalAreaSqFt,
    total_area_sq_ft: totalAreaSqFt,
    livable_area_sq_ft: livableAreaSqFt,
    floor_level: null,
    has_windows: null,
    is_finished: true,
    is_exterior: false,
    flooring_material_type: null,
    window_design_type: null,
    window_material_type: null,
    window_treatment_type: null,
    furnished: null,
    paint_condition: null,
    flooring_wear: null,
    clutter_level: null,
    visible_damage: null,
    countertop_material: null,
    cabinet_style: null,
    fixture_finish_quality: null,
    design_style: null,
    natural_light_quality: null,
    decor_elements: null,
    pool_type: null,
    pool_equipment: null,
    spa_type: null,
    safety_features: null,
    view_type: null,
    lighting_features: null,
    condition_issues: null,
    pool_condition: null,
    pool_surface_type: null,
    pool_water_quality: null,
  };
}

/**
 * Build a floor-level layout payload used when explicit floor hierarchy is available.
 * @param {string} floorLabel - Human readable floor label (e.g. `1st Floor` or `Basement`).
 * @returns {LayoutPayload} Floor layout payload with unset space index (populated later).
 */
function createFloorLayoutPayload(floorLabel) {
  return {
    space_type: "Floor",
    space_index: null,
    size_square_feet: null,
    total_area_sq_ft: null,
    livable_area_sq_ft: null,
    floor_level: floorLabel,
    has_windows: null,
    is_finished: null,
    is_exterior: null,
    flooring_material_type: null,
    window_design_type: null,
    window_material_type: null,
    window_treatment_type: null,
    furnished: null,
    paint_condition: null,
    flooring_wear: null,
    clutter_level: null,
    visible_damage: null,
    countertop_material: null,
    cabinet_style: null,
    fixture_finish_quality: null,
    design_style: null,
    natural_light_quality: null,
    decor_elements: null,
    pool_type: null,
    pool_equipment: null,
    spa_type: null,
    safety_features: null,
    view_type: null,
    lighting_features: null,
    condition_issues: null,
    pool_condition: null,
    pool_surface_type: null,
    pool_water_quality: null,
  };
}

/**
 * @typedef {"LandParcel"|"Building"|"Unit"|"ManufacturedHome"} LexiconPropertyType
 */

/**
 * @typedef {"Residential"|"Commercial"|"Industrial"|"Agricultural"|"Recreational"|"Conservation"|"Retirement"|"ResidentialCommonElementsAreas"|"DrylandCropland"|"HayMeadow"|"CroplandClass2"|"CroplandClass3"|"TimberLand"|"GrazingLand"|"OrchardGroves"|"Poultry"|"Ornamentals"|"Church"|"PrivateSchool"|"PrivateHospital"|"HomesForAged"|"NonProfitCharity"|"MortuaryCemetery"|"ClubsLodges"|"SanitariumConvalescentHome"|"CulturalOrganization"|"Military"|"ForestParkRecreation"|"PublicSchool"|"PublicHospital"|"GovernmentProperty"|"RetailStore"|"DepartmentStore"|"Supermarket"|"ShoppingCenterRegional"|"ShoppingCenterCommunity"|"OfficeBuilding"|"MedicalOffice"|"TransportationTerminal"|"Restaurant"|"FinancialInstitution"|"ServiceStation"|"AutoSalesRepair"|"MobileHomePark"|"WholesaleOutlet"|"Theater"|"Entertainment"|"Hotel"|"RaceTrack"|"GolfCourse"|"LightManufacturing"|"HeavyManufacturing"|"LumberYard"|"PackingPlant"|"Cannery"|"MineralProcessing"|"Warehouse"|"OpenStorage"|"Utility"|"RiversLakes"|"SewageDisposal"|"Railroad"|"TransitionalProperty"|"ReferenceParcel"|"NurseryGreenhouse"|"AgriculturalPackingFacility"|"LivestockFacility"|"Aquaculture"|"VineyardWinery"|"DataCenter"|"TelecommunicationsFacility"|"SolarFarm"|"WindFarm"|"NativePasture"|"ImprovedPasture"|"Rangeland"|"PastureWithTimber"|"Unknown"} LexiconPropertyUsageType
 */

/**
 * @typedef {"Condominium"|"Cooperative"|"LifeEstate"|"Timeshare"|"OtherEstate"|"FeeSimple"|"Leasehold"|"RightOfWay"|"NonWarrantableCondo"|"SubsurfaceRights"|null} LexiconOwnershipEstateType
 */

/**
 * @typedef {"SingleFamilyDetached"|"SingleFamilySemiDetached"|"TownhouseRowhouse"|"Duplex"|"Triplex"|"Quadplex"|"MultiFamily5Plus"|"ApartmentUnit"|"Loft"|"ManufacturedHomeOnLand"|"ManufacturedHomeInPark"|"MultiFamilyMoreThan10"|"MultiFamilyLessThan10"|"MobileHome"|"ManufacturedHousingMultiWide"|"ManufacturedHousing"|"ManufacturedHousingSingleWide"|"Modular"|null} LexiconStructureForm
 */

/**
 * @typedef {"VacantLand"|"Improved"|"UnderConstruction"|null} LexiconBuildStatus
 */

/**
 * @typedef {Object} PropertyUseMappingDetail
 * @property {LexiconPropertyType} propertyType
 * @property {LexiconPropertyUsageType|null} propertyUsageType
 * @property {LexiconOwnershipEstateType} ownershipEstateType
 * @property {LexiconStructureForm} structureForm
 * @property {LexiconBuildStatus} buildStatus
 * @property {readonly string[]} descriptors
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePropertyUseLabel(value) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}




const seed = readJSON("property_seed.json");
const appendSourceInfo = (seed) => ({
  source_http_request: {
    method: "GET",
    url: seed?.source_http_request?.url || null,
    multiValueQueryString: seed?.source_http_request?.multiValueQueryString || null,
  },
  request_identifier: seed?.request_identifier || seed?.parcel_id || "",
  });

function createStructureFiles(seed,parcelIdentifier) {
  // Create structures for each building
  let structuresData = null;
  let layoutsData = null;
  try {
    structuresData = readJSON(path.join("owners", "structure_data.json"));
  } catch (e) {}
  try {
    layoutsData = readJSON(path.join("owners", "layout_data.json"));
  } catch (e) {}
  
  if (structuresData && parcelIdentifier) {
    console.log("INSIDE")
    const key = `property_${parcelIdentifier}`;
    const structures = structuresData[key]?.structures || [];
    structures.forEach((struct, idx) => {
      const structureOut = {
        ...appendSourceInfo(seed),
        architectural_style_type: struct?.architectural_style_type ?? null,
        attachment_type: struct?.attachment_type ?? null,
        exterior_wall_material_primary: struct?.exterior_wall_material_primary ?? null,
        exterior_wall_material_secondary: struct?.exterior_wall_material_secondary ?? null,
        exterior_wall_condition: struct?.exterior_wall_condition ?? null,
        exterior_wall_insulation_type: struct?.exterior_wall_insulation_type ?? null,
        flooring_material_primary: struct?.flooring_material_primary ?? null,
        flooring_material_secondary: struct?.flooring_material_secondary ?? null,
        subfloor_material: struct?.subfloor_material ?? null,
        flooring_condition: struct?.flooring_condition ?? null,
        interior_wall_structure_material: struct?.interior_wall_structure_material ?? null,
        interior_wall_surface_material_primary: struct?.interior_wall_surface_material_primary ?? null,
        interior_wall_surface_material_secondary: struct?.interior_wall_surface_material_secondary ?? null,
        interior_wall_finish_primary: struct?.interior_wall_finish_primary ?? null,
        interior_wall_finish_secondary: struct?.interior_wall_finish_secondary ?? null,
        interior_wall_condition: struct?.interior_wall_condition ?? null,
        roof_covering_material: struct?.roof_covering_material ?? null,
        roof_underlayment_type: struct?.roof_underlayment_type ?? null,
        roof_structure_material: struct?.roof_structure_material ?? null,
        roof_design_type: struct?.roof_design_type ?? null,
        roof_condition: struct?.roof_condition ?? null,
        roof_age_years: struct?.roof_age_years ?? null,
        gutters_material: struct?.gutters_material ?? null,
        gutters_condition: struct?.gutters_condition ?? null,
        roof_material_type: struct?.roof_material_type ?? null,
        foundation_type: struct?.foundation_type ?? null,
        foundation_material: struct?.foundation_material ?? null,
        foundation_waterproofing: struct?.foundation_waterproofing ?? null,
        foundation_condition: struct?.foundation_condition ?? null,
        ceiling_structure_material: struct?.ceiling_structure_material ?? null,
        ceiling_surface_material: struct?.ceiling_surface_material ?? null,
        ceiling_insulation_type: struct?.ceiling_insulation_type ?? null,
        ceiling_height_average: struct?.ceiling_height_average ?? null,
        ceiling_condition: struct?.ceiling_condition ?? null,
        exterior_door_material: struct?.exterior_door_material ?? null,
        interior_door_material: struct?.interior_door_material ?? null,
        window_frame_material: struct?.window_frame_material ?? null,
        window_glazing_type: struct?.window_glazing_type ?? null,
        window_operation_type: struct?.window_operation_type ?? null,
        window_screen_material: struct?.window_screen_material ?? null,
        primary_framing_material: struct?.primary_framing_material ?? null,
        secondary_framing_material: struct?.secondary_framing_material ?? null,
        structural_damage_indicators: struct?.structural_damage_indicators ?? null,
        finished_base_area: struct?.finished_base_area ?? null,
        finished_basement_area: struct?.finished_basement_area ?? null,
        finished_upper_story_area: struct?.finished_upper_story_area ?? null,
        number_of_stories: struct?.number_of_stories ?? null,
        roof_date: struct?.roof_date ?? null,
        siding_installation_date: struct?.siding_installation_date ?? null,
        exterior_door_installation_date: struct?.exterior_door_installation_date ?? null,
        foundation_repair_date: struct?.foundation_repair_date ?? null,
        window_installation_date: struct?.window_installation_date ?? null
      };
      writeJSON(path.join("data", `structure_${struct.structure_index || idx + 1}.json`), structureOut);
      
      // Create relationship between building layout and structure
      const buildingNumber = struct.building_number || idx + 1;
      const structureIndex = struct.structure_index || idx + 1;
      
      // Find the correct building layout file index
      let buildingLayoutIndex = buildingNumber;
      // console.log("BUILDING_NUMBER",buildingNumber)
      if (layoutsData && parcelIdentifier) {
        // console.log(layoutsData)
        const key = `property_${parcelIdentifier}`;
        const layouts = layoutsData[key]?.layouts || [];
        // console.log(layouts)
        const buildingLayout = layouts.find((layout, layoutIdx) => 
          layout.space_type === "Building" && layout.building_number === buildingNumber
        );
        // console.log("BUILDING_LAYOUT", buildingLayout)
        if (buildingLayout) {
          buildingLayoutIndex = layouts.indexOf(buildingLayout) + 1;
        }
      }
      
      const relationship = {
        from: { "/": `./layout_${buildingLayoutIndex}.json` },
        to: { "/": `./structure_${structureIndex}.json` }
      };
      writeJSON(
        path.join("data", `relationship_layout_${buildingNumber}_has_structure_${structureIndex}.json`),
        relationship
      );
    });
  }


}

function createUtilitiesFiles(seed,parcelIdentifier){
  let utilitiesData = null;
  let layoutsData = null;
  try {
    utilitiesData = readJSON(path.join("owners", "utilities_data.json"));
  } catch (e) {}
  try {
    layoutsData = readJSON(path.join("owners", "layout_data.json"));
  } catch (e) {}
  
  
  if (utilitiesData && parcelIdentifier) {
    const key = `property_${parcelIdentifier}`;
    const utilities = utilitiesData[key]?.utilities || [];
    utilities.forEach((util, idx) => {
      const utilityOut = {
        ...appendSourceInfo(seed),
        cooling_system_type: util?.cooling_system_type ?? null,
        heating_system_type: util?.heating_system_type ?? null,
        public_utility_type: util?.public_utility_type ?? null,
        sewer_type: util?.sewer_type ?? null,
        water_source_type: util?.water_source_type ?? null,
        plumbing_system_type: util?.plumbing_system_type ?? null,
        plumbing_system_type_other_description: util?.plumbing_system_type_other_description ?? null,
        electrical_panel_capacity: util?.electrical_panel_capacity ?? null,
        electrical_wiring_type: util?.electrical_wiring_type ?? null,
        hvac_condensing_unit_present: util?.hvac_condensing_unit_present ?? null,
        electrical_wiring_type_other_description: util?.electrical_wiring_type_other_description ?? null,
        solar_panel_present: util?.solar_panel_present ? true : false,
        solar_panel_type: util?.solar_panel_type ?? null,
        solar_panel_type_other_description: util?.solar_panel_type_other_description ?? null,
        smart_home_features: util?.smart_home_features ?? null,
        smart_home_features_other_description: util?.smart_home_features_other_description ?? null,
        hvac_unit_condition: util?.hvac_unit_condition ?? null,
        solar_inverter_visible: util?.solar_inverter_visible ? true : false,
        hvac_unit_issues: util?.hvac_unit_issues ?? null
      };
      writeJSON(path.join("data", `utility_${util.utility_index || idx + 1}.json`), utilityOut);
      
      // Create relationship between building layout and utility
      const buildingNumber = util.building_number || idx + 1;
      const utilityIndex = util.utility_index || idx + 1;
      
      // Find the correct building layout file index
      let buildingLayoutIndex = buildingNumber;
      if (layoutsData && parcelIdentifier) {
        const key = `property_${parcelIdentifier}`;
        const layouts = layoutsData[key]?.layouts || [];
        const buildingLayout = layouts.find((layout, layoutIdx) => 
          layout.space_type === "Building" && layout.building_number === buildingNumber
        );
        if (buildingLayout) {
          buildingLayoutIndex = layouts.indexOf(buildingLayout) + 1;
        }
      }
      
      const relationship = {
        from: { "/": `./layout_${buildingLayoutIndex}.json` },
        to: { "/": `./utility_${utilityIndex}.json` }
      };
      writeJSON(
        path.join("data", `relationship_layout_${buildingNumber}_has_utility_${utilityIndex}.json`),
        relationship
      );
    });
  }

}


function createLayoutFiles(seed,parcelIdentifier){
  let layoutsData = null;
  try {
    layoutsData = readJSON(path.join("owners", "layout_data.json"));
  } catch (e) {}

  if (layoutsData && parcelIdentifier) {
    const key = `property_${parcelIdentifier}`;
    const layouts = layoutsData[key]?.layouts || [];
    layouts.forEach((layout, idx) => {
      const out = {
        ...appendSourceInfo(seed),
        space_type: layout.space_type ?? null,
        built_year: layout.built_year ?? null,
        total_area_sq_ft: layout.total_area_sq_ft ?? null,
        livable_area_sq_ft: layout.livable_area_sq_ft ?? null,
        heated_area_sq_ft:   layout.heated_area_sq_ft ?? null,
        area_under_air_sq_ft: layout.area_under_air_sq_ft ?? null,
        space_type_index: String(layout.space_type_index || (idx + 1)),
        flooring_material_type: layout.flooring_material_type ?? null,
        size_square_feet: layout.size_square_feet ?? null,
        // floor_level: layout.floor_level ?? null,
        has_windows: layout.has_windows ?? null,
        window_design_type: layout.window_design_type ?? null,
        window_material_type: layout.window_material_type ?? null,
        window_treatment_type: layout.window_treatment_type ?? null,
        is_finished: !!layout.is_finished,
        furnished: layout.furnished ?? null,
        paint_condition: layout.paint_condition ?? null,
        flooring_wear: layout.flooring_wear ?? null,
        clutter_level: layout.clutter_level ?? null,
        visible_damage: layout.visible_damage ?? null,
        countertop_material: layout.countertop_material ?? null,
        cabinet_style: layout.cabinet_style ?? null,
        fixture_finish_quality: layout.fixture_finish_quality ?? null,
        design_style: layout.design_style ?? null,
        natural_light_quality: layout.natural_light_quality ?? null,
        decor_elements: layout.decor_elements ?? null,
        pool_type: layout.pool_type ?? null,
        pool_equipment: layout.pool_equipment ?? null,
        spa_type: layout.spa_type ?? null,
        safety_features: layout.safety_features ?? null,
        view_type: layout.view_type ?? null,
        lighting_features: layout.lighting_features ?? null,
        condition_issues: layout.condition_issues ?? null,
        is_exterior: !!layout.is_exterior,
        pool_condition: layout.pool_condition ?? null,
        pool_surface_type: layout.pool_surface_type ?? null,
        pool_water_quality: layout.pool_water_quality ?? null,
        bathroom_renovation_date: layout.bathroom_renovation_date ?? null,
        kitchen_renovation_date: layout.kitchen_renovation_date ?? null,
        flooring_installation_date: layout.flooring_installation_date ?? null,
        building_number: layout.building_number ?? null
      };
      writeJSON(path.join("data", `layout_${idx + 1}.json`), out);
    });
    
    // Create layout relationships
    layouts.forEach((layout, idx) => {
      if (layout.space_type === "Building") {
        const buildingLayoutIndex = idx + 1; // Use actual file index
        const buildingNumber = layout.building_number;
        
        // Find sub-layouts for this building
        layouts.forEach((subLayout, subIdx) => {
          if (subLayout.building_number === buildingNumber && subLayout.space_type !== "Building") {
            const subLayoutIndex = subIdx + 1; // Use actual file index
            const relationship = {
              from: { "/": `./layout_${buildingLayoutIndex}.json` },
              to: { "/": `./layout_${subLayoutIndex}.json` }
            };
            writeJSON(
              path.join("data", `relationship_layout_${buildingNumber}_has_layout_${subLayoutIndex}.json`),
              relationship
            );
          }
        });
      }
    });
  }


}

async function fetchParcelPolygon(altKey) {
  const https = require('https');
  const url = `https://maps5.vcgov.org/arcgis/rest/services/Pictometry_Parcels/MapServer/0/query?f=json&where=ALTKEY%20in%20(%27${altKey}%27)&returnGeometry=true&spatialRel=esriSpatialRelIntersects&outFields=ALTKEY`;
  
  let timeoutId;
  
  const fetchPromise = new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        clearTimeout(timeoutId);
        try {
          const response = JSON.parse(data);
          if (response.features && response.features.length > 0) {
            const geometry = response.features[0].geometry;
            if (geometry && geometry.rings) {
              resolve(geometry.rings);
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      clearTimeout(timeoutId);
      resolve(null);
    });
  });

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      console.log('API request timed out after 15 seconds. Parcel polygon coordinates not available in api.');
      resolve(null);
    }, 15000);
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}

async function createParcelAndGeometry(seed, parcelId, dataDir, altKey) {
  // 1) Create parcel.json
  const parcel = {
    ...appendSourceInfo(seed),
    parcel_identifier: String(parcelId)
  };
  writeJSON(path.join(dataDir, "parcel.json"), parcel);

  // 2) Create relationship between property and parcel
  const propertyParcelRel = {
    from: { "/": "./property.json" },
    to: { "/": "./parcel.json" }
  };
  writeJSON(path.join(dataDir, "relationship_property_has_parcel.json"), propertyParcelRel);

  // 3) Check parcel_polygon from CSV first
  let csvData = null;
  try {
    csvData = readCSV("input.csv");
  } catch (e) {
    console.log("Could not read input.csv:", e.message);
  }
  
  let parcelPolygon = csvData?.parcel_polygon;
  console.log("PARCEL POLYGON FROM CSV (first 200 chars):", parcelPolygon?.substring(0, 200));
  console.log("PARCEL POLYGON LENGTH:", parcelPolygon?.length);
  
  // If no parcel_polygon in CSV or it's empty, fetch from API
  if ((!parcelPolygon || parcelPolygon === "") && altKey) {
    try {
      console.log("Fetching parcel polygon from API...");
      parcelPolygon = await fetchParcelPolygon(altKey);
      if (!parcelPolygon) {
        console.log("no polygon coordinates found from api request as well.Not creating geometry class for parcel.");
      }
      else{
          console.log("Parcel polygon fetched from API successfully.",parcelPolygon);
      }
    } catch (e) {
      console.log("Failed to fetch parcel polygon:", e);
    }
  }
  
  if (parcelPolygon) {
    let polygonData;
    try {
      polygonData = typeof parcelPolygon === 'string' ? JSON.parse(parcelPolygon) : parcelPolygon;
      console.log("Parsed polygon data structure:", JSON.stringify(polygonData).substring(0, 300));
    } catch (e) {
      console.log("Failed to parse parcel_polygon:", e);
      return;
    }

    // Flatten nested arrays to find coordinate arrays
    function flattenToCoordinateArrays(data) {
      if (!Array.isArray(data)) return [];
      
      // Check if this is a coordinate pair [lng, lat]
      if (data.length === 2 && typeof data[0] === 'number' && typeof data[1] === 'number') {
        return [data];
      }
      
      // Check if this is an array of coordinate pairs
      if (data.length > 0 && Array.isArray(data[0]) && data[0].length === 2 && typeof data[0][0] === 'number') {
        return [data];
      }
      
      // Otherwise, flatten recursively
      const result = [];
      for (const item of data) {
        result.push(...flattenToCoordinateArrays(item));
      }
      return result;
    }
    
    const coordinateArrays = flattenToCoordinateArrays(polygonData);
    console.log(`Found ${coordinateArrays.length} coordinate arrays in the polygon data`);

    coordinateArrays.forEach((coords, index) => {
      if (Array.isArray(coords) && coords.length > 0) {
        console.log(`Processing polygon ${index + 1} with ${coords.length} coordinate pairs`);
        
        // Convert coordinate pairs to lat/lng objects
        const polygon = coords.map(coord => {
          if (Array.isArray(coord) && coord.length >= 2) {
            return {
              latitude: coord[1],  // Second element is latitude
              longitude: coord[0]  // First element is longitude
            };
          }
          return null;
        }).filter(Boolean);

        console.log(`Converted to ${polygon.length} valid coordinate objects`);

        if (polygon.length > 0) {
          const geometryParcel = {
            ...appendSourceInfo(seed),
            polygon: polygon
          };
          
          const geometryFileName = `geometry_parcel_${index + 1}.json`;
          writeJSON(path.join(dataDir, geometryFileName), geometryParcel);

          // 4) Create relationship between parcel and geometry
          const parcelGeometryRel = {
            from: { "/": "./parcel.json" },
            to: { "/": `./${geometryFileName}` }
          };
          writeJSON(path.join(dataDir, `relationship_parcel_has_geometry_${index + 1}.json`), parcelGeometryRel);
        }
      }
    });
  }
}

async function main() {
  const dataDir = path.join("data");
  ensureDir(dataDir);

  const html = readText("input.html");
  const $ = cheerio.load(html);

  const unAddr = readJSON("unnormalized_address.json");
  const seed = readJSON("property_seed.json");
  const appendSourceInfo = (seed) => ({
    source_http_request: {
      method: "GET",
      url: seed?.source_http_request?.url || null,
      multiValueQueryString: seed?.source_http_request?.multiValueQueryString || null,
    },
    request_identifier: seed?.request_identifier || seed?.parcel_id || "",
    });

  // Owners, Utilities, Layout from owners/*.json
  const ownersPath = path.join("owners", "owner_data.json");
  const utilsPath = path.join("owners", "utilities_data.json");
  const layoutPath = path.join("owners", "layout_data.json");

  const ownersData = readJSON(ownersPath);
  const utilsData = readJSON(utilsPath);
  const layoutData = readJSON(layoutPath);

  // Helper extractors from HTML
  function extractTopValue(label) {
    let out = null;
    $(".row").each((i, row) => {
      const $row = $(row);
      const strongs = $row.find("strong");
      strongs.each((j, s) => {
        if ($(s).text().trim() === label) {
          const parentCol = $(s).closest("div");
          const vcol = parentCol.next();
          if (vcol && vcol.length) {
            out = vcol.text().trim().replace(/\s+/g, " ");
          }
        }
      });
    });
    return out;
  }

  const parcelId = (
    extractTopValue("Parcel ID:") ||
    seed.parcel_id ||
    ""
  ).replace(/[^0-9]/g, "");
  const altKeyInput = $("input#altkey").attr("value");
  const altKeyFromLabel = extractTopValue("Alternate Key:");
  const altKey = (
    altKeyInput && /\d/.test(altKeyInput)
      ? altKeyInput
      : altKeyFromLabel || seed.altkey || ""
  ).replace(/[^0-9]/g, "");

  // Address components: prefer unnormalized_address.full_address
  const fullAddr = extractTopValue("Physical Address:");
  let street_number = null,
    street_name = null,
    street_suffix_type = null,
    city_name = null,
    state_code = null,
    postal_code = null,
    plus4 = null,
    street_pre_directional_text = null,
    street_post_directional_text = null;
  /** @type {string|null} */
  let unit_identifier = null;

  /**
   * @typedef {Object} ParsedStreetBody
   * @property {string|null} streetName
   * @property {string|null} suffix
   * @property {string|null} preDir
   * @property {string|null} postDir
   * @property {string|null} unit_identifier
   */

  /**
   * @param {string|null} streetBody
   * @returns {ParsedStreetBody}
   */
  function parseStreetBodyForComponents(streetBody) {
    if (!streetBody)
      return {
        streetName: null,
        suffix: null,
        preDir: null,
        postDir: null,
        unit_identifier: null,
      };
    const DIRS = new Set(["E", "N", "NE", "NW", "S", "SE", "SW", "W"]);
    const suffixMap = {
      DR: "Dr",
      "DR.": "Dr",
      DRIVE: "Dr",
      "DRIVE.": "Dr",
      RD: "Rd",
      ROAD: "Rd",
      AVE: "Ave",
      AV: "Ave",
      AVENUE: "Ave",
      ST: "St",
      "ST.": "St",
      LN: "Ln",
      LANE: "Ln",
      BLVD: "Blvd",
      CT: "Ct",
      COURT: "Ct",
      HWY: "Hwy",
      PKWY: "Pkwy",
      PL: "Pl",
      TER: "Ter",
      TRL: "Trl",
      WAY: "Way",
      CIR: "Cir",
      PLZ: "Plz",
      SQ: "Sq",
      XING: "Xing",
      LOOP: "Loop",
      RUN: "Run",
      "RD.": "Rd",
      "AVE.": "Ave",
      "HWY.": "Hwy",
      "BLVD.": "Blvd",
    };
    const allowedSuffix = new Set([
      "Rds",
      "Blvd",
      "Lk",
      "Pike",
      "Ky",
      "Vw",
      "Curv",
      "Psge",
      "Ldg",
      "Mt",
      "Un",
      "Mdw",
      "Via",
      "Cor",
      "Kys",
      "Vl",
      "Pr",
      "Cv",
      "Isle",
      "Lgt",
      "Hbr",
      "Btm",
      "Hl",
      "Mews",
      "Hls",
      "Pnes",
      "Lgts",
      "Strm",
      "Hwy",
      "Trwy",
      "Skwy",
      "Is",
      "Est",
      "Vws",
      "Ave",
      "Exts",
      "Cvs",
      "Row",
      "Rte",
      "Fall",
      "Gtwy",
      "Wls",
      "Clb",
      "Frk",
      "Cpe",
      "Fwy",
      "Knls",
      "Rdg",
      "Jct",
      "Rst",
      "Spgs",
      "Cir",
      "Crst",
      "Expy",
      "Smt",
      "Trfy",
      "Cors",
      "Land",
      "Uns",
      "Jcts",
      "Ways",
      "Trl",
      "Way",
      "Trlr",
      "Aly",
      "Spg",
      "Pkwy",
      "Cmn",
      "Dr",
      "Grns",
      "Oval",
      "Cirs",
      "Pt",
      "Shls",
      "Vly",
      "Hts",
      "Clf",
      "Flt",
      "Mall",
      "Frds",
      "Cyn",
      "Lndg",
      "Mdws",
      "Rd",
      "Xrds",
      "Ter",
      "Prt",
      "Radl",
      "Grvs",
      "Rdgs",
      "Inlt",
      "Trak",
      "Byu",
      "Vlgs",
      "Ctr",
      "Ml",
      "Cts",
      "Arc",
      "Bnd",
      "Riv",
      "Flds",
      "Mtwy",
      "Msn",
      "Shrs",
      "Rue",
      "Crse",
      "Cres",
      "Anx",
      "Drs",
      "Sts",
      "Holw",
      "Vlg",
      "Prts",
      "Sta",
      "Fld",
      "Xrd",
      "Wall",
      "Tpke",
      "Ft",
      "Bg",
      "Knl",
      "Plz",
      "St",
      "Cswy",
      "Bgs",
      "Rnch",
      "Frks",
      "Ln",
      "Mtn",
      "Ctrs",
      "Orch",
      "Iss",
      "Brks",
      "Br",
      "Fls",
      "Trce",
      "Park",
      "Gdns",
      "Rpds",
      "Shl",
      "Lf",
      "Rpd",
      "Lcks",
      "Gln",
      "Pl",
      "Path",
      "Vis",
      "Lks",
      "Run",
      "Frg",
      "Brg",
      "Sqs",
      "Xing",
      "Pln",
      "Glns",
      "Blfs",
      "Plns",
      "Dl",
      "Clfs",
      "Ext",
      "Pass",
      "Gdn",
      "Brk",
      "Grn",
      "Mnr",
      "Cp",
      "Pne",
      "Spur",
      "Opas",
      "Upas",
      "Tunl",
      "Sq",
      "Lck",
      "Ests",
      "Shr",
      "Dm",
      "Mls",
      "Wl",
      "Mnrs",
      "Stra",
      "Frgs",
      "Frst",
      "Flts",
      "Ct",
      "Mtns",
      "Frd",
      "Nck",
      "Ramp",
      "Vlys",
      "Pts",
      "Bch",
      "Loop",
      "Byp",
      "Cmns",
      "Fry",
      "Walk",
      "Hbrs",
      "Dv",
      "Hvn",
      "Blf",
      "Grv",
      "Crk",
      null,
    ]);

    const tokens = streetBody
      .replace(/\./g, "")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return {
        streetName: null,
        suffix: null,
        preDir: null,
        postDir: null,
        unit_identifier: null,
      };
    }


    let unit_identifier = null;

    if (
      tokens.length > 0 &&
      /^[A-Z0-9\-]+$/i.test(tokens[tokens.length - 1]) &&
      !DIRS.has(tokens[tokens.length - 1].toUpperCase())
    ) {
      const lastTok = tokens[tokens.length - 1];
      const mappedSuffix =
        suffixMap[lastTok.toUpperCase()] ||
        (lastTok ? lastTok[0].toUpperCase() + lastTok.slice(1).toLowerCase() : null);

      if (!allowedSuffix.has(mappedSuffix)) {
        unit_identifier = tokens.pop();
      }
    }


    let preDir = null;
    let postDir = null;
    let suffix = null;

    // Pre-directional (first token)
    if (tokens.length > 0) {
      const firstTok = tokens[0].toUpperCase();
      if (DIRS.has(firstTok)) {
        preDir = firstTok;
        tokens.shift();
      }
    }

    // Suffix (last token that matches a suffix)
    if (tokens.length > 0) {
      const lastTok = tokens[tokens.length - 1].toUpperCase();
      const mappedSuffix =
        suffixMap[lastTok] ||
        (lastTok ? lastTok[0] + lastTok.slice(1).toLowerCase() : null);
      if (mappedSuffix && allowedSuffix.has(mappedSuffix)) {
        suffix = mappedSuffix;
        tokens.pop();
      }
    }

    // Post-directional (if any remaining last token is a direction)
    if (tokens.length > 0) {
      const lastTok2 = tokens[tokens.length - 1].toUpperCase();
      if (DIRS.has(lastTok2)) {
        postDir = lastTok2;
        tokens.pop();
      }
    }

    // Remove directional tokens that are not at the start or end
    const filteredTokens = tokens.filter((tok, idx) => {
      const upperTok = tok.toUpperCase();
      const isDir = DIRS.has(upperTok);
      const isEdge = idx === 0 || idx === tokens.length - 1;
      return !(isDir && !isEdge);
    });
    const streetName = filteredTokens.join(" ").trim() || null;
    return { streetName, suffix, preDir, postDir, unit_identifier };
  }

  /**
   * @typedef {Object} CityStateZipComponents
   * @property {string|null} city - Parsed city name or null if unavailable.
   * @property {string|null} state - Two-character state code when present.
   * @property {string|null} postalCode - Five digit ZIP code if detected.
   * @property {string|null} plus4 - Optional ZIP+4 extension when supplied.
   */

  /**
   * Parse a comma-delimited address segment into city, state and postal code parts.
   *
   * @param {string} segment - Raw address text taken from the second or third comma-separated section.
   * @returns {CityStateZipComponents} Parsed city/state/ZIP components with null defaults.
   */
  const parseCityStateZipSegment = (segment) => {
    const trimmedSegment = typeof segment === "string" ? segment.trim() : "";
    if (!trimmedSegment) {
      return { city: null, state: null, postalCode: null, plus4: null };
    }

    const withStateMatch = trimmedSegment.match(
      /^([A-Z\s\-'.&]+?)\s+([A-Z]{2})\s*(\d{5})(?:-(\d{4}))?$/,
    );
    if (withStateMatch) {
      return {
        city: withStateMatch[1].trim() || null,
        state: withStateMatch[2],
        postalCode: withStateMatch[3],
        plus4: withStateMatch[4] || null,
      };
    }

    const cityZipMatch = trimmedSegment.match(/^([A-Z\s\-'.&]+?)\s+(\d{5})(?:-(\d{4}))?$/);
    if (cityZipMatch) {
      return {
        city: cityZipMatch[1].trim() || null,
        state: null,
        postalCode: cityZipMatch[2],
        plus4: cityZipMatch[3] || null,
      };
    }

    return { city: trimmedSegment || null, state: null, postalCode: null, plus4: null };
  };

  if (fullAddr) {
    const m = fullAddr.match(
      /^(\d+)\s+(.+?)\s*,\s*([A-Z\s\-']+),\s*([A-Z]{2})\s*(\d{5})(?:-(\d{4}))?$/,
    );
    if (m) {
      street_number = m[1];
      const streetBody = m[2].trim();
      const parsed = parseStreetBodyForComponents(streetBody);
      street_suffix_type = parsed.suffix || null;
      street_name = parsed.streetName || null;
      street_pre_directional_text = parsed.preDir || null;
      street_post_directional_text = parsed.postDir || null;
      unit_identifier = parsed.unit_identifier || null;
      city_name = m[3].trim();
      state_code = m[4];
      postal_code = m[5];
      plus4 = m[6] || null;
    } else {
      // Fallback minimal parsing
      const segs = fullAddr.split(",").map((s) => s.trim());
      const streetPart = segs[0] || "";
      const cityPart = segs[1] || "";
      const stateZip = segs[2] || "";
      if (streetPart) {
        const p = streetPart.split(/\s+/);
        street_number = p.shift();
        const streetBody = p.join(" ");
        const parsed = parseStreetBodyForComponents(streetBody);
        street_suffix_type = parsed.suffix || null;
        street_name = parsed.streetName || null;
        street_pre_directional_text = parsed.preDir || null;
        street_post_directional_text = parsed.postDir || null;
        unit_identifier = parsed.unit_identifier || null;
      }
      const parsedCitySegment = parseCityStateZipSegment(cityPart);
      city_name = parsedCitySegment.city;
      if (parsedCitySegment.state) {
        state_code = parsedCitySegment.state;
      }
      if (parsedCitySegment.postalCode) {
        postal_code = parsedCitySegment.postalCode;
      }
      if (parsedCitySegment.plus4) {
        plus4 = parsedCitySegment.plus4;
      }
      const m2 = stateZip.match(/^([A-Z]{2})\s*(\d{5})(?:-(\d{4}))?$/);
      if (m2) {
        state_code = m2[1];
        postal_code = m2[2];
        plus4 = m2[3] || plus4 || null;
      }
    }
  }

  // Lat/Long
  const lat = unAddr.latitude || null; // latitude
  const lon = unAddr.longitude || null; // longitude

  // Township/Range/Section & Block/Lot
  function parseTRS() {
    let trs =
      extractTopValue("Township-Range-Section:") ||
      getNextTextAfterStrong($, "Township-Range-Section:");
    if (trs) {
      const m = trs.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
      if (m) return { township: m[1], range: m[2], section: m[3] };
    }
    // fallback from Property Description panel
    let content = null;
    $("div").each((i, el) => {
      const txt = $(el).text();
      if (/Township-Range-Section/.test(txt)) {
        const m = txt.match(
          /Township-Range-Section\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/,
        );
        if (m) content = { township: m[1], range: m[2], section: m[3] };
      }
    });
    return content || { township: null, range: null, section: null };
  }
  const trs = parseTRS();

  function parseSBL() {
    const sbl = extractTopValue("Subdivision-Block-Lot:");
    if (sbl) {
      const parts = sbl.split("-").map((s) => s.trim());
      if (parts.length === 3) {
        return { subDiv: parts[0], block: parts[1], lot: parts[2] };
      }
    }
    return { subDiv: null, block: null, lot: null };
  }
  const sbl = parseSBL();

  // Subdivision name
  const subdivisionName = extractTopValue("Subdivision Name:") || null;

  // Year Built and areas
  function toInt(val) {
    if (!val) return null;
    const n = parseInt(String(val).replace(/[^0-9]/g, ""));
    return isNaN(n) ? null : n;
  }
  const yearBuilt =
    toInt(getNextTextAfterStrong($, "Year Built:")) ||
    toInt(html.match(/Year Built:\s*([0-9]{4})/)?.[1]);

  // Total Building Area
  let totalArea = null;
  $("div").each((i, el) => {
    const t = $(el).text();
    if (/Total Building Area/.test(t)) {
      const m = t.match(/Total Building Area\s*([0-9,]+)/);
      if (m) {
        totalArea = m[1].replace(/,/g, "");
        return false;
      }
    }
  });

  //PROPERTY json creation
  // Legal Description
  const legalDesc = extractLegalDescription($);
  const useCode = extractTopValue("Property Use:").trim();
  // console.log("propuse",useCode);
  const useCodestripped= useCode.split(" ")?.[0];
  // console.log("Strippedpropuse",useCodestripped);

  const propertyMapping = propertyUseCodeMappings.find(mapping => {
    const mappingCode = mapping.property_usecode.split(' ')[0];
    // console.log("MAPPINCODE",typeof(mappingCode)); // Extract code part (e.g., "01-01")
    return mappingCode === useCode || mapping.property_usecode.startsWith(useCodestripped);
  }) || propertyUseCodeMappings.find(mapping => 
    mapping.property_usecode.toLowerCase().includes(useCode.toLowerCase())
  );
  console.log(">>>",propertyMapping)
  
  const propertyFields = {
    property_type: propertyMapping.property_type,
    property_usage_type: propertyMapping.property_usage_type,
    ownership_estate_type: propertyMapping.ownership_estate_type,
    structure_form: propertyMapping.structure_form,
    build_status: propertyMapping.build_status
  };

  // console.log("PROPERRT FIELDS",propertyFields)
  if (!propertyFields.property_type){
    throw new Error(`Property type not found}`)
  }

  // const propertyUseMapping = mapPropertyUseToLexicon(propUse);
  // const property_type = propertyUseMapping?.propertyType ?? null;
  // const property_usage_type =
  //   propertyUseMapping?.propertyUsageType ?? null;
  // const ownership_estate_type =
  //   propertyUseMapping?.ownershipEstateType ?? null;
  // const structure_form = propertyUseMapping?.structureForm ?? null;
  // const build_status = propertyUseMapping?.buildStatus ?? null;

  // Build property.json
  const property = {
    ...appendSourceInfo(seed),
    number_of_units: toInt(extractTopValue("Living Units:")) || null,
    parcel_identifier: parcelId,
    property_legal_description_text: legalDesc || null,
    property_structure_built_year: yearBuilt || null,
    subdivision: subdivisionName || null,
    zoning: null,
    property_type: propertyFields.property_type,
    property_usage_type: propertyFields.property_usage_type,
    ownership_estate_type: propertyFields.ownership_estate_type,
    structure_form: propertyFields.structure_form,
    build_status: propertyFields.build_status,

  };
  writeJSON(path.join(dataDir, "property.json"), property);

  // Address.json
  const address = {
    ...appendSourceInfo(seed),
    county_name: "Volusia",
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    range: trs.range || null,
    section: trs.section || null,
    township:  trs.township || null,
    unnormalized_address: extractTopValue("Physical Address:") || null,
  };
  writeJSON(path.join(dataDir, "address.json"), address);

  //Create Person/company files
  let personFilesByKey = {};
  let companyFilesByKey = {};

  const ownersKey = `property_${parcelId}`;
  const ownersByDate = ownersData[ownersKey]?.owners_by_date || {};
  const currentOwners = ownersByDate["current"] || [];

  const combined = [...currentOwners];
  const uniquePersons = [];
  const uniqueCompanies = [];
  const seenPersons = new Set();
  const seenCompanies = new Set();
  // console.log(combined)
  combined.forEach((o) => {
    if (o && o.type === "person") {
      const key = normalizeOwnerKey(o);
      if (key && !seenPersons.has(key)) {
        seenPersons.add(key);
        uniquePersons.push({ o, key });
      }
    } else if (o && o.type === "company") {
      const key = normalizeCompanyKey(o);
      if (key && !seenCompanies.has(key)) {
        seenCompanies.add(key);
        uniqueCompanies.push({ o, key });
      }
    }
  });
  // console.log(uniquePersons,uniqueCompanies)
  // Create person files
  uniquePersons.forEach((entry, idx) => {
    const o = entry.o;
    const person = {
      ...appendSourceInfo(seed),
      birth_date: null,
      first_name: o.first_name || "",
      last_name: o.last_name || "",
      middle_name: o.middle_name || null,
      prefix_name: o.prefix_name || null,
      suffix_name: o.suffix_name || null,
      us_citizenship_status: null,
      veteran_status: null,
    };
    const pFile = `person_${idx + 1}.json`;
    writeJSON(path.join(dataDir, pFile), person);
    personFilesByKey[entry.key] = pFile;
  });

  // Create company files
  uniqueCompanies.forEach((entry, idx) => {
    const o = entry.o;
    const company = {
      ...appendSourceInfo(seed),
      name: o.name || "",
    };
    const cFile = `company_${idx + 1}.json`;
    writeJSON(path.join(dataDir, cFile), company);
    companyFilesByKey[entry.key] = cFile;
  });

  // Mailing Address - only create if there are owners to connect it to
  const mailingAddressRaw = extractTopValue("Mailing Address On File:");
  if (currentOwners.length > 0 && mailingAddressRaw) {
    const mailingAddressOutput = {
      ...appendSourceInfo(seed),
      latitude: null,
      longitude: null,
      unnormalized_address: mailingAddressRaw,
    };
    writeJSON(path.join(dataDir, "mailing_address.json"), mailingAddressOutput);

    //OWNERS TO MAILING ADDRESS RELATIONSHIP FILE.
    let relIdx=0
    currentOwners.forEach((o) => {
      // console.log("relIdx",relIdx);
      if (o && o.type === "person") {
        const key = normalizeOwnerKey(o);
        const pf = personFilesByKey[key];
        if (pf) {
          relIdx += 1;
          const rel = {
            from: { "/": `./${pf}` },
            to: { "/": "./mailing_address.json" },
          };
          writeJSON(
            path.join(dataDir, `relationship_person_has_mailing_address_${relIdx}.json`),
            rel,
          );
        }
      } else if (o && o.type === "company") {
        const key = normalizeCompanyKey(o);
        const cf = companyFilesByKey[key];
        if (cf) {
          relIdx += 1;
          const rel = {
            from: { "/": `./${cf}` },
            to: { "/": "./mailing_address.json" },
          };
          writeJSON(
            path.join(dataDir, `relationship_company_has_mailing_address${relIdx}.json`),
            rel,
          );
        }
      }
    });
  }  



  // Tax processing
  function createTaxFiles() {
    function writeTax(year, vals) {
      const taxObj = {
        first_year_building_on_tax_roll: null,
        first_year_on_tax_roll: null,
        monthly_tax_amount: null,
        period_end_date: null,
        period_start_date: null,
        property_assessed_value_amount: parseMoney(vals.assessed),
        property_building_amount: parseMoney(vals.impr),
        property_land_amount: parseMoney(vals.land),
        property_market_value_amount: parseMoney(vals.market),
        property_taxable_value_amount: parseMoney(vals.taxable),
        tax_year: year,
        yearly_tax_amount: null,
      };
      writeJSON(path.join(dataDir, `tax_${year}.json`), taxObj);
    }

    // Extract all years from previousYears table
    $("#previousYears .row").each((i, row) => {
      const cols = $(row).children();
      if (cols.length >= 8) {
        const yearText = cols.eq(0).text().trim();
        const year = parseInt(yearText);
        if (year && year > 1900) {
          writeTax(year, {
            assessed: cols.eq(4).text().trim(),
            impr: cols.eq(2).text().trim(),
            land: cols.eq(1).text().trim(),
            market: cols.eq(3).text().trim(),
            taxable: cols.eq(6).text().trim(),
          });
        }
      }
    });

    // Extract from mobile view if desktop table empty
    if ($("#previousYears .row").length === 0) {
      $("#previousYears_mobile .row").each((i, row) => {
        const t = $(row).text();
        const yearMatch = t.match(/\b(20\d{2})\b/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          const m = t.match(/Land Value:\s*\$([0-9,]+)/);
          const mi = t.match(/Impr Value:\s*\$([0-9,]+)/);
          const mj = t.match(/Just Value:\s*\$([0-9,]+)/);
          const msa = t.match(/Non-Sch Assd:\s*\$([0-9,]+)/);
          const mct = t.match(/County Taxable:\s*\$([0-9,]+)/);
          if (m && mi && mj && msa && mct) {
            writeTax(year, {
              assessed: `$${msa[1]}`,
              impr: `$${mi[1]}`,
              land: `$${m[1]}`,
              market: `$${mj[1]}`,
              taxable: `$${mct[1]}`,
            });
          }
        }
      });
    }

    // 2025 Working values from Property Values section
    const pv2025 = extractPropertyValuesByYear($, 2025);
    const wtv = extractWorkingTaxValues($);
    if (pv2025 && pv2025.market) {
      writeTax(2025, {
        assessed: wtv.assessed || pv2025.market,
        impr: pv2025.building,
        land: pv2025.land,
        market: pv2025.market,
        taxable: wtv.taxable || pv2025.market,
      });
    }
  }

  createTaxFiles();

  // Sales and Deeds and Files
  const salesRows = [];
  $("#section-sales .row").each((i, row) => {
    const $row = $(row);
    if (
      $row.find(".col-sm-2.text-center").length &&
      $row.find(".col-sm-1.text-center").length
    ) {
      const cols = $row.children();
      const bookPage = cols.eq(0).text().trim();
      const instLinkRaw = cols.eq(1).find("a").attr("href") || null;
      const instLink = instLinkRaw ? instLinkRaw.trim() : null;
      const instText = cols.eq(1).text().trim();
      const saleDate = cols.eq(2).text().trim();
      const deedType = cols.eq(3).text().trim();
      const priceTxt = cols.eq(6).text().trim();
      if (/\d{2}\/\d{2}\/\d{4}/.test(saleDate)) {
        salesRows.push({ bookPage, instLink, instText, saleDate, deedType, priceTxt });
      }
    }
  });

  function mapDeedType(raw) {
    if (!raw) return null;
    const r = raw.toUpperCase();
    if (r.includes("SPECIAL WARRANTY")) return "Special Warranty Deed";
    if (r.includes("WARRANTY DEED")) return "Warranty Deed";
    if (r.includes("QUIT")) return "Quitclaim Deed";
    if (r.includes("GRANT DEED")) return "Grant Deed";
    if (r.includes("BARGAIN") && r.includes("SALE")) return "Bargain and Sale Deed";
    if (r.includes("LADY BIRD")) return "Lady Bird Deed";
    if (r.includes("TRANSFER ON DEATH")) return "Transfer on Death Deed";
    if (r.includes("SHERIFF")) return "Sheriff's Deed";
    if (r.includes("TAX DEED")) return "Tax Deed";
    if (r.includes("TRUSTEE")) return "Trustee's Deed";
    if (r.includes("PERSONAL REPRESENTATIVE")) return "Personal Representative Deed";
    if (r.includes("CORRECTION")) return "Correction Deed";
    if (r.includes("DEED IN LIEU")) return "Deed in Lieu of Foreclosure";
    if (r.includes("LIFE ESTATE")) return "Life Estate Deed";
    if (r.includes("JOINT TENANCY")) return "Joint Tenancy Deed";
    if (r.includes("TENANCY IN COMMON")) return "Tenancy in Common Deed";
    if (r.includes("COMMUNITY PROPERTY")) return "Community Property Deed";
    if (r.includes("GIFT DEED")) return "Gift Deed";
    if (r.includes("INTERSPOUSAL")) return "Interspousal Transfer Deed";
    if (r.includes("WILD DEED")) return "Wild Deed";
    if (r.includes("SPECIAL MASTER")) return "Special Master’s Deed";
    if (r.includes("COURT ORDER")) return "Court Order Deed";
    if (r.includes("CONTRACT FOR DEED")) return "Contract for Deed";
    if (r.includes("QUIET TITLE")) return "Quiet Title Deed";
    if (r.includes("ADMINISTRATOR")) return "Administrator's Deed";
    if (r.includes("GUARDIAN")) return "Guardian's Deed";
    if (r.includes("RECEIVER")) return "Receiver's Deed";
    if (r.includes("RIGHT OF WAY")) return "Right of Way Deed";
    if (r.includes("VACATION OF PLAT")) return "Vacation of Plat Deed";
    if (r.includes("ASSIGNMENT OF CONTRACT")) return "Assignment of Contract";
    if (r.includes("RELEASE OF CONTRACT")) return "Release of CONTRACT";
    // Single word and abbreviation matching
    if (r === "WC" || r === "WARRANTY") return "Warranty Deed";
    if (r === "SW" || r === "SPECIAL") return "Special Warranty Deed";
    if (r === "QC" || r === "QUITCLAIM") return "Quitclaim Deed";
    if (r === "GD" || r === "GRANT") return "Grant Deed";
    if (r === "TD" || r === "TAX") return "Tax Deed";
    if (r === "TRUSTEE") return "Trustee's Deed";
    if (r === "SHERIFF") return "Sheriff's Deed";
    if (r === "ADMINISTRATOR") return "Administrator's Deed";
    if (r === "GUARDIAN") return "Guardian's Deed";
    if (r === "RECEIVER") return "Receiver's Deed";
    if (r === "GIFT") return "Gift Deed";
    if (r === "CORRECTION") return "Correction Deed";
    return "Miscellaneous";
  }

  removeFilesByPredicate(dataDir, (fileName) =>
    /^relationship_sales_deed(_\d+)?\.json$/.test(fileName),
  );
  removeFilesByPredicate(dataDir, (fileName) =>
    /^relationship_deed_file(_\d+)?\.json$/.test(fileName),
  );

  let salesFileIndex = 0;
  salesRows.forEach((row, idx) => {
    const i = idx + 1;
    salesFileIndex=i
    const sale = {
      ...appendSourceInfo(seed),
      ownership_transfer_date: toISODate(row.saleDate),
    };
    const purchasePrice = parseMoney(row.priceTxt);
    if (purchasePrice !== null) {
      sale.purchase_price_amount = purchasePrice;
    }
    writeJSON(path.join(dataDir, `sales_${i}.json`), sale);

    const deedTypeMapped = mapDeedType(row.deedType);
    const deed = {
      ...appendSourceInfo(seed)
    };
    if (deedTypeMapped) deed.deed_type = deedTypeMapped;
    
    // Extract Book/Page from bookPage field
    if (row.bookPage) {
      const bookPageMatch = row.bookPage.match(/(\d+)\s*\/\s*(\d+)/);
      if (bookPageMatch) {
        deed.book = bookPageMatch[1];
        deed.page = bookPageMatch[2];
      }
    }
    
    // Extract Instrument Number from instLink or instText
    let instrumentNumber = null;
    
    // Try multiple patterns for instLink
    if (row.instLink) {
      // Pattern 1: instno=value
      let match = row.instLink.match(/instno=([^&]+)/);
      if (match) {
        instrumentNumber = match[1];
      } else {
        // Pattern 2: i=value (alternative parameter name)
        match = row.instLink.match(/[?&]i=([^&]+)/);
        if (match) {
          instrumentNumber = match[1];
        } else {
          // Pattern 3: Extract number from URL path
          match = row.instLink.match(/\/(\d+)(?:[?&]|$)/);
          if (match) {
            instrumentNumber = match[1];
          }
        }
      }
    }
    
    // Fallback to instText if no number found in link
    if (!instrumentNumber && row.instText) {
      // Clean instText and check if it's numeric
      const cleanText = row.instText.replace(/[^0-9]/g, '');
      if (cleanText && /^\d+$/.test(cleanText)) {
        instrumentNumber = cleanText;
      }
    }
    
    // Set instrument_number if found
    if (instrumentNumber) {
      deed.instrument_number = instrumentNumber;
    }
    
    writeJSON(path.join(dataDir, `deed_${i}.json`), deed);

    // relationships for sales to deed
    const relSalesDeed = {
      from: { "/": `./sales_${i}.json` },
      to: { "/": `./deed_${i}.json` }
    };
    writeJSON(
      path.join(dataDir, `relationship_sales_deed_${i}.json`),
      relSalesDeed, 
    );

    // console.log("ROW",row);
    // File entry from instrument link (only if URL exists and has valid i parameter)
    if (row.instLink && sanitizeHttpUrl(row.instLink) && !/[?&]i=(&|$)/.test(row.instLink)) {
      const nameId = row.instLink.split("=")[2] || `${i}`;
      const fileObj = {
        ...appendSourceInfo(seed),
        document_type: "Title",
        file_format: null,
        ipfs_url: null,
        name: `Instrument ${nameId.trim()}`,
        original_url: sanitizeHttpUrl(row.instLink),
      };
      writeJSON(path.join(dataDir, `file_${i}.json`), fileObj);

      const relDeedFile = {
        from: { "/": `./deed_${i}.json` },
        to: { "/": `./file_${i}.json` }
      };
      writeJSON(
        path.join(dataDir, `relationship_deed_file_${i}.json`),
        relDeedFile,
      );
    }
  });



  // Create sales -> owners file if there is at least 1 sale file.
  if (salesRows.length > 0) {
    // Find the first row that actually has a price
    let firstSaleRow = null;
    for (const row of salesRows) {
      if (parseMoney(row.priceTxt) !== null && !firstSaleRow) {
        firstSaleRow = row;
        break;
      }
    }
    
    if (firstSaleRow) {
      // Relationships from sales to owners
      let relIdx = 0;
      currentOwners.forEach((o) => {
        if (o && o.type === "person") {
          const key = normalizeOwnerKey(o);
          const pf = personFilesByKey[key];
          if (pf) {
            relIdx += 1;
            const rel = {
              from: { "/": "./sales_1.json" },
              to: { "/": `./${pf}` }
            };
            writeJSON(
              path.join(dataDir, `relationship_sales_person_${relIdx}.json`),
              rel,
            );
          }
        } else if (o && o.type === "company") {
          const key = normalizeCompanyKey(o);
          const cf = companyFilesByKey[key];
          if (cf) {
            relIdx += 1;
            const rel = {
              from: { "/": "./sales_1.json" },
              to: { "/": `./${cf}` }
            };
            writeJSON(
              path.join(dataDir, `relationship_sales_company_${relIdx}.json`),
              rel,
            );
          }
        }
      });
    }
  }

  //------Structure (owners/structures_data.json)---------------
  createStructureFiles(seed,parcelId);

  // ---------- Utilities (owners/utilities_data.json) ----------
  createUtilitiesFiles(seed,parcelId);

  // ---------- Layouts (owners/layout_data.json) ----------

  createLayoutFiles(seed,parcelId);


  // Lot.json - absent data -> nulls
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
    lot_size_acre: null,
  };
  writeJSON(path.join(dataDir, "lot.json"), lot);

//   // Flood storm information - absent -> nulls, boolean false
//   const flood = {
//     community_id: null,
//     panel_number: null,
//     map_version: null,
//     effective_date: null,
//     evacuation_zone: null,
//     flood_zone: null,
//     flood_insurance_required: false,
//     fema_search_url: null,
//   };
//   writeJSON(path.join(dataDir, "flood_storm_information.json"), flood);

}

(async () => {
  try {
    await main();
    console.log("Script executed successfully.");
  } catch (e) {
    try {
      JSON.parse(e.message);
      console.error(e.message);
    } catch {
      console.error(e.stack || String(e));
    }
    process.exit(1);
  }
})();
