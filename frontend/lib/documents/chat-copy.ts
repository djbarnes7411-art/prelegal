/**
 * The words the product says for itself.
 *
 * Everything here is written by us, not generated: the greeting, the privacy
 * notice, and the two nudges about what is still missing. Keeping them out of
 * the model's hands is the point — a greeting should not cost a round trip or
 * depend on an API key, and a list of unanswered fields should be counted, not
 * recalled.
 */

import type { DocumentDef, FieldDef } from "./types";

/**
 * The first thing on screen, before anything is sent anywhere.
 *
 * It does not list the documents: they are on the panel beside the
 * conversation, and reading eleven names aloud is a worse introduction than
 * showing them.
 */
export const WELCOME_MESSAGE =
  "Hi — I can help you draft any of the agreements listed beside this " +
  "conversation. Tell me what you need in your own words, and I'll find the " +
  "closest one and fill it in with you. What are you trying to put in place?";

/** Shown above the conversation, always, without a way to dismiss it. */
export const PRIVACY_NOTICE =
  "What you type here, and the values on the document, are sent to our AI " +
  "provider to draft it. Nothing is stored after you close the tab.";

/** Said once the last required blank is filled, however it happened. */
export function completedMessage(document: DocumentDef): string {
  return (
    `That's everything the ${document.name} needs. Have a read of the ` +
    "document, then use Download PDF when you're happy with it."
  );
}

/** "a, b and c" — the way the nudge needs to read mid-sentence. */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What to say when Download PDF is pressed too early.
 *
 * Counted from the same check that gates the button, so it cannot claim the
 * document is short of something it already has.
 */
export function missingFieldsMessage(missing: FieldDef[]): string {
  const labels = missing.map((field) => field.label);
  const needs =
    labels.length === 1 ? `${labels[0]} is` : `${sentenceList(labels)} are`;
  return `Not quite ready — ${needs} still missing. Tell me and I'll add it.`;
}
