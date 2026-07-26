/**
 * Starting values, completeness, and how a value reads on the page.
 *
 * The mirror of `backend/app/documents/values.py`, minus the sanitising: the
 * backend decides what a model's answer is allowed to become, and this side
 * decides what the resulting document shows and whether it can be downloaded.
 */

import type {
  DocumentDef,
  DocumentState,
  FieldDef,
  FieldValue,
  PartyValue,
  TermValue,
} from "./types";
import { isParty, isTerm } from "./types";

export const PARTY_PARTS = [
  "companyName",
  "signatoryName",
  "signatoryTitle",
  "noticeAddress",
] as const;

export function emptyParty(): PartyValue {
  return {
    companyName: "",
    signatoryName: "",
    signatoryTitle: "",
    noticeAddress: "",
  };
}

/** Today in the viewer's local timezone, as `YYYY-MM-DD`. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The values a document starts with.
 *
 * Reads the local clock for any field defaulted to "today", so it must only run
 * in the browser — see the note in `app/draft/page.tsx` about why the workspace
 * is not server-rendered.
 */
export function createEmptyState(document: DocumentDef): DocumentState {
  const state: DocumentState = {};

  for (const field of document.fields) {
    if (field.type === "party") {
      state[field.key] = emptyParty();
    } else if (field.type === "term") {
      state[field.key] = {
        kind: field.counted ?? "",
        years: field.defaultYears ?? null,
      };
    } else if (field.type === "date") {
      state[field.key] = field.default === "today" ? todayIso() : "";
    } else {
      state[field.key] = field.default ?? "";
    }
  }

  return state;
}

/** Whether a year count is a usable term length. */
export function isWholeYearCount(years: number | null | undefined): boolean {
  return typeof years === "number" && Number.isInteger(years) && years >= 1;
}

/** Whether this field holds something the finished document could print. */
export function isAnswered(field: FieldDef, value: FieldValue | undefined): boolean {
  if (field.type === "party") {
    if (!isParty(value)) return false;
    return PARTY_PARTS.every((part) => value[part].trim().length > 0);
  }

  if (field.type === "term") {
    if (!isTerm(value)) return false;
    if (value.kind === field.openEnded) return true;
    return isWholeYearCount(value.years);
  }

  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Required fields still waiting for an answer, in the order they are asked.
 *
 * Gates the download and feeds the "still missing" nudge. Optional fields are
 * never counted: the standard terms read an omitted value as "none", so a
 * document without them is finished, not incomplete.
 */
export function missingFields(
  document: DocumentDef,
  state: DocumentState,
): FieldDef[] {
  return document.fields.filter(
    (field) => field.required && !isAnswered(field, state[field.key]),
  );
}

/* ------------------------------------------------------------------ *
 * Formatting
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

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];

const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
];

/**
 * Spells a whole number below one hundred.
 *
 * Term lengths in practice are single or low double digit years; anything
 * larger falls back to digits rather than growing a full implementation.
 */
function spell(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count >= 100) return String(count);
  if (count < 20) return ONES[count];

  const tens = TENS[Math.floor(count / 10)];
  const ones = count % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

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

/** Renders a count the way contracts do: "one (1) year", "twenty-five (25) years". */
export function countWithNumeral(count: number, noun: string): string {
  const plural = count === 1 ? noun : `${noun}s`;
  return `${spell(count)} (${count}) ${plural}`;
}

/**
 * What a field's value reads as inside the agreement.
 *
 * Returns "" when the value is not usable yet, so the caller can print a blank
 * rather than describing a term nobody chose.
 */
export function displayValue(
  field: FieldDef,
  value: FieldValue | undefined,
): string {
  if (field.type === "party") {
    return isParty(value) ? value.companyName.trim() : "";
  }

  if (field.type === "term") {
    if (!isTerm(value)) return "";
    if (value.kind === field.openEnded) return "";
    return isWholeYearCount(value.years)
      ? countWithNumeral(value.years as number, field.noun ?? "year")
      : "";
  }

  if (field.type === "date") {
    return typeof value === "string" ? formatIsoDate(value) : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

export type { TermValue };
