import { describe, expect, it } from "vitest";

import { clausesForPatch } from "./chat-support";

describe("clausesForPatch", () => {
  it("marks both clauses the purpose rewrites", () => {
    expect(clausesForPatch({ purpose: "Discussing an acquisition." })).toEqual([
      1, 2,
    ]);
  });

  it("marks the governing law clause", () => {
    expect(clausesForPatch({ governingLaw: "Delaware" })).toEqual([9]);
  });

  it("marks the notices clause when a party changes", () => {
    expect(
      clausesForPatch({
        partyOne: {
          companyName: "Northwind Labs, Inc.",
          signatoryName: "Dana Reyes",
          signatoryTitle: "CEO",
          noticeAddress: "legal@northwindlabs.com",
        },
      }),
    ).toEqual([11]);
  });

  it("gathers a turn that answered several things at once", () => {
    expect(
      clausesForPatch({
        purpose: "Discussing an acquisition.",
        governingLaw: "Delaware",
        jurisdiction: "New Castle, DE",
      }),
    ).toEqual([1, 2, 9]);
  });

  it("never names a clause twice", () => {
    expect(
      clausesForPatch({
        effectiveDate: "2026-08-01",
        mndaTerm: { kind: "expires", years: 2 },
        confidentialityTerm: { kind: "perpetuity" },
      }),
    ).toEqual([5]);
  });

  it("marks nothing for a change the standard terms never mention", () => {
    expect(clausesForPatch({ modifications: "Section 5 is amended." })).toEqual(
      [],
    );
  });

  it("marks nothing when the turn changed nothing", () => {
    expect(clausesForPatch({})).toEqual([]);
  });
});
