// The Start surface's submit-state/routing logic (Issue #42) — dictation-
// first entry point per design.md's "Interaction model and UI". Kept out of
// the component itself so it's provable under vitest's node environment (no
// DOM): StartSurface.tsx stays a thin wrapper, same convention as the rest
// of src/app/wizard, whose components carry no direct tests of their own.
//
// narrative-extract.ts's module doc is explicit that it decides neither
// "when to call the model" nor "how the resulting session continues" —
// that's this unit's job for the "when," and the Read-back surface's
// (Issue #43) for edits/confirmation. This module only takes the narrative
// as far as "landed on read-back with a result in hand"; nothing here
// writes to a record.
import type { NarrativeExtractResult } from "./narrative-extract";
import type { TalkSession } from "./talk";

// A cost/latency bound, not a clinical one — generous for a dictated
// opening narrative (a few paragraphs at most) while keeping a worst-case
// extraction call's input bounded.
export const MAX_NARRATIVE_LENGTH = 6000;

// The `{ok:true}` arm carries the already-trimmed text — both call sites
// that validate (this module's own resolveStartSubmit, and the
// submitNarrative Server Action, which validates independently since a
// Server Action is a public endpoint no client-side check actually
// guards) need it next, so neither has to re-trim (reviewer pass, finding).
export type NarrativeValidation =
  | { ok: true; trimmed: string }
  | { ok: false; reason: "empty" | "too-long"; message: string };

export function validateNarrative(narrative: string): NarrativeValidation {
  const trimmed = narrative.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty", message: "Write or dictate what happened before submitting." };
  }
  if (trimmed.length > MAX_NARRATIVE_LENGTH) {
    return {
      ok: false,
      reason: "too-long",
      message:
        `That's a lot to review at once — keep it under ${MAX_NARRATIVE_LENGTH.toLocaleString()} characters ` +
        `(currently ${trimmed.length.toLocaleString()}).`,
    };
  }
  return { ok: true, trimmed };
}

export interface ReadBackHandoff {
  session: TalkSession;
  narrative: string;
  result: NarrativeExtractResult;
}

// Structurally matches the real submitNarrative Server Action
// (src/app/actions.ts) exactly, so the component can pass that action
// directly with no adapter — a fake conforming to this same shape is what
// this module's own tests inject in its place.
export type NarrativeSubmitFn = (
  session: TalkSession,
  narrative: string,
) => Promise<{ ok: true; result: NarrativeExtractResult } | { ok: false; message: string }>;

export type StartSubmitOutcome = { landed: true; handoff: ReadBackHandoff } | { landed: false; message: string };

// The pure core AskForm.tsx's own submit handler inlines untested (Issue
// #32 never needed this level of proof) — Issue #42's frozen AC explicitly
// does, since this is the hand-off point the whole six-surface rebuild
// hinges on. Bounds input before ever calling `submit`, matching the AC's
// "friendly in-place message... never a raw server error."
//
// Takes `session` from the caller rather than constructing one itself
// (reviewer pass, finding): every other orchestration function here
// (processTurn/startTalk, submitTurn/submitNarrative) takes a session as a
// parameter, and Wizard.tsx's freshStep() shows "when does a session
// begin" is a container-level decision, not a leaf validation module's to
// make — the Read-back surface's (Issue #43) "edits re-enter extraction"
// path (design.md) will need to pass an in-hand session through this same
// function, not a forced-fresh one.
export async function resolveStartSubmit(
  narrative: string,
  session: TalkSession,
  submit: NarrativeSubmitFn,
): Promise<StartSubmitOutcome> {
  const validation = validateNarrative(narrative);
  if (!validation.ok) {
    return { landed: false, message: validation.message };
  }
  const outcome = await submit(session, validation.trimmed);
  if (!outcome.ok) {
    return { landed: false, message: outcome.message };
  }
  return { landed: true, handoff: { session, narrative: validation.trimmed, result: outcome.result } };
}
