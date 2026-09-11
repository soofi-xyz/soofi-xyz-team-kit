import { describe, expect, it } from "vitest";

import {
  resolveFilebasePublicationKeys,
} from "../src/core/hoa-pm-publication-keys.mjs";

describe("HOA/PM Filebase object keys", () => {
  it("keeps official county publishes on the county query-table key", () => {
    expect(
      resolveFilebasePublicationKeys({
        county: "lee",
        queryTableIpnsLabel: "oracle-query-table-lee",
        coverageIpnsLabel: "oracle-dataset-coverage-lee",
      }),
    ).toEqual({
      overlay: false,
      queryTableKey: "lee/query-table.parquet",
      coverageKey: "lee/dataset-coverage.json",
    });
  });

  it("routes HOA/PM slices under hoa-pm/ even if labels were omitted", () => {
    expect(
      resolveFilebasePublicationKeys({
        county: "lee",
        queryTableIpnsLabel: "oracle-query-table-lee-hoa-pm",
        coverageIpnsLabel: "oracle-dataset-coverage-lee-hoa-pm",
        hoaPmObjectsPath: "/tmp/objects.jsonl",
      }),
    ).toEqual({
      overlay: true,
      queryTableKey: "lee/hoa-pm/query-table.parquet",
      coverageKey: "lee/hoa-pm/dataset-coverage.json",
      hoaPmObjectsKey: "lee/hoa-pm/objects.jsonl",
    });
  });

  it("does not reuse official county keys when an HOA/PM object bundle is present", () => {
    const keys = resolveFilebasePublicationKeys({
      county: "pinellas",
      queryTableIpnsLabel: "oracle-query-table-pinellas",
      coverageIpnsLabel: "oracle-dataset-coverage-pinellas",
      hoaPmObjectsPath: "/tmp/objects.jsonl",
    });
    expect(keys.queryTableKey).toBe("pinellas/hoa-pm/query-table.parquet");
    expect(keys.coverageKey).toBe("pinellas/hoa-pm/dataset-coverage.json");
    expect(keys.queryTableKey).not.toBe("pinellas/query-table.parquet");
  });
});
