const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseIntSafe(txt) {
  if (txt == null) return null;
  const numeric = String(txt).replace(/[^0-9-]/g, "");
  if (!numeric) return null;
  const value = parseInt(numeric, 10);
  return Number.isNaN(value) ? null : value;
}

function extractStrap($, rawHtml) {
  let strap = null;
  const scriptsText = $("script")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");
  const match = scriptsText.match(/var\s+g_strap\s*=\s*"(\d+)"/);
  if (match) strap = match[1];
  if (!strap) {
    const parcelNo = $("#pacel_no").text().trim();
    if (parcelNo) strap = parcelNo.replace(/\D/g, "");
  }
  return strap || "unknown_id";
}

function getStructuralValue($, $panel, label) {
  const lowerLabel = label.toLowerCase();
  const row = $panel
    .find("table.table-bordered")
    .filter((_, tbl) => {
      const header = $(tbl).find("thead th").first().text().trim().toLowerCase();
      return header.includes("structural elements");
    })
    .first()
    .find("tbody tr")
    .filter((_, tr) => {
      const key = $(tr).find("td").first().text().trim().toLowerCase();
      return key.startsWith(lowerLabel);
    })
    .first();

  if (!row.length) return null;
  return row.find("td").eq(1).text().trim() || null;
}

function normalizeText(raw) {
  return (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mapFoundationType(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("slab") || text.includes("spread/mono") || text.includes("mono footing")) {
    return "Slab on Grade";
  }
  if (text.includes("crawl")) {
    return "Crawl Space";
  }
  if (text.includes("full basement")) {
    return "Full Basement";
  }
  if (text.includes("partial basement")) {
    return "Partial Basement";
  }
  if (text.includes("pier") || text.includes("beam")) {
    return "Pier and Beam";
  }
  if (text.includes("walkout")) {
    return "Basement with Walkout";
  }
  if (text.includes("stem wall")) {
    return "Stem Wall";
  }
  return null;
}

function mapExteriorWallPrimary(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("concrete")) {
    return "Concrete Block";
  }
  if (text.includes("stucco")) {
    return "Stucco";
  }
  if (text.includes("brick")) {
    return "Brick";
  }
  if (text.includes("stone")) {
    return "Natural Stone";
  }
  if (text.includes("vinyl")) {
    return "Vinyl Siding";
  }
  if (text.includes("wood")) {
    return "Wood Siding";
  }
  if (text.includes("fiber cement")) {
    return "Fiber Cement Siding";
  }
  if (text.includes("metal")) {
    return "Metal Siding";
  }
  if (text.includes("adobe")) {
    return "Adobe";
  }
  if (text.includes("precast")) {
    return "Precast Concrete";
  }
  if (text.includes("curtain wall")) {
    return "Curtain Wall";
  }
  return null;
}

function mapExteriorWallSecondary(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("stucco") && text.includes("concrete")) {
    return "Stucco Accent";
  }
  if (text.includes("stucco") && !text.includes("concrete")) {
    return "Stucco Accent";
  }
  if (text.includes("brick")) {
    return "Brick Accent";
  }
  if (text.includes("stone")) {
    return "Stone Accent";
  }
  if (text.includes("wood trim")) {
    return "Wood Trim";
  }
  if (text.includes("metal trim") || text.includes("aluminum trim")) {
    return "Metal Trim";
  }
  if (text.includes("decorative block")) {
    return "Decorative Block";
  }
  return null;
}

function mapNumberOfStories(raw) {
  const value = parseIntSafe(raw);
  return value != null ? value : null;
}

