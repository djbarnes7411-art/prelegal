import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DraftPage from "./page";
import { storeSession } from "@/lib/session";

/*
 * The gate and the `?doc=` reading — the workspace itself has its own suite,
 * and is substituted here so these tests are about the page and nothing else.
 */

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock("@/components/DocumentWorkspace", () => ({
  DocumentWorkspace: ({
    initialDocumentId,
  }: {
    initialDocumentId?: number | null;
  }) => <p>workspace for {String(initialDocumentId)}</p>,
}));

const SESSION = {
  user: { id: 1, email: "ada@example.com", createdAt: "2026-07-26T09:00:00Z" },
  token: "opaque-token",
};

/** The export has one `/draft/` page, so which document is in the query. */
function visit(search: string) {
  window.history.replaceState({}, "", `/draft/${search}`);
}

beforeEach(() => {
  replace.mockReset();
  window.localStorage.clear();
  visit("");
});

afterEach(() => {
  visit("");
});

describe("the draft page", () => {
  it("sends a signed-out visitor to the login screen", async () => {
    render(<DraftPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("starts a new document when the address carries no id", async () => {
    storeSession(SESSION);

    render(<DraftPage />);

    expect(await screen.findByText("workspace for null")).toBeInTheDocument();
  });

  it("opens the document the address names", async () => {
    storeSession(SESSION);
    visit("?doc=42");

    render(<DraftPage />);

    expect(await screen.findByText("workspace for 42")).toBeInTheDocument();
  });

  it("starts a new document when the id is not a number", async () => {
    /* A mangled link should land somewhere useful, not on an error. */
    storeSession(SESSION);
    visit("?doc=not-a-number");

    render(<DraftPage />);

    expect(await screen.findByText("workspace for null")).toBeInTheDocument();
  });

  it("starts a new document when the id is not a real one", async () => {
    storeSession(SESSION);
    visit("?doc=0");

    render(<DraftPage />);

    expect(await screen.findByText("workspace for null")).toBeInTheDocument();
  });
});
