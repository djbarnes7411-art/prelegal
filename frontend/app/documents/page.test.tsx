import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocumentsPage from "./page";
import { storeSession } from "@/lib/session";

/* The gate, not the list — `DocumentsList` has its own suite. */

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listDocuments: vi.fn(async () => []),
}));

const SESSION = {
  user: { id: 1, email: "ada@example.com", createdAt: "2026-07-26T09:00:00Z" },
  token: "opaque-token",
};

beforeEach(() => {
  replace.mockReset();
  window.localStorage.clear();
});

describe("the documents page", () => {
  it("shows the list to a signed-in account", async () => {
    storeSession(SESSION);

    render(<DocumentsPage />);

    expect(
      await screen.findByRole("heading", { name: "My documents" }),
    ).toBeInTheDocument();
  });

  it("names the account in the bar", async () => {
    storeSession(SESSION);

    render(<DocumentsPage />);

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to the login screen", async () => {
    render(<DocumentsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows nothing to a signed-out visitor rather than an empty list", () => {
    render(<DocumentsPage />);

    expect(
      screen.queryByRole("heading", { name: "My documents" }),
    ).not.toBeInTheDocument();
  });
});
