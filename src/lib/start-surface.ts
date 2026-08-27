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
import { friendlyFailureMessage } from "./chip-grammar";
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

// Two kinds of failure, distinguished rather than merged (Issue #73,
// closes #63). #44 shipped the friendly-copy-with-retry standard —
// "server/extraction failures surface as friendly copy with a retry,
// never err.message" — but scoped it to its own surface, so Start and
// Read-back went on rendering whatever the Server Action threw: an SDK
// error string, straight to a clinician.
//
// Blanket-wrapping everything would have been the wrong fix. Wilson's own
// validation copy is specific and actionable ("that's too long, here's the
// limit") and the clinician has to edit before retrying; the server's is a
// raw exception and retrying as-is is exactly the right move. `reason`
// lets the surface offer a retry only where retrying means something,
// and `message` is always ready to render either way.
export type StartSubmitOutcome =
  | { landed: true; handoff: ReadBackHandoff }
  | { landed: false; reason: "invalid" | "failed"; message: string };

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
    return { landed: false, reason: "invalid", message: validation.message };
  }
  const outcome = await submit(session, validation.trimmed);
  if (!outcome.ok) {
    // Never outcome.message: submitNarrative returns `err.message` from
    // its catch (src/app/actions.ts), which on this route can carry
    // provider error text and request ids. design.md's rule against a
    // field value reaching a log applies the same way to an error string
    // reaching a clinician.
    return { landed: false, reason: "failed", message: friendlyFailureMessage(outcome.message) };
  }
  return { landed: true, handoff: { session, narrative: validation.trimmed, result: outcome.result } };
}

// The Start surface's clinician-facing strings, in lib so ready.test.ts's
// no-submission-claims check and its bare-text coverage guard can reach
// them (the pattern Issue #45 established for the closing surfaces, and
// Issue #73 extends to the two surfaces #63 covers).
//
// The privacy paragraph walks the whole data path in order — voice, local
// text, submitted text, and what wilson does at the end — because
// design.md's privacy-copy rule is that copy claims exactly what the
// machinery delivers: no more (the model-provider sentence stays plain
// while the DPA item is open) and no less (the local-retention sentence
// exists because Issue #72 made a draft survive a reload).
//
// It says "the text you send", not "submitted text", for a reason worth
// recording: the no-submission-claims check in ready.test.ts bans
// "submitted" outright, and that bluntness is the point — a check that
// allowed the word in one place would have to judge intent everywhere
// else. The clinician sends text to wilson; nothing about this report is
// ever submitted anywhere by wilson, and the copy is clearer without the
// bureaucratic word anyway.
export const START_COPY = {
  heading: "Report an adverse event",
  firstQuestion: "What’s the suspect product, and what reaction did the patient have?",
  secondQuestion: "When did it happen, and what was the outcome?",
  composerPlaceholder: "Dictate or type what happened…",
  composerLabel: "Adverse event narrative",
  submitCta: "Submit",
  submitPending: "Reading through what you wrote…",
  retryCta: "Try again",
  privacy:
    "wilson never hears your voice — dictation happens on your device, and only text you approve is sent. " +
    "Your text stays in this browser, on this device, until you start over. The text you send is processed by " +
    "wilson’s model provider to help fill out the report. wilson fills the form and hands it back to you — " +
    "it never files anything with FDA on your behalf.",
} as const;
