"use client";

/**
 * Everything this account has drafted.
 *
 * Brand palette, like the entry screen: this is a platform surface, not the
 * drafting instrument. Each card's title and its "what's left" count are worked
 * out here from the catalog and the saved values, the same way the workspace
 * works them out — the backend stores values, not a rendered title, so the two
 * screens cannot disagree about what a document is called.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DRAFT_PATH } from "./AppShell";
import {
  ApiError,
  deleteDocument,
  listDocuments,
  type DocumentSummary,
} from "@/lib/api";
import { findDocument } from "@/lib/documents/catalog";
import { documentTitle } from "@/lib/documents/render";
import { formatIsoDate, missingFields } from "@/lib/documents/values";

type Load = "loading" | "ready" | "failed";

export function DocumentsList() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [error, setError] = useState<string | null>(null);

  /*
   * Written as a chain rather than an awaited async function so that nothing
   * here sets state before the request has been sent — called straight from
   * the effect below, that would be a second render before the first painted,
   * and the state it would set is the one this starts in anyway.
   */
  const fetchAll = useCallback(() => {
    listDocuments()
      .then((found) => {
        setDocuments(found);
        setLoad("ready");
      })
      .catch((failure: unknown) => {
        /* A 401 has already cleared the session, and the page around this is
           redirecting to the login screen — showing an error under it would
           flash a complaint at someone who is simply signed out. */
        if (failure instanceof ApiError && failure.status === 401) return;
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Your documents could not be loaded.",
        );
        setLoad("failed");
      });
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Back to the loading state and round again — the button under the error. */
  const retry = useCallback(() => {
    setLoad("loading");
    setError(null);
    fetchAll();
  }, [fetchAll]);

  const remove = useCallback(async (id: number) => {
    await deleteDocument(id);
    setDocuments((current) => current.filter((document) => document.id !== id));
  }, []);

  return (
    <main className="library">
      <div className="library-header">
        <div>
          <h1 className="library-heading">My documents</h1>
          <p className="library-sub">
            Every agreement you have started. Open one to pick the conversation
            up where you left it.
          </p>
        </div>
        <button
          type="button"
          className="library-new"
          onClick={() => router.push(DRAFT_PATH)}
        >
          New document
        </button>
      </div>

      {load === "loading" ? (
        <p className="library-status">Loading your documents…</p>
      ) : null}

      {load === "failed" ? (
        <div className="library-status" role="alert">
          <p className="library-status-text">{error}</p>
          <button type="button" className="library-retry" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}

      {load === "ready" && documents.length === 0 ? <EmptyLibrary /> : null}

      {load === "ready" && documents.length > 0 ? (
        <ul className="library-list">
          {documents.map((summary) => (
            <DocumentCard
              key={summary.id}
              summary={summary}
              onOpen={() => router.push(`${DRAFT_PATH}?doc=${summary.id}`)}
              onDelete={() => remove(summary.id)}
            />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function EmptyLibrary() {
  const router = useRouter();

  return (
    <div className="library-empty">
      <p className="library-empty-mark" aria-hidden="true">
        §
      </p>
      <h2 className="library-empty-heading">Nothing drafted yet</h2>
      <p className="library-empty-body">
        Start a document and it will appear here as you go — the conversation and
        the agreement both, saved as you answer.
      </p>
      <button
        type="button"
        className="library-new"
        onClick={() => router.push(DRAFT_PATH)}
      >
        Draft your first document
      </button>
    </div>
  );
}

function DocumentCard({
  summary,
  onOpen,
  onDelete,
}: {
  summary: DocumentSummary;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const document = findDocument(summary.documentSlug);
  /* A slug the catalog no longer knows is filtered out by the backend, so this
     is belt and braces — but rendering a card with no name would be worse than
     rendering none. */
  if (!document) return null;

  const title = documentTitle(document, summary.fields);
  const remaining = missingFields(document, summary.fields).length;

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "That document could not be deleted.",
      );
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <li className="library-card">
      <div className="library-card-body">
        {/* Until the parties are named the title *is* the document's name, and
            printing it twice says nothing the second time. */}
        {title === document.name ? null : (
          <p className="library-card-kind">{document.name}</p>
        )}
        <h2 className="library-card-title">
          <button type="button" className="library-card-open" onClick={onOpen}>
            {title}
          </button>
        </h2>
        <p className="library-card-meta">
          <span
            className="library-card-progress"
            data-complete={remaining === 0}
          >
            {remaining === 0
              ? "Ready to download"
              : `${remaining} ${remaining === 1 ? "answer" : "answers"} still needed`}
          </span>
          <span aria-hidden="true"> · </span>
          <span>Last worked on {formatIsoDate(summary.updatedAt.slice(0, 10))}</span>
        </p>
        {error ? (
          <p className="library-card-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="library-card-actions">
        {confirming ? (
          <>
            <span className="library-card-confirm">Delete this draft?</span>
            <button
              type="button"
              className="library-card-danger"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className="library-card-cancel"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="library-card-delete"
            onClick={() => setConfirming(true)}
          >
            Delete
            {/* Which one, for a reader who cannot see which row this is in. */}
            <span className="visually-hidden"> the {title} draft</span>
          </button>
        )}
      </div>
    </li>
  );
}
