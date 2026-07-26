import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";

import "./globals.css";

/** The document's voice: a text serif built to be read, not admired. */
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

/** The tool's voice. */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

/** Labels, clause numbers, anything that acts like a filing mark. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

/*
 * The document pages retitle themselves once mounted — browsers use
 * `document.title` as the default "Save as PDF" filename, so the agreement's own
 * name has to win there. See `documentTitle` in `lib/nda/render.ts`.
 */
export const metadata: Metadata = {
  title: "Prelegal",
  description:
    "Draft legal agreements from vetted templates and download them ready to sign.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
