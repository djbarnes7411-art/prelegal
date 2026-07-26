"use client";

import dynamic from "next/dynamic";

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

export default function Home() {
  return <NdaWorkspace />;
}
