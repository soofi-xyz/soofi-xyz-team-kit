// Structure mapping script
// Requirements:
// - Read input from input.html (fallback to embedded HTML if missing)
// - Parse with cheerio only for HTML extraction
// - Map to structure schema and write to owners/structure_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
// Fallback HTML from provided input_file
const fallbackHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<body>
    <div id="content">
        
    <div id="detailsWrapper">
        <div id="details_header">
            <div id="ownerName"></div>
            <div id="primaryAddr"></div>
            <div id="plat"></div>
            <div id="tile"></div>
        </div>
        <div class="collapsable">
            <div id="details_value">
                <h2>
                    <span id="ctl00_cphBody_lblHeaderPropertyAddress" aria-label="Property Address">11558 CABINET CT</span>
                </h2>
                <div class="data">
                    <div id="propDetail">
                        <div id="propDetail_data" class="dt_noHeader">
                            <h3>
                                <span id="ctl00_cphBody_lblHeaderPropertyDetail">Property Detail</span></h3>
                            <table>
                                <tr>
                                    <th scope="row">
                                        <span id="ctl00_cphBody_lblHeaderRealEstateNumber">RE #</span></th>
                                    <td>
                                        <span id="ctl00_cphBody_lblRealEstateNumber">002060-8295</span></td>
                                </tr>
                                <tr class="alt">
                                    <th scope="row">
                                        <span id="ctl00_cphBody_lblHeaderNumberOfBuildings"># of Buildings</span></th>
                                    <td>
                                        <span id="ctl00_cphBody_lblNumberOfBuildings">1</span></td>
                                </tr>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="collapsable">
            <div id="details_buildings">
                <div id="buildingsDetailWrapper">
                            <h3>
                                <span id="ctl00_cphBody_repeaterBuilding_ctl00_lblBuildingNumber">Building 1</span></h3>
                            <div class="actualBuildingData">
                                <div class="propBuildingInfo">
                                    <div class="buildingType">
                                        <div class="dt_noHeader">
                                            <table>
                                                <tr>
                                                    <th>
                                                        <span id="ctl00_cphBody_repeaterBuilding_ctl00_lblHeaderBuildingType" class="shortTip" title="Building Type - The Type (also know as building use) denotes the primary use of a building on a particular property.">Building Type</span></th>
                                                    <td>
                                                        <span id="ctl00_cphBody_repeaterBuilding_ctl00_lblBuildingType">0105 - TOWNHOUSE</span></td>
                                                </tr>
                                                <tr class="alt">
                                                    <th>
                                                        <span id="ctl00_cphBody_repeaterBuilding_ctl00_lblHeaderYearBuilt" class="shortTip" title="Actual Year Built (AYB) - Actual year built of improvements, buildings or permanent structures.">Year Built</span></th>
                                                    <td>
                                                        <span id="ctl00_cphBody_repeaterBuilding_ctl00_lblYearBuilt">2023</span></td>
                                                </tr>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="typeList">
                                        <div class="gv">
                                            <div>
    <table class="gridview" cellspacing="0" border="0" id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingArea">
        <tr>
            <th class="faux_th" scope="col">Type</th><th scope="col">Gross Area</th><th scope="col">Heated Area</th><th scope="col">Effective Area</th>
        </tr><tr>
            <td class="faux_th">Finished Open Porch</td><td>16</td><td>0</td><td>5</td>
        </tr><tr class="alt">
            <td class="faux_th">Finished Garage</td><td>286</td><td>0</td><td>143</td>
        </tr><tr>
            <td class="faux_th">Base Area</td><td>596</td><td>596</td><td>596</td>
        </tr><tr class="alt">
            <td class="faux_th">Finished upper story 1</td><td>698</td><td>698</td><td>663</td>
        </tr><tr>
            <td class="faux_th">Finished Open Porch</td><td>35</td><td>0</td><td>10</td>
        </tr><tr class="alt">
            <td class="faux_th">Total</td><td>1631</td><td>1294</td><td>1417</td>
        </tr>
    </table>
