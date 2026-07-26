/**
 * Turns a document's clauses and the user's answers into printable text.
 *
 * Everything here is pure — the React layer only walks the output.
 *
 * The rule that makes this read like a contract rather than a mail merge: a
 * defined term is spelled out with its value on first use and referred to by
 * name after that. "During the Pilot Period (60 days from the Effective Date),
 * Customer (Acme Inc.) may..." and thereafter simply "Customer". Repeating the
 * full value at every mention would be unreadable, and substituting it silently
 * would lose the defined term the rest of the agreement depends on.
 */

import { findField } from "./catalog";
import type {
  Clause,
  DocumentDef,
  DocumentState,
  FieldDef,
} from "./types";
import { displayValue } from "./values";

export type RenderedSegment =
  | { kind: "text"; text: string; strong: boolean }
  | {
      kind: "value";
      /** The defined term, exactly as the clause writes it. */
      term: string;
      /** The value, or the placeholder while the field is blank. */
      value: string;
      /** Whether to print the value alongside the term. */
      showValue: boolean;
      /** False while the underlying field is still blank. */
      filled: boolean;
      strong: boolean;
    };

export interface RenderedClause {
  number: string;
  depth: number;
  heading: string | null;
  segments: RenderedSegment[];
}

function placeholderFor(field: FieldDef): string {
  return `${field.label} not yet specified`;
}

/**
 * Resolves every clause against the current answers.
 *
 * `expanded` is threaded across the whole document, not per clause, so a term
 * defined in clause 1 is not re-expanded in clause 9.
 */
export function renderClauses(
  document: DocumentDef,
  clauses: Clause[],
  state: DocumentState,
): RenderedClause[] {
  const expanded = new Set<string>();

  return clauses.map((clause) => ({
    number: clause.number,
    depth: clause.depth,
    heading: clause.heading,
    segments: clause.segments.map((segment): RenderedSegment => {
      const strong = segment.strong === true;

      if (segment.kind === "text" || !segment.key) {
        return { kind: "text", text: segment.text, strong };
      }

      const field = findField(document, segment.key);
      if (!field) {
        // Unknown key: show the term rather than silently dropping contract text.
        return { kind: "text", text: segment.text, strong };
      }

      const value = displayValue(field, state[field.key]);
      const filled = value.length > 0;
      const showValue = !expanded.has(field.key);
      expanded.add(field.key);

      return {
        kind: "value",
        term: segment.text,
        value: filled ? value : placeholderFor(field),
        showValue,
        filled,
        strong,
      };
    }),
  }));
}

/**
 * Suggested document name. Browsers use `document.title` as the default
 * filename in the "Save as PDF" dialog, so this becomes the downloaded file's
 * name.
 */
export function documentTitle(
  document: DocumentDef,
  state: DocumentState,
): string {
  const names = document.fields
    .filter((field) => field.type === "party")
    .map((field) => displayValue(field, state[field.key]))
    .filter(Boolean);

  return names.length >= 2
    ? `${document.name} - ${names[0]} and ${names[1]}`
    : document.name;
}
