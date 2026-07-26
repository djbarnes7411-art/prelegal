import { describe, expect, it } from "vitest";

import { findDocument, loadClauses } from "./catalog";
import { documentTitle, renderClauses } from "./render";
import type { Clause, DocumentDef, DocumentState } from "./types";
import { createEmptyState } from "./values";

const pilot = findDocument("pilot-agreement") as DocumentDef;

const clause = (
  number: string,
  segments: Clause["segments"],
  depth = 1,
): Clause => ({ number, depth, heading: null, segments });

const variable = (text: string, key: string, strong = false) => ({
  kind: "variable" as const,
  text,
  key,
  strong,
});

const text = (value: string) => ({ kind: "text" as const, text: value });

function flatten(document: DocumentDef, clauses: Clause[], state: DocumentState) {
  return renderClauses(document, clauses, state)
    .map((rendered) =>
      rendered.segments
        .map((segment) =>
          segment.kind === "text"
            ? segment.text
            : segment.showValue
              ? `${segment.term} (${segment.value})`
              : segment.term,
        )
        .join(""),
    )
    .join("\n");
}

describe("renderClauses", () => {
  it("spells a defined term out with its value on first use", () => {
    const state = { ...createEmptyState(pilot), pilotPeriod: "60 days" };
    const clauses = [clause("1.1", [text("During the "), variable("Pilot Period", "pilotPeriod")])];

    expect(flatten(pilot, clauses, state)).toBe(
      "During the Pilot Period (60 days)",
    );
  });

  it("refers to it by name after that", () => {
    const state = { ...createEmptyState(pilot), pilotPeriod: "60 days" };
    const clauses = [
      clause("1.1", [variable("Pilot Period", "pilotPeriod")]),
      clause("1.2", [variable("Pilot Period", "pilotPeriod")]),
    ];

    expect(flatten(pilot, clauses, state)).toBe(
      "Pilot Period (60 days)\nPilot Period",
    );
  });

  it("keeps the wording the template used, inflection and all", () => {
    const state = createEmptyState(pilot);
    state.customer = {
      companyName: "Acme Inc.",
      signatoryName: "Dana Lee",
      signatoryTitle: "CEO",
      noticeAddress: "legal@acme.test",
    };
    const clauses = [
      clause("1.1", [variable("Customer", "customer")]),
      clause("1.2", [text("on "), variable("Customer's", "customer"), text(" behalf")]),
    ];

    expect(flatten(pilot, clauses, state)).toBe(
      "Customer (Acme Inc.)\non Customer's behalf",
    );
  });

  it("marks an unanswered value rather than dropping the term", () => {
    const clauses = [clause("1.1", [variable("Pilot Period", "pilotPeriod")])];

    const [rendered] = renderClauses(pilot, clauses, createEmptyState(pilot));
    const segment = rendered.segments[0];

    expect(segment.kind).toBe("value");
    if (segment.kind !== "value") return;
    expect(segment.filled).toBe(false);
    expect(segment.value).toContain("how long the pilot runs");
  });

  it("carries emphasis through a value in the middle of it", () => {
    /* The liability caps are conspicuous disclaimers; the bold is operative. */
    const clauses = [
      clause("5.1", [
        { kind: "text", text: "Liability is capped at the ", strong: true },
        variable("General Cap Amount", "generalCapAmount", true),
      ]),
    ];

    const [rendered] = renderClauses(pilot, clauses, createEmptyState(pilot));

    expect(rendered.segments.every((segment) => segment.strong)).toBe(true);
  });

  it("shows the term when a key no longer matches a field", () => {
    /* Silently dropping it would remove words from a contract. */
    const clauses = [clause("1.1", [variable("Ghost Term", "notAField")])];

    const [rendered] = renderClauses(pilot, clauses, createEmptyState(pilot));

    expect(rendered.segments[0]).toEqual({
      kind: "text",
      text: "Ghost Term",
      strong: false,
    });
  });
});

describe("documentTitle", () => {
  it("names both parties once they are known", () => {
    const state = createEmptyState(pilot);
    const party = (companyName: string) => ({
      companyName,
      signatoryName: "Dana Lee",
      signatoryTitle: "CEO",
      noticeAddress: "legal@example.test",
    });
    state.provider = party("Northwind Labs");
    state.customer = party("Kestrel Analytics");

    expect(documentTitle(pilot, state)).toBe(
      "Pilot Agreement - Northwind Labs and Kestrel Analytics",
    );
  });

  it("falls back to the document's name before they are", () => {
    expect(documentTitle(pilot, createEmptyState(pilot))).toBe("Pilot Agreement");
  });
});

describe("loading a document's contract text", () => {
  it("fetches the clauses for a generically rendered document", async () => {
    const file = await loadClauses("pilot-agreement");

    expect(file?.slug).toBe("pilot-agreement");
    expect(file?.clauses.length).toBeGreaterThan(50);
  });

  it("has none for the Mutual NDA, which carries its own transcription", async () => {
    expect(await loadClauses("mutual-nda")).toBeNull();
  });

  it("has none for a document that does not exist", async () => {
    expect(await loadClauses("employment-contract")).toBeNull();
  });

  it("cites only fields the document actually defines", async () => {
    /* The build fails on a mismatch; this is the same promise, from the browser's side. */
    for (const document of [pilot, findDocument("data-processing-agreement")!]) {
      const file = await loadClauses(document.slug);
      const keys = new Set(document.fields.map((field) => field.key));

      for (const item of file?.clauses ?? []) {
        for (const segment of item.segments) {
          if (segment.kind === "variable") expect(keys).toContain(segment.key);
        }
      }
    }
  });
});
