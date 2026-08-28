// Fixture corpus for the real Extractor (Issue #22), consumed by both
// `npm run eval:dry` (structural check, no API calls, every PR) and
// `npm run eval:extraction` (live sweep against wilson-evals, workflow_dispatch
// only). Built programmatically against the real 227-field manifest and
// TOPICS — not a hand-typed field-id list — same "verify against the real
// thing, don't hand-enumerate" practice topics.test.ts already uses.
import { applyAction, initAgenda, type AgendaRecord } from "../../src/lib/agenda";
import type { ProposedAction, TalkTurn } from "../../src/lib/talk";
import { AUTHORED_ASKS } from "../../src/lib/ask-inventory";
import { TOPICS, initRepeatCounts, type RepeatCounts, type RepeatGroup } from "../../src/lib/topics";

export interface ExtractionFixture {
  id: string;
  description: string;
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
  transcript: TalkTurn[];
  message: string;
  expected: {
    actions: ProposedAction[];
    repeatDecision?: { repeatGroup: RepeatGroup; count: number };
  };
}

function declineAll(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "decline" }), record);
}

// Declines every field a named ask waits on, leaving that topic's NEXT
// ask as the open step. Ask granularity, not topic granularity: a topic
// carries several authored asks now (docs/ask-copy.md), so declining a
// whole topic would walk past the one a fixture wants to sit on.
function declineThroughAsk(record: AgendaRecord, askId: string): AgendaRecord {
  const ask = AUTHORED_ASKS.find((a) => a.id === askId);
  if (!ask) throw new Error(`no such ask: ${askId}`);
  return declineAll(record, ask.askFieldIds);
}

// Declines every topic up to and including the named one, in TOPICS' own
// walk order — the same order nextStep() uses — leaving the topic right
// after it as the open step.
function declineThroughTopic(record: AgendaRecord, topicId: string): AgendaRecord {
  const idx = TOPICS.findIndex((t) => t.id === topicId);
  if (idx === -1) throw new Error(`no such topic: ${topicId}`);
  return TOPICS.slice(0, idx + 1).reduce((rec, t) => declineAll(rec, t.fieldIds), record);
}

export const EXTRACTION_FIXTURES: ExtractionFixture[] = [
  {
    id: "patient-identifier-and-age",
    description: "direct value answers for two of one ask's own facts, bundled in one message",
    record: initAgenda(),
    repeatCounts: initRepeatCounts(),
    // PB-1's authored copy, verbatim (docs/ask-copy.md). The date of
    // birth this fixture used to bundle in belongs to PB-2, a separate
    // ask — under the contract it would be an out-of-ask write, which is
    // the widened sweep's own case, not this one's.
    transcript: [
      { role: "talker", text: "Who is the patient — an identifier like an MRN or initials, their age, and sex?" },
    ],
    message: "MRN 44-1902, she's 42 years old.",
    expected: {
      actions: [
        { fieldId: "Page1.SecA_Patient.PatientIdentifier", type: "answer", value: "MRN 44-1902" },
        { fieldId: "Page1.SecA_Patient.AgeValue", type: "answer", value: "42" },
      ],
    },
  },
  {
    id: "patient-weight-and-dob",
    description: "a text value and a DATE value from one answer — the corpus's date-typed coverage",
    // PB-1 resolved, so PB-2 is the open ask. Its two facts are the
    // weight and the date of birth; the weight's lb/kg unit is a derive
    // companion that a bare number deliberately leaves open (rule 3), so
    // no unit action is expected here.
    record: declineThroughAsk(initAgenda(), "PB-1"),
    repeatCounts: initRepeatCounts(),
    // PB-2's authored copy, verbatim.
    transcript: [
      { role: "talker", text: "What's the patient's weight — and date of birth, if you record it?" },
    ],
    message: "About 68 kg, and she was born 3/15/1983.",
    expected: {
      actions: [
        { fieldId: "Page1.SecA_Patient.WeightValue", type: "answer", value: "68" },
        { fieldId: "Page1.SecA_Patient.DateBirth", type: "answer", value: "3/15/1983" },
      ],
    },
  },
  {
    id: "declined-medical-history",
    description: "an explicit decline is recognized as declined, not mistaken for unknown",
    record: declineThroughTopic(initAgenda(), "event-outcome"),
    repeatCounts: initRepeatCounts(),
    // MH-1's authored copy, verbatim.
    transcript: [
      {
        role: "talker",
        text: "Any relevant history — preexisting conditions, allergies, pregnancy, tobacco or alcohol use?",
      },
    ],
    message: "She'd rather not discuss the rest of her medical history.",
    expected: {
      actions: [{ fieldId: "Page3.Sec6Data.OtherHistory", type: "decline" }],
    },
  },
  {
    id: "repeat-decision-second-suspect-product",
    description: "clinician confirms a second suspect product exists, resolving the repeat-decision step",
    record: declineThroughTopic(initAgenda(), "suspect-product-1-purchase"),
    repeatCounts: initRepeatCounts(),
    // The authored repeat-decision copy, verbatim.
    transcript: [{ role: "talker", text: "Was there another suspect product?" }],
    message: "Yes, actually — she was also on a second medication, lisinopril.",
    expected: {
      actions: [],
      repeatDecision: { repeatGroup: "suspect-product", count: 2 },
    },
  },
];
