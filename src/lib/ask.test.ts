// The Talker's rendered copy, against docs/ask-copy.md. This replaces the
// v1.1 suite wholesale: every test in it proved a property of the
// label-template path (the last-colon-segment rule, the override table,
// the comma guard, the "(yes or no)" suffix, the MAX_FIELDS_PER_ASK cap),
// and rule 1 deletes that path rather than demoting it. What replaces
// those tests is the contract's own claim — a rendered ask EQUALS the
// authored copy, for every topic and both repeat instances.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  arrivalFrame,
  askCopy,
  askDeterministic,
  DONE_MESSAGE,
  REPEAT_DECISION_COPY,
  reAskFrame,
  VOLUNTEERED_REPEAT_HINT,
} from "./ask";
import { AUTHORED_ASKS, askApplies, unresolvedFactNames } from "./ask-inventory";
import { displayName } from "./display-names";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { initTalkSession, voiceStep, type TalkSession } from "./talk";
import { scriptedWalk } from "./ux-floor";
import { TOPICS } from "./topics";

// `voicedAskIds` defaults to none — a fresh sessionWith() is what a
// never-voiced arrival needs; a test exercising the ordinary re-ask
// frame passes the ask ids that must already read as voiced.
function sessionWith(record: AgendaRecord, voicedAskIds: string[] = []): TalkSession {
  return {
    ...initTalkSession(),
    record,
    voicedAsks: Object.fromEntries(voicedAskIds.map((id) => [id, true as const])),
  };
}

// Marks every field the given ask waits on as unknown — the "I don't have
// that" chip's own write path, and the only way to walk past an ask
// without inventing manifest-valid values.
function dismiss(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "mark_unknown" }), record);
}

// The walk driver lives in ux-floor.ts (Issue #91), not here: it is what
// the UX floor's count and no-repetition checks run over, and two
// definitions of "the scripted walk" that could quietly disagree is the
// one thing a floor must not have.

describe("authored ask copy", () => {
  // AC-1's structural test. Every ask, every topic, both repeat
  // instances — driven through askDeterministic, not read off the
  // inventory, so it proves what a clinician is actually shown.
  it("renders every authored ask, for every topic and both repeat instances, exactly as authored", async () => {
    const record = initAgenda();
    for (const ask of AUTHORED_ASKS) {
      if (!askApplies(ask, record)) continue;
      const topic = TOPICS.find((t) => t.id === ask.topicId)!;
      const step = { kind: "topic" as const, topic, ask, fieldIds: ask.askFieldIds };
      expect(await askDeterministic(step, sessionWith(record)), ask.id).toBe(ask.copy);
    }
  });

  it("covers both suspect-product instances with instance-specific copy", async () => {
    const sp1 = AUTHORED_ASKS.find((a) => a.id === "SP-1")!;
    const sp1of2 = AUTHORED_ASKS.find((a) => a.id === "SP-1-2")!;
    expect(sp1.copy).toContain("the suspect product");
    expect(sp1of2.copy).toContain("the second suspect product");
    expect(sp1.copy).not.toBe(sp1of2.copy);
  });

  // The exact defect Steve rejected on 2026-08-26.
  it("never renders a template marker, a manifest label, or a field id", () => {
    const labels = new Set(FORM_3500_FIELDS.map((f) => f.label));
    const rendered = [
      ...AUTHORED_ASKS.map((a) => a.copy),
      ...Object.values(REPEAT_DECISION_COPY),
      DONE_MESSAGE,
      VOLUNTEERED_REPEAT_HINT,
      ...FORM_3500_FIELDS.map((f) => displayName(f.id)),
    ];
    for (const text of rendered) {
      expect(text, text).not.toContain("(yes or no)");
      expect(text, text).not.toMatch(/Page\d|Prod\d\.|Sec[A-G]_/);
      for (const label of labels) {
        expect(text.includes(label), `${text} contains the manifest label ${label}`).toBe(false);
      }
    }
  });

  // Rule 8's voice: "one question mark per ask, no exclamation marks".
  // The exclamation half holds everywhere. The question-mark half does
  // not: six of the contract's OWN authored asks depart from it, and the
  // inventory is what AC-1 requires be rendered verbatim. Pinned as an
  // exact set rather than described in a comment (reviewer pass, PR #98,
  // finding 3 — my first description of it named the wrong asks), so
  // #91's UX floor can encode the exemption against a list a test keeps
  // honest, and an amendment to either side fails here first.
  it("never shouts — no exclamation marks anywhere in the authored copy", () => {
    for (const ask of AUTHORED_ASKS) expect(ask.copy, ask.id).not.toContain("!");
  });

  // Rule 8 as amended 2026-08-27 (#103): one QUESTION per ask, not one
  // question mark. An imperative ask carries none, an explicitly
  // two-part ask carries two. This pins the six the amendment names, so
  // a seventh appearing is a copy change someone has to justify.
  it("carries a non-standard question-mark count in exactly the six asks rule 8 names", () => {
    const departures = AUTHORED_ASKS
      // Instance 2 and concomitant instances 2-10 reuse the same copy
      // pattern; counting them would just multiply the same departures.
      .filter((a) => !/suspect-product-2|concomitant-medication-([2-9]|10)/.test(a.topicId))
      .map((a) => ({ id: a.id, marks: (a.copy.match(/\?/g) ?? []).length }))
      .filter((a) => a.marks !== 1);
    expect(departures).toEqual([
      // Imperatives, not questions — no question mark at all.
      { id: "WH-1", marks: 0 },
      { id: "SP-2", marks: 0 },
      // Deliberate two-part questions.
      { id: "SP-4", marks: 2 },
      { id: "DV-2", marks: 2 },
      { id: "DV-3", marks: 2 },
      { id: "RA-2", marks: 2 },
    ]);
  });
});

