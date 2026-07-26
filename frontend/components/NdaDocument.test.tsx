import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NdaDocument } from "./NdaDocument";
import { createEmptyCoverPage, type CoverPageData } from "@/lib/nda/types";

function completeCoverPage(overrides: Partial<CoverPageData> = {}): CoverPageData {
  return {
    ...createEmptyCoverPage(),
    effectiveDate: "2026-07-26",
    governingLaw: "Delaware",
    jurisdiction: "New Castle, DE",
    partyOne: {
      companyName: "Northwind Labs, Inc.",
      signatoryName: "Dana Reyes",
      signatoryTitle: "Chief Executive Officer",
      noticeAddress: "legal@northwindlabs.com",
    },
    partyTwo: {
      companyName: "Kestrel Analytics LLC",
      signatoryName: "Sam Okonkwo",
      signatoryTitle: "Head of Partnerships",
      noticeAddress: "410 Bridge St, Austin, TX 78701",
    },
    ...overrides,
  };
}

function renderDoc(data: CoverPageData, activeClauses: number[] = []) {
  return render(<NdaDocument data={data} activeClauses={activeClauses} />);
}

/**
 * Scopes a query to one Cover Page section.
 *
 * Answers deliberately appear twice — once on the Cover Page and again resolved
 * into the Standard Terms — so an unscoped query for a value is ambiguous by
 * design, not by accident.
 */
function coverPageSection(container: HTMLElement, heading: string): HTMLElement {
  const node = [...container.querySelectorAll(".doc-heading")].find(
    (candidate) => candidate.textContent === heading,
  );
  const section = node?.closest(".doc-section");
  if (!section) throw new Error(`No cover page section headed "${heading}"`);
  return section as HTMLElement;
}

