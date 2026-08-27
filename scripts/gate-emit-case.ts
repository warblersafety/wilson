// Emits one round-gate case as JSON, for the browser driver to consume
// (Issue #96). The driver is a plain .mjs run from a scratch directory
// with Playwright installed — Playwright is deliberately not a repo
// dependency — it would put a browser download into every CI install —
// so it cannot import this repo's TypeScript. This is the bridge.
//
// Emits three things a run needs kept together:
//   - `case`:     the steps to perform, and the surfaces they must reach
//   - `script`:   what the fake extractor answers (src/lib/scripted-extract.ts)
//   - `expected`: the walk the simulator says these steps produce
//
// `expected` is what makes the run checkable rather than merely recorded:
// the driver compares the transcript the BROWSER produced against the
// session the same case produces through the pure machinery, so a
// surface that renders something the session never said is a failure and
// not a screenshot nobody reads.
//
//   npx tsx scripts/gate-emit-case.ts C3 > case.json
import { GATE_CASES, gateCase, scriptFor, type GateCase } from "../fixtures/gate/cases";
import { simulateCase, seedFromNarrative } from "../src/lib/gate-simulate";
import { ALL_FIELD_TYPES, validateCandidates } from "../src/lib/extraction-validator";
import { FORM_3500_FIELDS } from "../src/lib/form-3500-fields";
import { initTalkSession, type TalkSession } from "../src/lib/talk";

// The record a case's narrative leaves behind once Read-back is
// confirmed. Runs the narrative's scripted candidates through the SAME
// validator the app does, so a case whose narrative quote does not
// actually appear in its narrative text seeds nothing here — exactly as
// it would write nothing there.
export function seedFor(gateCase: GateCase): TalkSession {
  if (!gateCase.narrative) return initTalkSession();
  const stamped = gateCase.narrative.candidates.map((candidate) =>
    candidate.kind === "value"
      ? { ...candidate, quote: { turnIndex: 0, text: candidate.quote } }
      : { ...candidate, quote: { turnIndex: 0, text: candidate.quote } },
  );
  const { accepted, rejected } = validateCandidates(
    [{ role: "clinician", text: gateCase.narrative.text }],
    stamped as never,
    FORM_3500_FIELDS,
    ALL_FIELD_TYPES,
  );
  if (rejected.length > 0) {
    throw new Error(
      `gate: case ${gateCase.id}'s narrative has ungrounded candidates: ` +
        rejected.map((r) => `${r.candidate.fieldId} (${r.reason})`).join(", "),
    );
  }
  return seedFromNarrative(gateCase.narrative.text, accepted);
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    throw new Error(`usage: gate-emit-case.ts <case>  (have: ${GATE_CASES.map((c) => c.id).join(", ")})`);
  }
  const found = gateCase(id);
  const followOn = found.thenStartOver ? gateCase(found.thenStartOver) : null;

  const simulate = async (c: GateCase) => {
    const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
    if (result.mismatches.length > 0) {
      throw new Error(`gate: case ${c.id} no longer matches the walk:\n  ${result.mismatches.join("\n  ")}`);
    }
    return result;
  };

  const primary = await simulate(found);
  const secondary = followOn ? await simulate(followOn) : null;

  process.stdout.write(
    JSON.stringify(
      {
        case: found,
        followOn,
        script: scriptFor(found),
        expected: {
          transcript: primary.session.transcript,
          record: primary.session.record,
          steps: primary.steps,
          ...(secondary ? { followOn: { transcript: secondary.session.transcript, steps: secondary.steps } } : {}),
        },
      },
      null,
      2,
    ),
  );
}

void main();
