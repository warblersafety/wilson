// docs/ask-copy.md rule 5's gates: the topics that are out of a report
// they don't belong to, and the conditions that put them back in.
//
// The point is not tidiness, it's that a pure adverse-reaction report — a
// rash from an antibiotic — should not walk a clinician through ten
// questions about device model numbers and UDI codes before it will let
// them finish. v1.1 asked all of them, every time.
//
// **Gated-off is never confirmed-absent.** A closed gate means "not part
// of this report", not "no". Nothing writes `"false"` to a gated field,
// its topic is excluded from the walk, from the open-fields dialog, and
// from the counts, and its rail row says so in those words.
//
// **Gates are record-derived, and re-evaluated on every walk** (rule 5's
// "Timing"): a product type stated at SP-6 opens availability and
// purchase, and the walk reaches the newly opened topic on its next pass.
// That mid-flow insertion is the contract's deliberate choice over
// evaluating once on arrival, "because the alternative silently skips
// exactly the cases the gate exists to include".
//
// What this file does NOT provide is a way for a clinician to open a gate
// by CLICKING — rule 5's "add affordance". That path needs state the
// record cannot hold (a reopen on an untouched field is a no-op), and its
// mechanism is warblersafety/wilson#99's own design question. Until it
// lands, a device that was never mentioned is reachable by SAYING so —
// any Section E field the widened sweep writes opens the gate — but not
// by pointing at it.
import type { AgendaRecord } from "./agenda";
import { GATED_TOPIC_IDS } from "./ask-inventory";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import type { ProposedAction } from "./talk";

const DEVICE_FIELD_PREFIX = "Page6.SecE_Device.";

// Rule 5: the report involves a product problem, a use error, or a
// manufacturer switch.
const PRODUCT_PROBLEM_FIELDS = [
  "Page1.SecA_Patient.RepError",
  "Page1.SecA_Patient.Defects",
  "Page1.SecA_Patient.DiffManu",
];

// Rule 5: "a product type in {OTC, compounded, cannabinoid, cosmetic}" —
// both suspect-product instances, and cosmetic is two manifest fields.
const AVAILABILITY_PRODUCT_TYPE_FIELDS = [
  "Page4.Prod1.Prod1OTC",
  "Page4.Prod1.Prod1Compounded",
  "Page4.Prod1.Prod1Cannabi",
  "Page4.Prod1.Prod1CosRetail",
  "Page4.Prod1.Prod1CosmProf",
  "Page5.Prod2.Prod2OTC",
  "Page5.Prod2.Prod2Compounded",
  "Page5.Prod2.Pdt2Cannabi",
  "Page5.Prod2.Pdt2CosRetail",
  "Page5.Prod2.pdt2CosmProf",
];

// A checkbox the clinician (or a validated proposal) put a true in.
// Answered-`"false"` is a real answer meaning NO, so it opens nothing —
// which is the whole difference between rule 7's negatives and silence.
function checkedTrue(record: AgendaRecord, fieldId: string): boolean {
  const entry = record[fieldId];
  return entry?.state === "answered" && entry.value === "true";
}

// Any evidence at all that this field has been part of the conversation:
// an answer, an "I don't have it", a decline, or a value retained through
// a reopen. Deliberately wider than `isResolved` — a clinician who
// answered a device question and then reopened it has not stopped having
// a device.
function touched(record: AgendaRecord, fieldId: string): boolean {
  const entry = record[fieldId];
  return entry !== undefined && (entry.state !== "unasked" || entry.value !== undefined);
}

// Rule 5, Section E: "a medical device is part of the report — any
// Section E field has a validated proposal, or the clinician says so".
// No ask voices devices, so this is the speaking path.
export function isDeviceReport(record: AgendaRecord): boolean {
  return Object.keys(record).some((fieldId) => fieldId.startsWith(DEVICE_FIELD_PREFIX) && touched(record, fieldId));
}

// Rule 5, product-availability and suspect-product purchase. "Pure
// adverse-reaction reports skip both — and can regain both late."
export function involvesProductHandling(record: AgendaRecord): boolean {
  if (PRODUCT_PROBLEM_FIELDS.some((id) => checkedTrue(record, id))) return true;
  if (AVAILABILITY_PRODUCT_TYPE_FIELDS.some((id) => checkedTrue(record, id))) return true;
  return isDeviceReport(record);
}

// Whether a topic is currently out of the report. Non-gated topics are
// never gated off, whatever the record says.
export function isTopicGatedOff(topicId: string, record: AgendaRecord): boolean {
  if (!GATED_TOPIC_IDS.has(topicId)) return false;
  if (topicId.startsWith("device-")) return !isDeviceReport(record);
  return !involvesProductHandling(record);
}

// The rail's own words for a gated-off row (rule 5).
export const GATED_OFF_RAIL_STATE = "not part of this report — add from Review if needed";

// Rule 5's last clause, the lab table's own gate: "Row N+1 accepts
// content only while row N holds content other than the literal 'None'."
//
// The table is eight rows the clinician never sees as rows — LD-1 asks
// one question and extraction distributes the answer "in stated order".
// Without this, a model that put the second test in row 5 would leave
// rows 2-4 permanently blank on the form and the report would read as
// though four tests were missing. And a clinician who said "no labs" —
// rule 7 writes the literal "None" to row 1 — must not then acquire a
// row 2 from a later volunteered turn without row 1 being revisited.
const LAB_ROW_ANCHORS = Array.from({ length: 8 }, (_, i) => {
  const row = i + 1;
  return `Page3.TestDataTable.Row${row}.TestData${row}`;
});

const LAB_ROW_OF = new Map<string, number>();
for (const field of FORM_3500_FIELDS) {
  const match = field.id.match(/^Page3\.TestDataTable\.Row\d+\.(?:TestData|TLowRange|THighRange|TDate)(\d+)$/);
  if (match) LAB_ROW_OF.set(field.id, Number(match[1]));
}

function rowHasContent(record: AgendaRecord, writes: ProposedAction[], row: number): boolean {
  const anchor = LAB_ROW_ANCHORS[row - 1];
  const write = writes.find((w) => w.fieldId === anchor);
  const value = write?.type === "answer" ? write.value : record[anchor]?.state === "answered" ? record[anchor].value : undefined;
  return value !== undefined && value.trim().toLowerCase() !== "none";
}

// Drops any lab write whose row is not yet reachable. Rows are considered
// in order within the same batch, so one turn may legitimately fill rows
// 1 and 2 at once — the ask asks for every test at once, and the answer
// arrives as one message.
export function filterLabRowOverflow(record: AgendaRecord, writes: ProposedAction[]): ProposedAction[] {
  return writes.filter((write) => {
    const row = LAB_ROW_OF.get(write.fieldId);
    if (row === undefined || row === 1) return true;
    // Every earlier row must hold real content, not a gap and not "None".
    for (let earlier = 1; earlier < row; earlier += 1) {
      if (!rowHasContent(record, writes, earlier)) return false;
    }
    return true;
  });
}
