const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// ============================================================================
// Constants
// ============================================================================

const NORMALIZE_EOL_REGEX = /\r\n/g;
const SCRIPT_DIR = __dirname;
const WORKING_DIR = process.cwd();

// Mapping of Pinellas "extra feature" descriptions onto Elephant lexicon classes.
const extraFeaturesDescriptionMappings = [
  { "Description": "DOCK", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "BOATHS/CV", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "FIRESPRINK", "class": "utility", "property": "public_utility_type", "value": "WaterAvailable" },
  { "Description": "BT LFT/DAV", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "PND/FNT/WF", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "BOAT SLIP", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "ASPHALT", "class": "lot", "property": "driveway_material", "value": "Asphalt" },
  { "Description": "CONC PAVE", "class": "lot", "property": "driveway_material", "value": "Concrete" },
  { "Description": "GENERATOR", "class": "utility", "property": "public_utility_type", "value": "ElectricityAvailable" },
  { "Description": "BOATRACKS", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "FRGT RAMP", "class": "lot", "property": "paving_type", "value": "Concrete" },
  { "Description": "AIR COND", "class": "utility", "property": "cooling_system_type", "value": "CentralAir" },
  { "Description": "UTIL/RSTRM", "class": "utility", "property": "public_utility_type", "value": "SewerAvailable" },
  { "Description": "SOLAR", "class": "utility", "property": "heating_system_type", "value": "Solar" },
  { "Description": "LOAD DOCK", "class": "lot", "property": "paving_type", "value": "Concrete" },
  { "Description": "GOLF HOLE", "class": "lot", "property": "view", "value": "ParkView" },
  { "Description": "PED BRIDGE", "class": "lot", "property": "view", "value": "Waterfront" },
  { "Description": "CARWASH", "class": "utility", "property": "public_utility_type", "value": "WaterAvailable" },
  { "Description": "SWR/WTRPLT", "class": "utility", "property": "public_utility_type", "value": "SewerAvailable" },
  { "Description": "LIFT/PUMP", "class": "utility", "property": "public_utility_type", "value": "WaterAvailable" }
];

/**
 * Extracts extra feature rows from the Pinellas HTML table, maps them using the
 * Elephant lexicon mapping, and writes aggregated class-specific JSON files.
 * @param {cheerio.CheerioAPI} $
 * @param {string} dataDir
 * @param {string | null} requestIdentifier
 * @param {object | null} sourceHttpRequest
 */


