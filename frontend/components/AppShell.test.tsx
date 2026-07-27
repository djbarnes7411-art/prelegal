import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { signOut } from "@/lib/api";

/*
 * The bar every signed-in screen wears. The router and the sign-out call are
 * the stand-ins: one needs a Next.js runtime, the other a server.
 */

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  signOut: vi.fn(),
}));

const signOutMock = vi.mocked(signOut);

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue(undefined);
});

function shell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell active={null} email="ada@example.com" {...props}>
      <p>The screen</p>
    </AppShell>,
  );
}

describe("the bar", () => {
  it("carries the product's name", () => {
    shell();

    expect(screen.getByText("Prelegal")).toBeInTheDocument();
  });

  it("names the signed-in account", () => {
    shell();

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("renders whatever screen it is wrapping", () => {
    shell();

    expect(screen.getByText("The screen")).toBeInTheDocument();
  });

  it("shows what the screen puts in the middle and at the end", () => {
    shell({ center: <p>Mutual NDA</p>, end: <button>Download PDF</button> });

    expect(screen.getByText("Mutual NDA")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download PDF" }),
    ).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("goes to a new document", async () => {
    const user = userEvent.setup();
    shell();

    await user.click(screen.getByRole("button", { name: "New document" }));

    expect(push).toHaveBeenCalledWith("/draft/");
  });

  it("goes to the documents list", async () => {
    const user = userEvent.setup();
    shell();

    await user.click(screen.getByRole("button", { name: "My documents" }));

    expect(push).toHaveBeenCalledWith("/documents/");
  });

  it("marks the screen you are on", () => {
    shell({ active: "documents" });

    expect(screen.getByRole("button", { name: "My documents" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("button", { name: "New document" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks neither when the screen is neither", () => {
    shell({ active: null });

    expect(
      screen.queryByRole("button", { current: "page" }),
    ).not.toBeInTheDocument();
  });
});

describe("signing out", () => {
  it("revokes the session rather than only forgetting it", async () => {
    /* The token stays valid on the server otherwise, for a fortnight. */
    const user = userEvent.setup();
    shell();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
  });

  it("returns to the login screen", async () => {
    const user = userEvent.setup();
    shell();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
