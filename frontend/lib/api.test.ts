import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createDocument,
  deleteDocument,
  listDocuments,
  loadDocument,
  login,
  saveDocument,
  sendChatTurn,
  signOut,
  signup,
} from "./api";
import { createEmptyState } from "./documents/values";
import { DOCUMENTS } from "./documents/catalog";
import { readSession, storeSession } from "./session";

const USER_PAYLOAD = {
  id: 1,
  email: "ada@example.com",
  created_at: "2026-07-26T09:00:00Z",
};

const SESSION_PAYLOAD = { user: USER_PAYLOAD, token: "opaque-token" };

const STORED_SESSION = {
  user: { id: 1, email: "ada@example.com", createdAt: "2026-07-26T09:00:00Z" },
  token: "opaque-token",
};

/** The header every authenticated call is expected to carry. */
function sentHeaders(call = 0): Headers {
  return fetchMock.mock.calls[call][1].headers as Headers;
}

function respondWith(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signup", () => {
  it("posts the credentials to the signup endpoint", async () => {
    fetchMock.mockResolvedValue(respondWith(SESSION_PAYLOAD, 201));

    await signup("ada@example.com", "hunter2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/signup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      email: "ada@example.com",
      password: "hunter2",
    });
  });

  it("converts the account to camelCase and keeps the token", async () => {
    fetchMock.mockResolvedValue(respondWith(SESSION_PAYLOAD, 201));

    await expect(signup("ada@example.com", "hunter2")).resolves.toEqual(
      STORED_SESSION,
    );
  });

  it("sends no token of its own — there is not one yet", async () => {
    fetchMock.mockResolvedValue(respondWith(SESSION_PAYLOAD, 201));

    await signup("ada@example.com", "hunter2");

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("surfaces the server's reason for a conflict", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: "An account with that email already exists." }, 409),
    );

    await expect(signup("ada@example.com", "hunter2")).rejects.toThrow(
      "An account with that email already exists.",
    );
  });
});

describe("login", () => {
  it("posts to the login endpoint", async () => {
    fetchMock.mockResolvedValue(respondWith(SESSION_PAYLOAD));

    await login("ada@example.com", "hunter2");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login");
  });

  it("surfaces the server's reason for an unknown account", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: "No account found for that email." }, 404),
    );

    await expect(login("nobody@example.com", "hunter2")).rejects.toThrow(
      "No account found for that email.",
    );
  });
});

describe("signing out", () => {
  it("tells the server to revoke the token", async () => {
    storeSession(STORED_SESSION);
    fetchMock.mockResolvedValue(respondWith(null, 204));

    await signOut();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/logout");
    expect(sentHeaders().get("Authorization")).toBe("Bearer opaque-token");
  });

  it("forgets the session locally", async () => {
    storeSession(STORED_SESSION);
    fetchMock.mockResolvedValue(respondWith(null, 204));

    await signOut();

    expect(readSession()).toBeNull();
  });

  it("forgets it even when the server cannot be reached", async () => {
    /* Someone who pressed sign out must not be left on a signed-in screen
       because a request failed. The token expires on its own. */
    storeSession(STORED_SESSION);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(signOut()).resolves.toBeUndefined();
    expect(readSession()).toBeNull();
  });
});

describe("the session token", () => {
  beforeEach(() => {
    storeSession(STORED_SESSION);
  });

  it("goes with an authenticated request", async () => {
    fetchMock.mockResolvedValue(respondWith([]));

    await listDocuments();

    expect(sentHeaders().get("Authorization")).toBe("Bearer opaque-token");
  });

  it("goes with a chat turn", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Noted." }));

    await sendChatTurn([{ role: "user", content: "hi" }], null, {});

    expect(sentHeaders().get("Authorization")).toBe("Bearer opaque-token");
  });

  it("is simply absent when there is no session", async () => {
    window.localStorage.clear();
    fetchMock.mockResolvedValue(respondWith([]));

    await listDocuments();

    expect(sentHeaders().get("Authorization")).toBeNull();
  });
});

describe("when the session has ended", () => {
  beforeEach(() => {
    storeSession(STORED_SESSION);
  });

  it("signs the browser out", async () => {
    /* Clearing it here is what makes every `useSession` re-render, which is
       what sends the pages back to the login screen. */
    fetchMock.mockResolvedValue(respondWith({ detail: "Sign in to continue." }, 401));

    await expect(listDocuments()).rejects.toThrow("Your session has ended");
    expect(readSession()).toBeNull();
  });

  it("says so in our words, not the backend's", async () => {
    fetchMock.mockResolvedValue(respondWith({ detail: "Sign in to continue." }, 401));

    await expect(sendChatTurn([{ role: "user", content: "hi" }], null, {})).rejects.toThrow(
      "Your session has ended. Sign in again.",
    );
  });

  it("survives a 401 carrying no body at all", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => {
        throw new Error("no body");
      },
    } as unknown as Response);

    await expect(listDocuments()).rejects.toMatchObject({ status: 401 });
    expect(readSession()).toBeNull();
  });

  it("leaves the session alone for any other failure", async () => {
    fetchMock.mockResolvedValue(respondWith({ detail: "Nope." }, 500));

    await expect(listDocuments()).rejects.toThrow("Nope.");
    expect(readSession()).not.toBeNull();
  });
});

