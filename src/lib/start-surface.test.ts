// No live API calls, no React rendering — same keyless-dev-machine/pure-
// logic practice as narrative-extract.test.ts. The Start surface component
// itself (Issue #42) stays untested directly, same convention as every
// other src/app/wizard component; what's provable without a DOM lives here.
import { describe, expect, it, vi } from "vitest";
import { friendlyFailureMessage } from "./chip-grammar";
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

  it("surfaces a submit failure without landing, in friendly copy", async () => {
    // Issue #42 asserted the raw message was passed through verbatim.
    // That is the behaviour #63 filed against — see the failure-kinds
    // block below for why it changed and what replaced it. The property
    // this case still holds is the one #42 cared about: a failed submit
    // never lands, and the clinician is told something.
    const submit = vi.fn<NarrativeSubmitFn>(async () => ({ ok: false, message: "extraction broke" }));
    const outcome = await resolveStartSubmit("amoxicillin, hives", initTalkSession(), submit);
    expect(outcome.landed).toBe(false);
    if (outcome.landed) throw new Error("expected a failure");
    expect(outcome.message.length).toBeGreaterThan(0);
    expect(outcome.message).not.toContain("extraction broke");
  });
});

describe("failure kinds (Issue #73, closes #63)", () => {
  // #44 shipped the friendly-copy-with-retry standard but scoped it to its
  // own surface; Start and Read-back still rendered whatever the server
  // action threw — an SDK error string, straight to a clinician.
  //
  // The trap this avoids: resolveStartSubmit carries TWO kinds of failure
  // through one channel. Wilson's own validation copy is specific and
  // actionable ("that's too long, here's the limit"); the server's is a
  // raw exception. Wrapping both in friendlyFailureMessage would replace
  // a genuinely useful message with a generic one — so the two are
  // distinguished, not blanket-wrapped.
  const session = initTalkSession();

  it("passes wilson's own validation copy through verbatim, and marks it not-retryable", async () => {
    const tooLong = "x".repeat(MAX_NARRATIVE_LENGTH + 1);
    const outcome = await resolveStartSubmit(tooLong, session, async () => {
      throw new Error("submit should never be called for invalid input");
    });
    expect(outcome.landed).toBe(false);
    if (outcome.landed) throw new Error("expected a failure");
    expect(outcome.reason).toBe("invalid");
    const validation = validateNarrative(tooLong);
    if (validation.ok) throw new Error("expected the over-length narrative to be rejected");
    expect(outcome.message).toBe(validation.message);
    // Specific and actionable, not swapped for the generic line.
    expect(outcome.message).not.toBe(friendlyFailureMessage("anything"));
  });

  it("replaces a raw server error with friendly copy, and marks it retryable", async () => {
    const outcome = await resolveStartSubmit("a real narrative about a rash", session, async () => ({
      ok: false as const,
      message: "AnthropicError: 429 rate_limit_error request_id=req_abc123",
    }));
    expect(outcome.landed).toBe(false);
    if (outcome.landed) throw new Error("expected a failure");
    expect(outcome.reason).toBe("failed");
    expect(outcome.message).toBe(friendlyFailureMessage("AnthropicError: 429"));
    // The whole point: nothing from the raw error reaches the clinician.
    expect(outcome.message).not.toContain("Anthropic");
    expect(outcome.message).not.toContain("429");
    expect(outcome.message).not.toContain("req_abc123");
  });

  it("still lands on success", async () => {
    const outcome = await resolveStartSubmit("a real narrative about a rash", session, async () => ({
      ok: true as const,
      result: { proposals: [], repeatDecisions: [], rejected: [] },
    }));
    expect(outcome.landed).toBe(true);
  });
});
