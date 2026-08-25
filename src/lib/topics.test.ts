import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, FORM_3500_SECTIONS, type FormSection } from "./form-3500-fields";
import {
  TOPICS,
  initRepeatCounts,
  isValidRepeatCount,
  narrativePassFields,
  nextStep,
  reopenTopic,
  setRepeatCount,
  topicStatuses,
} from "./topics";

const SECTION_ORDER = Object.keys(FORM_3500_SECTIONS) as FormSection[];

describe("TOPICS", () => {
  it("has 34 topics", () => {
    expect(TOPICS).toHaveLength(34);
  });

  it("covers every field from the manifest, no field missing, none duplicated", () => {
    const allFieldIds = TOPICS.flatMap((t) => t.fieldIds);
    expect(allFieldIds.sort()).toEqual(FORM_3500_FIELDS.map((f) => f.id).sort());
    expect(new Set(allFieldIds).size).toBe(allFieldIds.length);
  });

  it("references only real field ids", () => {
    const realIds = new Set(FORM_3500_FIELDS.map((f) => f.id));
    for (const topic of TOPICS) {
      for (const fieldId of topic.fieldIds) {
        expect(realIds.has(fieldId)).toBe(true);
      }
    }
  });

  it("gives every topic a non-empty id and label", () => {
    for (const topic of TOPICS) {
      expect(topic.id.trim().length).toBeGreaterThan(0);
      expect(topic.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate topic ids", () => {
    const ids = TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every topic at least one field", () => {
    for (const topic of TOPICS) {
      expect(topic.fieldIds.length).toBeGreaterThan(0);
    }
  });

  it("matches every field's actual manifest section to its containing topic's section", () => {
    const fieldsById = new Map(FORM_3500_FIELDS.map((f) => [f.id, f]));
    for (const topic of TOPICS) {
      for (const fieldId of topic.fieldIds) {
        expect(fieldsById.get(fieldId)?.section).toBe(topic.section);
      }
    }
  });

  it("orders each topic's fieldIds the same way FORM_3500_FIELDS itself does", () => {
    const manifestOrder = new Map(FORM_3500_FIELDS.map((f, i) => [f.id, i]));
    for (const topic of TOPICS) {
      const indices = topic.fieldIds.map((id) => manifestOrder.get(id)!);
      const sorted = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sorted);
    }
  });

  it("orders topics section by section, A through G", () => {
    const topicSectionOrder = TOPICS.map((t) => SECTION_ORDER.indexOf(t.section));
    const sorted = [...topicSectionOrder].sort((a, b) => a - b);
    expect(topicSectionOrder).toEqual(sorted);
  });

  it("sets repeatGroup and repeatInstance together — never one without the other", () => {
    for (const topic of TOPICS) {
      if (topic.repeatGroup === null) {
        expect(topic.repeatInstance).toBeNull();
      } else {
        expect(topic.repeatInstance).not.toBeNull();
      }
    }
  });

  it("gives every repeat group contiguous instance numbers starting at 1, per distinct topic-id family", () => {
    // A "family" is the topic id with its instance number's own segment
    // removed — e.g. "suspect-product-1-identity" and
    // "suspect-product-2-identity" are the same family at instances 1
    // and 2; "concomitant-medication-N" is its own single-topic family
    // per instance.
    const byFamily = new Map<string, number[]>();
    for (const topic of TOPICS) {
      if (topic.repeatGroup === null || topic.repeatInstance === null) continue;
      const family =
        topic.repeatGroup === "concomitant-medication"
          ? "concomitant-medication"
          : topic.id.replace(`-${topic.repeatInstance}-`, "-N-");
      const instances = byFamily.get(family) ?? [];
      instances.push(topic.repeatInstance);
      byFamily.set(family, instances);
    }
    expect(byFamily.size).toBeGreaterThan(0);
    for (const [, instances] of byFamily) {
      const sorted = [...instances].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: sorted.length }, (_, i) => i + 1));
    }
  });

  it("has exactly two suspect-product instances and ten concomitant-medication instances", () => {
    const suspectProductInstances = new Set(
      TOPICS.filter((t) => t.repeatGroup === "suspect-product").map((t) => t.repeatInstance),
    );
    const concomitantInstances = new Set(
      TOPICS.filter((t) => t.repeatGroup === "concomitant-medication").map((t) => t.repeatInstance),
    );
    expect(suspectProductInstances).toEqual(new Set([1, 2]));
    expect(concomitantInstances).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });
});

