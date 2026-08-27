// No live API calls in this file — a real Anthropic() client needs no key
// to construct, and its .messages.parse() is spied/stubbed on every test,
// matching lucy's keyless-dev-machine practice (docs/SECRETS-AND-COSTS.md).
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionResponse } from "../prompts/extractor";
import { createExtractFn } from "./extract";
import type { FormFieldSpec } from "./form-3500-fields";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { initRepeatCounts, setRepeatCount, type Topic } from "./topics";
import type { TalkSession } from "./talk";
import { syntheticTopic } from "./synthetic-topic";

function field(id: string, type: FormFieldSpec["type"]): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label: id, type, required: false };
}

const FIELD_A = field("a", "text");
const FIELD_B = field("b", "text");
const FIELDS = [FIELD_A, FIELD_B];

const TOPIC: Topic = syntheticTopic({
  id: "t1",
  section: "A",
  label: "Topic 1",
  fieldIds: ["a", "b"],
  repeatGroup: null,
  repeatInstance: null,
});

const REPEAT_TOPIC_1: Topic = syntheticTopic({
  id: "g1",
  section: "D",
  label: "Group instance 1",
  fieldIds: ["a"],
  repeatGroup: "suspect-product",
  repeatInstance: 1,
});
const REPEAT_TOPIC_2: Topic = syntheticTopic({
  id: "g2",
  section: "D",
  label: "Group instance 2",
  fieldIds: ["b"],
  repeatGroup: "suspect-product",
  repeatInstance: 2,
});

function unaskedRecordFor(fieldIds: string[]): AgendaRecord {
  const record: AgendaRecord = {};
  for (const id of fieldIds) record[id] = { state: "unasked" };
  return record;
}

function sessionWith(overrides: Partial<TalkSession> = {}): TalkSession {
  return {
    transcript: [{ role: "talker", text: "Anything to add?" }],
    record: unaskedRecordFor(["a", "b"]),
    repeatCounts: initRepeatCounts(),
    ...overrides,
  };
}

function fakeParsedResponse(parsed_output: ExtractionResponse | null) {
  return { parsed_output } as Awaited<ReturnType<Anthropic["messages"]["parse"]>>;
}

// REPEAT_TOPIC_1's field resolved (declined) and REPEAT_TOPIC_2 not yet
// decided — nextStep() over [REPEAT_TOPIC_1, REPEAT_TOPIC_2] resolves to
// an actual {kind: "repeat-decision"} step here, not a "topic" step. A
// repeatDecision-carrying fixture must be exercised against a session that
// really reaches this step, or the test would pass for the wrong reason —
// exactly the gap the CONFIRMED review finding on this PR was about.
function repeatDecisionSession(): TalkSession {
  const record = applyAction(unaskedRecordFor(["a", "b"]), "a", { type: "decline" });
  return {
    transcript: [{ role: "talker", text: "Was there another suspect product?" }],
    record,
    repeatCounts: initRepeatCounts(),
  };
}