describe("saved documents", () => {
  const SAVED = {
    id: 7,
    documentSlug: "pilot-agreement",
    fields: {},
    messages: [],
    createdAt: "2026-07-26T09:00:00Z",
    updatedAt: "2026-07-26T09:30:00Z",
  };

  beforeEach(() => {
    storeSession(STORED_SESSION);
  });

  it("lists them", async () => {
    fetchMock.mockResolvedValue(respondWith([SAVED]));

    await expect(listDocuments()).resolves.toEqual([SAVED]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents");
  });

  it("treats an empty list response as no documents", async () => {
    fetchMock.mockResolvedValue(respondWith(null));

    await expect(listDocuments()).resolves.toEqual([]);
  });

  it("opens one", async () => {
    fetchMock.mockResolvedValue(respondWith(SAVED));

    await expect(loadDocument(7)).resolves.toEqual(SAVED);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/7");
  });

  it("creates one with the document, its values and the conversation", async () => {
    fetchMock.mockResolvedValue(respondWith(SAVED, 201));
    const messages = [{ role: "user" as const, content: "a pilot" }];

    await createDocument("pilot-agreement", { pilotPeriod: "60 days" }, messages);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/documents");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      documentSlug: "pilot-agreement",
      fields: { pilotPeriod: "60 days" },
      messages,
    });
  });

  it("saves one whole, without naming a document", async () => {
    /* The document a draft is never changes, so the endpoint does not take it
       and neither does this. */
    fetchMock.mockResolvedValue(respondWith(SAVED));

    await saveDocument(7, { pilotPeriod: "90 days" }, []);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/documents/7");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      fields: { pilotPeriod: "90 days" },
      messages: [],
    });
  });

  it("deletes one", async () => {
    fetchMock.mockResolvedValue(respondWith(null, 204));

    await expect(deleteDocument(7)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("surfaces the server's reason for one it cannot find", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: "No document found with that id." }, 404),
    );

    await expect(loadDocument(7)).rejects.toThrow("No document found with that id.");
  });
});

describe("sendChatTurn", () => {
  const messages = [{ role: "user" as const, content: "Delaware law." }];
  const nda = DOCUMENTS.find((document) => document.slug === "mutual-nda")!;
  const fields = () => createEmptyState(nda);

  it("sends the transcript, the document, and its values", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Noted.", patch: {} }));
    const sent = fields();

    await sendChatTurn(messages, "mutual-nda", sent);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      messages,
      documentSlug: "mutual-nda",
      fields: sent,
    });
  });

  it("asks which document is meant when none has been chosen", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Which one?", patch: {} }));

    await sendChatTurn(messages, null, {});

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).documentSlug).toBeNull();
  });

  it("reports the document the assistant settled on", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ reply: "Right.", documentSlug: "pilot-agreement", patch: {} }),
    );

    const turn = await sendChatTurn(messages, null, {});

    expect(turn.documentSlug).toBe("pilot-agreement");
  });

  it("treats an absent document as no choice made", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Which one?" }));

    const turn = await sendChatTurn(messages, null, {});

    expect(turn.documentSlug).toBeNull();
  });

  it("returns the reply and the patch", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ reply: "Delaware it is.", patch: { governingLaw: "Delaware" } }),
    );

    await expect(sendChatTurn(messages, "mutual-nda", fields())).resolves.toEqual({
      reply: "Delaware it is.",
      documentSlug: null,
      patch: { governingLaw: "Delaware" },
    });
  });

  it("treats a turn that changed nothing as an empty patch", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Which state?" }));

    const turn = await sendChatTurn(messages, "mutual-nda", fields());

    expect(turn.patch).toEqual({});
  });

  it("surfaces the server's reason for an unavailable assistant", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: "The assistant is unavailable right now." }, 503),
    );

    await expect(sendChatTurn(messages, "mutual-nda", fields())).rejects.toThrow(
      "The assistant is unavailable right now.",
    );
  });

  it("does not blame the login form for a rejected message", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: [{ loc: ["body", "messages"] }] }, 422),
    );

    await expect(sendChatTurn(messages, "mutual-nda", fields())).rejects.toThrow(
      "That message could not be sent. Try rewording it.",
    );
  });

  it("reports an unreachable server", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      sendChatTurn(messages, "mutual-nda", fields()),
    ).rejects.toMatchObject({ status: 0 });
  });
});

describe("error reporting", () => {
  it("carries the status code", async () => {
    fetchMock.mockResolvedValue(respondWith({ detail: "Nope." }, 404));

    await expect(login("ada@example.com", "x")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("replaces a validation error's field list with readable copy", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: [{ loc: ["body", "email"], msg: "value error" }] }, 422),
    );

    await expect(signup("nope", "hunter2")).rejects.toThrow(
      "Check the email address and password, then try again.",
    );
  });

  it("falls back to the status for an unexpected error shape", async () => {
    fetchMock.mockResolvedValue(respondWith({ unexpected: true }, 500));

    await expect(login("ada@example.com", "hunter2")).rejects.toThrow(
      "Something went wrong (500). Try again.",
    );
  });

  it("survives an error response with no body at all", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("no body");
      },
    } as unknown as Response);

    await expect(login("ada@example.com", "hunter2")).rejects.toThrow(
      "Something went wrong (502). Try again.",
    );
  });

  it("reports an unreachable server rather than a fetch failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const failure = login("ada@example.com", "hunter2");

    await expect(failure).rejects.toThrow("Could not reach the server");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 0 });
  });
});
