// Issue #89: the current ask renders exactly once. Driven against the
// real manifest (initTalkSession/askDeterministic) rather than a
// synthetic topic map, for the same reason direct-step.test.ts is — the
// double-render Steve saw was on the real walk, and a synthetic fixture
// would prove nothing about it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askDeterministic } from "@/lib/ask";
import { applyActionToFields, dismissableFieldIds, widgetTurnText } from "@/lib/chip-grammar";
import { initTalkSession, processTurn, startTalk, type ExtractFn, type TalkStep } from "@/lib/talk";
import { stepForSession } from "./direct-step";
import { visibleTranscriptTurns } from "./transcript-view";

// What the clinician actually sees on Follow-ups: Transcript renders
// every visible turn, then AskForm (or RepeatDecision) renders the reply
// once more as the accent bubble. Counting occurrences across BOTH is the
// whole point — a helper that dropped the turn while the bubble also
// vanished would pass a transcript-only assertion and show the clinician
// nothing.
function askOccurrencesOnScreen(step: TalkStep): number {
  const inTranscript = visibleTranscriptTurns(step).filter((turn) => turn.text === step.reply).length;
  const inAskBubble = step.nextStep.kind === "done" ? 0 : 1;
  return inTranscript + inAskBubble;
}

// Resolves exactly the fields this ask phrased, so the next turn's
// question is a genuinely new one — the ordinary case, and the one
// Steve's screenshot was taken in. mark_unknown rather than answer:
// it advances the walk without inventing manifest-valid values.
function resolveWhatWasAsked(step: TalkStep): ExtractFn {
  const fieldIds = dismissableFieldIds(step.nextStep);
  return async () => ({ actions: fieldIds.map((fieldId) => ({ fieldId, type: "mark_unknown" as const })) });
}

