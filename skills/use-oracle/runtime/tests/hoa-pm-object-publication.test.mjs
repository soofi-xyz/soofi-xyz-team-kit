import { describe, expect, it } from "vitest";

import { objectCid } from "../src/enrichment/hoa-pm-heuristic.mjs";
import {
  hoaPmPublicationLayers,
  parseHoaPmObjects,
  publishableHoaPmObject,
  restampHoaPmObjectBundle,
} from "../src/enrichment/hoa-pm-object-publication.mjs";

function localObject(payload) {
  return { ...payload, cid: objectCid(payload) };
}

describe("HOA/PM object publication", () => {
  it("publishes dependency objects first and replaces local links", () => {
    const company = localObject({
      data_group: "HOA_",
      type: "company",
      name: "EXAMPLE HOA, INC.",
      sunbiz_document_number: "N12345",
    });
    const manager = localObject({
      data_group: "Property_Management",
      type: "company",
      name: "EXAMPLE MANAGEMENT, LLC",
      sunbiz_document_number: "L12345",
    });
    const association = localObject({
      data_group: "HOA_",
      type: "homeowners_association",
      homeowners_association_name: "EXAMPLE HOA, INC.",
      company_cid: company.cid,
      property_manager_cid: manager.cid,
    });
    const source = Buffer.from(
      [association, company, manager].map(JSON.stringify).join("\n") + "\n",
    );
    const objects = parseHoaPmObjects(source);
    const [companies, associations] = hoaPmPublicationLayers(objects);
    expect(companies).toHaveLength(2);
    expect(associations).toHaveLength(1);

    const published = new Map([
      [company.cid, "QmXAyzo7S6k35cD5cKBHm4qXqAVo2QDKWMYkBZJ8soNe5z"],
      [manager.cid, "QmU6sUemiDkbJsnnn5K5TfRY7i5s9SWrcyUmVzNJcTnwdc"],
      [association.cid, "QmTmqT5X2Afn8Zq7Nsu8iVRs3EuBWyNDW8aKBXp6WiNe4N"],
    ]);
    const body = JSON.parse(
      publishableHoaPmObject(association, published).toString("utf8"),
    );
    expect(body).not.toHaveProperty("cid");
    expect(body.company_cid).toBe(published.get(company.cid));
    expect(body.property_manager_cid).toBe(published.get(manager.cid));

    const bundle = restampHoaPmObjectBundle(objects, published).toString("utf8");
    expect(bundle).not.toContain("sha256:");
    expect(bundle).toContain(published.get(association.cid));
  });

  it("rejects a local CID that does not match the canonical payload", () => {
    expect(() =>
      parseHoaPmObjects(
        Buffer.from(
          `${JSON.stringify({
            data_group: "HOA_",
            type: "company",
            name: "TAMPERED",
            cid: `sha256:${"0".repeat(64)}`,
          })}\n`,
        ),
      ),
    ).toThrow(/does not match/);
  });
});