// ---------------------------------------------------------------------------
// setRepeatCount — real TOPICS, since RepeatGroup is already a fixed
// two-value union tied to it; no benefit to parameterizing for isolation.
// ---------------------------------------------------------------------------

describe("setRepeatCount", () => {
  it("records a valid count", () => {
    const counts = setRepeatCount(initRepeatCounts(), "suspect-product", 1);
    expect(counts).toEqual({ "suspect-product": 1 });
  });

  it("does not mutate the input counts", () => {
    const counts = initRepeatCounts();
    setRepeatCount(counts, "suspect-product", 1);
    expect(counts).toEqual({});
  });

  it("rejects a count below 1", () => {
    expect(() => setRepeatCount(initRepeatCounts(), "suspect-product", 0)).toThrow();
  });

  it("rejects a count above the group's real max instance count", () => {
    // suspect-product's real max is 2 (Issue #16)
    expect(() => setRepeatCount(initRepeatCounts(), "suspect-product", 3)).toThrow();
  });

  it("accepts the real max for a group with a larger max", () => {
    // concomitant-medication's real max is 10 (Issue #16)
    const counts = setRepeatCount(initRepeatCounts(), "concomitant-medication", 10);
    expect(counts).toEqual({ "concomitant-medication": 10 });
  });

  it("rejects NaN — without this check it would silently bypass both range comparisons", () => {
    expect(() => setRepeatCount(initRepeatCounts(), "suspect-product", NaN)).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() => setRepeatCount(initRepeatCounts(), "suspect-product", 1.5)).toThrow();
  });

  it("throws a clear error, not a -Infinity range, when given a topics list with none of the group's topics", () => {
    expect(() =>
      setRepeatCount(initRepeatCounts(), "suspect-product", 1, [
        { id: "unrelated", section: "A", label: "x", fieldIds: [], repeatGroup: null, repeatInstance: null },
      ]),
    ).toThrow(/no topics/);
  });
});

