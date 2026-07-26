"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";

import { ApiError, login, signup } from "@/lib/api";
import { clearSession, storeSession, useSession } from "@/lib/session";

/** Where signing in takes you. The only document in the platform so far. */
const WORKSPACE_PATH = "/nda/";

type Mode = "signIn" | "createAccount";

interface ModeCopy {
  heading: string;
  action: string;
  /** The mode the switch link leads to. */
  switchTo: Mode;
  switchLabel: string;
}

const COPY: Record<Mode, ModeCopy> = {
  signIn: {
    heading: "Sign in",
    action: "Sign in",
    switchTo: "createAccount",
    switchLabel: "Create one",
  },
  createAccount: {
    heading: "Create an account",
    action: "Create account",
    switchTo: "signIn",
    switchLabel: "Sign in",
  },
};

export function LoginScreen() {
  const router = useRouter();
  /** `undefined` until storage has been read — see the render below. */
  const session = useSession();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);

      try {
        const user =
          mode === "signIn"
            ? await login(email, password)
            : await signup(email, password);
        storeSession(user);
        // Deliberately not clearing `submitting` — the button stays disabled
        // while the route change is in flight.
        router.push(WORKSPACE_PATH);
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Something went wrong. Try again.",
        );
        setSubmitting(false);
      }
    },
    [email, mode, password, router],
  );

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
  }, []);

  /*
   * Nothing renders until storage has been read. The page is prerendered at
   * build time, so committing to the form first would flash it at someone who
   * is already signed in.
   */
  if (session === undefined) return null;

  return (
    <main className="entry">
      <div className="entry-card">
        <div className="entry-brand">
          <span className="entry-mark" aria-hidden="true">
            §
          </span>
          <span className="entry-name">Prelegal</span>
        </div>
        <p className="entry-tagline">
          Draft legal agreements from vetted templates.
        </p>

        {session ? (
          <ReturningUser
            email={session.email}
            onContinue={() => router.push(WORKSPACE_PATH)}
            onSignOut={clearSession}
          />
        ) : (
          <form className="entry-form" onSubmit={handleSubmit}>
            <h1 className="entry-heading">{COPY[mode].heading}</h1>

            <div className="entry-field">
              <label className="entry-label" htmlFor="entry-email">
                Email
              </label>
              <input
                id="entry-email"
                className="entry-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="entry-field">
              <label className="entry-label" htmlFor="entry-password">
                Password
              </label>
              <input
                id="entry-password"
                className="entry-input"
                type="password"
                autoComplete={
                  mode === "signIn" ? "current-password" : "new-password"
                }
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? (
              <p className="entry-error" role="alert">
                {error}
              </p>
            ) : null}

            <button className="entry-submit" type="submit" disabled={submitting}>
              {submitting ? "One moment…" : COPY[mode].action}
            </button>

            <p className="entry-switch">
              {mode === "signIn"
                ? "No account yet?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                className="entry-link"
                onClick={() => switchMode(COPY[mode].switchTo)}
              >
                {COPY[mode].switchLabel}
              </button>
            </p>
          </form>
        )}

        {/*
          Stated plainly rather than buried: anyone can sign in as any registered
          address, and the accounts themselves are discarded when the container
          restarts. Both are true of this build and of nothing after it.
        */}
        <p className="entry-notice">
          Early build — passwords are not checked and accounts are cleared each
          time the server restarts. Do not put anything private here.
        </p>
      </div>
    </main>
  );
}

function ReturningUser({
  email,
  onContinue,
  onSignOut,
}: {
  email: string;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="entry-form">
      <h1 className="entry-heading">Welcome back</h1>
      <p className="entry-current">
        Signed in as <strong>{email}</strong>
      </p>
      <button className="entry-submit" type="button" onClick={onContinue}>
        Continue
      </button>
      <p className="entry-switch">
        Not you?{" "}
        <button type="button" className="entry-link" onClick={onSignOut}>
          Sign out
        </button>
      </p>
    </div>
  );
}
