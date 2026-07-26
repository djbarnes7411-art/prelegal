import { describe, expect, it } from "vitest";

import {
  confidentialityTermPhrase,
  countWithNumeral,
  documentTitle,
  formatIsoDate,
  mndaTermPhrase,
  renderDocument,
  type Segment,
} from "./render";
import { createEmptyCoverPage, type CoverPageData } from "./types";

/** A fully answered cover page, for tests that care about filled output. */
function completeCoverPage(overrides: Partial<CoverPageData> = {}): CoverPageData {
  return {
    ...createEmptyCoverPage(),
    effectiveDate: "2026-07-26",
    governingLaw: "Delaware",
    jurisdiction: "New Castle, DE",
    partyOne: {
      companyName: "Northwind Labs, Inc.",
      signatoryName: "Dana Reyes",
      signatoryTitle: "Chief Executive Officer",
      noticeAddress: "legal@northwindlabs.com",
    },
    partyTwo: {
      companyName: "Kestrel Analytics LLC",
      signatoryName: "Sam Okonkwo",
      signatoryTitle: "Head of Partnerships",
      noticeAddress: "410 Bridge St, Austin, TX 78701",
    },
    ...overrides,
  };
}

/** Flattens segments the same way `NdaDocument` renders them. */
function segmentsToText(segments: Segment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === "text" || segment.kind === "strong") {
        return segment.text;
      }
      if (segment.term === null) return segment.value;
      return segment.showValue
        ? `${segment.term} (${segment.value})`
        : segment.term;
    })
    .join("");
}

function clauseText(data: CoverPageData, number: number): string {
  const clause = renderDocument(data).clauses.find((c) => c.number === number);
  if (!clause) throw new Error(`no clause ${number}`);
  return segmentsToText(clause.segments);
}

describe("formatIsoDate", () => {
  it("formats an ISO date as a long-form US date", () => {
    expect(formatIsoDate("2026-07-26")).toBe("July 26, 2026");
  });

  it("strips the leading zero from single-digit days", () => {
    expect(formatIsoDate("2026-07-05")).toBe("July 5, 2026");
  });

  it("handles the first and last day of the year", () => {
    expect(formatIsoDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatIsoDate("2026-12-31")).toBe("December 31, 2026");
  });

  /*
   * `new Date("2026-01-01")` is UTC midnight, which is 31 December in any
   * timezone behind UTC. Parsing the string field-by-field is what keeps the
   * rendered date equal to the date the user picked, everywhere.
   */
  it("does not shift the day across timezones", () => {
    expect(formatIsoDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatIsoDate("2026-03-01")).toBe("March 1, 2026");
  });

  it("returns empty string for unset or malformed input", () => {
    expect(formatIsoDate("")).toBe("");
    expect(formatIsoDate("not a date")).toBe("");
    expect(formatIsoDate("2026-7-26")).toBe("");
    expect(formatIsoDate("26-07-2026")).toBe("");
  });

  it("returns empty string for an out-of-range month", () => {
    expect(formatIsoDate("2026-13-01")).toBe("");
    expect(formatIsoDate("2026-00-01")).toBe("");
  });
});

describe("countWithNumeral", () => {
  it("spells the number and repeats it as a numeral", () => {
    expect(countWithNumeral(1, "year")).toBe("one (1) year");
    expect(countWithNumeral(2, "year")).toBe("two (2) years");
    expect(countWithNumeral(10, "year")).toBe("ten (10) years");
  });

  it("singularises only for a count of one", () => {
    expect(countWithNumeral(1, "year")).toContain(" year");
    expect(countWithNumeral(1, "year")).not.toContain("years");
    expect(countWithNumeral(3, "year")).toContain("years");
  });

  it("spells the teens", () => {
    expect(countWithNumeral(11, "year")).toBe("eleven (11) years");
    expect(countWithNumeral(15, "year")).toBe("fifteen (15) years");
    expect(countWithNumeral(19, "year")).toBe("nineteen (19) years");
  });

  it("spells compound tens", () => {
    expect(countWithNumeral(20, "year")).toBe("twenty (20) years");
    expect(countWithNumeral(25, "year")).toBe("twenty-five (25) years");
    expect(countWithNumeral(99, "year")).toBe("ninety-nine (99) years");
  });

  /* Beyond two digits the digits alone are clearer than a spelled-out phrase. */
  it("falls back to digits at one hundred and above", () => {
    expect(countWithNumeral(100, "year")).toBe("100 (100) years");
  });
});