// Issue #41: a non-throwing sibling for validating a CANDIDATE repeat count
// before deciding whether to accept it — setRepeatCount's own throw is
// right for an actual write attempt (a real system-configuration bug), but
// wrong for "is this proposed count plausible" (an ordinary, expected
// rejection outcome, not a crash).
describe("isValidRepeatCount", () => {
  it("accepts a count within the group's real range", () => {
    expect(isValidRepeatCount("suspect-product", 1)).toBe(true);
    expect(isValidRepeatCount("suspect-product", 2)).toBe(true);
  });

  it("rejects a count above the group's real max instance count", () => {
    // suspect-product's real max is 2 (Issue #16)
    expect(isValidRepeatCount("suspect-product", 3)).toBe(false);
  });

  it("accepts the real max for a group with a larger max", () => {
    // concomitant-medication's real max is 10 (Issue #16)
    expect(isValidRepeatCount("concomitant-medication", 10)).toBe(true);
    expect(isValidRepeatCount("concomitant-medication", 11)).toBe(false);
  });

  it("rejects a count below 1", () => {
    expect(isValidRepeatCount("suspect-product", 0)).toBe(false);
    expect(isValidRepeatCount("suspect-product", -1)).toBe(false);
  });

  it("rejects a non-integer count", () => {
    expect(isValidRepeatCount("suspect-product", 1.5)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(isValidRepeatCount("suspect-product", NaN)).toBe(false);
  });

  it("returns false, not a thrown error, for a topics list with none of the group's topics", () => {
    expect(
      isValidRepeatCount("suspect-product", 1, [
        { id: "unrelated", section: "A", label: "x", fieldIds: [], repeatGroup: null, repeatInstance: null },
      ]),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nextStep — synthetic fields/topics for isolated logic testing; a few
// integration-style checks against the real TOPICS/FORM_3500_FIELDS at
// the end confirm the wiring actually works against real data too.
// ---------------------------------------------------------------------------

function field(id: string, type: "text" | "date" | "checkbox" | "enum") {
  return { id, section: "A" as const, pdfFieldName: `form.${id}[0]`, label: id, type, required: false };
}

function topic(
  id: string,
  fieldIds: string[],
  opts: { repeatGroup?: "suspect-product" | "concomitant-medication"; repeatInstance?: number } = {},
) {
  return {
    id,
    section: "A" as const,
    label: id,
    fieldIds,
    repeatGroup: opts.repeatGroup ?? null,
    repeatInstance: opts.repeatInstance ?? null,
  };
}

function recordOf(entries: Record<string, { state: "unasked" | "answered" | "unknown" | "declined" }>) {
  const record: AgendaRecord = {};
  for (const [id, entry] of Object.entries(entries)) {
    record[id] = entry.state === "answered" ? { state: "answered", value: "x" } : { state: entry.state };
  }
  return record;
}

describe("nextStep", () => {
  it("returns the first topic with an unresolved text/date field", () => {
    const fields = [field("cb", "checkbox"), field("t", "text")];
    const topics = [topic("checkbox-only", ["cb"]), topic("has-text", ["t"])];
    const record = recordOf({ cb: { state: "unasked" }, t: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[1], fieldIds: ["t"] });
  });

  it("skips a topic that's entirely checkbox/enum — zero conversational step for it", () => {
    const fields = [field("cb1", "checkbox"), field("cb2", "enum"), field("t", "text")];
    const topics = [topic("all-choice", ["cb1", "cb2"]), topic("has-text", ["t"])];
    const record = recordOf({ cb1: { state: "unasked" }, cb2: { state: "unasked" }, t: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[1], fieldIds: ["t"] });
  });

  it("skips a topic whose text/date fields are already all resolved", () => {
    const fields = [field("x", "text"), field("y", "text")];
    const topics = [topic("first", ["x"]), topic("second", ["y"])];
    const record = recordOf({ x: { state: "answered" }, y: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[1], fieldIds: ["y"] });
  });

  it("returns only the still-unresolved subset of a partially-answered topic", () => {
    const fields = [field("x", "text"), field("y", "text")];
    const topics = [topic("mixed", ["x", "y"])];
    const record = recordOf({ x: { state: "answered" }, y: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[0], fieldIds: ["y"] });
  });

  it("returns done once every topic is resolved with no pending repeat-decision", () => {
    const fields = [field("x", "text")];
    const topics = [topic("only", ["x"])];
    const record = recordOf({ x: { state: "declined" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "done" });
  });

  it("asks instance 1 of a repeating group directly, no repeat-decision needed first", () => {
    const fields = [field("f1", "text")];
    const topics = [topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 })];
    const record = recordOf({ f1: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[0], fieldIds: ["f1"] });
  });

  it("surfaces a repeat-decision before instance 2's topic when the group isn't decided yet", () => {
    const fields = [field("f1", "text"), field("f2", "text")];
    const topics = [
      topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
    ];
    const record = recordOf({ f1: { state: "declined" }, f2: { state: "unasked" } });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 });
  });

  it("declining every field of instance 1 still reaches the repeat-decision step normally", () => {
    // This is how "I have none of these" gets expressed — no special
    // zero-count case needed.
    const fields = [field("f1", "text"), field("f1b", "text"), field("f2", "text")];
    const topics = [
      topic("g-1", ["f1", "f1b"], { repeatGroup: "concomitant-medication", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "concomitant-medication", repeatInstance: 2 }),
    ];
    const record = recordOf({
      f1: { state: "declined" },
      f1b: { state: "declined" },
      f2: { state: "unasked" },
    });
    const step = nextStep(record, initRepeatCounts(), topics, fields);
    expect(step).toEqual({
      kind: "repeat-decision",
      repeatGroup: "concomitant-medication",
      afterInstance: 1,
    });
  });

  it("skips instance 2 entirely once the group is decided at a lower count", () => {
    const fields = [field("f1", "text"), field("f2", "text")];
    const topics = [
      topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
    ];
    const record = recordOf({ f1: { state: "declined" }, f2: { state: "unasked" } });
    const counts = setRepeatCount(initRepeatCounts(), "suspect-product", 1);
    const step = nextStep(record, counts, topics, fields);
    expect(step).toEqual({ kind: "done" });
  });

  it("asks instance 2 normally once the group is decided at a count that includes it", () => {
    const fields = [field("f1", "text"), field("f2", "text")];
    const topics = [
      topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
    ];
    const record = recordOf({ f1: { state: "declined" }, f2: { state: "unasked" } });
    const counts = setRepeatCount(initRepeatCounts(), "suspect-product", 2);
    const step = nextStep(record, counts, topics, fields);
    expect(step).toEqual({ kind: "topic", topic: topics[1], fieldIds: ["f2"] });
  });

  it("throws, rather than silently treating it as resolved, when a topic references a field id missing from the record", () => {
    const fields = [field("x", "text")];
    const topics = [topic("only", ["x"])];
    // record deliberately has no entry for "x" at all — a mismatched
    // topics/fields/record combination, which talk.ts's Deps allows a
    // caller to construct.
    expect(() => nextStep({}, initRepeatCounts(), topics, fields)).toThrow();
  });

  it("throws when a topic references a field id missing from the given fields list", () => {
    const topics = [topic("only", ["x"])];
    const record = recordOf({ x: { state: "unasked" } });
    expect(() => nextStep(record, initRepeatCounts(), topics, [])).toThrow();
  });

  it("throws on a directly-constructed invalid repeat count (bypassing setRepeatCount) instead of silently skipping instance 1", () => {
    const fields = [field("f1", "text")];
    const topics = [topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 })];
    const record = recordOf({ f1: { state: "unasked" } });
    expect(() => nextStep(record, { "suspect-product": 0 }, topics, fields)).toThrow();
    expect(() => nextStep(record, { "suspect-product": NaN }, topics, fields)).toThrow();
  });

  it("against the real manifest: the very first step of a fresh session is patient-basics's text/date fields", () => {
    const step = nextStep(initAgenda(), initRepeatCounts());
    expect(step.kind).toBe("topic");
    if (step.kind === "topic") {
      expect(step.topic.id).toBe("patient-basics");
      expect(step.fieldIds).toContain("Page1.SecA_Patient.PatientIdentifier");
      // AgeYears/SexM/etc. are checkbox fields — never surfaced here.
      expect(step.fieldIds).not.toContain("Page1.SecA_Patient.AgeYears");
    }
  });

  it("against the real manifest: a fully-resolved record with all repeat groups decided at 1 reaches done", () => {
    let record = initAgenda();
    for (const f of FORM_3500_FIELDS) {
      record = applyAction(record, f.id, { type: "decline" });
    }
    let counts = initRepeatCounts();
    counts = setRepeatCount(counts, "suspect-product", 1);
    counts = setRepeatCount(counts, "concomitant-medication", 1);
    expect(nextStep(record, counts)).toEqual({ kind: "done" });
  });
});

// ---------------------------------------------------------------------------
// topicStatuses — built on nextStep() itself (one call), not a duplicated
// walk. Synthetic fields/topics for isolation; a real-manifest check at
// the end confirms the wiring.
// ---------------------------------------------------------------------------

describe("topicStatuses", () => {
  it("marks the first unresolved topic current, everything after upcoming, on a fresh session", () => {
    const fields = [field("x", "text"), field("y", "text"), field("z", "text")];
    const topics = [topic("a", ["x"]), topic("b", ["y"]), topic("c", ["z"])];
    const record = recordOf({ x: { state: "unasked" }, y: { state: "unasked" }, z: { state: "unasked" } });
    const statuses = topicStatuses(record, initRepeatCounts(), topics, fields);
    expect(statuses).toEqual([
      { topic: topics[0], status: "current" },
      { topic: topics[1], status: "upcoming" },
      { topic: topics[2], status: "upcoming" },
    ]);
  });

  it("marks resolved topics before the current one done", () => {
    const fields = [field("x", "text"), field("y", "text"), field("z", "text")];
    const topics = [topic("a", ["x"]), topic("b", ["y"]), topic("c", ["z"])];
    const record = recordOf({ x: { state: "declined" }, y: { state: "unasked" }, z: { state: "unasked" } });
    const statuses = topicStatuses(record, initRepeatCounts(), topics, fields);
    expect(statuses).toEqual([
      { topic: topics[0], status: "done" },
      { topic: topics[1], status: "current" },
      { topic: topics[2], status: "upcoming" },
    ]);
  });

  it("marks a repeat instance skipped by a decided count as done, not upcoming", () => {
    const fields = [field("f1", "text"), field("f2", "text"), field("f3", "text")];
    const topics = [
      topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
      topic("after", ["f3"]),
    ];
    const record = recordOf({ f1: { state: "declined" }, f2: { state: "unasked" }, f3: { state: "unasked" } });
    const counts = setRepeatCount(initRepeatCounts(), "suspect-product", 1);
    const statuses = topicStatuses(record, counts, topics, fields);
    expect(statuses).toEqual([
      { topic: topics[0], status: "done" },
      { topic: topics[1], status: "done" },
      { topic: topics[2], status: "current" },
    ]);
  });

  it("marks the correct next-instance topic current when a repeat-decision is pending", () => {
    const fields = [field("f1", "text"), field("f2", "text")];
    const topics = [
      topic("g-1", ["f1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g-2", ["f2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
    ];
    const record = recordOf({ f1: { state: "declined" }, f2: { state: "unasked" } });
    const statuses = topicStatuses(record, initRepeatCounts(), topics, fields);
    expect(statuses).toEqual([
      { topic: topics[0], status: "done" },
      { topic: topics[1], status: "current" },
    ]);
  });

  it("marks everything done once nextStep reaches done", () => {
    const fields = [field("x", "text")];
    const topics = [topic("only", ["x"])];
    const record = recordOf({ x: { state: "declined" } });
    const statuses = topicStatuses(record, initRepeatCounts(), topics, fields);
    expect(statuses).toEqual([{ topic: topics[0], status: "done" }]);
  });

  it("against the real manifest: a fresh session has patient-basics current and everything else upcoming", () => {
    const statuses = topicStatuses(initAgenda(), initRepeatCounts());
    expect(statuses).toHaveLength(34);
    expect(statuses[0]).toEqual({ topic: TOPICS[0], status: "current" });
    expect(statuses[0].topic.id).toBe("patient-basics");
    for (const entry of statuses.slice(1)) {
      expect(entry.status).toBe("upcoming");
    }
  });
});

// The review-stage edit path (Issue #34): field-state.ts's `reopen` action
// already exists for exactly this ("the review-stage edit path in
// docs/design.md re-enters this same state machine rather than patching a
// value directly") but nothing called it yet. reopenTopic() is the one
// caller — send a topic's resolved text/date fields back to `unasked` so
// nextStep()'s own serial walk picks the topic up again as a normal
// conversational step, the same Extractor/grounding path a first answer
// goes through.
describe("reopenTopic", () => {
  it("sends a topic's resolved text/date fields back to unasked, clearing their value", () => {
    const fields = [field("t", "text"), field("d", "date")];
    const t = topic("only", ["t", "d"]);
    const record = recordOf({ t: { state: "answered" }, d: { state: "declined" } });
    const reopened = reopenTopic(record, t, fields);
    expect(reopened.t).toEqual({ state: "unasked" });
    expect(reopened.d).toEqual({ state: "unasked" });
  });

  it("leaves the topic's checkbox/enum fields untouched", () => {
    const fields = [field("cb", "checkbox"), field("en", "enum"), field("t", "text")];
    const t = topic("only", ["cb", "en", "t"]);
    const record = recordOf({ cb: { state: "answered" }, en: { state: "answered" }, t: { state: "answered" } });
    const reopened = reopenTopic(record, t, fields);
    expect(reopened.cb).toEqual(record.cb);
    expect(reopened.en).toEqual(record.en);
    expect(reopened.t).toEqual({ state: "unasked" });
  });

  it("leaves other topics' fields untouched", () => {
    const fields = [field("a", "text"), field("b", "text")];
    const topics = [topic("first", ["a"]), topic("second", ["b"])];
    const record = recordOf({ a: { state: "answered" }, b: { state: "answered" } });
    const reopened = reopenTopic(record, topics[0], fields);
    expect(reopened.a).toEqual({ state: "unasked" });
    expect(reopened.b).toEqual(record.b);
  });

  it("is a no-op on a text/date field that is already unasked", () => {
    const fields = [field("t", "text")];
    const t = topic("only", ["t"]);
    const record = recordOf({ t: { state: "unasked" } });
    const reopened = reopenTopic(record, t, fields);
    expect(reopened).toEqual(record);
  });

  it("makes nextStep() return to a topic reopened after it was passed, even with only-later topics still done", () => {
    const fields = [field("a", "text"), field("b", "text")];
    const topics = [topic("first", ["a"]), topic("second", ["b"])];
    const record = recordOf({ a: { state: "answered" }, b: { state: "answered" } });
    expect(nextStep(record, initRepeatCounts(), topics, fields)).toEqual({ kind: "done" });
    const reopened = reopenTopic(record, topics[0], fields);
    expect(nextStep(reopened, initRepeatCounts(), topics, fields)).toEqual({
      kind: "topic",
      topic: topics[0],
      fieldIds: ["a"],
    });
  });

  it("throws on a field id not present in the given fields list", () => {
    const t = topic("only", ["ghost"]);
    expect(() => reopenTopic({}, t, [])).toThrow(/no such field/);
  });
});

// Issue #41: the narrative-extraction pass's field targets — unlike
// nextStep(), which surfaces only text/date fields for the single next
// step, this surfaces every still-open field (any type) across every
// non-repeat topic and repeat-instance-1, in one shot.
describe("narrativePassFields", () => {
  it("includes unresolved text/date/checkbox/enum fields alike — unlike nextStep(), fixed-choice fields are in scope here", () => {
    const fields = [field("t", "text"), field("d", "date"), field("cb", "checkbox"), field("en", "enum")];
    const topics = [topic("only", ["t", "d", "cb", "en"])];
    const record = recordOf({
      t: { state: "unasked" },
      d: { state: "unasked" },
      cb: { state: "unasked" },
      en: { state: "unasked" },
    });
    expect(narrativePassFields(record, topics, fields).map((f) => f.id)).toEqual(["t", "d", "cb", "en"]);
  });

  it("excludes fields already resolved, of any state", () => {
    const fields = [field("a", "text"), field("b", "text"), field("c", "text"), field("d", "text")];
    const topics = [topic("only", ["a", "b", "c", "d"])];
    const record = recordOf({
      a: { state: "unasked" },
      b: { state: "answered" },
      c: { state: "unknown" },
      d: { state: "declined" },
    });
    expect(narrativePassFields(record, topics, fields).map((f) => f.id)).toEqual(["a"]);
  });

  it("includes repeat-instance-1 fields, unresolved", () => {
    const fields = [field("p1", "text")];
    const topics = [topic("g1", ["p1"], { repeatGroup: "suspect-product", repeatInstance: 1 })];
    const record = recordOf({ p1: { state: "unasked" } });
    expect(narrativePassFields(record, topics, fields).map((f) => f.id)).toEqual(["p1"]);
  });

  it("excludes repeat-instance-2+ fields even when unresolved — the pass never attributes fields to a specific later instance", () => {
    const fields = [field("p1", "text"), field("p2", "text")];
    const topics = [
      topic("g1", ["p1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
      topic("g2", ["p2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
    ];
    const record = recordOf({ p1: { state: "unasked" }, p2: { state: "unasked" } });
    expect(narrativePassFields(record, topics, fields).map((f) => f.id)).toEqual(["p1"]);
  });

  it("preserves topic and field order", () => {
    const fields = [field("z", "text"), field("a", "text"), field("m", "text")];
    const topics = [topic("second", ["a"]), topic("first", ["z", "m"])];
    const record = recordOf({ a: { state: "unasked" }, z: { state: "unasked" }, m: { state: "unasked" } });
    expect(narrativePassFields(record, topics, fields).map((f) => f.id)).toEqual(["a", "z", "m"]);
  });

  it("throws on a field id not present in the given fields list", () => {
    const topics = [topic("only", ["ghost"])];
    expect(() => narrativePassFields({}, topics, [])).toThrow(/no such field/);
  });

  it("throws on a field id missing from the given record", () => {
    const fields = [field("t", "text")];
    const topics = [topic("only", ["t"])];
    expect(() => narrativePassFields({}, topics, fields)).toThrow(/record missing field id/);
  });

  it("against the real manifest: returns a non-trivial subset spanning multiple sections, none of them repeat-instance-2+", () => {
    const result = narrativePassFields(initAgenda(), TOPICS, FORM_3500_FIELDS);
    const sections = new Set(result.map((f) => f.section));
    expect(result.length).toBeGreaterThan(50);
    expect(sections.size).toBeGreaterThan(1);
    const fieldsInRepeat2Plus = new Set(
      TOPICS.filter((t) => t.repeatInstance !== null && t.repeatInstance > 1).flatMap((t) => t.fieldIds),
    );
    expect(result.some((f) => fieldsInRepeat2Plus.has(f.id))).toBe(false);
  });
});
