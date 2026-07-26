/**
 * The words the product says for itself.
 *
 * Everything here is written by us, not generated: the greeting, the privacy
 * notice, and the two nudges about what is still missing. Keeping them out of
 * the model's hands is the point — a greeting should not cost a round trip or
 * depend on an API key, and a list of unanswered fields should be counted, not
 * recalled.
 */

import type { FieldKey } from "./validate";

/**
 * The first thing on screen, before anything is sent anywhere.
 *
 * It names the fields `createEmptyCoverPage` already filled in, because the
 * document beside it is not blank and pretending otherwise would be the first
 * thing the user noticed.
 */
export const OPENING_MESSAGE =
  "Hi — I'll help you fill in this Mutual NDA. I've started it off with the " +
  "standard Purpose, today's date, and one-year terms; say the word and we'll " +
  "change any of them. Let's begin with the two companies: what are they " +
  "called, and who signs for each?";

/** Shown above the conversation, always, without a way to dismiss it. */
export const PRIVACY_NOTICE =
  "What you type here, and the values on the cover page, are sent to our AI " +
  "provider to draft this document. Nothing is stored after you close the tab.";

/** Said once the last blank is filled, however it happened. */
export const COMPLETED_MESSAGE =
  "That's everything the cover page needs. Have a read of the document, then " +
  "use Download PDF when you're happy with it.";

/** How each field is named to a person, for the "still missing" nudge. */
export const FIELD_LABELS: Record<FieldKey, string> = {
  purpose: "the purpose",
  effectiveDate: "the effective date",
  modifications: "modifications",
  "mndaTerm.years": "how long the NDA runs",
  "confidentialityTerm.years": "how long information stays protected",
  governingLaw: "the governing law",
  jurisdiction: "where disputes are heard",
  "partyOne.companyName": "party 1's company",
  "partyOne.signatoryName": "who signs for party 1",
  "partyOne.signatoryTitle": "party 1's signatory title",
  "partyOne.noticeAddress": "party 1's notice address",
  "partyTwo.companyName": "party 2's company",
  "partyTwo.signatoryName": "who signs for party 2",
  "partyTwo.signatoryTitle": "party 2's signatory title",
  "partyTwo.noticeAddress": "party 2's notice address",
};

/** "a, b and c" — the way the nudge needs to read mid-sentence. */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What to say when Download PDF is pressed too early.
 *
 * Counted from the same validation that gates the button, so it cannot claim
 * the document is short of something it already has.
 */
export function missingFieldsMessage(missing: FieldKey[]): string {
  const labels = missing.map((key) => FIELD_LABELS[key]);
  const needs =
    labels.length === 1
      ? `${labels[0]} is`
      : `${sentenceList(labels)} are`;
  return `Not quite ready — ${needs} still missing. Tell me and I'll add it.`;
}
