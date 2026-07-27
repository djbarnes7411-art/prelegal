import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentWorkspace } from "./DocumentWorkspace";
import {
  ApiError,
  createDocument,
  loadDocument,
  saveDocument,
  sendChatTurn,
  signOut,
  type SavedDocument,
} from "@/lib/api";
import type { DocumentState } from "@/lib/documents/types";
import { storeSession } from "@/lib/session";

/*
 * Integration tests: everything is driven through the real UI, the way a user
 * would, and the assertions are on the rendered agreement and the print call.
 *
 * The assistant is the one thing substituted. What it would say is not this
 * suite's business; what the workspace does with what it says is.
 */

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    sendChatTurn: vi.fn(),
    createDocument: vi.fn(),
    saveDocument: vi.fn(),
    loadDocument: vi.fn(),
    signOut: vi.fn(),
  };
});

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

const asMock = vi.mocked(sendChatTurn);
const created = vi.mocked(createDocument);
const saved = vi.mocked(saveDocument);
const loaded = vi.mocked(loadDocument);

const SESSION = {
  user: { id: 1, email: "ada@example.com", createdAt: "2026-07-26T09:00:00Z" },
  token: "opaque-token",
};

/** A saved document as the backend returns it. */
function savedDocument(over: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id: 7,
    documentSlug: "mutual-nda",
    fields: {},
    messages: [],
    createdAt: "2026-07-26T09:00:00Z",
    updatedAt: "2026-07-26T09:30:00Z",
    ...over,
  };
}

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

