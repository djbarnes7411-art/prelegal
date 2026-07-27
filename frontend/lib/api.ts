/**
 * Client for the FastAPI backend.
 *
 * In the container the backend serves this frontend too, so requests are
 * same-origin and the base URL is empty. `next dev` runs on its own port, and
 * points `NEXT_PUBLIC_API_BASE_URL` at http://localhost:8000 instead.
 *
 * Everything except signing up and signing in goes through `authorized`, which
 * attaches the session token and turns a 401 into a signed-out browser.
 */

import type { DocumentState } from "@/lib/documents/types";
import { clearSession, sessionToken } from "@/lib/session";

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

/** What signup and login return: the account and the token that now acts as it. */
interface SessionPayload {
  user: UserPayload;
  token: string;
}

function toUser(payload: UserPayload): User {
  return {
    id: payload.id,
    email: payload.email,
    createdAt: payload.created_at,
  };
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

async function send(
  path: string,
  init: RequestInit,
  whenRejected: string,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    // Status 0: the request never arrived, so there is no verdict to report.
    throw new ApiError("Could not reach the server. Is the backend running?", 0);
  }

  // 204, and any other empty body, parses to null rather than throwing.
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(errorMessage(body, response.status, whenRejected), response.status);
  }

  return body;
}

/**
 * Sends a request as the signed-in account.
 *
 * A 401 means the token is gone — expired, revoked, or from a server that has
 * restarted since. The session is cleared here rather than at each call site,
 * which re-renders every `useSession` and lets the pages' own redirects take
 * the browser back to the login screen. The message is ours, not the
 * backend's: what the caller was doing does not matter, and a 401 may arrive
 * with no body at all.
 */
async function authorized(
  path: string,
  init: RequestInit = {},
  whenRejected = "That request could not be completed.",
): Promise<unknown> {
  const token = sessionToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    return await send(path, { ...init, headers }, whenRejected);
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 401) {
      clearSession();
      throw new ApiError("Your session has ended. Sign in again.", 401);
    }
    throw failure;
  }
}

/* ------------------------------------------------------------------ *
 * Signing in and out
 * ------------------------------------------------------------------ */

/** An account and the token that acts as it. Kept by `lib/session.ts`. */
export interface Session {
  user: User;
  /** Opaque. Send it back, do not read it. */
  token: string;
}

async function postCredentials(
  path: string,
  email: string,
  password: string,
): Promise<Session> {
  const body = (await send(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    "Check the email address and password, then try again.",
  )) as SessionPayload;

  return { user: toUser(body.user), token: body.token };
}

/** Registers an address. Rejects with a 409 if it already has an account. */
export function signup(email: string, password: string): Promise<Session> {
  return postCredentials("/api/auth/signup", email, password);
}

/**
 * Signs in as an existing account.
 *
 * Rejects with a 404 if there is no such account and a 401 if the password is
 * wrong — two different mistakes, and the message says which.
 */
export function login(email: string, password: string): Promise<Session> {
  return postCredentials("/api/auth/login", email, password);
}

/**
 * Signs out here and, if it can be reached, on the server.
 *
 * The local session is cleared whatever happens: someone who pressed sign out
 * must not be left looking at a signed-in screen because a request failed. A
 * token whose revocation never arrived expires on its own.
 */
export async function signOut(): Promise<void> {
  try {
    await authorized("/api/auth/logout", { method: "POST" });
  } catch {
    /* Nothing to tell the user — they are signed out either way. */
  } finally {
    clearSession();
  }
}

/* ------------------------------------------------------------------ *
 * Saved documents
 * ------------------------------------------------------------------ */

/** A saved document as the list screen needs it: no conversation. */
export interface DocumentSummary {
  id: number;
  documentSlug: string;
  /** Every field the document defines, so a title and a progress count can be
      derived from the same catalog the workspace uses. */
  fields: DocumentState;
  /** ISO-8601 UTC. */
  createdAt: string;
  updatedAt: string;
}

export interface SavedDocument extends DocumentSummary {
  messages: ChatMessage[];
}

const CANNOT_SAVE = "That draft could not be saved.";

/** Every document this account has drafted, most recently worked on first. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  const body = await authorized(
    "/api/documents",
    { method: "GET" },
    "Your documents could not be loaded.",
  );
  return (body ?? []) as DocumentSummary[];
}

/** Opens a saved document, with the conversation that produced it. */
export async function loadDocument(id: number): Promise<SavedDocument> {
  const body = await authorized(
    `/api/documents/${id}`,
    { method: "GET" },
    "That document could not be opened.",
  );
  return body as SavedDocument;
}

/** Starts a saved document. The id it returns is what every later save uses. */
export async function createDocument(
  documentSlug: string,
  fields: DocumentState,
  messages: ChatMessage[],
): Promise<SavedDocument> {
  const body = await authorized(
    "/api/documents",
    {
      method: "POST",
      body: JSON.stringify({ documentSlug, fields, messages }),
    },
    CANNOT_SAVE,
  );
  return body as SavedDocument;
}

/**
 * Replaces a saved document's values and conversation.
 *
 * The whole draft goes every time rather than a diff, so a save that never
 * arrives costs one save and not a document whose halves disagree.
 */
export async function saveDocument(
  id: number,
  fields: DocumentState,
  messages: ChatMessage[],
): Promise<SavedDocument> {
  const body = await authorized(
    `/api/documents/${id}`,
    { method: "PUT", body: JSON.stringify({ fields, messages }) },
    CANNOT_SAVE,
  );
  return body as SavedDocument;
}

export async function deleteDocument(id: number): Promise<void> {
  await authorized(
    `/api/documents/${id}`,
    { method: "DELETE" },
    "That document could not be deleted.",
  );
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
   * The document the assistant settled on, if it settled on one this turn.
   *
   * Null until the user has chosen. Always one of the catalog's own slugs — the
   * backend drops anything else rather than naming a document we cannot draft.
   */
  documentSlug: string | null;
  /**
   * The fields the assistant changed, ready to merge.
   *
   * Every value here is complete — a party arrives with all four of its fields
   * whether or not the assistant mentioned them all — because the workspace
   * merges shallowly. The backend does that assembling, against the same state
   * this request sent, which is why nothing here has to be pieced back
   * together. It is also the only place the model's answer is checked, so this
   * type describes what survived rather than what was said.
   */
  patch: DocumentState;
}

/**
 * Sends one turn of the conversation.
 *
 * The turn itself remembers nothing, so each call carries the whole context:
 * the transcript, which document is being drafted, and what it currently holds.
 * A null `documentSlug` is how the caller asks "which document do I need?".
 *
 * It does need a session, since PL-7 — a turn costs the server a model call,
 * and that is not something an anonymous caller gets to spend.
 */
export async function sendChatTurn(
  messages: ChatMessage[],
  documentSlug: string | null,
  fields: DocumentState,
): Promise<ChatTurn> {
  const body = (await authorized(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({ messages, documentSlug, fields }),
    },
    "That message could not be sent. Try rewording it.",
  )) as {
    reply?: string;
    documentSlug?: string | null;
    patch?: DocumentState;
  } | null;

  return {
    reply: body?.reply ?? "",
    documentSlug: body?.documentSlug ?? null,
    patch: body?.patch ?? {},
  };
}
