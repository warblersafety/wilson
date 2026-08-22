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

const askFieldLabel: AskFn = (field) => (field ? field.label : "All done, thanks.");

describe("initTalkSession", () => {
  it("starts with an empty transcript and a fresh Agenda record", () => {
    const session = initTalkSession();
    expect(session.transcript).toEqual([]);
    expect(session.record).toEqual(initAgenda());
  });
});

describe("startTalk", () => {
  it("asks about the first unasked field without any extraction step", () => {
    const ask = vi.fn(askFieldLabel);
    const session = initTalkSession();
    const result = startTalk(session, { ask });

    expect(ask).toHaveBeenCalledTimes(1);
    const [field, record] = ask.mock.calls[0];
    expect(field?.id).toBe(FIELD_A);
    expect(record).toEqual(session.record);
    expect(result.reply).toBe(FORM_3500_FIELDS[0].label);
    expect(result.done).toBe(false);
  });

  it("appends the opening reply to the transcript as a talker turn", () => {
    const session = initTalkSession();
    const result = startTalk(session, { ask: askFieldLabel });
    expect(result.session.transcript).toEqual([
      { role: "talker", text: FORM_3500_FIELDS[0].label },
    ]);
  });

  it("does not mutate the input session", () => {
    const session = initTalkSession();
    startTalk(session, { ask: askFieldLabel });
    expect(session.transcript).toEqual([]);
  });

  it("reports done when every field is already resolved", () => {
    let record: AgendaRecord = initAgenda();
    for (const field of FORM_3500_FIELDS) {
      record = applyAction(record, field.id, { type: "decline" });
    }
    const result = startTalk({ transcript: [], record }, { ask: askFieldLabel });
    expect(result.done).toBe(true);
    expect(result.reply).toBe("All done, thanks.");
  });
});

describe("processTurn", () => {
  it("applies a single extracted answer, then asks about the next field", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "42" },
    ];
    const session = initTalkSession();
    const result = processTurn(session, "I'm 42", { extract, ask: askFieldLabel });

    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "42" });
    expect(result.reply).toBe(FORM_3500_FIELDS[1].label);
    expect(result.done).toBe(false);
  });

  it("appends both the clinician's message and the reply to the transcript", () => {
    const extract: ExtractFn = () => [];
    const session = initTalkSession();
    const result = processTurn(session, "not sure", { extract, ask: askFieldLabel });
    expect(result.session.transcript).toEqual([
      { role: "clinician", text: "not sure" },
      { role: "talker", text: FORM_3500_FIELDS[0].label },
    ]);
  });

  it("does not mutate the input session", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "42" },
    ];
    const session = initTalkSession();
    processTurn(session, "I'm 42", { extract, ask: askFieldLabel });
    expect(session.transcript).toEqual([]);
    expect(session.record[FIELD_A]).toEqual({ state: "unasked" });
  });

  it("ask sees the record already updated with this turn's extraction — never a stale record", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "42" },
    ];
    const ask = vi.fn(askFieldLabel);
    processTurn(initTalkSession(), "I'm 42", { extract, ask });

    const [, recordSeenByAsk] = ask.mock.calls[0];
    expect(recordSeenByAsk[FIELD_A]).toEqual({ state: "answered", value: "42" });
  });

  it("applies every proposed action from a turn, not just the field that was asked about", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "42" },
      { fieldId: FIELD_B, action: { type: "decline" } },
    ];
    const session = initTalkSession();
    const result = processTurn(session, "42, and I'd rather not say the other", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "42" });
    expect(result.session.record[FIELD_B]).toEqual({ state: "declined", value: undefined });
  });

  it("applies proposals in the order extract returned them", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "first" },
      { fieldId: FIELD_A, action: { type: "answer" }, value: "second" },
    ];
    const result = processTurn(initTalkSession(), "actually, second", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.session.record[FIELD_A]).toEqual({ state: "answered", value: "second" });
  });

  it("throws and leaves the record untouched if any proposed action is invalid — never partially applied", () => {
    const extract: ExtractFn = () => [
      { fieldId: FIELD_A, action: { type: "answer" }, value: "42" },
      { fieldId: "not-a-real-field", action: { type: "answer" }, value: "x" },
    ];
    const session = initTalkSession();
    expect(() =>
      processTurn(session, "42 and something bogus", { extract, ask: askFieldLabel }),
    ).toThrow();
    // Nothing escapes a thrown call: the caller's own session is what
    // matters here, and it was never touched in the first place.
    expect(session.record[FIELD_A]).toEqual({ state: "unasked" });
  });

  it("throws when an extracted answer carries no value, same as applyAction", () => {
    const extract: ExtractFn = () => [{ fieldId: FIELD_A, action: { type: "answer" } }];
    expect(() =>
      processTurn(initTalkSession(), "I dunno", { extract, ask: askFieldLabel }),
    ).toThrow();
  });

  it("reports done and lets ask produce a closing message once every field resolves", () => {
    let record: AgendaRecord = initAgenda();
    for (const field of FORM_3500_FIELDS.slice(0, -1)) {
      record = applyAction(record, field.id, { type: "decline" });
    }
    const lastField = FORM_3500_FIELDS[FORM_3500_FIELDS.length - 1];
    const extract: ExtractFn = () => [
      { fieldId: lastField.id, action: { type: "decline" } },
    ];
    const result = processTurn({ transcript: [], record }, "no comment", {
      extract,
      ask: askFieldLabel,
    });
    expect(result.done).toBe(true);
    expect(result.reply).toBe("All done, thanks.");
  });
});
