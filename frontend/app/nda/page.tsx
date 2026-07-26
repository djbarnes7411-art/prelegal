"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/lib/session";

/*
 * The workspace is browser-only by design. It seeds the effective date from the
 * local clock and hands the finished document to the browser's print dialog —
 * neither of which the server can do, and a server-rendered date would disagree
 * with the browser's whenever their timezones differ.
 */
const NdaWorkspace = dynamic(
  () => import("@/components/NdaWorkspace").then((mod) => mod.NdaWorkspace),
  { ssr: false },
);

export default function NdaPage() {
  const router = useRouter();
  const session = useSession();

  /*
   * Sends anyone without a session back to the login screen. This is a routing
   * courtesy, not access control — the document is drafted entirely in the
   * browser, so there is nothing here to protect yet.
   *
   * `undefined` means storage has not been read, which is not the same as being
   * signed out; redirecting then would bounce every visitor on arrival.
   */
  useEffect(() => {
    if (session === null) router.replace("/");
  }, [session, router]);

  return session ? <NdaWorkspace /> : null;
}
