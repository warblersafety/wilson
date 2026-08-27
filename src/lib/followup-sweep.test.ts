// Pure classification/phrasing logic behind Issue #44's widened per-turn
// follow-up sweep (design.md "Follow-up turns are mined for everything
// still open") — no model call, no React. src/lib/extract.ts is the one
// production caller (after validateCandidates() has already confirmed
// each candidate is grounded); tested here directly so every write-policy
// rule has a fast, API-free proof.
import { describe, expect, it } from "vitest";
import type { AgendaRecord } from "./agenda";
import { fieldById, FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { ProposedAction } from "./talk";
import type { Topic } from "./topics";
import { classifyFollowUpActions, describeFollowUpSweep } from "./followup-sweep";
import { syntheticAsk } from "./synthetic-topic";

function field(id: string, type: FormFieldSpec["type"], label = id): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label, type, required: false };
}

function topic(
  id: string,
  fieldIds: string[],
  opts: { repeatGroup?: "suspect-product" | "concomitant-medication"; repeatInstance?: number } = {},
): Topic {
  return {
    id,
    section: "A",
    label: id,
    fieldIds,
    repeatGroup: opts.repeatGroup ?? null,
    repeatInstance: opts.repeatInstance ?? null,
    asks: [syntheticAsk(id, fieldIds)],
  };
}

function recordOf(entries: Record<string, { state: "unasked" | "answered" | "unknown" | "declined"; value?: string }>) {
  const record: AgendaRecord = {};
  for (const [id, entry] of Object.entries(entries)) {
    record[id] = entry.state === "answered" ? { state: "answered", value: entry.value ?? "x" } : { state: entry.state };
  }
  return record;
}

