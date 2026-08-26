"use client";

// Owns which of the six design.md surfaces is on screen, the same
// container role Wizard.tsx plays for the topic-by-topic loop it hands
// off into. Open fields is deliberately NOT a variant here: design.md is
// explicit that it "is enumerated as a surface because it carries its own
// rules and state, not its own screen" — it is dialog state owned by
// Review.tsx (screen 06 draws it over screen 05).
//
// The follow-ups step reuses Wizard.tsx (Issue #44 only adds transcript
// visibility to it, per design.md — the loop itself already exists):
// confirming on Read-back runs the resulting session through talk.ts's
// startTalk() — the same call freshStep() makes for a brand-new session —
// before persisting it via session-storage.ts, so the stored transcript
// ends with the Talker's first follow-up question exactly like every
// other session Wizard has ever hydrated (reviewer pass, finding:
// skipping startTalk() and saving the raw post-confirm session left that
// first question permanently unrecorded — Wizard's own hydrate() only
// ever recomputes a *reply* for display, it never appends one, because
// until now every stored session had already been through
// startTalk()/processTurn() at least once before being saved).
//
// A stored session already existing on mount means the clinician is
// resuming mid-follow-up, not starting over — checked once, client-side
// only (session-storage reads window.localStorage, unavailable during
// Next's server render, same reason Wizard.tsx's own hydration runs
// inside an effect rather than an initial state). Only TalkSession
// persists — nothing records WHICH surface was showing — so a reload on
// Review or Ready resumes at follow-ups, whose own hydration re-derives
// "done" and forwards straight back through onDone. No clicks, no data
// loss; the clinician lands back where they were.
import { useEffect, useState } from "react";
import { askDeterministic } from "@/lib/ask";
import {
  clearIntakeDraft,
  clearIntakeState,
  resolveResumeSurface,
  saveSession,
  type IntakeDraft,
} from "@/lib/session-storage";
import type { ReadBackHandoff } from "@/lib/start-surface";
import { startTalk, type TalkSession } from "@/lib/talk";
import { ReadBack } from "./ReadBack";
import { Ready } from "./Ready";
import { Review } from "./Review";
import { StartSurface } from "./StartSurface";
import { Wizard } from "../wizard/Wizard";

type ReadBackDraft = Extract<IntakeDraft, { kind: "read-back" }>;

type IntakeSurface =
  | { kind: "start"; initialNarrative: string }
  | { kind: "read-back"; handoff: ReadBackHandoff; restored?: ReadBackDraft }
  | { kind: "follow-ups" }
  | { kind: "review"; session: TalkSession }
  | { kind: "ready"; session: TalkSession };

async function handToFollowUps(session: TalkSession): Promise<void> {
  const step = await startTalk(session, { ask: askDeterministic });
  saveSession(window.localStorage, step.session);
  // The draft has served its purpose the moment a session exists —
  // resolveResumeSurface() would prefer the session anyway, but leaving an
  // unconfirmed narrative behind after it has been superseded is state
  // nothing will ever read again (Issue #72).
  clearIntakeDraft(window.localStorage);
}

export function IntakeFlow() {
  const [surface, setSurface] = useState<IntakeSurface | null>(null);

  // Storage is read once, on mount, client-side only (session-storage
  // reads window.localStorage, unavailable during Next's server render —
  // the same reason Wizard.tsx hydrates inside an effect rather than an
  // initial state). Which surface to resume is DERIVED from what is
  // stored rather than stored itself, so a pointer can never disagree
  // with the data it points at (src/lib/session-storage.ts).
  useEffect(() => {
    try {
      const resumed = resolveResumeSurface(window.localStorage);
      if (resumed.kind === "follow-ups") {
        setSurface({ kind: "follow-ups" });
      } else if (resumed.kind === "read-back") {
        setSurface({ kind: "read-back", handoff: resumed.draft.handoff, restored: resumed.draft });
      } else {
        setSurface({ kind: "start", initialNarrative: resumed.narrative });
      }
    } catch {
      // Belt and braces behind loadIntakeDraft()'s own manifest check
      // (reviewer pass, PR #80, finding 1), and the same fail-forward
      // template Wizard.tsx has always used for the session key. The
      // failure mode this exists for is unrecoverable rather than merely
      // annoying: a stored value that gets past the guard and then throws
      // during render has no error boundary anywhere in src/app to catch
      // it, and would reproduce on every reload for as long as it sat in
      // storage — the clinician could not reach Start again without
      // clearing site data. Wiping and starting clean loses a draft;
      // leaving it loses the app.
      clearIntakeState(window.localStorage);
      setSurface({ kind: "start", initialNarrative: "" });
    }
  }, []);

  if (surface === null) {
    // Held back until storage has been read, rather than rendering an
    // empty Start surface and correcting it a frame later. Start and
    // Read-back seed their state from props on first mount, so a
    // corrected prop would arrive too late to be read — and a composer
    // that paints empty before filling with the clinician's own recovered
    // draft reads as "it lost my work" for exactly as long as it is
    // wrong. Deliberately unwrapped by the chrome for the same reason
    // Wizard's own loading branch is: nothing about the record is known
    // yet, so any chrome here would be asserting something (reviewer
    // pass, PR #75, finding F10).
    return (
      <main className="intake-loading">
        <p>Loading…</p>
      </main>
    );
  }

  if (surface.kind === "ready") {
    return (
      <Ready
        session={surface.session}
        onStartOver={() => {
          // One function that means "wipe" — the session AND any draft
          // (src/lib/session-storage.ts). Two calls here would be a place
          // for a future third persisted shape to be forgotten.
          clearIntakeState(window.localStorage);
          setSurface({ kind: "start", initialNarrative: "" });
        }}
      />
    );
  }

  if (surface.kind === "review") {
    return (
      <Review
        session={surface.session}
        onEdit={(session) => {
          // Persisted BEFORE the flip: Wizard hydrates from storage on
          // mount, so an unsaved reopen would be silently discarded and
          // the clinician would land back on the pre-edit session.
          saveSession(window.localStorage, session);
          setSurface({ kind: "follow-ups" });
        }}
        onReady={(session) => setSurface({ kind: "ready", session })}
      />
    );
  }

  if (surface.kind === "follow-ups") {
    return <Wizard onDone={(session) => setSurface({ kind: "review", session })} />;
  }

  if (surface.kind === "read-back") {
    return (
      <ReadBack
        handoff={surface.handoff}
        restored={surface.restored}
        onConfirmed={(session) => {
          void handToFollowUps(session).then(() => setSurface({ kind: "follow-ups" }));
        }}
      />
    );
  }

  return (
    <StartSurface
      initialNarrative={surface.initialNarrative}
      onLanded={(handoff) => setSurface({ kind: "read-back", handoff })}
    />
  );
}