describe("rule 9's re-ask frames", () => {
  // AC for #100: no re-ask may recite a field list. Checked at every
  // single-field-resolved state, which is where the most facts are still
  // open and therefore where a frame is longest. Four, not three: SP-4
  // names therapy start date, stop date, status, and dose-reduced-on —
  // four distinct clinical facts, not a recited field list. The bound
  // that carries the unit is the bulk-mapped one below.
  it("never names more than four facts, for any ask at any partial state", () => {
    const record = initAgenda();
    for (const ask of AUTHORED_ASKS) {
      for (const resolved of ask.askFieldIds) {
        const partial = { ...record, [resolved]: { state: "answered" as const, value: "x" } };
        const names = unresolvedFactNames(ask, partial);
        if (names.length === 0) continue;
        expect(names.length, `${ask.id} after resolving ${resolved}: ${names.join(" / ")}`).toBeLessThanOrEqual(4);
      }
    }
  });

  // The structural bound, on the three asks rule 9 names — not on a field
  // count, which is the wrong discriminator: SP-6 owns nine fields and
  // correctly names two facts ("product type" and "expiration date").
  // These three map their whole field set onto ONE fact from one answer,
  // so enumerating them reproduces the recite-the-field-list defect
  // through copy every equality check passes.
  it("resolves each bulk-mapped ask to exactly one fact, at every partial state", () => {
    const record = initAgenda();
    const bulkMapped = ["RC-1", "DV-1", "SP-9", "SP-9-2"];
    for (const askId of bulkMapped) {
      const ask = AUTHORED_ASKS.find((a) => a.id === askId)!;
      expect(ask.askFieldIds.length, askId).toBeGreaterThanOrEqual(8);
      for (const resolved of ask.askFieldIds) {
        const partial = { ...record, [resolved]: { state: "answered" as const, value: "x" } };
        expect(unresolvedFactNames(ask, partial), `${askId} after resolving ${resolved}`).toHaveLength(1);
      }
    }
  });

  // The "rest of" lines stay RE-ASK-ONLY (voicedThisReport: true): rule
  // 9's amendment adds a SEPARATE, byte-distinct arrival line for a
  // bulk-mapped ask's first partial appearance (below) — this frame is
  // what fires once the ask has already been voiced and is partial
  // again.
  it("re-asks each bulk-mapped ask, once voiced, as one authored line, never as its field list", () => {
    const record = initAgenda();
    for (const [askId, expected] of [
      ["RC-1", "And the rest of your contact details?"],
      ["DV-1", "And the rest of the device details?"],
      ["SP-9", "And the rest of the purchase details?"],
      ["SP-9-2", "And the rest of the purchase details?"],
    ] as const) {
      const ask = AUTHORED_ASKS.find((a) => a.id === askId)!;
      const partial = { ...record, [ask.askFieldIds[0]]: { state: "answered" as const, value: "x" } };
      expect(askCopy(ask, partial, true), askId).toBe(expected);
    }
  });

  it("leaves every other ask's frames as authored — PB-1 still names its own facts", () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const partial = { ...initAgenda(), [pb1.askFieldIds[0]]: { state: "answered" as const, value: "MRN 1" } };
    expect(askCopy(pb1, partial, true)).toBe("Got it. Still need: age and sex.");
  });

  it("names one still-open fact with the short frame", () => {
    expect(reAskFrame(["age"])).toBe("And the age?");
  });

  it("lists several with the long frame", () => {
    expect(reAskFrame(["age", "sex: male"])).toBe("Got it. Still need: age and sex: male.");
    expect(reAskFrame(["age", "weight", "date of birth"])).toBe(
      "Got it. Still need: age, weight, and date of birth.",
    );
  });

  it("refuses to compose a frame naming nothing", () => {
    expect(() => reAskFrame([])).toThrow(/at least one/);
  });

  // The contract's own reason for the frames: "A frame is never
  // byte-equal to the primary ask, so the no-consecutive-duplicates check
  // holds across the pair." Voiced explicitly (PB-1 already shown this
  // report) — this is the re-ask path, not the first-voicing arrival
  // path below, and #125 makes that precondition load-bearing rather
  // than implicit.
  it("re-asks a partly answered, already-voiced ask by naming only what is still open", async () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const topic = TOPICS.find((t) => t.id === pb1.topicId)!;
    const record = applyAction(initAgenda(), pb1.askFieldIds[0], { type: "answer" }, "MRN 44-1902");
    const step = { kind: "topic" as const, topic, ask: pb1, fieldIds: pb1.askFieldIds.slice(1) };
    const rendered = await askDeterministic(step, sessionWith(record, ["PB-1"]));
    // Facts, not fields: the sex one-hot is one fact, named once.
    expect(rendered).toBe("Got it. Still need: age and sex.");
    expect(rendered).toBe(reAskFrame(unresolvedFactNames(pb1, record)));
    expect(rendered).not.toBe(pb1.copy);
    expect(rendered).not.toContain(displayName(pb1.askFieldIds[0]));
  });

  it("returns to the primary copy while nothing in the ask is resolved, voiced or not", () => {
    const pb2 = AUTHORED_ASKS.find((a) => a.id === "PB-2")!;
    expect(askCopy(pb2, initAgenda(), false)).toBe(pb2.copy);
    expect(askCopy(pb2, initAgenda(), true)).toBe(pb2.copy);
  });

  it("refuses to compose copy for an ask with nothing left to ask, voiced or not", () => {
    const pb2 = AUTHORED_ASKS.find((a) => a.id === "PB-2")!;
    const record = dismiss(initAgenda(), pb2.askFieldIds);
    expect(() => askCopy(pb2, record, false)).toThrow(/nothing left to ask/);
    expect(() => askCopy(pb2, record, true)).toThrow(/nothing left to ask/);
  });
});