</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="propBuildingElements">
                                    <div class="gv element_detail">
                                        <div>
    <table class="gridview" cellspacing="0" border="0" id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingElements">
        <tr>
            <th scope="col">Element</th><th scope="col">Code</th><th scope="col">Detail</th>
        </tr><tr>
            <td class="col_element">Exterior Wall</td><td class="col_code">8</td><td class="col_detail">8 Horizontal Lap</td>
        </tr><tr class="alt">
            <td class="col_element">Exterior Wall</td><td class="col_code">6</td><td class="col_detail">6 Vertical Sheet</td>
        </tr><tr>
            <td class="col_element">Roof Struct</td><td class="col_code">3</td><td class="col_detail">3 Gable or Hip</td>
        </tr><tr class="alt">
            <td class="col_element">Roofing Cover</td><td class="col_code">3</td><td class="col_detail">3 Asph/Comp Shng</td>
        </tr><tr>
            <td class="col_element">Interior Wall</td><td class="col_code">5</td><td class="col_detail">5 Drywall</td>
        </tr><tr class="alt">
            <td class="col_element">Int Flooring</td><td class="col_code">14</td><td class="col_detail">14 Carpet</td>
        </tr><tr>
            <td class="col_element">Int Flooring</td><td class="col_code">11</td><td class="col_detail">11 Cer Clay Tile</td>
        </tr><tr class="alt">
            <td class="col_element">Heating Fuel</td><td class="col_code">4</td><td class="col_detail">4 Electric</td>
        </tr><tr>
            <td class="col_element">Heating Type</td><td class="col_code">4</td><td class="col_detail">4 Forced-Ducted</td>
        </tr><tr class="alt">
            <td class="col_element">Air Cond</td><td class="col_code">3</td><td class="col_detail">3 Central</td>
        </tr>
    </table>
</div>
                                    </div>
                                    <br />
                                    <div class="gv element_stories">
                                        <div>
    <table class="gridview" cellspacing="0" border="0" id="ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingAttributes">
        <tr>
            <th scope="col">Element</th><th scope="col">Code</th><th scope="col">Detail</th>
        </tr><tr>
            <td class="col_element">Baths</td><td class="col_code">2.500</td><td class="col_detail"></td>
        </tr><tr class="alt">
            <td class="col_element">Bedrooms</td><td class="col_code">2.000</td><td class="col_detail"></td>
        </tr><tr>
            <td class="col_element">Stories</td><td class="col_code">2.000</td><td class="col_detail"></td>
        </tr><tr class="alt">
            <td class="col_element">Rooms / Units</td><td class="col_code">1.000</td><td class="col_detail"></td>
        </tr>
    </table>
</div>
                                    </div>
                                </div>
                            </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;

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

function textFromNode(node) {
  if (!node || node.length === 0) return "";
  const raw = node.text();
  return raw ? String(raw).trim() : "";
}

function parseNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
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
    const buildingNumberText = $(tds[3]).text().trim();
    const buildingNumberParsed = parseNumber(buildingNumberText);
    const length = parseNumber($(tds[4]).text());
    const width = parseNumber($(tds[5]).text());
    const totalUnits = parseNumber($(tds[6]).text());
    features.push({
      code,
      description,
      buildingNumber: Number.isFinite(buildingNumberParsed)
        ? buildingNumberParsed
        : null,
      buildingNumberRaw:
        buildingNumberText && buildingNumberText !== ""
          ? buildingNumberText
          : null,
      length,
      width,
      totalUnits,
    });
  });
  return features;
}

const STRUCTURE_ENUMS = {
  exteriorWallMaterial: new Set([
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
  ]),
  exteriorWallMaterialSecondary: new Set([
    "Brick Accent",
    "Stone Accent",
    "Wood Trim",
    "Metal Trim",
    "Stucco Accent",
    "Vinyl Accent",
    "Decorative Block",
  ]),
  roofDesignType: new Set([
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
  ]),
  roofCoveringMaterial: new Set([
    "3-Tab Asphalt Shingle",
    "Architectural Asphalt Shingle",
    "Metal Standing Seam",
    "Metal Corrugated",
    "Clay Tile",
    "Concrete Tile",
    "Natural Slate",
    "Synthetic Slate",
    "Wood Shake",
    "Wood Shingle",
    "TPO Membrane",
    "EPDM Membrane",
    "Modified Bitumen",
    "Built-Up Roof",
    "Green Roof System",
    "Solar Integrated Tiles",
  ]),
  roofStructureMaterial: new Set([
    "Wood Truss",
    "Wood Rafter",
    "Steel Truss",
    "Concrete Beam",
    "Engineered Lumber",
  ]),
  roofMaterialType: new Set([
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
  ]),
  interiorWallSurface: new Set([
    "Drywall",
    "Plaster",
    "Wood Paneling",
    "Exposed Brick",
    "Exposed Block",
    "Wainscoting",
    "Shiplap",
    "Board and Batten",
    "Tile",
    "Stone Veneer",
    "Metal Panels",
    "Glass Panels",
    "Concrete",
  ]),
  interiorWallSurfaceSecondary: new Set([
    "Wainscoting",
    "Chair Rail",
    "Crown Molding",
    "Baseboards",
    "Wood Trim",
    "Stone Accent",
    "Tile Accent",
    "Metal Accent",
    "Glass Insert",
    "Decorative Panels",
    "Feature Wall Material",
  ]),
  flooringMaterial: new Set([
    "Solid Hardwood",
    "Engineered Hardwood",
    "Laminate",
    "Luxury Vinyl Plank",
    "Ceramic Tile",
    "Carpet",
    "Area Rugs",
    "Transition Strips",
  ]),
  primaryFramingMaterial: new Set([
    "Wood Frame",
    "Steel Frame",
    "Concrete Block",
    "Poured Concrete",
    "Masonry",
    "Engineered Lumber",
    "Post and Beam",
    "Log Construction",
  ]),
};

