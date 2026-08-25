"use server";

// The only place in the wizard UI (Issue #32) that runs the real,
// key-requiring Extractor — everything else in src/app/wizard is pure
// client-side state derived from src/lib's already-tested logic. This dev
// machine has no ANTHROPIC_API_KEY (docs/SECRETS-AND-COSTS.md — keyless by
// design), so this action is expected to fail cleanly here; callers get a
// typed ok:false instead of an unhandled server exception, so the UI can
// show an inline, retryable error without losing the clinician's message.
import { createExtractFn } from "@/lib/extract";
import { askDeterministic } from "@/lib/ask";
import { createNarrativeExtractFn, type NarrativeExtractResult } from "@/lib/narrative-extract";
import { validateNarrative } from "@/lib/start-surface";
import { processTurn, type TalkSession, type TalkStep } from "@/lib/talk";

export type SubmitTurnResult = { ok: true; step: TalkStep } | { ok: false; message: string };

export async function submitTurn(session: TalkSession, message: string): Promise<SubmitTurnResult> {
  try {
    const step = await processTurn(session, message, {
      ask: askDeterministic,
      extract: createExtractFn(),
    });
    return { ok: true, step };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// The Start surface's (Issue #42) server-side hand-off into the narrative
// pass (Issue #41) — same shape and same reason as submitTurn above: this
// dev machine is keyless by design, so a real call fails cleanly into
// ok:false rather than an unhandled exception crossing the Server Action
// boundary. Return type matches src/lib/start-surface.ts's NarrativeSubmitFn
// structurally (deliberately not imported from there — src/app depends on
// src/lib, never the reverse) so StartSurface.tsx can pass this action
// straight through with no adapter.
//
// Validates independently of resolveStartSubmit's own client-side check
// (reviewer pass, finding): a Server Action compiles to a directly-callable
// endpoint reachable by anything that can reach the app, not only through
// the component that happens to call it today — the length bound has to
// hold at this boundary on its own, not just in one caller's discipline.
export type SubmitNarrativeResult = { ok: true; result: NarrativeExtractResult } | { ok: false; message: string };

export async function submitNarrative(session: TalkSession, narrative: string): Promise<SubmitNarrativeResult> {
  const validation = validateNarrative(narrative);
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }
  try {
    const result = await createNarrativeExtractFn()(session, validation.trimmed);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}
