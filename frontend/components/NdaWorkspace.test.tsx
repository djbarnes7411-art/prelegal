import { render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NdaWorkspace } from "./NdaWorkspace";

/*
 * Integration tests: everything is driven through the real UI, the way a user
 * would, and the assertions are on the rendered agreement and the print call.
 */

const PARTY_ONE = {
  companyName: "Northwind Labs, Inc.",
  signatoryName: "Dana Reyes",
  signatoryTitle: "Chief Executive Officer",
  noticeAddress: "legal@northwindlabs.com",
};

const PARTY_TWO = {
  companyName: "Kestrel Analytics LLC",
  signatoryName: "Sam Okonkwo",
  signatoryTitle: "Head of Partnerships",
  noticeAddress: "410 Bridge St, Austin, TX 78701",
};

let print: ReturnType<typeof vi.fn>;

beforeEach(() => {
  print = vi.fn();
  vi.stubGlobal("print", print);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Fills a party card by its heading, e.g. "Party 1".
 *
 * Scoped to the form: the same labels appear again as column headers in the
 * rendered signature block.
 */
async function fillParty(
  user: UserEvent,
  heading: string,
  party: typeof PARTY_ONE,
) {
  const card = [...document.querySelectorAll(".party")].find((node) =>
    node.querySelector(".party-name")?.textContent === heading,
  ) as HTMLElement | undefined;

  if (!card) throw new Error(`No party card headed "${heading}"`);

  await user.type(within(card).getByLabelText("Company"), party.companyName);
  await user.type(within(card).getByLabelText("Signed by"), party.signatoryName);
  await user.type(within(card).getByLabelText("Title"), party.signatoryTitle);
  await user.type(
    within(card).getByLabelText("Notice address"),
    party.noticeAddress,
  );
}

/** Answers every required question. */
async function completeForm(user: UserEvent) {
  await user.type(screen.getByLabelText("State"), "Delaware");
  await user.type(screen.getByLabelText("Courts located in"), "New Castle, DE");
  await fillParty(user, "Party 1", PARTY_ONE);
  await fillParty(user, "Party 2", PARTY_TWO);
}

describe("NdaWorkspace", () => {
  it("starts with the purpose and today's date already answered", () => {
    render(<NdaWorkspace />);
    expect(screen.getByLabelText("Purpose")).toHaveValue(
      "Evaluating whether to enter into a business relationship with the other party.",
    );
    expect(screen.getByLabelText("Effective date")).not.toHaveValue("");
  });

  it("reports how many answers are still missing", () => {
    render(<NdaWorkspace />);
    expect(screen.getByText("10 fields left to fill in")).toBeInTheDocument();
  });

  describe("live document", () => {
    it("reflects typing into the agreement as you go", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.type(screen.getByLabelText("State"), "Delaware");

      const clause9 = container.querySelectorAll(".clause")[8];
      expect(clause9.textContent).toContain("the laws of the State of Delaware");
    });

    it("rewrites the purpose everywhere it appears", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      const purpose = screen.getByLabelText("Purpose");
      await user.clear(purpose);
      await user.type(purpose, "Discussing a possible acquisition.");

      const clause1 = container.querySelectorAll(".clause")[0];
      expect(clause1.textContent).toContain(
        "the Purpose (Discussing a possible acquisition)",
      );
    });

    it("switches the agreement wording when the term choice changes", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.click(screen.getByLabelText(/Runs until either party terminates/));

      const clause5 = container.querySelectorAll(".clause")[4];
      expect(clause5.textContent).toContain(
        "which continues until terminated in accordance with the terms of this MNDA",
      );
    });

    it("switches to perpetual confidentiality", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.click(screen.getByLabelText("Forever"));

      const clause5 = container.querySelectorAll(".clause")[4];
      expect(clause5.textContent).toContain(
        "Term of Confidentiality (in perpetuity)",
      );
    });
  });

  describe("clause linking", () => {
    it("marks the clauses fed by the focused group", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.click(screen.getByLabelText("State"));

      const linked = [
        ...container.querySelectorAll('.clause[data-linked="true"]'),
      ].map((node) => node.querySelector(".clause-number")?.textContent);
      expect(linked).toEqual(["§9"]);
    });

    it("marks both purpose clauses", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.click(screen.getByLabelText("Purpose"));

      const linked = [
        ...container.querySelectorAll('.clause[data-linked="true"]'),
      ].map((node) => node.querySelector(".clause-number")?.textContent);
      expect(linked).toEqual(["§1", "§2"]);
    });
  });

  describe("download gating", () => {
    it("does not print while answers are missing", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });

    it("stays silent about errors until the first download attempt", () => {
      render(<NdaWorkspace />);
      expect(screen.queryByText("Required")).not.toBeInTheDocument();
    });

    it("reveals every missing answer on a failed attempt", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(screen.getAllByText("Required")).toHaveLength(10);
    });

    it("marks the missing fields invalid for assistive technology", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(10);
    });

    it("moves focus to the first missing answer", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(screen.getByLabelText("State")).toHaveFocus();
    });

    it("prints once every answer is given", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeForm(user);
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).toHaveBeenCalledTimes(1);
    });

    it("swaps the hint for print instructions once complete", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeForm(user);

      expect(screen.queryByText(/fields left to fill in/)).not.toBeInTheDocument();
      expect(screen.getByText(/Save as PDF/)).toBeInTheDocument();
    });

    it("clears an error as soon as the answer is supplied", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));
      expect(screen.getAllByText("Required")).toHaveLength(10);

      await user.type(screen.getByLabelText("State"), "Delaware");
      expect(screen.getAllByText("Required")).toHaveLength(9);
    });
  });

  describe("year inputs", () => {
    it("announces its error like every other field", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      const years = screen.getByLabelText("Years until the NDA expires");
      await user.clear(years);
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(years).toHaveAttribute("aria-invalid", "true");
      const describedBy = years.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent(
        "Enter a whole number of years",
      );
    });

    it("does not print while a term length is unusable", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeForm(user);
      await user.clear(screen.getByLabelText("Years until the NDA expires"));
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });

    it("never lets the document assert a term the user did not choose", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await user.clear(screen.getByLabelText("Years until the NDA expires"));

      const clause5 = container.querySelectorAll(".clause")[4];
      expect(clause5.textContent).not.toContain("zero (0) years");
      expect(clause5.textContent).toContain("length not yet specified");
    });

    it("disables the count when the open-ended option is chosen", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByLabelText(/Runs until either party terminates/));

      expect(screen.getByLabelText("Years until the NDA expires")).toBeDisabled();
    });
  });

  describe("suggested PDF filename", () => {
    it("names both parties in the document title", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeForm(user);

      expect(document.title).toBe(
        "Mutual NDA - Northwind Labs, Inc. and Kestrel Analytics LLC",
      );
    });

    it("falls back to a generic title before the parties are named", () => {
      render(<NdaWorkspace />);
      expect(document.title).toBe("Mutual NDA");
    });
  });

  describe("completed agreement", () => {
    it("carries every answer into the signature block", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeForm(user);

      const table = screen.getByRole("table");
      expect(within(table).getByText(PARTY_ONE.companyName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.signatoryName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.noticeAddress)).toBeInTheDocument();
    });

    it("leaves no blanks in the finished document", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await completeForm(user);

      expect(container.querySelectorAll(".blank")).toHaveLength(0);
    });
  });
});
