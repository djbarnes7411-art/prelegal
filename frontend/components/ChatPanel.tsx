"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { PRIVACY_NOTICE } from "@/lib/documents/chat-copy";

/** One line of the conversation as it is shown. */
export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  messages: ChatEntry[];
  /** A turn is in flight. */
  sending: boolean;
  /** Why the last turn failed, if it did. */
  error: string | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  /** Held by the workspace, which moves focus here after each turn. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function ChatPanel({
  messages,
  sending,
  error,
  onSend,
  onRetry,
  inputRef,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  /* Follow the conversation down as it grows, including while one is in flight. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending, error]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="chat">
      <p className="chat-notice">{PRIVACY_NOTICE}</p>

      {/*
        `additions` so a screen reader announces the new message rather than
        re-reading the whole conversation each time one arrives.
      */}
      <div
        className="chat-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
      >
        {messages.map((message) => (
          <p key={message.id} className="chat-message" data-role={message.role}>
            <span className="visually-hidden">
              {message.role === "user" ? "You said: " : "Assistant said: "}
            </span>
            {message.content}
          </p>
        ))}

        {sending ? (
          <p className="chat-pending">
            <span className="visually-hidden">Assistant is replying…</span>
            <span className="chat-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}

        {error ? (
          <div className="chat-failure" role="alert">
            <p className="chat-failure-text">{error}</p>
            <button
              type="button"
              className="chat-retry"
              onClick={onRetry}
              disabled={sending}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="visually-hidden" htmlFor="chat-input">
          Your message
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="chat-input"
          rows={2}
          value={draft}
          placeholder="Tell me about the agreement…"
          onChange={(event) => setDraft(event.target.value)}
          /* Enter sends, because this is a conversation. Shift+Enter is how you
             write the second line of a notice address. */
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={sending || !draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
