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
import { type AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec, type FormSection } from "./form-3500-fields";

export type RepeatGroup = "suspect-product" | "concomitant-medication";

export interface Topic {
  id: string;
  section: FormSection;
  label: string;
  fieldIds: string[];
  repeatGroup: RepeatGroup | null;
  repeatInstance: number | null;
}

export const TOPICS: Topic[] = [
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
  },];

// How many instances of a repeating group the clinician has confirmed
// exist. Absent from AgendaRecord entirely on purpose: "is there
// another suspect product?" isn't one of the 227 real PDF fields, so it
// has nowhere to live in the record itself.
export type RepeatCounts = Partial<Record<RepeatGroup, number>>;

export function initRepeatCounts(): RepeatCounts {
  return {};
}

function maxInstance(group: RepeatGroup, topics: Topic[]): number {
  const instances = topics
    .filter((t) => t.repeatGroup === group)
    .map((t) => t.repeatInstance!);
  return Math.max(...instances);
}

export function setRepeatCount(
  counts: RepeatCounts,
  group: RepeatGroup,
  count: number,
  topics: Topic[] = TOPICS,
): RepeatCounts {
  const max = maxInstance(group, topics);
  if (count < 1 || count > max) {
    throw new Error(`${group}: count must be between 1 and ${max}, got ${count}`);
  }
  return { ...counts, [group]: count };
}

export type NextStep =
  | { kind: "topic"; topic: Topic; fieldIds: string[] }
  | { kind: "repeat-decision"; repeatGroup: RepeatGroup; afterInstance: number }
  | { kind: "done" };

// Decides what the Talker asks about next, walking topics in their
// existing array order (already section-by-section, A through G, and
// instance-1-before-instance-2 within a repeating group — see
// topics.test.ts). Only text/date fields are ever surfaced: checkbox/enum
// fields resolve via direct UI selection (Issue #13's scoping), so a
// topic that's entirely checkbox/enum needs no conversational step at
// all and is skipped outright.
export function nextStep(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): NextStep {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const topic of topics) {
    if (topic.repeatGroup !== null && topic.repeatInstance !== null) {
      const decided = repeatCounts[topic.repeatGroup];
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

    const unresolvedFieldIds = topic.fieldIds.filter((fieldId) => {
      const field = fieldsById.get(fieldId);
      const isTextOrDate = field?.type === "text" || field?.type === "date";
      return isTextOrDate && record[fieldId]?.state === "unasked";
    });
    if (unresolvedFieldIds.length > 0) {
      return { kind: "topic", topic, fieldIds: unresolvedFieldIds };
    }
  }

  return { kind: "done" };
}
