// Layout mapping script
// - Read input.html and parse rooms/areas where possible
// - Represent bedrooms and bathrooms as individual layout objects when counts exist
// - Write owners/layout_data.json with { property_[id]: { layouts: [ ... ] } }

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
  <div class="gv element_stories">
    <table id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingAttributes" class="gridview">
      <tr><th>Element</th><th>Code</th><th>Detail</th></tr>
      <tr><td class="col_element">Baths</td><td class="col_code">2.500</td><td></td></tr>
      <tr><td class="col_element">Bedrooms</td><td class="col_code">2.000</td><td></td></tr>
      <tr><td class="col_element">Stories</td><td class="col_code">2.000</td><td></td></tr>
    </table>
  </div>
  <div class="typeList">
    <table id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingArea" class="gridview">
      <tr><th>Type</th><th>Gross Area</th><th>Heated Area</th><th>Effective Area</th></tr>
      <tr><td class="faux_th">Base Area</td><td>596</td><td>596</td><td>596</td></tr>
      <tr><td class="faux_th">Finished upper story 1</td><td>698</td><td>698</td><td>663</td></tr>
    </table>
  </div>
</div>
</body></html>`;

const LAYOUT_SPACE_TYPE_VALUES = [
  "Building",
  "Living Room",
  "Family Room",
  "Great Room",
  "Dining Room",
  "Office Room",
  "Conference Room",
  "Class Room",
  "Plant Floor",
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

const LAYOUT_SPACE_TYPE_SET = new Set(LAYOUT_SPACE_TYPE_VALUES);

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
  layout: { spaceType: "First Floor", isFinished: true },
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
  const spaceType =
    floorNumber === 2
      ? "Second Floor"
      : floorNumber === 3
        ? "Third Floor"
        : floorNumber === 4
          ? "Fourth Floor"
          : "Floor";
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

const LAYOUT_FIELDS = [
  "adjustable_area_sq_ft",
  "area_under_air_sq_ft",
  "bathroom_renovation_date",
  "building_number",
  "cabinet_style",
  "clutter_level",
  "condition_issues",
  "countertop_material",
  "decor_elements",
  "design_style",
  "fixture_finish_quality",
  "flooring_installation_date",
  "flooring_material_type",
  "flooring_wear",
  "furnished",
  "has_windows",
  "heated_area_sq_ft",
  "installation_date",
  "is_exterior",
  "is_finished",
  "kitchen_renovation_date",
  "lighting_features",
  "livable_area_sq_ft",
  "natural_light_quality",
  "paint_condition",
  "pool_condition",
  "pool_equipment",
  "pool_installation_date",
  "pool_surface_type",
  "pool_type",
  "pool_water_quality",
  "request_identifier",
  "safety_features",
  "size_square_feet",
  "spa_installation_date",
  "spa_type",
  "space_index",
  "space_type",
  "space_type_index",
  "story_type",
  "total_area_sq_ft",
  "view_type",
  "visible_damage",
  "window_design_type",
  "window_material_type",
  "window_treatment_type",
];

const BEDROOM_LIKE_SPACE_TYPES = new Set([
  "Bedroom",
  "Primary Bedroom",
  "Secondary Bedroom",
  "Guest Bedroom",
  "Children's Bedroom",
  "Nursery",
  "Living Area",
]);

const CHILD_SPACE_TYPE_PRIORITY = new Map([
  ["Primary Bedroom", 1],
  ["Bedroom", 2],
  ["Primary Bathroom", 3],
  ["Full Bathroom", 4],
  ["Half Bathroom / Powder Room", 5],
  ["Living Area", 6],
  ["Kitchen", 7], // Kitchen is still in priority, but won't be added by default
]);

const VALID_SPACE_TYPES = new Set(LAYOUT_SPACE_TYPE_SET);

const PROPERTY_USAGE_OVERRIDES = [
  {
    matcher: (usage) =>
      usage.includes("school") ||
      usage.includes("university") ||
      usage.includes("college"),
    replacement: "Class Room",
  },
  {
    matcher: (usage) => usage.includes("office"),
    replacement: "Office Room",
  },
];

// Define defaultPriority globally
const defaultPriority = 100;

function createLayoutRecord(overrides = {}) {
  const base = {};
  LAYOUT_FIELDS.forEach((field) => {
    base[field] = null;
  });
  return Object.assign(base, overrides);
}

function formatFloorLevel(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix} Floor`;
}

