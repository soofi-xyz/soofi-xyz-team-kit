// Layout mapping script
// Reads input.html, parses with cheerio, and writes owners/layout_data.json per schema

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

/** @typedef {import("cheerio").CheerioAPI} CheerioAPI */
/** @typedef {import("cheerio").Element} CheerioElement */
/** @typedef {import("cheerio").Cheerio<CheerioElement>} CheerioCollection */

/**
 * Represents a layout entry in the generated payload (building, floor, or interior space).
 * @typedef {Object} LayoutEntry
 * @property {string} space_type - Descriptive type of the space (e.g. Building, Bedroom, Office).
 * @property {number} space_index - Sequential index of the space within the exported structure.
 * @property {number|string|null} space_type_index - Index within a specific space type grouping.
 * @property {string|null} building_number - Building identifier when part of a multi-building property.
  * @property {string|null} flooring_material_type - Flooring material description if known.
 * @property {number|null} size_square_feet - Primary size metric for the space when available.
 * @property {number|null} total_area_sq_ft - Total enclosed area represented by this layout entry.
 * @property {number|null} livable_area_sq_ft - Habitable or business area associated with the space.
 * @property {boolean|null} has_windows - Whether the space includes windows.
 * @property {string|null} window_design_type - Window design descriptor if known.
 * @property {string|null} window_material_type - Window material descriptor if known.
 * @property {string|null} window_treatment_type - Window treatment descriptor if known.
 * @property {boolean|null} is_finished - Whether the space is considered finished.
 * @property {string|null} furnished - Furnishing level descriptor if available.
 * @property {string|null} paint_condition - Paint condition descriptor if available.
 * @property {string|null} flooring_wear - Flooring wear descriptor if available.
 * @property {string|null} clutter_level - Clutter level descriptor if available.
 * @property {string|null} visible_damage - Visible damage notes if available.
 * @property {string|null} countertop_material - Countertop material descriptor if available.
 * @property {string|null} cabinet_style - Cabinet style descriptor if available.
 * @property {string|null} fixture_finish_quality - Fixture quality descriptor if available.
 * @property {string|null} design_style - Interior design style descriptor if available.
 * @property {string|null} natural_light_quality - Natural light descriptor if available.
 * @property {string|null} decor_elements - Decor descriptor if available.
 * @property {string|null} pool_type - Pool type descriptor if applicable.
 * @property {string|null} pool_equipment - Pool equipment descriptor if applicable.
 * @property {string|null} spa_type - Spa type descriptor if applicable.
 * @property {string|null} safety_features - Safety feature descriptor if applicable.
 * @property {string|null} view_type - View descriptor if applicable.
 * @property {string|null} lighting_features - Lighting description if available.
 * @property {string|null} condition_issues - Condition issues if captured.
 * @property {boolean|null} is_exterior - Whether the space is exterior.
 * @property {string|null} pool_condition - Pool condition descriptor if applicable.
 * @property {string|null} pool_surface_type - Pool surface type descriptor if applicable.
 * @property {string|null} pool_water_quality - Pool water quality descriptor if applicable.
 */

/**
 * Represents a collection of layout entries for an individual building.
 * @typedef {Object} BuildingLayoutGroup
 * @property {number} building_index - Numeric identifier derived from the appraisal site.
 * @property {LayoutEntry} building_layout - Layout metadata describing the building shell.
 * @property {LayoutEntry[]} interior_layouts - Interior layouts (rooms, sections, floors) associated with the building.
 */

/**
 * Metadata describing how a building addition maps onto an Elephant layout.
 * @typedef {Object} AdditionLayoutMetadata
 * @property {string} spaceType - Elephant-compliant `layout.space_type` value.
 * @property {boolean} isExterior - Whether the addition is exterior to the primary structure.
 * @property {boolean} isFinished - Whether the addition is a finished space.
 */

/**
 * Counts of bathrooms grouped by fixture count classifications.
 * @typedef {Object} FixtureCounts
 * @property {number} twoFixture
 * @property {number} threeFixture
 * @property {number} fourFixture
 * @property {number} fiveFixture
 * @property {number} sixFixture
 * @property {number} sevenFixture
 */

