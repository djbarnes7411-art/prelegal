/**
 * The shape of a document as the generated catalog describes it.
 *
 * These mirror what `backend/app/documents/build.py` writes, and are the only
 * description of a document either half of the product has: the field list
 * drives the interview, the validation and the Key Terms page, and the clause
 * tree is the agreement itself.
 */

/** What a fill-in value holds. See FIELD_TYPES in build.py. */
export type FieldType =
  | "party"
  | "date"
  | "money"
  | "text"
  | "longText"
  | "term";

export interface FieldDef {
  /** camelCase identifier; the key values are stored under. */
  key: string;
  /** The defined term as the contract writes it, e.g. "Pilot Period". */
  name: string;
  type: FieldType;
  /** How a person refers to it, e.g. "how long the pilot runs". */
  label: string;
  required: boolean;
  /** Clause numbers citing this field, for the "where does this land?" marks. */
  clauses: string[];
  hint?: string;
  /** `term` fields only: the two sides of the either/or. */
  counted?: string;
  openEnded?: string;
  noun?: string;
  /** Starting value. On a date field, `"today"` means the reader's clock. */
  default?: string;
  defaultYears?: number;
}

export interface DocumentDef {
  slug: string;
  name: string;
  /** The heading the document itself carries. */
  title: string;
  summary: string;
  aliases: string[];
  /** Set when the document supplements another agreement rather than standing alone. */
  attachment: string | null;
  /** "mutual-nda" keeps its own hand-built page; everything else renders generically. */
  renderer: "generic" | "mutual-nda";
  version: string | null;
  sourceUrl: string | null;
  fields: FieldDef[];
}

export interface Catalog {
  documents: DocumentDef[];
}

/* ------------------------------------------------------------------ *
 * Clause text
 * ------------------------------------------------------------------ */

export interface ClauseSegment {
  kind: "text" | "variable";
  /**
   * For a variable, the defined term exactly as the template wrote it —
   * "Customer's", "Subscription Periods" — so the sentence stays grammatical.
   */
  text: string;
  /** Set on a variable: which field supplies the value. */
  key?: string;
  strong?: boolean;
}

export interface Clause {
  /** "1", "1.1", "1.1.a" — the document's own numbering. */
  number: string;
  depth: number;
  heading: string | null;
  segments: ClauseSegment[];
}

export interface ClauseFile {
  slug: string;
  clauses: Clause[];
}

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

export interface PartyValue {
  companyName: string;
  signatoryName: string;
  signatoryTitle: string;
  /** Email or postal address — either is accepted. */
  noticeAddress: string;
}

export interface TermValue {
  /** One of the field's `counted` or `openEnded` names. */
  kind: string;
  /** Only meaningful for the counted choice. */
  years: number | null;
}

export type FieldValue = string | PartyValue | TermValue;

/** Every value of one document being drafted, keyed by field key. */
export type DocumentState = Record<string, FieldValue>;

export function isParty(value: FieldValue | undefined): value is PartyValue {
  return typeof value === "object" && value !== null && "companyName" in value;
}

export function isTerm(value: FieldValue | undefined): value is TermValue {
  return typeof value === "object" && value !== null && "kind" in value;
}
