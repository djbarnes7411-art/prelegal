import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, login, sendChatTurn, signup } from "./api";
import { createEmptyState } from "./documents/values";
import { DOCUMENTS } from "./documents/catalog";

const USER_PAYLOAD = {
  id: 1,
  email: "ada@example.com",
  created_at: "2026-07-26T09:00:00Z",
};

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signup", () => {
  it("posts the credentials to the signup endpoint", async () => {
    fetchMock.mockResolvedValue(respondWith(USER_PAYLOAD, 201));

    await signup("ada@example.com", "hunter2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/signup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      email: "ada@example.com",
      password: "hunter2",
    });
  });

  it("converts the response to camelCase", async () => {
    fetchMock.mockResolvedValue(respondWith(USER_PAYLOAD, 201));

    await expect(signup("ada@example.com", "hunter2")).resolves.toEqual({
      id: 1,
      email: "ada@example.com",
      createdAt: "2026-07-26T09:00:00Z",
    });
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
    fetchMock.mockResolvedValue(respondWith(USER_PAYLOAD));

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
