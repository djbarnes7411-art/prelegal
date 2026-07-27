"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { DocumentsList } from "@/components/DocumentsList";
import { useSession } from "@/lib/session";

export default function DocumentsPage() {
  const router = useRouter();
  const session = useSession();

  /*
   * Same gate as the workspace: `undefined` means storage has not been read,
   * which is not the same as being signed out. This is also what catches a
   * session cleared mid-request by a 401 — clearing it re-renders here, and
   * this effect takes the browser back to the login screen.
   */
  useEffect(() => {
    if (session === null) router.replace("/");
  }, [session, router]);

  if (!session) return null;

  return (
    <AppShell active="documents" email={session.user.email}>
      <DocumentsList />
    </AppShell>
  );
}