function ensureEnum(value, set) {
  if (value == null) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized !== "string") return null;
  return set.has(normalized) ? normalized : null;
}

function mapExteriorWall(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/VINYL/.test(upper)) return "Vinyl Siding";
  if (/ALUM/.test(upper)) return "Metal Siding";
  if (/BRICK/.test(upper)) return "Brick";
  if (/STUCCO/.test(upper)) return "Stucco";
  if (/CONCRETE\s*BLK|C\.?B\.?/i.test(detail)) return "Concrete Block";
  if (/FIBER|HARDI|LAP/.test(upper)) return "Fiber Cement Siding";
  if (/CEDAR|REDWOOD|WOOD|VERTICAL SHEET|HORIZONTAL LAP/.test(upper))
    return "Wood Siding";
  if (/STONE/.test(upper)) return "Manufactured Stone";
  return null;
}

function mapPrimaryToSecondaryExteriorWall(primaryMaterial) {
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

function mapRoofDesign(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/GABLE/.test(upper) && /HIP/.test(upper)) return "Combination";
  if (/GABLE/.test(upper)) return "Gable";
  if (/HIP/.test(upper)) return "Hip";
  if (/FLAT/.test(upper)) return "Flat";
  if (/SHED/.test(upper)) return "Shed";
  if (/MANSARD/.test(upper)) return "Mansard";
  if (/GAMBREL/.test(upper)) return "Gambrel";
  return null;
}

function mapRoofCovering(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/ASPH|COMP|SHNG/.test(upper)) return "Architectural Asphalt Shingle";
  if (/BUILT\s*UP|BUILT-UP|T&G/.test(upper)) return "Built-Up Roof";
  if (/METAL/.test(upper)) return "Metal Standing Seam";
  if (/CLAY TILE/.test(upper)) return "Clay Tile";
  if (/CONC(?:RETE)?\s*TILE/.test(upper)) return "Concrete Tile";
  return null;
}

function mapRoofStructure(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/WOOD\s*TRUSS/.test(upper)) return "Wood Truss";
  if (/WOOD\s*RAFTER/.test(upper)) return "Wood Rafter";
  if (/REINF|CONC/.test(upper)) return "Concrete Beam";
  if (/RIGID|BAR\s*J/.test(upper)) return "Steel Truss";
  if (/STEEL/.test(upper)) return "Steel Truss";
  if (/ENGINEERED/.test(upper)) return "Engineered Lumber";
  return null;
}

function mapRoofMaterial(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/WOOD/.test(upper)) return "Wood";
  if (/CONC/.test(upper)) return "Concrete";
  if (/STEEL|METAL/.test(upper)) return "Metal";
  if (/SHING/.test(upper)) return "Shingle";
  if (/COMP/.test(upper)) return "Composition";
  if (/CERAMIC|TILE/.test(upper)) return "CeramicTile";
  if (/VINYL/.test(upper)) return "Vinyl";
  if (/GLASS/.test(upper)) return "Glass";
  if (/LAMINATE/.test(upper)) return "Laminate";
  if (/BLOCK/.test(upper)) return "Block";
  return null;
}

function mapInteriorWallSurface(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/DRYWALL/.test(upper)) return "Drywall";
  if (/PLASTER/.test(upper) || /PLASTERED/.test(upper)) return "Plaster";
  if (/MASONRY/.test(upper) || /BLOCK/.test(upper)) return "Exposed Block";
  if (/WOOD/.test(upper)) return "Wood Paneling";
  if (/BRICK/.test(upper)) return "Exposed Brick";
  if (/TILE|DECOR/.test(upper)) return "Tile";
  return null;
}

