"use client";

// Owns which of the six design.md surfaces is on screen, the same
// container role Wizard.tsx plays for the topic-by-topic loop it now
// hands off into. "review"/"open-fields"/"ready" don't exist yet — Issue
// #45 adds them as it lands; this doesn't pre-build them.
//
// The follow-ups step reuses Wizard.tsx as-is (Issue #44 only adds
// transcript visibility to it, per design.md — the loop itself already
// exists) rather than building a second throwaway placeholder: confirming
// on Read-back persists the resulting session via session-storage.ts,
// the same mechanism Wizard.tsx already hydrates from on mount, so no
// change to Wizard.tsx itself was needed. This also narrows
// warblersafety/wilson#56 (filed by #42's reviewer pass): a reload after
// reaching follow-ups now survives via v1's existing persistence — only
// the pre-confirm Start/Read-back draft state remains unpersisted.
import { useState } from "react";
import { ReadBack } from "./ReadBack";
import { StartSurface } from "./StartSurface";
import { saveSession } from "@/lib/session-storage";
import type { ReadBackHandoff } from "@/lib/start-surface";
import { Wizard } from "../wizard/Wizard";

type IntakeSurface = { kind: "start" } | { kind: "read-back"; handoff: ReadBackHandoff } | { kind: "follow-ups" };

export function IntakeFlow() {
  const [surface, setSurface] = useState<IntakeSurface>({ kind: "start" });

  if (surface.kind === "follow-ups") {
    return <Wizard />;
  }

  if (surface.kind === "read-back") {
    return (
      <ReadBack
        handoff={surface.handoff}
        onConfirmed={(session) => {
          saveSession(window.localStorage, session);
          setSurface({ kind: "follow-ups" });
        }}
      />
    );
  }

  return <StartSurface onLanded={(handoff) => setSurface({ kind: "read-back", handoff })} />;
}
