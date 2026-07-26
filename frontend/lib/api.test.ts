import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, login, sendChatTurn, signup } from "./api";
import { createEmptyCoverPage } from "./nda/types";

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

  it("sends the transcript and the agreement as it stands", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Noted.", patch: {} }));
    const coverPage = createEmptyCoverPage();

    await sendChatTurn(messages, coverPage);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/nda/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ messages, coverPage });
  });

  it("returns the reply and the patch", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ reply: "Delaware it is.", patch: { governingLaw: "Delaware" } }),
    );

    await expect(sendChatTurn(messages, createEmptyCoverPage())).resolves.toEqual({
      reply: "Delaware it is.",
      patch: { governingLaw: "Delaware" },
    });
  });

  it("treats a turn that changed nothing as an empty patch", async () => {
    fetchMock.mockResolvedValue(respondWith({ reply: "Which state?" }));

    const turn = await sendChatTurn(messages, createEmptyCoverPage());

    expect(turn.patch).toEqual({});
  });

  it("surfaces the server's reason for an unavailable assistant", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: "The assistant is unavailable right now." }, 503),
    );

    await expect(sendChatTurn(messages, createEmptyCoverPage())).rejects.toThrow(
      "The assistant is unavailable right now.",
    );
  });

  it("does not blame the login form for a rejected message", async () => {
    fetchMock.mockResolvedValue(
      respondWith({ detail: [{ loc: ["body", "messages"] }] }, 422),
    );

    await expect(sendChatTurn(messages, createEmptyCoverPage())).rejects.toThrow(
      "That message could not be sent. Try rewording it.",
    );
  });

  it("reports an unreachable server", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      sendChatTurn(messages, createEmptyCoverPage()),
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
