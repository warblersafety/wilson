// stepForSession's appendReply contract (Issue #64 reviewer pass, finding
// 3 [Moderate]) — see direct-step.ts's file header for the full design
// basis. Exercised against the real manifest (initTalkSession/
// askDeterministic), not a synthetic topic map: stepForSession() always
// calls nextStep() with topics.ts's own defaults, so a synthetic fixture
// could never actually drive it.
import { describe, expect, it } from "vitest";
import { askDeterministic } from "@/lib/ask";
import { applyActionToFields, dismissAcknowledgment, dismissableFieldIds, widgetTurnText } from "@/lib/chip-grammar";
import { initTalkSession, processTurn, startTalk, type ExtractFn, type TalkSession, type TalkStep } from "@/lib/talk";
import { initRepeatCounts, setRepeatCount } from "@/lib/topics";
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

// Issue #110: a dismiss tap's acknowledgment reaches the transcript the
// same way the sweep's does — prepended to the recomputed question, so
// the talker turn carries both (talk.ts's respond() composes the
// conversational path's prefix identically). A separate talker turn was
// the alternative and is not what this does: two bubbles for one tap is
// the double-bubble class unit #89 removed.
describe("stepForSession replyPrefix", () => {
  it("prepends the prefix to the reply and to the appended talker turn", async () => {
    const session = initTalkSession();
    const bare = await stepForSession(session, { appendReply: true });
    const prefixed = await stepForSession(session, { appendReply: true, replyPrefix: "Marked age as not on hand." });
    expect(prefixed.reply).toBe(`Marked age as not on hand. ${bare.reply}`);
    expect(prefixed.session.transcript).toEqual([{ role: "talker", text: prefixed.reply }]);
  });

  it("omitting the prefix leaves the reply exactly as it was", async () => {
    const session = initTalkSession();
    const bare = await stepForSession(session, { appendReply: true });
    const explicit = await stepForSession(session, { appendReply: true, replyPrefix: undefined });
    expect(explicit.reply).toBe(bare.reply);
  });

  // The prefix is about a write that already happened, so it must survive
  // the walk running out of questions — otherwise the last dismiss of a
  // session is the one nobody is told about.
  it("still carries the prefix when the recomputed step is done", async () => {
    const answered = {
      ...initTalkSession(),
      record: dismissEverything(),
      repeatCounts: setRepeatCount(setRepeatCount(initRepeatCounts(), "suspect-product", 1), "concomitant-medication", 1),
    };
    const result = await stepForSession(answered, { appendReply: true, replyPrefix: "Marked age as declined." });
    expect(result.nextStep.kind).toBe("done");
    expect(result.reply.startsWith("Marked age as declined. ")).toBe(true);
  });
});

function dismissEverything() {
  const record = initTalkSession().record;
  const out = { ...record };
  for (const id of Object.keys(out)) out[id] = { state: "unknown" as const };
  return out;
}

// Reviewer pass on #109/#110. A chip tap's own transcript entry is
// `role: "clinician"` and quotes the question it answers. Once a dismiss
// acknowledgment was composed INTO `reply`, quoting `reply` folded a
// talker statement into the clinician's own words — and consecutive
// dismiss taps are an ordinary session, not a corner: a clinician without
// the patient's weight usually doesn't have their race/ethnicity either.
// It also reaches unit #92's exported conversation bundle, so it lands on
// the record, not just the screen.
//
// Driven through AskForm.handleDismiss's exact composition rather than
// through processTurn(): scriptedSteps() models the TYPED path, whose
// in-ask mark_unknown writes produce no sweep prefix at all, so a check
// there would pass without ever rendering an acknowledgment.
describe("consecutive dismiss taps", () => {
  async function tap(step: TalkStep): Promise<TalkStep> {
    const fieldIds = dismissableFieldIds(step.nextStep);
    const nextSession: TalkSession = {
      ...step.session,
      record: applyActionToFields(step.session.record, fieldIds, { type: "mark_unknown" }),
      transcript: [
        ...step.session.transcript,
        { role: "clinician", text: widgetTurnText(step.question, "I don't have that"), source: "widget" },
      ],
    };
    return stepForSession(nextSession, {
      appendReply: true,
      replyPrefix: dismissAcknowledgment(step.nextStep, "mark_unknown"),
    });
  }

  it("never attribute a talker acknowledgment to the clinician", async () => {
    let step = await startTalk(initTalkSession(), { ask: askDeterministic });
    for (let i = 0; i < 4; i += 1) step = await tap(step);

    const clinician = step.session.transcript.filter((turn) => turn.role === "clinician");
    const talker = step.session.transcript.filter((turn) => turn.role === "talker");

    // The acknowledgments exist...
    expect(talker.filter((turn) => turn.text.startsWith("Marked "))).toHaveLength(4);
    // ...and none of them is quoted as something the clinician said.
    expect(clinician).toHaveLength(4);
    expect(clinician.filter((turn) => turn.text.includes("Marked "))).toEqual([]);
  });

  it("the clinician turn quotes the bare question, acknowledgment stripped", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const second = await tap(opening);
    const third = await tap(second);

    // The turn the second tap recorded answers the second ask — whose
    // visible reply led with the FIRST tap's acknowledgment.
    expect(second.reply.startsWith("Marked ")).toBe(true);
    expect(second.question.startsWith("Marked ")).toBe(false);
    const recorded = third.session.transcript.filter((turn) => turn.role === "clinician").at(-1)!;
    expect(recorded.text).toBe(`${second.question} — I don't have that`);
  });
});