describe("mndaTermPhrase", () => {
  it("describes a fixed term relative to the effective date", () => {
    expect(mndaTermPhrase({ kind: "expires", years: 2 })).toBe(
      "two (2) years from the Effective Date",
    );
  });

  it("describes an open-ended term", () => {
    expect(mndaTermPhrase({ kind: "untilTerminated" })).toBe(
      "which continues until terminated in accordance with the terms of this MNDA",
    );
  });
});

describe("confidentialityTermPhrase", () => {
  it("carves out trade secrets from a fixed term", () => {
    const phrase = confidentialityTermPhrase({ kind: "years", years: 1 });
    expect(phrase).toContain("one (1) year from the Effective Date");
    expect(phrase).toContain("trade secret under applicable laws");
  });

  it("describes perpetual protection without a trade secret carve-out", () => {
    expect(confidentialityTermPhrase({ kind: "perpetuity" })).toBe(
      "in perpetuity",
    );
  });
});

describe("renderDocument", () => {
  it("returns all eleven clauses in order", () => {
    const model = renderDocument(completeCoverPage());
    expect(model.clauses).toHaveLength(11);
    expect(model.clauses.map((clause) => clause.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("exposes the formatted cover-page values", () => {
    const model = renderDocument(completeCoverPage());
    expect(model.effectiveDate).toBe("July 26, 2026");
    expect(model.mndaTerm).toBe("one (1) year from the Effective Date");
    expect(model.confidentialityTerm).toContain("one (1) year");
  });

  describe("defined term expansion", () => {
    it("spells out the Purpose on first use in clause 1", () => {
      const text = clauseText(completeCoverPage(), 1);
      expect(text).toContain(
        "in connection with the Purpose (Evaluating whether to enter into a business relationship with the other party) which",
      );
    });

    it("refers to the Purpose by name after its first use", () => {
      const data = completeCoverPage();
      const clause2 = clauseText(data, 2);
      expect(clause2).toContain("use Confidential Information solely for the Purpose;");
      expect(clause2).not.toContain("Evaluating whether");
    });

    it("expands each defined term exactly once across the whole document", () => {
      const data = completeCoverPage();
      const wholeDocument = renderDocument(data)
        .clauses.map((clause) => segmentsToText(clause.segments))
        .join("\n");

      const occurrences = wholeDocument.split("Evaluating whether").length - 1;
      expect(occurrences).toBe(1);
    });

    it("drops a trailing period so the parenthetical reads cleanly", () => {
      const data = completeCoverPage({ purpose: "Discussing a merger." });
      expect(clauseText(data, 1)).toContain("the Purpose (Discussing a merger) which");
    });
  });

  describe("clause 5 dates and terms", () => {
    it("resolves the effective date, MNDA term and confidentiality term", () => {
      const text = clauseText(completeCoverPage(), 5);
      expect(text).toContain(
        "commences on the Effective Date (July 26, 2026) and expires at the end of the MNDA Term (one (1) year from the Effective Date)",
      );
      expect(text).toContain("survive for the Term of Confidentiality (one (1) year");
    });

    it("reads grammatically for an open-ended term", () => {
      const data = completeCoverPage({ mndaTerm: { kind: "untilTerminated" } });
      expect(clauseText(data, 5)).toContain(
        "expires at the end of the MNDA Term (which continues until terminated in accordance with the terms of this MNDA)",
      );
    });

    it("reads grammatically for perpetual confidentiality", () => {
      const data = completeCoverPage({
        confidentialityTerm: { kind: "perpetuity" },
      });
      expect(clauseText(data, 5)).toContain(
        "survive for the Term of Confidentiality (in perpetuity), despite",
      );
    });
  });

  describe("clause 9 governing law", () => {
    it("substitutes bare values rather than defined terms", () => {
      const text = clauseText(completeCoverPage(), 9);
      expect(text).toContain("the laws of the State of Delaware");
      expect(text).toContain("courts located in New Castle, DE");
    });

    it("uses an anaphor for the repeated references", () => {
      const text = clauseText(completeCoverPage(), 9);
      expect(text).toContain("conflict of laws provisions of such State");
      expect(text).toContain("exclusive jurisdiction of such courts");
      // The literal defined-term names must not leak into the sentence.
      expect(text).not.toContain("such Governing Law");
      expect(text).not.toContain("such Jurisdiction");
    });
  });

  /*
   * Regression: a cleared year field leaves 0 in state. The clause used to
   * assert "the MNDA Term (zero (0) years from the Effective Date)" while the
   * Cover Page above it showed the same field as unanswered.
   */
  describe("term lengths that are not yet usable", () => {
    it.each([0, -3, 1.5, Number.NaN])(
      "leaves the MNDA term unfilled for %s years",
      (years) => {
        const data = completeCoverPage({ mndaTerm: { kind: "expires", years } });
        const model = renderDocument(data);

        expect(model.mndaTerm).toBe("");
        expect(clauseText(data, 5)).toContain(
          "the MNDA Term (length not yet specified)",
        );
        expect(clauseText(data, 5)).not.toMatch(/\(\s*(zero|-3|1\.5|NaN)/);
      },
    );

    it.each([0, -3, 1.5, Number.NaN])(
      "leaves the confidentiality term unfilled for %s years",
      (years) => {
        const data = completeCoverPage({
          confidentialityTerm: { kind: "years", years },
        });

        expect(renderDocument(data).confidentialityTerm).toBe("");
        expect(clauseText(data, 5)).toContain(
          "the Term of Confidentiality (length not yet specified)",
        );
      },
    );

    it("marks the unusable term as not filled, so it renders as a blank", () => {
      const data = completeCoverPage({ mndaTerm: { kind: "expires", years: 0 } });
      const clause5 = renderDocument(data).clauses.find((c) => c.number === 5);
      const mndaTerm = clause5?.segments.find(
        (segment) => segment.kind === "reference" && segment.term === "MNDA Term",
      );

      expect(mndaTerm).toMatchObject({ filled: false });
    });

    it("recovers as soon as a usable count is given", () => {
      const data = completeCoverPage({ mndaTerm: { kind: "expires", years: 7 } });
      expect(clauseText(data, 5)).toContain(
        "the MNDA Term (seven (7) years from the Effective Date)",
      );
    });
  });

  describe("unanswered fields", () => {
    it("marks an unfilled reference as not filled and shows a placeholder", () => {
      const data = completeCoverPage({ governingLaw: "" });
      const clause9 = renderDocument(data).clauses.find((c) => c.number === 9);
      const reference = clause9?.segments.find(
        (segment) => segment.kind === "reference" && !segment.filled,
      );

      expect(reference).toBeDefined();
      expect(reference).toMatchObject({
        kind: "reference",
        filled: false,
        value: "[Governing Law]",
      });
    });

    it("never emits an empty rendered value for a blank field", () => {
      const blank = createEmptyCoverPage();
      for (const clause of renderDocument(blank).clauses) {
        for (const segment of clause.segments) {
          if (segment.kind === "reference") {
            expect(segment.value.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("keeps clause text intact when the whole form is empty", () => {
      const blank = { ...createEmptyCoverPage(), purpose: "", effectiveDate: "" };
      const text = clauseText(blank, 5);
      expect(text).toContain("Either party may terminate this MNDA");
      expect(text).toContain("date not yet specified");
    });
  });

  describe("tokenizer", () => {
    it("emits defined terms as strong segments", () => {
      const clause1 = renderDocument(completeCoverPage()).clauses[0];
      const strong = clause1.segments
        .filter((segment) => segment.kind === "strong")
        .map((segment) => (segment.kind === "strong" ? segment.text : ""));

      expect(strong).toContain("MNDA");
      expect(strong).toContain("Disclosing Party");
      expect(strong).toContain("Receiving Party");
      expect(strong).toContain("Confidential Information");
    });

    it("leaves no unresolved markup in any clause", () => {
      for (const clause of renderDocument(completeCoverPage()).clauses) {
        const text = segmentsToText(clause.segments);
        expect(text).not.toMatch(/\{\{|\}\}/);
        expect(text).not.toContain("**");
      }
    });

    it("does not mutate its inputs between calls", () => {
      const data = completeCoverPage();
      const first = clauseText(data, 1);
      const second = clauseText(data, 1);
      expect(second).toBe(first);
    });
  });
});

describe("documentTitle", () => {
  it("names both parties once they are known", () => {
    expect(documentTitle(completeCoverPage())).toBe(
      "Mutual NDA - Northwind Labs, Inc. and Kestrel Analytics LLC",
    );
  });

  it("falls back to a generic title until both parties are named", () => {
    const data = completeCoverPage();
    expect(documentTitle({ ...data, partyTwo: { ...data.partyTwo, companyName: "" } })).toBe(
      "Mutual NDA",
    );
    expect(documentTitle(createEmptyCoverPage())).toBe("Mutual NDA");
  });

  it("ignores whitespace-only company names", () => {
    const data = completeCoverPage();
    expect(
      documentTitle({ ...data, partyOne: { ...data.partyOne, companyName: "   " } }),
    ).toBe("Mutual NDA");
  });
});
