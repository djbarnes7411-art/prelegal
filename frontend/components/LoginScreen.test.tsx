import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./LoginScreen";
import { ApiError, type User } from "@/lib/api";
import { readSession, storeSession } from "@/lib/session";

/*
 * Integration tests, driven through the real form. The API client and the router
 * are the only stand-ins: one would need a server, the other a Next.js runtime.
 */

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

const { login, signup } = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  login,
  signup,
}));

const ADA: User = {
  id: 1,
  email: "ada@example.com",
  createdAt: "2026-07-26T09:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
  replace.mockReset();
  login.mockReset();
  signup.mockReset();
});

async function submit(user: UserEvent, action: string | RegExp) {
  await user.type(screen.getByLabelText("Email"), ADA.email);
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: action }));
}

describe("signing in", () => {
  it("opens on the sign-in form", async () => {
    render(<LoginScreen />);

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("sends what was typed to the login endpoint", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(ADA);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    expect(login).toHaveBeenCalledWith(ADA.email, "hunter2");
  });

  it("stores the account and opens the workspace", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(ADA);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/nda/"));
    expect(readSession()).toEqual(ADA);
  });

  it("does not sign up when signing in", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(ADA);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    expect(signup).not.toHaveBeenCalled();
  });
});

describe("creating an account", () => {
  it("switches to the signup form", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await user.click(screen.getByRole("button", { name: "Create one" }));

    expect(
      screen.getByRole("heading", { name: "Create an account" }),
    ).toBeInTheDocument();
  });

  it("sends what was typed to the signup endpoint", async () => {
    const user = userEvent.setup();
    signup.mockResolvedValue(ADA);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");
    await user.click(screen.getByRole("button", { name: "Create one" }));

    await submit(user, "Create account");

    expect(signup).toHaveBeenCalledWith(ADA.email, "hunter2");
    expect(login).not.toHaveBeenCalled();
  });

  it("switches back to signing in", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await user.click(screen.getByRole("button", { name: "Create one" }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});

describe("when the server refuses", () => {
  it("shows the reason as an alert", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError("No account found for that email.", 404));
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No account found for that email.",
    );
  });

  it("does not store a session or navigate", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError("No account found for that email.", 404));
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    await screen.findByRole("alert");
    expect(readSession()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("lets the user try again", async () => {
    const user = userEvent.setup();
    login.mockRejectedValueOnce(new ApiError("No account found.", 404));
    render(<LoginScreen />);
    await screen.findByLabelText("Email");
    await submit(user, "Sign in");
    await screen.findByRole("alert");

    login.mockResolvedValue(ADA);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/nda/"));
  });

  it("clears the message when switching form", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new ApiError("No account found.", 404));
    render(<LoginScreen />);
    await screen.findByLabelText("Email");
    await submit(user, "Sign in");
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Create one" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an unexpected failure without leaking it", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new TypeError("boom"));
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
  });
});

describe("when already signed in", () => {
  it("offers to continue rather than asking again", async () => {
    storeSession(ADA);

    render(<LoginScreen />);

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("names the account", async () => {
    storeSession(ADA);

    render(<LoginScreen />);

    expect(await screen.findByText(ADA.email)).toBeInTheDocument();
  });

  it("continues to the workspace", async () => {
    const user = userEvent.setup();
    storeSession(ADA);
    render(<LoginScreen />);

    await user.click(await screen.findByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/nda/");
  });

  it("signing out returns to the form and forgets the account", async () => {
    const user = userEvent.setup();
    storeSession(ADA);
    render(<LoginScreen />);

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });
});

describe("the honesty notice", () => {
  it("says passwords are not checked and accounts do not persist", async () => {
    render(<LoginScreen />);

    const notice = await screen.findByText(/passwords are not checked/i);
    expect(notice).toHaveTextContent(/cleared each time the server restarts/i);
  });
});
