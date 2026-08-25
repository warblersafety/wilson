// No live API calls, no React rendering — same keyless-dev-machine/pure-
// logic practice as narrative-extract.test.ts. The Start surface component
// itself (Issue #42) stays untested directly, same convention as every
// other src/app/wizard component; what's provable without a DOM lives here.
import { describe, expect, it, vi } from "vitest";
import type { NarrativeExtractResult } from "./narrative-extract";
import type { TalkSession } from "./talk";
import {
  MAX_NARRATIVE_LENGTH,
  resolveStartSubmit,
  validateNarrative,
  type NarrativeSubmitFn,
} from "./start-surface";

const EMPTY_RESULT: NarrativeExtractResult = { proposals: [], repeatDecisions: [], rejected: [] };

describe("validateNarrative", () => {
  it("rejects an empty string", () => {
    const result = validateNarrative("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects whitespace-only input", () => {
    const result = validateNarrative("   \n\t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects input over the length bound", () => {
    const result = validateNarrative("a".repeat(MAX_NARRATIVE_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-long");
  });

  it("accepts input exactly at the length bound", () => {
    expect(validateNarrative("a".repeat(MAX_NARRATIVE_LENGTH))).toEqual({ ok: true });
  });

  it("accepts ordinary narrative text", () => {
    expect(validateNarrative("Started amoxicillin, broke out in hives the next day.")).toEqual({ ok: true });
  });
});

describe("resolveStartSubmit", () => {
  it("short-circuits on empty input without calling submit", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const outcome = await resolveStartSubmit("   ", submit);
    expect(outcome.landed).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("short-circuits on overlong input without calling submit", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const outcome = await resolveStartSubmit("a".repeat(MAX_NARRATIVE_LENGTH + 1), submit);
    expect(outcome.landed).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("lands on read-back with a fresh session and the extraction result on success", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const outcome = await resolveStartSubmit("  amoxicillin, hives next day  ", submit);
    expect(outcome.landed).toBe(true);
    if (!outcome.landed) throw new Error("expected landed");
    expect(outcome.handoff.narrative).toBe("amoxicillin, hives next day");
    expect(outcome.handoff.result).toBe(EMPTY_RESULT);
    expect(outcome.handoff.session.transcript).toEqual([]);
  });

  it("passes the trimmed narrative to submit, alongside a fresh session", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    await resolveStartSubmit("  amoxicillin, hives next day  ", submit);
    const [session, narrative] = submit.mock.calls[0] as [TalkSession, string];
    expect(narrative).toBe("amoxicillin, hives next day");
    expect(session.transcript).toEqual([]);
  });

  it("surfaces the submit failure message without landing", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: false, message: "extraction broke" }));
    const outcome = await resolveStartSubmit("amoxicillin, hives", submit);
    expect(outcome).toEqual({ landed: false, message: "extraction broke" });
  });
});
