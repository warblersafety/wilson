import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { TalkTurn } from "./talk";
import {
  ALL_FIELD_TYPES,
  normalizeWithAlignment,
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

describe("normalizeWithAlignment", () => {
  it("maps every normalized character back to a real position in the source text", () => {
    const { normalized, map, source } = normalizeWithAlignment("Foo,   Bar!");
    expect(normalized).toBe("foo bar");
    expect(map.length).toBe(normalized.length);
    // A collapsed whitespace run is attributed to the character that ends
    // it (index 7, "B") rather than to any one of the three source spaces
    // it replaces — a harmless approximation for span-finding, not a bug:
    // the letters' own positions (0,1,2 for "Foo"; 8,9 for "ar") are exact.
    expect(map).toEqual([0, 1, 2, 7, 7, 8, 9]);
    expect([0, 1, 2, 8, 9].map((i) => source[i].toLowerCase())).toEqual(["f", "o", "o", "a", "r"]);
  });

  it("drops leading/trailing whitespace the same way trim() does, with no dangling map entries", () => {
    const { normalized, map } = normalizeWithAlignment("  foo  ");
    expect(normalized).toBe("foo");
    expect(map.length).toBe(3);
  });

  it("normalizes to empty for punctuation-only input, with an empty map", () => {
    const { normalized, map } = normalizeWithAlignment("...");
    expect(normalized).toBe("");
    expect(map).toEqual([]);
  });
});

describe("ALL_FIELD_TYPES", () => {
  it("names exactly the four real field types — a runtime companion to the satisfies-based compile-time check", () => {
    expect(new Set(ALL_FIELD_TYPES)).toEqual(new Set(["text", "date", "checkbox", "enum"]));
  });
});

// One of the four fields scripts/fill-3500.py and form-3500-fields.ts both
// document as carrying a real PDF /Opt defect — "AS NECESSARY - AN" is a
// legal member of options[] but never a legitimate answer (Issue #41's
// fixed-choice narrative-extraction fixtures below rely on the same fact).
const DISALLOWED_ENUM_FIELD = FORM_3500_FIELDS.find(
  (f) => f.id === "Page4.Prod1.Prod1StrengthUnit",
)!;
const FIELDS_WITH_DISALLOWED: FormFieldSpec[] = [...FIELDS, DISALLOWED_ENUM_FIELD];

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

  // Issue #41: the narrative-extraction pass sweeps fixed-choice fields too
  // (design.md "Extraction scope" — v1's blanket not_extractable_field_type
  // exclusion doesn't carry over to it), opted into per-call via
  // allowedTypes rather than as a new default — every test above this point
  // exercises the unchanged default ["text", "date"] and must keep passing
  // unmodified.
  describe("fixed-choice fields, opted in via allowedTypes", () => {
    const ALL_TYPES = ALL_FIELD_TYPES;

    it("accepts a grounded checkbox value of \"true\"", () => {
      const transcript = transcriptWith("she was hospitalized overnight");
      const candidate: ExtractionCandidate = {
        fieldId: CHECKBOX_FIELD.id,
        kind: "value",
        value: "true",
        quote: { turnIndex: 1, text: "hospitalized overnight" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS, ALL_TYPES);
      expect(result.accepted).toEqual([{ fieldId: CHECKBOX_FIELD.id, type: "answer", value: "true" }]);
      expect(result.rejected).toEqual([]);
    });

    it("accepts a grounded checkbox value of \"false\" — an explicit negative is as real a proposal as an affirmative", () => {
      const transcript = transcriptWith("no airway compromise at any point");
      const candidate: ExtractionCandidate = {
        fieldId: CHECKBOX_FIELD.id,
        kind: "value",
        value: "false",
        quote: { turnIndex: 1, text: "no airway compromise" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS, ALL_TYPES);
      expect(result.accepted).toEqual([{ fieldId: CHECKBOX_FIELD.id, type: "answer", value: "false" }]);
    });

    it("rejects a checkbox value that isn't literally \"true\" or \"false\" — matches fill-3500.py's own contract", () => {
      const transcript = transcriptWith("yes, that happened");
      const candidate: ExtractionCandidate = {
        fieldId: CHECKBOX_FIELD.id,
        kind: "value",
        value: "yes",
        quote: { turnIndex: 1, text: "yes, that happened" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS, ALL_TYPES);
      expect(result.accepted).toEqual([]);
      expect(result.rejected).toEqual([{ candidate, reason: "not_a_legal_option" }]);
    });

    it("accepts a grounded enum value that's a real option on the manifest", () => {
      // A field found by explicit id, not ENUM_FIELD (whichever enum
      // field happens to sort first) — several manifest enum fields share
      // UNIT_OPTIONS, whose own index 1 is the disallowed value covered
      // below, so picking "some enum field's option by position" is not a
      // safe way to construct a plain-acceptance fixture.
      const freqField = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1Freq")!;
      const transcript = transcriptWith("taken twice a day");
      const candidate: ExtractionCandidate = {
        fieldId: freqField.id,
        kind: "value",
        value: "BID",
        quote: { turnIndex: 1, text: "twice a day" },
      };
      const result = validateCandidates(transcript, [candidate], [...FIELDS, freqField], ALL_TYPES);
      expect(result.accepted).toEqual([{ fieldId: freqField.id, type: "answer", value: "BID" }]);
    });

    it("rejects an enum value that isn't one of the field's legal options", () => {
      const transcript = transcriptWith("taken twice a day");
      const candidate: ExtractionCandidate = {
        fieldId: ENUM_FIELD.id,
        kind: "value",
        value: "not a real option on this field",
        quote: { turnIndex: 1, text: "twice a day" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS, ALL_TYPES);
      expect(result.accepted).toEqual([]);
      expect(result.rejected).toEqual([{ candidate, reason: "not_a_legal_option" }]);
    });

    it("rejects the blank placeholder option — an \"answered\" entry must carry a non-blank value", () => {
      const blank = DISALLOWED_ENUM_FIELD.options!.find((o) => o.trim().length === 0)!;
      const transcript = transcriptWith("not sure of the unit");
      const candidate: ExtractionCandidate = {
        fieldId: DISALLOWED_ENUM_FIELD.id,
        kind: "value",
        value: blank,
        quote: { turnIndex: 1, text: "not sure" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS_WITH_DISALLOWED, ALL_TYPES);
      expect(result.rejected).toEqual([{ candidate, reason: "not_a_legal_option" }]);
    });

    it("rejects a disallowed enum value even though it's a real member of options[] — the documented PDF /Opt defect", () => {
      const transcript = transcriptWith("dosed as necessary");
      const candidate: ExtractionCandidate = {
        fieldId: DISALLOWED_ENUM_FIELD.id,
        kind: "value",
        value: "AS NECESSARY - AN",
        quote: { turnIndex: 1, text: "dosed as necessary" },
      };
      // Sanity check the fixture itself: if this ever stops being a real
      // option, the rejection below would pass for the wrong reason.
      expect(DISALLOWED_ENUM_FIELD.options).toContain("AS NECESSARY - AN");
      const result = validateCandidates(transcript, [candidate], FIELDS_WITH_DISALLOWED, ALL_TYPES);
      expect(result.rejected).toEqual([{ candidate, reason: "not_a_legal_option" }]);
    });

    it("still rejects a field type not named in the given allowedTypes, even when other fixed-choice types are opted in", () => {
      const transcript = transcriptWith("twice a day");
      const candidate: ExtractionCandidate = {
        fieldId: ENUM_FIELD.id,
        kind: "value",
        value: ENUM_FIELD.options![1],
        quote: { turnIndex: 1, text: "twice a day" },
      };
      // checkbox opted in, enum deliberately left out
      const result = validateCandidates(transcript, [candidate], FIELDS, ["text", "date", "checkbox"]);
      expect(result.rejected).toEqual([{ candidate, reason: "not_extractable_field_type" }]);
    });

    it("an unknown/declined candidate on a fixed-choice field needs no legal-option check — it carries no value", () => {
      const transcript = transcriptWith("we don't have her exact route on file");
      const candidate: ExtractionCandidate = {
        fieldId: ENUM_FIELD.id,
        kind: "unknown",
        quote: { turnIndex: 1, text: "don't have her exact route" },
      };
      const result = validateCandidates(transcript, [candidate], FIELDS, ALL_TYPES);
      expect(result.accepted).toEqual([{ fieldId: ENUM_FIELD.id, type: "mark_unknown" }]);
    });
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