describe("rule 9's first voicing (#125)", () => {
  // Gate run #1, entry 1: on dev 7f8f1bd, a topic reached already
  // partially resolved (narrative extraction, or an out-of-ask write)
  // rendered rule 9's re-ask frame as its FIRST utterance — "And the
  // rest of the device details?", eight identifiers the clinician never
  // saw. The arrival frame is what a never-voiced partial renders
  // instead, and reaching it through askDeterministic (not askCopy
  // directly) proves the walk's own session shape carries voicedAsks
  // correctly, not just the pure helper.
  it("renders the arrival frame, not the bare re-ask frame, on a never-voiced partial", async () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const topic = TOPICS.find((t) => t.id === pb1.topicId)!;
    // AgeValue resolved (as narrative extraction would from "61-year-old"),
    // PB-1 never asked before — the exact shape of C1's opening turn.
    const record = applyAction(initAgenda(), pb1.askFieldIds[1], { type: "answer" }, "61");
    const step = { kind: "topic" as const, topic, ask: pb1, fieldIds: [pb1.askFieldIds[0], ...pb1.askFieldIds.slice(2)] };
    const rendered = await askDeterministic(step, sessionWith(record));
    expect(rendered).toBe("I've got age. Still need: patient identifier and sex.");
    expect(rendered).toBe(arrivalFrame(pb1, record));
    expect(rendered).not.toBe(reAskFrame(unresolvedFactNames(pb1, record)));
  });

  it("composes the arrival frame from resolved and open fact names, general case", () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const record = applyAction(initAgenda(), pb1.askFieldIds[0], { type: "answer" }, "MRN 44-1902");
    expect(arrivalFrame(pb1, record)).toBe("I've got patient identifier. Still need: age and sex.");
  });

  // Reviewer pass, PR #136, finding 2: a fact with one field resolved and
  // a sibling still open used to be named on both halves of the frame
  // ("I've got sex. Still need: patient identifier, age, and sex.").
  it("never names a fact on both halves of the frame, even when a sibling field is still open", () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const record = {
      ...initAgenda(),
      [pb1.askFieldIds[0]]: { state: "answered" as const, value: "MRN 1" },
      [pb1.askFieldIds[2]]: { state: "answered" as const, value: "true" },
    };
    expect(arrivalFrame(pb1, record)).toBe("I've got patient identifier. Still need: age and sex.");
    expect(arrivalFrame(pb1, record)).not.toContain("sex. Still need");
  });

  // The three bulk-mapped facts cannot split into resolved/open fact
  // names (they ARE one fact) — the amendment gives them an authored
  // arrivalAsk line instead, prefixed by the individual HELD field
  // names so "the rest" has a referent. Byte-distinct from the re-ask
  // "And the rest of..." lines pinned above.
  it("composes the bulk arrival line, held field names prefixed, never bare", () => {
    const dv1 = AUTHORED_ASKS.find((a) => a.id === "DV-1")!;
    const record = applyAction(initAgenda(), dv1.askFieldIds[0], { type: "answer" }, "EpiPen");
    expect(arrivalFrame(dv1, record)).toBe("I've got device brand name. What are the rest of the device details?");
    expect(arrivalFrame(dv1, record)).not.toBe("What are the rest of the device details?");
    expect(arrivalFrame(dv1, record)).not.toContain("And the rest of the device details?");
  });

  // Reviewer pass, PR #136, finding 8: called directly (bypassing
  // askCopy's own gating) on an ask nothing has arrived on yet, this used
  // to die inside joinNames() with a message naming no ask. Matches
  // reAskFrame's own precondition throw just above it.
  it("throws a named error, not joinNames' generic one, called directly on a fully-open ask", () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    expect(() => arrivalFrame(pb1, initAgenda())).toThrow(/^arrivalFrame: PB-1 is fully open/);
  });

  it("throws the same named error for a fully-open bulk-mapped ask", () => {
    const dv1 = AUTHORED_ASKS.find((a) => a.id === "DV-1")!;
    expect(() => arrivalFrame(dv1, initAgenda())).toThrow(/^arrivalFrame: DV-1 is fully open/);
  });

  // Discovered fixing finding 2, not anticipated by the review itself:
  // WH-2's "report type" fact is voicesEveryMember, so it never completes
  // from one answer — a record with only Defects resolved has SOMETHING
  // individually resolved (askCopy's gate lets this through) but nothing
  // wholly resolved (resolvedFactNames is empty). Real, not synthetic:
  // this is the exact shape "a scripted full walk" below seeds to reopen
  // the gated asks, and it used to crash arrivalFrame outright.
  it("falls back to the primary copy when something is individually resolved but no whole fact is", () => {
    const wh2 = AUTHORED_ASKS.find((a) => a.id === "WH-2")!;
    const record = applyAction(initAgenda(), "Page1.SecA_Patient.Defects", { type: "answer" }, "true");
    expect(arrivalFrame(wh2, record)).toBe(wh2.copy);
  });

  it("lists every held field for a bulk ask with more than one answered", () => {
    const rc1 = AUTHORED_ASKS.find((a) => a.id === "RC-1")!;
    const record = {
      ...initAgenda(),
      [rc1.askFieldIds[0]]: { state: "answered" as const, value: "Nguyen" },
      [rc1.askFieldIds[2]]: { state: "answered" as const, value: "12 Elm St" },
    };
    expect(arrivalFrame(rc1, record)).toBe(
      "I've got your last name and your address. What are the rest of your contact details?",
    );
  });

  describe("voiceStep", () => {
    it("marks a topic step's ask id voiced, additively", () => {
      const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
      const topic = TOPICS.find((t) => t.id === pb1.topicId)!;
      const step = { kind: "topic" as const, topic, ask: pb1, fieldIds: pb1.askFieldIds };
      const before = initTalkSession();
      expect(before.voicedAsks?.["PB-1"]).toBeUndefined();
      const after = voiceStep(before, step);
      expect(after.voicedAsks?.["PB-1"]).toBe(true);
      // Additive: marking one ask never un-marks another already voiced.
      const rc1Voiced = { ...after, voicedAsks: { ...after.voicedAsks, "RC-1": true as const } };
      const pb2 = AUTHORED_ASKS.find((a) => a.id === "PB-2")!;
      const pb2Step = { kind: "topic" as const, topic, ask: pb2, fieldIds: pb2.askFieldIds };
      const both = voiceStep(rc1Voiced, pb2Step);
      expect(both.voicedAsks).toEqual({ "PB-1": true, "RC-1": true, "PB-2": true });
    });

    it("is a no-op for a repeat-decision or done step — neither is an ask", () => {
      const session = initTalkSession();
      expect(voiceStep(session, { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 })).toBe(
        session,
      );
      expect(voiceStep(session, { kind: "done" })).toBe(session);
    });
  });
});

