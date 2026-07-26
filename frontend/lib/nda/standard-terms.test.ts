import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CC_BY_URL,
  STANDARD_TERMS,
  STANDARD_TERMS_URL,
  STANDARD_TERMS_VERSION,
} from "./standard-terms";

/*
 * These tests guard the legal text itself.
 *
 * `standard-terms.ts` is a transcription of `templates/mutual-nda.md`, the
 * canonical Common Paper text in this repo. An accidental edit there would ship
 * altered contract language to whoever signs the output, and no amount of UI
 * testing would notice. So the transcription is diffed against the source on
 * every run, and the only tolerated differences are the ones spelled out in
 * DOCUMENTED_DEVIATIONS below.
 *
 * If one of these tests fails, do not "fix" it by editing the expectation
 * without reading both texts.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SOURCE_PATH = path.join(REPO_ROOT, "templates", "mutual-nda.md");

/** Cover Page tokens, mapped back to the term the source spells out. */
const TOKEN_TO_SOURCE_TERM: Record<string, string> = {
  purpose: "Purpose",
  effectiveDate: "Effective Date",
  mndaTerm: "MNDA Term",
  confidentialityTerm: "Term of Confidentiality",
  governingLaw: "Governing Law",
  jurisdiction: "Jurisdiction",
};

/*
 * Intentional departures from the source, applied to the SOURCE text before
 * comparison. Each one exists because the source repeats a cross-reference
 * inside a sentence, which reads as a broken sentence once the first reference
 * has been replaced with a real value ("...the laws of the State of Delaware,
 * without regard to the conflict of laws provisions of such Governing Law").
 * Adding an entry here is a decision to change contract wording — it needs the
 * same scrutiny as the original transcription.
 */
const DOCUMENTED_DEVIATIONS: Array<{
  clause: number;
  reason: string;
  from: string;
  to: string;
}> = [
  {
    clause: 9,
    reason: "Anaphor for the repeated Governing Law reference",
    from: "conflict of laws provisions of such Governing Law",
    to: "conflict of laws provisions of such State",
  },
  {
    clause: 9,
    reason: "Anaphor for the repeated Jurisdiction reference",
    from: "exclusive jurisdiction of such Jurisdiction",
    to: "exclusive jurisdiction of such courts",
  },
];

interface SourceClause {
  number: number;
  heading: string;
  body: string;
}

/** Parses the numbered clauses out of the canonical markdown. */
function parseSourceClauses(): SourceClause[] {
  const markdown = readFileSync(SOURCE_PATH, "utf8");
  const clauses: SourceClause[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(\d+)\.\s+\*\*(.+?)\*\*\.\s+(.*)$/.exec(line.trim());
    if (!match) continue;

    const [, number, heading, body] = match;
    clauses.push({
      number: Number(number),
      heading,
      // The source links cover-page terms; the term itself is the text.
      body: body.replace(
        /<span class="coverpage_link">(.*?)<\/span>/g,
        (_full, term: string) => term,
      ),
    });
  }

  return clauses;
}

/** Rewrites our `{{token}}` markup back into the term the source uses. */
function toSourceForm(body: string): string {
  return body.replace(/\{\{([a-zA-Z]+)\}\}/g, (full, token: string) => {
    const term = TOKEN_TO_SOURCE_TERM[token];
    if (!term) throw new Error(`Unknown token in standard terms: ${full}`);
    return term;
  });
}

function applyDeviations(clause: SourceClause): string {
  return DOCUMENTED_DEVIATIONS.filter(
    (deviation) => deviation.clause === clause.number,
  ).reduce((body, deviation) => {
    if (!body.includes(deviation.from)) {
      throw new Error(
        `Deviation for clause ${clause.number} no longer matches the source: "${deviation.from}"`,
      );
    }
    return body.replace(deviation.from, deviation.to);
  }, clause.body);
}

const sourceClauses = parseSourceClauses();

describe("standard terms structure", () => {
  it("has eleven clauses numbered consecutively", () => {
    expect(STANDARD_TERMS).toHaveLength(11);
    expect(STANDARD_TERMS.map((clause) => clause.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("uses only known cover-page tokens", () => {
    for (const clause of STANDARD_TERMS) {
      for (const [, token] of clause.body.matchAll(/\{\{([a-zA-Z]+)\}\}/g)) {
        expect(Object.keys(TOKEN_TO_SOURCE_TERM)).toContain(token);
      }
    }
  });

  it("has balanced bold markers in every clause", () => {
    for (const clause of STANDARD_TERMS) {
      const markers = clause.body.match(/\*\*/g) ?? [];
      expect(markers.length % 2, `clause ${clause.number}`).toBe(0);
    }
  });

  it("carries no leftover HTML from the source markdown", () => {
    for (const clause of STANDARD_TERMS) {
      expect(clause.body).not.toContain("<span");
      expect(clause.body).not.toContain("</span>");
    }
  });

  it("points at the canonical version and licence", () => {
    expect(STANDARD_TERMS_VERSION).toBe("1.0");
    expect(STANDARD_TERMS_URL).toBe(
      "https://commonpaper.com/standards/mutual-nda/1.0",
    );
    expect(CC_BY_URL).toBe("https://creativecommons.org/licenses/by/4.0/");
  });
});

describe("fidelity to templates/mutual-nda.md", () => {
  it("finds eleven clauses in the source template", () => {
    expect(sourceClauses).toHaveLength(11);
  });

  it("reproduces every clause heading verbatim", () => {
    for (const source of sourceClauses) {
      const ours = STANDARD_TERMS.find((clause) => clause.number === source.number);
      expect(ours?.heading, `clause ${source.number} heading`).toBe(source.heading);
    }
  });

  it.each(sourceClauses.map((clause) => [clause.number] as const))(
    "reproduces clause %i verbatim, apart from documented deviations",
    (number) => {
      const source = sourceClauses.find((clause) => clause.number === number);
      const ours = STANDARD_TERMS.find((clause) => clause.number === number);

      expect(source).toBeDefined();
      expect(ours).toBeDefined();
      expect(toSourceForm(ours!.body)).toBe(applyDeviations(source!));
    },
  );

  it("keeps the deviation list to the two known clause 9 anaphors", () => {
    expect(DOCUMENTED_DEVIATIONS).toHaveLength(2);
    expect(DOCUMENTED_DEVIATIONS.every((d) => d.clause === 9)).toBe(true);
  });
});
