// Structure mapping script
// Reads input.html, parses building-level data using cheerio, and writes owners/structure_data.json per building

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

function mapExteriorMaterials(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (!t) return;
    if (t.includes("BRK") || t.includes("BRICK")) out.push("Brick");
    if (t.includes("STONE")) out.push("Natural Stone");
    if (t.includes("STUC")) out.push("Stucco");
    if (t.includes("VINYL")) out.push("Vinyl Siding");
    if (t.includes("CEDAR") || t.includes("WOOD")) out.push("Wood Siding");
    if (t.includes("FIBER") && t.includes("CEMENT")) out.push("Fiber Cement Siding");
    if (t.includes("METAL")) out.push("Metal Siding");
    if (t.includes("BLOCK") || t.includes("CONCRETE")) out.push("Concrete Block");
    if (t.includes("EIFS")) out.push("EIFS");
    if (t.includes("LOG")) out.push("Log");
    if (t.includes("ADOBE")) out.push("Adobe");
    if (t.includes("BD/BATTEN")) out.push("Wood Siding");
    if (t.includes("CONC BLOCK")) out.push("Concrete Block");
  });
  return out;
}

function mapInteriorSurfacePrimary(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (t.includes("DRYWALL")) out.push("Drywall");
    if (t.includes("PLASTER")) out.push("Plaster");
    if (t.includes("WOOD") && t.includes("PANEL")) out.push("Wood Paneling");
    if (t.includes("BRICK")) out.push("Exposed Brick");
    if (t.includes("BLOCK")) out.push("Exposed Block");
    if (t.includes("WAINSCOT")) out.push("Wainscoting");
    if (t.includes("SHIPLAP")) out.push("Shiplap");
    if (t.includes("BOARD") && t.includes("BATTEN")) out.push("Board and Batten");
    if (t.includes("TILE")) out.push("Tile");
    if (t.includes("STONE")) out.push("Stone Veneer");
    if (t.includes("METAL")) out.push("Metal Panels");
    if (t.includes("GLASS")) out.push("Glass Panels");
    if (t.includes("CONCRETE")) out.push("Concrete");
    if (t.includes("MINIMUM")) out.push("Drywall");
  });
  return out;
}

function mapInteriorSurfaceSecondary(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (t.includes("WAINSCOT")) out.push("Wainscoting");
    if (t.includes("CHAIR") && t.includes("RAIL")) out.push("Chair Rail");
    if (t.includes("CROWN") && t.includes("MOLD")) out.push("Crown Molding");
    if (t.includes("BASEBOARD")) out.push("Baseboards");
    if (t.includes("WOOD") && t.includes("TRIM")) out.push("Wood Trim");
    if (t.includes("STONE") && t.includes("ACCENT")) out.push("Stone Accent");
    if (t.includes("TILE") && t.includes("ACCENT")) out.push("Tile Accent");
    if (t.includes("METAL") && t.includes("ACCENT")) out.push("Metal Accent");
    if (t.includes("GLASS") && t.includes("INSERT")) out.push("Glass Insert");
    if (t.includes("DECORATIVE") && t.includes("PANEL")) out.push("Decorative Panels");
    if (t.includes("FEATURE") && t.includes("WALL")) out.push("Feature Wall Material");
  });
  return out;
}

function mapExteriorWallSecondary(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (t.includes("BRICK") && t.includes("ACCENT")) out.push("Brick Accent");
    if (t.includes("STONE") && t.includes("ACCENT")) out.push("Stone Accent");
    if (t.includes("WOOD") && t.includes("TRIM")) out.push("Wood Trim");
    if (t.includes("METAL") && t.includes("TRIM")) out.push("Metal Trim");
    if (t.includes("STUCCO") && t.includes("ACCENT")) out.push("Stucco Accent");
    if (t.includes("VINYL") && t.includes("ACCENT")) out.push("Vinyl Accent");
    if (t.includes("DECORATIVE") && t.includes("BLOCK")) out.push("Decorative Block");
  });
  return out;
}

