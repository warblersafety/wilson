// No live API calls, no React rendering — same keyless-dev-machine/pure-
// logic practice as narrative-extract.test.ts. The Start surface component
// itself (Issue #42) stays untested directly, same convention as every
// other src/app/wizard component; what's provable without a DOM lives here.
import { describe, expect, it, vi } from "vitest";
import type { NarrativeExtractResult } from "./narrative-extract";
import { initTalkSession, type TalkSession } from "./talk";
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
    expect(validateNarrative("a".repeat(MAX_NARRATIVE_LENGTH))).toEqual({
      ok: true,
      trimmed: "a".repeat(MAX_NARRATIVE_LENGTH),
    });
  });

  it("accepts ordinary narrative text and returns it trimmed", () => {
    expect(validateNarrative("  Started amoxicillin, broke out in hives the next day.  ")).toEqual({
      ok: true,
      trimmed: "Started amoxicillin, broke out in hives the next day.",
    });
  });
});

describe("resolveStartSubmit", () => {
  it("short-circuits on empty input without calling submit", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const outcome = await resolveStartSubmit("   ", initTalkSession(), submit);
    expect(outcome.landed).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("short-circuits on overlong input without calling submit", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const outcome = await resolveStartSubmit("a".repeat(MAX_NARRATIVE_LENGTH + 1), initTalkSession(), submit);
    expect(outcome.landed).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("lands on read-back with the given session and the extraction result on success", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    const session = initTalkSession();
    const outcome = await resolveStartSubmit("  amoxicillin, hives next day  ", session, submit);
    expect(outcome.landed).toBe(true);
    if (!outcome.landed) throw new Error("expected landed");
    expect(outcome.handoff.narrative).toBe("amoxicillin, hives next day");
    expect(outcome.handoff.result).toBe(EMPTY_RESULT);
    expect(outcome.handoff.session).toBe(session);
  });

  it("passes the trimmed narrative and the caller's own session through to submit, unmodified", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: true, result: EMPTY_RESULT }));
    // A session with a non-empty transcript, distinct from initTalkSession()'s
    // default — proves resolveStartSubmit threads through whatever session
    // its caller hands it rather than manufacturing its own (reviewer pass,
    // finding: this used to call initTalkSession() internally, which this
    // test couldn't have distinguished from "ignores the caller entirely").
    const callerSession: TalkSession = {
      transcript: [{ role: "clinician", text: "prior turn" }],
      record: initTalkSession().record,
      repeatCounts: {},
    };
    await resolveStartSubmit("  amoxicillin, hives next day  ", callerSession, submit);
    const [session, narrative] = submit.mock.calls[0] as [TalkSession, string];
    expect(narrative).toBe("amoxicillin, hives next day");
    expect(session).toBe(callerSession);
  });

  it("surfaces the submit failure message without landing", async () => {
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: false, message: "extraction broke" }));
    const outcome = await resolveStartSubmit("amoxicillin, hives", initTalkSession(), submit);
    expect(outcome).toEqual({ landed: false, message: "extraction broke" });
  });
});
