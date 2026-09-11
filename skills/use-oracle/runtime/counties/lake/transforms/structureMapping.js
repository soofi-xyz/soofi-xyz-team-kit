// Structure mapping script
// Reads input.html, parses with cheerio, and writes owners/structure_data.json per schema

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function readInputHtml() {
  const inputPath = path.join(process.cwd(), "input.html");
  return fs.readFileSync(inputPath, "utf8");
}

function textNormalize(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function toInt(val) {
  if (val == null) return null;
  const n = parseInt(String(val).replace(/[^0-9.-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function mapExteriorWallMaterialPrimary(extWallText) {
  const t = (extWallText || "").toUpperCase();
  if (!t) return null;
  // The page shows: BRICK/BLOCK STUCCO OR SIDING (03)
  if (t.includes("STUCCO")) return "Stucco";
  if (t.includes("BRICK")) return "Brick";
  if (t.includes("STONE")) return "Natural Stone";
  if (t.includes("VINYL")) return "Vinyl Siding";
  if (t.includes("WOOD")) return "Wood Siding";
  if (t.includes("BLOCK") || t.includes("CONCRETE")) return "Concrete Block";
  return null;
}

function mapPrimaryFramingMaterial(extWallText) {
  const t = (extWallText || "").toUpperCase();
  if (t.includes("BLOCK") || t.includes("CONCRETE")) return "Concrete Block";
  if (t.includes("WOOD")) return "Wood Frame";
  if (t.includes("MASONRY") || t.includes("BRICK") || t.includes("STONE"))
    return "Masonry";
  return null;
}

function main() {
  const html = readInputHtml();
  const $ = cheerio.load(html);

  // Extract Alternate Key
  const altKeyCell = $('td.property_field:contains("Alternate Key:")').first();
  const altKey =
    textNormalize(altKeyCell.next("td.property_item").text()) || null;
  const propKey = altKey ? `property_${altKey}` : "property_unknown";

  // Extract building summary info
  const summaryTable = $(".property_building_summary").first();
  const summaryText = textNormalize(summaryTable.text());
  // Central A/C
  let hasCentralAC = null;
  const acCell = summaryTable
    .find("td")
    .filter((i, el) => /Central A\/C:/i.test($(el).text()))
    .first();
  if (acCell.length) {
    const acText = textNormalize(acCell.text());
    if (/Central A\/C:\s*Yes/i.test(acText)) hasCentralAC = true;
    else if (/Central A\/C:\s*No/i.test(acText)) hasCentralAC = false;
  }

  // Bedrooms, Full, Half baths
  let bedrooms = null,
    fullBaths = null,
    halfBaths = null;
  summaryTable.find("td").each((i, el) => {
    const tx = textNormalize($(el).text());
    if (/Bedrooms:/i.test(tx)) bedrooms = toInt(tx);
    if (/Full Bathrooms:/i.test(tx)) fullBaths = toInt(tx);
    if (/Half Bathrooms:/i.test(tx)) halfBaths = toInt(tx);
  });

  // Sections table: exterior wall type and number of stories (from FLA row)
  const sectionsTable = $("#cphMain_repResidential_gvBuildingSections_0");
  let extWallRaw = null;
  let numberOfStories = null;
  if (sectionsTable.length) {
    const firstDataRow = sectionsTable.find("tr").eq(1); // row after header
    const cols = firstDataRow.find("td");
    if (cols.length >= 4) {
      extWallRaw = textNormalize($(cols[1]).text());
      numberOfStories = toInt($(cols[2]).text());
    }
  }

  const exteriorPrimary = mapExteriorWallMaterialPrimary(extWallRaw);
  const primaryFrame = mapPrimaryFramingMaterial(extWallRaw);

  // Build structure object adhering to schema with nulls for unknowns
  const structure = {
    architectural_style_type: null,
    attachment_type: "Detached",
    ceiling_condition: null,
    ceiling_height_average: null,
    ceiling_insulation_type: null,
    ceiling_structure_material: null,
    ceiling_surface_material: null,
    exterior_door_material: null,
    exterior_wall_condition: null,
    exterior_wall_condition_primary: null,
    exterior_wall_condition_secondary: null,
    exterior_wall_insulation_type: "Unknown",
    exterior_wall_insulation_type_primary: "Unknown",
    exterior_wall_insulation_type_secondary: "Unknown",
    exterior_wall_material_primary: exteriorPrimary || null,
    exterior_wall_material_secondary: null,
    finished_base_area: null,
    finished_basement_area: null,
    finished_upper_story_area: null,
    flooring_condition: null,
    flooring_material_primary: null,
    flooring_material_secondary: null,
    foundation_condition: null,
    foundation_material: null,
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
    number_of_stories: Number.isFinite(numberOfStories)
      ? numberOfStories
      : null,
    primary_framing_material: primaryFrame || null,
    roof_age_years: null,
    roof_condition: null,
    roof_covering_material: null,
    roof_date: null,
    roof_design_type: null,
    roof_material_type: null,
    roof_structure_material: null,
    roof_underlayment_type: null,
    secondary_framing_material: null,
    structural_damage_indicators: null,
    subfloor_material: null,
    unfinished_base_area: null,
    unfinished_basement_area: null,
    unfinished_upper_story_area: null,
    window_frame_material: null,
    window_glazing_type: null,
    window_operation_type: null,
    window_screen_material: null,
  };

  // Sanity: attachment_type - prefer Detached for single-family use if land use indicates
  // The page shows Land Use: SINGLE FAMILY (0100) which typically implies detached dwelling.

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "structure_data.json");

  const payload = {};
  payload[propKey] = structure;

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} for ${propKey}`);
}

try {
  main();
} catch (err) {
  console.error("Error in structureMapping:", err.message);
  process.exit(1);
}
