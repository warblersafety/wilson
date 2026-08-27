// The round-gate cases against the machinery they drive (Issue #96).
//
// This is the half of the unit CI can hold. The browser driver produces
// the evidence and cannot run here (Playwright is deliberately not a
// repo dependency), but a case is only worth driving if its steps still
// describe the walk — and that is pure, fast, and exactly what breaks
// when the ask inventory changes. Without it, a contract amendment three
// units from now silently turns C3 into a case that types a lot-number
// answer at the outcome question, and nobody finds out until a gate run.
import { describe, expect, it } from "vitest";
import { GATE_CASES, GATE_SURFACES, gateCase, scriptFor, type GateCase, type GateTypeStep } from "../../fixtures/gate/cases";
import { seedFromNarrative, simulateCase } from "./gate-simulate";
import { ALL_FIELD_TYPES, validateCandidates } from "./extraction-validator";
import { fieldById, FORM_3500_FIELDS } from "./form-3500-fields";
import { initTalkSession, type TalkSession } from "./talk";
import { nextStep } from "./topics";

function seedFor(c: GateCase): TalkSession {
  if (!c.narrative) return initTalkSession();
  const stamped = c.narrative.candidates.map((candidate) => ({
    ...candidate,
    quote: { turnIndex: 0, text: candidate.quote },
  }));
  const { accepted } = validateCandidates(
    [{ role: "clinician", text: c.narrative.text }],
    stamped as never,
    FORM_3500_FIELDS,
    ALL_FIELD_TYPES,
  );
  return seedFromNarrative(c.narrative.text, accepted);
}

// C6 is not a walk of its own — it is C2's steps followed by a Start
// over into C3, and the browser driver owns that transition. Simulating
// it here would simulate C2 twice.
const WALK_CASES = GATE_CASES.filter((c) => c.thenStartOver === undefined);

describe("the pinned case set", () => {
  it("covers the six cases docs/round-gate.md names", () => {
    expect(GATE_CASES.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6"]);
  });

  // AC-2: the inputs are pinned in-repo. C2's was prose inside
  // docs/round-gate.md, quoted from a screenshot — so the case a run
  // drove was whatever the running session retyped.
  it("pins Steve's 2026-08-26 input verbatim", () => {
    expect(gateCase("C2").narrative?.text).toBe(
      "patient developed nagging cough while on lisinopril. reported yesterday, cough is non-serious but ongoing",
    );
  });

  it("every case declares which surfaces it must reach, from the known set", () => {
    for (const c of GATE_CASES) {
      expect(c.surfaces.length, c.id).toBeGreaterThan(0);
      for (const surface of c.surfaces) expect(GATE_SURFACES, `${c.id}/${surface}`).toContain(surface);
    }
  });

  // The union check the driver runs at the end of a full pass, asserted
  // here too: a surface no case declares is one no run can ever reach,
  // and the driver would then fail every time for a reason that is
  // really a fixture omission.
  it("the six cases between them declare every surface", () => {
    const declared = new Set(GATE_CASES.flatMap((c) => c.surfaces));
    expect([...GATE_SURFACES].filter((s) => !declared.has(s))).toEqual([]);
  });

  it("names only real manifest fields", () => {
    for (const c of GATE_CASES) {
      const script = scriptFor(c);
      const all = [...(script.narratives ?? []).flatMap((n) => n.candidates), ...script.turns.flatMap((t) => t.candidates)];
      for (const candidate of all) {
        expect(fieldById(candidate.fieldId), `${c.id}: ${candidate.fieldId}`).toBeDefined();
      }
    }
  });

  // A scripted candidate faces the real validator. One whose quote is
  // not in its own message is rejected there — silently, as far as the
  // walk is concerned — so a case could look rich and write nothing.
  it("every scripted candidate is really grounded in the message it cites", () => {
    for (const c of GATE_CASES) {
      const script = scriptFor(c);
      for (const narrative of script.narratives ?? []) {
        const stamped = narrative.candidates.map((x) => ({ ...x, quote: { turnIndex: 0, text: x.quote } }));
        const { rejected } = validateCandidates(
          [{ role: "clinician", text: narrative.narrative }],
          stamped as never,
          FORM_3500_FIELDS,
          ALL_FIELD_TYPES,
        );
        expect(rejected.map((r) => `${r.candidate.fieldId}:${r.reason}`), `${c.id} narrative`).toEqual([]);
      }
      for (const turn of script.turns) {
        const stamped = turn.candidates.map((x) => ({ ...x, quote: { turnIndex: 0, text: x.quote } }));
        const { rejected } = validateCandidates(
          [{ role: "clinician", text: turn.message }],
          stamped as never,
          FORM_3500_FIELDS,
          ALL_FIELD_TYPES,
        );
        expect(rejected.map((r) => `${r.candidate.fieldId}:${r.reason}`), `${c.id}: ${turn.message}`).toEqual([]);
      }
    }
  });
});

describe("each case still describes the walk it drives", () => {
  it.each(WALK_CASES.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    // Reported all at once: a drifted case has usually drifted at
    // several steps, and one exception per run is a miserable way to fix
    // it (see gate-simulate.ts).
    expect(result.mismatches).toEqual([]);
  });

  it.each(WALK_CASES.map((c) => [c.id, c] as const))("%s reaches the end of the walk", async (_id, c) => {
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    expect(nextStep(result.session.record, result.session.repeatCounts).kind).toBe("done");
  });
});

