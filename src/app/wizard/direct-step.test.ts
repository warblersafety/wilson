// stepForSession's appendReply contract (Issue #64 reviewer pass, finding
// 3 [Moderate]) — see direct-step.ts's file header for the full design
// basis. Exercised against the real manifest (initTalkSession/
// askDeterministic), not a synthetic topic map: stepForSession() always
// calls nextStep() with topics.ts's own defaults, so a synthetic fixture
// could never actually drive it.
import { describe, expect, it } from "vitest";
import { askDeterministic } from "@/lib/ask";
import { applyActionToFields, dismissableFieldIds, widgetTurnText } from "@/lib/chip-grammar";
import { initTalkSession, processTurn, startTalk, type ExtractFn } from "@/lib/talk";
import { stepForSession } from "./direct-step";

describe("stepForSession", () => {
  it("default (no options) appends nothing to the transcript — hydration safety", async () => {
    const session = initTalkSession();
    const result = await stepForSession(session);
    expect(result.session.transcript).toEqual([]);
    // Same reference, not just an equal copy: the false branch must not
    // even allocate a new session object, matching this function's
    // original "no turn appended" contract exactly.
    expect(result.session).toBe(session);
  });

  it("appendReply: false behaves exactly like omitting the option", async () => {
    const session = initTalkSession();
    const result = await stepForSession(session, { appendReply: false });
    expect(result.session.transcript).toEqual([]);
    expect(result.session).toBe(session);
  });

  it("appendReply: true appends exactly one talker turn carrying the recomputed question", async () => {
    const session = initTalkSession();
    const result = await stepForSession(session, { appendReply: true });
    expect(result.session.transcript).toEqual([{ role: "talker", text: result.reply }]);
  });

  it("appendReply: true adds to whatever the session's transcript already had, never replacing it", async () => {
    const session = { ...initTalkSession(), transcript: [{ role: "clinician" as const, text: "prior turn" }] };
    const result = await stepForSession(session, { appendReply: true });
    expect(result.session.transcript).toEqual([
      { role: "clinician", text: "prior turn" },
      { role: "talker", text: result.reply },
    ]);
  });

  // The actual bug (reviewer pass on PR #64): a chip tap wrote its own
  // "question — answer" turn via stepForSession's OLD no-append-ever
  // behavior, so the NEW question it produced lived only in
  // TalkStep.reply, never in session.transcript. If the clinician's next
  // move was a typed answer (which appends only the clinician's own
  // message, never the question it answers — see talk.ts's respond()),
  // the transcript showed that answer with no question above it at all.
  it("a chip tap followed by a typed turn yields a transcript with no gap", async () => {
    // Real opening turn: patient-basics's first MAX_FIELDS_PER_ASK fields.
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    expect(opening.nextStep.kind).toBe("topic");

    // Simulate AskForm.handleDismiss's own write path exactly: dismiss the
    // fields this ask actually phrased, append the widget "question —
    // answer" turn, then recompute with appendReply: true.
    const askedFieldIds = dismissableFieldIds(opening.nextStep);
    const dismissSession = {
      ...opening.session,
      record: applyActionToFields(opening.session.record, askedFieldIds, { type: "decline" as const }),
      transcript: [
        ...opening.session.transcript,
        { role: "clinician" as const, text: widgetTurnText(opening.reply, "Rather not say"), source: "widget" as const },
      ],
    };
    const afterDismiss = await stepForSession(dismissSession, { appendReply: true });
    // Still on patient-basics (16 of its 19 fields remain) with a fresh
    // question — the new question this test is actually about.
    expect(afterDismiss.nextStep.kind).toBe("topic");

    // Now a typed turn answers THAT question — processTurn only ever
    // appends the clinician's own message (never the question it
    // answers), which is exactly why the prior talker turn must already
    // be in the transcript by the time this call happens.
    const extract: ExtractFn = async () => ({ actions: [] });
    const afterTyped = await processTurn(afterDismiss.session, "typed answer", { ask: askDeterministic, extract });

    const transcript = afterTyped.session.transcript;
    const typedIndex = transcript.findIndex((t) => t.role === "clinician" && t.text === "typed answer");
    expect(typedIndex).toBeGreaterThan(0);
    // No gap: the turn immediately above the typed answer is the exact
    // question it answers, not another clinician turn.
    expect(transcript[typedIndex - 1]).toEqual({ role: "talker", text: afterDismiss.reply });
  });
});
