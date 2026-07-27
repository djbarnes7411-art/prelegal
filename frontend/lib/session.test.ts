import { beforeEach, describe, expect, it } from "vitest";

import type { Session, User } from "./api";
import {
  clearSession,
  readSession,
  sessionToken,
  storeSession,
} from "./session";

const ADA: User = {
  id: 1,
  email: "ada@example.com",
  createdAt: "2026-07-26T09:00:00Z",
};

const SESSION: Session = { user: ADA, token: "opaque-token" };

const STORAGE_KEY = "prelegal.session";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readSession", () => {
  it("returns null when nothing has been stored", () => {
    expect(readSession()).toBeNull();
  });

  it("returns the stored session", () => {
    storeSession(SESSION);

    expect(readSession()).toEqual(SESSION);
  });

  it("survives a round trip through storage rather than memory", () => {
    storeSession(SESSION);

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(
      SESSION,
    );
  });

  it("treats unparseable storage as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    expect(readSession()).toBeNull();
  });

  it("treats a session with no token as none", () => {
    /*
     * This is exactly the shape PL-4 stored: a bare user, no token. Someone
     * upgrading has one in their browser, and it has to send them back to the
     * login screen rather than through to a workspace that cannot call anything.
     */
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ADA));

    expect(readSession()).toBeNull();
  });

  it("treats a token with no account as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "abc" }));

    expect(readSession()).toBeNull();
  });

  it("treats an account missing an id as no session", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: { email: "ada@example.com" }, token: "abc" }),
    );

    expect(readSession()).toBeNull();
  });

  it("treats an account missing an email as no session", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: { id: 1 }, token: "abc" }),
    );

    expect(readSession()).toBeNull();
  });

  it("treats a non-string token as no session", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: ADA, token: 12345 }),
    );

    expect(readSession()).toBeNull();
  });

  it("treats a non-object value as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify("ada@example.com"));

    expect(readSession()).toBeNull();
  });

  it("treats null as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, "null");

    expect(readSession()).toBeNull();
  });
});

describe("sessionToken", () => {
  it("is the token of the stored session", () => {
    storeSession(SESSION);

    expect(sessionToken()).toBe("opaque-token");
  });

  it("is null when there is no session", () => {
    expect(sessionToken()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes a stored session", () => {
    storeSession(SESSION);

    clearSession();

    expect(readSession()).toBeNull();
  });

  it("is harmless when there is no session", () => {
    expect(() => clearSession()).not.toThrow();
  });
});
