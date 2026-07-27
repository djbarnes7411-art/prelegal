import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "./LoginScreen";
import { ApiError, type Session, type User } from "@/lib/api";
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

const { login, signup, signOut } = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  login,
  signup,
  signOut,
}));

const ADA: User = {
  id: 1,
  email: "ada@example.com",
  createdAt: "2026-07-26T09:00:00Z",
};

const SESSION: Session = { user: ADA, token: "opaque-token" };

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
  replace.mockReset();
  login.mockReset();
  signup.mockReset();
  /* The real one clears storage; this stand-in has to do the same, or the
     "signing out returns to the form" test would assert nothing. */
  signOut.mockReset();
  signOut.mockImplementation(async () => {
    window.localStorage.removeItem("prelegal.session");
    window.dispatchEvent(new Event("storage"));
  });
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
    login.mockResolvedValue(SESSION);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    expect(login).toHaveBeenCalledWith(ADA.email, "hunter2");
  });

  it("stores the session and opens the documents list", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(SESSION);
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    await submit(user, "Sign in");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/"));
    expect(readSession()).toEqual(SESSION);
  });

  it("does not sign up when signing in", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue(SESSION);
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
    signup.mockResolvedValue(SESSION);
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

    login.mockResolvedValue(SESSION);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/"));
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
    storeSession(SESSION);

    render(<LoginScreen />);

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("names the account", async () => {
    storeSession(SESSION);

    render(<LoginScreen />);

    expect(await screen.findByText(ADA.email)).toBeInTheDocument();
  });

  it("continues to the documents list", async () => {
    const user = userEvent.setup();
    storeSession(SESSION);
    render(<LoginScreen />);

    await user.click(await screen.findByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/documents/");
  });

  it("signing out returns to the form and forgets the account", async () => {
    const user = userEvent.setup();
    storeSession(SESSION);
    render(<LoginScreen />);

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });
});

describe("the honesty notice", () => {
  it("says the password is checked but nothing survives a restart", async () => {
    /*
     * The claim this replaces was that passwords are not checked at all. It was
     * true and is not any more; what is still true, and still worth saying
     * before anyone types, is that the account does not survive a restart.
     */
    render(<LoginScreen />);

    const notice = await screen.findByText(/your password is checked/i);
    expect(notice).toHaveTextContent(/cleared each time the server restarts/i);
  });

  it("no longer claims passwords go unchecked", async () => {
    render(<LoginScreen />);
    await screen.findByLabelText("Email");

    expect(screen.queryByText(/passwords are not checked/i)).not.toBeInTheDocument();
  });
});
