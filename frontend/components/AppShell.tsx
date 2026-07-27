"use client";

/**
 * The bar across the top of every signed-in screen.
 *
 * Machine palette, extending the workspace's existing `.topbar` rather than
 * introducing a second one — the drafting screen already had this bar, and the
 * documents screen wearing the same one is what makes them one product.
 *
 * The two slots exist because the two screens need different things in the
 * middle and on the right: the workspace names the document being drafted and
 * offers Download PDF, the documents list has neither.
 */

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { signOut } from "@/lib/api";

export const DOCUMENTS_PATH = "/documents/";
export const DRAFT_PATH = "/draft/";

interface AppShellProps {
  /** Which nav item to mark, or null on a screen that is neither. */
  active: "documents" | "draft" | null;
  email: string;
  /** What sits between the nav and the account — the document being drafted. */
  center?: ReactNode;
  /** What sits at the far right, before the account — Download PDF, say. */
  end?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  active,
  email,
  center,
  end,
  children,
}: AppShellProps) {
  const router = useRouter();

  /* Revokes the token server-side and clears it here. Clearing it re-renders
     every `useSession`, so the push is belt and braces for the screen that
     asked — a signed-out page would redirect on its own. */
  const handleSignOut = useCallback(async () => {
    await signOut();
    router.replace("/");
  }, [router]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            §
          </span>
          <span className="brand-name">Prelegal</span>
        </div>

        <nav className="topbar-nav" aria-label="Main">
          <button
            type="button"
            className="topbar-nav-link"
            data-active={active === "draft"}
            aria-current={active === "draft" ? "page" : undefined}
            onClick={() => router.push(DRAFT_PATH)}
          >
            New document
          </button>
          <button
            type="button"
            className="topbar-nav-link"
            data-active={active === "documents"}
            aria-current={active === "documents" ? "page" : undefined}
            onClick={() => router.push(DOCUMENTS_PATH)}
          >
            My documents
          </button>
        </nav>

        {center}

        <div className="topbar-account">
          {end}
          <span className="topbar-email" title={email}>
            {email}
          </span>
          <button
            type="button"
            className="topbar-signout"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {children}
    </div>
  );
}
