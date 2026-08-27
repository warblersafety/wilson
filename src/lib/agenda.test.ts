import { describe, expect, it } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import { FORM_3500_FIELDS } from "./form-3500-fields";

describe("initAgenda", () => {
  it("covers every field from the manifest, all unasked", () => {
    const record = initAgenda();
    const ids = FORM_3500_FIELDS.map((f) => f.id).sort();
    expect(Object.keys(record).sort()).toEqual(ids);
    for (const id of ids) {
      expect(record[id]).toEqual({ state: "unasked" });
    }
  });
});

describe("applyAction", () => {
  const id = FORM_3500_FIELDS[0].id;

  it("answers a field and sets its value", () => {
    const record = initAgenda();
    const next = applyAction(record, id, { type: "answer" }, "42");
    expect(next[id]).toEqual({ state: "answered", value: "42" });
  });

  it("does not mutate the input record", () => {
    const record = initAgenda();
    applyAction(record, id, { type: "answer" }, "42");
    expect(record[id]).toEqual({ state: "unasked" });
  });

  it("marks a field unknown and clears any value", () => {
    const answered = applyAction(initAgenda(), id, { type: "answer" }, "42");
    const next = applyAction(answered, id, { type: "mark_unknown" });
    expect(next[id]).toEqual({ state: "unknown", value: undefined });
  });

  it("declines a field and clears any value", () => {
    const answered = applyAction(initAgenda(), id, { type: "answer" }, "42");
    const next = applyAction(answered, id, { type: "decline" });
    expect(next[id]).toEqual({ state: "declined", value: undefined });
  });

  // Issue #44's reopen semantics (design.md: "reopen never wipes"):
  // superseded from an earlier version of this test that asserted the
  // opposite (value cleared on reopen) — reopening is the review-stage
  // re-ask path, and a clinician who reopens a topic but doesn't get
  // around to re-answering one of its fields this turn must not lose the
  // value they already gave. The value is only ever replaced by a new
  // "answer" action, never blanked by reopen itself.
  it("reopens an answered field back to unasked but RETAINS its prior value until a replacement is written", () => {
    const answered = applyAction(initAgenda(), id, { type: "answer" }, "42");
    const next = applyAction(answered, id, { type: "reopen" });
    expect(next[id]).toEqual({ state: "unasked", value: "42" });
  });

  it("reopening then re-answering replaces the retained value, not appends to it", () => {
    const answered = applyAction(initAgenda(), id, { type: "answer" }, "42");
    const reopened = applyAction(answered, id, { type: "reopen" });
    const reanswered = applyAction(reopened, id, { type: "answer" }, "45");
    expect(reanswered[id]).toEqual({ state: "answered", value: "45" });
  });

  it("reopening a field with no prior value (never answered) stays valueless", () => {
    const next = applyAction(initAgenda(), id, { type: "reopen" });
    expect(next[id]).toEqual({ state: "unasked", value: undefined });
  });

  it("throws for an unknown field id", () => {
    const record = initAgenda();
    expect(() =>
      applyAction(record, "not-a-real-id", { type: "answer" }, "x"),
    ).toThrow();
  });

  it("throws for a field id that only resolves via the prototype chain", () => {
    const record = initAgenda();
    expect(() =>
      applyAction(record, "constructor", { type: "answer" }, "x"),
    ).toThrow();
  });

  it("throws when answering without a non-empty value", () => {
    const record = initAgenda();
    expect(() => applyAction(record, id, { type: "answer" })).toThrow();
    expect(() => applyAction(record, id, { type: "answer" }, "")).toThrow();
  });
});
