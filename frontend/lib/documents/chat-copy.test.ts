import { describe, expect, it } from "vitest";

import {
  completedMessage,
  DRAFT_DISCLAIMER,
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

  it("says plainly where what you type goes, and that it is kept", () => {
    /*
     * Keep this honest as scope grows — it is the only notice the user gets.
     * It used to say nothing was stored; since drafts are saved to the account,
     * what is still true is that nothing survives a restart, and it says that
     * instead rather than going quiet on the subject.
     */
    expect(PRIVACY_NOTICE).toContain("AI provider");
    expect(PRIVACY_NOTICE).toContain("saved to your account");
    expect(PRIVACY_NOTICE).toContain("Nothing survives the server restarting");
    expect(PRIVACY_NOTICE).not.toContain("Nothing is stored");
  });

  it("names the document it just finished", () => {
    expect(completedMessage(nda)).toContain("Mutual NDA");
    expect(completedMessage(nda)).toContain("Download PDF");
  });
});

describe("the draft disclaimer", () => {
  it("says it is a draft, not advice, and wants a lawyer", () => {
    expect(DRAFT_DISCLAIMER).toContain("draft");
    expect(DRAFT_DISCLAIMER).toContain("not legal advice");
    expect(DRAFT_DISCLAIMER).toMatch(/counsel review it before signing/i);
  });

  it("does not hedge about whether a lawyer is needed", () => {
    expect(DRAFT_DISCLAIMER).not.toMatch(/may want|consider|if you wish/i);
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
