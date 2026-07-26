import { describe, expect, it } from "vitest";

import {
  completedMessage,
  missingFieldsMessage,
  PRIVACY_NOTICE,
  WELCOME_MESSAGE,
} from "./chat-copy";
import { findDocument } from "./catalog";
import type { DocumentDef, FieldDef } from "./types";

const nda = findDocument("mutual-nda") as DocumentDef;

const fieldsNamed = (...labels: string[]) =>
  labels.map((label) => ({ label }) as FieldDef);

describe("what the product says for itself", () => {
  it("greets without naming a document, since none is chosen yet", () => {
    expect(WELCOME_MESSAGE).not.toContain("Mutual NDA");
    expect(WELCOME_MESSAGE).toMatch(/\?$/);
  });

  it("says plainly where what you type goes", () => {
    /* Keep this honest as scope grows — it is the only notice the user gets. */
    expect(PRIVACY_NOTICE).toContain("AI provider");
    expect(PRIVACY_NOTICE).toContain("Nothing is stored");
  });

  it("names the document it just finished", () => {
    expect(completedMessage(nda)).toContain("Mutual NDA");
    expect(completedMessage(nda)).toContain("Download PDF");
  });
});

describe("missingFieldsMessage", () => {
  it("reads as a sentence for one field", () => {
    expect(missingFieldsMessage(fieldsNamed("the governing law"))).toBe(
      "Not quite ready — the governing law is still missing. Tell me and I'll add it.",
    );
  });

  it("joins several the way a sentence would", () => {
    expect(
      missingFieldsMessage(fieldsNamed("the first company", "the second company")),
    ).toContain("the first company and the second company are still missing");
  });

  it("uses commas before the final and", () => {
    expect(missingFieldsMessage(fieldsNamed("a", "b", "c"))).toContain(
      "a, b and c are",
    );
  });
});
