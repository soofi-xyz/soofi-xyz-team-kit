import { describe, expect, it } from "vitest";

import {
  chooseLender,
  isOrganization,
  parseIndexedPersonName,
  splitTradeName,
} from "../src/mortgage/names.mjs";

describe("parseIndexedPersonName", () => {
  it("treats a trailing JR/SR/II/III as the suffix, not the middle name", () => {
    expect(parseIndexedPersonName("BROWN DARRYL JR")).toEqual({
      last_name: "Brown", first_name: "Darryl", middle_name: null, suffix_name: "Jr.",
    });
    expect(parseIndexedPersonName("DOE JOHN ALLEN SR.")).toEqual({
      last_name: "Doe", first_name: "John", middle_name: "Allen", suffix_name: "Sr.",
    });
    expect(parseIndexedPersonName("ROE RICHARD III")).toMatchObject({ suffix_name: "III", middle_name: null });
    expect(parseIndexedPersonName("ROE RICHARD 2ND")).toMatchObject({ suffix_name: "II" });
  });

  it("keeps a two-word name and leaves organizations alone", () => {
    expect(parseIndexedPersonName("SMITH JR")).toMatchObject({ first_name: "Jr", suffix_name: null });
    expect(parseIndexedPersonName("BANK OF AMERICA N A")).toBeNull();
    expect(parseIndexedPersonName("")).toBeNull();
  });
});

describe("lender names", () => {
  it("splits DBA and similar markers, keeping the legal name first", () => {
    expect(splitTradeName("JRDB INC DBA BAYWAY MORTGAGE GROUP")).toEqual({
      legalName: "JRDB INC", otherNames: ["BAYWAY MORTGAGE GROUP"],
    });
    expect(splitTradeName("ACME LENDING LLC D/B/A ACME HOME LOANS")).toEqual({
      legalName: "ACME LENDING LLC", otherNames: ["ACME HOME LOANS"],
    });
  });

  it("prefers the legal entity, drops MERS and keeps the rest as aliases", () => {
    expect(chooseLender(["JRDB INC", "BAYWAY MORTGAGE GROUP"])).toEqual({
      lenderName: "JRDB INC", aliases: ["BAYWAY MORTGAGE GROUP"], nominee: null,
    });
    expect(chooseLender(["MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC", "GUILD MORTGAGE COMPANY LLC"])).toEqual({
      lenderName: "GUILD MORTGAGE COMPANY LLC", aliases: [], nominee: "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC",
    });
    expect(chooseLender(["MERSN", "SIMONS & LEONI HOME LOANS LLC"]).lenderName).toBe("SIMONS & LEONI HOME LOANS LLC");
    expect(chooseLender(["MERS"])).toEqual({ lenderName: null, aliases: [], nominee: "MERS" });
    expect(isOrganization("FIRST HORIZON BANK")).toBe(true);
  });
});