function mapFlooring(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (t.includes("HARDWOOD") && t.includes("SOLID")) out.push("Solid Hardwood");
    if (t.includes("HARDWOOD") && t.includes("ENGINEERED")) out.push("Engineered Hardwood");
    if (t.includes("LAMINATE")) out.push("Laminate");
    if (t.includes("LVP") || (t.includes("LUXURY") && t.includes("VINYL"))) out.push("Luxury Vinyl Plank");
    if (t.includes("VINYL") && !t.includes("LUXURY")) out.push("Sheet Vinyl");
    if (t.includes("CERAMIC")) out.push("Ceramic Tile");
    if (t.includes("PORCELAIN")) out.push("Porcelain Tile");
    if (t.includes("STONE")) out.push("Natural Stone Tile");
    if (t.includes("CARPET")) out.push("Carpet");
    if (t.includes("CONCRETE") && t.includes("POLISHED")) out.push("Polished Concrete");
    if (t.includes("BAMBOO")) out.push("Bamboo");
    if (t.includes("CORK")) out.push("Cork");
    if (t.includes("LINOLEUM")) out.push("Linoleum");
    if (t.includes("TERRAZZO")) out.push("Terrazzo");
    if (t.includes("V C TILE")) out.push("Sheet Vinyl");
  });
  return out;
}

function mapFlooringSecondary(tokens) {
  const out = [];
  tokens.forEach((tok) => {
    const t = tok.toUpperCase().trim();
    if (t.includes("HARDWOOD") && t.includes("SOLID")) out.push("Solid Hardwood");
    if (t.includes("HARDWOOD") && t.includes("ENGINEERED")) out.push("Engineered Hardwood");
    if (t.includes("LAMINATE")) out.push("Laminate");
    if (t.includes("LVP") || (t.includes("LUXURY") && t.includes("VINYL"))) out.push("Luxury Vinyl Plank");
    if (t.includes("CERAMIC")) out.push("Ceramic Tile");
    if (t.includes("CARPET")) out.push("Carpet");
    if (t.includes("AREA") && t.includes("RUG")) out.push("Area Rugs");
    if (t.includes("TRANSITION") && t.includes("STRIP")) out.push("Transition Strips");
  });
  return out;
}

