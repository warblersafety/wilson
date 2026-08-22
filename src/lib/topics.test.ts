import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS, FORM_3500_SECTIONS, type FormSection } from "./form-3500-fields";
import { TOPICS } from "./topics";

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
