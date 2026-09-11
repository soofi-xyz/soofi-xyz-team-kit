// Layout mapping script
// Reads input.html, parses with cheerio, and writes owners/layout_data.json per schema

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

function main() {
  const html = readInputHtml();
  const $ = cheerio.load(html);

  const altKeyCell = $('td.property_field:contains("Alternate Key:")').first();
  const altKey =
    textNormalize(altKeyCell.next("td.property_item").text()) || null;
  const propKey = altKey ? `property_${altKey}` : "property_unknown";

  const layouts = [];

  // Extract counts
  const summaryTable = $(".property_building_summary").first();
  let bedrooms = 0,
    fullBaths = 0,
    halfBaths = 0,
    totalLivingArea = null;

  summaryTable.find("td").each((i, el) => {
    const tx = textNormalize($(el).text());
    if (/Bedrooms:/i.test(tx)) bedrooms = toInt(tx) || 0;
    if (/Full Bathrooms:/i.test(tx)) fullBaths = toInt(tx) || 0;
    if (/Half Bathrooms:/i.test(tx)) halfBaths = toInt(tx) || 0;
    if (/Total Living Area:/i.test(tx)) totalLivingArea = toInt(tx);
  });

  // Assume all spaces are on 1st Floor unless otherwise stated
  const defaultFloor = "1st Floor";

  // Track space type counters for space_type_index
  const spaceTypeCounters = {};
  const getNextSpaceTypeIndex = (spaceType) => {
    if (!spaceTypeCounters[spaceType]) {
      spaceTypeCounters[spaceType] = 0;
    }
    spaceTypeCounters[spaceType]++;
    return `1.${spaceTypeCounters[spaceType]}`;
  };

  let overallIndex = 0;

  // Create bedrooms
  for (let i = 1; i <= bedrooms; i++) {
    overallIndex++;
    layouts.push({
      space_type: "Bedroom",
      space_index: overallIndex,
      space_type_index: getNextSpaceTypeIndex("Bedroom"),
      flooring_material_type: null,
      size_square_feet: null,
      floor_level: defaultFloor,
      has_windows: null,
      window_design_type: null,
      window_material_type: null,
      window_treatment_type: null,
      is_finished: true,
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
      is_exterior: false,
      pool_condition: null,
      pool_surface_type: null,
      pool_water_quality: null,
    });
  }

  // Create full bathrooms
  for (let i = 1; i <= fullBaths; i++) {
    overallIndex++;
    layouts.push({
      space_type: "Full Bathroom",
      space_index: overallIndex,
      space_type_index: getNextSpaceTypeIndex("Full Bathroom"),
      flooring_material_type: null,
      size_square_feet: null,
      floor_level: defaultFloor,
      has_windows: null,
      window_design_type: null,
      window_material_type: null,
      window_treatment_type: null,
      is_finished: true,
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
      is_exterior: false,
      pool_condition: null,
      pool_surface_type: null,
      pool_water_quality: null,
    });
  }

  // Create half bathrooms
  for (let i = 1; i <= halfBaths; i++) {
    overallIndex++;
    layouts.push({
      space_type: "Half Bathroom / Powder Room",
      space_index: overallIndex,
      space_type_index: getNextSpaceTypeIndex("Half Bathroom / Powder Room"),
      flooring_material_type: null,
      size_square_feet: null,
      floor_level: defaultFloor,
      has_windows: null,
      window_design_type: null,
      window_material_type: null,
      window_treatment_type: null,
      is_finished: true,
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
      is_exterior: false,
      pool_condition: null,
      pool_surface_type: null,
      pool_water_quality: null,
    });
  }

  // Optionally add a Great Room / Living area placeholder using total living area (not room size)
  if (totalLivingArea) {
    overallIndex++;
    layouts.push({
      space_type: "Living Room",
      space_index: overallIndex,
      space_type_index: getNextSpaceTypeIndex("Living Room"),
      flooring_material_type: null,
      size_square_feet: null,
      floor_level: defaultFloor,
      has_windows: null,
      window_design_type: null,
      window_material_type: null,
      window_treatment_type: null,
      is_finished: true,
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
      is_exterior: false,
      pool_condition: null,
      pool_surface_type: null,
      pool_water_quality: null,
    });
  }

  const outDir = path.join(process.cwd(), "owners");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "layout_data.json");

  const payload = {};
  payload[propKey] = { layouts };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} for ${propKey} with ${layouts.length} layouts`);
}

try {
  main();
} catch (err) {
  console.error("Error in layoutMapping:", err.message);
  process.exit(1);
}