function parseNumber(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/[,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function defaultStructure(parcelId, buildingNumber, totalBuildings) {
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
    structure_index: buildingNumber,
    // number_of_buildings: totalBuildings,
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
}

function buildStructureFromBuilding(building, idx, totalBuildings, parcelId) {
  const buildingNumber = idx + 1;
  const rec = defaultStructure(parcelId, buildingNumber, totalBuildings);

  const extTokens = building["Exterior Walls"]
    ? building["Exterior Walls"].split(";").map((s) => s.trim())
    : [];
  const intWallTokens = building["Interior Walls"]
    ? building["Interior Walls"].split(";").map((s) => s.trim())
    : [];
  const floorTokens = building["Flooring Type"]
    ? building["Flooring Type"].split(";").map((s) => s.trim())
    : [];
  const roofTokens = [];
  if (building["Roof Coverage"]) roofTokens.push(building["Roof Coverage"]);
  if (building["Roof Type"]) roofTokens.push(building["Roof Type"]);
  const frameTokens = building["Frame"] ? [building["Frame"]] : [];

  // Exterior materials (map to Structure enum)
  const ext = mapExteriorMaterials(extTokens);
  const extSecondary = mapExteriorWallSecondary(extTokens);
  if (ext.length) {
    rec.exterior_wall_material_primary = ext[0] || null;
  }
  if (extSecondary.length) {
    rec.exterior_wall_material_secondary = extSecondary[0] || null;
  }

  // Interior wall surface (map to Structure enum)
  const intSurfPrimary = mapInteriorSurfacePrimary(intWallTokens);
  const intSurfSecondary = mapInteriorSurfaceSecondary(intWallTokens);
  if (intSurfPrimary.length) {
    rec.interior_wall_surface_material_primary = intSurfPrimary[0] || null;
  }
  if (intSurfSecondary.length) {
    rec.interior_wall_surface_material_secondary = intSurfSecondary[0] || null;
  }

  // Flooring (map to Structure enum)
  const floors = mapFlooring(floorTokens);
  const flooringSecondary = mapFlooringSecondary(floorTokens);
  if (floors.length) {
    rec.flooring_material_primary = floors[0] || null;
  }
  if (flooringSecondary.length) {
    rec.flooring_material_secondary = flooringSecondary[0] || null;
  }

  // Roof covering, structure, and design (map to Structure enums)
  if (roofTokens.length) {
    const u = roofTokens.join(" ").toUpperCase();
    if (u.includes("3-TAB") && u.includes("SHINGLE")) rec.roof_covering_material = "3-Tab Asphalt Shingle";
    else if (u.includes("SHINGLE")) rec.roof_covering_material = "Architectural Asphalt Shingle";
    if (!rec.roof_covering_material && u.includes("METAL") && u.includes("STANDING"))
      rec.roof_covering_material = "Metal Standing Seam";
    else if (!rec.roof_covering_material && u.includes("METAL") && u.includes("CORRUGATED"))
      rec.roof_covering_material = "Metal Corrugated";
    if (!rec.roof_covering_material && u.includes("CLAY") && u.includes("TILE")) rec.roof_covering_material = "Clay Tile";
    if (!rec.roof_covering_material && u.includes("CONCRETE") && u.includes("TILE")) rec.roof_covering_material = "Concrete Tile";
    if (!rec.roof_covering_material && u.includes("SLATE")) rec.roof_covering_material = "Natural Slate";
    if (!rec.roof_covering_material && u.includes("WOOD") && u.includes("SHAKE")) rec.roof_covering_material = "Wood Shake";
    if (!rec.roof_covering_material && u.includes("WOOD") && u.includes("SHINGLE")) rec.roof_covering_material = "Wood Shingle";
    if (!rec.roof_covering_material && u.includes("TPO")) rec.roof_covering_material = "TPO Membrane";
    if (!rec.roof_covering_material && u.includes("EPDM")) rec.roof_covering_material = "EPDM Membrane";

    if (u.includes("WOOD TRUSS")) rec.roof_structure_material = "Wood Truss";
    else if (u.includes("WOOD RAFTER")) rec.roof_structure_material = "Wood Rafter";
    else if (u.includes("STEEL TRUSS")) rec.roof_structure_material = "Steel Truss";
    else if (u.includes("CONCRETE BEAM")) rec.roof_structure_material = "Concrete Beam";

    if (u.includes("GABLE")) rec.roof_design_type = "Gable";
    else if (u.includes("HIP")) rec.roof_design_type = "Hip";
    else if (u.includes("FLAT")) rec.roof_design_type = "Flat";
    else if (u.includes("MANSARD")) rec.roof_design_type = "Mansard";
    else if (u.includes("GAMBREL")) rec.roof_design_type = "Gambrel";
    else if (u.includes("SHED")) rec.roof_design_type = "Shed";
  }

  // Framing (map to Structure enum)
  const frameStr = frameTokens.join(" ").toUpperCase();
  if (frameStr.includes("WOOD")) {
    rec.primary_framing_material = "Wood Frame";
    rec.interior_wall_structure_material = "Wood Frame";
    rec.interior_wall_structure_material_primary = "Wood Frame";
  } else if (frameStr.includes("STEEL")) {
    rec.primary_framing_material = "Steel Frame";
    rec.interior_wall_structure_material = "Steel Frame";
    rec.interior_wall_structure_material_primary = "Steel Frame";
  } else if (frameStr.includes("MASONRY")) {
    rec.primary_framing_material = "Masonry";
    rec.interior_wall_structure_material = "Concrete Block";
    rec.interior_wall_structure_material_primary = "Concrete Block";
  } else if (frameStr.includes("CONCRETE")) {
    rec.primary_framing_material = "Poured Concrete";
    rec.interior_wall_structure_material = "Concrete Block";
    rec.interior_wall_structure_material_primary = "Concrete Block";
  }

  const storiesText = building["Stories"] || "";
  const storiesMatch = storiesText.match(/([0-9.]+)/);
  if (storiesMatch) {
    rec.number_of_stories = parseFloat(storiesMatch[1]);
  }

  return rec;
}

function buildStructuresFromBuildings(buildings, parcelId) {
  const totalBuildings = buildings.length || null;
  return buildings.map((b, idx) =>
    buildStructureFromBuilding(b, idx, totalBuildings, parcelId),
  );
}

function main() {
  const inputPath = path.resolve("input.html");
  const $ = readHtml(inputPath);
  const parcelId = getParcelId($);
  if (!parcelId) {
    throw new Error("Parcel ID not found");
  }
  const buildings = collectBuildings($);
  const structures = buildStructuresFromBuildings(buildings, parcelId);

  const outDir = path.resolve("owners");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "structure_data.json");
  const outObj = {};
  outObj[`property_${parcelId}`] = { structures };
  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}
