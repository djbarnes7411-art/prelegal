"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell, DOCUMENTS_PATH } from "./AppShell";
import { ChatPanel, type ChatEntry } from "./ChatPanel";
import { DocumentCatalog } from "./DocumentCatalog";
import { DownloadButton } from "./DownloadButton";
import { GenericDocument } from "./GenericDocument";
import { NdaDocument } from "./NdaDocument";
import {
  ApiError,
  createDocument,
  loadDocument,
  saveDocument,
  sendChatTurn,
  type ChatMessage,
} from "@/lib/api";
import { findDocument, loadClauses } from "@/lib/documents/catalog";
import {
  completedMessage,
  missingFieldsMessage,
  WELCOME_MESSAGE,
} from "@/lib/documents/chat-copy";
import { documentTitle } from "@/lib/documents/render";
import type {
  Clause,
  DocumentDef,
  DocumentState,
} from "@/lib/documents/types";
import { createEmptyState, missingFields } from "@/lib/documents/values";
import { useSession } from "@/lib/session";
import { clausesForPatch } from "@/lib/nda/chat-support";
import type { CoverPageData } from "@/lib/nda/types";

/**
 * How much of the conversation travels with each turn.
 *
 * The document itself is sent every time, so the transcript only has to carry
 * the last little while of phrasing — nothing established is lost by dropping
 * the far end of a long session.
 */
const TRANSCRIPT_LIMIT = 40;

/** How long a change stays marked in the Standard Terms. */
const HIGHLIGHT_MS = 4000;

/**
 * How long after the last change the draft is saved.
 *
 * A turn changes the document and the transcript in the same tick, and the
 * welcome message plus a chosen document arrive close behind each other — one
 * short wait coalesces all of it into a single request.
 */
export const AUTOSAVE_MS = 1000;

/** Whether the draft on screen is on the server yet. */
type SaveState = "idle" | "saving" | "failed";

interface DocumentWorkspaceProps {
  /** A saved document to reopen, from `?doc=` — null to start a new one. */
  initialDocumentId?: number | null;
  /**
   * How long to wait before saving. Shortened by tests so they need not sit
   * through the real delay; nothing in the app passes it.
   */
  autosaveDelayMs?: number;
}

