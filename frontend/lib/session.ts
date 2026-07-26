/**
 * Which account this browser is acting as.
 *
 * **Not a credential and not a security boundary.** There is no authentication
 * yet (PL-4), so this only remembers the account chosen on the way in. Editing
 * it by hand "signs you in" as someone else — which is exactly as meaningful as
 * the login screen it came from, since that does not check passwords either.
 *
 * Real sessions replace this wholesale; nothing else in the app reads the key.
 */

import { useSyncExternalStore } from "react";

import type { User } from "./api";

const STORAGE_KEY = "prelegal.session";

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

function parse(raw: string | null): User | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    // A value left by an older build, or edited by hand, is treated as absent.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as User).id === "number" &&
      typeof (parsed as User).email === "string"
    ) {
      return parsed as User;
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
let cachedUser: User | null = null;

/**
 * The stored account, or `null` if there is none.
 *
 * Browser-only — call it from an effect or through `useSession`, never during
 * render, or the static export will fail at build time where `window` is absent.
 */
export function readSession(): User | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedUser = parse(raw);
  }

  return cachedUser;
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

export function storeSession(user: User): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  announce();
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  announce();
}

/**
 * The current account, or `undefined` before storage has been read.
 *
 * Pages are prerendered at build time, where there is no storage to read, so the
 * first render on the client necessarily knows nothing. Callers render neither
 * signed-in nor signed-out UI while the answer is `undefined`, which is what
 * keeps a signed-in visitor from being shown the login form for a frame.
 */
export function useSession(): User | null | undefined {
  return useSyncExternalStore(subscribe, readSession, () => undefined);
}
