import { describe, expect, it } from "vitest";

import { createEmptyCoverPage, type CoverPageData, type Party } from "./types";
import { countErrors, validateCoverPage, type FieldKey } from "./validate";

const completeParty = (): Party => ({
  companyName: "Northwind Labs, Inc.",
  signatoryName: "Dana Reyes",
  signatoryTitle: "Chief Executive Officer",
  noticeAddress: "legal@northwindlabs.com",
});

function completeCoverPage(overrides: Partial<CoverPageData> = {}): CoverPageData {
  return {
    ...createEmptyCoverPage(),
    effectiveDate: "2026-07-26",
    governingLaw: "Delaware",
    jurisdiction: "New Castle, DE",
    partyOne: completeParty(),
    partyTwo: completeParty(),
    ...overrides,
  };
}

describe("validateCoverPage", () => {
  it("passes a fully answered cover page", () => {
    expect(validateCoverPage(completeCoverPage())).toEqual({});
  });

  it("treats modifications as optional", () => {
    const data = completeCoverPage({ modifications: "" });
    expect(validateCoverPage(data)).toEqual({});
  });

  describe("required fields", () => {
    const required: FieldKey[] = [
      "purpose",
      "effectiveDate",
      "governingLaw",
      "jurisdiction",
      "partyOne.companyName",
      "partyOne.signatoryName",
      "partyOne.signatoryTitle",
      "partyOne.noticeAddress",
      "partyTwo.companyName",
      "partyTwo.signatoryName",
      "partyTwo.signatoryTitle",
      "partyTwo.noticeAddress",
    ];

    it.each(required)("reports %s when it is empty", (key) => {
      const data = completeCoverPage();
      const [head, tail] = key.split(".") as [keyof CoverPageData, keyof Party];

      const blanked = tail
        ? { ...data, [head]: { ...(data[head] as Party), [tail]: "" } }
        : { ...data, [head]: "" };

      expect(validateCoverPage(blanked)).toHaveProperty(key, "Required");
    });

    it.each(required)("reports %s when it is only whitespace", (key) => {
      const data = completeCoverPage();
      const [head, tail] = key.split(".") as [keyof CoverPageData, keyof Party];

      // A date input cannot hold whitespace, so it is exercised as empty above.
      if (key === "effectiveDate") return;

      const blanked = tail
        ? { ...data, [head]: { ...(data[head] as Party), [tail]: "   " } }
        : { ...data, [head]: "  \t " };

      expect(validateCoverPage(blanked)).toHaveProperty(key, "Required");
    });

    it("reports every missing field on a blank form", () => {
      const blank = createEmptyCoverPage();
      const errors = validateCoverPage({ ...blank, purpose: "", effectiveDate: "" });
      expect(countErrors(errors)).toBe(required.length);
    });

    it("counts ten missing fields on the default form", () => {
      // Purpose and effective date are pre-filled; the other ten are not.
      const errors = validateCoverPage(createEmptyCoverPage());
      expect(countErrors(errors)).toBe(10);
    });
  });

  describe("year counts", () => {
    it("accepts a whole number of years", () => {
      const data = completeCoverPage({ mndaTerm: { kind: "expires", years: 3 } });
      expect(validateCoverPage(data)["mndaTerm.years"]).toBeUndefined();
    });

    it.each([0, -1, 1.5, Number.NaN])("rejects %s years for the MNDA term", (years) => {
      const data = completeCoverPage({ mndaTerm: { kind: "expires", years } });
      expect(validateCoverPage(data)["mndaTerm.years"]).toBe(
        "Enter a whole number of years",
      );
    });

    it.each([0, -1, 1.5, Number.NaN])(
      "rejects %s years for the confidentiality term",
      (years) => {
        const data = completeCoverPage({
          confidentialityTerm: { kind: "years", years },
        });
        expect(validateCoverPage(data)["confidentialityTerm.years"]).toBe(
          "Enter a whole number of years",
        );
      },
    );

    it("ignores the year count when the term is open-ended", () => {
      const data = completeCoverPage({ mndaTerm: { kind: "untilTerminated" } });
      expect(validateCoverPage(data)).toEqual({});
    });

    it("ignores the year count when confidentiality is perpetual", () => {
      const data = completeCoverPage({
        confidentialityTerm: { kind: "perpetuity" },
      });
      expect(validateCoverPage(data)).toEqual({});
    });
  });

  describe("error ordering", () => {
    /*
     * The download action focuses the first key it finds, so the order errors are
     * inserted in is what decides where the user lands.
     */
    it("reports cover-page fields before party fields", () => {
      const errors = validateCoverPage({
        ...completeCoverPage(),
        governingLaw: "",
        partyTwo: { ...completeParty(), companyName: "" },
      });

      expect(Object.keys(errors)).toEqual(["governingLaw", "partyTwo.companyName"]);
    });
  });
});

describe("countErrors", () => {
  it("counts nothing for a clean result", () => {
    expect(countErrors({})).toBe(0);
  });

  it("counts each reported field once", () => {
    expect(countErrors({ purpose: "Required", jurisdiction: "Required" })).toBe(2);
  });
});