describe("NdaDocument", () => {
  it("titles the agreement and labels the cover page", () => {
    const { container } = renderDoc(completeCoverPage());
    expect(
      screen.getByRole("heading", { name: "Mutual Non-Disclosure Agreement" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".doc-eyebrow")).toHaveTextContent("Cover Page");
  });

  it("renders every cover-page section from the source template", () => {
    renderDoc(completeCoverPage());
    for (const heading of [
      "Purpose",
      "Effective Date",
      "MNDA Term",
      "Term of Confidentiality",
      "Governing Law & Jurisdiction",
      "MNDA Modifications",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  describe("supplied values", () => {
    it("shows the effective date in long form", () => {
      const { container } = renderDoc(completeCoverPage());
      const section = coverPageSection(container, "Effective Date");
      expect(within(section).getByText("July 26, 2026")).toBeInTheDocument();
    });

    it("shows the governing law and jurisdiction", () => {
      const { container } = renderDoc(completeCoverPage());
      const section = coverPageSection(container, "Governing Law & Jurisdiction");
      expect(within(section).getByText("Delaware")).toBeInTheDocument();
      expect(within(section).getByText("New Castle, DE")).toBeInTheDocument();
    });

    it("marks supplied values as the second ink", () => {
      const { container } = renderDoc(completeCoverPage());
      const section = coverPageSection(container, "Effective Date");
      expect(within(section).getByText("July 26, 2026").className).toMatch(/ink/);
      expect(container.querySelectorAll(".ink, .ink-field").length).toBeGreaterThan(0);
    });

    it("repeats each answer into the standard terms as well as the cover page", () => {
      renderDoc(completeCoverPage());
      // Once on the Cover Page, once resolved into clause 9.
      expect(screen.getAllByText("Delaware")).toHaveLength(2);
    });

    it("renders modifications when given, and 'None.' when not", () => {
      const { unmount } = renderDoc(completeCoverPage({ modifications: "" }));
      expect(screen.getByText("None.")).toBeInTheDocument();
      unmount();

      renderDoc(completeCoverPage({ modifications: "Clause 8 is deleted." }));
      expect(screen.getByText("Clause 8 is deleted.")).toBeInTheDocument();
    });
  });

  describe("unanswered fields", () => {
    it("shows a marked blank rather than an empty gap", () => {
      const { container } = renderDoc(
        completeCoverPage({ governingLaw: "", jurisdiction: "" }),
      );
      expect(screen.getAllByText("state").length).toBeGreaterThan(0);
      expect(container.querySelectorAll(".blank").length).toBeGreaterThan(0);
    });

    it("still renders all eleven clauses on a blank form", () => {
      const { container } = renderDoc(createEmptyCoverPage());
      expect(container.querySelectorAll(".clause")).toHaveLength(11);
    });
  });

  describe("term choices", () => {
    it("marks the chosen MNDA term and leaves the alternative unmarked", () => {
      const { container } = renderDoc(
        completeCoverPage({ mndaTerm: { kind: "expires", years: 2 } }),
      );
      const section = coverPageSection(container, "MNDA Term");
      const [expires, untilTerminated] = section.querySelectorAll(".choice-line");

      expect(expires).toHaveAttribute("data-selected", "true");
      expect(untilTerminated).toHaveAttribute("data-selected", "false");
      expect(within(section).getByText("two (2) years")).toBeInTheDocument();
    });

    it("switches the marker when the open-ended term is chosen", () => {
      const { container } = renderDoc(
        completeCoverPage({ mndaTerm: { kind: "untilTerminated" } }),
      );
      const lines = container.querySelectorAll(".choice-line");
      const untilTerminated = [...lines].find((line) =>
        line.textContent?.includes("Continues until terminated"),
      );
      expect(untilTerminated).toHaveAttribute("data-selected", "true");
    });

    it("marks perpetual confidentiality", () => {
      const { container } = renderDoc(
        completeCoverPage({ confidentialityTerm: { kind: "perpetuity" } }),
      );
      const perpetuity = [...container.querySelectorAll(".choice-line")].find((line) =>
        line.textContent?.includes("In perpetuity."),
      );
      expect(perpetuity).toHaveAttribute("data-selected", "true");
    });

    it("does not show a year count when the term is open-ended", () => {
      renderDoc(completeCoverPage({ mndaTerm: { kind: "untilTerminated" } }));
      expect(screen.getByText(/a set number of years/)).toBeInTheDocument();
    });

    it("announces selection state to assistive technology", () => {
      const { container } = renderDoc(completeCoverPage());
      const hidden = [...container.querySelectorAll(".visually-hidden")].map(
        (node) => node.textContent,
      );
      expect(hidden).toContain("Selected: ");
      expect(hidden).toContain("Not selected: ");
    });
  });

  describe("standard terms", () => {
    it("renders all eleven numbered clauses", () => {
      const { container } = renderDoc(completeCoverPage());
      const numbers = [...container.querySelectorAll(".clause-number")].map(
        (node) => node.textContent,
      );
      expect(numbers).toEqual([
        "§1", "§2", "§3", "§4", "§5", "§6", "§7", "§8", "§9", "§10", "§11",
      ]);
    });

    it("resolves cover-page references inside the clause text", () => {
      const { container } = renderDoc(completeCoverPage());
      const clause9 = container.querySelectorAll(".clause")[8];
      expect(clause9.textContent).toContain("the laws of the State of Delaware");
      expect(clause9.textContent).toContain("courts located in New Castle, DE");
    });

    it("leaves no unresolved template markup anywhere in the document", () => {
      const { container } = renderDoc(completeCoverPage());
      expect(container.textContent).not.toMatch(/\{\{|\}\}|\*\*/);
    });

    it("marks only the clauses it was asked to mark", () => {
      const { container } = renderDoc(completeCoverPage(), [1, 2]);
      const linked = [...container.querySelectorAll('.clause[data-linked="true"]')].map(
        (node) => node.querySelector(".clause-number")?.textContent,
      );
      expect(linked).toEqual(["§1", "§2"]);
    });

    it("marks nothing when nothing has just changed", () => {
      const { container } = renderDoc(completeCoverPage(), []);
      expect(container.querySelectorAll('.clause[data-linked="true"]')).toHaveLength(0);
    });
  });

  describe("signature block", () => {
    it("fills the known details for both parties", () => {
      renderDoc(completeCoverPage());
      const table = screen.getByRole("table");

      expect(within(table).getByText("Northwind Labs, Inc.")).toBeInTheDocument();
      expect(within(table).getByText("Dana Reyes")).toBeInTheDocument();
      expect(within(table).getByText("Head of Partnerships")).toBeInTheDocument();
      expect(
        within(table).getByText("410 Bridge St, Austin, TX 78701"),
      ).toBeInTheDocument();
    });

    it("leaves signature and date blank for signing by hand", () => {
      renderDoc(completeCoverPage());
      const table = screen.getByRole("table");

      const signatureRow = within(table).getByRole("rowheader", { name: "Signature" })
        .parentElement;
      const dateRow = within(table).getByRole("rowheader", { name: "Date" })
        .parentElement;

      for (const row of [signatureRow, dateRow]) {
        const cells = row?.querySelectorAll("td") ?? [];
        expect(cells).toHaveLength(2);
        for (const cell of cells) expect(cell.textContent).toBe("");
      }
    });

    it("labels the party columns", () => {
      renderDoc(completeCoverPage());
      const table = screen.getByRole("table");
      expect(
        within(table).getByRole("columnheader", { name: "Party 1" }),
      ).toBeInTheDocument();
      expect(
        within(table).getByRole("columnheader", { name: "Party 2" }),
      ).toBeInTheDocument();
    });
  });

  /*
   * The Cover Page is hand-written JSX rather than generated from the template,
   * so it cannot be diffed automatically the way the Standard Terms are. These
   * pin the phrases that drifted once already.
   */
  describe("fidelity to templates/mutual-nda-coverpage.md", () => {
    it("keeps the parentheticals that define Cover Page and Standard Terms", () => {
      const { container } = renderDoc(completeCoverPage());
      const preamble = container.querySelector(".doc-preamble");

      expect(preamble).toHaveTextContent(/this Cover Page \(“Cover Page”\)/);
      expect(preamble).toHaveTextContent(/Version 1\.0 \(“Standard Terms”\)/);
    });

    it("keeps modifications prescriptive, as the source has it", () => {
      const { container } = renderDoc(completeCoverPage());
      const preamble = container.querySelector(".doc-preamble");

      expect(preamble).toHaveTextContent(
        /Any modifications of the Standard Terms should be made on the Cover Page/,
      );
    });

    it("capitalises Confidential Information as a defined term", () => {
      const { container } = renderDoc(completeCoverPage());
      const section = coverPageSection(container, "Term of Confidentiality");

      expect(section.textContent).toContain(
        "until Confidential Information is no longer considered a trade secret",
      );
      expect(section.textContent).not.toContain("until the confidential information");
    });

    it("prints the bare jurisdiction value, as the cover page does", () => {
      const { container } = renderDoc(completeCoverPage());
      const section = coverPageSection(container, "Governing Law & Jurisdiction");

      expect(section.textContent).toContain("Jurisdiction: New Castle, DE");
      // "courts located in" belongs to clause 9, not the cover page field.
      expect(section.textContent).not.toContain("Jurisdiction: courts located in");
    });

    it("still says 'courts located in' where clause 9 does", () => {
      const { container } = renderDoc(completeCoverPage());
      const clause9 = container.querySelectorAll(".clause")[8];
      expect(clause9.textContent).toContain("courts located in New Castle, DE");
    });
  });

  describe("term length not yet chosen", () => {
    it("agrees with the cover page instead of asserting a zero-year term", () => {
      const { container } = renderDoc(
        completeCoverPage({ mndaTerm: { kind: "expires", years: 0 } }),
      );

      const section = coverPageSection(container, "MNDA Term");
      expect(section.textContent).toContain("a set number of years");

      const clause5 = container.querySelectorAll(".clause")[4];
      expect(clause5.textContent).toContain("MNDA Term (length not yet specified)");
      expect(clause5.textContent).not.toContain("zero (0) years");
    });
  });

  describe("licence attribution", () => {
    it("credits Common Paper and links the CC BY 4.0 licence", () => {
      renderDoc(completeCoverPage());
      const licence = screen.getByRole("link", { name: "CC BY 4.0" });
      expect(licence).toHaveAttribute(
        "href",
        "https://creativecommons.org/licenses/by/4.0/",
      );
      expect(
        screen.getByText(/Common Paper Mutual Non-Disclosure Agreement/),
      ).toBeInTheDocument();
    });

    it("links the canonical standard terms", () => {
      renderDoc(completeCoverPage());
      expect(
        screen.getByRole("link", { name: /commonpaper\.com\/standards\/mutual-nda/ }),
      ).toHaveAttribute("href", "https://commonpaper.com/standards/mutual-nda/1.0");
    });
  });
});
