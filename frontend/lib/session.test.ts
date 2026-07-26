import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "./api";
import { clearSession, readSession, storeSession } from "./session";

const ADA: User = {
  id: 1,
  email: "ada@example.com",
  createdAt: "2026-07-26T09:00:00Z",
};

const STORAGE_KEY = "prelegal.session";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readSession", () => {
  it("returns null when nothing has been stored", () => {
    expect(readSession()).toBeNull();
  });

  it("returns the stored account", () => {
    storeSession(ADA);

    expect(readSession()).toEqual(ADA);
  });

  it("survives a round trip through storage rather than memory", () => {
    storeSession(ADA);

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(
      ADA,
    );
  });

  it("treats unparseable storage as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    expect(readSession()).toBeNull();
  });

  it("treats a value missing an id as no session", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ email: "ada@example.com" }),
    );

    expect(readSession()).toBeNull();
  });

  it("treats a value missing an email as no session", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 1 }));

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

describe("clearSession", () => {
  it("removes a stored account", () => {
    storeSession(ADA);

    clearSession();

    expect(readSession()).toBeNull();
  });

  it("is harmless when there is no session", () => {
    expect(() => clearSession()).not.toThrow();
  });
});