describe("visibleTranscriptTurns", () => {
  it("shows the opening ask once", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    expect(askOccurrencesOnScreen(opening)).toBe(1);
  });

  // The actual bug: every turn after the first rendered the identical
  // paragraph back-to-back, gray then teal (Steve's 2026-08-26 staging
  // screenshot). Before the fix this counted 2.
  it("shows the current ask once after a processTurn round-trip", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    expect(opening.nextStep.kind).toBe("topic");
    const next = await processTurn(opening.session, "nothing on hand", {
      ask: askDeterministic,
      extract: resolveWhatWasAsked(opening),
    });
    expect(next.reply).not.toBe(opening.reply);
    expect(askOccurrencesOnScreen(next)).toBe(1);
  });

  it("stays at one across several consecutive turns", async () => {
    let step = await startTalk(initTalkSession(), { ask: askDeterministic });
    for (let i = 0; i < 5; i += 1) {
      step = await processTurn(step.session, `answer ${i}`, {
        ask: askDeterministic,
        extract: resolveWhatWasAsked(step),
      });
      expect(askOccurrencesOnScreen(step)).toBe(1);
    }
  });

  // AC-2: reload/hydration keeps direct-step's no-append contract (the
  // stored session already ends with this ask as its trailing talker
  // turn) and still renders it once.
  it("shows the ask once after reload hydration, with nothing appended", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const stored = (
      await processTurn(opening.session, "an answer", {
        ask: askDeterministic,
        extract: resolveWhatWasAsked(opening),
      })
    ).session;
    const hydrated = await stepForSession(stored);
    expect(hydrated.session.transcript).toBe(stored.transcript);
    expect(askOccurrencesOnScreen(hydrated)).toBe(1);
  });

  // A chip write appends its own "question — answer" clinician turn AND
  // (appendReply: true) the recomputed next question — the path where the
  // duplicate is newest.
  it("shows the ask once after a chip write", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const fieldIds = dismissableFieldIds(opening.nextStep);
    const session = {
      ...opening.session,
      record: applyActionToFields(opening.session.record, fieldIds, { type: "mark_unknown" }),
      transcript: [
        ...opening.session.transcript,
        {
          role: "clinician" as const,
          text: widgetTurnText(opening.reply, "I don't have that"),
          source: "widget" as const,
        },
      ],
    };
    const next = await stepForSession(session, { appendReply: true });
    expect(askOccurrencesOnScreen(next)).toBe(1);
  });

  // AC-1's other half: the ask stops being hidden the moment it is no
  // longer current — the answered question stays in the history, which is
  // what makes the transcript a transcript.
  it("keeps the previous ask visible once it is no longer current", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const next = await processTurn(opening.session, "an answer", {
      ask: askDeterministic,
      extract: resolveWhatWasAsked(opening),
    });
    expect(visibleTranscriptTurns(next).map((turn) => turn.text)).toEqual([opening.reply, "an answer"]);
  });

  // A turn that resolves nothing (an unparseable answer) re-asks the same
  // question. The earlier, identical ask legitimately stays in the
  // history — but the back-to-back gray/teal pair is still gone, which is
  // what the bug was: the visible transcript never ENDS with the ask the
  // bubble is about to render.
  it("never ends the visible transcript with the current ask, even when it repeats verbatim", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const extract: ExtractFn = async () => ({ actions: [] });
    const next = await processTurn(opening.session, "hmm", { ask: askDeterministic, extract });
    expect(next.reply).toBe(opening.reply);
    const visible = visibleTranscriptTurns(next);
    expect(visible[visible.length - 1]?.text).not.toBe(next.reply);
    expect(visible.map((turn) => turn.text)).toEqual([opening.reply, "hmm"]);
  });

  it("hides nothing at done — no surface renders that reply as a bubble", async () => {
    const step = await startTalk(initTalkSession(), { ask: askDeterministic });
    const done: TalkStep = {
      ...step,
      nextStep: { kind: "done" },
      session: { ...step.session, transcript: [{ role: "talker", text: step.reply }] },
    };
    expect(visibleTranscriptTurns(done)).toEqual([{ role: "talker", text: step.reply }]);
    expect(askOccurrencesOnScreen(done)).toBe(1);
  });

  it("leaves a transcript whose trailing turn is the clinician's alone", async () => {
    const step = await startTalk(initTalkSession(), { ask: askDeterministic });
    const turns = [
      { role: "talker" as const, text: step.reply },
      { role: "clinician" as const, text: step.reply },
    ];
    const withClinicianLast: TalkStep = { ...step, session: { ...step.session, transcript: turns } };
    expect(visibleTranscriptTurns(withClinicianLast)).toBe(turns);
  });

  // Display-only (AC-3): the helper never touches what the session
  // stores, so the extractor's rendered context and session-storage's
  // shape are exactly what talk.ts produced.
  it("does not mutate or reshape the stored session", async () => {
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const next = await processTurn(opening.session, "an answer", {
      ask: askDeterministic,
      extract: resolveWhatWasAsked(opening),
    });
    const before = JSON.parse(JSON.stringify(next.session));
    visibleTranscriptTurns(next);
    expect(next.session).toEqual(before);
    expect(next.session.transcript[next.session.transcript.length - 1]).toEqual({
      role: "talker",
      text: next.reply,
    });
  });
});

// The call site itself (reviewer pass on PR #97, finding 3): every test
// above proves the pure helper, and deleting Wizard's one call to it
// restores the double bubble with the whole suite still green. There is
// no jsdom or React test renderer in this dependency tree — the same call
// globals.test.ts records for the design tokens — so the wiring is
// locked by reading the source, which is enough for a one-line prop that
// can only be right one way.
describe("Wizard's wiring to the helper", () => {
  const WIZARD = readFileSync(join(process.cwd(), "src/app/wizard/Wizard.tsx"), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/g,
    "",
  );

  it("feeds Transcript the visible turns, never the raw stored transcript", () => {
    expect(WIZARD).toContain("visibleTranscriptTurns");
    const transcriptElement = WIZARD.match(/<Transcript\b[^>]*>/);
    expect(transcriptElement, "Wizard no longer renders <Transcript>").not.toBeNull();
    expect(transcriptElement![0]).toContain("turns={visibleTranscriptTurns(current)}");
    expect(transcriptElement![0]).not.toContain("session.transcript");
  });
});
