// Structure mapping script
// Parses input.html, extracts per-building structure data (Elephant schema),
// and writes owners/structure_data.json

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const REQUIRED_STRUCTURE_FIELDS = [
  "source_http_request",
  "request_identifier",
  "architectural_style_type",
  "attachment_type",
  "exterior_wall_material_primary",
  "exterior_wall_material_secondary",
  "exterior_wall_condition",
  "exterior_wall_insulation_type",
  "flooring_material_primary",
  "flooring_material_secondary",
  "subfloor_material",
  "flooring_condition",
  "interior_wall_structure_material",
  "interior_wall_surface_material_primary",
  "interior_wall_surface_material_secondary",
  "interior_wall_finish_primary",
  "interior_wall_finish_secondary",
  "interior_wall_condition",
  "roof_covering_material",
  "roof_underlayment_type",
  "roof_structure_material",
  "roof_design_type",
  "roof_condition",
  "roof_age_years",
  "gutters_material",
  "gutters_condition",
  "roof_material_type",
  "foundation_type",
  "foundation_material",
  "foundation_waterproofing",
  "foundation_condition",
  "ceiling_structure_material",
  "ceiling_surface_material",
  "ceiling_insulation_type",
  "ceiling_height_average",
  "ceiling_condition",
  "exterior_door_material",
  "interior_door_material",
  "window_frame_material",
  "window_glazing_type",
  "window_operation_type",
  "window_screen_material",
  "primary_framing_material",
  "secondary_framing_material",
  "structural_damage_indicators",
];

const FRAME_TYPE_MAPPINGS = [
  {
    value: "Steel Frame",
    matchers: [/steel/i, /metal\s*frame/i, /open\s*steel/i],
  },
  {
    value: "Concrete Block",
    matchers: [/(concrete\s*block|cmu|block\b|cb\b)/i],
  },
  {
    value: "Poured Concrete",
    matchers: [/(poured|cast\s*in\s*place)/i],
  },
  {
    value: "Masonry",
    matchers: [/masonry/i, /brick/i, /stone/i, /solid\s*wall/i],
  },
  {
    value: "Engineered Lumber",
    matchers: [/engineered/i, /lvl/i, /psl/i, /glulam/i],
  },
  {
    value: "Post and Beam",
    matchers: [/(post|beam)/i, /timber\s*frame/i],
  },
  {
    value: "Log Construction",
    matchers: [/log/i, /hand\s*hewn/i],
  },
  {
    value: "Wood Frame",
    matchers: [/wood\b/i, /timber/i, /stud\s*wall/i, /stick\s*built/i],
  },
];

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIntSafe(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^0-9-]/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabel(label) {
  return cleanText(label).toLowerCase().replace(/[:]/g, "");
}

function extractValueFromStrong($, strongEl) {
  const $strong = $(strongEl);
  const $columnWrapper = $strong.closest("div");
  if ($columnWrapper.length > 0) {
    const siblingValue = $columnWrapper
      .nextAll()
      .filter((_, sibling) => $(sibling).find("strong").length === 0)
      .map((_, sibling) => cleanText($(sibling).text()))
      .get()
      .find((text) => text.length > 0);
    if (siblingValue) return siblingValue;
  }

  const parentNextValue = $strong
    .parent()
    .nextAll()
    .map((_, sibling) => cleanText($(sibling).text()))
    .get()
    .find((text) => text.length > 0);
  if (parentNextValue) return parentNextValue;

  const $tableCell = $strong.closest("td");
  if ($tableCell.length > 0) {
    const tableValue = $tableCell
      .nextAll("td")
      .map((_, sibling) => cleanText($(sibling).text()))
      .get()
      .find((text) => text.length > 0);
    if (tableValue) return tableValue;
  }

  const parentText = cleanText($strong.parent().text());
  const labelText = cleanText($strong.text());
  if (parentText.length > labelText.length) {
    const remainder = cleanText(parentText.replace(labelText, ""));
    if (remainder) return remainder.replace(/^[:\s]+/, "");
  }

  return null;
}

