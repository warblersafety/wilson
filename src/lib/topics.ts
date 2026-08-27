// The Talker's conversation topics — how the 227 fields in
// form-3500-fields.ts group into the wizard's round-trip boundaries, per
// docs/design.md's "later unit's decision, not this one's" and the
// 2026-08-22 design conversation (Issue #16).
//
// A topic bundles the fields a clinician would naturally answer together
// in one message — this exists to minimize conversational round trips,
// not just to organize content. Most of a topic's fields are typically
// checkbox/enum (resolved via direct UI selection, per Issue #13 — no
// conversational turn at all); a topic's actual "ask" concerns only its
// text/date fields.
//
// Three groups repeat because the real PDF has a fixed number of
// identical slots, already fully enumerated in form-3500-fields.ts (no
// dynamic repetition needed at the Agenda/record level): Suspect
// Products (2 slots, 6 sub-topics each) and Concomitant Medications (10
// slots, 1 topic each). Section B's lab-data table (up to 8 rows) is
// NOT split into a repeating group here — its fields are treated as one
// "Lab data" topic rather than 8 separate repeat instances, since unlike
// the other two tables its rows aren't semantically independent entries
// a clinician decides one at a time to add ("is there another lab
// result?" reads oddly compared to "is there another medication?") — a
// call worth revisiting once real conversation design gets into this
// topic specifically.
//
// Assignment methodology: fields were grouped by their manifest LABEL
// text, not the raw PDF field id — the id has known-defective row
// numbering for the lab-data table (e.g. a field labeled "Row 3 — Date"
// carries the id ...Row8.TDate3), the same kind of PDF-authored defect
// already documented in form-3500-fields.ts's own comments. Verified
// programmatically before this file was written: every one of the 227
// fields assigned to exactly one topic, no gaps, no duplicates — see
// topics.test.ts for the same checks kept live against the manifest.
//
// nextStep()/RepeatCounts (below TOPICS) are what src/lib/talk.ts's
// orchestrator actually calls to decide what's next — see Issue #18.
// Resolving a repeat-decision from a clinician's actual answer (turning
// "yeah, there was a second one" into a count) is still out of scope
// here: that's real interpretation work for the not-yet-built Extractor,
// the same boundary Issue #13 already drew for checkbox/enum fields.
import { applyAction, type AgendaRecord } from "./agenda";
import { askApplies, asksForTopic, type AuthoredAsk } from "./ask-inventory";
import { isTopicGatedOff } from "./gates";
import { isResolved, type FieldState } from "./field-state";
import { FORM_3500_FIELDS, type FormFieldSpec, type FormSection } from "./form-3500-fields";

export type RepeatGroup = "suspect-product" | "concomitant-medication";

// A topic's shape, before its authored asks are attached. Split out only
// so the 34 literals below don't each have to carry their own — TOPICS
// itself is always the full Topic.
export type TopicShape = Omit<Topic, "asks">;

export interface Topic {
  id: string;
  section: FormSection;
  label: string;
  fieldIds: string[];
  repeatGroup: RepeatGroup | null;
  repeatInstance: number | null;
  // The authored asks this topic voices, in order (docs/ask-copy.md via
  // ask-inventory.ts). Carried ON the topic rather than looked up by id
  // inside nextStep(): talk.ts's Deps lets a caller substitute its own
  // topic list, and a global lookup would either throw on every synthetic
  // topic or need a fallback ask — and rule 1 admits no fallback. A topic
  // and the questions it asks travel together, so they cannot disagree.
  asks: AuthoredAsk[];
}

