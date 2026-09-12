import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  HOA_PM_PROPERTY_APPROVAL_SCHEMA_VERSION,
  publishHoaPmPropertyPages,
  stampHoaPmPropertyJson,
  thinHoaPmPropertyJson,
  validateHoaPmPropertyApproval,
} from "../src/core/hoa-pm-property-publication.mjs";

const artifacts = {
  county: "duval",
  parquetPath: "/not-read-during-dry-run.parquet",
  bucket: "elephant-oracle-query-table",
  queryTableIpnsLabel: "oracle-query-table-duval-hoa-pm",
};

describe("HOA/PM stamped property publication", () => {
  it("copies the original property and adds only the available CID links", () => {
    const body = Buffer.from(
      JSON.stringify({ parcelId: "006223-3035", property: { hoaFlag: null } }),
    );
    const stamped = JSON.parse(
      stampHoaPmPropertyJson(body, {
        propertyCid: "QmWqrY2WYrjnLftYg31UZkz8B7LBskLCCLX88nb5puT8ed",
        hoaCid: "QmTGSd5BkAy4Qx9To5Jr3jvg4LUEypxrYBx6i6vgxSdN59",
        propertyManagerCid:
          "QmREJtrGduU39HnSfZC5iuFvTE1ptRX8Zg35dSwVQWqRfT",
      }).toString("utf8"),
    );
    expect(stamped).toEqual({
      parcelId: "006223-3035",
      property: { hoaFlag: null },
      hoa_cid: "QmTGSd5BkAy4Qx9To5Jr3jvg4LUEypxrYBx6i6vgxSdN59",
      property_manager_cid:
        "QmREJtrGduU39HnSfZC5iuFvTE1ptRX8Zg35dSwVQWqRfT",
    });
    expect(stamped).not.toHaveProperty("hoa_flag");
  });

  it("builds a minimal overlay-only property without hoa_flag", () => {
    const thin = JSON.parse(
      thinHoaPmPropertyJson("seminole", {
        thinProperty: {
          parcel_id: "07212951500000780",
          primary_address: "2738 BRANDON CIR APOPKA FL 32703",
          subdivision: "Wekiva Reserve Unit 2",
        },
        hoaCid: "QmaWHP5byMjdLC8p3u5Hw8WGDKquqbNkJDNPKUffcpFQky",
        propertyManagerCid:
          "QmbrPQ845DJXaknfS9wjxSeSvyvyDQnFZnNfCSeheo3wer",
        hoaPmStatus: "matched",
      }).toString("utf8"),
    );
    expect(thin).toEqual({
      county: "seminole",
      parcel_id: "07212951500000780",
      primary_address: "2738 BRANDON CIR APOPKA FL 32703",
      subdivision: "Wekiva Reserve Unit 2",
      hoa_cid: "QmaWHP5byMjdLC8p3u5Hw8WGDKquqbNkJDNPKUffcpFQky",
      property_manager_cid:
        "QmbrPQ845DJXaknfS9wjxSeSvyvyDQnFZnNfCSeheo3wer",
      hoa_pm_status: "matched",
    });
    expect(thin).not.toHaveProperty("hoa_flag");
  });

  it("binds approval to the overlay label and exact source table", () => {
    const sourceBody = Buffer.from("PAR1");
    const approval = {
      schemaVersion: HOA_PM_PROPERTY_APPROVAL_SCHEMA_VERSION,
      action: "publish-stamped-property-pages-and-overlay-query-table",
      county: "duval",
      bucket: "elephant-oracle-query-table",
      queryTableIpnsLabel: "oracle-query-table-duval-hoa-pm",
      sourceQueryTable: {
        bytes: sourceBody.length,
        sha256: createHash("sha256").update(sourceBody).digest("hex"),
      },
      approved: true,
      approvedBy: "Test Operator",
      approvedAt: "2026-09-11T23:00:00.000Z",
    };
    expect(
      validateHoaPmPropertyApproval(approval, artifacts, sourceBody),
    ).toEqual(approval);
    expect(() =>
      validateHoaPmPropertyApproval(
        approval,
        {
          ...artifacts,
          queryTableIpnsLabel: "oracle-query-table-duval",
        },
        sourceBody,
      ),
    ).toThrow(/must target oracle-query-table-duval-hoa-pm/);
  });

  it("dry-runs only under the HOA/PM overlay namespace", async () => {
    await expect(
      publishHoaPmPropertyPages(artifacts, { dryRun: true, env: {} }),
    ).resolves.toEqual({
      dryRun: true,
      bucket: "elephant-oracle-query-table",
      queryTableKey: "duval/hoa-pm/query-table.parquet",
      queryTableIpnsLabel: "oracle-query-table-duval-hoa-pm",
      propertyObjectPrefix: "duval/hoa-pm/properties/",
      approvalAction:
        "publish-stamped-property-pages-and-overlay-query-table",
    });
  });

  it("dry-runs thin pages with a distinct approval action", async () => {
    await expect(
      publishHoaPmPropertyPages(artifacts, {
        dryRun: true,
        thinOverlay: true,
        env: {},
      }),
    ).resolves.toMatchObject({
      queryTableKey: "duval/hoa-pm/query-table.parquet",
      propertyObjectPrefix: "duval/hoa-pm/properties/",
      approvalAction:
        "publish-thin-overlay-property-pages-and-overlay-query-table",
    });
  });
});
