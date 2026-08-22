import { describe, expect, it, vi } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import {
  initTalkSession,
  processTurn,
  startTalk,
  type AskFn,
  type ExtractFn,
} from "./talk";

const FIELD_A = FORM_3500_FIELDS[0].id;
const FIELD_B = FORM_3500_FIELDS[1].id;

const askFieldLabel: AskFn = async (field) =>
  field ? field.label : "All done, thanks.";

describe("initTalkSession", () => {
  it("starts with an empty transcript and a fresh Agenda record", () => {
    const session = initTalkSession();
    expect(session.transcript).toEqual([]);
    expect(session.record).toEqual(initAgenda());
  });
});

describe("startTalk", () => {
  it("asks about the first unasked field without any extraction step", async () => {
    const ask = vi.fn(askFieldLabel);
    const session = initTalkSession();
    const result = await startTalk(session, { ask });

    expect(ask).toHaveBeenCalledTimes(1);
    const [field, seenSession] = ask.mock.calls[0];
    expect(field?.id).toBe(FIELD_A);
    expect(seenSession.record).toEqual(session.record);
    expect(result.reply).toBe(FORM_3500_FIELDS[0].label);
    expect(result.done).toBe(false);
  });

  it("appends the opening reply to the transcript as a talker turn", async () => {
    const session = initTalkSession();
    const result = await startTalk(session, { ask: askFieldLabel });
    expect(result.session.transcript).toEqual([
      { role: "talker", text: FORM_3500_FIELDS[0].label },
    ]);
  });

  it("does not mutate the input session", async () => {
    const session = initTalkSession();
    await startTalk(session, { ask: askFieldLabel });
    expect(session.transcript).toEqual([]);
  });

  it("reports done when every field is already resolved", async () => {
    let record: AgendaRecord = initAgenda();
    for (const field of FORM_3500_FIELDS) {
      record = applyAction(record, field.id, { type: "decline" });
    }
    const result = await startTalk({ transcript: [], record }, { ask: askFieldLabel });
    expect(result.done).toBe(true);
    expect(result.reply).toBe("All done, thanks.");
  });
});

describe("processTurn", () => {
  it("applies a single extracted answer, then asks about the next field", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "42" },
    ];
    const session = initTalkSession();
    const result = await processTurn(session, "I'm 42", { extract, ask: askFieldLabel });

    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "42" });
    expect(result.reply).toBe(FORM_3500_FIELDS[1].label);
    expect(result.done).toBe(false);
  });

  it("appends both the clinician's message and the reply to the transcript", async () => {
    const extract: ExtractFn = async () => [];
    const session = initTalkSession();
    const result = await processTurn(session, "not sure", { extract, ask: askFieldLabel });
    expect(result.session.transcript).toEqual([
      { role: "clinician", text: "not sure" },
      { role: "talker", text: FORM_3500_FIELDS[0].label },
    ]);
  });

  it("does not mutate the input session", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "42" },
    ];
    const session = initTalkSession();
    await processTurn(session, "I'm 42", { extract, ask: askFieldLabel });
    expect(session.transcript).toEqual([]);
    expect(session.record[FIELD_A]).toEqual({ state: "unasked" });
  });

  it("ask sees the record already updated with this turn's extraction — never a stale record", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "42" },
    ];
    const ask = vi.fn(askFieldLabel);
    await processTurn(initTalkSession(), "I'm 42", { extract, ask });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.record[FIELD_A]).toEqual({ state: "answered", value: "42" });
  });

  it("ask sees this turn's clinician message already in the transcript", async () => {
    const extract: ExtractFn = async () => [];
    const ask = vi.fn(askFieldLabel);
    await processTurn(initTalkSession(), "not sure", { extract, ask });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.transcript).toEqual([{ role: "clinician", text: "not sure" }]);
  });

  it("applies every proposed action from a turn, not just the field that was asked about", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "42" },
      { fieldId: FIELD_B, type: "decline" },
    ];
    const session = initTalkSession();
    const result = await processTurn(session, "42, and I'd rather not say the other", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "42" });
    expect(result.session.record[FIELD_B]).toEqual({ state: "declined", value: undefined });
  });

  it("applies proposals in the order extract returned them", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "first" },
      { fieldId: FIELD_A, type: "answer", value: "second" },
    ];
    const result = await processTurn(initTalkSession(), "actually, second", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "second" });
  });

  it("directly overwrites an already-resolved field via answer, no reopen required — an in-conversation correction, not a review-stage edit", async () => {
    const declined = applyAction(initAgenda(), FIELD_A, { type: "decline" });
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "45" },
    ];
    const result = await processTurn(
      { transcript: [], record: declined },
      "actually, it's 45",
      { extract, ask: askFieldLabel },
    );
    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "45" });
  });

  it("throws and leaves the record untouched if any proposed action is invalid — never partially applied", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: FIELD_A, type: "answer", value: "42" },
      { fieldId: "not-a-real-field", type: "answer", value: "x" },
    ];
    const session = initTalkSession();
    await expect(
      processTurn(session, "42 and something bogus", { extract, ask: askFieldLabel }),
    ).rejects.toThrow();
    // Nothing escapes a thrown call: the caller's own session is what
    // matters here, and it was never touched in the first place.
    expect(session.record[FIELD_A]).toEqual({ state: "unasked" });
  });

  it("reports done and lets ask produce a closing message once every field resolves", async () => {
    let record: AgendaRecord = initAgenda();
    for (const field of FORM_3500_FIELDS.slice(0, -1)) {
      record = applyAction(record, field.id, { type: "decline" });
    }
    const lastField = FORM_3500_FIELDS[FORM_3500_FIELDS.length - 1];
    const extract: ExtractFn = async () => [
      { fieldId: lastField.id, type: "decline" },
    ];
    const result = await processTurn({ transcript: [], record }, "no comment", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.done).toBe(true);
    expect(result.reply).toBe("All done, thanks.");
  });
});