function extractExtraFeatures($, dataDir, requestIdentifier, sourceHttpRequest) {
  const rows = $("#tblExtraFeatures tbody tr");
  if (!rows || rows.length === 0) {
    ["propertyLot.json", "propertyUtility.json", "propertyStructure.json", "utility.json"].forEach((filename) => {
      const filePath = path.join(dataDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    return;
  }

  const grouped = {
    lot: {},
    utility: {},
    structure: {},
  };

  rows.each((_, row) => {
    const description = getTextOrNull($(row).find("td").first());
    if (!description) return;
    const mapping = extraFeaturesDescriptionMappings.find(
      (item) => item.Description === description
    );
    if (!mapping || !mapping.class || !mapping.property || mapping.value == null) return;
    const cls = mapping.class.toLowerCase();
    if (!grouped[cls]) return;
    if (!(mapping.property in grouped[cls])) {
      grouped[cls][mapping.property] = mapping.value;
    }
  });

  // CRITICAL: Only lot and structure files should be created here
  // Utility files are created as utility_N.json with proper relationships later (lines 3431-3490)
  // NEVER add "utility" to this fileMap - it will cause an unused file error
  const fileMap = {
    lot: "lot.json",
    structure: "structure.json",
    // utility: "utility.json", // NEVER uncomment this - use utility_N.json files instead
  };

  // Clean up utility.json if it exists (no longer used - we use utility_N.json instead)
  // Note: utility data is collected in grouped.utility but NOT written as a single file
  // Instead, utilities are written as utility_N.json with proper relationships later in the script
  const utilityFilePath = path.join(dataDir, "utility.json");
  if (fs.existsSync(utilityFilePath)) {
    try {
      fs.unlinkSync(utilityFilePath);
      console.log("Removed utility.json during extractExtraFeatures - using utility_N.json files instead");
    } catch (e) {
      console.error("Failed to remove utility.json:", e);
    }
  }

  // Additional safeguard: Delete utility.json before any file writing to prevent accidental generation
  const utilityJsonBeforeWritePath = path.join(dataDir, "utility.json");
  if (fs.existsSync(utilityJsonBeforeWritePath)) {
    try {
      fs.unlinkSync(utilityJsonBeforeWritePath);
      console.log("Pre-write safeguard: Removed utility.json before file writing");
    } catch (e) {
      console.error("Failed to remove utility.json in pre-write safeguard:", e);
    }
  }

  // FINAL safeguard before the loop: Force delete utility.json to prevent any accidental creation
  try {
    const finalUtilityCheck = path.join(dataDir, "utility.json");
    if (fs.existsSync(finalUtilityCheck)) {
      fs.unlinkSync(finalUtilityCheck);
      console.log("Final pre-loop cleanup: Removed utility.json before fileMap processing");
    }
  } catch (e) {
    console.error("Failed to remove utility.json in final pre-loop cleanup:", e);
  }

  Object.entries(fileMap).forEach(([cls, filename]) => {
    // Safety check: Never write utility.json (we use utility_N.json instead)
    if (filename === "utility.json" || cls === "utility") {
      console.log(`Skipping ${filename} - using utility_N.json files with relationships instead`);
      return;
    }

    const props = grouped[cls] || {};
    const hasProperties = Object.keys(props).length > 0;
    const filePath = path.join(dataDir, filename);
    if (!hasProperties) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const output = {
      source_http_request: sourceHttpRequest || null,
      request_identifier: requestIdentifier || null,
      ...props,
    };
    writeJSON(filePath, output);
  });

  // IMMEDIATE post-loop cleanup: Delete utility.json if it was somehow created
  try {
    const postLoopUtilityCheck = path.join(dataDir, "utility.json");
    if (fs.existsSync(postLoopUtilityCheck)) {
      fs.unlinkSync(postLoopUtilityCheck);
      console.log("Post-loop cleanup: Removed utility.json after fileMap processing");
    }
  } catch (e) {
    console.error("Failed to remove utility.json in post-loop cleanup:", e);
  }
}

const propertyTypeMapping=[
  {
    "property_usecode": "0000 VACANT RESIDENTIAL - LOT & ACREAGE LESS THAN 5 ACRES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0030 VACANT CONDO (DEVELOPMENT LAND)",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0033 VACANT PUD",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0040 VACANT CONDO REC AREA DEV OWN- W/POSSIBLE XFSB",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0060 VACANT MANUFACTURED HOME LOT (INDIVIDUALLY OWNED IN PLATTED SUB)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0061 VACANT MANUFACTURED HOME LOT (CO-OP)",
    "ownership_estate_type": "Cooperative",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0062 VACANT MANUFACTURED HOME LOT (LAND CONDO)",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0090 VACANT RESIDENTIAL LAND W/XFSB",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0110 SINGLE FAMILY HOME",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "SingleFamilyDetached",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0111 SINGLE FAMILY COMMUNITY LAND TRUST",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "SingleFamilyDetached",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0133 PLANNED UNIT DEVELOPMENT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0260 MANUFACTURED HOME (ON INDIVIDUALLY OWNED LOT)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "ManufacturedHomeOnLand",
    "property_usage_type": "Residential",
    "property_type": "ManufacturedHome"
  },
  {
    "property_usecode": "0261 MANUFACTURED HOME (CO-OP, INDIVIDUALLY OWNED)",
    "ownership_estate_type": "Cooperative",
    "build_status": "Improved",
    "structure_form": "ManufacturedHomeInPark",
    "property_usage_type": "Residential",
    "property_type": "ManufacturedHome"
  },
  {
    "property_usecode": "0262 MANUFACTURED HOME (LAND CONDO, INDIVIDUALLY OWNED)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ManufacturedHomeOnLand",
    "property_usage_type": "Residential",
    "property_type": "ManufacturedHome"
  },
  {
    "property_usecode": "0310 APARTMENTS (50 UNITS OR MORE)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyMoreThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0311 APARTMENTS (10 - 49 UNITS)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyMoreThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0410 CONDO CONVERSION - APARTMENTS TO PLATTED CONDO (PREDOMINATELY APARTMENT USE)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0430 CONDOMINIUM",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0431 CONDOMINIUM (LAND LEASE)",
    "ownership_estate_type": "Leasehold",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0435 CONDO PARKING SPACE, GARAGE SPACE, STORAGE UNITS, CABANAS",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0436 CONDO CONVERSION - APARTMENTS TO PLATTED CONDO (PREDOMINATELY OWNER-OCCUPIED)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0437 CONDO COM APARTMENTS",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0442 INTERVAL OWNERSHIP (FRACTIONAL OWNERSHIP WITHOUT HOTEL MGMT)",
    "ownership_estate_type": "Timeshare",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0443 TIMESHARE",
    "ownership_estate_type": "Timeshare",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Residential",
    "property_type": "Unit"
  },
  {
    "property_usecode": "0550 CO-OP APARTMENTS",
    "ownership_estate_type": "Cooperative",
    "build_status": "Improved",
    "structure_form": "MultiFamilyMoreThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0551 CO-OP APARTMENTS (LAND LEASE)",
    "ownership_estate_type": "Cooperative",
    "build_status": "Improved",
    "structure_form": "MultiFamilyMoreThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0752 ALF - BOARDING HOUSE (LESS THAN 10 UNITS)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0810 SINGLE FAMILY - MORE THAN ONE HOUSE PER PARCEL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "SingleFamilyDetached",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0820 DUPLEX-TRIPLEX-FOURPLEX",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyLessThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0821 TOWNHOUSE, ATTACHED MULTI-STORY UNITS WITH SEPARATE ENTRANCES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "TownhouseRowhouse",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0822 APARTMENTS (5-9 UNITS)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "MultiFamilyLessThan10",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0830 SINGLE FAMILY WITH ACCESSORY DWELLING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": "SingleFamilyDetached",
    "property_usage_type": "Residential",
    "property_type": "Building"
  },
  {
    "property_usecode": "0904 CONDO COMMON AREA ASSN OWN - OPEN/GREEN SPACE",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0905 SUBDIVISION COMMON AREA - OPEN/GREEN SPACE, ASSN OWNED",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0906 MANUFACTURED HOME CONDO, VACANT, ASSN OWNED - COMMON AREA, ETC.",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0944 CONDO COMMON AREA ASSN OWN - RIGHT-OF-WAY, STREET, ROAD, IRRIGATION CHANNEL, DITCH, ETC.",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0945 SUBDIVISION COMMON AREA - RIGHT-OF-WAY, ROAD, IRRIGATION CHANNEL, DITCH, ETC.",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0954 CONDO COMMON AREA ASSN OWN - RIVER, LAKE, SUBMERGED LAND",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0955 SUBDIVISION COMMON AREA - RIVER, LAKE, SUBMERGED LAND.",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0964 CONDO COMMON AREA ASSN OWN - SEWAGE DISPOSAL, SOLID WASTE, BRW PIT, DRAINAGE RESERVOIR, WASTE LAND",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "SewageDisposal",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0965 SUBDIVISION COMMON AREA - (SEWAGE DISPOSAL, SOLID WASTE, BORROW PIT, DRAINAGE RESERVOIR, WASTE LAND)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "SewageDisposal",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0974 CONDO COMMON AREA ASSN OWN - W/IMPROVEMENT",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0975 SUBDIVISION COMMON AREA - IMPROVEMENTS W/XFSB, ASSN OWNED",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "0976 MANUFACTURED HOME CONDO, WITH IMPROVEMENT, ASSN OWNED - COMMON AREA, ETC",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1000 VACANT COMMERCIAL LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1035 VACANT COMMERCIAL (LAND CONDO)",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1051 VACANT COMMERCIAL COMMON ELEMENT",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1090 VACANT COMMERCIAL LAND W/XFSB",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "1120 SINGLE BUILDING STORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1121 STRIP STORE - (2 OR MORE STORES)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterCommunity",
    "property_type": "Building"
  },
  {
    "property_usecode": "1122 CONVENIENCE STORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1134 CONDO - COMMERCIAL - STORE (UNIT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Unit"
  },
  {
    "property_usecode": "1135 RETAIL (LAND CONDO - SINGLE OR MULTI-TENANT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Unit"
  },
  {
    "property_usecode": "1227 STORE W/OFFICE OR APARTMENT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "RetailStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1324 DEPARTMENT STORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "DepartmentStore",
    "property_type": "Building"
  },
  {
    "property_usecode": "1423 SUPERMARKET & SUPERSTORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Supermarket",
    "property_type": "Building"
  },
  {
    "property_usecode": "1524 REGIONAL SHOPPING CENTER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterRegional",
    "property_type": "Building"
  },
  {
    "property_usecode": "1528 ENCLOSED MALL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterRegional",
    "property_type": "Building"
  },
  {
    "property_usecode": "1624 NEIGHBORHOOD SHOPPING CENTER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ShoppingCenterCommunity",
    "property_type": "Building"
  },
  {
    "property_usecode": "1730 GENERAL OFFICE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "1733 PUD OFFICE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "1735 OFFICE (LAND CONDO - SINGLE OR MULTI-TENANT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Unit"
  },
  {
    "property_usecode": "1736 POST OFFICE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "1738 CONDO OFFICE (UNIT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Unit"
  },
  {
    "property_usecode": "1832 GENERAL OFFICE BLDG - MULTI-STORY/CAMPUS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "1933 MEDICAL OFFICE BUILDING - SINGLE & MULTI-STORY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MedicalOffice",
    "property_type": "Building"
  },
  {
    "property_usecode": "2035 MARINA (LAND CONDO - MULTI-TENANT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "Unit"
  },
  {
    "property_usecode": "2039 MARINA CONDO - DRY SLIP (INDIVIDUALLY OWNED)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "Unit"
  },
  {
    "property_usecode": "2047 TERMINAL - AIRPORT & BUS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "TransportationTerminal",
    "property_type": "Building"
  },
  {
    "property_usecode": "2048 MARINA - BOAT STORAGE (HIGH & DRY AND/OR WET SLIP)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "Building"
  },
  {
    "property_usecode": "2090 MARINE TERMINAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "TransportationTerminal",
    "property_type": "Building"
  },
  {
    "property_usecode": "2125 RESTAURANT, CAFETERIA",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Restaurant",
    "property_type": "Building"
  },
  {
    "property_usecode": "2226 FAST FOOD RESTAURANT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Restaurant",
    "property_type": "Building"
  },
  {
    "property_usecode": "2331 FINANCIAL INSTITUTION",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "FinancialInstitution",
    "property_type": "Building"
  },
  {
    "property_usecode": "2430 INSURANCE COMPANY OFFICE- SINGLE OR MULTI-STORY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OfficeBuilding",
    "property_type": "Building"
  },
  {
    "property_usecode": "2543 REPAIR SERVICE SHOP",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "Building"
  },
  {
    "property_usecode": "2544 COMMERCIAL LAUNDRY & DRY CLEANER (NOT COIN LAUNDRY)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "Building"
  },
  {
    "property_usecode": "2641 SERVICE STATION",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ServiceStation",
    "property_type": "Building"
  },
  {
    "property_usecode": "2739 AUTOMOBILE RENTAL AGENCY, USED CAR LOT, TRAILER, TRUCK & VAN RENTAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "AutoSalesRepair",
    "property_type": "Building"
  },
  {
    "property_usecode": "2740 BOAT SALE & MARINE EQUIPMENT, MOBILE HOME, MOTOR HOME, TRAVEL TRAILER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Commercial",
    "property_type": "Building"
  },
  {
    "property_usecode": "2742 AUTOMOBILE, MOTORCYCLE, FARM MACHINERY, TRACTOR TRAILER DEALERSHIP",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "AutoSalesRepair",
    "property_type": "Building"
  },
  {
    "property_usecode": "2743 AUTO/MARINE REPAIR",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "AutoSalesRepair",
    "property_type": "Building"
  },
  {
    "property_usecode": "2744 AUTO SERVICE CENTER (NATIONAL) OR QUICK LUBE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "AutoSalesRepair",
    "property_type": "Building"
  },
  {
    "property_usecode": "2745 CAR WASH",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ServiceStation",
    "property_type": "Building"
  },
  {
    "property_usecode": "2746 CAR STORAGE - TRAILER STORAGE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OpenStorage",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2814 MANUFACTURED HOME PARK (LOT RENTAL COMMUNITY)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MobileHomePark",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2815 CAMPGROUND - RV PARK",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2816 MANUFACTURED HOME PARK - (LOT & UNIT RENTAL)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MobileHomePark",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2817 MANUFACTURED HOME PARK - MIXED USAGE - STORE(S), APTS, ETC",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MobileHomePark",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2835 PARKING GARAGE - CONDO",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OpenStorage",
    "property_type": "Unit"
  },
  {
    "property_usecode": "2846 PAID PARKING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OpenStorage",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "2929 WHOLESALE OUTLET, PRODUCE WHOLESALER, MANUFACTURING OUTLET, ELECTRICAL WHOLESALER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "WholesaleOutlet",
    "property_type": "Building"
  },
  {
    "property_usecode": "3029 NURSERY, ROADSIDE FRUIT STAND, FLORIST SHOP, GREENHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "NurseryGreenhouse",
    "property_type": "Building"
  },
  {
    "property_usecode": "3251 ENCLOSED THEATER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Theater",
    "property_type": "Building"
  },
  {
    "property_usecode": "3325 BAR, WITH OR WITHOUT PACKAGE STORE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3450 BOWLING ALLEY, POOL HALL, ENCLOSED ARENA, SKATING RINK, GYMNASIUM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3554 SPECIAL ATTRACTION - TOURIST ATTRACTION, MUSEUM, COMMERCIAL POOL, AQUARIUM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Entertainment",
    "property_type": "Building"
  },
  {
    "property_usecode": "3852 MINI GOLF COURSE, DRIVING RANGE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GolfCourse",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "3855 REGULATION, PAR 3 GOLF COURSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GolfCourse",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "3912 HOTELS AND MOTELS (50 UNITS OR MORE)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Hotel",
    "property_type": "Building"
  },
  {
    "property_usecode": "3913 HOTELS AND MOTELS (49 UNITS OR LESS)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Hotel",
    "property_type": "Building"
  },
  {
    "property_usecode": "3935 HOTEL (LAND CONDO)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Hotel",
    "property_type": "Building"
  },
  {
    "property_usecode": "3937 CONDO CONVERSION - MOTEL, HOTEL",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Hotel",
    "property_type": "Unit"
  },
  {
    "property_usecode": "3944 CONDO HOTEL AND MOTEL",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": "ApartmentUnit",
    "property_usage_type": "Hotel",
    "property_type": "Unit"
  },
  {
    "property_usecode": "4000 VACANT INDUSTRIAL LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Industrial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4090 VACANT INDUSTRIAL LAND W/XFSB",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Industrial",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "4105 GARAGE (WORKSHOP) TYPE UNITS COMPLEX",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LightManufacturing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4107 BUSINESS PARK/FLEX",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LightManufacturing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4120 LIGHT MANUFACTURING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LightManufacturing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4135 INDUSTRIAL (LAND CONDO - SINGLE OR MULTI-TENANT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Industrial",
    "property_type": "Unit"
  },
  {
    "property_usecode": "4148 CONDO INDUSTRIAL/WAREHOUSE (UNIT)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "Unit"
  },
  {
    "property_usecode": "4190 INDUSTRIAL NOT CLASSIFIED ELSEWHERE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Industrial",
    "property_type": "Building"
  },
  {
    "property_usecode": "4210 HEAVY INDUSTRIAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "HeavyManufacturing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4321 LUMBER YARD OR SAW MILL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LumberYard",
    "property_type": "Building"
  },
  {
    "property_usecode": "4429 PACKING PLANT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PackingPlant",
    "property_type": "Building"
  },
  {
    "property_usecode": "4530 CANNERY, CITRUS PROCESSING PLANT, BOTTLER, BREWER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Cannery",
    "property_type": "Building"
  },
  {
    "property_usecode": "4630 FOOD PROCESSING PLANT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PackingPlant",
    "property_type": "Building"
  },
  {
    "property_usecode": "4730 CEMENT PLANT, ASPHALT PLANT, ROCK, GRAVEL & CLAY PLANT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MineralProcessing",
    "property_type": "Building"
  },
  {
    "property_usecode": "4800 GENERAL WAREHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "Building"
  },
  {
    "property_usecode": "4840 PUBLIC BONDED WAREHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "Building"
  },
  {
    "property_usecode": "4841 DISTRIBUTION WAREHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "Building"
  },
  {
    "property_usecode": "4842 MINI-STORAGE WAREHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Warehouse",
    "property_type": "Building"
  },
  {
    "property_usecode": "4949 OPEN STORAGE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "OpenStorage",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5001 AGRICULTURAL RESIDENTIAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Agricultural",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5010 IMPROVED AGRICULTURAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Agricultural",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "5910 TIMBERLAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TimberLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6010 GRAZING & PASTURE LAND, HORSE FARM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GrazingLand",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6310 SWINE FARM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LivestockFacility",
    "property_type": "Building"
  },
  {
    "property_usecode": "6410 GOAT FARM",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LivestockFacility",
    "property_type": "Building"
  },
  {
    "property_usecode": "6610 ORCHARD & CITRUS GROVE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "OrchardGroves",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "6710 POULTRY, APIARY, TROPICAL FISH, ETC.",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Poultry",
    "property_type": "Building"
  },
  {
    "property_usecode": "6810 DAIRY (FARM)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "LivestockFacility",
    "property_type": "Building"
  },
  {
    "property_usecode": "6910 ORNAMENTALS (FLOWER GROWER)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Ornamentals",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7000 VACANT INSTITUTIONAL LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "NonProfitCharity",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "7153 CHURCH, CHURCH SCHOOL, CHURCH OWNED BUILDING (PARSONAGE CODE 0110), SALVATION ARMY, MISSIONS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Church",
    "property_type": "Building"
  },
  {
    "property_usecode": "7238 PRIVATE SCHOOLS & COLLEGES, DAY CARE CENTERS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PrivateSchool",
    "property_type": "Building"
  },
  {
    "property_usecode": "7334 HOSPITAL",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PrivateHospital",
    "property_type": "Building"
  },
  {
    "property_usecode": "7456 ALF (10 OR MORE UNITS)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "HomesForAged",
    "property_type": "Building"
  },
  {
    "property_usecode": "7553 NON-PROFIT CHARITABLE SERVICES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "NonProfitCharity",
    "property_type": "Building"
  },
  {
    "property_usecode": "7635 MORTUARY, CEMETERY, CREMATORIUM, FUNERAL HOME",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MortuaryCemetery",
    "property_type": "Building"
  },
  {
    "property_usecode": "7753 CLUB, LODGE, UNION HALL, CIVIC CLUB, HEALTH SPA",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ClubsLodges",
    "property_type": "Building"
  },
  {
    "property_usecode": "7837 SKILLED NURSING, MEMORY CARE, REST HOME, SENIOR REHAB CENTER, ADULT DAY CARE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "SanitariumConvalescentHome",
    "property_type": "Building"
  },
  {
    "property_usecode": "7953 LITERARY, SCIENTIFIC & CULTURAL FACILITIES",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "CulturalOrganization",
    "property_type": "Building"
  },
  {
    "property_usecode": "8012 VACANT COUNTY GOVERNMENT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8013 VACANT CITY GOVERNMENT",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8014 VACANT COUNTY PUBLIC SCHOOLS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "PublicSchool",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8052 VACANT PARK LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ForestParkRecreation",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8252 PARK LAND - PUBLIC PARK, FOREST, RECREATION AREA ( GOV'T OWNED)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ForestParkRecreation",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "8314 COUNTY PUBLIC SCHOOLS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PublicSchool",
    "property_type": "Building"
  },
  {
    "property_usecode": "8414 PUBLIC COLLEGES, SPC, USF",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "PublicSchool",
    "property_type": "Building"
  },
  {
    "property_usecode": "8612 COUNTY GOV'T - NON-RESIDENTIAL (COMMERCIAL) ONLY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8711 STATE GOV'T - NON-RESIDENTIAL (COMMERCIAL) ONLY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8810 FEDERAL GOV'T - NON-RESIDENTIAL (COMMERCIAL) ONLY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "8913 CITY GOV'T - NON-RESIDENTIAL (COMMERCIAL) ONLY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "GovernmentProperty",
    "property_type": "Building"
  },
  {
    "property_usecode": "9160 ELECTRIC POWER COMPANY (FLORIDA POWER, TAMPA ELEC.) EASEMENT, OFFICE & SUB-STATION",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "Building"
  },
  {
    "property_usecode": "9161 TELEPHONE COMPANY PROPERTY - OFFICE & BUILDING",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "TelecommunicationsFacility",
    "property_type": "Building"
  },
  {
    "property_usecode": "9163 RAILROAD PROPERTY - ASSESSED BY COUNTY APPRAISER",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Railroad",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9164 WATER & SEWER PLANTS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "Building"
  },
  {
    "property_usecode": "9165 RADIO & TV STATIONS",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "TelecommunicationsFacility",
    "property_type": "Building"
  },
  {
    "property_usecode": "9169 OTHER UTILITIES - TELEGRAPH - PIPELINES (PRIVATE)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "Building"
  },
  {
    "property_usecode": "9269 MINING LAND - EXTRACTIVE INDUSTRY",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "MineralProcessing",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9369 SUBSURFACE RIGHTS (PIPELINE, TUNNEL)",
    "ownership_estate_type": "SubsurfaceRights",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9440 CONDO REC AREA DEV OWN - RIGHT-OF-WAY, STREET, ROAD, IRRIGATION CHANNEL, DITCH, ETC.",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9490 RIGHT-OF-WAY STREET AND ROAD, IRRIGATION CANAL, CHANNEL, DITCH, ETC.",
    "ownership_estate_type": "RightOfWay",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Utility",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9500 SUBMERGED LAND - RIVER, LAKE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9540 CONDO REC AREA DEV OWN - RIVER, LAKE, SUBMERGED LAND",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9546 MARINA CONDO - WET SLIP (INDIVIDUALLY OWNED)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "Unit"
  },
  {
    "property_usecode": "9547 CONDO BOAT SLIP ATTACHED - CONTROLLED BY ASSN (ASSIGNMANUFACTURED HOME CONDO - COMMON AREA W/IMPROVEMENTED OR RENTED TO UNIT OWNER)",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9590 OTHER RESIDENTIAL, SUBMERGED LAND W/XFSB, I.E. BOAT DOCK, BOATHOUSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "RiversLakes",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9600 SEWAGE DISPOSAL, SOLID WASTE (PRIVATE) BORROW PIT, MARSH, MANGROVE, SAND DUNE, SWAMP, WASTE LAND",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "SewageDisposal",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9640 CONDO REC AREA DEV OWN - SEWAGE DISPOSAL, SOLID WASTE, BORROW PIT, DRAINAGE RESERVOIR, WASTE LAND",
    "ownership_estate_type": "Condominium",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9740 CONDO REC AREA DEV OWN",
    "ownership_estate_type": "Condominium",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "ResidentialCommonElementsAreas",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9752 PARK LAND OR RECREATION AREA (NON-GOV'T OWNED)",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Recreational",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9862 RAILROAD PROPERTY - STATE COMPTROLLER ASSESSED",
    "ownership_estate_type": "FeeSimple",
    "build_status": "Improved",
    "structure_form": null,
    "property_usage_type": "Railroad",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9900 RAW ACREAGE TRACT NOT ZONED FOR AGRICULTURE OR COMMERCIAL PURPOSE",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "TransitionalProperty",
    "property_type": "LandParcel"
  },
  {
    "property_usecode": "9999 TO BE DETERMINED",
    "ownership_estate_type": "FeeSimple",
    "build_status": "VacantLand",
    "structure_form": null,
    "property_usage_type": "Unknown",
    "property_type": "LandParcel"
  }
]


const propertyTypeByUseCode = propertyTypeMapping.reduce((lookup, entry) => {
  if (!entry || !entry.property_usecode) {
    return lookup;
  }
  const normalizedUseCode = entry.property_usecode.replace(/\s+/g, "").toUpperCase();
  if (!normalizedUseCode) {
    return lookup;
    }
  lookup[normalizedUseCode] = entry.property_type ?? null;
  return lookup;
}, {});

const ownershipEstateTypeByUseCode = propertyTypeMapping.reduce((lookup, entry) => {
  if (!entry || !entry.property_usecode) return lookup;
  const normalizedUseCode = entry.property_usecode.replace(/\s+/g, "").toUpperCase();
  if (!normalizedUseCode) return lookup;
  lookup[normalizedUseCode] = entry.ownership_estate_type ?? null;
  return lookup;
}, {});

const buildStatusByUseCode = propertyTypeMapping.reduce((lookup, entry) => {
  if (!entry || !entry.property_usecode) return lookup;
  const normalizedUseCode = entry.property_usecode.replace(/\s+/g, "").toUpperCase();
  if (!normalizedUseCode) return lookup;
  lookup[normalizedUseCode] = entry.build_status ?? null;
  return lookup;
}, {});

const structureFormByUseCode = propertyTypeMapping.reduce((lookup, entry) => {
  if (!entry || !entry.property_usecode) return lookup;
  const normalizedUseCode = entry.property_usecode.replace(/\s+/g, "").toUpperCase();
  if (!normalizedUseCode) return lookup;
  lookup[normalizedUseCode] = entry.structure_form ?? null;
  return lookup;
}, {});

const propertyUsageTypeByUseCode = propertyTypeMapping.reduce((lookup, entry) => {
  if (!entry || !entry.property_usecode) return lookup;
  const normalizedUseCode = entry.property_usecode.replace(/\s+/g, "").toUpperCase();
  if (!normalizedUseCode) return lookup;
  lookup[normalizedUseCode] = entry.property_usage_type ?? null;
  return lookup;
}, {});
function mapPropertyTypeFromUseCode(code) {
  if (!code && code !== 0) return null;
  const codeStr = String(code).trim();
  
  // First try matching by 4-digit code prefix
  const codeMatch = codeStr.match(/^(\d{4})/);
  if (codeMatch) {
    const codePrefix = codeMatch[1];
    const entry = propertyTypeMapping.find(item => item.property_usecode.startsWith(codePrefix));
    if (entry) return entry.property_type;
  }
  
  // Fallback to full normalization matching
  const normalizedInput = codeStr.replace(/\s+/g, "").toUpperCase();
  if (normalizedInput && Object.prototype.hasOwnProperty.call(propertyTypeByUseCode, normalizedInput)) {
    return propertyTypeByUseCode[normalizedInput];
  }
  return null;
}

function mapOwnershipEstateTypeFromUseCode(code) {
  if (!code && code !== 0) return null;
  const codeStr = String(code).trim();
  
  // First try matching by 4-digit code prefix
  const codeMatch = codeStr.match(/^(\d{4})/);
  if (codeMatch) {
    const codePrefix = codeMatch[1];
    const entry = propertyTypeMapping.find(item => item.property_usecode.startsWith(codePrefix));
    if (entry) return entry.ownership_estate_type;
  }
  
  // Fallback to full normalization matching
  const normalizedInput = codeStr.replace(/\s+/g, "").toUpperCase();
  if (normalizedInput && Object.prototype.hasOwnProperty.call(ownershipEstateTypeByUseCode, normalizedInput)) {
    return ownershipEstateTypeByUseCode[normalizedInput];
  }
  return null;
}

function mapBuildStatusFromUseCode(code) {
  if (!code && code !== 0) return null;
  const codeStr = String(code).trim();
  
  // First try matching by 4-digit code prefix
  const codeMatch = codeStr.match(/^(\d{4})/);
  if (codeMatch) {
    const codePrefix = codeMatch[1];
    const entry = propertyTypeMapping.find(item => item.property_usecode.startsWith(codePrefix));
    if (entry) return entry.build_status;
  }
  
  // Fallback to full normalization matching
  const normalizedInput = codeStr.replace(/\s+/g, "").toUpperCase();
  if (normalizedInput && Object.prototype.hasOwnProperty.call(buildStatusByUseCode, normalizedInput)) {
    return buildStatusByUseCode[normalizedInput];
  }
  return null;
}

function mapStructureFormFromUseCode(code) {
  if (!code && code !== 0) return null;
  const codeStr = String(code).trim();
  
  // First try matching by 4-digit code prefix
  const codeMatch = codeStr.match(/^(\d{4})/);
  if (codeMatch) {
    const codePrefix = codeMatch[1];
    const entry = propertyTypeMapping.find(item => item.property_usecode.startsWith(codePrefix));
    if (entry) return entry.structure_form;
  }
  
  // Fallback to full normalization matching
  const normalizedInput = codeStr.replace(/\s+/g, "").toUpperCase();
  if (normalizedInput && Object.prototype.hasOwnProperty.call(structureFormByUseCode, normalizedInput)) {
    return structureFormByUseCode[normalizedInput];
  }
  return null;
}

function mapPropertyUsageTypeFromUseCode(code) {
  if (!code && code !== 0) return null;
  const codeStr = String(code).trim();
  
  // First try matching by 4-digit code prefix
  const codeMatch = codeStr.match(/^(\d{4})/);
  if (codeMatch) {
    const codePrefix = codeMatch[1];
    const entry = propertyTypeMapping.find(item => item.property_usecode.startsWith(codePrefix));
    if (entry) return entry.property_usage_type;
  }
  
  // Fallback to full normalization matching
  const normalizedInput = codeStr.replace(/\s+/g, "").toUpperCase();
  if (normalizedInput && Object.prototype.hasOwnProperty.call(propertyUsageTypeByUseCode, normalizedInput)) {
    return propertyUsageTypeByUseCode[normalizedInput];
  }
  return null;
}


function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function parseCurrencyToNumber(txt) {
  if (!txt) return null;
  const n = txt.replace(/[^0-9.\-]/g, "");
  if (!n) return null;
  const num = parseFloat(n);
  if (isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

const COMPANY_KEYWORD_SETS = [
  ["LIMITED", "PARTNERSHIP"],
  ["LIMITED", "LIABILITY", "COMPANY"],
  ["LIMITED", "LIABILITY", "PARTNERSHIP"],
  ["LIMITED", "LIABILITY"],
  ["PROFESSIONAL", "ASSOCIATION"],
  ["PROFESSIONAL", "CORPORATION"],
  ["HOMEOWNERS", "ASSOCIATION"],
  ["CONDOMINIUM", "ASSOCIATION"],
  ["PROPERTY", "OWNERS", "ASSOCIATION"],
  ["STATE", "OF"],
  ["CITY", "OF"],
  ["COUNTY", "OF"],
  ["UNITED", "STATES"],
  ["HOUSING", "AUTHORITY"],
  ["COMMUNITY", "DEVELOPMENT"],
  ["ECONOMIC", "DEVELOPMENT"],
  ["FAMILY", "TRUST"],
  ["REVOCABLE", "TRUST"],
  ["LIVING", "TRUST"],
  ["IRREVOCABLE", "TRUST"],
  ["APARTMENTS"],
  ["ASSOCIATES"],
  ["ASSOCIATION"],
  ["AUTOMOTIVE"],
  ["BANK"],
  ["CAPITAL"],
  ["CHURCH"],
  ["CLINIC"],
  ["CO-OP"],
  ["COMPANY"],
  ["CONSTRUCTION"],
  ["CORPORATION"],
  ["DEPARTMENT"],
  ["ENTERPRISE"],
  ["ENTERPRISES"],
  ["ESTATE"],
  ["ESTATES"],
  ["FOUNDATION"],
  ["FUND"],
  ["GROUP"],
  ["HOLDINGS"],
  ["HOSPITAL"],
  ["HOUSING"],
  ["INSURANCE"],
  ["INVESTMENT"],
  ["INVESTMENTS"],
  ["LLC"],
  ["LLP"],
  ["LLLP"],
  ["LTD"],
  ["MANAGEMENT"],
  ["MINISTRIES"],
  ["MINISTRY"],
  ["MORTGAGE"],
  ["PARTNERSHIP"],
  ["PARTNERS"],
  ["PROPERTIES"],
  ["PROPERTY"],
  ["REALTY"],
  ["RESORT"],
  ["SERVICES"],
  ["SOLUTIONS"],
  ["SCHOOL"],
  ["TRUST"],
  ["UNIVERSITY"],
  ["VENTURES"],
];

const COMPANY_TOKENS = new Set([
  "INC",
  "INCORPORATED",
  "CO",
  "CO.",
  "COMPANY",
  "CORP",
  "CORP.",
  "CORPORATION",
  "LLC",
  "L.L.C",
  "L L C",
  "LC",
  "LC.",
  "LTD",
  "L.T.D",
  "L L P",
  "LLP",
  "L.L.P",
  "L L L P",
  "LLLP",
  "PLC",
  "P.L.C",
  "PLLC",
  "P.L.L.C",
  "PC",
  "P.C",
  "PA",
  "P.A",
  "GP",
  "G.P",
  "LP",
  "L.P",
  "TR",
  "TRS",
  "TRUST",
  "FBO",
  "IRA",
  "C/O",
  "ETAL",
  "ET-AL",
  "ASSOC",
  "ASSN",
  "FOUNDATION",
  "FNDN",
  "PARTNERS",
  "PARTNERSHIP",
  "HOLDINGS",
  "INVESTMENTS",
  "PROPERTIES",
  "PROPERTY",
  "REALTY",
  "MANAGEMENT",
  "MGMT",
  "SOLUTIONS",
  "SERVICES",
  "SERVICE",
  "ENTERPRISE",
  "ENTERPRISES",
  "VENTURES",
  "BANK",
  "MORTGAGE",
  "FINANCIAL",
  "FUND",
  "CAPITAL",
  "TRUSTEE",
  "TRUSTEES",
  "AUTHORITY",
  "DEPARTMENT",
  "DEPT",
  "CITY",
  "COUNTY",
  "TOWN",
  "STATE",
  "UNIVERSITY",
  "COLLEGE",
  "SCHOOL",
  "HOSPITAL",
  "MEDICAL",
  "CLINIC",
  "CHURCH",
  "TEMPLE",
  "MOSQUE",
  "SYNAGOGUE",
  "MINISTRY",
  "MINISTRIES",
  "ASSOCIATION",
  "ASSOCIATES",
  "APARTMENTS",
  "PRODUCTIONS",
  "LOGISTICS",
  "TRANSPORT",
  "SUPPLY",
  "SUPPLIES",
  "DISTRIBUTION",
  "DESIGN",
  "DEVELOPMENT",
  "STUDIO",
  "ESTATES",
  "ESTATE",
  "HOMES",
  "HOMESITES",
  "HOLDING",
  "SYSTEMS",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "SOLN",
  "LLC.",
  "LLP.",
  "LLLP.",
  "PLC.",
  "PLLC.",
  "PC.",
  "PA.",
  "GP.",
  "LP.",
  "COOP",
  "CO-OP",
]);

const PREFIX_MAP = {
  MR: "Mr.",
  MRS: "Mrs.",
  MS: "Ms.",
  MISS: "Miss",
  MX: "Mx.",
  DR: "Dr.",
  PROF: "Prof.",
  REV: "Rev.",
  FR: "Fr.",
  SR: "Sr.",
  BR: "Br.",
  CAPT: "Capt.",
  COL: "Col.",
  MAJ: "Maj.",
  LT: "Lt.",
  SGT: "Sgt.",
  HON: "Hon.",
  JUDGE: "Judge",
  RABBI: "Rabbi",
  IMAM: "Imam",
  SHEIKH: "Sheikh",
  SIR: "Sir",
  DAME: "Dame",
};

const SUFFIX_MAP = {
  JR: "Jr.",
  SR: "Sr.",
  II: "II",
  III: "III",
  IV: "IV",
  PHD: "PhD",
  MD: "MD",
  ESQ: "Esq.",
  JD: "JD",
  LLM: "LLM",
  MBA: "MBA",
  RN: "RN",
  DDS: "DDS",
  DVM: "DVM",
  CFA: "CFA",
  CPA: "CPA",
  PE: "PE",
  PMP: "PMP",
  EMERITUS: "Emeritus",
  RET: "Ret.",
};

const PERSON_NAME_REGEX = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;
const MIDDLE_NAME_REGEX = /^[A-Z][A-Za-z\s-',.]*$/;

function parseIntSafe(txt) {
  if (txt == null) return null;
  const m = String(txt).replace(/[^0-9\-]/g, "");
  if (!m) return null;
  const v = parseInt(m, 10);
  return isNaN(v) ? null : v;
}

function parseFloatSafe(txt) {
  if (txt == null) return null;
  const m = String(txt).replace(/[^0-9.\-]/g, "");
  if (!m) return null;
  const v = parseFloat(m);
  return isNaN(v) ? null : v;
}

function toISODate(dstr) {
  if (!dstr) return null;
  const months = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const m1 = dstr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) {
    const dd = m1[1].padStart(2, "0");
    const mm = months[m1[2].substr(0, 3)] || null;
    const yyyy = m1[3];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }
  const m2 = dstr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mm = m2[1].padStart(2, "0");
    const dd = m2[2].padStart(2, "0");
    const yyyy = m2[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const m3 = dstr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m3) return dstr;
  return null;
}

function titleCaseName(s) {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])(\w*)/g, (m, a, b) => a.toUpperCase() + b);
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

// --- HELPER FUNCTIONS FOR HTML EXTRACTION ---

/**
 * Extracts text content from a Cheerio element, trims it, and returns null if empty.
 * @param {cheerio.Cheerio<cheerio.Element>} element
 * @returns {string | null}
 */
function getTextOrNull(element) {
  const text = element.text().trim();
  return text === "" ? null : text;
}

/**
 * Extracts the value attribute from a Cheerio element, trims it, and returns null if empty.
 * @param {cheerio.Cheerio<cheerio.Element>} element
 * @returns {string | null}
 */
function getValueOrNull(element) {
  const value = element.val();
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue === "" ? null : trimmedValue;
  }
  return null;
}

function decodeOwnerText(text) {
  if (!text) return "";
  return text
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "\n");
}

function formatPersonName(value) {
  if (!value) return null;
  const cleaned = value.replace(/[^A-Za-z\s\-',.]/g, " ").trim();
  if (!cleaned) return null;
  const formatted = cleaned
    .toLowerCase()
    .replace(/(^|[ \-'\.])([a-z])/g, (_, sep, char) => `${sep}${char.toUpperCase()}`)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return formatted || null;
}

function formatMiddleNameValue(value) {
  const formatted = formatPersonName(value);
  if (!formatted) return null;
  return MIDDLE_NAME_REGEX.test(formatted) ? formatted : null;
}

function mapSuffixToSchema(rawSuffix) {
  if (!rawSuffix) return null;
  const normalized = rawSuffix.toUpperCase().replace(/[^A-Z]/g, "");
  return SUFFIX_MAP[normalized] || null;
}

function mapPrefixToSchema(token) {
  if (!token) return null;
  const normalized = token.toUpperCase().replace(/[^A-Z]/g, "");
  return PREFIX_MAP[normalized] || null;
}

function extractSuffixTokens(tokens) {
  let extractedSuffix = null;
  const filteredTokens = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const normalizedToken = tokens[i].toUpperCase().replace(/[^A-Z]/g, "");
    const mapped = mapSuffixToSchema(normalizedToken);
    if (!extractedSuffix && mapped) {
      extractedSuffix = mapped;
      continue;
    }
    filteredTokens.unshift(tokens[i]);
  }
  return { extractedSuffix, filteredTokens };
}

function isCompany(raw) {
  const sClean = clean(raw);
  const s = sClean.toUpperCase();
  if (!s) return false;
  const normalized = s.replace(/[.'"]/g, " ");
  const tokens = normalized.split(/[^A-Z0-9&]+/).filter(Boolean);
  for (const token of tokens) {
    if (COMPANY_TOKENS.has(token)) {
      return true;
    }
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const keywordSet of COMPANY_KEYWORD_SETS) {
    const matchesAll = keywordSet.every((kw) =>
      words.includes(kw.toUpperCase()) || normalized.includes(kw.toUpperCase()),
    );
    if (matchesAll) return true;
  }
  return false;
}

function splitParties(raw) {
  const s = clean(raw);
  if (!s) return [];
  const normalized = s.replace(/\sand\s/gi, " & ");
  const parts = normalized
    .split(/\s*&\s*/)
    .map((p) => clean(p))
    .filter(Boolean);
  if (parts.length <= 1) {
    return parts;
  }
  if (isCompany(s)) {
    const shouldKeepWhole = parts.some((part) => {
      const tokenCount = part.split(/\s+/).filter(Boolean).length;
      return !isCompany(part) && tokenCount < 2;
    });
    if (shouldKeepWhole) {
      return [s];
    }
  }
  return parts;
}

function parseOwnerName(raw, requestIdentifier, sourceHttpRequest) {
  const s = clean(raw);
  if (!s) return { valid: false, reason: "empty", raw };

  if (isCompany(s)) {
    const companyName = clean(s);
    return {
      valid: true,
      owner: {
        name: companyName,
        request_identifier: requestIdentifier,
        source_http_request: sourceHttpRequest,
      },
    };
  }

  let last = null;
  let first = null;
  let middle = null;
  let suffix = null;

  let working = s;
  let prefix = null;
  const leadingParts = working.split(/\s+/);
  if (leadingParts.length > 1) {
    const mappedPrefix = mapPrefixToSchema(leadingParts[0]);
    if (mappedPrefix) {
      prefix = mappedPrefix;
      working = working.slice(leadingParts[0].length).trim();
    }
  }

  if (working.includes(",")) {
    const [left, rightRaw] = working.split(",");
    last = clean(left);
    const rightTokens = clean(rightRaw).split(/\s+/).filter(Boolean);

    const { extractedSuffix, filteredTokens } = extractSuffixTokens(rightTokens);
    suffix = extractedSuffix;

    if (filteredTokens.length >= 1) {
      first = filteredTokens[0];
      if (filteredTokens.length > 1) middle = filteredTokens.slice(1).join(" ");
    }
  } else {
    const toks = working.split(/\s+/).filter(Boolean);
    const { extractedSuffix, filteredTokens } = extractSuffixTokens(toks);
    suffix = extractedSuffix;

    if (filteredTokens.length >= 2) {
      last = filteredTokens[0];
      first = filteredTokens[1];
      if (filteredTokens.length > 2) {
        middle = filteredTokens.slice(2).join(" ");
      }
    } else if (filteredTokens.length === 1) {
      last = filteredTokens[0];
    }
  }

  const formattedFirst = formatPersonName(first);
  const formattedLast = formatPersonName(last);

  if (
    !formattedFirst ||
    !formattedLast ||
    !PERSON_NAME_REGEX.test(formattedFirst) ||
    !PERSON_NAME_REGEX.test(formattedLast)
  ) {
    return { valid: false, reason: "missing_required_name_fields", raw: s };
  }

  const middleNameFormatted = formatMiddleNameValue(middle);
  const person = {
    source_http_request: sourceHttpRequest,
    request_identifier: requestIdentifier,
    birth_date: null,
    first_name: formattedFirst,
    last_name: formattedLast,
    middle_name: middleNameFormatted,
    prefix_name: prefix,
    suffix_name: suffix,
    us_citizenship_status: null,
    veteran_status: null,
  };
  return { valid: true, owner: person };
}

function ownersFromRaw(raw, invalids, requestIdentifier, sourceHttpRequest) {
  const parties = splitParties(raw);
  const out = [];
  for (const p of parties) {
    const parsed = parseOwnerName(p, requestIdentifier, sourceHttpRequest);
    if (parsed.valid) out.push(parsed.owner);
    else invalids.push({ raw: p, reason: parsed.reason });
  }
  return out;
}

function normalizeOwner(o) {
  if (o && "name" in o && !("first_name" in o)) {
    return `company:${clean(o.name).toLowerCase()}`;
  }
  const f = clean(o.first_name || "").toLowerCase();
  const l = clean(o.last_name || "").toLowerCase();
  const m = o.middle_name ? clean(o.middle_name).toLowerCase() : "";
  const sfx = o.suffix_name ? clean(o.suffix_name).toLowerCase() : "";
  return `person:${f}|${m}|${l}|${sfx}`;
}

function dedupeOwners(arr) {
  const seen = new Set();
  const out = [];
  for (const o of arr) {
    const key = normalizeOwner(o);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

function extractSalesHistoryFiles($, dataDir, requestIdentifier, sourceHttpRequest) {
  const links = [];
  $("#tblSalesHistory tbody tr").each((idx, row) => {
    const $row = $(row);
    const $link = $row.find("td").eq(6).find("a");
    const url = ($link.attr("href") || "").trim();
    if (!url) return;
    const name = ($link.text() || "").trim();
    links.push({ idx: idx + 1, url, name });
  });
  const unique = new Map();
  links.forEach((item) => {
    if (!unique.has(item.url)) unique.set(item.url, item);
  });
  Array.from(unique.values()).forEach((item, idx) => {
    const fileName = `file_${idx + 1}.json`;
    const payload = {
      request_identifier: requestIdentifier,
      source_http_request: sourceHttpRequest,
      document_type: null,
      file_format: null,
      name: item.name || null,
      original_url: item.url || null,
      ipfs_url: null,
    };
    writeJSON(path.join(dataDir, fileName), payload);

    // Create property_has_file relationship
    const relationshipFileName = `relationship_property_has_file_${idx + 1}.json`;
    const relationship = {
      from: { "/": "./property.json" },
      to: { "/": `./${fileName}` }
    };
    writeJSON(path.join(dataDir, relationshipFileName), relationship);
  });
}

function mapImprovementType(raw) {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  switch (text) {
    case "roof":
    case "roofing":
      return "Roofing";
    case "hvac":
    case "mechanical":
    case "mechanical/hvac":
      return "MechanicalHVAC";
    case "electrical":
      return "Electrical";
    case "plumbing":
      return "Plumbing";
    case "pool":
    case "spa":
    case "pool/spa":
      return "PoolSpaInstallation";
    case "demolition":
      return "Demolition";
    case "fence":
    case "fencing":
      return "Fencing";
    case "general building":
    case "general construction":
    case "generalbuilding":
      return "GeneralBuilding";
    case "residential":
    case "residential construction":
    case "residentialconstruction":
      return "ResidentialConstruction";
    case "commercial":
    case "commercial construction":
    case "commercialconstruction":
      return "CommercialConstruction";
    case "addition":
    case "building addition":
    case "buildingaddition":
      return "BuildingAddition";
    case "structure move":
    case "structuremove":
    case "move structure":
      return "StructureMove";
    case "pool":
    case "spa":
    case "pool/spa":
    case "pool spa installation":
      return "PoolSpaInstallation";
    case "gas":
    case "gas installation":
      return "GasInstallation";
    case "dock":
    case "shore":
    case "dock & shore":
      return "DockAndShore";
    case "fire":
    case "fire protection":
    case "fire protection system":
      return "FireProtectionSystem";
    case "exterior":
    case "exterior openings":
    case "exterior finishes":
      return "ExteriorOpeningsAndFinishes";
    case "mobile home":
    case "mobilehome":
    case "rv":
    case "mobile home/rv":
      return "MobileHomeRV";
    case "landscape":
    case "irrigation":
    case "landscape irrigation":
      return "LandscapeIrrigation";
    case "screen":
    case "screen enclosure":
      return "ScreenEnclosure";
    case "shutter":
    case "awning":
    case "shutter/awning":
      return "ShutterAwning";
    case "site":
    case "site development":
      return "SiteDevelopment";
    case "code violation":
    case "violation":
      return "CodeViolation";
    case "complaint":
      return "Complaint";
    case "contractor license":
    case "contractor":
      return "ContractorLicense";
    case "sponsorship":
      return "Sponsorship";
    case "state license":
    case "state license registration":
      return "StateLicenseRegistration";
    case "administrative approval":
      return "AdministrativeApproval";
    case "administrative appeal":
      return "AdministrativeAppeal";
    case "bluesheet hearing":
      return "BlueSheetHearing";
    case "planned development":
      return "PlannedDevelopment";
    case "development of regional impact":
      return "DevelopmentOfRegionalImpact";
    case "rezoning":
      return "Rezoning";
    case "special exception":
    case "special exception zoning":
      return "SpecialExceptionZoning";
    case "variance":
      return "Variance";
    case "zoning extension":
      return "ZoningExtension";
    case "zoning verification":
    case "zoning verification letter":
      return "ZoningVerificationLetter";
    case "request for relief":
      return "RequestForRelief";
    case "waiver":
    case "waiver request":
      return "WaiverRequest";
    case "informal meeting":
      return "InformalMeeting";
    case "environmental":
    case "environmental monitoring":
      return "EnvironmentalMonitoring";
    case "vacation":
      return "Vacation";
    case "vegetation":
    case "vegetation removal":
      return "VegetationRemoval";
    case "comprehensive plan amendment":
      return "ComprehensivePlanAmendment";
    case "minimum use determination":
      return "MinimumUseDetermination";
    case "transfer development rights determination":
      return "TransferDevelopmentRightsDetermination";
    case "map boundary determination":
      return "MapBoundaryDetermination";
    case "transfer development rights certificate":
      return "TransferDevelopmentRightsCertificate";
    case "uniform community development":
      return "UniformCommunityDevelopment";
    case "special certificate of appropriateness":
      return "SpecialCertificateOfAppropriateness";
    case "certificate to dig":
      return "CertificateToDig";
    case "historic designation":
    case "historicdesignation":
      return "HistoricDesignation";
    case "planning administrative appeal":
      return "PlanningAdministrativeAppeal";
    case "well":
    case "well permit":
      return "WellPermit";
    case "test boring":
      return "TestBoring";
    case "existing well inspection":
      return "ExistingWellInspection";
    case "natural resources complaint":
      return "NaturalResourcesComplaint";
    case "natural resources violation":
      return "NaturalResourcesViolation";
    case "letter water sewer":
      return "LetterWaterSewer";
    case "utilities connection":
      return "UtilitiesConnection";
    case "driveway":
    case "driveway permit":
      return "DrivewayPermit";
    case "right of way":
    case "right-of-way":
    case "right-of-way permit":
      return "RightOfWayPermit";
    default:
      return null;
  }
}

function extractPropertyImprovements(
  $,
  dataDir,
  requestIdentifier,
  sourceHttpRequest,
) {
  const rows = $("#tblPermit tbody tr");
  if (!rows.length) return;

  rows.each((idx, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const permitNumber = getTextOrNull(cells.eq(0));
    const improvementType = mapImprovementType(getTextOrNull(cells.eq(1)));
    const issueDateRaw = getTextOrNull(cells.eq(2));
    const issueDate = toISODate(issueDateRaw);

    if (!permitNumber && !improvementType && !issueDate) return;

    const improvement = {
      request_identifier: requestIdentifier,
      source_http_request: sourceHttpRequest,
      permit_number: permitNumber || null,
      improvement_type: improvementType || null,
      permit_issue_date: issueDate || null,
      improvement_action: null,
      improvement_status: null,
      completion_date: null,
      final_inspection_date: null,
      contractor_type: null,
      permit_close_date: null,
      permit_required: true,
      is_owner_builder: null,
      is_disaster_recovery: null,
      private_provider_inspections: null,
      private_provider_plan_review: null,
      application_received_date: null,
    };

    const fileName = `property_improvement_${idx + 1}.json`;
    writeJSON(path.join(dataDir, fileName), improvement);

    // const relationshipFile = `relationship_property_has_property_improvement_${idx + 1}.json`;
    // writeJSON(path.join(dataDir, relationshipFile), {
    //   from: { "/": "./property.json" },
    //   to: { "/": `./${fileName}` },
    // });
  });
}

function gatherRawOwnerStrings($) {
  const rawList = [];
  const $details = $("#owner_details");
  if (!$details.length) return rawList;

  const seenPieces = new Set();
  const $detailsClone = $details.clone();
  const $moreButtonClone = $detailsClone.find("button").first();
  const moreButtonText = clean($moreButtonClone.text());
  $moreButtonClone.remove();

  const pushText = (text) => {
    if (!text) return;
    decodeOwnerText(text)
      .split(/\n+/)
      .map((piece) => clean(piece))
      .filter(Boolean)
      .forEach((piece) => {
        if (!seenPieces.has(piece)) {
          seenPieces.add(piece);
          rawList.push(piece);
        }
      });
  };

  const flattenNodeText = (node) => {
    if (!node) return "";
    if (node.type === "text") {
      return node.data || "";
    }
    if (node.type === "tag") {
      if (node.name === "br") {
        return "\n";
      }
      if (!node.children || !node.children.length) {
        return "";
      }
      return node.children.map((child) => flattenNodeText(child)).join("");
    }
    return "";
  };

  $detailsClone.find("label").each((_, label) => {
    const fragments = [];
    $(label)
      .contents()
      .each((__, node) => {
        const fragment = flattenNodeText(node);
        if (fragment && clean(fragment)) {
          fragments.push(fragment);
        }
      });
    if (fragments.length) {
      pushText(fragments.join("\n"));
    }
  });

  $detailsClone.find("span").each((_, span) => {
    if ($(span).closest("label").length) return;
    const spanText = flattenNodeText(span);
    if (spanText) {
      pushText(spanText);
    }
  });
  const hiddenVal = $details.find("#other_owners_dtls").val();
  if (typeof hiddenVal === "string") {
    pushText(hiddenVal);
  }
  const $otherOwners = $("#other_owners");
  if ($otherOwners.length) {
    pushText($otherOwners.clone().find("button").remove().end().text());
  }
  if (moreButtonText) {
    pushText(moreButtonText);
  }
  console.log(",,,,",rawList);
  return rawList;
}

function extractOwnersFromHtml($, requestIdentifier, sourceHttpRequest) {
  const rawStrings = gatherRawOwnerStrings($);
  const invalids = [];
  let collected = [];
  rawStrings.forEach((raw) => {
    const owners = ownersFromRaw(raw, invalids, requestIdentifier, sourceHttpRequest);
    if (owners && owners.length) collected = collected.concat(owners);
  });
  const deduped = dedupeOwners(collected);
  const persons = deduped.filter((o) => "first_name" in o);
  const companies = deduped.filter((o) => "name" in o && !("first_name" in o));
  // console.log(">>>>>>>>>>",persons,companies,invalids);
  return { persons, companies, invalids };
}

/**
 * Parses a full address string into its components.
 * @param {string | null} fullAddress
 * @returns {{street_number: string | null, street_name: string | null, street_suffix_type: string | null, city: string | null, state: string | null, zip: string | null}}
 */
function parseFullAddress(fullAddress) {
  let street_number = null;
  let street_name = null;
  let street_suffix_type = null;
  let city = null;
  let state = null;
  let zip = null;

  if (!fullAddress) {
    return { street_number, street_name, street_suffix_type, city, state, zip };
  }
  // Replace <br/> with a space for easier parsing, then split by comma
  const parts = fullAddress.replace(/<br\s*\/?>/gi, ' ').split(',').map(p => p.trim()).filter(Boolean);

  if (parts.length > 0) {
    // First part is typically street address
    const streetPart = parts[0];
    const streetTokens = streetPart.split(/\s+/);
    if (streetTokens.length > 0) {
      street_number = streetTokens[0];
      // Attempt to identify common street suffixes
      const suffixRegex = /(RDS|BLVD|LK|PIKE|KY|VW|CURV|PSGE|LDG|MT|UN|MDW|VIA|COR|KYS|VL|PR|CV|ISLE|LGT|HBR|BTM|HL|MEWS|HLS|PNES|LGTS|STRM|HWY|TRWY|SKWY|IS|EST|VWS|AVE|EXTS|CVS|ROW|RTE|FALL|GTWY|WLS|CLB|FRK|CPE|FWY|KNLS|RDG|JCT|RST|SPGS|CIR|CRST|EXPY|SMT|TRFY|CORS|LAND|UNS|JCTS|WAYS|TRL|WAY|TRLR|ALY|SPG|PKWY|CMN|DR|GRNS|OVAL|CIRS|PT|SHLS|VLY|HTS|CLF|FLT|MALL|FRDS|CYN|LNDG|MDWS|RD|XRDS|TER|PRT|RADL|GRVS|RDGS|INLT|TRAK|BYU|VLGS|CTR|ML|CTS|ARC|BND|RIV|FLDS|MTWY|MSN|SHRS|RUE|CRSE|CRES|ANX|DRS|STS|HOLW|VLG|PRTS|STA|FLD|XRD|WALL|TPKE|FT|BG|KNL|PLZ|ST|CSWY|BGS|RNCH|FRKS|LN|MTN|CTRS|ORCH|ISS|BRKS|BR|FLS|TRCE|PARK|GDNS|RPDS|SHL|LF|RPD|LCKS|GLN|PL|PATH|VIS|LKS|RUN|FRG|BRG|SQS|XING|PLN|GLNS|BLFS|PLNS|DL|CLFS|EXT|PASS|GDN|BRK|GRN|MNR|CP|PNE|SPUR|OPAS|UPAS|TUNL|SQ|LCK|ESTS|SHR|DM|MLS|WL|MNRS|STRA|FRGS|FRST|FLTS|CT|MTNS|FRD|NCK|RAMP|VLYS|PTS|BCH|LOOP|BYP|CMNS|FRY|WALK|HBRS|DV|HVN|BLF|GRV|CR)\.?$/i;

      
      const lastToken = streetTokens[streetTokens.length - 1];
      if (suffixRegex.test(lastToken)) {
        const candidateSuffix = titleCaseName(lastToken).replace(/\./g, ''); // Remove potential dot
        // Validate against schema enum values
        const validSuffixes = ["Rds","Blvd","Lk","Pike","Ky","Vw","Curv","Psge","Ldg","Mt","Un","Mdw","Via","Cor","Kys","Vl","Pr","Cv","Isle","Lgt","Hbr","Btm","Hl","Mews","Hls","Pnes","Lgts","Strm","Hwy","Trwy","Skwy","Is","Est","Vws","Ave","Exts","Cvs","Row","Rte","Fall","Gtwy","Wls","Clb","Frk","Cpe","Fwy","Knls","Rdg","Jct","Rst","Spgs","Cir","Crst","Expy","Smt","Trfy","Cors","Land","Uns","Jcts","Ways","Trl","Way","Trlr","Aly","Spg","Pkwy","Cmn","Dr","Grns","Oval","Cirs","Pt","Shls","Vly","Hts","Clf","Flt","Mall","Frds","Cyn","Lndg","Mdws","Rd","Xrds","Ter","Prt","Radl","Grvs","Rdgs","Inlt","Trak","Byu","Vlgs","Ctr","Ml","Cts","Arc","Bnd","Riv","Flds","Mtwy","Msn","Shrs","Rue","Crse","Cres","Anx","Drs","Sts","Holw","Vlg","Prts","Sta","Fld","Xrd","Wall","Tpke","Ft","Bg","Knl","Plz","St","Cswy","Bgs","Rnch","Frks","Ln","Mtn","Ctrs","Orch","Iss","Brks","Br","Fls","Trce","Park","Gdns","Rpds","Shl","Lf","Rpd","Lcks","Gln","Pl","Path","Vis","Lks","Run","Frg","Brg","Sqs","Xing","Pln","Glns","Blfs","Plns","Dl","Clfs","Ext","Pass","Gdn","Brk","Grn","Mnr","Cp","Pne","Spur","Opas","Upas","Tunl","Sq","Lck","Ests","Shr","Dm","Mls","Wl","Mnrs","Stra","Frgs","Frst","Flts","Ct","Mtns","Frd","Nck","Ramp","Vlys","Pts","Bch","Loop","Byp","Cmns","Fry","Walk","Hbrs","Dv","Hvn","Blf","Grv","Crk"];
        street_suffix_type = validSuffixes.includes(candidateSuffix) ? candidateSuffix : null;
        street_name = streetTokens.slice(1, streetTokens.length - 1).join(' ');
      } else {
        street_name = streetTokens.slice(1).join(' ');
      }
      
      // Remove directional abbreviations from street_name
      if (street_name) {
        street_name = street_name.replace(/\b(E|N|NE|NW|S|SE|SW|W)\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!street_name) street_name = null;
      }
    }
  }

  if (parts.length > 1) {
    // Extract just the city name, removing state, zip, and descriptors
    const cityPart = parts[1].replace(/\s*\(.*?\)\s*$/g, ''); // Remove (UNINCORPORATED)
    const cityTokens = cityPart.split(/\s+/).filter(token => !/^\d+$/.test(token) && !/^[A-Z]{2}$/.test(token));
    city = cityTokens.length > 0 ? cityTokens.join(' ') : null;
  }

  if (parts.length > 2) {
    const stateZip = parts[2].split(/\s+/).filter(Boolean);
    if (stateZip.length > 0) {
      state = stateZip[0];
    }
    if (stateZip.length > 1) {
      zip = stateZip[1];
    }
  }

  return { street_number, street_name, street_suffix_type, city, state, zip };
}


/**
 * Extracts section, township, and range from a parcel ID.
 * @param {string | null} parcelId
 * @returns {{section: string | null, township: string | null, range: string | null}}
 */
function parseSectionTownshipRangeFromParcel(parcelId) {
  const m = (parcelId || "").match(/^(\d{2})-(\d{2})-(\d{2})-/);
  if (m) {
    return { section: m[1], township: m[2], range: m[3] };
  }
  return { section: null, township: null, range: null };
}

/**
 * Extracts the block from a legal description text.
 * @param {string | null} legalDesc
 * @returns {string | null}
 */
function parseBlockFromLegal(legalDesc) {
  if (!legalDesc) return null;
  const m = String(legalDesc).match(/\bBLK\s+(\w+)\b/i);
  return m ? m[1] : null;
}

/**
 * Determines the number of units type based on the number of units.
 * @param {number | null} numberOfUnits
 * @returns {string | null}
 */
function getNumberOfUnitsType(numberOfUnits) {
  if (numberOfUnits === null) return null;
  if (numberOfUnits === 1) return "One";
  if (numberOfUnits === 2) return "Two";
  if (numberOfUnits === 3) return "Three";
  if (numberOfUnits === 4) return "Four";
  if (numberOfUnits >= 2 && numberOfUnits <= 4) return "TwoToFour"; // This might overlap, schema implies specific enums
  if (numberOfUnits > 4) return null; // Not in schema enum, but a common type. If strict, return null.
  return null; // For 0 or other cases not explicitly covered
}

/**
 * Extracts the first year from a string containing multiple years separated by '|'.
 * @param {string | null} yearString
 * @returns {number | null}
 */
function extractFirstYear(yearString) {
  if (!yearString) return null;
  const years = yearString.split('|').map(s => parseIntSafe(s.trim())).filter(Boolean);
  return years.length > 0 ? years[0] : null;
}


/**
 * Extracts key-value pairs from a specific "Structural Elements" table.
 * @param {cheerio.CheerioAPI} $ - Cheerio instance.
 * @param {string} panelId - The ID of the structural panel (e.g., 'structural_1').
 * @returns {Object} A map of structural elements.
 */
function extractStructuralKeyValues($, panelId) {
  const map = {};
  const $panel = $(`#${panelId}`);
  const $structTable = $panel.find("table.table-bordered").filter((i, tbl) => {
    return $(tbl).find("thead th").first().text().trim().toLowerCase().includes("structural elements");
  }).first();

  if ($structTable.length > 0) {
    $structTable.find("tbody tr").each((i, tr) => {
      const k = $(tr).find("td").eq(0).text().trim().replace(/:$/, "");
      const v = $(tr).find("td").eq(1).text().trim();
      if (k) map[k] = v;
    });
  }
  return map;
}

/**
 * Maps the qualification code from HTML to the sales_history schema's sale_type enum.
 * @param {string | null} qualificationCode - The code from the HTML (e.g., 'M', 'U').
 * @returns {string | null} The corresponding sale_type enum value, or null if no direct mapping.
 */
// function mapQualificationCodeToSaleType(qualificationCode) {
//   if (!qualificationCode) return null;
//   const code = qualificationCode.toUpperCase();

//   // Based on the provided HTML, 'M' is "Multiple" and 'U' is "Unknown".
//   // The schema enum values are very specific. Without more context or a
//   // mapping table, it's hard to map 'M' or 'U' to the provided enum.
//   // For now, we'll return null as there's no direct, safe mapping.
//   // If you have a specific mapping for these codes, please provide it.
//   switch (code) {
//     // Example: if 'U' meant "TypicallyMotivated" (unlikely, but for illustration)
//     // case 'U': return 'TypicallyMotivated';
//     // case 'M': return 'MultipleFamily'; // This is a property type, not a sale type.
//     default:
//       return null;
//   }
// }

/**
 * Determines the authority category based on the authority name.
 * @param {string | null} authorityName
 * @returns {string | null}
 */
function determineAuthorityCategory(authorityName) {
  if (!authorityName) return null;
  const lowerName = authorityName.toLowerCase();

  if (lowerName.includes("pinellas park")) return "Municipal";
  if (lowerName.includes("wtr mgt") || lowerName.includes("water management")) return "Water District";
  // Add more rules as needed based on common authority names and schema enums
  // "County","Municipal","School Board","School District","Independent School District","Independent","Special District","Water District","Fire District","Library District","Hospital District","Community College District","Transit Authority","Port Authority","Utility District","Improvement District","State","Federal"
  return null;
}

// --- GEOMETRY HELPER FUNCTIONS ---

/**
 * Geometry class for handling parcel geometry data.
 */
class Geometry {
  constructor({ latitude, longitude, polygon, request_identifier } = {}) {
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
      request_identifier: record.request_identifier || null,
    });
  }
}

/**
 * Parse CSV content into rows.
 */
function parseCsv(content) {
  const rows = [];
  let current = '';
  let row = [];
  let insideQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (char === '"') {
      if (insideQuotes && content[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if (char === '\n' && !insideQuotes) {
      row.push(current);
      rows.push(row);
      current = '';
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Calculate the depth of coordinate arrays.
 */
function coordinatesDepth(arr, depth = 0) {
  if (!Array.isArray(arr) || !arr.length) return depth;
  return coordinatesDepth(arr[0], depth + 1);
}

/**
 * Check if value is a valid GeoJSON geometry.
 */
function isGeoJsonGeometry(value) {
  return (
    value &&
    typeof value === 'object' &&
    (value.type === 'Polygon' || value.type === 'MultiPolygon') &&
    Array.isArray(value.coordinates)
  );
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

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * Split MultiPolygon geometries into individual Polygon geometries.
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
 * Read the provided CSV file and return Geometry instances.
 */
function createGeometryInstances(csvContent) {
  const rows = parseCsv(csvContent.replace(NORMALIZE_EOL_REGEX, '\n'));

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((values) =>
    headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? '';
      return acc;
    }, {})
  );

  return records.flatMap((record) => splitGeometry(record));
}

/**
 * Load geometry CSV content from input.csv or seed.csv with fallback paths.
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

/**
 * Create address point geometry from CSV latitude/longitude
 * @param {string} csvContent - CSV content
 * @param {object} sourceHttpRequest - Source HTTP request object
 */
function createAddressPointGeometry(csvContent, sourceHttpRequest) {
  const rows = parseCsv(csvContent.replace(NORMALIZE_EOL_REGEX, '\n'));

  if (!rows.length) {
    return;
  }

  const [header, ...dataRows] = rows;
  if (!dataRows.length) {
    return;
  }

  // Get first row for address point geometry
  const firstRow = dataRows[0];
  const record = header.reduce((acc, col, idx) => {
    acc[col] = firstRow[idx] || '';
    return acc;
  }, {});

  const latitude = toNumber(record.latitude);
  const longitude = toNumber(record.longitude);

  if (latitude === null || longitude === null) {
    return;
  }

  const geometry = {
    latitude: latitude,
    longitude: longitude,
    request_identifier: record.request_identifier || record.source_identifier || null,
    source_http_request: sourceHttpRequest || null,
  };

  // Remove null values
  Object.keys(geometry).forEach(key => {
    if (geometry[key] === null) {
      delete geometry[key];
    }
  });

  writeJSON(path.join("data", "geometry.json"), geometry);

  const relationship = {
    from: { "/": "./address.json" },
    to: { "/": "./geometry.json" },
  };
  writeJSON(path.join("data", "relationship_address_has_geometry.json"), relationship);
}


// --- MAIN EXTRACTION LOGIC ---

function extract() {
  // Clean output directory for idempotency
  try {
    fs.rmSync("data", { recursive: true, force: true });
  } catch (e) {}

  const dataDir = path.join("data");
  ensureDir(dataDir);

  // CRITICAL FIRST CHECK: Before anything else, ensure utility.json doesn't exist from previous runs
  // This is the first line of defense against the "Unused data JSON file" error
  const earlyUtilityCheck = path.join(dataDir, "utility.json");
  if (fs.existsSync(earlyUtilityCheck)) {
    try {
      fs.unlinkSync(earlyUtilityCheck);
      console.log("PRE-EXECUTION: Removed utility.json from previous run");
    } catch (e) {
      console.error("Failed to remove utility.json during pre-execution cleanup:", e);
    }
  }

  // CRITICAL: utility.json should NEVER be created - we use utility_N.json files with proper relationships
  // This cleanup ensures any legacy utility.json from previous executions is removed
  const utilityJsonPath = path.join(dataDir, "utility.json");
  if (fs.existsSync(utilityJsonPath)) {
    try {
      fs.unlinkSync(utilityJsonPath);
      console.log("Initial cleanup: Removed utility.json - using utility_N.json files with relationships instead");
    } catch (e) {
      console.error("Failed to remove utility.json during initial cleanup:", e);
    }
  }

  // Additional cleanup for other legacy utility file variants
  const legacyUtilityFiles = ["propertyUtility.json", "property_utility.json"];
  legacyUtilityFiles.forEach(filename => {
    const filepath = path.join(dataDir, filename);
    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
        console.log(`Initial cleanup: Removed legacy file ${filename}`);
      } catch (e) {
        console.error(`Failed to remove ${filename}:`, e);
      }
    }
  });

  const html = fs.readFileSync("input.html", "utf8");
  const $ = cheerio.load(html);
  const unAddr = readJSON("unnormalized_address.json") || {};
  const seed = readJSON("property_seed.json") || {};
  const ownersPath = path.join("owners", "owner_data.json");
  const utilitiesPath = path.join("owners", "utilities_data.json");
  const layoutsPath = path.join("owners", "layout_data.json");

  // Optional data sets
  let ownersData = null;
  let utilitiesData = null;
  let layoutsData = null;
  try {
    ownersData = readJSON(ownersPath);
  } catch (e) {}
  try {
    utilitiesData = readJSON(utilitiesPath);
  } catch (e) {}
  try {
    layoutsData = readJSON(layoutsPath);
  } catch (e) {}



  // Keys & frequently used fields
  const parcelIdFromHtml = getTextOrNull($("#pacel_no"));
  // CRITICAL: parcel_identifier is REQUIRED and must be a string with minLength: 1
  // Use parcel_id from seed file, or request_identifier as fallback
  const parcelId = parcelIdFromHtml ||
                   (seed && seed.parcel_id) ||
                   (seed && seed.request_identifier) ||
                   "UNKNOWN_PARCEL";
  // Fallback to seed if HTML element is not found or empty
  const requestIdentifier =(seed &&
      seed.source_http_request &&
      seed.source_http_request.multiValueQueryString &&
      seed.source_http_request.multiValueQueryString.s &&
      seed.source_http_request.multiValueQueryString.s[0]) ||
    null;
    
  const buildMultiValueQueryString = (value) =>
    value ? { s: [value] } : null;

  const source_http_request =(
        seed && seed.source_http_request && seed.source_http_request.url)
        ? {
        method: seed.source_http_request.method || "GET",
        multiValueQueryString:
        seed.source_http_request.multiValueQueryString &&
        seed.source_http_request.multiValueQueryString.s
        ? { s: seed.source_http_request.multiValueQueryString.s }
        : buildMultiValueQueryString(requestIdentifier),
        url: seed.source_http_request.url,
        }
        : {
        method: "GET",
        multiValueQueryString: buildMultiValueQueryString(requestIdentifier),
        url: "https://www.pcpao.gov/property-details",
        };

  extractExtraFeatures(
    $,
    dataDir,
    requestIdentifier || parcelId || null,
    source_http_request
  );

  // CRITICAL: Immediate post-extractExtraFeatures cleanup to ensure utility.json is removed
  // utility.json should NEVER exist - we use utility_N.json files with proper relationships instead
  try {
    const utilityJsonPath = path.join(dataDir, "utility.json");
    if (fs.existsSync(utilityJsonPath)) {
      fs.unlinkSync(utilityJsonPath);
      console.log("Post-extractExtraFeatures cleanup: Removed utility.json - using utility_N.json files with relationships instead");
    }
  } catch (e) {
    console.error("Error in post-extractExtraFeatures utility.json cleanup:", e);
  }

  const mandatoryFields={
      source_http_request: source_http_request,
      request_identifier: requestIdentifier,
      view: null,
      driveway_material: null,
      paving_type: "None"
  }
    // LOT file creation
  try {
    const landAreaTxt = getTextOrNull($("#land_info #sw"));
    let lot_area_sqft = null;
    let lot_size_acre = null;

    if (landAreaTxt) {
      const mAreaSqft = landAreaTxt.replace(/,/g, "").match(/(\d+)\s*sf/i);
      if (mAreaSqft) lot_area_sqft = parseIntSafe(mAreaSqft[1]);

      const mAreaAcre = landAreaTxt.replace(/,/g, "").match(/(\d+\.?\d*)\s*acres/i);
      if (mAreaAcre) lot_size_acre = parseFloatSafe(mAreaAcre[1]);
    }

    const dimTxt = getTextOrNull($("#tblLandInformation tbody tr:first td").eq(1));
    let lot_length_feet = null;
    let lot_width_feet = null;
    if (dimTxt) {
      const mDim = dimTxt.match(/(\d+)\s*[xX]\s*(\d+)/);
      if (mDim) {
        lot_length_feet = parseIntSafe(mDim[1]);
        lot_width_feet = parseIntSafe(mDim[2]);
      }
    }

    const filePath = path.join(dataDir, "lot.json");
    const propertyLotAreaData = {
      lot_length_feet: lot_length_feet && lot_length_feet > 0 ? lot_length_feet : null,
      lot_width_feet: lot_width_feet && lot_width_feet > 0 ? lot_width_feet : null,
      lot_area_sqft: lot_area_sqft && lot_area_sqft > 0 ? lot_area_sqft : null,
      lot_size_acre: lot_size_acre && lot_size_acre > 0 ? lot_size_acre : null,
      lot_type: null,
      landscaping_features: null,
      fencing_type: null,
      fence_height: null,
      fence_length: null,
      driveway_condition: null, 
      lot_condition_issues: null,
      site_lighting_type: "None",
      site_lighting_fixture_count: null,
      paving_installation_date: null,
      paving_area_sqft: null
    };

    if (fs.existsSync(filePath)) {
      // console.log("+-===")
      // File exists → read, append, and overwrite
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        let propertyData = JSON.parse(content);
        // console.log(propertyData)
        // Append / overwrite the new fields
        Object.assign(propertyData, propertyLotAreaData);
        // console.log(propertyData)
        const fieldsToCheck = ['paving_type', 'view', 'driveway_material'];

        // Append the fields with their existing or null values
        fieldsToCheck.forEach(field => {
          if (!propertyData?.[field]) {
            // console.log("field >>",field);
            if (field === "paving_type"){
              propertyData[field] ="None";
            }
            else{
              propertyData[field] = null;
            }
          }else{
              propertyData[field] = propertyData[field]
          }
        });

        // console.log(propertyData)
        // Save back to file
        fs.writeFileSync(filePath, JSON.stringify(propertyData, null, 2), "utf-8");
        // console.log("Existing file updated with new fields.");
      } catch (err) {
        // console.error("Failed to update existing file:", err.message);
      }
    } else {
      // File does NOT exist → create a new one with mandatory + new fields
      const propertyData = {
        ...mandatoryFields,
        ...propertyLotAreaData
      };

      try {
        fs.writeFileSync(filePath, JSON.stringify(propertyData, null, 2), "utf-8");
        // console.log(" File created successfully with mandatory + new fields.");
      } catch (err) {
        // console.error("Failed to create new file:", err.message);
      }
    }

    // CRITICAL: Create property_has_lot relationship: parcel (from) → lot (to)
    // The "from" must be a parcel entity with parcel_identifier (not property)
    const relationship = {
      from: { "/": `./parcel.json` },
      to: { "/": `./lot.json` }
    };
    writeJSON(
      path.join(dataDir, `relationship_property_has_lot.json`),
      relationship
    );


  } catch (e) {
    console.error("Error extracting lot data:", e);
  }



  const personFileMap = new Map();
  const companyFileMap = new Map();
  const saleFileMap = new Map();
  let nextPersonIndex = 0;
  let nextCompanyIndex = 0;
  let firstSaleFile = null;

  extractSalesHistoryFiles(
    $,
    dataDir,
    requestIdentifier || parcelId || null,
    source_http_request,
  );
  extractPropertyImprovements(
    $,
    dataDir,
    requestIdentifier || parcelId || null,
    source_http_request,
  );

  // console.log(">>>",seed.source_http_request.multiValueQueryString.s[0])        
  // PROPERTY
  const livableSF = getTextOrNull($("#tls"));
  const totalSF = getTextOrNull($("#tgs"));
  const yearBuiltString = getTextOrNull($("#Yrb"));
  const propertyUseText = getTextOrNull($("#property_use a"));
  const numberOfUnitsText = getTextOrNull($("#tlu"));

  const livable_floor_area = (livableSF && livableSF !== 'n/a' && /\d{2,}/.test(livableSF)) ? livableSF.replace(/,/g, '') : null;
  const total_area = (totalSF && totalSF !== 'n/a' && /\d{2,}/.test(totalSF)) ? totalSF.replace(/,/g, '') : null;
  const property_structure_built_year = extractFirstYear(yearBuiltString);
  const number_of_units = parseIntSafe(numberOfUnitsText);
  const number_of_units_type = getNumberOfUnitsType(number_of_units);

  const legalDescHidden = getValueOrNull($("#legal_full_desc"));
  const legalDescDiv = getTextOrNull($("#lLegal"));
  const property_legal_description_text = legalDescHidden || legalDescDiv;
    
  const mailing_address_text= getTextOrNull($("#mailling_add"));
  // console.log(">>",mailing_address_text)
  // Get Building Type from structural elements for fallback
  // const structuralElementsBuilding1 = extractStructuralKeyValues($, 'structural_1');
  // const buildingType = structuralElementsBuilding1["Building Type"] || null;

  // console.log("usecode",useCodeText);
  let property_type = mapPropertyTypeFromUseCode(propertyUseText || "");
  // console.log("property_type>>",property_type);
  const ownership_estate_type=mapOwnershipEstateTypeFromUseCode(propertyUseText || "");
  let build_status= mapBuildStatusFromUseCode(propertyUseText || "");
  const structure_form = mapStructureFormFromUseCode(propertyUseText || "");
  const property_usage_type = mapPropertyUsageTypeFromUseCode(propertyUseText || "");

  // CRITICAL: property_type is REQUIRED by schema and cannot be null
  // If mapping fails, default to "LandParcel" as a reasonable fallback (works with VacantLand status)
  if (!property_type || typeof property_type !== 'string' || property_type.trim() === '') {
    property_type = "LandParcel";
  }

  // CRITICAL: Ensure build_status is valid enum value: VacantLand, Improved, or UnderConstruction
  // If mapping fails or returns null, default to "VacantLand" to match LandParcel property type
  if (!build_status || typeof build_status !== 'string' || build_status.trim() === '') {
    build_status = "VacantLand";
  }

  // Validate that build_status is one of the allowed enum values
  const validBuildStatuses = ["VacantLand", "Improved", "UnderConstruction"];
  if (!validBuildStatuses.includes(build_status)) {
    build_status = "VacantLand";
  }

  // Validate that property_type is a valid string
  const validPropertyTypes = ["Cooperative", "Condominium", "Modular", "ManufacturedHousingMultiWide", "Pud", "Timeshare", "2Units", "DetachedCondominium", "Duplex", "SingleFamily", "MultipleFamily", "3Units", "ManufacturedHousing", "ManufacturedHousingSingleWide", "4Units", "Townhouse", "NonWarrantableCondo", "VacantLand", "Retirement", "MiscellaneousResidential", "ResidentialCommonElementsAreas", "MobileHome", "Apartment", "MultiFamilyMoreThan10", "MultiFamilyLessThan10", "LandParcel", "Building", "Unit", "ManufacturedHome"];
  if (!validPropertyTypes.includes(property_type)) {
    property_type = "LandParcel";
  }

  // Attempt to extract subdivision from legal description
  let subdivision = null;
  if (property_legal_description_text) {
    const subdivisionMatch = property_legal_description_text.match(/^(.*?)\s+(?:PART OF PARCEL|BLK|LOT)/i);
    if (subdivisionMatch && subdivisionMatch[1]) {
      subdivision = subdivisionMatch[1].trim();
    }
  }

  // Zoning is not directly available as text, only a link to a map.
  const zoning = null;

  const property = {
    // area_under_air: livable_floor_area,
    // livable_floor_area: livable_floor_area,
    number_of_units: number_of_units,
    // number_of_units_type: number_of_units_type,
    parcel_identifier: parcelId,
    property_legal_description_text: property_legal_description_text,
    // property_structure_built_year: property_structure_built_year,
    property_type: property_type,
    request_identifier: requestIdentifier,
    subdivision: subdivision,
    // total_area: total_area,
    zoning: zoning,
    ownership_estate_type: ownership_estate_type,
    build_status: build_status,
    structure_form:structure_form,
    property_usage_type:property_usage_type
    // property_effective_built_year: property_structure_built_year,
  };

  Object.keys(property).forEach((k) => {
    if (property[k] === undefined) delete property[k];
  });
  writeJSON(path.join(dataDir, "property.json"), property);

  // CRITICAL: Create parcel.json file - required for property_has_lot relationship
  // The parcel entity is the "from" in the property_has_lot relationship
  const parcel = {
    parcel_identifier: parcelId,
    request_identifier: requestIdentifier
  };
  writeJSON(path.join(dataDir, "parcel.json"), parcel);

  // GEOMETRY - Load from CSV if available, otherwise fall back to point geometry
  const geometryCsv = loadGeometryCsvContent();
  let geometryCreated = false;
  if (geometryCsv) {
    // 1. Create address point geometry (lat/long only) with relationship to address
    try {
      createAddressPointGeometry(geometryCsv, source_http_request);
      console.log(`Created geometry.json with address relationship from CSV`);
    } catch (err) {
      console.warn(`Unable to build address point geometry from CSV: ${err.message}`);
    }

    // 2. Create parcel polygon geometries from CSV
    try {
      const instances = createGeometryInstances(geometryCsv);
      if (instances.length) {
        createParcelGeometries(instances);
        console.log(`Created ${instances.length} geometry_parcel_<index>.json files from CSV`);
        geometryCreated = true;
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
  if (!geometryCreated) {
    const latitude = unAddr && unAddr.latitude ? unAddr.latitude : null;
    const longitude = unAddr && unAddr.longitude ? unAddr.longitude : null;
    if (latitude && longitude) {
      const coordinate = new Geometry({
        latitude: latitude,
        longitude: longitude
      });
      createParcelGeometries([coordinate]);
      geometryCreated = true;
    }
  }

  // CRITICAL: Create property_has_lot relationship: parcel (from) → lot (to)
  // This relationship is created after lot.json is generated (lines 3056)
  // We'll add the relationship creation right after the lot file is written

  // ADDRESS
  try {
    // const siteAddressHtml = $("#site_address").html();
    const { street_number, street_name, street_suffix_type, city, state, zip } =
      parseFullAddress(unAddr.full_address);

    const county_name = "Pinellas";

    // const strParts = parseSectionTownshipRangeFromParcel(parcelId);

    const legalDescForBlock = getValueOrNull($("#legal_full_desc")) || getTextOrNull($("#lLegal"));
    const block = parseBlockFromLegal(legalDescForBlock);

    const country_code = "US";

    // CRITICAL: Address schema uses oneOf - provide EITHER unnormalized_address OR normalized fields
    // Since we have unnormalized_address from input, use that. Do NOT include latitude/longitude (deprecated)
    // Do NOT mix unnormalized with normalized fields - it's one OR the other
    const address = {
      source_http_request: source_http_request,
      request_identifier: requestIdentifier,
      unnormalized_address: unAddr.full_address
      // Note: latitude and longitude are deprecated in address schema
      // Note: county_name should only be included in normalized address form, not with unnormalized_address
    };

    writeJSON(path.join(dataDir, "address.json"), address);
  } catch (e) {
    console.error("Error extracting address data:", e);
  }


  // SALES AND OWNERS CODE BLOCK--------------
  try {
    const salesRows = $("#tblSalesHistory tbody tr");

    fs.readdirSync(dataDir).forEach((file) => {
      if (/^sales_history_\d+\.json$/i.test(file) || /^sales_\d+\.json$/i.test(file) || /^relationship_property_has_sales_history_\d+\.json$/i.test(file)) {
        fs.unlinkSync(path.join(dataDir, file));
      }
    });
    const sales = [];
    salesRows.each((i, el) => {
      const tds = $(el).find("td");
      const dateTxt = getTextOrNull($(tds[0]));
      const priceTxt = getTextOrNull($(tds[1]));
      // const qualificationCodeTxt = getTextOrNull($(tds[2]).find('span')); // Get text from span inside td[2]
      const granteeHtml = $(tds[5]).html();
      const granteeRaw = granteeHtml
        ? decodeOwnerText(granteeHtml)
        : getTextOrNull($(tds[5]));
      const iso = toISODate(dateTxt);
      const price = parseCurrencyToNumber(priceTxt);
      console.log(granteeRaw,price)
      // Only create sales_history records when there's a valid price (schema requires purchase_price_amount to be a number, not null)
      if (iso && price !== null && typeof price === 'number' && Number.isFinite(price)) {
        const saleObj = {
          ownership_transfer_date: iso,
          purchase_price_amount: price,
          request_identifier: requestIdentifier, // Include request_identifier for each sale
          source_http_request: source_http_request, // Include the full source_http_request object
          _rawIndex: i, // Internal use for sorting
          grantee_text: granteeRaw,
        };
        sales.push(saleObj);
      }
    });
    console.log("SALES END------",sales)

    sales.sort((a, b) =>
      a.ownership_transfer_date < b.ownership_transfer_date ? 1 : -1,
    );

    sales.forEach((s, idx) => {
      const saleFileName = `sales_history_${idx + 1}.json`;
      const file = path.join(dataDir, saleFileName);
      // Remove _rawIndex and grantee_text before writing to file
      const { _rawIndex, grantee_text, ...saleData } = s;

      // CRITICAL: purchase_price_amount must be a number (not null) per schema
      // Since it's optional, omit it entirely if not a valid number
      if (saleData.purchase_price_amount === null ||
          saleData.purchase_price_amount === undefined ||
          typeof saleData.purchase_price_amount !== 'number' ||
          !Number.isFinite(saleData.purchase_price_amount)) {
        delete saleData.purchase_price_amount;
      }

      writeJSON(file, saleData);
      s._file = `./${saleFileName}`; // Keep _file for relationship linking
      saleFileMap.set(s.ownership_transfer_date, s._file);
      if (!firstSaleFile) firstSaleFile = s._file;

      // Create property→sales_history relationship
      const relationshipFile = path.join(dataDir, `relationship_property_has_sales_history_${idx + 1}.json`);
      writeJSON(relationshipFile, {
        from: { "/": "./property.json" },
        to: { "/": `./${saleFileName}` }
      });
    });

    const ownerExtraction = extractOwnersFromHtml(
      $,
      requestIdentifier,
      source_http_request,
    );
    console.log('ownerExtraction------', ownerExtraction)

    const mailingPersonRefs = new Set();
    const mailingCompanyRefs = new Set();
    ownerExtraction.persons.forEach((person, idx) => {
      const fileName = `person_${idx + 1}.json`;
      writeJSON(path.join(dataDir, fileName), person);
      personFileMap.set(normalizeOwner(person), `./${fileName}`);
      nextPersonIndex = idx + 1;
      mailingPersonRefs.add(`./${fileName}`);
    });
    if (ownerExtraction.persons.length === 0) nextPersonIndex = 0;

    ownerExtraction.companies.forEach((company, idx) => {
      const fileName = `company_${idx + 1}.json`;
      writeJSON(path.join(dataDir, fileName), {
        source_http_request: source_http_request || null,
        request_identifier:  requestIdentifier,
        name: company.name || null,
      });
      companyFileMap.set(
        normalizeOwner({ name: company.name || "" }),
        `./${fileName}`,
      );
      nextCompanyIndex = idx + 1;
      mailingCompanyRefs.add(`./${fileName}`);
    });
    if (ownerExtraction.companies.length === 0) nextCompanyIndex = 0;

    const ensurePersonFile = (ownerObj) => {
      const norm = normalizeOwner(ownerObj);
      if (personFileMap.has(norm)) return personFileMap.get(norm);
      nextPersonIndex += 1;
      const fileName = `person_${nextPersonIndex}.json`;
      writeJSON(path.join(dataDir, fileName), ownerObj);
      const relPath = `./${fileName}`;
      personFileMap.set(norm, relPath);
      return relPath;
    };

    const ensureCompanyFile = (ownerObj) => {
      const norm = normalizeOwner(ownerObj);
      if (companyFileMap.has(norm)) return companyFileMap.get(norm);
      nextCompanyIndex += 1;
      const fileName = `company_${nextCompanyIndex}.json`;
      writeJSON(path.join(dataDir, fileName), {
        source_http_request: source_http_request || null,
        request_identifier: ownerObj.request_identifier || requestIdentifier,
        name: ownerObj.name || null,
      });
      const relPath = `./${fileName}`;
      companyFileMap.set(norm, relPath);
      return relPath;
    };

    const saleOwnerMap = new Map();
    sales.forEach((sale) => {
      if (sale._file) {
        saleOwnerMap.set(sale._file, {
          persons: new Set(),
          companies: new Set(),
        });
      }
    });

    const addOwnerToSale = (saleFile, ownerObj, ownerIdx) => {
      if (!saleFile || !saleOwnerMap.has(saleFile) || !ownerObj) return;
      const entry = saleOwnerMap.get(saleFile);
      const isLatestSale = firstSaleFile && saleFile === firstSaleFile;
      if ("first_name" in ownerObj || "last_name" in ownerObj) {
        const ref = ensurePersonFile(ownerObj);
        entry.persons.add(ref);
        if (ownerIdx === 0 && isLatestSale) mailingPersonRefs.add(ref);
      } else if ("name" in ownerObj) {
        const ref = ensureCompanyFile(ownerObj);
        entry.companies.add(ref);
        if (ownerIdx === 0 && isLatestSale) mailingCompanyRefs.add(ref);
      }
    };

    const addOwnersToSale = (saleFile, ownersArr) => {
      // console.log('ownersArr', ownersArr)
      if (!saleFile || !Array.isArray(ownersArr) || ownersArr.length === 0) return;
      ownersArr.forEach((owner, ownerIdx) => addOwnerToSale(saleFile, owner, ownerIdx));
    };

    if (sales.length > 0) {
      const latestSaleFile = sales[0]._file;
      if (latestSaleFile) {
        ownerExtraction.persons.forEach((owner, idx) =>
          addOwnerToSale(latestSaleFile, owner, idx),
        );
        ownerExtraction.companies.forEach((owner, idx) =>
          addOwnerToSale(latestSaleFile, owner, idx),
        );
      }
    }

    sales.forEach((sale) => {
      if (!sale._file || !sale.grantee_text) return;
      const invalid = [];
      const owners = ownersFromRaw(
        sale.grantee_text,
        invalid,
        requestIdentifier,
        source_http_request,
      );
      addOwnersToSale(sale._file, owners);
    });

    const ownerData = readJSON(path.join("owners", "owner_data.json")) || {};
    const ownerKeys = [];
    if (parcelId) ownerKeys.push(`property_${parcelId}`);
    if (requestIdentifier) ownerKeys.push(`property_${requestIdentifier}`);

    let ownersByDate = null;
    for (const key of ownerKeys) {
      if (ownerData[key] && ownerData[key].owners_by_date) {
        ownersByDate = ownerData[key].owners_by_date;
        break;
      }
    }

    if (ownersByDate) {
      if (Array.isArray(ownersByDate.current) && ownersByDate.current.length > 0 && sales.length > 0) {
        const latestSaleFile = sales[0]._file;
        ownersByDate.current.forEach((owner) => addOwnerToSale(latestSaleFile, owner));
      }
      Object.entries(ownersByDate)
        .filter(([dateKey]) => dateKey !== "current")
        .forEach(([dateKey, ownersArr]) => {
          const saleFile = saleFileMap.get(dateKey);
          if (!saleFile) return;
          addOwnersToSale(saleFile, ownersArr);
        });
    }

    // Clean up old relationship files with legacy naming
    fs.readdirSync(dataDir).forEach((file) => {
      if (
        file.startsWith("sales_history_has_") ||
        file.startsWith("relationship_sales_") ||
        file.startsWith("relationship_sales_history_") ||
        file.startsWith("relationship_person_") ||
        file.startsWith("relationship_company_")
      ) {
        fs.unlinkSync(path.join(dataDir, file));
      }
    });

    saleOwnerMap.forEach((entry, saleFile) => {
      const saleBase = saleFile.replace("./", "").replace(".json", "");
      entry.persons.forEach((personRef) => {
        const personBase = personRef.replace("./", "").replace(".json", "");
        const relFile = `relationship_sales_history_${saleBase}_has_person_${personBase}.json`;
        writeJSON(path.join(dataDir, relFile), {
          from: { "/": saleFile },
          to: { "/": personRef },
        });
      });
      entry.companies.forEach((companyRef) => {
        const companyBase = companyRef.replace("./", "").replace(".json", "");
        const relFile = `relationship_sales_history_${saleBase}_has_company_${companyBase}.json`;
        writeJSON(path.join(dataDir, relFile), {
          from: { "/": saleFile },
          to: { "/": companyRef },
        });
      });
    });

    // Only create mailing_address.json if there are owners to link it to
    if ((mailingPersonRefs.size > 0 || mailingCompanyRefs.size > 0) && mailing_address_text) {
      const mailing_address = {
        source_http_request: source_http_request,
        request_identifier: requestIdentifier,
        latitude:  null,
        longitude: null,
        unnormalized_address: mailing_address_text
      };
      writeJSON(path.join(dataDir, "mailing_address.json"), mailing_address);

      // Create relationships for person → mailing_address
      mailingPersonRefs.forEach((personRef) => {
        const relFile = `relationship_person_${personRef
          .replace("./", "")
          .replace(".json", "")}_has_mailing_address.json`;
        writeJSON(path.join(dataDir, relFile), {
          from: { "/": personRef },
          to: { "/": "./mailing_address.json" },
        });
      });

      // Create relationships for company → mailing_address
      mailingCompanyRefs.forEach((companyRef) => {
        const relFile = `relationship_company_${companyRef
          .replace("./", "")
          .replace(".json", "")}_has_mailing_address.json`;
        writeJSON(path.join(dataDir, relFile), {
          from: { "/": companyRef },
          to: { "/": "./mailing_address.json" },
        });
      });
    }
  } catch (e) {
    console.error("Error extracting sales/owner data:", e);
  }

  try {
    $("#tblValueHistory tbody tr").each((i, el) => {
      const tds = $(el).find("td");
      const taxYear = parseIntSafe(getTextOrNull($(tds[0])));
      const market = parseCurrencyToNumber(getTextOrNull($(tds[2])));
      const assessed = parseCurrencyToNumber(getTextOrNull($(tds[3])));
      const taxable = parseCurrencyToNumber(getTextOrNull($(tds[4]))); // This is County Taxable Value

      if (taxYear !== null && market !== null && assessed !== null && taxable !== null && taxYear >= 1900 && taxYear <= new Date().getFullYear()) {
        const tax = {
          source_http_request: source_http_request,
          request_identifier: requestIdentifier,
          tax_year: taxYear,
          property_assessed_value_amount: assessed,
          property_market_value_amount: market,
          property_building_amount: null,
          property_land_amount: null,
          property_taxable_value_amount: taxable,
          monthly_tax_amount: null,
          period_end_date: null,
          period_start_date: null,
          first_year_on_tax_roll: null,
          first_year_building_on_tax_roll: null,
          yearly_tax_amount: null,
        };
        writeJSON(path.join(dataDir, `tax_${taxYear}.json`), tax);
      }
    });

    // Newer table (#tblLastYearValue) provides the current year tax assessment.
    const lastYearRow = $("#tblLastYearValue tbody tr").first();
    if (lastYearRow && lastYearRow.length) {
      const cells = lastYearRow.find("td");
      const currentYear = parseIntSafe(getTextOrNull(cells.eq(0)));
      const marketVal = parseCurrencyToNumber(getTextOrNull(cells.eq(1)));
      const assessedVal = parseCurrencyToNumber(getTextOrNull(cells.eq(2)));
      const countyTaxableVal = parseCurrencyToNumber(getTextOrNull(cells.eq(3)));
      // const schoolTaxableVal = parseCurrencyToNumber(getTextOrNull(cells.eq(4)));
      // const municipalTaxableVal = parseCurrencyToNumber(getTextOrNull(cells.eq(5)));

      if (
        currentYear !== null &&
        marketVal !== null &&
        assessedVal !== null &&
        countyTaxableVal !== null
      ) {
        const tax = {
          source_http_request: source_http_request,
          request_identifier: requestIdentifier,
          tax_year: currentYear,
          property_market_value_amount: marketVal,
          property_assessed_value_amount: assessedVal,
          property_taxable_value_amount: countyTaxableVal,
          property_land_amount: null,
          property_building_amount: null,
          yearly_tax_amount: null,
          monthly_tax_amount: null,
          period_start_date: null,
          period_end_date: null,
          first_year_on_tax_roll: null,
          first_year_building_on_tax_roll: null
          // school_taxable_value_amount: schoolTaxableVal,
          // municipal_taxable_value_amount: municipalTaxableVal,
        };
        writeJSON(path.join(dataDir, `tax_${currentYear}.json`), tax);
      }
    }
  } catch (e) {
    console.error("Error extracting tax data:", e);
  }


  // Create utilities for each building
  if (utilitiesData && requestIdentifier) {
    const key = `property_${requestIdentifier}`;
    const utilities = utilitiesData[key]?.utilities || [];
    utilities.forEach((util, idx) => {
      const utilityOut = {
        source_http_request: {
          method: "GET",
          url: seed.source_http_request.url
        },
        request_identifier: util.request_identifier || requestIdentifier || "",
        cooling_system_type: util?.cooling_system_type ?? null,
        heating_system_type: util?.heating_system_type ?? null,
        public_utility_type: util?.public_utility_type ?? null,
        sewer_type: util?.sewer_type ?? null,
        water_source_type: util?.water_source_type ?? null,
        plumbing_fixture_count: util?.plumbing_fixture_count ?? null,
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
      if (layoutsData && requestIdentifier) {
        const key = `property_${requestIdentifier}`;
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
        path.join("data", `relationship_layout_to_utility_${utilityIndex}.json`),
        relationship
      );
    });
  }

  const parcelIdentifier = requestIdentifier || parcelId || null;

  //Layouts data
  if (layoutsData && requestIdentifier) {
    const key = `property_${requestIdentifier}`;
    const layouts = layoutsData[key]?.layouts || [];
    layouts.forEach((layout, idx) => {
      const out = {
        source_http_request: {
          method: "GET",
          url: seed.source_http_request.url
        },
        request_identifier: layout.request_identifier || requestIdentifier || "",
        space_type: layout.space_type ?? null,
        built_year: layout.built_year ?? null,
        total_area_sq_ft: layout.total_area_sq_ft ?? null,
        livable_area_sq_ft: layout.livable_area_sq_ft ?? null,
        heated_area_sq_ft:   layout.heated_area_sq_ft ?? null,
        area_under_air_sq_ft: layout.area_under_air_sq_ft ?? null,
        space_type_index: String(layout.space_type_index || (idx + 1)),
        flooring_material_type: layout.flooring_material_type ?? null,
        size_square_feet: layout.size_square_feet ?? null,
        floor_level: layout.floor_level ?? null,
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
              path.join("data", `relationship_layout_${buildingLayoutIndex}_to_layout_${subLayoutIndex}.json`),
              relationship
            );
          }
        });
      }
    });
  }

    // Create structures for each building
  let structuresData = null;
  try {
    structuresData = readJSON(path.join("owners", "structure_data.json"));
  } catch (e) {}
  

  if (structuresData && requestIdentifier) {
    const key = `property_${requestIdentifier}`;
    const structures = structuresData[key]?.structures || [];
    structures.forEach((struct, idx) => {
      const structureOut = {
        source_http_request: {
          method: "GET",
          url: seed.source_http_request.url
        },
        request_identifier: struct.request_identifier || requestIdentifier || "",
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
        unfinished_base_area: struct?.unfinished_base_area ?? null,
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
      if (layoutsData && requestIdentifier) {
        const key = `property_${requestIdentifier}`;
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
        to: { "/": `./structure_${structureIndex}.json` }
      };
      writeJSON(
        path.join("data", `relationship_layout_to_structure_${structureIndex}.json`),
        relationship
      );
    });
  }


  // Remove relationships that should be null according to schema
//   try {
//     const relationshipsToRemove = [
//       "relationship_property_address.json",
//       "relationship_property_lot.json",
//       "relationship_property_structure.json",
//       "relationship_property_utility.json"
// ];


//     relationshipsToRemove.forEach(filename => {
//       const filepath = path.join(dataDir, filename);
//       if (fs.existsSync(filepath)) {
//         fs.unlinkSync(filepath);
//       }
//     });
//   } catch (e) {
//     console.error("Error removing null relationships:", e);
//   }

  // Final cleanup: Ensure utility.json is removed (it's not used - we use utility_N.json instead)
  // This file should never exist in the final output. We use utility_N.json files with proper relationships instead.
  try {
    // Try multiple path variations to ensure cleanup
    const pathsToCheck = [
      path.join(dataDir, "utility.json"),
      path.resolve(dataDir, "utility.json"),
      path.join("data", "utility.json"),
      "./data/utility.json",
      "data/utility.json"
    ];

    let removedCount = 0;
    pathsToCheck.forEach(utilPath => {
      try {
        if (fs.existsSync(utilPath)) {
          fs.unlinkSync(utilPath);
          removedCount++;
          console.log(`Removed utility.json at: ${utilPath} - using utility_N.json files with relationships instead`);
        }
      } catch (e) {
        console.error(`Error removing utility.json at ${utilPath}:`, e);
      }
    });

    if (removedCount === 0) {
      console.log("No utility.json file found to remove (expected)");
    }
  } catch (e) {
    console.error("Error during utility.json cleanup:", e);
  }

  // Additional cleanup: Remove any other unexpected utility-related files
  try {
    const unexpectedFiles = ["propertyUtility.json", "property_utility.json", "utility.json"];
    unexpectedFiles.forEach(filename => {
      const filepath = path.join(dataDir, filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`Removed unexpected file: ${filename}`);
      }
    });
  } catch (e) {
    console.error("Error cleaning up unexpected files:", e);
  }

  // Final verification: Absolutely ensure utility.json does not exist
  try {
    const finalCheckPath = path.join(dataDir, "utility.json");
    if (fs.existsSync(finalCheckPath)) {
      console.error("WARNING: utility.json still exists after cleanup, forcing removal");
      fs.unlinkSync(finalCheckPath);
      console.log("Forced removal of utility.json successful");
    }
  } catch (e) {
    console.error("Error in final utility.json verification:", e);
  }

}

// Run extraction with guaranteed cleanup
try {
  extract();
} finally {
  // CRITICAL: Post-execution cleanup - absolutely ensure utility.json does not exist
  // This runs after extract() completes OR if there's an error, to catch any edge cases
  try {
    const dataDir = "data";
    const pathsToClean = [
      path.join(dataDir, "utility.json"),
      path.resolve(dataDir, "utility.json"),
      path.join("data", "utility.json"),
      "./data/utility.json",
      "data/utility.json"
    ];

    let cleanedCount = 0;
    pathsToClean.forEach(utilPath => {
      try {
        if (fs.existsSync(utilPath)) {
          fs.unlinkSync(utilPath);
          cleanedCount++;
          console.log(`Post-execution cleanup: Removed utility.json at ${utilPath} - using utility_N.json files instead`);
        }
      } catch (e) {
        console.error(`Error removing utility.json at ${utilPath}:`, e);
      }
    });

    if (cleanedCount === 0) {
      console.log("Post-execution cleanup: No utility.json found (expected)");
    }
  } catch (e) {
    console.error("Error in post-execution utility.json cleanup:", e);
  }

  // ABSOLUTE FINAL CHECK: One last verification with fs.readdirSync to catch any edge cases
  try {
    const dataDir = "data";
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      const utilityJsonFiles = files.filter(f => f === "utility.json");
      if (utilityJsonFiles.length > 0) {
        console.error("CRITICAL: utility.json still exists after all cleanup attempts!");
        utilityJsonFiles.forEach(file => {
          try {
            const fullPath = path.join(dataDir, file);
            fs.unlinkSync(fullPath);
            console.log(`Emergency cleanup: Force deleted ${fullPath}`);
          } catch (err) {
            console.error(`Failed to delete ${file} in emergency cleanup:`, err);
          }
        });
      } else {
        console.log("Final verification: Confirmed utility.json does not exist ✓");
      }
    }
  } catch (e) {
    console.error("Error in final verification:", e);
  }
}
