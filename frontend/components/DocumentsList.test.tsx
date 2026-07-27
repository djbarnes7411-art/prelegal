import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentsList } from "./DocumentsList";
import {
  ApiError,
  deleteDocument,
  listDocuments,
  type DocumentSummary,
} from "@/lib/api";
import { findDocument } from "@/lib/documents/catalog";
import { createEmptyState } from "@/lib/documents/values";
import type { DocumentDef } from "@/lib/documents/types";

/*
 * Integration tests, driven through the real list. The API is the only
 * stand-in — the titles and the "what's left" counts are worked out here from
 * the real catalog, which is the part worth checking.
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listDocuments: vi.fn(),
  deleteDocument: vi.fn(),
}));

const listed = vi.mocked(listDocuments);
const removed = vi.mocked(deleteDocument);

const nda = findDocument("mutual-nda") as DocumentDef;
const pilot = findDocument("pilot-agreement") as DocumentDef;

function summary(over: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 1,
    documentSlug: "mutual-nda",
    fields: createEmptyState(nda),
    createdAt: "2026-07-26T09:00:00Z",
    updatedAt: "2026-07-26T09:30:00Z",
    ...over,
  };
}

/** A Mutual NDA with both parties named, so nothing is outstanding. */
function complete(): DocumentSummary {
  const party = {
    companyName: "Northwind Labs, Inc.",
    signatoryName: "Dana Reyes",
    signatoryTitle: "Chief Executive Officer",
    noticeAddress: "legal@northwindlabs.com",
  };
  return summary({
    fields: {
      ...createEmptyState(nda),
      governingLaw: "Delaware",
      jurisdiction: "New Castle, DE",
      partyOne: party,
      partyTwo: { ...party, companyName: "Kestrel Analytics LLC" },
    },
  });
}

beforeEach(() => {
  push.mockReset();
  listed.mockReset();
  listed.mockResolvedValue([]);
  removed.mockReset();
  removed.mockResolvedValue(undefined);
});

describe("while loading", () => {
  it("says so", () => {
    render(<DocumentsList />);

    expect(screen.getByText("Loading your documents…")).toBeInTheDocument();
  });
});

