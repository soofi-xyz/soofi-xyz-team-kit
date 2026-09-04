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

function getSubAreaTotals($, $panel) {
  const table = $panel
    .find("table.table-bordered")
    .filter((_, tbl) => {
      const header = $(tbl).find("thead th").first().text().trim().toLowerCase();
      return header.includes("sub area");
    })
    .first();

  if (!table.length) return { heated: null, gross: null, livable: null };

  const headers = table
    .find("thead th")
    .map((_, th) => $(th).text().trim().toLowerCase())
    .get();

  const heatedIdx = headers.findIndex((text) => text.includes("heated"));
  const grossIdx = headers.findIndex((text) => text.includes("gross"));
  const livingIdx = headers.findIndex((text) => text.includes("living"));

  const totalRow = table
    .find("tbody tr")
    .filter((_, tr) => {
      const key = $(tr).find("td").first().text().trim().toLowerCase();
      return key.startsWith("total area sf");
    })
    .first();

  if (!totalRow.length) return { heated: null, gross: null, livable: null };

  const getValue = (idx) => {
    if (idx < 0) return null;
    return parseIntSafe(totalRow.find("td").eq(idx).text().trim());
  };

  const heated = getValue(heatedIdx >= 0 ? heatedIdx : 1);
  const gross = getValue(grossIdx >= 0 ? grossIdx : 2);
  let livable = getValue(livingIdx);
  if (livable == null) {
    livable = heated;
  }

  return { heated, gross, livable };
}

function createLayoutEntry({
  space_type,
  space_type_index,
  building_number = null,
  built_year = null,
  heated_area_sq_ft = null,
  total_area_sq_ft = null,
  livable_area_sq_ft = null,
  size_square_feet = null,
  is_finished = null,
  is_exterior = null,
}) {
  return {
    space_type,
    space_type_index,
    building_number,
    built_year,
    heated_area_sq_ft,
    total_area_sq_ft,
    livable_area_sq_ft,
    size_square_feet,
    flooring_material_type: null,
    floor_level: null,
    has_windows: null,
    window_design_type: null,
    window_material_type: null,
    window_treatment_type: null,
    is_finished,
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
    is_exterior,
    pool_condition: null,
    pool_surface_type: null,
    pool_water_quality: null,
  };
}

function buildLayouts($) {
  const layouts = [];

  $("div.panel-body[id^='structural_']").each((idx, panelEl) => {
    const $panel = $(panelEl);
    const buildingNumber = idx + 1;

    const builtYear = parseIntSafe(getStructuralValue($, $panel, "Year Built")) || null;
    const livingUnits = parseIntSafe(getStructuralValue($, $panel, "Living Units")) || 0;
    const { heated, gross, livable } = getSubAreaTotals($, $panel);

    layouts.push(
      createLayoutEntry({
        space_type: "Building",
        space_type_index: String(buildingNumber),
        building_number: buildingNumber,
        built_year: builtYear,
        heated_area_sq_ft: heated,
        total_area_sq_ft: gross,
        livable_area_sq_ft: livable,
        size_square_feet: null,
        is_finished: null,
        is_exterior: null,
      })
    );

    for (let unit = 1; unit <= livingUnits; unit += 1) {
      layouts.push(
        createLayoutEntry({
          space_type: "Living Area",
          space_type_index: `${buildingNumber}.${unit}`,
          building_number: buildingNumber,
          built_year: builtYear,
          heated_area_sq_ft: null,
          total_area_sq_ft: null,
          livable_area_sq_ft: null,
          size_square_feet: null,
          is_finished: null,
          is_exterior: null,
        })
      );
    }
  });

  return layouts;
}

(function main() {
  try {
    const rawHtml = fs.readFileSync("input.html", "utf8");
    const $ = cheerio.load(rawHtml);

    const strap = extractStrap($, rawHtml);
    const layouts = buildLayouts($);

    const outDir = path.join("owners");
    ensureDir(outDir);
    const outPath = path.join(outDir, "layout_data.json");

    const key = `property_${strap}`;
    const payload = {};
    payload[key] = { layouts };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`Wrote layout data for ${key} to ${outPath}`);
  } catch (err) {
    console.error("Error building layout data:", err);
    process.exit(1);
  }
})();
