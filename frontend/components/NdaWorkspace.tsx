"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DownloadButton } from "./DownloadButton";
import { NdaChat, type ChatEntry } from "./NdaChat";
import { NdaDocument } from "./NdaDocument";
import { ApiError, sendChatTurn, type ChatMessage } from "@/lib/api";
import {
  COMPLETED_MESSAGE,
  missingFieldsMessage,
  OPENING_MESSAGE,
} from "@/lib/nda/chat-copy";
import { clausesForPatch } from "@/lib/nda/chat-support";
import { documentTitle } from "@/lib/nda/render";
import { createEmptyCoverPage, type CoverPageData } from "@/lib/nda/types";
import {
  countErrors,
  validateCoverPage,
  type FieldKey,
} from "@/lib/nda/validate";

/**
 * How much of the conversation travels with each turn.
 *
 * The agreement itself is sent every time, so the transcript only has to carry
 * the last little while of phrasing — nothing established is lost by dropping
 * the far end of a long session.
 */
const TRANSCRIPT_LIMIT = 40;

/** How long a change stays marked in the Standard Terms. */
const HIGHLIGHT_MS = 4000;

export function NdaWorkspace() {
  const [data, setData] = useState<CoverPageData>(createEmptyCoverPage);
  const [activeClauses, setActiveClauses] = useState<number[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>(() => [
    { id: 0, role: "assistant", content: OPENING_MESSAGE },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /* Read inside the send callback so a turn always carries the agreement as it
     stands, not as it stood when the callback was built. */
  const latest = useRef(data);

  const errors = useMemo(() => validateCoverPage(data), [data]);
  const remaining = countErrors(errors);

  useEffect(() => {
    latest.current = data;
  }, [data]);

  /* Browsers use the document title as the default "Save as PDF" filename. */
  useEffect(() => {
    document.title = documentTitle(data);
  }, [data]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const say = useCallback((role: ChatEntry["role"], content: string) => {
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role, content },
    ]);
  }, []);

  const markChanged = useCallback((patch: Partial<CoverPageData>) => {
    const clauses = clausesForPatch(patch);
    if (clauses.length === 0) return;

    setActiveClauses(clauses);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setActiveClauses([]), HIGHLIGHT_MS);
  }, []);

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

      try {
        const turn = await sendChatTurn(history, latest.current);
        setData((current) => ({ ...current, ...turn.patch }));
        markChanged(turn.patch);
        if (turn.reply) say("assistant", turn.reply);
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
    [markChanged, say],
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

  /* Says so the moment the last blank is filled, however it was filled. */
  const wasComplete = useRef(false);
  useEffect(() => {
    const complete = remaining === 0;
    if (complete && !wasComplete.current) say("assistant", COMPLETED_MESSAGE);
    wasComplete.current = complete;
  }, [remaining, say]);

  const handleDownload = useCallback(() => {
    const missing = Object.keys(errors) as FieldKey[];

    if (missing.length > 0) {
      /* Counted here, not asked of the model: it costs nothing, arrives
         instantly, and cannot be wrong about what the document is short of. */
      say("assistant", missingFieldsMessage(missing));
      inputRef.current?.focus();
      return;
    }

    window.print();
  }, [errors, say]);

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
          Mutual NDA · Common Paper Standard Terms v1.0
        </p>
        <DownloadButton remaining={remaining} onDownload={handleDownload} />
      </header>

      <main className="workspace">
        <div className="panel">
          <NdaChat
            messages={messages}
            sending={sending}
            error={error}
            onSend={handleSend}
            onRetry={handleRetry}
            inputRef={inputRef}
          />
        </div>

        <div className="desk">
          <NdaDocument data={data} activeClauses={activeClauses} />
        </div>
      </main>
    </div>
  );
}
