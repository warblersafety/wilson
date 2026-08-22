import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { TalkTurn } from "./talk";
import {
  validateCandidates,
  validateRepeatCandidate,
  type ExtractionCandidate,
  type RepeatCandidate,
} from "./extraction-validator";

const TEXT_FIELD = FORM_3500_FIELDS.find((f) => f.type === "text")!;
const DATE_FIELD = FORM_3500_FIELDS.find((f) => f.type === "date")!;
const ENUM_FIELD = FORM_3500_FIELDS.find((f) => f.type === "enum")!;
const CHECKBOX_FIELD = FORM_3500_FIELDS.find((f) => f.type === "checkbox")!;
const FIELDS: FormFieldSpec[] = [TEXT_FIELD, DATE_FIELD, ENUM_FIELD, CHECKBOX_FIELD];

function transcriptWith(...clinicianTexts: string[]): TalkTurn[] {
  const turns: TalkTurn[] = [];
  for (const text of clinicianTexts) {
    turns.push({ role: "talker", text: "(question)" });
    turns.push({ role: "clinician", text });
  }
  return turns;
}

describe("validateCandidates", () => {
  it("accepts a value candidate whose value is literally quoted from a clinician turn", () => {
    const transcript = transcriptWith("I'm 42 years old");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "42",
      quote: { turnIndex: 1, text: "I'm 42 years old" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([
      { fieldId: TEXT_FIELD.id, type: "answer", value: "42" },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("accepts a referentially-mapped value that never literally appears in its quote — design.md's own motivating case", () => {
    // docs/design.md names exactly this: a clinician says "the water
    // pill," the extractor maps it to the actual drug name. Neither
    // string contains the other; the quote alone is what's checked.
    const transcript = transcriptWith("I'm on the water pill for my blood pressure");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "furosemide",
      quote: { turnIndex: 1, text: "the water pill" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([
      { fieldId: TEXT_FIELD.id, type: "answer", value: "furosemide" },
    ]);
  });

  it("accepts an unknown candidate grounded in a clinician turn expressing uncertainty", () => {
    const transcript = transcriptWith("I don't know, honestly");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "unknown",
      quote: { turnIndex: 1, text: "I don't know" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([{ fieldId: TEXT_FIELD.id, type: "mark_unknown" }]);
  });

  it("accepts a declined candidate grounded in a clinician turn", () => {
    const transcript = transcriptWith("I'd rather not say");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "declined",
      quote: { turnIndex: 1, text: "rather not say" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([{ fieldId: TEXT_FIELD.id, type: "decline" }]);
  });

  it("accepts a batch of mixed candidates, all in one call, in order", () => {
    const transcript = transcriptWith("42", "no idea", "skip that one");
    const candidates: ExtractionCandidate[] = [
      { fieldId: TEXT_FIELD.id, kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } },
      { fieldId: DATE_FIELD.id, kind: "unknown", quote: { turnIndex: 3, text: "no idea" } },
      { fieldId: DATE_FIELD.id, kind: "declined", quote: { turnIndex: 5, text: "skip that one" } },
    ];
    const result = validateCandidates(transcript, candidates, FIELDS);
    expect(result.accepted).toEqual([
      { fieldId: TEXT_FIELD.id, type: "answer", value: "42" },
      { fieldId: DATE_FIELD.id, type: "mark_unknown" },
      { fieldId: DATE_FIELD.id, type: "decline" },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("accepts two candidates for the same field in one batch, both surfaced in order", () => {
    const transcript = transcriptWith("42, actually wait, 45");
    const candidates: ExtractionCandidate[] = [
      { fieldId: TEXT_FIELD.id, kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } },
      { fieldId: TEXT_FIELD.id, kind: "value", value: "45", quote: { turnIndex: 1, text: "45" } },
    ];
    const result = validateCandidates(transcript, candidates, FIELDS);
    expect(result.accepted).toEqual([
      { fieldId: TEXT_FIELD.id, type: "answer", value: "42" },
      { fieldId: TEXT_FIELD.id, type: "answer", value: "45" },
    ]);
  });

  it("returns empty accepted/rejected for an empty candidate list", () => {
    const result = validateCandidates(transcriptWith("hello"), [], FIELDS);
    expect(result).toEqual({ accepted: [], rejected: [] });
  });

  it("rejects a candidate targeting a field id not in the given field list", () => {
    const transcript = transcriptWith("42");
    const candidate: ExtractionCandidate = {
      fieldId: "not-a-real-field",
      kind: "value",
      value: "42",
      quote: { turnIndex: 1, text: "42" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ candidate, reason: "unknown_field" }]);
  });

  it("rejects a candidate targeting an enum field — enum fields never go through extraction", () => {
    const transcript = transcriptWith("twice a day");
    const candidate: ExtractionCandidate = {
      fieldId: ENUM_FIELD.id,
      kind: "value",
      value: "BID",
      quote: { turnIndex: 1, text: "twice a day" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "not_extractable_field_type" }]);
  });

  it("rejects a candidate targeting a checkbox field — checkbox fields never go through extraction", () => {
    const transcript = transcriptWith("yes");
    const candidate: ExtractionCandidate = {
      fieldId: CHECKBOX_FIELD.id,
      kind: "value",
      value: "true",
      quote: { turnIndex: 1, text: "yes" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "not_extractable_field_type" }]);
  });

  it("rejects a quote whose turn index doesn't exist in the transcript", () => {
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "42",
      quote: { turnIndex: 99, text: "42" },
    };
    const result = validateCandidates(transcriptWith("42"), [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "quote_not_found" }]);
  });

  it("rejects a quote pointing at a talker turn instead of a clinician turn", () => {
    const transcript = transcriptWith("42");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "42",
      // index 0 is the talker's "(question)" turn, not the clinician's
      quote: { turnIndex: 0, text: "(question)" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "quote_not_found" }]);
  });

  it("rejects a quote whose text isn't actually a substring of the cited turn", () => {
    const transcript = transcriptWith("I'm 42 years old");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "42",
      quote: { turnIndex: 1, text: "I'm 50 years old" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "quote_not_found" }]);
  });

  it("rejects a quote that normalizes to an empty string — a punctuation-only quote must not vacuously match everything", () => {
    // Without an explicit empty-string guard, "...".normalize() -> "" and
    // "".includes("") -> true for JS strings, which would make ANY real
    // clinician turn "ground" a candidate that quotes nothing at all.
    const transcript = transcriptWith("42");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "42",
      quote: { turnIndex: 1, text: "..." },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "quote_not_found" }]);
  });

  it("rejects a value that normalizes to an empty string, even with a real grounded quote", () => {
    const transcript = transcriptWith("I'm 42 years old");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "...",
      quote: { turnIndex: 1, text: "I'm 42 years old" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.rejected).toEqual([{ candidate, reason: "value_not_grounded" }]);
  });

  it("matches a quote after normalizing case, whitespace, and straight-vs-curly punctuation", () => {
    const transcript = transcriptWith("I don’t know…");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "unknown",
      quote: { turnIndex: 1, text: "I don't know" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toHaveLength(1);
  });

  it("a value grounded by a real but topically-unrelated quote is accepted — a documented, accepted limitation, not an oversight", () => {
    // This validator can only confirm a quote is REAL, never that it's
    // topically related to the value it's cited for — that correlation
    // is a semantic judgment, not something string matching can verify
    // without also rejecting every legitimate referential mapping
    // design.md asks for (see the file header). lucy accepts the exact
    // same tradeoff for its own mapped-value fields. The clinician's
    // review before submission, not this check, is what catches a
    // genuinely wrong mapping.
    const transcript = transcriptWith("I take metoprolol for my heart");
    const candidate: ExtractionCandidate = {
      fieldId: TEXT_FIELD.id,
      kind: "value",
      value: "unrelated made-up answer",
      quote: { turnIndex: 1, text: "metoprolol" },
    };
    const result = validateCandidates(transcript, [candidate], FIELDS);
    expect(result.accepted).toEqual([
      { fieldId: TEXT_FIELD.id, type: "answer", value: "unrelated made-up answer" },
    ]);
  });
});