function mapInteriorWallSurfaceSecondary(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/WAINSCOT/.test(upper)) return "Wainscoting";
  if (/CHAIR\s*RAIL/.test(upper)) return "Chair Rail";
  if (/CROWN\s*MOLD/.test(upper)) return "Crown Molding";
  if (/BASEBOARD/.test(upper)) return "Baseboards";
  if (/WOOD\s*TRIM|TRIM/.test(upper)) return "Wood Trim";
  if (/WOOD\s*CUSTOM|WOOD\s*PANEL|WOOD/.test(upper)) return "Wood Trim";
  if (/STONE\s*ACCENT/.test(upper)) return "Stone Accent";
  if (/TILE\s*ACCENT/.test(upper)) return "Tile Accent";
  if (/METAL\s*ACCENT/.test(upper)) return "Metal Accent";
  if (/GLASS\s*INSERT/.test(upper)) return "Glass Insert";
  if (/DECORAT/.test(upper)) return "Decorative Panels";
  if (/FEATURE\s*WALL/.test(upper)) return "Feature Wall Material";
  return null;
}

function addFlooringMaterial(detail, targetSet) {
  if (!detail) return;
  const upper = detail.toUpperCase();
  if (/NONE/.test(upper)) return;
  if (/CARPET/.test(upper)) targetSet.add("Carpet");
  if (/HARDWOOD/.test(upper)) targetSet.add("Solid Hardwood");
  if (/PARQUET/.test(upper)) targetSet.add("Solid Hardwood");
  if (/VINYL|VNYL/.test(upper)) targetSet.add("Sheet Vinyl");
  if (/CORK/.test(upper)) targetSet.add("Cork");
  if (/CER|TILE/.test(upper)) targetSet.add("Ceramic Tile");
  if (/PORCELAIN/.test(upper)) targetSet.add("Porcelain Tile");
  if (/STONE|MARBLE/.test(upper)) targetSet.add("Natural Stone Tile");
  if (/LAMINATE/.test(upper)) targetSet.add("Laminate");
  if (/CONCRETE/.test(upper)) targetSet.add("Polished Concrete");
  if (/LINOL/.test(upper)) targetSet.add("Linoleum");
  if (/TERRAZZO/.test(upper)) targetSet.add("Terrazzo");
  if (/ASPHALT/.test(upper)) targetSet.add("Sheet Vinyl");
}

function mapFramingMaterial(detail) {
  if (!detail) return null;
  const upper = detail.toUpperCase();
  if (/WOOD/.test(upper)) return "Wood Frame";
  if (/MASONRY/.test(upper)) return "Masonry";
  if (/CONC/.test(upper)) return "Concrete Block";
  if (/STEEL/.test(upper)) return "Steel Frame";
  return null;
}