function loadHtml() {
  const primary = path.join(process.cwd(), "input.html");
  if (fs.existsSync(primary)) return fs.readFileSync(primary, "utf8");
  const alternate = path.join(process.cwd(), "0020608295R.html");
  if (fs.existsSync(alternate)) return fs.readFileSync(alternate, "utf8");
  return fallbackHtml;
}

function loadPropertyUsageType() {
  const propertyPath = path.join(process.cwd(), "data", "property.json");
  try {
    if (!fs.existsSync(propertyPath)) return null;
    const raw = JSON.parse(fs.readFileSync(propertyPath, "utf8"));
    const usage =
      raw && Object.prototype.hasOwnProperty.call(raw, "property_usage_type")
        ? raw.property_usage_type
        : null;
    if (typeof usage === "string" && usage.trim() !== "") {
      return usage.trim();
    }
  } catch (err) {
    // Ignore malformed or missing property usage data
  }
  return null;
}

function normalizeUsageValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function textTrim($, sel) {
  return ($(sel).text() || "").trim();
}

function findTableLabelNumber($, labelPattern) {
  let match = null;
  $("table:not([id$='gridBuildingAttributes']) tr").each((_, row) => {
    if (match != null) return;
    const cells = $(row).children("th,td");
    if (cells.length < 2) return;
    const label = $(cells[0]).text().trim();
    if (!labelPattern.test(label)) return;
    match = parseNumber($(cells[1]).text());
  });
  return match;
}

function extractExtraFeatures($) {
  const features = [];
  $("#ctl00_cphBody_gridExtraFeatures tr").each((index, row) => {
    if (index === 0) return; // Skip header row
    const tds = $(row).find("td");
    if (tds.length < 3) return; // Ensure enough columns exist

    const code = $(tds[1]).text().trim();
    const description = $(tds[2]).text().trim();
    const buildingNumberText = $(tds[3]).text().trim();
    const buildingNumberParsed = parseNumber(buildingNumberText);
    const length = parseNumber($(tds[4]).text());
    const width = parseNumber($(tds[5]).text());
    const totalUnits = parseNumber($(tds[6]).text());

    features.push({
      code,
      description,
      buildingNumber:
        Number.isFinite(buildingNumberParsed) ? buildingNumberParsed : null,
      buildingNumberRaw:
        buildingNumberText && buildingNumberText !== "" ? buildingNumberText : null,
      length,
      width,
      totalUnits,
    });
  });
  return features;
}

function adjustSpaceType(spaceType, normalizedUsageType) {
  if (typeof spaceType !== "string") return null;
  const trimmed = spaceType.trim();
  if (!trimmed) return null;
  if (!normalizedUsageType) return trimmed;
  if (!BEDROOM_LIKE_SPACE_TYPES.has(trimmed)) return trimmed;
  for (const override of PROPERTY_USAGE_OVERRIDES) {
    if (override.matcher(normalizedUsageType)) {
      return override.replacement;
    }
  }
  return trimmed;
}

function validateSpaceType(spaceType) {
  if (typeof spaceType !== "string") return null;
  const trimmed = spaceType.trim();
  if (!trimmed || !VALID_SPACE_TYPES.has(trimmed)) return null;
  return trimmed;
}

