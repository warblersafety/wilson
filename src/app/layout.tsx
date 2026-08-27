import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Shell } from "@/components/Shell";
import "./globals.css";

/*
 * Warbler Safety's two typefaces (#40 AC-2), self-hosted rather than fetched
 * from Google — no third-party request from the clinician's browser, a
 * deterministic build, and `next/font/google` cannot build in this sandbox
 * at all. `latin` subset only, matching lucy's `layout.tsx`: a character
 * outside Latin-1 falls back to the system font for that glyph rather than
 * shipping every subset to every clinician. Both are variable fonts, hence
 * one file each across the whole weight range. `display: "swap"` so first
 * paint isn't blocked on the font arriving; `next/font/local` derives
 * fallback metrics automatically, which is what keeps that swap from
 * shifting layout. Full reasoning (OFL terms, subset trade-off) lives in
 * lucy's `src/app/layout.tsx` — the same decision, not re-argued here.
 */
const bodyFont = localFont({
  src: [{ path: "./fonts/hanken-grotesk-latin.woff2", weight: "400 900", style: "normal" }],
  variable: "--font-hanken",
  display: "swap",
});

const displayFont = localFont({
  src: [{ path: "./fonts/schibsted-grotesk-latin.woff2", weight: "400 900", style: "normal" }],
  variable: "--font-schibsted",
  display: "swap",
});

export const metadata: Metadata = {
  title: "wilson",
  description: "Clinician-side conversational intake for adverse drug events",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
