import { describe, expect, it } from "vitest";

import {
  classifyRoofAgePermit,
  compileRoofAgeProfile,
  estimateRoofAge,
} from "../src/roof-age/estimator.js";
import {
  alphaPermit,
  betaPermit,
  dateEvidence,
  estimatorInput,
  representativeRoofAgeProfile,
} from "./roof-age-fixtures.js";

describe("roof-age source profile mapping", () => {
  const profile = compileRoofAgeProfile(representativeRoofAgeProfile);

  it("maps representative status and work vocabularies without county logic", () => {
    const alpha = classifyRoofAgePermit(
      alphaPermit("alpha-finaled", {
        status: "  finaled ",
        work: "REroof",
        completionDate: dateEvidence("2022-01-01"),
      }),
      profile,
    );
    const beta = classifyRoofAgePermit(
      betaPermit("beta-complete", {
        status: "Complete",
        work: "Residential roof replacement",
        completionDate: dateEvidence("2023-01-01"),
      }),
      profile,
    );

    expect(alpha).toMatchObject({
      status: "completed",
      workClassification: "primary_roof_replacement",
    });
    expect(beta).toMatchObject({
      status: "completed",
      workClassification: "primary_roof_replacement",
    });
  });

  it("fails closed for unmapped or contradictory vocabulary", () => {
    const unmapped = classifyRoofAgePermit(
      alphaPermit("unmapped", {
        work: "Reroof with coating",
      }),
      profile,
    );
    const contradictory = classifyRoofAgePermit(
      {
        ...alphaPermit("contradictory"),
        workEvidence: [
          { field: "permit_type", value: "Reroof" },
          { field: "permit_type", value: "Roof repair" },
        ],
      },
      profile,
    );

    expect(unmapped.workClassification).toBe("needs_review");
    expect(contradictory.workClassification).toBe("needs_review");
  });

  it("keeps profile ownership separate from estimator precedence", () => {
    const result = estimateRoofAge(
      estimatorInput([
        betaPermit("beta-new", {
          work: "New single-family dwelling",
          completionDate: dateEvidence("2025-01-01"),
        }),
        alphaPermit("alpha-replacement", {
          completionDate: dateEvidence("2020-01-01"),
        }),
      ]),
      profile,
    );

    expect(result.anchor).toMatchObject({
      date: "2020-01-01",
      source: {
        sourceSystem: "source-alpha",
        sourceRecordId: "alpha-replacement",
      },
    });
    expect(result.confidence).toBe("high");
  });
});

describe("deterministic roof-age profile metadata", () => {
  it("produces the same digest for logically identical mapping order", () => {
    const reordered = {
      version: representativeRoofAgeProfile.version,
      sources: [...representativeRoofAgeProfile.sources]
        .reverse()
        .map((source) => ({
          ...source,
          statusMappings: [...source.statusMappings].reverse(),
          workMappings: [...source.workMappings].reverse(),
        })),
    };
    const first = compileRoofAgeProfile(representativeRoofAgeProfile);
    const second = compileRoofAgeProfile(reordered);

    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    const result = estimateRoofAge(
      estimatorInput([]),
      representativeRoofAgeProfile,
    );
    expect(result.policy).toEqual({
      version: "oracle.roof-age-policy.v1",
      profileVersion: "representative-roof-v1",
      profileSha256: first.sha256,
    });
  });

  it("rejects normalized mapping collisions that resolve differently", () => {
    const conflicting = structuredClone(representativeRoofAgeProfile);
    conflicting.sources[0]!.statusMappings.push({
      field: "STATUS",
      value: " finaled ",
      status: "open",
    });

    expect(() => compileRoofAgeProfile(conflicting)).toThrow(
      /Conflicting status mapping/,
    );
  });
});