function mapRoofDesignType(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("flat")) {
    return "Flat";
  }
  if (text.includes("gable")) {
    return "Gable";
  }
  if (text.includes("hip")) {
    return "Hip";
  }
  if (text.includes("mansard")) {
    return "Mansard";
  }
  if (text.includes("gambrel")) {
    return "Gambrel";
  }
  if (text.includes("shed")) {
    return "Shed";
  }
  if (text.includes("saltbox")) {
    return "Saltbox";
  }
  if (text.includes("butterfly")) {
    return "Butterfly";
  }
  if (text.includes("bonnet")) {
    return "Bonnet";
  }
  if (text.includes("clerestory")) {
    return "Clerestory";
  }
  if (text.includes("dome")) {
    return "Dome";
  }
  if (text.includes("barrel")) {
    return "Barrel";
  }
  return "Combination";
}

function mapRoofCoveringMaterial(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("built up")) {
    return "Built-Up Roof";
  }
  if (text.includes("modified bitumen")) {
    return "Modified Bitumen";
  }
  if (text.includes("tpo")) {
    return "TPO Membrane";
  }
  if (text.includes("epdm")) {
    return "EPDM Membrane";
  }
  if (text.includes("metal")) {
    if (text.includes("standing")) {
      return "Metal Standing Seam";
    }
    return "Metal Corrugated";
  }
  if (text.includes("shingle") && text.includes("architectural")) {
    return "Architectural Asphalt Shingle";
  }
  if (text.includes("shingle")) {
    return "3-Tab Asphalt Shingle";
  }
  if (text.includes("clay")) {
    return "Clay Tile";
  }
  if (text.includes("concrete tile")) {
    return "Concrete Tile";
  }
  if (text.includes("slate")) {
    if (text.includes("synthetic")) {
      return "Synthetic Slate";
    }
    return "Natural Slate";
  }
  if (text.includes("wood shake")) {
    return "Wood Shake";
  }
  if (text.includes("wood shingle")) {
    return "Wood Shingle";
  }
  if (text.includes("green roof")) {
    return "Green Roof System";
  }
  if (text.includes("solar")) {
    return "Solar Integrated Tiles";
  }
  return null;
}

function mapFlooringMaterialPrimary(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("carpet")) {
    return "Carpet";
  }
  if (text.includes("hardwood")) {
    if (text.includes("engineered")) return "Engineered Hardwood";
    return "Solid Hardwood";
  }
  if (text.includes("vinyl plank") || text.includes("lvp")) {
    return "Luxury Vinyl Plank";
  }
  if (text.includes("vinyl")) {
    return "Sheet Vinyl";
  }
  if (text.includes("tile")) {
    if (text.includes("porcelain")) return "Porcelain Tile";
    if (text.includes("stone")) return "Natural Stone Tile";
    return "Ceramic Tile";
  }
  if (text.includes("laminate")) {
    return "Laminate";
  }
  if (text.includes("bamboo")) {
    return "Bamboo";
  }
  if (text.includes("cork")) {
    return "Cork";
  }
  if (text.includes("linoleum")) {
    return "Linoleum";
  }
  if (text.includes("terrazzo")) {
    return "Terrazzo";
  }
  if (text.includes("epoxy")) {
    return "Epoxy Coating";
  }
  if (text.includes("concrete")) {
    return "Polished Concrete";
  }
  return null;
}

function mapInteriorWallFinishPrimary(raw) {
  const text = normalizeText(raw);
  if (!text) return null;

  if (text.includes("primer") && text.includes("paint")) {
    return "Primer and Paint";
  }
  if (text.includes("paint")) {
    return "Paint";
  }
  if (text.includes("textured")) {
    return "Textured Paint";
  }
  if (text.includes("stain")) {
    return "Stain";
  }
  if (text.includes("clear coat")) {
    return "Clear Coat";
  }
  if (text.includes("natural finish")) {
    return "Natural Finish";
  }
  if (text.includes("exposed")) {
    return "Exposed Natural";
  }
  return null;
}