/** Everything a fresh Mutual NDA is still short of. */
const EVERYTHING_MISSING: DocumentState = {
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
  push.mockReset();
  replace.mockReset();
  /* The bar across the top names the signed-in account, and these tests mount
     the workspace directly rather than through the page that gates it. */
  window.localStorage.clear();
  storeSession(SESSION);
  created.mockReset();
  created.mockResolvedValue(savedDocument());
  saved.mockReset();
  saved.mockResolvedValue(savedDocument());
  loaded.mockReset();
  vi.mocked(signOut).mockReset();
  vi.mocked(signOut).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Scripts the assistant's next reply, on the document already being drafted. */
function assistantAnswers(patch: DocumentState, reply = "Done.") {
  asMock.mockResolvedValueOnce({ reply, patch, documentSlug: lastSlug });
}

let lastSlug: string | null = null;

/** Scripts the assistant settling on a document. */
function assistantChooses(slug: string, reply = "Right, let's start that one.") {
  lastSlug = slug;
  asMock.mockResolvedValueOnce({ reply, patch: {}, documentSlug: slug });
}

/** Says something and waits for the turn to land. */
async function say(user: UserEvent, text: string) {
  const before = asMock.mock.calls.length;
  await user.type(screen.getByLabelText("Your message"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(asMock.mock.calls.length).toBeGreaterThan(before));
}

/** Picks the Mutual NDA and waits for its page to appear. */
async function startNda(user: UserEvent) {
  assistantChooses("mutual-nda", "Right, a Mutual NDA.");
  await say(user, "I need an NDA.");
  await screen.findByText("Right, a Mutual NDA.");
}

/** Picks a generically rendered document and waits for its clauses to load. */
async function startPilot(user: UserEvent) {
  assistantChooses("pilot-agreement", "Right, a Pilot Agreement.");
  await say(user, "We want a 30 day trial.");
  await screen.findByText("Right, a Pilot Agreement.");
  await waitFor(() =>
    expect(screen.queryByText("Loading the agreement…")).not.toBeInTheDocument(),
  );
}

/** Gets the whole NDA answered in one turn. */
async function completeAgreement(user: UserEvent) {
  assistantAnswers(EVERYTHING_MISSING, "All noted.");
  await say(user, "Here are all the details.");
  await screen.findByText("All noted.");
}

describe("DocumentWorkspace", () => {
  describe("before a document is chosen", () => {
    it("opens with a greeting, before anything has been sent anywhere", () => {
      render(<DocumentWorkspace />);

      expect(
        screen.getByText(/I can help you draft any of the agreements/),
      ).toBeInTheDocument();
      expect(asMock).not.toHaveBeenCalled();
    });

    it("shows what it can draft rather than reading the list aloud", () => {
      render(<DocumentWorkspace />);

      expect(screen.getByText("Mutual NDA")).toBeInTheDocument();
      expect(screen.getByText("Pilot Agreement")).toBeInTheDocument();
      expect(screen.getByText("Data Processing Agreement")).toBeInTheDocument();
    });

    it("says where a document only makes sense alongside another", () => {
      render(<DocumentWorkspace />);

      expect(
        screen.getByText(/An SLA attaches to a Cloud Service Agreement/),
      ).toBeInTheDocument();
    });

    it("offers no download until there is something to download", () => {
      render(<DocumentWorkspace />);

      expect(
        screen.queryByRole("button", { name: "Download PDF" }),
      ).not.toBeInTheDocument();
    });

    it("asks the assistant which document is meant", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockResolvedValueOnce({
        reply: "Which of these did you have in mind?",
        patch: {},
        documentSlug: null,
      });

      await say(user, "something legal");

      const [, slug] = asMock.mock.calls[0];
      expect(slug).toBeNull();
    });

    it("stays on the catalog when the request matches nothing we have", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockResolvedValueOnce({
        reply:
          "I can't draft an employment contract — we don't have that template. " +
          "The closest I have is a Design Partner Agreement. Shall we start there?",
        patch: {},
        documentSlug: null,
      });

      await say(user, "I need an employment contract");

      expect(await screen.findByText(/can't draft an employment contract/)).toBeInTheDocument();
      expect(screen.getByText("What would you like to draft?")).toBeInTheDocument();
    });
  });

  describe("choosing a document", () => {
    it("puts that document on the desk", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startNda(user);

      expect(
        screen.getByRole("heading", { name: "Mutual Non-Disclosure Agreement" }),
      ).toBeInTheDocument();
    });

    it("names it in the header", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startNda(user);

      expect(screen.getByText(/Mutual NDA · Common Paper/)).toBeInTheDocument();
    });

    it("reports how many answers are still missing", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startNda(user);

      expect(screen.getByText("4 fields left to fill in")).toBeInTheDocument();
    });

    it("starts it with the defaults its definition gives", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startNda(user);

      assistantAnswers({}, "And?");
      await say(user, "What else?");

      const [, , fields] = asMock.mock.calls[1];
      expect(fields.purpose).toContain("Evaluating whether to enter into");
      expect(fields.mndaTerm).toEqual({ kind: "expires", years: 1 });
    });

    it("carries the document and its answers into the next turn", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ governingLaw: "Delaware" }, "Noted.");
      await say(user, "Delaware law.");
      await screen.findByText("Noted.");

      assistantAnswers({}, "And?");
      await say(user, "What else?");

      const [, slug, fields] = asMock.mock.calls[2];
      expect(slug).toBe("mutual-nda");
      expect(fields.governingLaw).toBe("Delaware");
    });
  });

  describe("a generically rendered document", () => {
    it("renders the parsed standard terms", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startPilot(user);

      expect(
        screen.getByRole("heading", { name: "Pilot Access" }),
      ).toBeInTheDocument();
    });

    it("writes an answer into the clause that cites it", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startPilot(user);

      assistantAnswers({ pilotPeriod: "60 days from the Effective Date" }, "Noted.");
      await say(user, "Sixty days.");
      await screen.findByText("Noted.");

      await waitFor(() => {
        const clause = [...container.querySelectorAll(".clause")].find((node) =>
          node.textContent?.includes("Pilot Period"),
        );
        expect(clause?.textContent).toContain("60 days from the Effective Date");
      });
    });

    it("spells a defined term out once and refers to it by name after", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startPilot(user);

      assistantAnswers({ pilotPeriod: "60 days" }, "Noted.");
      await say(user, "Sixty days.");
      await screen.findByText("Noted.");

      await waitFor(() => {
        const expansions = [...container.querySelectorAll(".clause")].filter(
          (node) => node.textContent?.includes("(60 days)"),
        );
        expect(expansions).toHaveLength(1);
      });
    });

    it("keeps an omitted optional value as None rather than a blank", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startPilot(user);

      expect(screen.getAllByText("None.").length).toBeGreaterThan(0);
    });

    it("marks the clauses the assistant just changed", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startPilot(user);

      assistantAnswers({ pilotPeriod: "60 days" });
      await say(user, "Sixty days.");

      await waitFor(() => {
        const linked = [
          ...container.querySelectorAll('.clause[data-linked="true"]'),
        ].map((node) => node.querySelector(".clause-number")?.textContent);
        expect(linked).toEqual(["1.1", "1.2", "2.1"]);
      });
    });
  });

  describe("the Mutual NDA keeps its own page", () => {
    it("writes an answer into the agreement", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ governingLaw: "Delaware" });
      await say(user, "Delaware law.");

      await waitFor(() => {
        const clause9 = container.querySelectorAll(".clause")[8];
        expect(clause9.textContent).toContain("the laws of the State of Delaware");
      });
    });

    it("rewrites the purpose everywhere it appears", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startNda(user);

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
      const { container } = render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ mndaTerm: { kind: "untilTerminated", years: null } });
      await say(user, "Make it run until someone ends it.");

      await waitFor(() => {
        const clause5 = container.querySelectorAll(".clause")[4];
        expect(clause5.textContent).toContain(
          "which continues until terminated in accordance with the terms of this MNDA",
        );
      });
    });

    it("marks the clauses a change reaches", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ governingLaw: "Delaware" });
      await say(user, "Delaware law.");

      await waitFor(() => {
        const linked = [
          ...container.querySelectorAll('.clause[data-linked="true"]'),
        ].map((node) => node.querySelector(".clause-number")?.textContent);
        expect(linked).toEqual(["§9"]);
      });
    });

    it("replaces a party wholesale rather than field by field", async () => {
      /*
       * State is merged shallowly, so a party arriving without all four of its
       * fields would blank the ones the assistant did not mention.
       */
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ partyOne: PARTY_ONE });
      await say(user, "Northwind Labs, Dana Reyes signing.");

      const table = await screen.findByRole("table");
      expect(within(table).getByText(PARTY_ONE.companyName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_ONE.noticeAddress)).toBeInTheDocument();
    });
  });

  describe("keeping the cursor where the next answer goes", () => {
    it("returns focus to the composer after a turn", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ governingLaw: "Delaware" }, "Noted.");
      await say(user, "Delaware law.");
      await screen.findByText("Noted.");

      expect(screen.getByLabelText("Your message")).toHaveFocus();
    });

    it("leaves focus alone when a turn fails, so Try again stays reachable", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));
      await say(user, "Delaware law.");
      await screen.findByRole("alert");

      expect(screen.getByLabelText("Your message")).not.toHaveFocus();
    });

    it("puts the cursor there when a download is blocked", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(screen.getByLabelText("Your message")).toHaveFocus();
    });
  });

  describe("download gating", () => {
    it("does not print while answers are missing", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });

    it("says what is still missing rather than failing silently", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      /* Named the way the definition names them to a person, not by field key. */
      expect(
        screen.getByText(/the US state whose law governs/),
      ).toBeInTheDocument();
      expect(screen.getByText(/still missing/)).toBeInTheDocument();
    });

    it("counts that list itself rather than asking the assistant", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);
      const before = asMock.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(asMock.mock.calls.length).toBe(before);
    });

    it("prints once every answer is given", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).toHaveBeenCalledTimes(1);
    });

    it("swaps the hint for print instructions once complete", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);

      expect(screen.queryByText(/fields left to fill in/)).not.toBeInTheDocument();
      expect(screen.getByText(/Save as PDF/)).toBeInTheDocument();
    });

    it("does not print while a term length is unusable", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);
      await completeAgreement(user);

      assistantAnswers({ mndaTerm: { kind: "expires", years: 0 } }, "Hmm.");
      await say(user, "Zero years.");
      await screen.findByText("Hmm.");

      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).not.toHaveBeenCalled();
    });

    it("ignores optional fields when deciding it is finished", async () => {
      /* The standard terms read an omitted optional value as "none". */
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);
      await user.click(screen.getByRole("button", { name: "Download PDF" }));

      expect(print).toHaveBeenCalledTimes(1);
    });
  });

  describe("knowing when it is finished", () => {
    it("says so the moment the last blank is filled", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);

      expect(
        await screen.findByText(/That's everything the Mutual NDA needs/),
      ).toBeInTheDocument();
    });

    it("stays quiet while anything is still missing", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      assistantAnswers({ governingLaw: "Delaware" }, "Noted.");
      await say(user, "Delaware law.");
      await screen.findByText("Noted.");

      expect(screen.queryByText(/That's everything/)).not.toBeInTheDocument();
    });

    it("does not announce completion before a document is chosen", () => {
      render(<DocumentWorkspace />);
      expect(screen.queryByText(/That's everything/)).not.toBeInTheDocument();
    });
  });

  describe("when the assistant cannot answer", () => {
    it("says why", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockRejectedValueOnce(
        new ApiError("The assistant is unavailable right now.", 503),
      );

      await say(user, "I need an NDA.");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The assistant is unavailable right now.",
      );
    });

    it("keeps the message that failed, so it need not be retyped", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "I need an NDA.");
      await screen.findByRole("alert");

      expect(screen.getByText("I need an NDA.")).toBeInTheDocument();
    });

    it("resends that same message on a retry", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "I need an NDA.");
      await screen.findByRole("alert");

      assistantChooses("mutual-nda", "Got it.");
      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Got it.")).toBeInTheDocument();
      expect(asMock.mock.calls[1][0].at(-1)).toEqual({
        role: "user",
        content: "I need an NDA.",
      });
    });

    it("clears the alarm once a turn succeeds", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      asMock.mockRejectedValueOnce(new ApiError("Could not reach the server.", 0));

      await say(user, "I need an NDA.");
      await screen.findByRole("alert");

      assistantChooses("mutual-nda", "Got it.");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByText("Got it.");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("suggested PDF filename", () => {
    it("names both parties in the document title", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);

      expect(document.title).toBe(
        "Mutual NDA - Northwind Labs, Inc. and Kestrel Analytics LLC",
      );
    });

    it("falls back to the document's own name before the parties are named", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);

      await startNda(user);

      expect(document.title).toBe("Mutual NDA");
    });

    it("is the product's name before a document is chosen", () => {
      render(<DocumentWorkspace />);
      expect(document.title).toBe("Prelegal");
    });
  });

  describe("completed agreement", () => {
    it("carries every answer into the signature block", async () => {
      const user = userEvent.setup();
      render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);

      const table = screen.getByRole("table");
      expect(within(table).getByText(PARTY_ONE.companyName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.signatoryName)).toBeInTheDocument();
      expect(within(table).getByText(PARTY_TWO.noticeAddress)).toBeInTheDocument();
    });

    it("leaves no blanks in the finished document", async () => {
      const user = userEvent.setup();
      const { container } = render(<DocumentWorkspace />);
      await startNda(user);

      await completeAgreement(user);

      expect(container.querySelectorAll(".blank")).toHaveLength(0);
    });
  });
});