const TOPICS = [
  topic("t1", ["a", "b", "c"]),
  topic("g1", ["p1"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
  topic("g2", ["p2"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
  topic("c1", ["m1"], { repeatGroup: "concomitant-medication", repeatInstance: 1 }),
  topic("c2", ["m2"], { repeatGroup: "concomitant-medication", repeatInstance: 2 }),
];

describe("classifyFollowUpActions", () => {
  it("writes an unasked field named in the ask (in-ask) with no announcement obligation", () => {
    const record = recordOf({ a: { state: "unasked" } });
    const actions: ProposedAction[] = [{ fieldId: "a", type: "answer", value: "42" }];
    const result = classifyFollowUpActions(actions, record, ["a"], TOPICS);
    expect(result.writes).toEqual([{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.outOfAskWrites).toEqual([]);
    expect(result.correctionOffers).toEqual([]);
    expect(result.collisionFieldIds).toEqual([]);
    expect(result.volunteeredRepeatGroups).toEqual([]);
  });

  it("writes an unasked field volunteered OUTSIDE the ask's own fields, and flags it as out-of-ask", () => {
    const record = recordOf({ a: { state: "unasked" }, b: { state: "unasked" } });
    const actions: ProposedAction[] = [{ fieldId: "b", type: "answer", value: "lisinopril" }];
    // "a" is the ask's own field; "b" was volunteered alongside it.
    const result = classifyFollowUpActions(actions, record, ["a"], TOPICS);
    expect(result.writes).toEqual([{ fieldId: "b", type: "answer", value: "lisinopril" }]);
    expect(result.outOfAskWrites).toEqual([{ fieldId: "b", type: "answer", value: "lisinopril" }]);
  });

  it("never treats an in-ask write as out-of-ask, even among several unasked fields", () => {
    const record = recordOf({ a: { state: "unasked" }, b: { state: "unasked" } });
    const actions: ProposedAction[] = [
      { fieldId: "a", type: "answer", value: "1" },
      { fieldId: "b", type: "answer", value: "2" },
    ];
    const result = classifyFollowUpActions(actions, record, ["a", "b"], TOPICS);
    expect(result.outOfAskWrites).toEqual([]);
  });

  it("turns a candidate for an ANSWERED field into a correction offer, never a direct write", () => {
    const record = recordOf({ a: { state: "answered", value: "8/19" } });
    const actions: ProposedAction[] = [{ fieldId: "a", type: "answer", value: "8/20" }];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.writes).toEqual([]);
    expect(result.correctionOffers).toEqual([
      { fieldId: "a", action: { fieldId: "a", type: "answer", value: "8/20" }, currentState: "answered", currentValue: "8/19" },
    ]);
  });

  it("turns a candidate for an UNKNOWN field into a correction offer too — unknown is not unasked", () => {
    const record = recordOf({ a: { state: "unknown" } });
    const actions: ProposedAction[] = [{ fieldId: "a", type: "answer", value: "42" }];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.writes).toEqual([]);
    expect(result.correctionOffers).toEqual([
      { fieldId: "a", action: { fieldId: "a", type: "answer", value: "42" }, currentState: "unknown", currentValue: undefined },
    ]);
  });

  it("turns a candidate for a DECLINED field into a correction offer too", () => {
    const record = recordOf({ a: { state: "declined" } });
    const actions: ProposedAction[] = [{ fieldId: "a", type: "mark_unknown" }];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.writes).toEqual([]);
    expect(result.correctionOffers).toEqual([
      { fieldId: "a", action: { fieldId: "a", type: "mark_unknown" }, currentState: "declined", currentValue: undefined },
    ]);
  });

  it("treats two candidates for the same field as a collision — the turn writes neither", () => {
    const record = recordOf({ a: { state: "unasked" } });
    const actions: ProposedAction[] = [
      { fieldId: "a", type: "answer", value: "42" },
      { fieldId: "a", type: "answer", value: "45" },
    ];
    const result = classifyFollowUpActions(actions, record, ["a"], TOPICS);
    expect(result.writes).toEqual([]);
    expect(result.outOfAskWrites).toEqual([]);
    expect(result.correctionOffers).toEqual([]);
    expect(result.collisionFieldIds).toEqual(["a"]);
  });

  it("a collision on an already-resolved field is still a collision, not two correction offers", () => {
    const record = recordOf({ a: { state: "answered", value: "8/19" } });
    const actions: ProposedAction[] = [
      { fieldId: "a", type: "answer", value: "8/20" },
      { fieldId: "a", type: "answer", value: "8/21" },
    ];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.correctionOffers).toEqual([]);
    expect(result.collisionFieldIds).toEqual(["a"]);
  });

  it("a candidate for a repeat-instance-2+ field writes nothing and records the group as volunteered", () => {
    const record = recordOf({ p2: { state: "unasked" } });
    const actions: ProposedAction[] = [{ fieldId: "p2", type: "answer", value: "lisinopril" }];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.writes).toEqual([]);
    expect(result.correctionOffers).toEqual([]);
    expect(result.collisionFieldIds).toEqual([]);
    expect(result.volunteeredRepeatGroups).toEqual(["suspect-product"]);
  });

  it("a repeat-instance-1 field is ordinary — never treated as a later-instance volunteer", () => {
    const record = recordOf({ p1: { state: "unasked" } });
    const actions: ProposedAction[] = [{ fieldId: "p1", type: "answer", value: "amoxicillin" }];
    const result = classifyFollowUpActions(actions, record, ["p1"], TOPICS);
    expect(result.writes).toEqual([{ fieldId: "p1", type: "answer", value: "amoxicillin" }]);
    expect(result.volunteeredRepeatGroups).toEqual([]);
  });

  it("dedupes repeated later-instance mentions of the same group into one entry", () => {
    const record = recordOf({ p2: { state: "unasked" } });
    const actions: ProposedAction[] = [
      { fieldId: "p2", type: "answer", value: "lisinopril" },
      { fieldId: "p2", type: "answer", value: "10mg" },
    ];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(result.volunteeredRepeatGroups).toEqual(["suspect-product"]);
  });

  it("names every distinct later-instance group mentioned in one turn", () => {
    const record = recordOf({ p2: { state: "unasked" }, m2: { state: "unasked" } });
    const actions: ProposedAction[] = [
      { fieldId: "p2", type: "answer", value: "lisinopril" },
      { fieldId: "m2", type: "answer", value: "metformin" },
    ];
    const result = classifyFollowUpActions(actions, record, [], TOPICS);
    expect(new Set(result.volunteeredRepeatGroups)).toEqual(new Set(["suspect-product", "concomitant-medication"]));
  });

  it("handles a realistic mixed turn: one in-ask write, one out-of-ask write, one correction offer, one later-instance mention", () => {
    const record = recordOf({
      a: { state: "unasked" },
      b: { state: "unasked" },
      c: { state: "answered", value: "old" },
      p2: { state: "unasked" },
    });
    const actions: ProposedAction[] = [
      { fieldId: "a", type: "answer", value: "in-ask" },
      { fieldId: "b", type: "answer", value: "volunteered" },
      { fieldId: "c", type: "answer", value: "new" },
      { fieldId: "p2", type: "answer", value: "second product" },
    ];
    const result = classifyFollowUpActions(actions, record, ["a"], TOPICS);
    expect(result.writes).toEqual([
      { fieldId: "a", type: "answer", value: "in-ask" },
      { fieldId: "b", type: "answer", value: "volunteered" },
    ]);
    expect(result.outOfAskWrites).toEqual([{ fieldId: "b", type: "answer", value: "volunteered" }]);
    expect(result.correctionOffers).toEqual([
      { fieldId: "c", action: { fieldId: "c", type: "answer", value: "new" }, currentState: "answered", currentValue: "old" },
    ]);
    expect(result.volunteeredRepeatGroups).toEqual(["suspect-product"]);
  });

  it("returns empty result for an empty actions list", () => {
    const result = classifyFollowUpActions([], recordOf({}), [], TOPICS);
    expect(result).toEqual({ writes: [], outOfAskWrites: [], correctionOffers: [], collisionFieldIds: [], volunteeredRepeatGroups: [] });
  });

  it("throws on a field id missing from the given record — fail loud, not silently skip", () => {
    const actions: ProposedAction[] = [{ fieldId: "ghost", type: "answer", value: "x" }];
    expect(() => classifyFollowUpActions(actions, recordOf({}), [], TOPICS)).toThrow(/record missing field id/);
  });

  // The "reopen protects other topics throughout" rule (design.md, Issue
  // #44): a field already `unknown` from EARLIER in the session — wholly
  // unrelated to whatever topic is being reopened right now — must never
  // be silently overwritten by a later turn's background sweep just
  // because it's technically "open" per openFollowUpFields(). This falls
  // straight out of the general state-based rule above (unknown is never
  // `unasked`), proven directly here rather than left implicit.
  it("a field already marked unknown from an earlier, unrelated topic is protected — never a silent write", () => {
    const record = recordOf({ reopenedField: { state: "unasked" }, unrelatedUnknown: { state: "unknown" } });
    const topics = [topic("reopened", ["reopenedField"]), topic("other", ["unrelatedUnknown"])];
    const actions: ProposedAction[] = [
      { fieldId: "reopenedField", type: "answer", value: "new value" },
      { fieldId: "unrelatedUnknown", type: "answer", value: "guessed value" },
    ];
    const result = classifyFollowUpActions(actions, record, ["reopenedField"], topics);
    expect(result.writes).toEqual([{ fieldId: "reopenedField", type: "answer", value: "new value" }]);
    expect(result.correctionOffers).toEqual([
      {
        fieldId: "unrelatedUnknown",
        action: { fieldId: "unrelatedUnknown", type: "answer", value: "guessed value" },
        currentState: "unknown",
        currentValue: undefined,
      },
    ]);
  });

  it("against the real manifest: a repeat-instance-5 concomitant-medication field is recognized as a later-instance volunteer", () => {
    const record: AgendaRecord = { "Page6.SecF_Other.Table1.Row5.Prod5": { state: "unasked" } };
    const actions: ProposedAction[] = [
      { fieldId: "Page6.SecF_Other.Table1.Row5.Prod5", type: "answer", value: "metformin" },
    ];
    const result = classifyFollowUpActions(actions, record, []);
    expect(result.writes).toEqual([]);
    expect(result.volunteeredRepeatGroups).toEqual(["concomitant-medication"]);
  });
});

describe("describeFollowUpSweep", () => {
  // Real manifest ids, not the synthetic "a"/"b"/"c" these tests used to
  // carry: the acknowledgment names a field by its AUTHORED display name
  // (ask-copy.md rule 6), so only a real field has one at all. The labels
  // these fixtures used to fake ("Lot Number") were exactly the manifest
  // text the old fieldPhrase() derived a phrase from.
  const STOP_DATE = "Page4.Prod1.Prod1TherapyStopDate"; // "therapy stop date"
  const LOT = "Page4.Prod1.Prod1LotNum"; // "lot number"
  const DESC = "Page2.SecB_Adverse.DescEvent"; // "event description"
  const FIELDS = [fieldById(STOP_DATE)!, fieldById(LOT)!, fieldById(DESC)!];

  it("returns an empty string when there is nothing to announce", () => {
    const result = describeFollowUpSweep(
      { writes: [], outOfAskWrites: [], correctionOffers: [], collisionFieldIds: [], volunteeredRepeatGroups: [] },
      FIELDS,
    );
    expect(result).toBe("");
  });

  it("names the field and value for an out-of-ask write — no invisible write", () => {
    const result = describeFollowUpSweep(
      {
        writes: [{ fieldId: LOT, type: "answer", value: "8834" }],
        outOfAskWrites: [{ fieldId: LOT, type: "answer", value: "8834" }],
        correctionOffers: [],
        collisionFieldIds: [],
        volunteeredRepeatGroups: [],
      },
      FIELDS,
    );
    expect(result).toContain("lot number");
    expect(result).toContain("8834");
  });

  it("combines several out-of-ask writes into one sentence, each field and value present", () => {
    const result = describeFollowUpSweep(
      {
        writes: [
          { fieldId: LOT, type: "answer", value: "8834" },
          { fieldId: DESC, type: "answer", value: "rash" },
        ],
        outOfAskWrites: [
          { fieldId: LOT, type: "answer", value: "8834" },
          { fieldId: DESC, type: "answer", value: "rash" },
        ],
        correctionOffers: [],
        collisionFieldIds: [],
        volunteeredRepeatGroups: [],
      },
      FIELDS,
    );
    expect(result).toContain("lot number");
    expect(result).toContain("8834");
    expect(result).toContain("event description");
    expect(result).toContain("rash");
  });

  it("phrases a correction offer against an answered field with its current value, per design.md's own example", () => {
    const result = describeFollowUpSweep(
      {
        writes: [],
        outOfAskWrites: [],
        correctionOffers: [
          {
            fieldId: STOP_DATE,
            action: { fieldId: STOP_DATE, type: "answer", value: "8/20" },
            currentState: "answered",
            currentValue: "8/19",
          },
        ],
        collisionFieldIds: [],
        volunteeredRepeatGroups: [],
      },
      FIELDS,
    );
    expect(result).toContain("8/20");
    expect(result).toContain("therapy stop date");
    expect(result).toContain("8/19");
    expect(result.toLowerCase()).toContain("replace it");
  });

  it("phrases a correction offer against an unknown field without inventing a value", () => {
    const result = describeFollowUpSweep(
      {
        writes: [],
        outOfAskWrites: [],
        correctionOffers: [
          {
            fieldId: STOP_DATE,
            action: { fieldId: STOP_DATE, type: "answer", value: "8/20" },
            currentState: "unknown",
            currentValue: undefined,
          },
        ],
        collisionFieldIds: [],
        volunteeredRepeatGroups: [],
      },
      FIELDS,
    );
    expect(result).toContain("8/20");
    expect(result.toLowerCase()).toContain("unknown");
  });

  it("phrases a collision as a clarifying question naming the field", () => {
    const result = describeFollowUpSweep(
      { writes: [], outOfAskWrites: [], correctionOffers: [], collisionFieldIds: [STOP_DATE], volunteeredRepeatGroups: [] },
      FIELDS,
    );
    expect(result).toContain("therapy stop date");
    expect(result.toLowerCase()).toContain("which");
  });

  it("acknowledges a volunteered later-instance group by its human label", () => {
    const result = describeFollowUpSweep(
      {
        writes: [],
        outOfAskWrites: [],
        correctionOffers: [],
        collisionFieldIds: [],
        volunteeredRepeatGroups: ["suspect-product"],
      },
      FIELDS,
    );
    expect(result.toLowerCase()).toContain("suspect product");
  });

  it("joins several simultaneous outcomes into one string, all present", () => {
    const result = describeFollowUpSweep(
      {
        writes: [{ fieldId: LOT, type: "answer", value: "8834" }],
        outOfAskWrites: [{ fieldId: LOT, type: "answer", value: "8834" }],
        correctionOffers: [
          { fieldId: STOP_DATE, action: { fieldId: STOP_DATE, type: "answer", value: "8/20" }, currentState: "answered", currentValue: "8/19" },
        ],
        collisionFieldIds: [DESC],
        volunteeredRepeatGroups: ["concomitant-medication"],
      },
      FIELDS,
    );
    expect(result).toContain("8834");
    expect(result).toContain("8/20");
    expect(result).toContain("event description");
    expect(result.toLowerCase()).toContain("concomitant medication");
  });

  it("against the real manifest: never surfaces a raw field id or PDF path in the announced text", () => {
    const realField = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1LotNum")!;
    const result = describeFollowUpSweep(
      {
        writes: [{ fieldId: realField.id, type: "answer", value: "8834" }],
        outOfAskWrites: [{ fieldId: realField.id, type: "answer", value: "8834" }],
        correctionOffers: [],
        collisionFieldIds: [],
        volunteeredRepeatGroups: [],
      },
      FORM_3500_FIELDS,
    );
    expect(result).not.toMatch(/Page\d+\./);
  });
});