describe("validateRepeatCandidate", () => {
  it("accepts a repeat-group decision whose quote is a real clinician turn", () => {
    const transcript = transcriptWith("yes, there was a second one, lisinopril");
    const candidate: RepeatCandidate = {
      repeatGroup: "suspect-product",
      count: 2,
      quote: { turnIndex: 1, text: "yes, there was a second one" },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({ accepted: true });
  });

  it("rejects a repeat-group decision whose quote isn't a real substring of the cited turn", () => {
    const transcript = transcriptWith("no, that's the only one");
    const candidate: RepeatCandidate = {
      repeatGroup: "suspect-product",
      count: 2,
      quote: { turnIndex: 1, text: "yes there was another" },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({
      accepted: false,
      reason: "quote_not_found",
    });
  });

  it("rejects a repeat-group decision quoting a talker turn instead of a clinician turn", () => {
    const transcript = transcriptWith("yes");
    const candidate: RepeatCandidate = {
      repeatGroup: "suspect-product",
      count: 2,
      // index 0 is the talker's "(question)" turn, not the clinician's
      quote: { turnIndex: 0, text: "(question)" },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({
      accepted: false,
      reason: "quote_not_found",
    });
  });

  it("rejects a punctuation-only quote — the same vacuous-match guard as validateCandidates", () => {
    const transcript = transcriptWith("yes");
    const candidate: RepeatCandidate = {
      repeatGroup: "suspect-product",
      count: 2,
      quote: { turnIndex: 1, text: "..." },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({
      accepted: false,
      reason: "quote_not_found",
    });
  });

  it("rejects a candidate naming a different repeat group than the one actually open, even with a real quote", () => {
    // The step actually open is what's authoritative here, not the
    // candidate's own claim — a candidate naming the wrong group is
    // exactly what a model mis-firing during an unrelated turn would
    // produce, and quote-grounding alone can't catch it.
    const transcript = transcriptWith("yes, there was a second one");
    const candidate: RepeatCandidate = {
      repeatGroup: "concomitant-medication",
      count: 2,
      quote: { turnIndex: 1, text: "yes, there was a second one" },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({
      accepted: false,
      reason: "wrong_repeat_group",
    });
  });

  it("checks the repeat-group match before the quote — a wrong group is rejected even with a bogus quote too", () => {
    const transcript = transcriptWith("yes, there was a second one");
    const candidate: RepeatCandidate = {
      repeatGroup: "concomitant-medication",
      count: 2,
      quote: { turnIndex: 1, text: "a sentence never said" },
    };
    expect(validateRepeatCandidate(transcript, candidate, "suspect-product")).toEqual({
      accepted: false,
      reason: "wrong_repeat_group",
    });
  });
});