function findValueByLabel($, label) {
  const target = normalizeLabel(label);
  let value = null;
  let found = false;

  $("strong").each((_, strongEl) => {
    if (found) return false;
    const candidate = normalizeLabel($(strongEl).text());
    if (candidate === target) {
      value = extractValueFromStrong($, strongEl);
      found = true;
      return false;
    }
    return undefined;
  });

  if (found) return value;

  $("div, td, th").each((_, node) => {
    if (value) return;
    const nodeText = normalizeLabel($(node).text());
    if (nodeText === target) {
      const siblingValue = $(node)
        .nextAll()
        .map((__, sibling) => cleanText($(sibling).text()))
        .get()
        .find((text) => text.length > 0);
      if (siblingValue) value = siblingValue;
    }
  });

  return value;
}

function getAltKey($) {
  let altkey = $("input#altkey").val();
  if (!altkey) {
    $("div.col-sm-5").each((_, el) => {
      const labelText = cleanText($(el).text());
      if (/alternate key/i.test(labelText)) {
        const valueText = cleanText($(el).next().text());
        if (valueText) altkey = valueText.replace(/[^0-9]/g, "");
      }
    });
  }
  return altkey ? String(altkey) : null;
}

function getParcelId($) {
  const parcel = findValueByLabel($, "Parcel ID");
  return parcel ? parcel.replace(/[^0-9]/g, "") : null;
}

function extractBuildingCards($) {
  const cardsByIndex = new Map();
  $("h5").each((_, headingEl) => {
    const $heading = $(headingEl);
    const text = cleanText($heading.text());
    const match = text.match(/Card\s*\(Bldg\)\s*#\s*(\d+)/i);
    if (!match) return;
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index)) return;

    const sectionNodes = [];
    let $cursor = $heading.next();
    while ($cursor.length > 0) {
      const cursorText = cleanText($cursor.text());
      if ($cursor.is("h5") && /Card\s*\(Bldg\)\s*#/i.test(cursorText)) break;
      sectionNodes.push($cursor);
      $cursor = $cursor.next();
    }

    if (!cardsByIndex.has(index)) {
      cardsByIndex.set(index, {
        buildingIndex: index,
        heading: $heading,
        sectionNodes,
      });
    }
  });
  return Array.from(cardsByIndex.values()).sort(
    (a, b) => a.buildingIndex - b.buildingIndex,
  );
}

function findValueWithinSection($, sectionNodes, label) {
  const target = normalizeLabel(label);
  for (const $section of sectionNodes) {
    let resolved = null;
    $section.find("strong").each((_, strongEl) => {
      const candidate = normalizeLabel($(strongEl).text());
      if (candidate === target && resolved == null) {
        const value = extractValueFromStrong($, strongEl);
        if (value) {
          resolved = value;
          return false;
        }
      }
      return undefined;
    });
    if (resolved != null) return resolved;
  }
  return null;
}

function extractSummaryRows($, sectionNodes) {
  const rows = [];
  sectionNodes.forEach(($section) => {
    const hasSummaryHeading = $section
      .find("strong")
      .toArray()
      .some((strongEl) => /summary of/i.test(cleanText($(strongEl).text())));
    if (!hasSummaryHeading) return;

    const $table = $section.find("table").first();
    if (!$table.length) return;

    $table.find("tbody tr").each((_, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.find("td");
      if (cells.length < 7) return;

      const fromToFloors = cleanText(cells.eq(1).text());
      const finishText = cleanText(cells.eq(2).text());
      const stories = parseIntSafe(cells.eq(3).text());
      const area = parseIntSafe(cells.eq(4).text());
      const totalArea = parseIntSafe(cells.eq(5).text());
      const businessArea = parseIntSafe(cells.eq(6).text());

      rows.push({
        fromToFloors,
        finishText,
        stories,
        area,
        totalArea,
        businessArea,
      });
    });
  });
  return rows;
}

function parseStoriesFromFloors(fromToFloors) {
  if (!fromToFloors) return null;
  const match = fromToFloors.match(/(\d+)\s*-\s*(\d+)/);
  if (match) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start + 1;
    }
  }
  const single = parseIntSafe(fromToFloors);
  return single != null ? single : null;
}

