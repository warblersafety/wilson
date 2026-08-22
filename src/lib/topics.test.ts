import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, FORM_3500_SECTIONS, type FormSection } from "./form-3500-fields";
import { TOPICS, initRepeatCounts, nextStep, setRepeatCount } from "./topics";

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
