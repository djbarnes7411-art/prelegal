"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatPanel, type ChatEntry } from "./ChatPanel";
import { DocumentCatalog } from "./DocumentCatalog";
import { DownloadButton } from "./DownloadButton";
import { GenericDocument } from "./GenericDocument";
import { NdaDocument } from "./NdaDocument";
import { ApiError, sendChatTurn, type ChatMessage } from "@/lib/api";
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

export function DocumentWorkspace() {
  const [document_, setDocument] = useState<DocumentDef | null>(null);
  const [state, setState] = useState<DocumentState>({});
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [activeClauses, setActiveClauses] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>(() => [
    { id: 0, role: "assistant", content: WELCOME_MESSAGE },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /* Read inside the send callback so a turn always carries the document as it
     stands, not as it stood when the callback was built. */
  const latest = useRef({ document: document_, state });

  const missing = useMemo(
    () => (document_ ? missingFields(document_, state) : []),
    [document_, state],
  );
  const remaining = missing.length;

  useEffect(() => {
    latest.current = { document: document_, state };
  }, [document_, state]);

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
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            §
          </span>
          <span className="brand-name">Prelegal</span>
        </div>
        <p className="topbar-doc">
          {document_
            ? `${document_.name} · Common Paper Standard Terms${
                document_.version ? ` v${document_.version}` : ""
              }`
            : "Choose a document to draft"}
        </p>
        {document_ ? (
          <DownloadButton remaining={remaining} onDownload={handleDownload} />
        ) : null}
      </header>

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
          />
        </div>
      </main>
    </div>
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
}: {
  document: DocumentDef | null;
  state: DocumentState;
  clauses: Clause[];
  activeClauses: string[];
}) {
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