function calculateFeatureArea(feature) {
  if (!feature) return null;
  const totalUnits = Number(feature.totalUnits);
  if (Number.isFinite(totalUnits) && totalUnits > 0) return totalUnits;
  const length = Number(feature.length);
  const width = Number(feature.width);
  if (Number.isFinite(length) && length > 0 && Number.isFinite(width) && width > 0)
    return length * width;
  return null;
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

function buildStructureRecord($, buildingNode, extraFeatures, totalBuildings) {
  const context =
    buildingNode && buildingNode.length > 0 ? buildingNode : $.root();

  const elements = [];
  const elementsTable = context
    .find("table[id$='gridBuildingElements']")
    .first();
  if (elementsTable && elementsTable.length > 0) {
    elementsTable.find("tr").each((i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        elements.push({
          element: $(tds[0]).text().trim(),
          code: $(tds[1]).text().trim(),
          detail: $(tds[2]).text().trim(),
        });
      }
    });
  }

  if (elements.length === 0) return null;

  const getDetails = (name) =>
    elements
      .filter((e) => e.element.toLowerCase() === name.toLowerCase())
      .map((e) => e.detail);

  const exteriorWalls = getDetails("Exterior Wall");
  const roofStruct = getDetails("Roof Struct")[0] || "";
  const roofCover = getDetails("Roofing Cover")[0] || "";
  const interiorWalls = getDetails("Interior Wall");
  const intFlooring = getDetails("Int Flooring");
  const commFrameDetail = getDetails("Comm Frame")[0] || "";

  // Areas
  let finished_base_area = null;
  let finished_upper_story_area = null;
  const areaTable = context.find("table[id$='gridBuildingArea']").first();
  if (areaTable && areaTable.length > 0) {
    areaTable.find("tr").each((i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 4) {
        const type = $(tds[0]).text().trim();
        const heated = parseNumber($(tds[2]).text());
        if (type === "Base Area") {
          finished_base_area = heated;
        } else if (type.toLowerCase().startsWith("finished upper story")) {
          finished_upper_story_area = heated;
        }
      }
    });
  }

  // Attributes
  let number_of_stories = null;
  let ceiling_height_average = null;
  const attributesTable = context
    .find("table[id$='gridBuildingAttributes']")
    .first();
  if (attributesTable && attributesTable.length > 0) {
    attributesTable.find("tr").each((i, el) => {
      if (i === 0) return;
      const tds = $(el).find("td");
      if (tds.length >= 3) {
        const name = $(tds[0]).text().trim();
        const code = parseNumber($(tds[1]).text());
        if (name === "Stories") {
          number_of_stories = code;
        } else if (/avg\s*story\s*height/i.test(name) && code != null) {
          ceiling_height_average = code;
        }
      }
    });
  }

  // Mappings with schema validation
  const exteriorMaterialCandidates = [];
  exteriorWalls.forEach((detail) => {
    const mapped = mapExteriorWall(detail);
    if (mapped && !exteriorMaterialCandidates.includes(mapped))
      exteriorMaterialCandidates.push(mapped);
  });
  const exterior_wall_material_primary = ensureEnum(
    exteriorMaterialCandidates[0],
    STRUCTURE_ENUMS.exteriorWallMaterial,
  );
  const exterior_wall_material_secondary = ensureEnum(
    mapPrimaryToSecondaryExteriorWall(exteriorMaterialCandidates[1]),
    STRUCTURE_ENUMS.exteriorWallMaterialSecondary,
  );

  const roof_design_type = ensureEnum(
    mapRoofDesign(roofStruct),
    STRUCTURE_ENUMS.roofDesignType,
  );
  const roof_covering_material = ensureEnum(
    mapRoofCovering(roofCover),
    STRUCTURE_ENUMS.roofCoveringMaterial,
  );
  const roof_structure_material = ensureEnum(
    mapRoofStructure(roofStruct),
    STRUCTURE_ENUMS.roofStructureMaterial,
  );
  const roof_material_type = ensureEnum(
    mapRoofMaterial(roofStruct) || mapRoofMaterial(roofCover),
    STRUCTURE_ENUMS.roofMaterialType,
  );

  const interior_wall_surface_material_primary = ensureEnum(
    mapInteriorWallSurface(interiorWalls[0] || ""),
    STRUCTURE_ENUMS.interiorWallSurface,
  );
  const interior_wall_surface_material_secondary = ensureEnum(
    mapInteriorWallSurfaceSecondary(interiorWalls[1] || ""),
    STRUCTURE_ENUMS.interiorWallSurfaceSecondary,
  );

  const flooringSet = new Set();
  intFlooring.forEach((detail) => addFlooringMaterial(detail, flooringSet));
  const flooringArr = Array.from(flooringSet);
  const flooring_material_primary = ensureEnum(
    flooringArr[0],
    STRUCTURE_ENUMS.flooringMaterial,
  );
  const flooring_material_secondary = ensureEnum(
    flooringArr[1],
    STRUCTURE_ENUMS.flooringMaterial,
  );

  const primary_framing_material = ensureEnum(
    mapFramingMaterial(commFrameDetail),
    STRUCTURE_ENUMS.primaryFramingMaterial,
  );

  const yearBuiltText = textFromNode(
    context.find("span[id$='lblYearBuilt']").first(),
  );
  const roof_date =
    yearBuiltText && /\d{4}/.test(yearBuiltText)
      ? yearBuiltText.match(/\d{4}/)[0]
      : null;

  const buildingType = textFromNode(
    context.find("span[id$='lblBuildingType']").first(),
  );

  const structure = {
    architectural_style_type: null,
    attachment_type: /TOWNHOUSE/i.test(buildingType) ? "Attached" : null,
    ceiling_condition: null,
    ceiling_height_average:
      ceiling_height_average != null ? Number(ceiling_height_average) : null,
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
    exterior_wall_material_primary: exterior_wall_material_primary,
    exterior_wall_material_secondary: exterior_wall_material_secondary,
    finished_base_area:
      finished_base_area != null ? Math.round(finished_base_area) : null,
    finished_basement_area: null,
    finished_upper_story_area:
      finished_upper_story_area != null
        ? Math.round(finished_upper_story_area)
        : null,
    flooring_condition: null,
    flooring_material_primary: flooring_material_primary,
    flooring_material_secondary: flooring_material_secondary,
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
    interior_wall_surface_material_primary:
      interior_wall_surface_material_primary,
    interior_wall_surface_material_secondary:
      interior_wall_surface_material_secondary,
    number_of_buildings: Number.isFinite(totalBuildings)
      ? Number(totalBuildings)
      : totalBuildings ?? null,
    number_of_stories: number_of_stories,
    primary_framing_material: primary_framing_material,
    roof_age_years: null,
    roof_condition: null,
    roof_covering_material: roof_covering_material,
    roof_date: roof_date,
    roof_design_type: roof_design_type,
    roof_material_type: roof_material_type,
    roof_structure_material: roof_structure_material,
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

  const featureClassifications = (extraFeatures || []).map((feature) => ({
    feature,
    classification: classifyExtraFeature(feature),
  }));

  const structureAdjustments = {};
  featureClassifications.forEach(({ classification }) => {
    if (
      !classification ||
      !classification.structureAdjustments ||
      typeof classification.structureAdjustments !== "object"
    )
      return;
    Object.entries(classification.structureAdjustments).forEach(
      ([key, value]) => {
        if (value == null) return;
        structureAdjustments[key] = value;
      },
    );
  });

  Object.entries(structureAdjustments).forEach(([key, value]) => {
    if (value == null) return;
    if (Object.prototype.hasOwnProperty.call(structure, key)) {
      if (structure[key] == null) {
        structure[key] = value;
      }
    } else {
      structure[key] = value;
    }
  });

  const accessoryStructures = [];
  featureClassifications.forEach(({ feature, classification }) => {
    if (
      !classification ||
      !Array.isArray(classification.accessoryStructures) ||
      classification.accessoryStructures.length === 0
    )
      return;
    const area = calculateFeatureArea(feature);
    classification.accessoryStructures.forEach((item) => {
      const rawType = item && item.type ? String(item.type).trim() : "";
      if (!rawType) return;
      accessoryStructures.push({
        type: rawType,
        feature_code: feature.code || null,
        description: feature.description || null,
        building_number: Number.isFinite(feature.buildingNumber)
          ? feature.buildingNumber
          : null,
        size_square_feet: area != null ? Math.round(area) : null,
      });
    });
  });

  return structure;
}

