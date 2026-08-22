import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, nextField } from "./agenda";
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

  it("reopens an answered field back to unasked and clears its value", () => {
    const answered = applyAction(initAgenda(), id, { type: "answer" }, "42");
    const next = applyAction(answered, id, { type: "reopen" });
    expect(next[id]).toEqual({ state: "unasked", value: undefined });
  });

  it("throws for an unknown field id", () => {
    const record = initAgenda();
    expect(() =>
      applyAction(record, "not-a-real-id", { type: "answer" }, "x"),
    ).toThrow();
  });
});

describe("nextField", () => {
  it("returns the first unasked field in section order", () => {
    const field = nextField(initAgenda());
    expect(field?.section).toBe("A");
  });

  it("skips answered, unknown, and declined fields", () => {
    const first = nextField(initAgenda())!;
    const record = applyAction(initAgenda(), first.id, { type: "answer" }, "x");
    const second = nextField(record);
    expect(second?.id).not.toBe(first.id);
  });

  it("returns null once every field is resolved", () => {
    let record = initAgenda();
    for (const field of FORM_3500_FIELDS) {
      record = applyAction(record, field.id, { type: "decline" });
    }
    expect(nextField(record)).toBeNull();
  });

  it("moves to the next section once the current section is fully resolved", () => {
    let record = initAgenda();
    for (const field of FORM_3500_FIELDS) {
      if (field.section === "A") {
        record = applyAction(record, field.id, { type: "decline" });
      }
    }
    const field = nextField(record);
    expect(field).not.toBeNull();
    expect(field?.section).not.toBe("A");
  });
});
