/**
 * Required-field checks for the Cover Page.
 *
 * The preview always renders — a half-filled agreement still shows its blanks —
 * so validation only gates the download, where an unsigned-but-incomplete PDF
 * would be the thing that actually causes harm.
 */

import type { CoverPageData } from "./types";

export type FieldKey =
  | "purpose"
  | "effectiveDate"
  | "modifications"
  | "mndaTerm.years"
  | "confidentialityTerm.years"
  | "governingLaw"
  | "jurisdiction"
  | `${"partyOne" | "partyTwo"}.${
      | "companyName"
      | "signatoryName"
      | "signatoryTitle"
      | "noticeAddress"}`;

export type FieldErrors = Partial<Record<FieldKey, string>>;

const REQUIRED = "Required";

export function validateCoverPage(data: CoverPageData): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.purpose.trim()) errors.purpose = REQUIRED;
  if (!data.effectiveDate) errors.effectiveDate = REQUIRED;
  if (!data.governingLaw.trim()) errors.governingLaw = REQUIRED;
  if (!data.jurisdiction.trim()) errors.jurisdiction = REQUIRED;

  if (data.mndaTerm.kind === "expires" && !isWholeYear(data.mndaTerm.years)) {
    errors["mndaTerm.years"] = "Enter a whole number of years";
  }

  if (
    data.confidentialityTerm.kind === "years" &&
    !isWholeYear(data.confidentialityTerm.years)
  ) {
    errors["confidentialityTerm.years"] = "Enter a whole number of years";
  }

  for (const party of ["partyOne", "partyTwo"] as const) {
    if (!data[party].companyName.trim()) {
      errors[`${party}.companyName`] = REQUIRED;
    }
    if (!data[party].signatoryName.trim()) {
      errors[`${party}.signatoryName`] = REQUIRED;
    }
    if (!data[party].signatoryTitle.trim()) {
      errors[`${party}.signatoryTitle`] = REQUIRED;
    }
    if (!data[party].noticeAddress.trim()) {
      errors[`${party}.noticeAddress`] = REQUIRED;
    }
  }

  return errors;
}

function isWholeYear(years: number): boolean {
  return Number.isInteger(years) && years >= 1;
}

export function countErrors(errors: FieldErrors): number {
  return Object.keys(errors).length;
}