function main() {
  const html = loadHtml();
  const $ = cheerio.load(html);

  const reId = textTrim($, "#ctl00_cphBody_lblRealEstateNumber") || "unknown";
  const propKey = `property_${reId}`;
  const extraFeatures = extractExtraFeatures($);

  const buildingSections = $("#details_buildings .actualBuildingData");
  const reportedBuildingCount =
    parseNumber(textTrim($, "#ctl00_cphBody_lblNumberOfBuildings")) ||
    (buildingSections.length > 0 ? buildingSections.length : null);

  const totalBuildingsValue =
    reportedBuildingCount != null
      ? Number(reportedBuildingCount)
      : buildingSections.length > 0
        ? buildingSections.length
        : null;

  const structures = [];

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
      const record = buildStructureRecord(
        $,
        buildingNode,
        filteredFeatures,
        totalBuildingsValue != null ? totalBuildingsValue : index + 1,
      );
      if (!record) return;
      structures.push({
        building_number: Number.isFinite(buildingNumber)
          ? buildingNumber
          : index + 1,
        building_index: index + 1,
        total_buildings: totalBuildingsValue,
        record,
      });
    });
  }

  if (structures.length === 0) {
    const fallbackNode = $("#details_buildings .actualBuildingData").first();
    const record = buildStructureRecord(
      $,
      fallbackNode,
      extraFeatures,
      totalBuildingsValue != null ? totalBuildingsValue : 1,
    );
    if (record) {
      structures.push({
        building_number: 1,
        building_index: 1,
        total_buildings: totalBuildingsValue != null ? totalBuildingsValue : 1,
        record,
      });
    }
  }

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "structure_data.json");
  const out = {};
  out[propKey] = structures;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(
    `Wrote structure data for ${propKey} -> ${outPath} (${structures.length} building entries)`,
  );
}

main();