const TOPIC_SHAPES: TopicShape[] = [
  {
    id: "patient-basics",
    section: "A",
    label: "Patient basics",
    fieldIds: [
      "Page1.SecA_Patient.PatientIdentifier",
      "Page1.SecA_Patient.AgeValue",
      "Page1.SecA_Patient.AgeYears",
      "Page1.SecA_Patient.AgeMonths",
      "Page1.SecA_Patient.AgeWeeks",
      "Page1.SecA_Patient.AgeDays",
      "Page1.SecA_Patient.DateBirth",
      "Page1.SecA_Patient.SexM",
      "Page1.SecA_Patient.SexF",
      "Page1.SecA_Patient.WeightValue",
      "Page1.SecA_Patient.WeightLB",
      "Page1.SecA_Patient.WeightKG",
      "Page1.SecA_Patient.RaceAmInd",
      "Page1.SecA_Patient.RaceAsian",
      "Page1.SecA_Patient.RaceBlack",
      "Page1.SecA_Patient.EthnicLatino",
      "Page1.SecA_Patient.RaceMiddleEastern",
      "Page1.SecA_Patient.RacePacific",
      "Page1.SecA_Patient.RaceWhite",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "event-what-happened",
    section: "B",
    label: "What happened",
    fieldIds: [
      "Page1.SecA_Patient.RepAdverse",
      "Page1.SecA_Patient.RepError",
      "Page1.SecA_Patient.Defects",
      "Page1.SecA_Patient.DiffManu",
      "Page1.SecA_Patient.EventDate",
      "Page1.SecA_Patient.ReportDate",
      "Page2.SecB_Adverse.DescEvent",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "event-outcome",
    section: "B",
    label: "Outcome",
    fieldIds: [
      "Page1.SecA_Patient.Death",
      "Page1.SecA_Patient.DeathDate",
      "Page1.SecA_Patient.Hospital",
      "Page1.SecA_Patient.LifeThreaten",
      "Page1.SecA_Patient.Disability",
      "Page1.SecA_Patient.ReqdInter",
      "Page1.SecA_Patient.Congenital",
      "Page1.SecA_Patient.OtherEvents",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "event-medical-history",
    section: "B",
    label: "Medical history",
    fieldIds: [
      "Page3.Sec6Data.OtherHistory",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "event-lab-data",
    section: "B",
    label: "Lab data",
    fieldIds: [
      "Page3.TestDataTable.Row1.TestData1",
      "Page3.TestDataTable.Row1.TLowRange1",
      "Page3.TestDataTable.Row1.THighRange1",
      "Page3.TestDataTable.Row1.TDate1",
      "Page3.TestDataTable.Row2.TestData2",
      "Page3.TestDataTable.Row2.TLowRange2",
      "Page3.TestDataTable.Row2.THighRange2",
      "Page3.TestDataTable.Row2.TDate2",
      "Page3.TestDataTable.Row3.TestData3",
      "Page3.TestDataTable.Row3.TLowRange3",
      "Page3.TestDataTable.Row3.THighRange3",
      "Page3.TestDataTable.Row4.TestData4",
      "Page3.TestDataTable.Row4.TLowRange4",
      "Page3.TestDataTable.Row4.THighRange4",
      "Page3.TestDataTable.Row5.TestData5",
      "Page3.TestDataTable.Row5.TLowRange5",
      "Page3.TestDataTable.Row5.THighRange5",
      "Page3.TestDataTable.Row6.TestData6",
      "Page3.TestDataTable.Row6.TLowRange6",
      "Page3.TestDataTable.Row6.THighRange6",
      "Page3.TestDataTable.Row7.TestData7",
      "Page3.TestDataTable.Row7.TLowRange7",
      "Page3.TestDataTable.Row8.TestData8",
      "Page3.TestDataTable.Row8.TLowRange8",
      "Page3.TestDataTable.Row8.THighRange8",
      "Page3.TestDataTable.Row8.TDate8",
      "Page3.TestDataTable.Row8.THighRange7",
      "Page3.TestDataTable.Row8.TDate3",
      "Page3.TestDataTable.Row8.TDate4",
      "Page3.TestDataTable.Row8.TDate5",
      "Page3.TestDataTable.Row8.TDate6",
      "Page3.TestDataTable.Row8.TDate7",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "event-additional-comments",
    section: "B",
    label: "Anything else",
    fieldIds: [
      "Page3.AdditionalComments",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "product-availability",
    section: "C",
    label: "Product availability",
    fieldIds: [
      "Page3.TestDataTable.Row7.PicYes",
      "Page3.TestDataTable.ReturnDate",
      "Page3.TestDataTable.EvalRetd",
      "Page3.TestDataTable.EvalNo",
      "Page3.TestDataTable.EvalYes",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "suspect-product-1-identity",
    section: "D",
    label: "Suspect product #1: identity",
    fieldIds: [
      "Page4.Prod1.Prod1Name",
      "Page4.Prod1.Prod1Strength",
      "Page4.Prod1.Prod1StrengthUnit",
      "Page4.Prod1.Prod1NDC_ID",
      "Page4.Prod1.Prod1ManuComp",
      "Page4.Prod1.Prod1LotNum",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-1-dosing",
    section: "D",
    label: "Suspect product #1: dosing",
    fieldIds: [
      "Page4.Prod1.Prod1Dose",
      "Page4.Prod1.Prod1DoseUnit",
      "Page4.Prod1.Prod1Freq",
      "Page4.Prod1.Prod1FreqOther",
      "Page4.Prod1.Prod1Route",
      "Page4.Prod1.Prod1RouteOther",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-1-usage-timeline",
    section: "D",
    label: "Suspect product #1: usage timeline",
    fieldIds: [
      "Page4.Prod1.Prod1TherapyStartDate",
      "Page4.Prod1.Prod1TherapyStopDate",
      "Page4.Prod1.Prod1TherapyReduceDate",
      "Page4.Prod1.Prod1TherapyDuration",
      "Page4.Prod1.Prod1TherapyDurUnit",
      "Page4.Prod1.Prod1TherapyOngoingYes",
      "Page4.Prod1.Prod1TherapyOngoingNo",
      "Page4.Prod1.Prod1Diagnosis",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-1-type-and-expiration",
    section: "D",
    label: "Suspect product #1: type and expiration",
    fieldIds: [
      "Page4.Prod1.Prod1Compounded",
      "Page4.Prod1.Prod1CosmProf",
      "Page4.Prod1.Prod1ExpDate",
      "Page4.Prod1.Prod1Brand",
      "Page4.Prod1.Prod1Generic",
      "Page4.Prod1.Prod1OTC",
      "Page4.Prod1.Prod1PdtOther",
      "Page4.Prod1.Prod1Cannabi",
      "Page4.Prod1.Prod1CosRetail",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-1-response",
    section: "D",
    label: "Suspect product #1: response after stopping/restarting",
    fieldIds: [
      "Page4.Prod1.Prod1AbatedYes",
      "Page4.Prod1.Prod1AbatedNo",
      "Page4.Prod1.Prod1AbatedNA",
      "Page4.Prod1.Prod1ReappearYes",
      "Page4.Prod1.Prod1ReappearNo",
      "Page4.Prod1.Prod1ReappearNA",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-1-purchase",
    section: "D",
    label: "Suspect product #1: purchase details",
    fieldIds: [
      "Page4.Prod1.Prod1PlaceName",
      "Page4.Prod1.Prod1Address",
      "Page4.Prod1.Prod1Country",
      "Page4.Prod1.Prod1City",
      "Page4.Prod1.Prod1State",
      "Page4.Prod1.ZipCode",
      "Page4.Prod1.Prod1Website",
      "Page4.Prod1.Prod1PurchaseDate",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 1,
  },
  {
    id: "suspect-product-2-identity",
    section: "D",
    label: "Suspect product #2: identity",
    fieldIds: [
      "Page5.Prod2.Prod2Name",
      "Page5.Prod2.Prod2Strength",
      "Page5.Prod2.Prod2StrengthUnit",
      "Page5.Prod2.Prod2NDC_ID",
      "Page5.Prod2.Prod2ManuComp",
      "Page5.Prod2.Prod2LotNum",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "suspect-product-2-dosing",
    section: "D",
    label: "Suspect product #2: dosing",
    fieldIds: [
      "Page5.Prod2.Prod2Dose",
      "Page5.Prod2.Prod2DoseUnit",
      "Page5.Prod2.Prod2Freq",
      "Page5.Prod2.Prod2FreqOther",
      "Page5.Prod2.Prod2Route",
      "Page5.Prod2.Prod2RouteOther",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "suspect-product-2-usage-timeline",
    section: "D",
    label: "Suspect product #2: usage timeline",
    fieldIds: [
      "Page5.Prod2.Prod2TherapyStartDate",
      "Page5.Prod2.Prod2TherapyStopDate",
      "Page5.Prod2.Prod2TherapyReduceDate",
      "Page5.Prod2.Prod2TherapyDuration",
      "Page5.Prod2.Prod2TherapyDurUnit",
      "Page5.Prod2.Prod2TherapyOngoingYes",
      "Page5.Prod2.Prod2TherapyOngoingNo",
      "Page5.Prod2.Prod2Diagnosis",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "suspect-product-2-type-and-expiration",
    section: "D",
    label: "Suspect product #2: type and expiration",
    fieldIds: [
      "Page5.Prod2.Prod2Compounded",
      "Page5.Prod2.pdt2CosmProf",
      "Page5.Prod2.Prod2ExpDate",
      "Page5.Prod2.Prod2Brand",
      "Page5.Prod2.Prod2Generic",
      "Page5.Prod2.Prod2OTC",
      "Page5.Prod2.Pdt2PdtOther",
      "Page5.Prod2.Pdt2Cannabi",
      "Page5.Prod2.Pdt2CosRetail",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "suspect-product-2-response",
    section: "D",
    label: "Suspect product #2: response after stopping/restarting",
    fieldIds: [
      "Page5.Prod2.Prod2AbatedYes",
      "Page5.Prod2.Prod2AbatedNo",
      "Page5.Prod2.Prod2AbatedNA",
      "Page5.Prod2.Prod2ReappearYes",
      "Page5.Prod2.Prod2ReappearNo",
      "Page5.Prod2.Prod2ReappearNA",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "suspect-product-2-purchase",
    section: "D",
    label: "Suspect product #2: purchase details",
    fieldIds: [
      "Page5.Prod2.Prod2PlaceName",
      "Page5.Prod2.Prod2Address",
      "Page5.Prod2.Pdt2Country",
      "Page5.Prod2.Pdt2City",
      "Page5.Prod2.Pdt2State",
      "Page5.Prod2.ZipCode",
      "Page5.Prod2.Pdt2Website",
      "Page5.Prod2.Pdt2PurchaseDate",
    ],
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    id: "device-identity",
    section: "E",
    label: "Device identity",
    fieldIds: [
      "Page6.SecE_Device.BrandName",
      "Page6.SecE_Device.CommName",
      "Page6.SecE_Device.Procode",
      "Page6.SecE_Device.ManuName",
      "Page6.SecE_Device.ModelNum",
      "Page6.SecE_Device.LotNum",
      "Page6.SecE_Device.CatNum",
      "Page6.SecE_Device.ExpDate",
      "Page6.SecE_Device.SerialNum",
      "Page6.SecE_Device.UDInum",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "device-usage",
    section: "E",
    label: "Device usage",
    fieldIds: [
      "Page6.SecE_Device.HealthPro",
      "Page6.SecE_Device.PatientCons",
      "Page6.SecE_Device.OperatorOther",
      "Page6.SecE_Device.ImplantDate",
      "Page6.SecE_Device.ExplantDate",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "device-history",
    section: "E",
    label: "Device history",
    fieldIds: [
      "Page6.SecE_Device.ReuseYes",
      "Page6.SecE_Device.ReuseNo",
      "Page6.SecE_Device.ReprocInfo",
      "Page6.SecE_Device.ServicedYes",
      "Page6.SecE_Device.ServicedNo",
      "Page6.SecE_Device.ServiceUnk",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "concomitant-medication-1",
    section: "F",
    label: "Concomitant medication #1",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row1.Prod1",
      "Page6.SecF_Other.Table1.Row1.Start1",
      "Page6.SecF_Other.Table1.Row1.End1",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 1,
  },
  {
    id: "concomitant-medication-2",
    section: "F",
    label: "Concomitant medication #2",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row2.Prod2",
      "Page6.SecF_Other.Table1.Row2.Start2",
      "Page6.SecF_Other.Table1.Row2.End2",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 2,
  },
  {
    id: "concomitant-medication-3",
    section: "F",
    label: "Concomitant medication #3",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row3.Prod3",
      "Page6.SecF_Other.Table1.Row3.Start3",
      "Page6.SecF_Other.Table1.Row3.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 3,
  },
  {
    id: "concomitant-medication-4",
    section: "F",
    label: "Concomitant medication #4",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row4.Prod4",
      "Page6.SecF_Other.Table1.Row4.Start4",
      "Page6.SecF_Other.Table1.Row4.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 4,
  },
  {
    id: "concomitant-medication-5",
    section: "F",
    label: "Concomitant medication #5",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row5.Prod5",
      "Page6.SecF_Other.Table1.Row5.Start5",
      "Page6.SecF_Other.Table1.Row5.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 5,
  },
  {
    id: "concomitant-medication-6",
    section: "F",
    label: "Concomitant medication #6",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row6.Prod6",
      "Page6.SecF_Other.Table1.Row6.Start6",
      "Page6.SecF_Other.Table1.Row6.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 6,
  },
  {
    id: "concomitant-medication-7",
    section: "F",
    label: "Concomitant medication #7",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row7.Prod7",
      "Page6.SecF_Other.Table1.Row7.Start7",
      "Page6.SecF_Other.Table1.Row7.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 7,
  },
  {
    id: "concomitant-medication-8",
    section: "F",
    label: "Concomitant medication #8",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row8.Prod8",
      "Page6.SecF_Other.Table1.Row8.Start8",
      "Page6.SecF_Other.Table1.Row8.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 8,
  },
  {
    id: "concomitant-medication-9",
    section: "F",
    label: "Concomitant medication #9",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row9.Prod9",
      "Page6.SecF_Other.Table1.Row9.Start9",
      "Page6.SecF_Other.Table1.Row9.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 9,
  },
  {
    id: "concomitant-medication-10",
    section: "F",
    label: "Concomitant medication #10",
    fieldIds: [
      "Page6.SecF_Other.Table1.Row10.Prod10",
      "Page6.SecF_Other.Table1.Row10.Start10",
      "Page6.SecF_Other.Table1.Row10.Cell4",
    ],
    repeatGroup: "concomitant-medication",
    repeatInstance: 10,
  },
  {
    id: "reporter-contact-info",
    section: "G",
    label: "Reporter contact info",
    fieldIds: [
      "Page7.SecG_Reporter.LastName",
      "Page7.SecG_Reporter.FirstName",
      "Page7.SecG_Reporter.Address",
      "Page7.SecG_Reporter.City",
      "Page7.SecG_Reporter.State",
      "Page7.SecG_Reporter.ZipCode",
      "Page7.SecG_Reporter.Country",
      "Page7.SecG_Reporter.PhoneNum",
      "Page7.SecG_Reporter.Email",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
  {
    id: "reporter-about-you",
    section: "G",
    label: "About you",
    fieldIds: [
      "Page7.SecG_Reporter.ProYes",
      "Page7.SecG_Reporter.ProNo",
      "Page7.SecG_Reporter.Occupation",
      "Page7.SecG_Reporter.ManuComp",
      "Page7.SecG_Reporter.UserFac",
      "Page7.SecG_Reporter.DistImp",
      "Page7.SecG_Reporter.IdentityNo",
      "Page7.SecG_Reporter.Packer",
    ],
    repeatGroup: null,
    repeatInstance: null,
  },
];

// Rule 1's build error, at module load: a topic with no authored asks
// throws here rather than reaching a clinician as a topic that quietly
// asks nothing.
export const TOPICS: Topic[] = TOPIC_SHAPES.map((shape) => ({ ...shape, asks: asksForTopic(shape.id) }));

// How many instances of a repeating group the clinician has confirmed
// exist. Absent from AgendaRecord entirely on purpose: "is there
// another suspect product?" isn't one of the 227 real PDF fields, so it
// has nowhere to live in the record itself.
export type RepeatCounts = Partial<Record<RepeatGroup, number>>;

export function initRepeatCounts(): RepeatCounts {
  return {};
}

// Exported as repeatGroupCapacity: Issue #44's count-follow-through chips
// ("how many in total?") need the same real max this function already
// computes for range-checking, to build the actual list of valid totals
// to offer — not a second, hand-derived copy of "how many slots does
// this group have."
export function repeatGroupCapacity(group: RepeatGroup, topics: Topic[] = TOPICS): number {
  return maxInstance(group, topics);
}

function maxInstance(group: RepeatGroup, topics: Topic[]): number {
  const instances = topics
    .filter((t) => t.repeatGroup === group)
    .map((t) => t.repeatInstance!);
  if (instances.length === 0) {
    // Without this guard, Math.max(...[]) is -Infinity, and every count
    // (including legitimate ones) would fail the range check below with
    // a nonsensical "must be between 1 and -Infinity" message.
    throw new Error(`${group}: no topics in the given topics list belong to this group`);
  }
  return Math.max(...instances);
}

// Non-throwing sibling to setRepeatCount's own range check (Issue #41): the
// narrative-extraction pass needs to decide whether a MODEL-PROPOSED count
// is plausible before ever accepting it as a candidate, and a thrown error
// is the wrong shape for that — an implausible count is an ordinary,
// expected rejection outcome (same as an ungrounded quote), not the
// system-configuration bug setRepeatCount's throw is for. A group absent
// from the given topics list is treated as "no valid count" (false for
// every input) rather than thrown, for the same reason.
export function isValidRepeatCount(group: RepeatGroup, count: number, topics: Topic[] = TOPICS): boolean {
  const instances = topics.filter((t) => t.repeatGroup === group).map((t) => t.repeatInstance!);
  if (instances.length === 0) return false;
  return Number.isInteger(count) && count >= 1 && count <= Math.max(...instances);
}

export function setRepeatCount(
  counts: RepeatCounts,
  group: RepeatGroup,
  count: number,
  topics: Topic[] = TOPICS,
): RepeatCounts {
  const max = maxInstance(group, topics);
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new Error(`${group}: count must be an integer between 1 and ${max}, got ${count}`);
  }
  return { ...counts, [group]: count };
}

// Reads and validates a repeat group's decided count. Defense in depth:
// RepeatCounts is a plain object type, so nothing stops a caller from
// constructing one directly instead of going through setRepeatCount()'s
// validation (e.g. `{ "suspect-product": 0 }` or `{ "suspect-product":
// NaN }`) — either would otherwise corrupt nextStep()'s walk: a NaN
// decision compares false against every `>` check, so no later instance
// is ever skipped despite `decided !== undefined` being true, and a
// count below 1 would skip instance 1 itself, contradicting the
// "instance 1 is always asked unconditionally" invariant documented
// below.
function decidedCount(repeatCounts: RepeatCounts, group: RepeatGroup): number | undefined {
  const decided = repeatCounts[group];
  if (decided === undefined) return undefined;
  if (!Number.isInteger(decided) || decided < 1) {
    throw new Error(`nextStep: invalid repeat count for ${group}: ${decided}`);
  }
  return decided;
}

export type NextStep =
  // `ask` is the authored ask this step voices (docs/ask-copy.md via
  // ask-inventory.ts); `fieldIds` is exactly the subset of its
  // askFieldIds still unresolved — what the dismiss chips write, what the
  // extractor is pointed at, and what rule 9's re-ask frame names. A
  // topic's derive/auto/write-target companions are deliberately absent:
  // they are filled from a sibling fact, never voiced, and never block.
  | { kind: "topic"; topic: Topic; ask: AuthoredAsk; fieldIds: string[] }
  | { kind: "repeat-decision"; repeatGroup: RepeatGroup; afterInstance: number }
  | { kind: "done" };

// Decides what the Talker asks about next, walking topics in their
// existing array order (already section-by-section, A through G, and
// instance-1-before-instance-2 within a repeating group — see
// topics.test.ts). Every field type is surfaced (Issue #44 supersedes
// Issue #13's old text/date-only scoping, design.md's "checkbox/enum
// fields are ordinary conversational asks"): a topic with unresolved
// checkbox/enum fields is an ordinary ask like any other, phrased with
// its legal options by the deterministic AskFn (src/lib/ask.ts) rather
// than resolved through a persistent widget panel, which no longer
// exists anywhere in this app.
export function nextStep(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): NextStep {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const topic of topics) {
    // ask-copy.md rule 5: a gated-off topic is out of the walk entirely.
    // Re-evaluated here on every call, not cached on arrival — a product
    // type stated at SP-6 opens availability and purchase, and the walk
    // reaches them on its next pass. The contract chooses that mid-flow
    // insertion over evaluate-once precisely because evaluate-once
    // silently skips the cases the gate exists to include.
    if (isTopicGatedOff(topic.id, record)) continue;
    if (topic.repeatGroup !== null && topic.repeatInstance !== null) {
      const decided = decidedCount(repeatCounts, topic.repeatGroup);
      if (decided !== undefined && topic.repeatInstance > decided) {
        continue; // this instance was confirmed not to exist — skip it
      }
      if (decided === undefined && topic.repeatInstance > 1) {
        // Instance 1 is always asked unconditionally; instance 2+ is
        // gated on an explicit "is there another?" decision first.
        return {
          kind: "repeat-decision",
          repeatGroup: topic.repeatGroup,
          afterInstance: topic.repeatInstance - 1,
        };
      }
    }

    // The topic's AUTHORED asks, in the inventory's order — not its raw
    // field list. Which fields an ask waits on is the inventory's
    // decision (ask-copy.md rule 2: "An ask asks for facts; extraction
    // maps facts to fields"), so a topic is finished when every one of
    // its asks is, never when every one of its fields is: a bare weight
    // leaves its unit companion open forever by design, and the walk must
    // not stall on it.
    for (const ask of topic.asks) {
      if (!askApplies(ask, record)) continue;
      for (const fieldId of ask.askFieldIds) {
        const field = fieldsById.get(fieldId);
        if (!field) {
          throw new Error(`nextStep: no such field in the given fields list: ${fieldId}`);
        }
        // Object.hasOwn, not a stale-looks-like-resolved fallback: a
        // mismatched topics/fields/record combination (talk.ts's Deps lets
        // a caller override any of the three independently) should fail
        // loud, the same way agenda.ts's applyAction() always has — not
        // silently treat a real unresolved field as if it were already
        // answered.
        if (!Object.hasOwn(record, fieldId)) {
          throw new Error(`nextStep: record missing field id: ${fieldId}`);
        }
      }
      const unresolvedFieldIds = ask.askFieldIds.filter((fieldId) => !isResolved(record[fieldId].state));
      if (unresolvedFieldIds.length > 0) {
        return { kind: "topic", topic, ask, fieldIds: unresolvedFieldIds };
      }
    }
  }

  return { kind: "done" };
}

export type TopicStatus = "done" | "current" | "upcoming";

export interface TopicStatusEntry {
  topic: Topic;
  status: TopicStatus;
}

// Derived from nextStep() itself (a single call) rather than a second walk
// over topics — used by the wizard UI's sidebar (Issue #32) to show every
// topic's progress. Safe to reduce nextStep()'s single "what's next" answer
// into a full done/current/upcoming split for every topic because
// nextStep()'s own walk is strictly sequential: a repeat group's decided
// count can only exist once every earlier topic is already resolved, so a
// repeat instance skipped by that count (see below) can never sit *after*
// the current position in topics' array order — only at or before it.
export function topicStatuses(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): TopicStatusEntry[] {
  const step = nextStep(record, repeatCounts, topics, fields);
  const currentTopicId = currentTopicIdFor(step, topics);
  const currentIndex = currentTopicId === null ? topics.length : topics.findIndex((t) => t.id === currentTopicId);

  return topics.map((topic, i) => ({
    topic,
    status: i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming",
  }));
}

// The review-stage edit path (design.md, Issue #34): field-state.ts's
// `reopen` action already re-enters the state machine rather than
// patching a value directly — this is its one caller. Sends a topic's
// *resolved* fields, of every type, back to `unasked`. Checkbox/enum
// fields were once left alone here on the theory that they were "already
// directly editable in place" through a persistent widget panel
// (TopicFields, Issue #32) — Issue #44 deleted that panel entirely
// (design.md: checkbox/enum fields are ordinary conversational asks, no
// standing widget section anywhere), so the conversational re-ask this
// function drives is now their ONLY edit path; without reopening them
// too, an answered-but-wrong checkbox would be permanently
// uncorrectable. applyAction()'s own "reopen" transition retains each
// field's prior value until a replacement is written (agenda.ts) — this
// function relies on that rather than re-implementing it. nextStep()'s
// own serial walk then picks the topic back up as a normal "topic" step,
// going through the same Extractor/grounding check a first answer does.
export function reopenTopic(
  record: AgendaRecord,
  topic: Topic,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): AgendaRecord {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  return topic.fieldIds.reduce((rec, fieldId) => {
    if (!fieldsById.has(fieldId)) {
      throw new Error(`reopenTopic: no such field in the given fields list: ${fieldId}`);
    }
    if (!Object.hasOwn(rec, fieldId)) {
      throw new Error(`reopenTopic: record missing field id: ${fieldId}`);
    }
    if (isResolved(rec[fieldId].state)) {
      return applyAction(rec, fieldId, { type: "reopen" });
    }
    return rec;
  }, record);
}

// Every field the narrative-extraction pass (Issue #41) may target: every
// non-repeat topic, plus instance 1 of each repeat group, still unresolved
// — any field type, per design.md's "Extraction scope" ("checkbox/enum
// fields are in scope for the narrative pass"). nextStep() also now takes
// every field type (Issue #44 superseded its old text/date-only walk), so
// type is no longer what distinguishes this function from that one — the
// real differences are that this sweeps every currently-reachable topic
// in ONE shot rather than nextStep()'s single next-step answer, and that
// it uses isResolved()'s unasked-only test rather than the WIDER
// unasked-or-unknown predicate the follow-up sweep uses (see
// openFollowUpFields() below, which deliberately does NOT reuse this
// function or isResolved() — design.md is explicit that the widened pass
// carries its own predicate).
//
// Deliberately excludes repeat-instance 2+ unconditionally (there is no
// repeatCounts parameter to widen it) — the pass never attributes fields
// to a SPECIFIC later instance. A narrative naming two suspect products is
// exactly the case where getting that attribution wrong would silently
// mis-file one product's dose or route under the other's fields — the
// class of bug the charter's review-depth conclusion weighs most heavily.
// Instance 2+ stays with the ordinary, already-proven per-turn follow-up
// flow instead, once a repeat decision unblocks it. Detecting THAT a
// second instance exists is a separate, lighter-weight thing the
// narrative pass may still do — see src/lib/narrative-extract.ts.
export function narrativePassFields(
  record: AgendaRecord,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): FormFieldSpec[] {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const eligibleTopics = topics.filter((t) => t.repeatInstance === null || t.repeatInstance === 1);

  const result: FormFieldSpec[] = [];
  for (const topic of eligibleTopics) {
    for (const fieldId of topic.fieldIds) {
      const field = fieldsById.get(fieldId);
      if (!field) {
        throw new Error(`narrativePassFields: no such field in the given fields list: ${fieldId}`);
      }
      if (!Object.hasOwn(record, fieldId)) {
        throw new Error(`narrativePassFields: record missing field id: ${fieldId}`);
      }
      if (!isResolved(record[fieldId].state)) {
        result.push(field);
      }
    }
  }
  return result;
}

// The widened per-turn follow-up sweep's own predicate (Issue #44,
// design.md: "open means state `unasked` or `unknown` — deliberately
// wider than isResolved()'s unasked-only test that nextStep() and
// narrativePassFields() use; the widened pass carries its own predicate
// rather than reusing theirs"). A field the clinician already marked
// `unknown` stays a legitimate target: a later turn volunteering that
// value should be able to fill it, not just newly-`unasked` fields.
// `answered`/`declined` fields are still excluded from "open" — those
// are clinician-established states this sweep never targets for a
// direct write; a proposal that reaches one anyway is handled downstream
// as a correction offer, never folded into what this function calls
// open (see src/lib/followup-sweep.ts).
function isOpenForFollowUp(state: FieldState): boolean {
  return state === "unasked" || state === "unknown";
}

// Same repeat-instance-2+ exclusion and eligible-topic walk as
// narrativePassFields() above, deliberately NOT shared code with it — the
// predicate is the one thing design.md requires to be genuinely separate,
// and duplicating this small walk keeps that requirement visible at the
// call site rather than hidden behind a shared helper a future edit could
// accidentally widen in both places at once.
export function openFollowUpFields(
  record: AgendaRecord,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): FormFieldSpec[] {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const eligibleTopics = topics.filter((t) => t.repeatInstance === null || t.repeatInstance === 1);

  const result: FormFieldSpec[] = [];
  for (const topic of eligibleTopics) {
    for (const fieldId of topic.fieldIds) {
      const field = fieldsById.get(fieldId);
      if (!field) {
        throw new Error(`openFollowUpFields: no such field in the given fields list: ${fieldId}`);
      }
      if (!Object.hasOwn(record, fieldId)) {
        throw new Error(`openFollowUpFields: record missing field id: ${fieldId}`);
      }
      if (isOpenForFollowUp(record[fieldId].state)) {
        result.push(field);
      }
    }
  }
  return result;
}

// Recognizes a field id that belongs to a repeat group's instance 2+
// (never instance 1, which is ordinary and always in scope) — the
// widened follow-up sweep's way of telling "the clinician volunteered a
// LATER instance" (design.md: "a volunteered later instance surfaces as
// a repeat-count proposal the clinician answers at the group's normal
// 'was there another?' decision... never attributed by the sweep") apart
// from an ordinary open field or an unknown field id. Returns null for
// both "not a repeat field at all" and "instance 1" on purpose — callers
// only need the single yes/no "is this a later instance" question, and a
// null either way keeps that check a single comparison rather than two.
export function repeatGroupOfLaterInstanceField(fieldId: string, topics: Topic[] = TOPICS): RepeatGroup | null {
  const topic = topics.find((t) => t.fieldIds.includes(fieldId));
  if (!topic || topic.repeatGroup === null || topic.repeatInstance === null) return null;
  return topic.repeatInstance > 1 ? topic.repeatGroup : null;
}

export interface TopicProgress {
  topic: Topic;
  // 0-based position of the current topic within `topics`' own array
  // order — the flat, real topic walk (34 entries today), not the report
  // chrome's curated nine-row section/repeat-group rollup, which is #67's
  // own scope (design.md: "each row's state computed from its constituent
  // fields' actual states... it is part of the decided model and builds
  // as its own unit"). This is deliberately the simpler, already-true
  // number, not a hand-collapsed stand-in for that later unit's rail.
  index: number;
  total: number;
}

// The Follow-ups surface's topic-progress line (Issue #44 AC-1: "a
// topic-progress line from real agenda state") — built on topicStatuses()
// itself (one call), the same shared helper the sidebar reads from,
// rather than a second done/current/upcoming computation.
export function currentTopicProgress(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): TopicProgress | null {
  const statuses = topicStatuses(record, repeatCounts, topics, fields);
  const index = statuses.findIndex((entry) => entry.status === "current");
  if (index === -1) return null; // "done" — nothing currently open to report
  return { topic: statuses[index].topic, index, total: statuses.length };
}

function currentTopicIdFor(step: NextStep, topics: Topic[]): string | null {
  if (step.kind === "done") return null;
  if (step.kind === "topic") return step.topic.id;

  const target = topics.find(
    (t) => t.repeatGroup === step.repeatGroup && t.repeatInstance === step.afterInstance + 1,
  );
  if (!target) {
    throw new Error(
      `topicStatuses: no topic found for ${step.repeatGroup} instance ${step.afterInstance + 1}`,
    );
  }
  return target.id;
}