function computeStructureMetrics(rows) {
  if (!rows.length) {
    return {
      finishedBaseArea: null,
      finishedUpperArea: null,
      numberOfStories: null,
    };
  }
  const interiorRows = rows.filter((row) => row.businessArea != null);
  const targetRows = interiorRows.length ? interiorRows : rows;

  const finishedBaseArea = targetRows.reduce(
    (sum, row) => sum + (row.area ?? 0),
    0,
  );
  const finishedUpperArea = targetRows.reduce((sum, row) => {
    const area = row.area ?? 0;
    const total = row.totalArea ?? 0;
    return sum + Math.max(total - area, 0);
  }, 0);

  let numberOfStories = null;
  targetRows.forEach((row) => {
    const candidate = row.stories ?? parseStoriesFromFloors(row.fromToFloors);
    if (candidate && (numberOfStories == null || candidate > numberOfStories)) {
      numberOfStories = candidate;
    }
  });

  return {
    finishedBaseArea: finishedBaseArea > 0 ? finishedBaseArea : null,
    finishedUpperArea: finishedUpperArea > 0 ? finishedUpperArea : null,
    numberOfStories: numberOfStories ?? null,
  };
}

function mapPrimaryFramingMaterial(structureCodeText) {
  if (!structureCodeText) return null;
  for (const mapping of FRAME_TYPE_MAPPINGS) {
    if (mapping.matchers.some((regex) => regex.test(structureCodeText))) {
      return mapping.value;
    }
  }
  return null;
}

function parseBuiltYear(raw) {
  if (!raw) return null;
  const match = String(raw).match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function createBaseStructureEntry() {
  const base = {};
  REQUIRED_STRUCTURE_FIELDS.forEach((field) => {
    base[field] = null;
  });
  return base;
}

function buildStructureEntry($, card) {
  const summaryRows = extractSummaryRows($, card.sectionNodes);
  const metrics = computeStructureMetrics(summaryRows);
  const structureCodeText = findValueWithinSection(
    $,
    card.sectionNodes,
    "Structure Code",
  );
  const builtYearText = findValueWithinSection(
    $,
    card.sectionNodes,
    "Built / Effective Year",
  );
  const builtYear = parseBuiltYear(builtYearText);
  const currentYear = new Date().getFullYear();
  const primaryFraming = mapPrimaryFramingMaterial(structureCodeText);

  const entry = createBaseStructureEntry();
  entry.building_number = card.buildingIndex;
  entry.number_of_stories = metrics.numberOfStories;
  entry.finished_base_area = metrics.finishedBaseArea;
  entry.finished_upper_story_area = metrics.finishedUpperArea;
  entry.primary_framing_material = primaryFraming;
  entry.roof_date = builtYear ? String(builtYear) : null;
  entry.roof_age_years =
    builtYear != null ? Math.max(currentYear - builtYear, 0) : null;

  return entry;
}

function main() {
  const inputArg = process.argv[2];
  const inputPath = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : path.join(process.cwd(), "input.html");
  const html = fs.readFileSync(inputPath, "utf8");
  const $ = cheerio.load(html);

  const altkey = getAltKey($);
  const parcelId = getParcelId($);
  const buildingCount = parseIntSafe(findValueByLabel($, "Building Count"));

  const cards = extractBuildingCards($);
  
  let structures = [];
  if (cards.length > 0) {
    structures = cards
      .map((card) => buildStructureEntry($, card))
      .filter((entry) => entry && Object.keys(entry).length > 0);
  }

  if (!structures.length) {
    console.warn("No building structures detected; writing empty array.");
  }

  const key = parcelId
    ? `property_${parcelId}`
    : altkey
      ? `property_${altkey}`
      : null;

  if (!key) {
    throw new Error("Unable to determine property identifier for structure data.");
  }

  const outDir = path.join(process.cwd(), "owners");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "structure_data.json");
  const payload = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : {};

  const record = { structures };
  if (buildingCount != null) {
    record.number_of_buildings = buildingCount;
  }
  payload[key] = record;

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}