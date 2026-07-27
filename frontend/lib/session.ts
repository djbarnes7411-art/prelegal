/**
 * Which account this browser is signed in as, and the token that proves it.
 *
 * **The token is the credential; this module is only where it is kept.** It is
 * an opaque random value issued by `/api/auth/signup` or `/api/auth/login`, and
 * the backend stores only its hash — so holding it here is what lets this
 * browser act as the account without resending the password every time. Every
 * authenticated request sends it as `Authorization: Bearer <token>`.
 *
 * Editing this key by hand no longer signs you in as anyone: a token the
 * sessions table does not know is refused, which is the change from PL-4.
 *
 * It is in `localStorage` rather than an HttpOnly cookie because `next dev`
 * serves the frontend from its own port, and a cookie the browser would send
 * cross-origin has to be `SameSite=None; Secure` — which means HTTPS, which
 * means local development stops working. The cost is that script running on
 * this page could read the token.
 */

import { useSyncExternalStore } from "react";

import type { Session } from "./api";

const STORAGE_KEY = "prelegal.session";

/* Defined next to the call that issues it, and re-exported here because this is
   where the rest of the app reaches for it. */
export type { Session };

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

function parse(raw: string | null): Session | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    // A value left by an older build, or edited by hand, is treated as absent.
    // PL-4 stored a bare user with no token; that shape lands here and is
    // discarded, which sends its owner back to the login screen once.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Session).token === "string" &&
      typeof (parsed as Session).user === "object" &&
      (parsed as Session).user !== null &&
      typeof (parsed as Session).user.id === "number" &&
      typeof (parsed as Session).user.email === "string"
    ) {
      return parsed as Session;
    }
  } catch {
    /* Unparseable: fall through and treat it as no session. */
  }

  return null;
}

/*
 * `useSyncExternalStore` re-reads the snapshot on every render and re-renders
 * whenever the result changes identity, so parsing afresh each time would loop
 * forever. These hold the last parse, reused until the raw string changes.
 */
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

/**
 * The stored session, or `null` if there is none.
 *
 * Browser-only — call it from an effect, through `useSession`, or from a fetch
 * that only ever runs in the browser; never during render, or the static export
 * will fail at build time where `window` is absent.
 */
export function readSession(): Session | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSession = parse(raw);
  }

  return cachedSession;
}

/** The token to send, or `null`. Safe to call where there is no `window`. */
export function sessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return readSession()?.token ?? null;
}

/* ------------------------------------------------------------------ *
 * Subscription
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

/** The `storage` event only fires in *other* tabs, so writes announce themselves. */
function announce(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function storeSession(session: Session): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  announce();
}

/**
 * Forgets the session locally.
 *
 * This is the half that always works. Telling the backend to revoke the token
 * is `signOut` in `lib/api.ts`, which calls this either way — a network failure
 * must not leave someone still signed in on the screen in front of them.
 */
export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  announce();
}

/**
 * The current session, or `undefined` before storage has been read.
 *
 * Pages are prerendered at build time, where there is no storage to read, so the
 * first render on the client necessarily knows nothing. Callers render neither
 * signed-in nor signed-out UI while the answer is `undefined`, which is what
 * keeps a signed-in visitor from being shown the login form for a frame.
 */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(subscribe, readSession, () => undefined);
}
