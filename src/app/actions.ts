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
