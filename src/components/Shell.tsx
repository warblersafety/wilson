import type { ReactNode } from "react";

/*
 * The app shell (#40): chrome shared by every screen this round builds —
 * the Warbler Safety wordmark, wilson's own product mark, and the
 * clinician framing. Noah's mockups show the org's logo mark as an image
 * and, per screen, a "nothing stored" badge and the signed-in clinician's
 * name alongside it; those are page-specific content for later units
 * (start surface, review) rather than shell chrome, and the logo mark has
 * no vetted, licensed source yet (brand-tokens.css's own header says the
 * same: "No logo... there is no vector master yet") — so both are left out
 * here rather than guessed at.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell__header">
        <span className="shell__brand">
          Warbler <span className="shell__brand-accent">Safety</span>
        </span>
        <span className="shell__divider" aria-hidden="true" />
        <span className="shell__product">
          <span className="shell__product-dot" aria-hidden="true" />
          Wilson
        </span>
        <span className="shell__tagline">for clinicians</span>
      </header>
      {children}
    </div>
  );
}
