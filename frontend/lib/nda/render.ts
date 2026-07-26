/**
 * Turns a `CoverPageData` into the text the document actually shows: formatted
 * cover-page values, and Standard Terms clauses tokenized into renderable segments
 * with Cover Page references resolved.
 *
 * Everything here is pure — the React layer only walks the output.
 */

import {
  STANDARD_TERMS,
  type Clause,
} from "./standard-terms";
import type {
  ConfidentialityTerm,
  CoverPageData,
  MndaTerm,
} from "./types";

/* ------------------------------------------------------------------ *
 * Value formatting
 * ------------------------------------------------------------------ */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/**
 * Formats an ISO `YYYY-MM-DD` string as "July 26, 2026".
 *
 * Parsed field-by-field rather than via `new Date(iso)`, which would read the
 * string as UTC midnight and shift the day backwards for viewers behind UTC.
 */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return "";

  return `${monthName} ${Number(day)}, ${year}`;
}

/** Renders a count the way contracts do: "one (1) year", "three (3) years". */
export function countWithNumeral(count: number, noun: string): string {
  const word = SMALL_NUMBERS[count] ?? String(count);
  const plural = count === 1 ? noun : `${noun}s`;
  return `${word} (${count}) ${plural}`;
}

export function mndaTermPhrase(term: MndaTerm): string {
  return term.kind === "expires"
    ? `${countWithNumeral(term.years, "year")} from the Effective Date`
    : "which continues until terminated in accordance with the terms of this MNDA";
}

export function confidentialityTermPhrase(term: ConfidentialityTerm): string {
  return term.kind === "years"
    ? `${countWithNumeral(term.years, "year")} from the Effective Date, but in the ` +
        "case of trade secrets until the Confidential Information is no longer " +
        "considered a trade secret under applicable laws"
    : "in perpetuity";
}

/** Drops a single trailing period so a value reads cleanly inside parentheses. */
function withoutTrailingPeriod(value: string): string {
  return value.replace(/\.\s*$/, "");
}

/* ------------------------------------------------------------------ *
 * Cover Page references
 * ------------------------------------------------------------------ */

interface Reference {
  /**
   * The defined term as it appears in the Standard Terms ("Purpose"), or `null`
   * when the source links a bare value into the sentence instead of a term —
   * clause 9 reads "the laws of the State of Delaware", not "…of the Governing Law".
   */
  term: string | null;
  value: string;
  /** Shown in place of a blank value while the form is incomplete. */
  placeholder: string;
}

function referencesFor(data: CoverPageData): Record<string, Reference> {
  return {
    purpose: {
      term: "Purpose",
      value: withoutTrailingPeriod(data.purpose.trim()),
      placeholder: "purpose not yet specified",
    },
    effectiveDate: {
      term: "Effective Date",
      value: formatIsoDate(data.effectiveDate),
      placeholder: "date not yet specified",
    },
    mndaTerm: {
      term: "MNDA Term",
      value: mndaTermPhrase(data.mndaTerm),
      placeholder: "",
    },
    confidentialityTerm: {
      term: "Term of Confidentiality",
      value: confidentialityTermPhrase(data.confidentialityTerm),
      placeholder: "",
    },
    governingLaw: {
      term: null,
      value: data.governingLaw.trim(),
      placeholder: "[Governing Law]",
    },
    jurisdiction: {
      term: null,
      value: data.jurisdiction.trim(),
      placeholder: "[Jurisdiction]",
    },
  };
}

/* ------------------------------------------------------------------ *
 * Clause tokenization
 * ------------------------------------------------------------------ */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | {
      kind: "reference";
      /** Defined term to print, or `null` to print the value on its own. */
      term: string | null;
      value: string;
      /** Whether to print the value alongside the term. */
      showValue: boolean;
      /** False while the underlying form field is still blank. */
      filled: boolean;
    };

export interface RenderedClause extends Pick<Clause, "number" | "heading"> {
  segments: Segment[];
}

/** Matches `**bold**` and `{{token}}` while keeping the surrounding text. */
const MARKUP = /(\*\*[^*]+\*\*|\{\{[a-zA-Z]+\}\})/g;

/**
 * Splits one clause body into segments.
 *
 * `expanded` tracks which references have already printed their value earlier in
 * the document, so a defined term is spelled out on first use and referred to by
 * name after that — repeating the full Purpose on every mention would be unreadable.
 */
function tokenize(
  body: string,
  references: Record<string, Reference>,
  expanded: Set<string>,
): Segment[] {
  const segments: Segment[] = [];

  for (const part of body.split(MARKUP)) {
    if (!part) continue;

    if (part.startsWith("**") && part.endsWith("**")) {
      segments.push({ kind: "strong", text: part.slice(2, -2) });
      continue;
    }

    if (part.startsWith("{{") && part.endsWith("}}")) {
      const name = part.slice(2, -2);
      const reference = references[name];
      if (!reference) {
        // Unknown token: show it rather than silently dropping contract text.
        segments.push({ kind: "text", text: part });
        continue;
      }

      const filled = reference.value.length > 0;
      segments.push({
        kind: "reference",
        term: reference.term,
        value: filled ? reference.value : reference.placeholder,
        showValue: reference.term === null || !expanded.has(name),
        filled,
      });
      expanded.add(name);
      continue;
    }

    segments.push({ kind: "text", text: part });
  }

  return segments;
}

/* ------------------------------------------------------------------ *
 * Document model
 * ------------------------------------------------------------------ */

export interface DocumentModel {
  /** "July 26, 2026", or "" if the date is unset. */
  effectiveDate: string;
  mndaTerm: string;
  confidentialityTerm: string;
  clauses: RenderedClause[];
}

export function renderDocument(data: CoverPageData): DocumentModel {
  const references = referencesFor(data);
  const expanded = new Set<string>();

  return {
    effectiveDate: formatIsoDate(data.effectiveDate),
    mndaTerm: mndaTermPhrase(data.mndaTerm),
    confidentialityTerm: confidentialityTermPhrase(data.confidentialityTerm),
    clauses: STANDARD_TERMS.map((clause) => ({
      number: clause.number,
      heading: clause.heading,
      segments: tokenize(clause.body, references, expanded),
    })),
  };
}

/**
 * Suggested document name. Browsers use `document.title` as the default filename
 * in the "Save as PDF" dialog, so this becomes the name of the downloaded file.
 */
export function documentTitle(data: CoverPageData): string {
  const names = [data.partyOne.companyName, data.partyTwo.companyName]
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length === 2
    ? `Mutual NDA - ${names[0]} and ${names[1]}`
    : "Mutual NDA";
}
