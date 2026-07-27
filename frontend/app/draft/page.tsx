"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { useSession } from "@/lib/session";

/*
 * The workspace is browser-only by design. It seeds dates from the local clock
 * and hands the finished document to the browser's print dialog — neither of
 * which the server can do, and a server-rendered date would disagree with the
 * browser's whenever their timezones differ.
 */
const DocumentWorkspace = dynamic(
  () =>
    import("@/components/DocumentWorkspace").then(
      (mod) => mod.DocumentWorkspace,
    ),
  { ssr: false },
);

/** Nothing to subscribe to: the address does not change without a render. */
const noSubscription = () => () => {};

function readDocumentId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("doc");
  if (raw === null) return null;

  /* A `?doc=` that is not a real id is treated as absent: starting a new
     document is a better answer to a mangled link than an error page. */
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Which saved document to reopen, from `?doc=`.
 *
 * A query string rather than a route segment, because the export has to
 * enumerate every route at build time and nobody's document ids exist then.
 *
 * Read the same way `useSession` reads storage, and `undefined` means the same
 * thing here: this is prerendered at build time where there is no address to
 * read, so the first render necessarily knows nothing. `useSearchParams` would
 * do the job but puts the whole page behind a Suspense boundary for a value
 * only the browser ever has.
 */
function useDocumentId(): number | null | undefined {
  return useSyncExternalStore(noSubscription, readDocumentId, () => undefined);
}

export default function DraftPage() {
  const router = useRouter();
  const session = useSession();
  const documentId = useDocumentId();

  /*
   * Sends anyone without a session back to the login screen. Since PL-7 this is
   * more than a courtesy: the chat endpoint and the documents endpoints both
   * refuse a request without one, so an unsigned-in workspace could do nothing.
   *
   * `undefined` means storage has not been read, which is not the same as being
   * signed out; redirecting then would bounce every visitor on arrival.
   */
  useEffect(() => {
    if (session === null) router.replace("/");
  }, [session, router]);

  /* Both have to be known before the workspace mounts: it decides whether to
     open a saved document on its first render, and cannot be told later. */
  if (!session || documentId === undefined) return null;

  return <DocumentWorkspace initialDocumentId={documentId} />;
}