export function DocumentWorkspace({
  initialDocumentId = null,
  autosaveDelayMs = AUTOSAVE_MS,
}: DocumentWorkspaceProps = {}) {
  const [document_, setDocument] = useState<DocumentDef | null>(null);
  const [state, setState] = useState<DocumentState>({});
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [activeClauses, setActiveClauses] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>(() => [
    { id: 0, role: "assistant", content: WELCOME_MESSAGE },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [restoring, setRestoring] = useState(initialDocumentId !== null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  /* For the bar across the top. The page above this one will not render the
     workspace without a session, so the fallback is never what is shown. */
  const session = useSession();
  const email = session?.user.email ?? "";

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /* Read inside the send and save callbacks so each always carries the document
     as it stands, not as it stood when the callback was built. */
  const latest = useRef({ document: document_, state, messages });
  /* The row this draft is. Null until the first save creates one; a ref rather
     than state because it drives no render, only whether the next save creates
     or replaces. */
  const savedId = useRef<number | null>(null);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const missing = useMemo(
    () => (document_ ? missingFields(document_, state) : []),
    [document_, state],
  );
  const remaining = missing.length;

  useEffect(() => {
    latest.current = { document: document_, state, messages };
  }, [document_, state, messages]);

  /* Browsers use the document title as the default "Save as PDF" filename. */
  useEffect(() => {
    window.document.title = document_
      ? documentTitle(document_, state)
      : "Prelegal";
  }, [document_, state]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const say = useCallback((role: ChatEntry["role"], content: string) => {
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role, content },
    ]);
  }, []);

  /**
   * Adopts the document the assistant settled on.
   *
   * Seeds its starting values and fetches its contract text — a separate chunk
   * per document, so the ten that were not chosen are never downloaded.
   */
  const start = useCallback((next: DocumentDef) => {
    setDocument(next);
    setState(createEmptyState(next));
    setClauses([]);

    if (next.renderer === "generic") {
      void loadClauses(next.slug).then((file) => {
        /* Guard against a second document being chosen while this was in
           flight: only the document still selected may install its clauses. */
        setDocument((current) => {
          if (current?.slug === next.slug && file) setClauses(file.clauses);
          return current;
        });
      });
    }
  }, []);

  /**
   * Writes the draft as it currently stands.
   *
   * Reads `latest` rather than closing over state, so a save that fires a
   * second after the last change carries what is on screen now. Creates the row
   * the first time and replaces it after — whole, not as a diff.
   */
  const persist = useCallback(async () => {
    /* A save already in flight wins; the change that arrived during it is
       picked up by the next one, which the effect below has already queued. */
    if (saving.current) return;

    const { document: current, state: fields, messages: log } = latest.current;
    if (!current) return;

    saving.current = true;
    setSaveState("saving");

    const transcript: ChatMessage[] = log.map(({ role, content }) => ({
      role,
      content,
    }));

    try {
      const saved =
        savedId.current === null
          ? await createDocument(current.slug, fields, transcript)
          : await saveDocument(savedId.current, fields, transcript);
      savedId.current = saved.id;
      setSaveState("idle");
    } catch {
      /* A 401 has already cleared the session and the page is on its way back
         to the login screen. Anything else is worth a quiet mark in the bar and
         nothing more: the conversation is what has to stay trustworthy, and an
         alert bubble here would interrupt it to report something the next turn
         will retry anyway. */
      setSaveState("failed");
    } finally {
      saving.current = false;
    }
  }, []);

  /* Debounced: a turn changes the document and the transcript together, and
     choosing a document changes both again straight after. */
  useEffect(() => {
    if (!document_ || restoring) return;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), autosaveDelayMs);

    return () => clearTimeout(saveTimer.current);
  }, [document_, state, messages, persist, restoring, autosaveDelayMs]);

  /* Leaving the page cancels the pending timer above, which would drop the last
     turn. This sends it instead, unqueued. Fire and forget — this component is
     gone before the request resolves. */
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (!saving.current) void persist();
    },
    [persist],
  );

  /**
   * Reopens a saved document: its values, its clauses, and its conversation.
   *
   * Seeds `savedId` so the first autosave after this replaces the row rather
   * than creating a second copy of the same draft.
   */
  useEffect(() => {
    if (initialDocumentId === null) return;

    let abandoned = false;

    void loadDocument(initialDocumentId)
      .then((saved) => {
        if (abandoned) return;

        const definition = findDocument(saved.documentSlug);
        if (!definition) {
          setRestoreError(
            "This document is no longer one we can draft, so it cannot be opened.",
          );
          return;
        }

        savedId.current = saved.id;
        setDocument(definition);
        /* Merged onto a complete empty state rather than used as-is. The
           backend returns every field the document defines, but a draft saved
           before a field existed would arrive without it, and every renderer
           here reads its values without checking they are there. */
        setState({ ...createEmptyState(definition), ...saved.fields });

        /* Ids restart from zero because they are local to this mount and only
           have to be unique among these messages. */
        const restored = saved.messages.map((message, index) => ({
          id: index,
          role: message.role,
          content: message.content,
        }));
        setMessages(
          restored.length > 0
            ? restored
            : [{ id: 0, role: "assistant" as const, content: WELCOME_MESSAGE }],
        );
        nextId.current = Math.max(restored.length, 1);

        if (definition.renderer === "generic") {
          void loadClauses(definition.slug).then((file) => {
            if (!abandoned && file) setClauses(file.clauses);
          });
        }
      })
      .catch((failure) => {
        if (abandoned) return;
        /* A 401 is already taking the browser to the login screen. */
        if (failure instanceof ApiError && failure.status === 401) return;
        setRestoreError(
          failure instanceof ApiError && failure.status === 404
            ? "That document could not be found. It may belong to another account."
            : failure instanceof ApiError
              ? failure.message
              : "That document could not be opened.",
        );
      })
      .finally(() => {
        if (!abandoned) setRestoring(false);
      });

    return () => {
      abandoned = true;
    };
  }, [initialDocumentId]);

  const markChanged = useCallback(
    (patch: DocumentState, forDocument: DocumentDef) => {
      const keys = Object.keys(patch);
      if (keys.length === 0) return;

      const touched =
        forDocument.renderer === "mutual-nda"
          ? clausesForPatch(patch as Partial<CoverPageData>).map(String)
          : [
              ...new Set(
                keys.flatMap(
                  (key) =>
                    forDocument.fields.find((field) => field.key === key)
                      ?.clauses ?? [],
                ),
              ),
            ];

      if (touched.length === 0) return;

      setActiveClauses(touched);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setActiveClauses([]), HIGHLIGHT_MS);
    },
    [],
  );

  /**
   * Sends one turn.
   *
   * Takes the transcript to send rather than reading it, so a retry can resend
   * the message that failed without the user typing it again.
   */
  const runTurn = useCallback(
    async (transcript: ChatEntry[]) => {
      setSending(true);
      setError(null);

      const history: ChatMessage[] = transcript
        .slice(-TRANSCRIPT_LIMIT)
        .map(({ role, content }) => ({ role, content }));

      const { document: current, state: fields } = latest.current;

      try {
        const turn = await sendChatTurn(
          history,
          current?.slug ?? null,
          fields,
        );

        const chosen = findDocument(turn.documentSlug);
        if (chosen && chosen.slug !== current?.slug) {
          start(chosen);
        } else if (current) {
          setState((held) => ({ ...held, ...turn.patch }));
          markChanged(turn.patch, current);
        }

        if (turn.reply) say("assistant", turn.reply);

        /* Back to the composer, so answering the next question is just typing.
           Only on success: a failure puts a "Try again" button in the log, and
           moving focus off it would hide the one thing worth pressing. */
        inputRef.current?.focus();
      } catch (failure) {
        /* The message that failed stays in the conversation — retyping it is
           the last thing anyone wants to do after a failed request. */
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Something went wrong. Try again.",
        );
      } finally {
        setSending(false);
      }
    },
    [markChanged, say, start],
  );

  const handleSend = useCallback(
    (text: string) => {
      const entry: ChatEntry = {
        id: nextId.current++,
        role: "user",
        content: text,
      };
      const next = [...messages, entry];
      setMessages(next);
      void runTurn(next);
    },
    [messages, runTurn],
  );

  const handleRetry = useCallback(() => {
    void runTurn(messages);
  }, [messages, runTurn]);

  /* Says so the moment the last required blank is filled, however it was
     filled. Reset when a new document is chosen, since a fresh one starts
     incomplete and would otherwise never announce itself. */
  const wasComplete = useRef(false);
  useEffect(() => {
    const complete = document_ !== null && remaining === 0;
    if (complete && !wasComplete.current) say("assistant", completedMessage(document_));
    wasComplete.current = complete;
  }, [document_, remaining, say]);

  const handleDownload = useCallback(() => {
    if (missing.length > 0) {
      /* Counted here, not asked of the model: it costs nothing, arrives
         instantly, and cannot be wrong about what the document is short of. */
      say("assistant", missingFieldsMessage(missing));
      inputRef.current?.focus();
      return;
    }

    window.print();
  }, [missing, say]);

  return (
    <AppShell
      active="draft"
      email={email}
      center={
        <p className="topbar-doc">
          {document_
            ? `${document_.name} · Common Paper Standard Terms${
                document_.version ? ` v${document_.version}` : ""
              }`
            : "Choose a document to draft"}
        </p>
      }
      end={
        document_ ? (
          <>
            <SaveState state={saveState} />
            <DownloadButton remaining={remaining} onDownload={handleDownload} />
          </>
        ) : null
      }
    >
      <main className="workspace">
        <div className="panel">
          <ChatPanel
            messages={messages}
            sending={sending}
            error={error}
            onSend={handleSend}
            onRetry={handleRetry}
            inputRef={inputRef}
          />
        </div>

        <div className="desk">
          <DocumentPanel
            document={document_}
            state={state}
            clauses={clauses}
            activeClauses={activeClauses}
            restoring={restoring}
            restoreError={restoreError}
          />
        </div>
      </main>
    </AppShell>
  );
}

