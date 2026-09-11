/**
 * Object-key routing for Filebase query-table publishes.
 * HOA/PM slices must never share official county keys.
 */

export function officialQueryTableObjectKey(county) {
  return `${county}/query-table.parquet`;
}

export function officialCoverageObjectKey(county) {
  return `${county}/dataset-coverage.json`;
}

export function hoaPmQueryTableObjectKey(county) {
  return `${county}/hoa-pm/query-table.parquet`;
}

export function hoaPmCoverageObjectKey(county) {
  return `${county}/hoa-pm/dataset-coverage.json`;
}

export function hoaPmObjectsObjectKey(county) {
  return `${county}/hoa-pm/objects.jsonl`;
}

function isHoaPmLabel(label) {
  return typeof label === "string" && label.endsWith("-hoa-pm");
}

/**
 * @param {{ county: string, queryTableIpnsLabel?: string, coverageIpnsLabel?: string, hoaPmObjectsPath?: string }} artifacts
 */
export function resolveFilebasePublicationKeys(artifacts) {
  const county = artifacts.county;
  const overlay =
    Boolean(artifacts.hoaPmObjectsPath) ||
    isHoaPmLabel(artifacts.queryTableIpnsLabel) ||
    isHoaPmLabel(artifacts.coverageIpnsLabel);

  if (!overlay) {
    return {
      overlay: false,
      queryTableKey: officialQueryTableObjectKey(county),
      coverageKey: officialCoverageObjectKey(county),
    };
  }

  return {
    overlay: true,
    queryTableKey: hoaPmQueryTableObjectKey(county),
    coverageKey: hoaPmCoverageObjectKey(county),
    hoaPmObjectsKey: hoaPmObjectsObjectKey(county),
  };
}
