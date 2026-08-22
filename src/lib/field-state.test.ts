import { describe, expect, it } from "vitest";
import { isResolved, transition, type FieldState } from "./field-state";

describe("transition", () => {
  it("moves an unasked field to answered", () => {
    expect(transition("unasked", { type: "answer" })).toBe("answered");
  });

  it("moves an unasked field to unknown when the clinician doesn't have the info", () => {
    expect(transition("unasked", { type: "mark_unknown" })).toBe("unknown");
  });

  it("moves an unasked field to declined", () => {
    expect(transition("unasked", { type: "decline" })).toBe("declined");
  });

  it("reopens an answered field back to unasked for a review-stage edit", () => {
    expect(transition("answered", { type: "reopen" })).toBe("unasked");
  });
});

describe("isResolved", () => {
  it("is true for every state except unasked", () => {
    const resolved: FieldState[] = ["answered", "unknown", "declined"];
    for (const state of resolved) {
      expect(isResolved(state)).toBe(true);
    }
    expect(isResolved("unasked")).toBe(false);
  });
});
