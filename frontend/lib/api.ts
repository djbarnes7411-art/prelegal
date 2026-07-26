/**
 * Client for the FastAPI backend.
 *
 * In the container the backend serves this frontend too, so requests are
 * same-origin and the base URL is empty. `next dev` runs on its own port, and
 * points `NEXT_PUBLIC_API_BASE_URL` at http://localhost:8000 instead.
 */

import type { CoverPageData } from "@/lib/nda/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export interface User {
  id: number;
  email: string;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/** A request that reached a verdict the caller should show the user. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The backend's snake_case user record. */
interface UserPayload {
  id: number;
  email: string;
  created_at: string;
}

/**
 * Turns an error response into something worth showing.
 *
 * FastAPI sends `detail` as a string for the cases we raise deliberately, and as
 * a list of field errors for a failed request-model check. Only the former is
 * written for a reader, so each caller supplies its own copy for the latter.
 */
function errorMessage(
  body: unknown,
  status: number,
  whenRejected: string,
): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (status === 422) return whenRejected;
  return `Something went wrong (${status}). Try again.`;
}

async function postCredentials(
  path: string,
  email: string,
  password: string,
): Promise<User> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // Status 0: the request never arrived, so there is no verdict to report.
    throw new ApiError("Could not reach the server. Is the backend running?", 0);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      errorMessage(
        body,
        response.status,
        "Check the email address and password, then try again.",
      ),
      response.status,
    );
  }

  const payload = body as UserPayload;
  return { id: payload.id, email: payload.email, createdAt: payload.created_at };
}

/** Registers an address. Rejects with a 409 if it already has an account. */
export function signup(email: string, password: string): Promise<User> {
  return postCredentials("/api/auth/signup", email, password);
}

/** Signs in as an existing account. Rejects with a 404 if there is none. */
export function login(email: string, password: string): Promise<User> {
  return postCredentials("/api/auth/login", email, password);
}

/* ------------------------------------------------------------------ *
 * The drafting conversation
 * ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatTurn {
  reply: string;
  /**
   * The fields the assistant changed, ready to merge.
   *
   * Every value here is complete — a party arrives with all four of its fields
   * whether or not the assistant mentioned them all — because the workspace
   * merges shallowly. The backend does that assembling, against the same cover
   * page this request sent, which is why nothing here has to be pieced back
   * together. It is also the only place the model's answer is checked, so this
   * type describes what survived rather than what was said.
   */
  patch: Partial<CoverPageData>;
}

/**
 * Sends one turn of the conversation.
 *
 * Nothing is remembered between calls, so each one carries both the transcript
 * and the agreement as it currently stands.
 */
export async function sendChatTurn(
  messages: ChatMessage[],
  coverPage: CoverPageData,
): Promise<ChatTurn> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/api/nda/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, coverPage }),
    });
  } catch {
    throw new ApiError("Could not reach the server. Is the backend running?", 0);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      errorMessage(
        body,
        response.status,
        "That message could not be sent. Try rewording it.",
      ),
      response.status,
    );
  }

  const payload = body as { reply?: string; patch?: Partial<CoverPageData> };
  return { reply: payload.reply ?? "", patch: payload.patch ?? {} };
}
