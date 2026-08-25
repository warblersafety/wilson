"use client";

// Owns which of the six design.md surfaces is on screen, the same
// container role Wizard.tsx plays for the topic-by-topic loop it will
// eventually be reached through. Only "start" and "read-back" exist yet —
// Issues #43-#45 add the rest as they land; this doesn't pre-build them.
//
// Deliberately not wired to session-storage.ts yet (reviewer pass, noted):
// Wizard.tsx persists/rehydrates a TalkSession on every step, but that
// helper's shape is scoped to Issue #32's wizard and doesn't fit
// IntakeSurface/ReadBackHandoff as-is — a reload here loses the
// in-progress narrative or a landed extraction with no warning. Picking
// the right persisted shape needs to see what Issues #43-#45 actually
// carry, not guess now; filed as a follow-up rather than designed here.
import { useState } from "react";
import type { ReadBackHandoff } from "@/lib/start-surface";
import { StartSurface } from "./StartSurface";

type IntakeSurface = { kind: "start" } | { kind: "read-back"; handoff: ReadBackHandoff };

export function IntakeFlow() {
  const [surface, setSurface] = useState<IntakeSurface>({ kind: "start" });

  if (surface.kind === "read-back") {
    // The real Read-back surface (quote-paired proposal panel, confirm/edit)
    // is Issue #43's build. This just proves Start's routing lands here
    // with a real extraction result in hand — nothing is written yet.
    const { result } = surface.handoff;
    return (
      <main className="start-surface">
        <h1 className="start-surface__heading">Read-back</h1>
        <p>
          {result.proposals.length} proposal{result.proposals.length === 1 ? "" : "s"} found from what you
          wrote. The read-back review (Issue #43) isn&rsquo;t built yet.
        </p>
      </main>
    );
  }

  return <StartSurface onLanded={(handoff) => setSurface({ kind: "read-back", handoff })} />;
}
