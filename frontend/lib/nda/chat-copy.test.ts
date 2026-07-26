import { describe, expect, it } from "vitest";

import { FIELD_LABELS, missingFieldsMessage } from "./chat-copy";
import { createEmptyCoverPage } from "./types";
import { validateCoverPage, type FieldKey } from "./validate";

describe("FIELD_LABELS", () => {
  it("names every field validation can report", () => {
    /*
     * A missing label would render "undefined is still missing" in the one
     * message whose whole job is to say what to type next.
     */
    const reportable = Object.keys(
      validateCoverPage(createEmptyCoverPage()),
    ) as FieldKey[];

    for (const key of reportable) {
      expect(FIELD_LABELS[key]).toBeTruthy();
    }
  });
});

describe("missingFieldsMessage", () => {
  it("reads as a sentence for one missing answer", () => {
    expect(missingFieldsMessage(["governingLaw"])).toBe(
      "Not quite ready — the governing law is still missing. Tell me and I'll add it.",
    );
  });

  it("joins two with 'and'", () => {
    expect(missingFieldsMessage(["governingLaw", "jurisdiction"])).toContain(
      "the governing law and where disputes are heard are still missing",
    );
  });

  it("commas the list and keeps 'and' for the last", () => {
    expect(
      missingFieldsMessage([
        "governingLaw",
        "jurisdiction",
        "partyTwo.companyName",
      ]),
    ).toContain(
      "the governing law, where disputes are heard and party 2's company",
    );
  });
});