describe("with nothing drafted", () => {
  it("says so rather than showing an empty list", async () => {
    render(<DocumentsList />);

    expect(await screen.findByText("Nothing drafted yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("offers a way to start", async () => {
    const user = userEvent.setup();
    render(<DocumentsList />);
    await screen.findByText("Nothing drafted yet");

    await user.click(
      screen.getByRole("button", { name: "Draft your first document" }),
    );

    expect(push).toHaveBeenCalledWith("/draft/");
  });
});

describe("with documents", () => {
  it("names each one from the catalog", async () => {
    listed.mockResolvedValue([
      summary(),
      summary({
        id: 2,
        documentSlug: "pilot-agreement",
        fields: createEmptyState(pilot),
      }),
    ]);

    render(<DocumentsList />);

    expect(
      await screen.findByRole("button", { name: nda.name }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: pilot.name })).toBeInTheDocument();
  });

  it("does not repeat the document's name as its own title", async () => {
    /* Before the parties are named the title is the document's name, and
       printing it twice says nothing the second time. */
    listed.mockResolvedValue([summary()]);

    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    expect(screen.getAllByText(nda.name)).toHaveLength(1);
  });

  it("says which document a titled one is", async () => {
    listed.mockResolvedValue([complete()]);

    render(<DocumentsList />);

    expect(await screen.findByText(nda.name)).toBeInTheDocument();
  });

  it("titles one by its parties once they are named", async () => {
    /* The same title the workspace and the PDF use — built here from the
       values, not stored by the backend, so the two cannot disagree. */
    listed.mockResolvedValue([complete()]);

    render(<DocumentsList />);

    expect(
      await screen.findByRole("button", {
        name: "Mutual NDA - Northwind Labs, Inc. and Kestrel Analytics LLC",
      }),
    ).toBeInTheDocument();
  });

  it("counts what a draft is still short of", async () => {
    listed.mockResolvedValue([summary()]);

    render(<DocumentsList />);

    expect(await screen.findByText(/answers still needed/)).toBeInTheDocument();
  });

  it("says a finished one is ready", async () => {
    listed.mockResolvedValue([complete()]);

    render(<DocumentsList />);

    expect(await screen.findByText("Ready to download")).toBeInTheDocument();
  });

  it("opens one where it left off", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary({ id: 42 })]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    await user.click(screen.getByRole("button", { name: nda.name }));

    expect(push).toHaveBeenCalledWith("/draft/?doc=42");
  });

  it("starts a new one", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary()]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    await user.click(screen.getByRole("button", { name: "New document" }));

    expect(push).toHaveBeenCalledWith("/draft/");
  });

  it("leaves out one whose document is no longer in the catalog", async () => {
    /* The backend filters these out too; rendering a nameless card would be
       worse than rendering none. */
    listed.mockResolvedValue([
      summary(),
      summary({ id: 2, documentSlug: "withdrawn-template" }),
    ]);

    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("deleting one", () => {
  it("asks before it does", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary()]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    await user.click(screen.getByRole("button", { name: /^Delete/ }));

    expect(screen.getByText("Delete this draft?")).toBeInTheDocument();
    expect(removed).not.toHaveBeenCalled();
  });

  it("can be changed your mind about", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary()]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });
    await user.click(screen.getByRole("button", { name: /^Delete/ }));

    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.queryByText("Delete this draft?")).not.toBeInTheDocument();
    expect(removed).not.toHaveBeenCalled();
  });

  it("removes it once confirmed", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary({ id: 42 })]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });
    await user.click(screen.getByRole("button", { name: /^Delete/ }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(removed).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: nda.name })).not.toBeInTheDocument(),
    );
  });

  it("leaves the others alone", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([
      summary({ id: 1 }),
      summary({ id: 2, documentSlug: "pilot-agreement", fields: createEmptyState(pilot) }),
    ]);
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });

    const card = screen.getByRole("button", { name: nda.name }).closest("li")!;
    await user.click(within(card).getByRole("button", { name: /^Delete/ }));
    await user.click(within(card).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(removed).toHaveBeenCalledWith(1));
    expect(screen.getByRole("button", { name: pilot.name })).toBeInTheDocument();
  });

  it("says so when it cannot be deleted, and keeps the card", async () => {
    const user = userEvent.setup();
    listed.mockResolvedValue([summary()]);
    removed.mockRejectedValue(new ApiError("The server is unhappy.", 500));
    render(<DocumentsList />);
    await screen.findByRole("button", { name: nda.name });
    await user.click(screen.getByRole("button", { name: /^Delete/ }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server is unhappy.",
    );
    expect(screen.getByRole("button", { name: nda.name })).toBeInTheDocument();
  });
});

describe("when the list cannot be loaded", () => {
  it("says why", async () => {
    listed.mockRejectedValue(new ApiError("The server is unhappy.", 500));

    render(<DocumentsList />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server is unhappy.",
    );
  });

  it("lets the reader try again", async () => {
    const user = userEvent.setup();
    listed.mockRejectedValueOnce(new ApiError("The server is unhappy.", 500));
    render(<DocumentsList />);
    await screen.findByRole("alert");

    listed.mockResolvedValue([summary()]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: nda.name })).toBeInTheDocument();
  });

  it("stays quiet when the session has simply ended", async () => {
    /*
     * A 401 has already signed the browser out and the page around this is on
     * its way to the login screen. Complaining under it would flash an error
     * at someone who is only signed out.
     */
    listed.mockRejectedValue(new ApiError("Your session has ended.", 401));

    render(<DocumentsList />);

    await waitFor(() => expect(listed).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