describe("machinery copy", () => {
  it("phrases each repeat decision as the contract authors it", async () => {
    const session = initTalkSession();
    expect(
      await askDeterministic({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 }, session),
    ).toBe("Was there another suspect product?");
    expect(
      await askDeterministic(
        { kind: "repeat-decision", repeatGroup: "concomitant-medication", afterInstance: 1 },
        session,
      ),
    ).toBe("Is there another medication to add?");
  });

  it("prefixes the volunteered-repeat hint without changing the decision's own copy", async () => {
    const session: TalkSession = { ...initTalkSession(), volunteeredRepeats: { "suspect-product": true } };
    const rendered = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      session,
    );
    expect(rendered).toBe(`${VOLUNTEERED_REPEAT_HINT}Was there another suspect product?`);
    expect(rendered).toContain(REPEAT_DECISION_COPY["suspect-product"]);
  });

  it("ends the walk with the contract's done message", async () => {
    expect(await askDeterministic({ kind: "done" }, initTalkSession())).toBe(
      "That's everything I need to ask. Review the report before you sign off.",
    );
  });
});

describe("a scripted full walk", () => {
  // ux-floor.ts's driver, so the copy claims here and the UX floor's
  // count and no-repetition checks (#91) run over the same walk.
  const walk = scriptedWalk();
  const asked = walk.map((turn) => turn.text);

  // The count the contract states, reached by actually walking rather
  // than by summing the inventory — 58-82 template asks is what Steve
  // was shown. The count itself is the UX floor's own check
  // (askCountViolations); what this pins is the shape around it — 21
  // asks and exactly two repeat decisions.
  it("asks the contract's 21 ungated questions plus the two repeat decisions, not 58-82", () => {
    // Exactly the count docs/ask-copy.md states for "the ungated
    // single-product no-device walk", now that rule 5's gates keep the
    // device, availability and purchase asks out of a report that is
    // none of those things.
    expect(walk.filter((turn) => turn.kind === "ask")).toHaveLength(21);
    expect(walk.filter((turn) => turn.kind === "repeat-decision")).toHaveLength(2);
    expect(walk).toHaveLength(23);
  });

  it("asks only authored strings", () => {
    const authored = new Set([...AUTHORED_ASKS.map((a) => a.copy), ...Object.values(REPEAT_DECISION_COPY)]);
    for (const question of asked) expect(authored.has(question), question).toBe(true);
  });

  it("never voices a gated topic in a report that is none of those things", () => {
    // A plain adverse-reaction walk: no device, no product problem, no
    // OTC/compounded/cannabinoid/cosmetic type. Rule 5 keeps all six
    // gated asks out of it.
    for (const gated of [
      "Where and when was it purchased — the store or website, and the date?",
      "Is the product itself still available — do you have it or a picture of it, or was it returned to the manufacturer, and when?",
    ]) {
      expect(asked, gated).not.toContain(gated);
    }
    expect(asked.some((q) => q.startsWith("What's the device"))).toBe(false);
    expect(asked.some((q) => q.startsWith("Who was operating the device"))).toBe(false);
    expect(asked.some((q) => q.startsWith("Two device-history checks"))).toBe(false);
  });

  it("brings the gated asks back the moment the record says they belong", () => {
    // Rule 5's Timing clause: a product problem stated mid-walk opens
    // availability and purchase, and the walk reaches them on its next
    // pass rather than having decided once on arrival.
    const opened = scriptedWalk(
      applyAction(initAgenda(), "Page1.SecA_Patient.Defects", { type: "answer" }, "true"),
    ).map((turn) => turn.text);
    expect(opened).toContain(
      "Is the product itself still available — do you have it or a picture of it, or was it returned to the manufacturer, and when?",
    );
    expect(opened).toContain("Where and when was it purchased — the store or website, and the date?");
    // Still no device asks: a product problem is not a device.
    expect(opened.some((q) => q.startsWith("What's the device"))).toBe(false);
  });
});