function getSubAreaMetrics($, $panel) {
  const result = {
    finishedBaseArea: null,
    finishedUpperStoryArea: null,
    unfinishedBaseArea: null,
  };

  const table = $panel
    .find("table.table-bordered")
    .filter((_, tbl) => {
      const header = $(tbl).find("thead th").first().text().trim().toLowerCase();
      return header.includes("sub area");
    })
    .first();

  if (!table.length) return result;

  let finishedBase = 0;
  let finishedUpper = 0;
  let unfinishedBase = 0;

  table.find("tbody tr").each((_, row) => {
    const $row = $(row);
    const label = ($row.find("td").eq(0).text() || "").trim();
    const labelLower = label.toLowerCase();
    if (!label || labelLower.includes("total area sf")) {
      return;
    }

    const heated = parseIntSafe($row.find("td").eq(1).text().trim());
    const gross = parseIntSafe($row.find("td").eq(2).text().trim());
    const area = heated != null && heated > 0 ? heated : gross;
    if (area == null || area === 0) {
      return;
    }

    if (labelLower.includes("upper") && labelLower.includes("story")) {
      finishedUpper += area;
      return;
    }

    if (labelLower.includes("utility unfinished") || labelLower.includes("(utu)") || labelLower.includes("unfinished")) {
      unfinishedBase += area;
      return;
    }

    if (labelLower.includes("base")) {
      finishedBase += area;
    }
  });

  result.finishedBaseArea = finishedBase > 0 ? finishedBase : null;
  result.finishedUpperStoryArea = finishedUpper > 0 ? finishedUpper : null;
  result.unfinishedBaseArea = unfinishedBase > 0 ? unfinishedBase : null;
  return result;
}

function buildStructures($, strap) {
  const structures = [];

  $("div.panel-body[id^='structural_']").each((idx, panelEl) => {
    const $panel = $(panelEl);
    const buildingNumber = idx + 1;

    const foundationRaw = getStructuralValue($, $panel, "Foundation");
    const exteriorRaw = getStructuralValue($, $panel, "Exterior Walls");
    const unitStoriesRaw = getStructuralValue($, $panel, "Unit Stories");
    const roofFrameRaw = getStructuralValue($, $panel, "Roof Frame");
    const roofCoverRaw = getStructuralValue($, $panel, "Roof Cover");
    const floorFinishRaw = getStructuralValue($, $panel, "Floor Finish");
    const interiorFinishRaw = getStructuralValue($, $panel, "Interior Finish");

    const { finishedBaseArea, finishedUpperStoryArea, unfinishedBaseArea } = getSubAreaMetrics($, $panel);

    const structure = {
      request_identifier: strap,
      source_http_request: {
        method: "GET",
        url: `https://www.pcpao.gov/property-details?s=${strap}`,
      },
      building_number: buildingNumber,
      foundation_type: mapFoundationType(foundationRaw),
      exterior_wall_material_primary: mapExteriorWallPrimary(exteriorRaw),
      exterior_wall_material_secondary: mapExteriorWallSecondary(exteriorRaw),
      number_of_stories: mapNumberOfStories(unitStoriesRaw),
      roof_design_type: mapRoofDesignType(roofFrameRaw),
      roof_covering_material: mapRoofCoveringMaterial(roofCoverRaw),
      flooring_material_primary: mapFlooringMaterialPrimary(floorFinishRaw),
      interior_wall_finish_primary: mapInteriorWallFinishPrimary(interiorFinishRaw),
      finished_base_area: finishedBaseArea,
      finished_upper_story_area: finishedUpperStoryArea,
      unfinished_base_area: unfinishedBaseArea,
    };

    structures.push(structure);
  });

  return structures;
}

(function main() {
  try {
    const rawHtml = fs.readFileSync("input.html", "utf8");
    const $ = cheerio.load(rawHtml);

    const strap = extractStrap($, rawHtml);
    const structures = buildStructures($, strap);

    const outDir = path.join("owners");
    ensureDir(outDir);
    const outPath = path.join(outDir, "structure_data.json");

    const key = `property_${strap}`;
    const payload = {};
    payload[key] = { structures };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote structure data for ${key} to ${outPath}`);
  } catch (err) {
    console.error("Error building structure data:", err);
    process.exit(1);
  }
})();