function assignSpaceTypeIndexes(layoutEntries) {
  if (!Array.isArray(layoutEntries)) return;

  const entryById = new Map();
  const childrenByParent = new Map();
  const rootIds = new Set();

  layoutEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const localId = entry.local_id;
    if (localId == null) return;
    entryById.set(localId, entry);
    rootIds.add(localId); // Assume root until a parent is found

    if (entry.record && typeof entry.record === "object") {
      entry.record.space_type_index = null;
    }
  });

  layoutEntries.forEach((entry) => {
    const localId = entry.local_id;
    const parentLocalId =
      entry.parent_local_id != null ? entry.parent_local_id : null;

    if (parentLocalId) {
      if (!childrenByParent.has(parentLocalId)) {
        childrenByParent.set(parentLocalId, []);
      }
      childrenByParent.get(parentLocalId).push(localId);
      rootIds.delete(localId); // It's a child, not a root
    }
  });

  const sortedRootIds = Array.from(rootIds).sort((a, b) => {
    const entryA = entryById.get(a);
    const entryB = entryById.get(b);
    const spaceTypeA = entryA?.record?.space_type || "";
    const spaceTypeB = entryB?.record?.space_type || "";

    // Prioritize Buildings first
    if (spaceTypeA === "Building" && spaceTypeB !== "Building") return -1;
    if (spaceTypeA !== "Building" && spaceTypeB === "Building") return 1;

    // Fallback to local_id for stable sorting
    return a.localeCompare(b);
  });

  const processNode = (nodeId, parentPath) => {
    const entry = entryById.get(nodeId);
    if (!entry) return;

    const childrenIds = childrenByParent.get(nodeId) || [];

    // Group children by space_type for independent indexing
    const childrenBySpaceType = new Map();
    childrenIds.forEach((childId) => {
      const childEntry = entryById.get(childId);
      if (childEntry) {
        const spaceType = childEntry.record?.space_type || "Unknown";
        if (!childrenBySpaceType.has(spaceType)) {
          childrenBySpaceType.set(spaceType, []);
        }
        childrenBySpaceType.get(spaceType).push(childId);
      }
    });

    // Sort children within each space type group (e.g., by local_id for stability)
    childrenBySpaceType.forEach((ids) => ids.sort((a, b) => a.localeCompare(b)));

    // Assign space_type_index to children
    const sortedSpaceTypes = Array.from(childrenBySpaceType.keys()).sort((a, b) => {
      const priorityA = CHILD_SPACE_TYPE_PRIORITY.get(a) ?? defaultPriority;
      const priorityB = CHILD_SPACE_TYPE_PRIORITY.get(b) ?? defaultPriority;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.localeCompare(b); // Stable sort for space types
    });

    sortedSpaceTypes.forEach((spaceType) => {
      let typeCounter = 0;
      childrenBySpaceType.get(spaceType).forEach((childId) => {
        const childEntry = entryById.get(childId);
        if (childEntry) {
          typeCounter += 1;
          const nextPath = parentPath.concat(String(typeCounter));
          childEntry.record.space_type_index = nextPath.join(".");
          processNode(childId, nextPath); // Recurse for grandchildren
        }
      });
    });
  };

  let rootCounter = 0;
  sortedRootIds.forEach((rootId) => {
    const entry = entryById.get(rootId);
    if (!entry) return;

    rootCounter += 1;
    const basePath = [String(rootCounter)];
    entry.record.space_type_index = basePath.join(".");
    processNode(rootId, basePath);
  });
}

