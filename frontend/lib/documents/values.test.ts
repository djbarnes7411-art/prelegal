import { describe, expect, it } from "vitest";

import { DOCUMENTS, findDocument } from "./catalog";
import type { DocumentDef, FieldDef } from "./types";
import {
  countWithNumeral,
  createEmptyState,
  displayValue,
  emptyParty,
  formatIsoDate,
  isAnswered,
  missingFields,
  todayIso,
} from "./values";

const nda = findDocument("mutual-nda") as DocumentDef;
const pilot = findDocument("pilot-agreement") as DocumentDef;

const field = (document: DocumentDef, key: string) =>
  document.fields.find((candidate) => candidate.key === key) as FieldDef;

const filledParty = {
  companyName: "Acme Inc.",
  signatoryName: "Dana Lee",
  signatoryTitle: "Chief Executive Officer",
  noticeAddress: "legal@acme.test",
};

describe("createEmptyState", () => {
  it("gives every field a value", () => {
    const state = createEmptyState(pilot);
    expect(Object.keys(state).sort()).toEqual(
      pilot.fields.map((f) => f.key).sort(),
    );
  });

  it("applies the defaults a definition declares", () => {
    const state = createEmptyState(nda);
    expect(state.purpose).toContain("Evaluating whether to enter into");
  });

  it("seeds today for a date defaulted to it", () => {
    expect(createEmptyState(pilot).effectiveDate).toBe(todayIso());
  });

  it("leaves an undefaulted date blank", () => {
    /* An order date is a business fact, not "whenever you opened this page". */
    const csa = findDocument("cloud-service-agreement") as DocumentDef;
    expect(createEmptyState(csa).orderDate).toBe("");
  });

  it("starts a term on its counted choice", () => {
    expect(createEmptyState(nda).mndaTerm).toEqual({
      kind: "expires",
      years: 1,
    });
  });

  it("starts a party with all four of its fields", () => {
    expect(createEmptyState(pilot).provider).toEqual(emptyParty());
  });
});

describe("isAnswered", () => {
  it("needs every field of a party", () => {
    const provider = field(pilot, "provider");

    expect(isAnswered(provider, filledParty)).toBe(true);
    expect(
      isAnswered(provider, { ...filledParty, signatoryTitle: "  " }),
    ).toBe(false);
  });

  it("accepts the open-ended side of a term without a year count", () => {
    const term = field(nda, "mndaTerm");
    expect(isAnswered(term, { kind: "untilTerminated", years: null })).toBe(true);
  });

  it("rejects a term length that is not a whole count", () => {
    const term = field(nda, "mndaTerm");

    expect(isAnswered(term, { kind: "expires", years: 0 })).toBe(false);
    expect(isAnswered(term, { kind: "expires", years: 1.5 })).toBe(false);
    expect(isAnswered(term, { kind: "expires", years: 2 })).toBe(true);
  });

  it("treats whitespace as unanswered", () => {
    expect(isAnswered(field(pilot, "pilotPeriod"), "   ")).toBe(false);
  });
});

describe("missingFields", () => {
  it("never counts an optional field", () => {
    /* The standard terms read an omitted value as "none". */
    const missing = missingFields(pilot, createEmptyState(pilot));
    expect(missing.every((f) => f.required)).toBe(true);
  });

  it("reports them in the order they are asked", () => {
    const missing = missingFields(pilot, createEmptyState(pilot));
    expect(missing[0].key).toBe("provider");
  });

  it("is empty once every required field is answered", () => {
    const state = createEmptyState(pilot);
    for (const f of pilot.fields) {
      if (f.type === "party") state[f.key] = filledParty;
      else if (f.type === "date") state[f.key] = "2026-08-01";
      else state[f.key] = "something";
    }

    expect(missingFields(pilot, state)).toEqual([]);
  });

  it("counts a party as one answer, not four", () => {
    const state = createEmptyState(nda);
    state.governingLaw = "Delaware";
    state.jurisdiction = "New Castle, DE";

    expect(missingFields(nda, state).map((f) => f.key)).toEqual([
      "partyOne",
      "partyTwo",
    ]);
  });
});

describe("formatting", () => {
  it("formats an ISO date the way a contract reads", () => {
    expect(formatIsoDate("2026-07-26")).toBe("July 26, 2026");
  });

  it("does not shift the day for viewers behind UTC", () => {
    /* Parsed field by field; `new Date(iso)` would read it as UTC midnight. */
    expect(formatIsoDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("returns nothing for a value that is not a date", () => {
    expect(formatIsoDate("next Tuesday")).toBe("");
  });

  it("spells a count the way contracts do", () => {
    expect(countWithNumeral(1, "year")).toBe("one (1) year");
    expect(countWithNumeral(25, "year")).toBe("twenty-five (25) years");
  });

  it("falls back to digits past what it spells", () => {
    expect(countWithNumeral(150, "year")).toBe("150 (150) years");
  });
});

describe("displayValue", () => {
  it("shows a party by its company name", () => {
    expect(displayValue(field(pilot, "provider"), filledParty)).toBe("Acme Inc.");
  });

  it("shows a counted term as a spelled-out length", () => {
    expect(
      displayValue(field(nda, "mndaTerm"), { kind: "expires", years: 3 }),
    ).toBe("three (3) years");
  });

  it("shows nothing for a term whose length is unusable", () => {
    /*
     * A clause reading "the MNDA Term (zero (0) years)" would assert a term
     * nobody chose, while the page above it showed the field as unanswered.
     */
    expect(
      displayValue(field(nda, "mndaTerm"), { kind: "expires", years: 0 }),
    ).toBe("");
  });

  it("shows nothing for the open-ended choice, which has no length", () => {
    expect(
      displayValue(field(nda, "mndaTerm"), { kind: "untilTerminated", years: null }),
    ).toBe("");
  });
});

describe("the catalog itself", () => {
  it("holds every document the product can draft", () => {
    expect(DOCUMENTS).toHaveLength(11);
  });

  it("gives each document a slug, a summary and required fields", () => {
    for (const document of DOCUMENTS) {
      expect(document.slug).toMatch(/^[a-z-]+$/);
      expect(document.summary.length).toBeGreaterThan(20);
      expect(document.fields.some((f) => f.required)).toBe(true);
    }
  });

  it("returns nothing for a slug it does not have", () => {
    expect(findDocument("employment-contract")).toBeNull();
    expect(findDocument(null)).toBeNull();
  });
});