/**
 * Whether the draft is on the server.
 *
 * Silent when it is, which is almost always — a permanent "Saved" would be
 * noise beside the document it is describing. It speaks up only while a save is
 * in flight or after one failed.
 */
function SaveState({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  return (
    <span className="topbar-save" data-state={state} role="status">
      {state === "saving" ? "Saving…" : "Not saved"}
    </span>
  );
}

/**
 * Whichever of the three things belongs beside the conversation.
 *
 * The Mutual NDA keeps the hand-built page it shipped with — its cover page is
 * a published form with checkbox pairs and its own preamble, and a generic
 * renderer would be a worse reproduction of it, not a better one.
 */
function DocumentPanel({
  document,
  state,
  clauses,
  activeClauses,
  restoring,
  restoreError,
}: {
  document: DocumentDef | null;
  state: DocumentState;
  clauses: Clause[];
  activeClauses: string[];
  restoring: boolean;
  restoreError: string | null;
}) {
  if (restoreError) {
    return (
      <article className="doc">
        <p className="doc-eyebrow">Not opened</p>
        <h1 className="doc-title">This document could not be opened</h1>
        <p className="doc-body">{restoreError}</p>
        <p className="doc-body">
          <a href={DOCUMENTS_PATH}>Back to my documents</a>
        </p>
      </article>
    );
  }

  if (restoring) {
    return (
      <article className="doc">
        <p className="doc-eyebrow">Key Terms</p>
        <p className="doc-body">Opening your document…</p>
      </article>
    );
  }

  if (!document) return <DocumentCatalog />;

  if (document.renderer === "mutual-nda") {
    return (
      <NdaDocument
        data={state as unknown as CoverPageData}
        activeClauses={activeClauses.map(Number)}
      />
    );
  }

  if (clauses.length === 0) {
    return (
      <article className="doc">
        <p className="doc-eyebrow">Key Terms</p>
        <h1 className="doc-title">{document.title}</h1>
        <p className="doc-body">Loading the agreement…</p>
      </article>
    );
  }

  return (
    <GenericDocument
      document={document}
      clauses={clauses}
      state={state}
      activeClauses={activeClauses}
    />
  );
}