describe("the draft disclaimer", () => {
  it("is on the Mutual NDA's page", async () => {
    const user = userEvent.setup();
    render(<DocumentWorkspace />);

    await startNda(user);

    expect(screen.getByRole("note")).toHaveTextContent(/not legal advice/i);
  });

  it("is on a generated document's page too", async () => {
    /* Two renderers, one component — the wording cannot drift between them. */
    const user = userEvent.setup();
    render(<DocumentWorkspace />);

    await startPilot(user);

    expect(screen.getByRole("note")).toHaveTextContent(/not legal advice/i);
  });

  it("stays on a finished agreement", async () => {
    /* The finished document is the one that gets sent to somebody, so this is
       exactly when the warning must not disappear. */
    const user = userEvent.setup();
    render(<DocumentWorkspace />);
    await startNda(user);

    await completeAgreement(user);

    expect(screen.getByRole("note")).toHaveTextContent(/qualified counsel/i);
  });
});

/*
 * Autosave waits a second in the app, which there is no reason for a test to
 * sit through — these mount the workspace with the delay turned down and wait
 * for the call itself.
 */
describe("autosave", () => {
  /** The workspace, saving as soon as a change settles rather than a second later. */
  const mountSaving = (props: { initialDocumentId?: number | null } = {}) =>
    render(<DocumentWorkspace autosaveDelayMs={0} {...props} />);

  it("saves the draft once a document is chosen", async () => {
    const user = userEvent.setup();
    mountSaving();

    await startNda(user);

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0][0]).toBe("mutual-nda");
  });

  it("carries the values and the conversation", async () => {
    const user = userEvent.setup();
    mountSaving();
    await startNda(user);
    await waitFor(() => expect(created).toHaveBeenCalled());

    assistantAnswers({ governingLaw: "Delaware" });
    await say(user, "Delaware law.");

    await waitFor(() => expect(saved).toHaveBeenCalled());
    const [, fields, messages] = saved.mock.calls.at(-1)!;
    expect(fields.governingLaw).toBe("Delaware");
    expect(messages.some((message) => message.content === "Delaware law.")).toBe(
      true,
    );
  });

  it("creates the draft once and replaces it after", async () => {
    /* A second create would leave two copies of one conversation in the list. */
    const user = userEvent.setup();
    mountSaving();
    await startNda(user);
    await waitFor(() => expect(created).toHaveBeenCalled());

    assistantAnswers({ governingLaw: "Delaware" });
    await say(user, "Delaware law.");
    await waitFor(() => expect(saved).toHaveBeenCalled());

    assistantAnswers({ jurisdiction: "New Castle, DE" });
    await say(user, "New Castle.");
    await waitFor(() => expect(saved.mock.calls.length).toBeGreaterThan(1));

    expect(created).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls.every((call) => call[0] === 7)).toBe(true);
  });

  it("saves nothing before a document has been chosen", async () => {
    const user = userEvent.setup();
    asMock.mockResolvedValueOnce({
      reply: "Which one did you have in mind?",
      patch: {},
      documentSlug: null,
    });
    mountSaving();

    await say(user, "I need something drawn up.");
    await screen.findByText("Which one did you have in mind?");

    expect(created).not.toHaveBeenCalled();
  });

  it("says so in the bar when a save fails", async () => {
    const user = userEvent.setup();
    created.mockRejectedValue(new ApiError("The server is unhappy.", 500));
    mountSaving();

    await startNda(user);

    expect(await screen.findByText("Not saved")).toBeInTheDocument();
  });

  it("does not interrupt the conversation when a save fails", async () => {
    /* The chat's error bubble and its focus handling are reserved for turns
       that failed. A save is retried by the next turn on its own. */
    const user = userEvent.setup();
    created.mockRejectedValue(new ApiError("The server is unhappy.", 500));
    mountSaving();

    await startNda(user);
    await screen.findByText("Not saved");

    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("recovers on the next turn after a failed save", async () => {
    const user = userEvent.setup();
    created.mockRejectedValueOnce(new ApiError("The server is unhappy.", 500));
    mountSaving();
    await startNda(user);
    await screen.findByText("Not saved");

    created.mockResolvedValue(savedDocument());
    assistantAnswers({ governingLaw: "Delaware" });
    await say(user, "Delaware law.");

    await waitFor(() =>
      expect(screen.queryByText("Not saved")).not.toBeInTheDocument(),
    );
  });

  it("goes round again for a change that landed mid-save", async () => {
    /*
     * A save in flight is already stale the moment the next turn lands. If the
     * guard against overlapping saves simply dropped that change, the newest
     * answer would sit unsaved until the user happened to say something else —
     * and be lost outright if they closed the tab instead.
     */
    const user = userEvent.setup();
    let release: (value: SavedDocument) => void = () => {};
    created.mockReturnValue(
      new Promise<SavedDocument>((resolve) => {
        release = resolve;
      }),
    );
    mountSaving();
    await startNda(user);
    await waitFor(() => expect(created).toHaveBeenCalled());

    /* Lands while the create above is still unresolved. */
    assistantAnswers({ governingLaw: "Delaware" });
    await say(user, "Delaware law.");
    release(savedDocument());

    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(saved.mock.calls.at(-1)![1].governingLaw).toBe("Delaware");
  });

  it("saves as the tab closes, in a request that outlives the page", async () => {
    /*
     * Closing the tab unmounts nothing — the page is torn down with the pending
     * timer still on it. `pagehide` is the last moment there is to send the
     * turn, and `keepalive` is what lets the request survive the page.
     */
    const user = userEvent.setup();
    render(<DocumentWorkspace autosaveDelayMs={5000} />);
    await startNda(user);

    window.dispatchEvent(new Event("pagehide"));

    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(created.mock.calls.at(-1)![3]).toEqual({ keepalive: true });
  });

  it("does not start a second draft when the tab closes mid-save", async () => {
    /* A create fired before the first has returned an id would leave two rows
       for one conversation. */
    const user = userEvent.setup();
    created.mockReturnValue(new Promise<SavedDocument>(() => {}));
    mountSaving();
    await startNda(user);
    await waitFor(() => expect(created).toHaveBeenCalled());

    window.dispatchEvent(new Event("pagehide"));

    expect(created).toHaveBeenCalledTimes(1);
  });

  it("sends a last save on the way out", async () => {
    /*
     * Leaving cancels the pending timer, which would otherwise drop the turn
     * that was still waiting to be written. Mounted with the app's real delay
     * so the timer really is still pending when this unmounts.
     */
    const user = userEvent.setup();
    const { unmount } = render(<DocumentWorkspace autosaveDelayMs={5000} />);
    await startNda(user);

    unmount();

    await waitFor(() => expect(created).toHaveBeenCalled());
  });
});

