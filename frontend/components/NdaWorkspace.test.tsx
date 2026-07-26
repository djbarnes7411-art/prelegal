import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NdaWorkspace } from "./NdaWorkspace";
import { ApiError, sendChatTurn } from "@/lib/api";
import type { CoverPageData } from "@/lib/nda/types";

/*
 * Integration tests: everything is driven through the real UI, the way a user
 * would, and the assertions are on the rendered agreement and the print call.
 *
 * The assistant is the one thing substituted. What it would say is not this
 * suite's business; what the workspace does with what it says is.
 */

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, sendChatTurn: vi.fn() };
});

const asMock = vi.mocked(sendChatTurn);

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

/** Everything the empty cover page is still short of. */
const EVERYTHING_MISSING: Partial<CoverPageData> = {
  governingLaw: "Delaware",
  jurisdiction: "New Castle, DE",
  partyOne: PARTY_ONE,
  partyTwo: PARTY_TWO,
};

let print: ReturnType<typeof vi.fn>;

beforeEach(() => {
  print = vi.fn();
  vi.stubGlobal("print", print);
  asMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Scripts the assistant's next reply. */
function assistantAnswers(patch: Partial<CoverPageData>, reply = "Done.") {
  asMock.mockResolvedValueOnce({ reply, patch });
}

/** Says something and waits for the turn to land. */
async function say(user: UserEvent, text: string) {
  await user.type(screen.getByLabelText("Your message"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(asMock).toHaveBeenCalled());
}

/** Gets the whole agreement answered in one turn. */
async function completeAgreement(user: UserEvent) {
  assistantAnswers(EVERYTHING_MISSING, "All noted.");
  await say(user, "Here are all the details.");
  await screen.findByText("All noted.");
}

describe("NdaWorkspace", () => {
  it("opens with a greeting, before anything has been sent anywhere", () => {
    render(<NdaWorkspace />);

    expect(screen.getByText(/I'll help you fill in this Mutual NDA/)).toBeInTheDocument();
    expect(asMock).not.toHaveBeenCalled();
  });

  it("says which fields it has already filled in", () => {
    /* The document beside it is not blank, and the greeting must not imply it is. */
    render(<NdaWorkspace />);
    expect(
      screen.getByText(/standard Purpose, today's date, and one-year terms/),
    ).toBeInTheDocument();
  });

  it("reports how many answers are still missing", () => {
    render(<NdaWorkspace />);
    expect(screen.getByText("10 fields left to fill in")).toBeInTheDocument();
  });

  describe("a turn", () => {
    it("shows what the user said", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      assistantAnswers({});

      await say(user, "Delaware law.");

      expect(screen.getByText("Delaware law.")).toBeInTheDocument();
    });

    it("shows the reply", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      assistantAnswers({ governingLaw: "Delaware" }, "Delaware it is.");

      await say(user, "Delaware law.");

      expect(await screen.findByText("Delaware it is.")).toBeInTheDocument();
    });

    it("sends the transcript and the agreement as it stands", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      assistantAnswers({});

      await say(user, "Delaware law.");

      const [messages, coverPage] = asMock.mock.calls[0];
      expect(messages.at(-1)).toEqual({ role: "user", content: "Delaware law." });
      expect(messages[0].role).toBe("assistant");
      expect(coverPage.purpose).toContain("Evaluating whether to enter into");
    });

    it("carries the answers into the next turn", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      assistantAnswers({ governingLaw: "Delaware" }, "Noted.");
      await say(user, "Delaware law.");
      await screen.findByText("Noted.");

      assistantAnswers({}, "And?");
      await say(user, "What else?");

      expect(asMock.mock.calls[1][1].governingLaw).toBe("Delaware");
    });
  });

  describe("live document", () => {
    it("writes an answer into the agreement", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);
      assistantAnswers({ governingLaw: "Delaware" });

      await say(user, "Delaware law.");

      await waitFor(() => {
        const clause9 = container.querySelectorAll(".clause")[8];
        expect(clause9.textContent).toContain("the laws of the State of Delaware");
      });
    });

    it("rewrites the purpose everywhere it appears", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);
      assistantAnswers({ purpose: "Discussing a possible acquisition." });

      await say(user, "It's about an acquisition.");

      await waitFor(() => {
        const clause1 = container.querySelectorAll(".clause")[0];
        expect(clause1.textContent).toContain(
          "the Purpose (Discussing a possible acquisition)",
        );
      });
    });

    it("switches the wording when the term changes", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);
      assistantAnswers({ mndaTerm: { kind: "untilTerminated" } });

      await say(user, "Make it run until someone ends it.");

      await waitFor(() => {
        const clause5 = container.querySelectorAll(".clause")[4];
        expect(clause5.textContent).toContain(
          "which continues until terminated in accordance with the terms of this MNDA",
        );
      });
    });

    it("replaces a party wholesale rather than field by field", async () => {
      /*
       * State is merged shallowly, so a party arriving without all four of its
       * fields would blank the ones the assistant did not mention.
       */
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      assistantAnswers({ partyOne: PARTY_ONE });

      await say(user, "Northwind Labs, Dana Reyes signing.");

      const table = await screen.findByRole("table");
      expect(within(table).getByText(PARTY_ONE.companyName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_ONE.noticeAddress)).toBeInTheDocument();
    });
  });

  describe("clause linking", () => {
    it("marks the clauses the assistant just changed", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);
      assistantAnswers({ governingLaw: "Delaware" });

      await say(user, "Delaware law.");

      await waitFor(() => {
        const linked = [
          ...container.querySelectorAll('.clause[data-linked="true"]'),
        ].map((node) => node.querySelector(".clause-number")?.textContent);
        expect(linked).toEqual(["§9"]);
      });
    });

    it("marks nothing when a turn changed nothing", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);
      assistantAnswers({}, "Which state's law should govern?");

      await say(user, "Not sure yet.");
      await screen.findByText("Which state's law should govern?");

      expect(
        container.querySelectorAll('.clause[data-linked="true"]'),
      ).toHaveLength(0);
    });
  });

  describe("download gating", () => {
    it("does not print while answers are missing", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });

    it("says what is still missing rather than failing silently", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(screen.getByText(/the governing law/)).toBeInTheDocument();
      expect(screen.getByText(/still missing/)).toBeInTheDocument();
    });

    it("counts that list itself rather than asking the assistant", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(asMock).not.toHaveBeenCalled();
    });

    it("puts the cursor where the answer would be typed", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(screen.getByLabelText("Your message")).toHaveFocus();
    });

    it("prints once every answer is given", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeAgreement(user);
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).toHaveBeenCalledTimes(1);
    });

    it("swaps the hint for print instructions once complete", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeAgreement(user);

      expect(screen.queryByText(/fields left to fill in/)).not.toBeInTheDocument();
      expect(screen.getByText(/Save as PDF/)).toBeInTheDocument();
    });

    it("does not print while a term length is unusable", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      await completeAgreement(user);

      assistantAnswers({ mndaTerm: { kind: "expires", years: 0 } }, "Hmm.");
      await say(user, "Zero years.");
      await screen.findByText("Hmm.");

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });
  });

  describe("knowing when it is finished", () => {
    it("says so the moment the last blank is filled", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeAgreement(user);

      expect(
        await screen.findByText(/That's everything the cover page needs/),
      ).toBeInTheDocument();
    });

    it("stays quiet while anything is still missing", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      assistantAnswers({ governingLaw: "Delaware" }, "Noted.");

      await say(user, "Delaware law.");
      await screen.findByText("Noted.");

      expect(
        screen.queryByText(/That's everything the cover page needs/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the assistant cannot answer", () => {
    it("says why", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      asMock.mockRejectedValueOnce(
        new ApiError("The assistant is unavailable right now.", 503),
      );

      await say(user, "Delaware law.");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The assistant is unavailable right now.",
      );
    });

    it("keeps the message that failed, so it need not be retyped", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "Delaware law.");
      await screen.findByRole("alert");

      expect(screen.getByText("Delaware law.")).toBeInTheDocument();
    });

    it("resends that same message on a retry", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "Delaware law.");
      await screen.findByRole("alert");

      assistantAnswers({ governingLaw: "Delaware" }, "Got it.");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Got it.")).toBeInTheDocument();
      expect(asMock.mock.calls[1][0].at(-1)).toEqual({
        role: "user",
        content: "Delaware law.",
      });
    });

    it("clears the alarm once a turn succeeds", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "Delaware law.");
      await screen.findByRole("alert");

      assistantAnswers({}, "Got it.");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByText("Got it.");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("suggested PDF filename", () => {
    it("names both parties in the document title", async () => {
      const user = userEvent.setup();
      render(<NdaWorkspace />);

      await completeAgreement(user);

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

      await completeAgreement(user);

      const table = screen.getByRole("table");
      expect(within(table).getByText(PARTY_ONE.companyName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.signatoryName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.noticeAddress)).toBeInTheDocument();
    });

    it("leaves no blanks in the finished document", async () => {
      const user = userEvent.setup();
      const { container } = render(<NdaWorkspace />);

      await completeAgreement(user);

      expect(container.querySelectorAll(".blank")).toHaveLength(0);
    });
  });
});
