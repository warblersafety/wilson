"use client";

// Owns which of the six design.md surfaces is on screen, the same
// container role Wizard.tsx plays for the topic-by-topic loop it now
// hands off into. "review"/"open-fields"/"ready" don't exist yet — Issue
// #45 adds them as it lands; this doesn't pre-build them.
//
// The follow-ups step reuses Wizard.tsx completely unmodified (Issue #44
// only adds transcript visibility to it, per design.md — the loop itself
// already exists): confirming on Read-back runs the resulting session
// through talk.ts's startTalk() — the same call freshStep() makes for a
// brand-new session — before persisting it via session-storage.ts, so the
// stored transcript ends with the Talker's first follow-up question
// exactly like every other session Wizard has ever hydrated (reviewer
// pass, finding: skipping startTalk() and saving the raw post-confirm
// session left that first question permanently unrecorded — Wizard's own
// hydrate() only ever recomputes a *reply* for display, it never appends
// one, because until now every stored session had already been through
// startTalk()/processTurn() at least once before being saved).
//
// A stored session already existing on mount means the clinician is
// resuming mid-follow-up, not starting over — checked once, client-side
// only (session-storage reads window.localStorage, unavailable during
// Next's server render, same reason Wizard.tsx's own hydration runs
// inside an effect rather than an initial state).
import { useEffect, useState } from "react";
import { askDeterministic } from "@/lib/ask";
import { loadSession, saveSession } from "@/lib/session-storage";
import type { ReadBackHandoff } from "@/lib/start-surface";
import { startTalk, type TalkSession } from "@/lib/talk";
import { ReadBack } from "./ReadBack";
import { StartSurface } from "./StartSurface";
import { Wizard } from "../wizard/Wizard";

type IntakeSurface = { kind: "start" } | { kind: "read-back"; handoff: ReadBackHandoff } | { kind: "follow-ups" };

async function handToFollowUps(session: TalkSession): Promise<void> {
  const step = await startTalk(session, { ask: askDeterministic });
  saveSession(window.localStorage, step.session);
}

export function IntakeFlow() {
  const [surface, setSurface] = useState<IntakeSurface>({ kind: "start" });

  useEffect(() => {
    if (loadSession(window.localStorage)) {
      setSurface({ kind: "follow-ups" });
    }
  }, []);

  if (surface.kind === "follow-ups") {
    return <Wizard />;
  }

  if (surface.kind === "read-back") {
    return (
      <ReadBack
        handoff={surface.handoff}
        onConfirmed={(session) => {
          void handToFollowUps(session).then(() => setSurface({ kind: "follow-ups" }));
        }}
      />
    );
  }

  return <StartSurface onLanded={(handoff) => setSurface({ kind: "read-back", handoff })} />;
}