describe("reopening a saved document", () => {
  it("puts the values back on the page", async () => {
    loaded.mockResolvedValue(
      savedDocument({ fields: { governingLaw: "Delaware" } }),
    );

    render(<DocumentWorkspace initialDocumentId={7} />);

    /* Once on the cover page and again in the clause citing it — what matters
       is that the value came back, not how many places quote it. */
    expect(await screen.findAllByText("Delaware")).not.toHaveLength(0);
    expect(loaded).toHaveBeenCalledWith(7);
  });

  it("fills in a field the draft was saved without", async () => {
    /*
     * A draft saved before a field existed comes back without it, and every
     * renderer here reads its values without checking they are there — so the
     * saved values are merged onto a complete empty state, not used as-is.
     * Without that merge this render throws.
     */
    loaded.mockResolvedValue(savedDocument({ fields: {} }));

    render(<DocumentWorkspace initialDocumentId={7} />);

    expect(
      await screen.findByRole("heading", { name: /Mutual Non-Disclosure/ }),
    ).toBeInTheDocument();
  });

  it("puts the conversation back", async () => {
    loaded.mockResolvedValue(
      savedDocument({
        messages: [
          { role: "user", content: "I need an NDA." },
          { role: "assistant", content: "Right, a Mutual NDA." },
        ],
      }),
    );

    render(<DocumentWorkspace initialDocumentId={7} />);

    expect(await screen.findByText("I need an NDA.")).toBeInTheDocument();
    expect(screen.getByText("Right, a Mutual NDA.")).toBeInTheDocument();
  });

  it("greets rather than showing an empty log when there was no conversation", async () => {
    loaded.mockResolvedValue(savedDocument({ messages: [] }));

    render(<DocumentWorkspace initialDocumentId={7} />);

    expect(await screen.findByText(/I can help you draft/)).toBeInTheDocument();
  });

  it("loads a generated document's clauses too", async () => {
    loaded.mockResolvedValue(savedDocument({ documentSlug: "pilot-agreement" }));

    render(<DocumentWorkspace initialDocumentId={7} />);
    /*
     * The clauses arrive in a chunk of their own, so the page settles in two
     * steps: the document first, then the agreement under it. Waited for by
     * something only the second step renders — "Loading the agreement…" is
     * absent before the first step too, so waiting for it to go would pass
     * before anything had loaded at all.
     */
    expect(
      await screen.findByRole(
        "heading",
        { name: "Standard Terms" },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pilot Agreement", level: 1 }),
    ).toBeInTheDocument();
  });

  it("replaces the row it came from rather than saving a second copy", async () => {
    const user = userEvent.setup();
    loaded.mockResolvedValue(savedDocument({ id: 42 }));
    render(<DocumentWorkspace initialDocumentId={42} autosaveDelayMs={0} />);
    await screen.findByRole("heading", { name: /Mutual Non-Disclosure/ });

    lastSlug = "mutual-nda";
    assistantAnswers({ governingLaw: "Delaware" });
    await say(user, "Delaware law.");

    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(saved.mock.calls[0][0]).toBe(42);
    expect(created).not.toHaveBeenCalled();
  });

  it("says so when the document belongs to someone else", async () => {
    loaded.mockRejectedValue(
      new ApiError("No document found with that id.", 404),
    );

    render(<DocumentWorkspace initialDocumentId={7} />);

    expect(
      await screen.findByText(/may belong to another account/i),
    ).toBeInTheDocument();
  });

  it("says so when the document is no longer one we can draft", async () => {
    loaded.mockResolvedValue(
      savedDocument({ documentSlug: "withdrawn-template" }),
    );

    render(<DocumentWorkspace initialDocumentId={7} />);

    expect(
      await screen.findByText(/no longer one we can draft/i),
    ).toBeInTheDocument();
  });

  it("saves nothing when it could not be opened", async () => {
    /* Autosaving here would write an empty draft over whatever is really there. */
    loaded.mockRejectedValue(
      new ApiError("No document found with that id.", 404),
    );

    render(<DocumentWorkspace initialDocumentId={7} autosaveDelayMs={0} />);
    await screen.findByText(/may belong to another account/i);

    expect(created).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it("starts a new document when no id is given", async () => {
    render(<DocumentWorkspace initialDocumentId={null} />);

    expect(await screen.findByText(/I can help you draft/)).toBeInTheDocument();
    expect(loaded).not.toHaveBeenCalled();
  });
});
