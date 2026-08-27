// Prints the TalkSession IntakeFlow persists after a Read-back confirm —
// a real startTalk()'ed session, no model call — so a scripted end-to-end
// run can begin at Follow-ups without an ANTHROPIC_API_KEY. Exists for
// design.md's full-session artifact rule (a UI unit's PR carries the
// complete transcript and a screenshot of every surface state a scripted
// run traverses); it is tooling for that proof, never shipped behavior.
//
//   npx tsx scripts/artifact-seed.ts > seed.json
//   # then, in the browser: localStorage.setItem("wilson.talk-session.v1", <seed>)
import { applyAction } from "../src/lib/agenda";
import { askDeterministic } from "../src/lib/ask";
import { initTalkSession, startTalk } from "../src/lib/talk";

const NARRATIVE =
  "61-year-old on amoxicillin-clavulanate for a dental abscess developed a diffuse " +
  "maculopapular rash and low-grade fever on day 4. Drug stopped, rash resolved over a week.";

// A plausible post-Read-back state: the narrative already yielded the
// patient's identifier and age, and nothing else.
const FROM_THE_NARRATIVE: ReadonlyArray<readonly [string, string]> = [
  ["Page1.SecA_Patient.PatientIdentifier", "MRN 44-1902"],
  ["Page1.SecA_Patient.AgeValue", "61"],
];

async function main() {
  const base = initTalkSession();
  const record = FROM_THE_NARRATIVE.reduce(
    (rec, [fieldId, value]) => applyAction(rec, fieldId, { type: "answer" }, value),
    base.record,
  );
  const step = await startTalk(
    { ...base, record, transcript: [{ role: "clinician", text: NARRATIVE }] },
    { ask: askDeterministic },
  );
  process.stdout.write(JSON.stringify(step.session));
}

void main();
