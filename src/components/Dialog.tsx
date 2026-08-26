"use client";

// The app's one overlay primitive (Issue #45) — screen 06's Open-fields
// dialog and Ready's "Report another" confirm both need one, and the repo
// had no dialog or modal code anywhere before this unit, so one shared
// primitive beats two bespoke overlays.
//
// Deliberately minimal, matching the mockup's plain structure: an
// aria-modal panel in a click-outside-to-dismiss overlay, Escape to
// close, and focus moved into the panel on open so a keyboard user isn't
// left behind on the page underneath. Known-minimal and recorded as such
// in this unit's PR: there is no focus trap, consistent with the repo's
// existing a11y baseline — adding one is a real improvement, but a wider
// change than this unit's frozen AC covers.
import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  // Labels the dialog for assistive tech — the id of the element inside
  // that carries its heading, so the accessible name is the same string
  // the sighted clinician reads, never a second copy of it.
  labelledBy: string;
  onDismiss: () => void;
  children: ReactNode;
}

export function Dialog({ labelledBy, onDismiss, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    // On window, not the panel: Escape must close the dialog wherever
    // focus has wandered to inside it, including out of it entirely
    // (there is no focus trap — see the file header).
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="dialog-overlay"
      // Dismiss only on a click that started AND ended on the backdrop
      // itself — a drag that begins inside the panel and releases over
      // the backdrop (selecting text across the panel edge) would
      // otherwise close the dialog mid-gesture.
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={panelRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
