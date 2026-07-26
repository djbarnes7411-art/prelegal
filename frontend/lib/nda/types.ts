/**
 * Data model for the Common Paper Mutual NDA (Version 1.0) Cover Page.
 *
 * Field names mirror the headings on the published cover page so this schema,
 * the rendered document, and the source template in
 * `templates/mutual-nda-coverpage.md` stay easy to line up against one another.
 * The assistant is told these same names, so they reach the model too.
 */

/** How long the MNDA itself lasts. Mirrors the cover page's checkbox pair. */
export type MndaTerm =
  | { kind: "expires"; years: number }
  | { kind: "untilTerminated" };

/** How long confidentiality obligations survive. Mirrors the cover page's checkbox pair. */
export type ConfidentialityTerm =
  | { kind: "years"; years: number }
  | { kind: "perpetuity" };

export interface Party {
  companyName: string;
  signatoryName: string;
  signatoryTitle: string;
  /** Email or postal address — the cover page accepts either. */
  noticeAddress: string;
}

export interface CoverPageData {
  purpose: string;
  /** ISO `YYYY-MM-DD`, as produced by `<input type="date">`. */
  effectiveDate: string;
  mndaTerm: MndaTerm;
  confidentialityTerm: ConfidentialityTerm;
  /** US state whose law governs, e.g. "Delaware". */
  governingLaw: string;
  /** City or county and state, e.g. "New Castle, DE". */
  jurisdiction: string;
  /** Free-text list of modifications to the Standard Terms. Optional. */
  modifications: string;
  partyOne: Party;
  partyTwo: Party;
}

/**
 * Whether a year count is a usable term length.
 *
 * Shared by validation and rendering so the two never disagree: a number input
 * mid-edit holds 0 (cleared), and can hold negatives or decimals despite `min`
 * and `step`, none of which may be described in the agreement as a real term.
 */
export function isWholeYearCount(years: number): boolean {
  return Number.isInteger(years) && years >= 1;
}

/** True once the MNDA term describes a definite length. */
export function isMndaTermSpecified(term: MndaTerm): boolean {
  return term.kind === "untilTerminated" || isWholeYearCount(term.years);
}

/** True once the confidentiality term describes a definite length. */
export function isConfidentialityTermSpecified(
  term: ConfidentialityTerm,
): boolean {
  return term.kind === "perpetuity" || isWholeYearCount(term.years);
}

/** The cover page's own suggested Purpose, used as the starting value. */
export const DEFAULT_PURPOSE =
  "Evaluating whether to enter into a business relationship with the other party.";

const emptyParty = (): Party => ({
  companyName: "",
  signatoryName: "",
  signatoryTitle: "",
  noticeAddress: "",
});

/** Today in the viewer's local timezone, as `YYYY-MM-DD`. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Starting values, including today as the effective date.
 *
 * Reads the local clock, so it must only run in the browser — see the note in
 * `app/page.tsx` about why the workspace is not server-rendered.
 */
export function createEmptyCoverPage(): CoverPageData {
  return {
    purpose: DEFAULT_PURPOSE,
    effectiveDate: todayIso(),
    mndaTerm: { kind: "expires", years: 1 },
    confidentialityTerm: { kind: "years", years: 1 },
    governingLaw: "",
    jurisdiction: "",
    modifications: "",
    partyOne: emptyParty(),
    partyTwo: emptyParty(),
  };
}