describe("createExtractFn", () => {
  let client: Anthropic;

  beforeEach(() => {
    client = new Anthropic({ apiKey: "test-key-not-real" });
  });

  it("accepts a field candidate whose quote is real, and returns it as a ProposedAction", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42 years old" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const session = sessionWith();
    const result = await extract(session, "42 years old");
    expect(result.actions).toEqual([{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.repeatDecision).toBeUndefined();
  });

  it("drops a field candidate whose quote is not a real substring of the clinician's message", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "fifty years old" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42 years old");
    expect(result.actions).toEqual([]);
  });

  it("drops a candidate targeting a field id outside the given fields list", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "not-real", kind: "value", value: "x", quote: { turnIndex: 1, text: "42" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result.actions).toEqual([]);
  });

  it("returns a repeatDecision when the model proposes one grounded in a real quote, during an actual repeat-decision step", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecision: {
          repeatGroup: "suspect-product",
          count: 2,
          quote: { turnIndex: 1, text: "yes, a second one" },
        },
      }),
    );
    const extract = createExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_A, FIELD_B]);
    const result = await extract(repeatDecisionSession(), "yes, a second one");
    expect(result.repeatDecision).toEqual({ repeatGroup: "suspect-product", count: 2 });
  });

  it("drops a repeatDecision whose quote is not real, during an actual repeat-decision step", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecision: {
          repeatGroup: "suspect-product",
          count: 2,
          quote: { turnIndex: 1, text: "a sentence never said" },
        },
      }),
    );
    const extract = createExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_A, FIELD_B]);
    const result = await extract(repeatDecisionSession(), "no, that's the only one");
    expect(result.repeatDecision).toBeUndefined();
  });

  it("drops a repeatDecision proposed during an ordinary topic step, even with a real quote — the model cannot commit a repeat count outside a repeat-decision turn", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } }],
        repeatDecision: {
          repeatGroup: "suspect-product",
          count: 2,
          quote: { turnIndex: 1, text: "42" },
        },
      }),
    );
    // TOPIC is an ordinary (non-repeat) ["a", "b"] topic — the step this
    // extract() call is actually answering is {kind: "topic"}, never
    // {kind: "repeat-decision"}.
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result.actions).toEqual([{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.repeatDecision).toBeUndefined();
  });

  it("drops a repeatDecision naming a different repeat group than the one actually open", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecision: {
          repeatGroup: "concomitant-medication",
          count: 2,
          quote: { turnIndex: 1, text: "yes, a second one" },
        },
      }),
    );
    const extract = createExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_A, FIELD_B]);
    const result = await extract(repeatDecisionSession(), "yes, a second one");
    expect(result.repeatDecision).toBeUndefined();
  });

  it("fails closed (no actions, no repeatDecision) when structured output parsing fails", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(fakeParsedResponse(null));
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result).toEqual({ actions: [] });
  });

  it("short-circuits with no model call once every topic is already resolved", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse");
    const record = initAgenda();
    const resolvedRecord: AgendaRecord = {};
    for (const [id] of Object.entries(record)) resolvedRecord[id] = { state: "declined" };
    // Every repeat group's count must also be decided (at its minimum), or
    // nextStep() stops at an unresolved "repeat-decision" step for
    // instance 2+ before ever reaching "done" — same walk order
    // topics.test.ts documents.
    let repeatCounts = initRepeatCounts();
    repeatCounts = setRepeatCount(repeatCounts, "suspect-product", 1);
    repeatCounts = setRepeatCount(repeatCounts, "concomitant-medication", 1);
    const extract = createExtractFn(client);
    const result = await extract(sessionWith({ record: resolvedRecord, repeatCounts }), "nothing more");
    expect(result).toEqual({ actions: [] });
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("includes the clinician's latest message in the transcript passed to grounding, at the correct index", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({ candidates: [], repeatDecision: null }),
    );
    const session = sessionWith(); // one prior turn, index 0
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    await extract(session, "the new message");
    const call = parseSpy.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).toContain("[1] CLINICIAN: the new message");
  });

  // ---------------------------------------------------------------------
  // Issue #44's widened per-turn sweep — the same createExtractFn(), now
  // extracting against the open field set rather than just the current
  // ask, with write policy delegated to classifyFollowUpActions() and the
  // reply prefix to describeFollowUpSweep() (both proven independently,
  // API-free, in followup-sweep.test.ts). These tests prove the WIRING:
  // that extract.ts actually calls them with the right inputs.
  // ---------------------------------------------------------------------
  describe("widened follow-up sweep (Issue #44)", () => {
    it("accepts a checkbox/enum candidate — the old ['text','date'] default no longer applies", async () => {
      const checkboxField = field("cb", "checkbox");
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "cb", kind: "value", value: "true", quote: { turnIndex: 1, text: "hospitalized overnight" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [TOPIC], [FIELD_A, FIELD_B, checkboxField]);
      const session = sessionWith({ record: { a: { state: "unasked" }, b: { state: "unasked" }, cb: { state: "unasked" } } });
      const result = await extract(session, "hospitalized overnight");
      expect(result.actions).toEqual([{ fieldId: "cb", type: "answer", value: "true" }]);
    });

    it("writes an unasked field OUTSIDE the current ask and names it in replyPrefix — no invisible write", async () => {
      const outOfAsk = field("c", "text");
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "c", kind: "value", value: "lisinopril", quote: { turnIndex: 1, text: "lisinopril" } }],
          repeatDecision: null,
        }),
      );
      // TOPIC only asks about "a"/"b" — "c" belongs to a different topic
      // entirely but is still `unasked`, so it's in the open set.
      const extract = createExtractFn(client, [TOPIC], [FIELD_A, FIELD_B, outOfAsk]);
      const session = sessionWith({ record: { a: { state: "unasked" }, b: { state: "unasked" }, c: { state: "unasked" } } });
      const result = await extract(session, "also, lisinopril");
      expect(result.actions).toEqual([{ fieldId: "c", type: "answer", value: "lisinopril" }]);
      expect(result.replyPrefix).toContain("lisinopril");
    });

    it("turns a candidate for an already-answered field into a correctionOffer, never a direct write", async () => {
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "a", kind: "value", value: "45", quote: { turnIndex: 1, text: "actually, make that 45" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [TOPIC], FIELDS);
      const session = sessionWith({ record: { a: { state: "answered", value: "42" }, b: { state: "unasked" } } });
      const result = await extract(session, "actually, make that 45");
      expect(result.actions).toEqual([]);
      expect(result.correctionOffers).toEqual([
        { fieldId: "a", action: { fieldId: "a", type: "answer", value: "45" }, currentState: "answered", currentValue: "42" },
      ]);
      expect(result.replyPrefix).toContain("45");
    });

    it("a candidate for a repeat-instance-2+ field writes nothing and is recorded as a volunteered group", async () => {
      // REPEAT_TOPIC_1/REPEAT_TOPIC_2 (module-level, above) are instance
      // 1/2 of "suspect-product", over fields "a"/"b" respectively — "b"
      // is `unasked` (instance 1 not yet decided), so it's in the open
      // set, but it belongs to a later instance the sweep must never
      // attribute a direct write to.
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "b", kind: "value", value: "lisinopril", quote: { turnIndex: 1, text: "lisinopril" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_A, FIELD_B]);
      const session = sessionWith({ record: { a: { state: "unasked" }, b: { state: "unasked" } } });
      const result = await extract(session, "she's also on lisinopril");
      expect(result.actions).toEqual([]);
      expect(result.volunteeredRepeatGroups).toEqual(["suspect-product"]);
    });

    it("rejects a candidate citing an earlier turn than the current one — never written, never offered", async () => {
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "b", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [TOPIC], FIELDS);
      // Two prior turns already in the transcript — the candidate above
      // cites turnIndex 1 (the FIRST clinician turn), but the current
      // message will land at index 3.
      const session: TalkSession = {
        transcript: [
          { role: "talker", text: "first question" },
          { role: "clinician", text: "42" },
          { role: "talker", text: "second question" },
        ],
        record: unaskedRecordFor(["a", "b"]),
        repeatCounts: initRepeatCounts(),
      };
      const result = await extract(session, "no comment on that");
      expect(result.actions).toEqual([]);
      expect(result.correctionOffers).toBeUndefined();
    });

    it("collapses two candidates for the same field into a collision — writes neither, reply asks which", async () => {
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [
            { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } },
            { fieldId: "a", kind: "value", value: "45", quote: { turnIndex: 1, text: "45" } },
          ],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [TOPIC], FIELDS);
      const result = await extract(sessionWith(), "42, or was it 45");
      expect(result.actions).toEqual([]);
      expect(result.replyPrefix?.toLowerCase()).toContain("which");
    });

    it("flags a field as out-of-ask when the ask never named it — no invisible write", async () => {
      // A topic whose authored ask waits on three of its four fields; the
      // fourth is a derive companion (ask-copy.md rule 2 — an age unit,
      // a weight unit, a stated-only country). A candidate for that
      // fourth field must still count as out-of-ask and be named in the
      // reply, or "no invisible write" breaks for exactly the fields the
      // clinician was never asked about.
      const wideTopic: Topic = {
        id: "wide",
        section: "A",
        label: "Wide topic",
        fieldIds: ["a", "b", "c", "d"],
        repeatGroup: null,
        repeatInstance: null,
        asks: [
          {
            id: "wide-ask",
            topicId: "wide",
            copy: "synthetic ask for wide",
            askFieldIds: ["a", "b", "c"],
            companionFieldIds: ["d"],
          },
        ],
      };
      const fields = [field("a", "text"), field("b", "text"), field("c", "text"), field("d", "text")];
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "d", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [wideTopic], fields);
      const session = sessionWith({
        record: { a: { state: "unasked" }, b: { state: "unasked" }, c: { state: "unasked" }, d: { state: "unasked" } },
      });
      const result = await extract(session, "and also, 42 for the fourth thing");
      expect(result.actions).toEqual([{ fieldId: "d", type: "answer", value: "42" }]);
      expect(result.replyPrefix).toContain("42");
    });

    // ask-copy.md rule 3's derives reach the record through the same
    // single write path everything else does — proved end to end here,
    // not just in derive.test.ts's pure unit.
    it("completes a checkbox group the clinician just answered, through the real turn", async () => {
      const { TOPICS: realTopics } = await import("./topics");
      const { FORM_3500_FIELDS: realFields } = await import("./form-3500-fields");
      const { initAgenda } = await import("./agenda");
      const HOSPITAL = "Page1.SecA_Patient.Hospital";
      const DEATH = "Page1.SecA_Patient.Death";
      // Park the walk on OC-1 by resolving everything before it.
      let record = initAgenda();
      const { applyAction } = await import("./agenda");
      for (const topic of realTopics) {
        if (topic.id === "event-outcome") break;
        for (const id of topic.fieldIds) record = applyAction(record, id, { type: "decline" });
      }
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [
            { fieldId: HOSPITAL, kind: "value", value: "true", quote: { turnIndex: 1, text: "she was hospitalised" } },
          ],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, realTopics, realFields);
      const session = sessionWith({ record, transcript: [{ role: "talker", text: "How serious was the outcome?" }] });
      const result = await extract(session, "she was hospitalised");

      expect(result.actions).toContainEqual({ fieldId: HOSPITAL, type: "answer", value: "true" });
      // The other six boxes OC-1 voiced, written false — including death,
      // which is exactly why rule 7 bounds this to a voiced ask.
      expect(result.actions).toContainEqual({ fieldId: DEATH, type: "answer", value: "false" });
      expect(result.actions).toHaveLength(7);
      // And the companions are not announced back at the clinician: they
      // are the same fact, written where the form keeps it.
      expect(result.replyPrefix ?? "").not.toContain("death");
    });

    it("passes the full field manifest (not just openFields) to validateCandidates, via the ALL_FIELD_TYPES default", async () => {
      // A candidate for "c" (not part of TOPIC's fields, and not in the
      // open set either — already answered) must still be checked against
      // the real manifest, not silently dropped as unknown_field, since a
      // correction to an answered field is exactly what this validates.
      const answeredField = field("c", "text");
      vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({
          candidates: [{ fieldId: "c", kind: "value", value: "new value", quote: { turnIndex: 1, text: "new value" } }],
          repeatDecision: null,
        }),
      );
      const extract = createExtractFn(client, [TOPIC], [FIELD_A, FIELD_B, answeredField]);
      const session = sessionWith({
        record: { a: { state: "unasked" }, b: { state: "unasked" }, c: { state: "answered", value: "old value" } },
      });
      const result = await extract(session, "new value");
      expect(result.correctionOffers).toEqual([
        { fieldId: "c", action: { fieldId: "c", type: "answer", value: "new value" }, currentState: "answered", currentValue: "old value" },
      ]);
    });

    it("uses the widened (full-manifest) system prompt, not the narrow EXTRACTOR_SYSTEM", async () => {
      const parseSpy = vi.spyOn(client.messages, "parse").mockResolvedValue(
        fakeParsedResponse({ candidates: [], repeatDecision: null }),
      );
      const extract = createExtractFn(client, [TOPIC], FIELDS);
      await extract(sessionWith(), "hello");
      const call = parseSpy.mock.calls[0][0] as { system: Array<{ text: string; cache_control?: unknown }> };
      expect(call.system[0].text).toContain("## Full field manifest");
      expect(call.system[0].text).toContain("a (text)");
      expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
    });
  });
});