/**
 * Collapse whitespace and strip redundant characters from text content.
 * @param {string} value - Raw text to clean.
 * @returns {string} Cleaned, single-line text.
 */
function cleanText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Normalizes label text for case-insensitive lookups.
 * @param {string} label - Label text to normalize.
 * @returns {string} Normalized comparison key.
 */
function normalizeLabel(label) {
  return cleanText(label)
    .toLowerCase()
    .replace(/[:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert text to a Title Case style for readability.
 * @param {string} value - Raw text value.
 * @returns {string} Title-cased text.
 */
function toTitleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Create a base layout entry with defaulted nullable fields.
 * @param {string} spaceType - Layout space type descriptor.
 * @returns {LayoutEntry} Layout entry with default values.
 */
function createBaseLayoutEntry(spaceType) {
  return {
    space_type: spaceType,
    space_type_index: null,
    building_number: null,
    flooring_material_type: null,
    size_square_feet: null,
    total_area_sq_ft: null,
    livable_area_sq_ft: null,
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
  };
}

/**
 * Represents a parsed row from the "Summary of Commercial Sections Data" table.
 * @typedef {Object} SectionLayoutRow
 * @property {string} descriptor - Raw Section Finish descriptor text.
 * @property {LayoutEntry} layout - Base layout entry populated with size/area values.
 */

/**
 * Extract the alternate key (property identifier) from the document.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {string|null} Alternate key string or null when absent.
 */
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

/**
 * Attempt to locate the textual value that corresponds with a provided <strong> label element.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @param {CheerioElement} strongEl - Matching <strong> element.
 * @returns {string|null} Associated textual value when found.
 */
function extractValueFromStrong($, strongEl) {
  const $strong = $(strongEl);

  // Preferred structure: label/value columns within the same row.
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

  // Fallback: next siblings of the label's parent node.
  const parentNextValue = $strong
    .parent()
    .nextAll()
    .map((_, sibling) => cleanText($(sibling).text()))
    .get()
    .find((text) => text.length > 0);
  if (parentNextValue) return parentNextValue;

  // Table layout: fetch from the next table cell(s).
  const $tableCell = $strong.closest("td");
  if ($tableCell.length > 0) {
    const tableValue = $tableCell
      .nextAll("td")
      .map((_, sibling) => cleanText($(sibling).text()))
      .get()
      .find((text) => text.length > 0);
    if (tableValue) return tableValue;
  }

  // Inline layout: remove label text from parent to reveal value.
  const parentText = cleanText($strong.parent().text());
  const labelText = cleanText($strong.text());
  if (parentText.length > labelText.length) {
    const remainder = cleanText(parentText.replace(labelText, ""));
    if (remainder) return remainder.replace(/^[:\s]+/, "");
  }

  return null;
}

/**
 * Locate a textual value by matching the associated label text.
 * Works for layouts where the label resides inside a <strong> element.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @param {string} label - Label to locate (case-insensitive).
 * @returns {string|null} Matching value or null when not found.
 */
function findValueByLabel($, label) {
  const target = normalizeLabel(label);
  let value = null;
  let found = false;

  $("strong").each((_, strongEl) => {
    if (found) return false;
    const candidate = normalizeLabel($(strongEl).text());
    if (candidate === target) {
      const extracted = extractValueFromStrong($, strongEl);
      found = true;
      value = extracted ?? null;
      return false;
    }
    return undefined;
  });

  if (found) return value;

  // Fallback for rare cases where the label is not inside <strong>.
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

/**
 * Parse integer-like text safely.
 * @param {string|null|undefined} str - Source string.
 * @returns {number|null} Parsed integer or null when not numeric.
 */
function parseIntSafe(str) {
  if (!str) return null;
  const digits = String(str).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a string containing a total/business area pair (e.g., "4336 / 4076").
 * @param {string|null|undefined} value - Raw textual pair.
 * @returns {{ total: number|null; business: number|null }} Parsed numeric pair.
 */
function parseAreaPair(value) {
  if (value == null) {
    return { total: null, business: null };
  }
  const segments = String(value)
    .split("/")
    .map((segment) => segment.trim());
  const total = parseIntSafe(segments[0] ?? "");
  const business = parseIntSafe(segments[1] ?? "");
  return { total, business };
}

/**
 * Normalize a section finish descriptor by removing classification codes.
 * @param {string|null|undefined} raw - Raw section finish descriptor.
 * @returns {string} Cleaned layout space type label.
 */
function formatSectionFinish(raw) {
  if (!raw) return "Interior Space";
  const cleaned = cleanText(raw.replace(/^[A-Z0-9]+\s*-\s*/, ""));
  if (!cleaned) return "Interior Space";
  return toTitleCase(cleaned);
}

/**
 * Remove leading classification codes (e.g., "FOP - ") from addition descriptors.
 * @param {string|null|undefined} descriptor - Raw descriptor text.
 * @returns {string} Text with leading codes removed.
 */
function stripLeadingClassificationCode(descriptor) {
  if (!descriptor) return "";
  return cleanText(String(descriptor)).replace(/^[A-Z0-9]+(?:\s*[-:]\s*)?/, "");
}

/**
 * Build AdditionLayoutMetadata with sensible defaults.
 * @param {string} spaceType - Elephant-compliant space type value.
 * @param {{ isExterior?: boolean; isFinished?: boolean }} [overrides] - Optional metadata overrides.
 * @returns {AdditionLayoutMetadata} Addition layout metadata instance.
 */
function createAdditionMetadata(spaceType, overrides) {
  return {
    spaceType,
    isExterior:
      overrides && typeof overrides.isExterior === "boolean"
        ? overrides.isExterior
        : false,
    isFinished:
      overrides && typeof overrides.isFinished === "boolean"
        ? overrides.isFinished
        : false,
  };
}

/**
 * Normalize an addition descriptor into Elephant layout metadata.
 * @param {string} descriptor - Raw descriptor text sourced from the addition table.
 * @returns {AdditionLayoutMetadata|null} Mapped metadata or null when no supported mapping exists.
 */
function mapAdditionDescriptorToMetadata(descriptor) {
  const cleanedDescriptor = stripLeadingClassificationCode(descriptor);
  if (!cleanedDescriptor) return null;

  const normalized = cleanText(cleanedDescriptor)
    .toLowerCase()
    .replace(/\batt\b/g, "attached")
    .replace(/\bdet\b/g, "detached")
    .replace(/\bencl?\b/g, "enclosed")
    .replace(/\bscrn?\b/g, "screened")
    .replace(/\bopn\b/g, "open")
    .replace(/\bpor\b/g, "porch")
    .replace(/\bgar\b/g, "garage");

  if (!normalized) return null;

  if (normalized.includes("lower garage")) {
    return createAdditionMetadata("Lower Garage", {
      isExterior: false,
      isFinished: false,
    });
  }

  if (normalized.includes("garage")) {
    const isDetached = normalized.includes("detached");
    return createAdditionMetadata(
      isDetached ? "Detached Garage" : "Attached Garage",
      { isExterior: false, isFinished: false },
    );
  }

  if (normalized.includes("carport")) {
    if (normalized.includes("attached")) {
      return createAdditionMetadata("Attached Carport", {
        isExterior: true,
        isFinished: false,
      });
    }
    if (normalized.includes("detached")) {
      return createAdditionMetadata("Detached Carport", {
        isExterior: true,
        isFinished: false,
      });
    }
    return createAdditionMetadata("Carport", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("screened porch")) {
    return createAdditionMetadata("Screened Porch", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("open porch")) {
    return createAdditionMetadata("Open Porch", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("enclosed porch")) {
    return createAdditionMetadata("Enclosed Porch", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("porch")) {
    return createAdditionMetadata("Porch", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("lanai")) {
    return createAdditionMetadata("Lanai", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("deck")) {
    return createAdditionMetadata("Deck", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("patio")) {
    return createAdditionMetadata("Patio", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("balcony")) {
    return createAdditionMetadata("Balcony", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("terrace")) {
    return createAdditionMetadata("Terrace", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("gazebo")) {
    return createAdditionMetadata("Gazebo", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("pergola")) {
    return createAdditionMetadata("Pergola", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("courtyard")) {
    if (normalized.includes("open")) {
      return createAdditionMetadata("Open Courtyard", {
        isExterior: true,
        isFinished: false,
      });
    }
    return createAdditionMetadata("Courtyard", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("shed")) {
    return createAdditionMetadata("Shed", {
      isExterior: true,
      isFinished: false,
    });
  }

  if (normalized.includes("workshop")) {
    return createAdditionMetadata("Workshop", {
      isExterior: false,
      isFinished: false,
    });
  }

  if (normalized.includes("storage loft")) {
    return createAdditionMetadata("Storage Loft", {
      isExterior: false,
      isFinished: false,
    });
  }

  if (normalized.includes("storage")) {
    return createAdditionMetadata("Storage Room", {
      isExterior: false,
      isFinished: false,
    });
  }

  if (normalized.includes("pool house")) {
    return createAdditionMetadata("Pool House", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("cabana")) {
    return createAdditionMetadata("Enclosed Cabana", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("outdoor kitchen") || normalized.includes("summer kitchen")) {
    return createAdditionMetadata("Outdoor Kitchen", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("greenhouse")) {
    return createAdditionMetadata("Greenhouse", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("hot tub") || normalized.includes("spa") || normalized.includes("jacuzzi")) {
    return createAdditionMetadata("Hot Tub / Spa Area", {
      isExterior: true,
      isFinished: true,
    });
  }

  if (normalized.includes("stoop")) {
    return createAdditionMetadata("Stoop", {
      isExterior: true,
      isFinished: false,
    });
  }

  return null;
}

/**
 * Attempt to extract addition layouts (e.g., porches, garages) from a building card.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @param {CheerioCollection[]} sectionNodes - Nodes belonging to the building card.
 * @returns {LayoutEntry[]} Layout entries describing the building additions.
 */
function extractAdditionLayouts($, sectionNodes) {
  /** @type {LayoutEntry[]} */
  const additions = [];

  sectionNodes.forEach(($section) => {
    if (!$section || !$section.length) return;

    const headingContainsAddition = $section
      .find("strong, h4, h5, h6")
      .toArray()
      .some((headingEl) => /addition/i.test(cleanText($(headingEl).text())));

    const $table = $section.find("table").first();
    if (!$table.length) return;

    const headerTexts = $table
      .find("thead th")
      .toArray()
      .map((th) => cleanText($(th).text()).toLowerCase());

    const headerIndicatesAddition = headerTexts.some((text) =>
      /(addition|addn)/.test(text),
    );
    if (
      !headingContainsAddition &&
      !headerIndicatesAddition &&
      !/addition/i.test(cleanText($section.text()))
    ) {
      return;
    }

    const descriptorIdx = headerTexts.findIndex((text) =>
      /(description|component|addition|improvement|type)/.test(text),
    );
    const areaIdx = headerTexts.findIndex((text) =>
      /(area|sq|square)/.test(text),
    );
    const yearIdx = headerTexts.findIndex((text) => /year/.test(text));

    $table.find("tbody tr").each((_, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.find("td");
      if (!cells.length) return;

      const cellTexts = cells
        .toArray()
        .map((cell) => cleanText($(cell).text()));
      if (cellTexts.every((text) => text.length === 0)) return;

      let descriptorText =
        descriptorIdx !== -1 && descriptorIdx < cellTexts.length
          ? cellTexts[descriptorIdx]
          : "";
      if (!descriptorText) {
        descriptorText =
          cellTexts.find(
            (text, idx) =>
              text &&
              /[a-z]/i.test(text) &&
              !/total/i.test(text) &&
              !(idx === 0 && /^\d+$/.test(text)),
          ) || "";
      }
      if (!descriptorText || /total/i.test(descriptorText)) return;

      const metadata = mapAdditionDescriptorToMetadata(descriptorText);
      if (!metadata) return;

      let area = null;
      if (areaIdx !== -1 && areaIdx < cellTexts.length) {
        area = parseIntSafe(cellTexts[areaIdx]);
      }
      if (area == null) {
        for (let i = cellTexts.length - 1; i >= 0; i -= 1) {
          if (i === descriptorIdx || i === yearIdx) continue;
          const candidate = parseIntSafe(cellTexts[i]);
          if (candidate != null) {
            area = candidate;
            break;
          }
        }
      }

      const layoutEntry = createBaseLayoutEntry(metadata.spaceType);
      layoutEntry.is_exterior = metadata.isExterior;
      layoutEntry.is_finished = metadata.isFinished;
      if (area != null) {
        layoutEntry.size_square_feet = area;
        layoutEntry.total_area_sq_ft = area;
        if (!metadata.isExterior) {
          layoutEntry.livable_area_sq_ft = area;
        }
      }
      additions.push(layoutEntry);
    });
  });

  return additions;
}

/**
 * Extract the total number of buildings recorded on the page.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {number|null} Building count or null when not present.
 */
function extractBuildingCount($) {
  const raw = findValueByLabel($, "Building Count");
  const parsed = parseIntSafe(raw);
  return parsed != null ? parsed : null;
}

/**
 * @typedef {Object} BuildingCardExtraction
 * @property {number} buildingIndex - Numeric identifier extracted from the heading.
 * @property {CheerioCollection} heading - Heading element collection.
 * @property {CheerioCollection[]} sectionNodes - Subsequent sibling nodes belonging to the card.
 */

/**
 * Identify and extract DOM segments representing individual building cards.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {BuildingCardExtraction[]} Array of building card sections.
 */
function extractBuildingCards($) {
  /** @type {Map<number, BuildingCardExtraction>} */
  const cardsByIndex = new Map();
  $("h5").each((_, headingEl) => {
    const $heading = $(headingEl);
    const text = cleanText($heading.text());
    const match = text.match(/Card\s*\(Bldg\)\s*#\s*(\d+)/i);
    if (!match) return;
    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index)) return;

    /** @type {CheerioCollection[]} */
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

/**
 * Attempt to retrieve a label value that exists within a collection of section nodes.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @param {CheerioCollection[]} sectionNodes - Nodes belonging to the building card.
 * @param {string} label - Target label text.
 * @returns {string|null} Extracted value or null when absent.
 */
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

/**
 * Extract interior layout entries from summary tables within a building card.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @param {CheerioCollection[]} sectionNodes - Nodes belonging to the building card.
 * @returns {SectionLayoutRow[]} Parsed layout rows for the building interior.
 */
function extractSectionTableLayouts($, sectionNodes) {
  /** @type {SectionLayoutRow[]} */
  const layouts = [];
  let sequence = 2;

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

      const finishText = cleanText(cells.eq(2).text());
      const areaText = cleanText(cells.eq(4).text());
      const totalAreaText = cleanText(cells.eq(5).text());
      const businessAreaText = cleanText(cells.eq(6).text());

      const entry = createBaseLayoutEntry(formatSectionFinish(finishText));
      entry.size_square_feet = parseIntSafe(areaText);
      entry.total_area_sq_ft = parseIntSafe(totalAreaText);
      entry.livable_area_sq_ft = parseIntSafe(businessAreaText);
      entry.is_finished = true;
      entry.is_exterior = false;
      layouts.push({ descriptor: finishText, layout: entry });
    });
  });

  return layouts;
}

/**
 * Map a raw section finish descriptor to Elephant-compliant layout metadata.
 * @param {string} rawDescriptor - Raw descriptor text (may include classification codes).
 * @returns {{ spaceType: string; isExterior: boolean; isFinished: boolean }|null} Mapping metadata or null when unmapped.
 */
function mapSectionFinishDescriptor(rawDescriptor) {
  if (!rawDescriptor) return null;
  const descriptor = stripLeadingClassificationCode(rawDescriptor);
  const normalized = cleanText(descriptor).toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("office")) {
    return { spaceType: "Office Room", isExterior: false, isFinished: true };
  }

  if (normalized.includes("conference")) {
    return { spaceType: "Conference Room", isExterior: false, isFinished: true };
  }

  if (normalized.includes("class")) {
    return { spaceType: "Class Room", isExterior: false, isFinished: true };
  }

  if (normalized.includes("lobby") || normalized.includes("entry")) {
    return { spaceType: "Lobby / Entry Hall", isExterior: false, isFinished: true };
  }

  if (normalized.includes("laundry")) {
    return { spaceType: "Laundry Room", isExterior: false, isFinished: true };
  }

  if (normalized.includes("utility")) {
    return { spaceType: "Utility Closet", isExterior: false, isFinished: true };
  }

  if (normalized.includes("screen") && normalized.includes("porch")) {
    return { spaceType: "Screened Porch", isExterior: true, isFinished: false };
  }

  if (normalized.includes("open") && normalized.includes("porch")) {
    return { spaceType: "Open Porch", isExterior: true, isFinished: false };
  }

  if (normalized.includes("porch")) {
    return { spaceType: "Porch", isExterior: true, isFinished: false };
  }

  if (normalized.includes("apartment")) {
    return { spaceType: "Living Area", isExterior: false, isFinished: true };
  }

  if (normalized.includes("deck")) {
    return { spaceType: "Deck", isExterior: true, isFinished: false };
  }

  if (normalized.includes("balcony")) {
    return { spaceType: "Balcony", isExterior: true, isFinished: false };
  }

  if (normalized.includes("patio")) {
    return { spaceType: "Patio", isExterior: true, isFinished: false };
  }

  if (normalized.includes("garage")) {
    const isDetached = normalized.includes("detached");
    return {
      spaceType: isDetached ? "Detached Garage" : "Attached Garage",
      isExterior: false,
      isFinished: false,
    };
  }

  return null;
}

/**
 * Convert section layout rows into Elephant-compliant layout entries with indexed space types.
 * @param {SectionLayoutRow[]} sectionRows - Parsed section rows for a building.
 * @param {string|null} buildingNumber - Building number/string identifier.
 * @returns {LayoutEntry[]} Layout entries suitable for export.
 */
function convertSectionRowsToLayouts(sectionRows, buildingNumber) {
  /** @type {LayoutEntry[]} */
  const mappedLayouts = [];
  /** @type {Map<string, number>} */
  const typeCounters = new Map();

  sectionRows.forEach(({ descriptor, layout }) => {
    const metadata =
      mapSectionFinishDescriptor(descriptor) ??
      mapSectionFinishDescriptor(layout.space_type);
    if (!metadata) return;

    const clonedLayout = { ...layout };
    clonedLayout.space_type = metadata.spaceType;
    clonedLayout.is_exterior = metadata.isExterior;
    clonedLayout.is_finished = metadata.isFinished;
    clonedLayout.building_number = parseIntSafe(buildingNumber);

    const index = (typeCounters.get(metadata.spaceType) ?? 0) + 1;
    typeCounters.set(metadata.spaceType, index);
    clonedLayout.space_type_index = `${buildingNumber}.${index}`;

    mappedLayouts.push(clonedLayout);
  });

  return mappedLayouts;
}

/**
 * Construct building layout groups using building card information.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {BuildingLayoutGroup[]} Building layout groups.
 */
function buildBuildingLayoutGroups($) {
  const cards = extractBuildingCards($);
  if (cards.length === 0) return [];

  /** @type {BuildingLayoutGroup[]} */
  const groups = [];

  cards.forEach((card) => {
    const sectionLayouts = extractSectionTableLayouts($, card.sectionNodes);
    const additionLayouts = extractAdditionLayouts($, card.sectionNodes).map(
      (layout) => ({
        ...layout,
        building_number: card.buildingIndex,
      }),
    );
    const totalBusinessText = findValueWithinSection(
      $,
      card.sectionNodes,
      "Total / Business Area",
    );
    const areaPair = parseAreaPair(totalBusinessText);
    const buildingLayout = createBaseLayoutEntry("Building");
    buildingLayout.space_type_index = String(card.buildingIndex);
    buildingLayout.building_number = card.buildingIndex;
    buildingLayout.size_square_feet = areaPair.total;
    buildingLayout.total_area_sq_ft = areaPair.total;
    buildingLayout.livable_area_sq_ft = areaPair.business;
    buildingLayout.is_finished = true;
    buildingLayout.is_exterior = false;

    const summedTotalArea = sectionLayouts.reduce(
      (acc, row) =>
        acc + (row.layout.total_area_sq_ft ?? row.layout.size_square_feet ?? 0),
      0,
    );
    const summedLivableArea = sectionLayouts.reduce(
      (acc, row) =>
        acc + (row.layout.livable_area_sq_ft ?? row.layout.size_square_feet ?? 0),
      0,
    );
    buildingLayout.space_type = "Building";
    if (summedTotalArea > 0) {
      buildingLayout.size_square_feet = summedTotalArea;
      buildingLayout.total_area_sq_ft = summedTotalArea;
    }
    if (summedLivableArea > 0) {
      buildingLayout.livable_area_sq_ft = summedLivableArea;
    }
    if (
      (buildingLayout.size_square_feet == null ||
        buildingLayout.size_square_feet === 0) &&
      areaPair.total != null
    ) {
      buildingLayout.size_square_feet = areaPair.total;
    }
    if (
      (buildingLayout.total_area_sq_ft == null ||
        buildingLayout.total_area_sq_ft === 0) &&
      areaPair.total != null
    ) {
      buildingLayout.total_area_sq_ft = areaPair.total;
    }
    if (
      (buildingLayout.livable_area_sq_ft == null ||
        buildingLayout.livable_area_sq_ft === 0) &&
      areaPair.business != null
    ) {
      buildingLayout.livable_area_sq_ft = areaPair.business;
    }



    const sectionInteriorLayouts = convertSectionRowsToLayouts(
      sectionLayouts,
      card.buildingIndex,
    );
    
    // Apply building-prefixed indexing to addition layouts
    const typeCounters = new Map();
    additionLayouts.forEach(layout => {
      const index = (typeCounters.get(layout.space_type) ?? 0) + 1;
      typeCounters.set(layout.space_type, index);
      layout.space_type_index = `${card.buildingIndex}.${index}`;
    });
    
    const combinedInteriorLayouts = [
      ...sectionInteriorLayouts,
      ...additionLayouts,
    ];

    groups.push({
      building_index: card.buildingIndex,
      building_layout: buildingLayout,
      interior_layouts: combinedInteriorLayouts,
    });
  });

  return groups;
}

/**
 * Collect bathroom fixture counts across all supported fixture categories.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {FixtureCounts} Aggregated fixture counts.
 */
function getBathroomFixtureCounts($) {
  /** @type {FixtureCounts} */
  const fixtures = {
    twoFixture: 0,
    threeFixture: 0,
    fourFixture: 0,
    fiveFixture: 0,
    sixFixture: 0,
    sevenFixture: 0,
  };

  /** @type {Array<{label: string; key: keyof FixtureCounts}>} */
  const fixtureLabels = [
    { label: "2 Fixture Baths", key: "twoFixture" },
    { label: "3 Fixture Baths", key: "threeFixture" },
    { label: "4 Fixture Baths", key: "fourFixture" },
    { label: "5 Fixture Baths", key: "fiveFixture" },
    { label: "6 Fixture Baths", key: "sixFixture" },
    { label: "7 Fixture Baths", key: "sevenFixture" },
  ];

  for (const { label: fixtureLabel, key } of fixtureLabels) {
    const parsed = parseIntSafe(findValueByLabel($, fixtureLabel));
    fixtures[key] = parsed ?? 0;
  }

  return fixtures;
}

/**
 * Create the set of default layout entries for single-building properties.
 * @param {CheerioAPI} $ - Cheerio page instance.
 * @returns {LayoutEntry[]} Layout entries describing the interior spaces.
 */
function buildDefaultRoomLayouts($) {
  /** @type {LayoutEntry[]} */
  const layouts = [];
  const sflaText = findValueByLabel($, "Total SFLA") ?? "";
  const sfla = parseIntSafe(sflaText);
  const bedroomsCount = parseIntSafe(findValueByLabel($, "# Bedrooms")) ?? 0;
  const fixtureCounts = getBathroomFixtureCounts($);

  const totalFullBaths =
    fixtureCounts.fourFixture +
    fixtureCounts.fiveFixture +
    fixtureCounts.sixFixture +
    fixtureCounts.sevenFixture;
  const totalThreeQuarterBaths = fixtureCounts.threeFixture;
  const totalHalfBaths = fixtureCounts.twoFixture;

  let index = 1;

  const livingArea = createBaseLayoutEntry("Living Area");
  livingArea.size_square_feet = sfla ? Math.round(sfla * 0.25) : null;
  livingArea.has_windows = true;
  livingArea.is_finished = true;
  livingArea.is_exterior = false;
  // layouts.push(livingArea);

  for (let i = 0; i < bedroomsCount; i += 1) {
    const bedroom = createBaseLayoutEntry("Bedroom");
    bedroom.size_square_feet = null;
    bedroom.has_windows = true;
    bedroom.is_finished = true;
    bedroom.is_exterior = false;
    layouts.push(bedroom);
  }

  for (let i = 0; i < totalFullBaths; i += 1) {
    const bathroom = createBaseLayoutEntry("Full Bathroom");
    bathroom.size_square_feet = null;
    bathroom.has_windows = false;
    bathroom.is_finished = true;
    bathroom.is_exterior = false;
    layouts.push(bathroom);
  }

  for (let i = 0; i < totalThreeQuarterBaths; i += 1) {
    const bathroom = createBaseLayoutEntry("Three-Quarter Bathroom");
    bathroom.size_square_feet = null;
    bathroom.has_windows = false;
    bathroom.is_finished = true;
    bathroom.is_exterior = false;
    layouts.push(bathroom);
  }

  for (let i = 0; i < totalHalfBaths; i += 1) {
    const bathroom = createBaseLayoutEntry("Half Bathroom / Powder Room");
    bathroom.size_square_feet = null;
    bathroom.has_windows = false;
    bathroom.is_finished = true;
    bathroom.is_exterior = false;
    layouts.push(bathroom);
  }

  return layouts;
}

/**
 * Script entry point. Reads the HTML input (default `input.html` or CLI arg),
 * extracts layout data, and writes/merges the output JSON keyed by parcel/alt identifiers.
 * @returns {void}
 */
function main() {
  const inputArg = process.argv[2];
  const inputPath = inputArg
    ? path.resolve(process.cwd(), inputArg)
    : path.join(process.cwd(), "input.html");
  const html = fs.readFileSync(inputPath, "utf8");
  const $ = cheerio.load(html);

  const altkey = getAltKey($);
  const parcelIdText = findValueByLabel($, "Parcel ID");
  const parcelId = parcelIdText ? parcelIdText.replace(/[^0-9]/g, "") : null;

  const buildingCards = extractBuildingCards($);
  
  /** @type {LayoutEntry[]} */
  let layoutsToPersist = [];
  
  // Always try to generate default layouts first
  // const defaultLayouts = buildDefaultRoomLayouts($);
  // layoutsToPersist = defaultLayouts;
  
  if (!buildingCards.length) {
    console.warn("No building cards detected; using default layouts.");
  } else {
    const buildingCount = extractBuildingCount($);
    const buildingGroupsCandidate = buildBuildingLayoutGroups($);
    const hasMultipleBuildings =
      (buildingCount != null && buildingCount > 1) ||
      buildingGroupsCandidate.length > 1;
    const useBuildingGroups = buildingGroupsCandidate.length > 0;

    if (useBuildingGroups) {
      buildingGroupsCandidate.forEach((group) => {
        group.building_layout.space_type = "Building";
      });
      layoutsToPersist = buildingGroupsCandidate.flatMap((group) => [
        group.building_layout,
        ...group.interior_layouts,
      ]);
    }
  }

  const outDir = path.join(process.cwd(), "owners");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "layout_data.json");
  /** @type {Record<string, { layouts: LayoutEntry[]; building_layouts?: BuildingLayoutGroup[] }>} */
  const payload = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : {};

  const key = parcelId ? `property_${parcelId}` : (altkey ? `property_${altkey}` : null);
  
  if (!key) {
    throw new Error("Unable to determine an identifier for layout data.");
  }

  payload[key] = { layouts: layoutsToPersist };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}