describe("the cases exercise what docs/round-gate.md says they exercise", () => {
  const replies = async (id: string) => {
    const c = gateCase(id);
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    return result.steps.map((s) => s.reply).join("\n");
  };

  // Entry 5's own case: a real answer that says "nothing" is recorded as
  // an answer, so the ask is never re-asked.
  it("C2 answers the text asks with negatives and is never re-asked them", async () => {
    const c = gateCase("C2");
    const messages = c.steps.filter((s): s is GateTypeStep => s.kind === "type").map((s) => s.message);
    expect(messages).toContain("no relevant history");
    expect(messages).toContain("nothing else to add");
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    const historyAsks = result.steps.filter((s) => s.askId === "MH-1");
    expect(historyAsks).toHaveLength(1);
  });

  // Entry 7, and the reason the pre-gate queue was sequenced around this
  // case: the collision reply must quote BOTH values (#109).
  it("C3 forces a same-turn collision that quotes both values", async () => {
    expect(await replies("C3")).toContain("I heard two values for strength: 500 mg and 875 mg — which should I write?");
  });

  it("C3 offers a cross-turn correction rather than overwriting", async () => {
    expect(await replies("C3")).toContain("You said 2026-08-19 for date of event — it's recorded as 2026-08-20. Replace it?");
  });

  it("C3 announces an out-of-ask write in rule 8's authored form", async () => {
    expect(await replies("C3")).toContain("Also noted — test 1: ALT 402.");
  });

  // Three concomitants is what makes #111's per-instance copy visible on
  // consecutive turns — the defect that case was filed for.
  it("C3 reaches three concomitants, each named apart", async () => {
    const text = await replies("C3");
    expect(text).toContain("What's the second medication");
    expect(text).toContain("What's the third medication");
  });

  it("C4 opens Section E's gate and runs its asks", async () => {
    const c = gateCase("C4");
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    const ids = result.steps.map((s) => s.askId);
    expect(ids).toContain("DV-1");
    expect(ids).toContain("DV-2");
    expect(ids).toContain("DV-3");
    // The device gate opens the product-handling one too (gates.ts's
    // involvesProductHandling falls through to isDeviceReport), so this
    // is also the case that evidences availability and purchase.
    expect(ids).toContain("PA-1");
    expect(ids).toContain("SP-9");
  });

  it("C5 forces rule 9's re-ask frames and uses both dismiss chips", async () => {
    const c = gateCase("C5");
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    expect(result.steps.map((s) => s.ask).join("\n")).toMatch(/Got it\. Still need:|And the /);
    const labels = c.steps.filter((s) => s.kind === "chip").map((s) => s.label);
    expect(labels).toContain("I don't have that");
    expect(labels).toContain("Rather not say");
  });

  it("C6 is C2's walk followed by a Start over into C3", () => {
    const c6 = gateCase("C6");
    expect(c6.thenStartOver).toBe("C3");
    expect(c6.steps).toEqual(gateCase("C2").steps);
    // Both dictations must be scripted: Start over does not restart the
    // server, so one process answers two cases.
    expect(scriptFor(c6).narratives?.map((n) => n.narrative)).toEqual([
      gateCase("C2").narrative?.text,
      gateCase("C3").narrative?.text,
    ]);
  });
});
