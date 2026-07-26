/**
 * Which clauses a change touches.
 *
 * The form marked the Standard Terms a section fed while it had focus. There is
 * no focus to read any more, so the same links are drawn from what the
 * assistant just changed — the question the highlight always answered ("where
 * does this land in the agreement?") is unchanged, only its trigger.
 */

import type { CoverPageData } from "./types";

/** The clause numbers each field feeds, as the form's groups had them. */
const CLAUSES_BY_FIELD: Record<keyof CoverPageData, number[]> = {
  purpose: [1, 2],
  effectiveDate: [5],
  mndaTerm: [5],
  confidentialityTerm: [5],
  governingLaw: [9],
  jurisdiction: [9],
  modifications: [],
  partyOne: [11],
  partyTwo: [11],
};

/** The clauses a patch reaches, in the order they appear in the document. */
export function clausesForPatch(patch: Partial<CoverPageData>): number[] {
  const clauses = new Set<number>();

  for (const field of Object.keys(patch) as Array<keyof CoverPageData>) {
    for (const clause of CLAUSES_BY_FIELD[field] ?? []) clauses.add(clause);
  }

  return [...clauses].sort((a, b) => a - b);
}