function main() {
  const html = loadHtml();
  const $ = cheerio.load(html);

  const reId = textTrim($, "#ctl00_cphBody_lblRealEstateNumber") || "unknown";
  const propKey = `property_${reId}`;
  const extraFeatures = extractExtraFeatures($);
  const propertyUsageTypeRaw = loadPropertyUsageType();
  const propertyUsageNormalized = normalizeUsageValue(propertyUsageTypeRaw);

  const layouts = [];
  let spaceCounter = 0;
  const buildingLocalIdMap = new Map();

  const addLayoutEntry = (
    localId,
    spaceType,
    overrides = {},
    parentLocalId = null,
  ) => {
    const overrideCopy = Object.assign({}, overrides || {});
    const rawSpaceType =
      Object.prototype.hasOwnProperty.call(overrideCopy, "space_type") &&
      overrideCopy.space_type != null
        ? overrideCopy.space_type
        : spaceType;
    delete overrideCopy.space_type;
    const normalizedSpaceType = adjustSpaceType(
      rawSpaceType,
      propertyUsageNormalized,
    );
    const validatedSpaceType = validateSpaceType(normalizedSpaceType);
    if (!validatedSpaceType) return null;
    spaceCounter += 1;
    const record = createLayoutRecord(
      Object.assign(
        {
          space_type: validatedSpaceType,
          space_index: spaceCounter,
          is_finished: true,
          is_exterior: false,
        },
        overrideCopy,
      ),
    );
    const entry = { local_id: localId, record };
    if (parentLocalId) entry.parent_local_id = parentLocalId;
    layouts.push(entry);
    return entry;
  };

  const buildingSections = $("#details_buildings .actualBuildingData");

  buildingSections.each((index, el) => {
    const buildingIndex = index + 1;
    const buildingNode = $(el);
    const buildingLocalId = `building_${buildingIndex}`;

    const buildingHeaderText = buildingNode
      .find("span[id$='lblBuildingNumber']")
      .first()
      .text()
      .trim();
    const buildingNumberMatch = buildingHeaderText.match(/(\d+)/);
    const buildingNumber = buildingNumberMatch
      ? Number(buildingNumberMatch[1])
      : buildingIndex;

    const areaRows = buildingNode
      .find("table[id$='gridBuildingArea'] tr")
      .toArray()
      .slice(1);
    let totalGross = null;
    let totalHeated = null;
    let totalEffective = null;
    const floorAreas = [];
    areaRows.forEach((row) => {
      const $row = $(row);
      const tds = $row.find("td");
      if (tds.length < 4) return;
      const type = $(tds[0]).text().trim();
      const gross = parseNumber($(tds[1]).text());
      const heated = parseNumber($(tds[2]).text());
      const effective = parseNumber($(tds[3]).text());
      if (/total/i.test(type)) {
        if (gross != null) totalGross = gross;
        if (heated != null) totalHeated = heated;
        if (effective != null) totalEffective = effective;
        return;
      }
      let floorNumber = null;
      if (/base/i.test(type)) floorNumber = 1;
      const upperMatch = type.match(/upper\s*story\s*(\d+)/i);
      if (upperMatch) floorNumber = 1 + Number(upperMatch[1]);
      if (floorNumber != null) {
        floorAreas.push({
          floor: floorNumber,
          gross: gross != null ? gross : null,
          heated: heated != null ? heated : null,
          effective: effective != null ? effective : null,
        });
      }
    });

    let bedCount = 0;
    let bathCountRaw = 0;
    let storyCount = null;
    let hasBedroomAttribute = false;
    let hasBathAttribute = false;
    buildingNode
      .find("table[id$='gridBuildingAttributes'] tr")
      .each((_, row) => {
        const tds = $(row).find("td");
        if (tds.length < 3) return;
        const label = $(tds[0]).text().trim();
        const value = parseNumber($(tds[1]).text());
        if (/bedroom/i.test(label)) {
          hasBedroomAttribute = true;
          if (value != null) bedCount = Math.max(0, Math.round(value));
        }
        if (/bath/i.test(label)) {
          hasBathAttribute = true;
          if (value != null) bathCountRaw = Number(value);
        }
        if (/stories/i.test(label) && value != null)
          storyCount = Math.round(value);
      });

    if (buildingSections.length === 1 && !hasBedroomAttribute) {
      const condoBeds = findTableLabelNumber($, /^Beds$/i);
      if (condoBeds != null) bedCount = Math.max(0, Math.round(condoBeds));
    }
    if (buildingSections.length === 1 && !hasBathAttribute) {
      const condoBaths = findTableLabelNumber($, /^Baths$/i);
      if (condoBaths != null) bathCountRaw = Number(condoBaths);
    }

    if (floorAreas.length === 0 && storyCount && storyCount > 0) {
      for (let floor = 1; floor <= storyCount; floor += 1) {
        floorAreas.push({ floor, gross: null, heated: null });
      }
    }

    if (totalGross == null && floorAreas.length > 0) {
      totalGross = floorAreas.reduce(
        (sum, fa) => sum + (fa.gross != null ? fa.gross : 0),
        0,
      );
    }
    if (totalHeated == null && floorAreas.length > 0) {
      totalHeated = floorAreas.reduce(
        (sum, fa) => sum + (fa.heated != null ? fa.heated : 0),
        0,
      );
    }
    if (totalEffective == null && floorAreas.length > 0) {
      const effectiveAreas = floorAreas
        .map((fa) => fa.effective)
        .filter((value) => value != null);
      if (effectiveAreas.length > 0) {
        totalEffective = effectiveAreas.reduce((sum, value) => sum + value, 0);
      }
    }

    const buildingEntry = addLayoutEntry(
      buildingLocalId,
      "Building",
      {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
        total_area_sq_ft:
          totalGross != null ? Math.round(totalGross) : null,
        livable_area_sq_ft:
          totalHeated != null ? Math.round(totalHeated) : null,
        area_under_air_sq_ft:
          totalHeated != null ? Math.round(totalHeated) : null,
        adjustable_area_sq_ft:
          totalEffective != null ? Math.round(totalEffective) : null,
        heated_area_sq_ft:
          totalHeated != null ? Math.round(totalHeated) : null,
        size_square_feet:
          totalGross != null ? Math.round(totalGross) : null,
      },
    );
    if (!buildingEntry) return;
    buildingLocalIdMap.set(String(buildingNumber), buildingEntry.local_id);

    const sortedFloors = floorAreas
      .filter((fa) => fa.floor != null)
      .sort((a, b) => a.floor - b.floor);

    const pendingChildren = [];
    let childSeq = 0;
    const queueChild = (localId, spaceType, overrides = {}) => {
      pendingChildren.push({
        localId,
        spaceType,
        overrides,
        parentLocalId: buildingEntry.local_id,
        seq: childSeq += 1,
      });
    };

    let hasLivingAreaEntry = false;
    sortedFloors.forEach((fa, idx) => {
      if (fa.heated == null || fa.heated <= 0) return;
      const livingLocalId =
        sortedFloors.length > 1
          ? `${buildingLocalId}_living_${idx + 1}`
          : `${buildingLocalId}_living`;
      hasLivingAreaEntry = true;
      queueChild(livingLocalId, "Living Area", {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
        size_square_feet: Math.round(fa.heated),
        heated_area_sq_ft: Math.round(fa.heated),
        livable_area_sq_ft: Math.round(fa.heated),
        area_under_air_sq_ft: Math.round(fa.heated),
        adjustable_area_sq_ft:
          fa.effective != null ? Math.round(fa.effective) : null,
      });
    });

    if (!hasLivingAreaEntry && totalHeated != null && totalHeated > 0) {
      queueChild(`${buildingLocalId}_living`, "Living Area", {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
        size_square_feet: Math.round(totalHeated),
        heated_area_sq_ft: Math.round(totalHeated),
        livable_area_sq_ft: Math.round(totalHeated),
        area_under_air_sq_ft: Math.round(totalHeated),
        adjustable_area_sq_ft:
          totalEffective != null ? Math.round(totalEffective) : null,
      });
    }

    for (let i = 0; i < bedCount; i += 1) {
      const overrides = {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
      };
      const localId =
        i === 0
          ? `${buildingLocalId}_primary_bedroom`
          : `${buildingLocalId}_bedroom_${i + 1}`;
      const spaceType = i === 0 ? "Primary Bedroom" : "Bedroom";
      queueChild(localId, spaceType, overrides);
    }

    const fullBaths = Math.floor(bathCountRaw);
    for (let i = 0; i < fullBaths; i += 1) {
      const overrides = {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
      };
      const localId = `${buildingLocalId}_bathroom_${i + 1}`;
      const spaceType = i === 0 ? "Primary Bathroom" : "Full Bathroom";
      queueChild(localId, spaceType, overrides);
    }
    if (bathCountRaw - fullBaths >= 0.5) {
      queueChild(`${buildingLocalId}_half_bath`, "Half Bathroom / Powder Room", {
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : null,
      });
    }

    // REMOVED: The line that unconditionally adds a kitchen
    // queueChild(`${buildingLocalId}_kitchen_1`, "Kitchen", {
    //   building_number: Number.isFinite(buildingNumber)
    //     ? buildingNumber
    //     : null,
    // });

    pendingChildren
      .sort((a, b) => {
        const priorityA =
          CHILD_SPACE_TYPE_PRIORITY.get(a.spaceType) ?? defaultPriority;
        const priorityB =
          CHILD_SPACE_TYPE_PRIORITY.get(b.spaceType) ?? defaultPriority;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.seq - b.seq;
      })
      .forEach((child) => {
        addLayoutEntry(
          child.localId,
          child.spaceType,
          child.overrides,
          child.parentLocalId,
        );
      });
  });

  const defaultBuildingParent =
    buildingLocalIdMap.size === 1
      ? Array.from(buildingLocalIdMap.values())[0]
      : null;

  extraFeatures.forEach((feature, index) => {
    const classification = classifyExtraFeature(feature);
    if (
      !classification ||
      !Array.isArray(classification.layout) ||
      classification.layout.length === 0
    )
      return;

    const normalizedBuildingNumber = Number.isFinite(feature.buildingNumber)
      ? feature.buildingNumber
      : feature.buildingNumberRaw
        ? parseNumber(feature.buildingNumberRaw)
        : null;
    const parentLocalId =
      (normalizedBuildingNumber != null &&
        buildingLocalIdMap.get(String(normalizedBuildingNumber))) ||
      defaultBuildingParent ||
      null;
    const buildingNumberForLayout =
      normalizedBuildingNumber != null
        ? normalizedBuildingNumber
        : parentLocalId && buildingLocalIdMap.size === 1
          ? Number(Array.from(buildingLocalIdMap.keys())[0])
          : null;

    let area = null;
    if (feature.totalUnits != null && feature.totalUnits > 0)
      area = feature.totalUnits;
    else if (
      feature.length != null &&
      feature.length > 0 &&
      feature.width != null &&
      feature.width > 0
    )
      area = feature.length * feature.width;

    classification.layout.forEach((layoutInfo, layoutIdx) => {
      const localId =
        classification.layout.length === 1
          ? `extra_feature_layout_${index + 1}`
          : `extra_feature_layout_${index + 1}_${layoutIdx + 1}`;
      addLayoutEntry(
        localId,
        layoutInfo.spaceType,
        {
          building_number: buildingNumberForLayout,
          size_square_feet: area != null ? Math.round(area) : null,
          total_area_sq_ft: area != null ? Math.round(area) : null,
          is_finished:
            layoutInfo.isFinished != null ? layoutInfo.isFinished : true,
          is_exterior:
            layoutInfo.isExterior != null ? layoutInfo.isExterior : false,
        },
        parentLocalId,
      );
    });
  });

  assignSpaceTypeIndexes(layouts);

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "layout_data.json");
  const out = {};
  out[propKey] = { layouts };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote layout data for ${propKey} -> ${outPath}`);
}

main();
