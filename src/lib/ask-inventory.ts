// The authored ask inventory (docs/ask-copy.md, "Inventory" and
// "Machinery copy"). This file IS the contract's ask half, transcribed as
// data: every question a clinician is asked, the fields each one owns,
// and which of a topic's fields are never asked at all.
//
// It replaces ask.ts's label-template path outright (rule 1: "The
// template path in ask.ts is removed, not kept as a fallback — a topic
// without authored copy is a build error caught by test"). v1.1 built
// questions from manifest labels and shipped "What's the yes (yes or no),
// the no (yes or no), and the doesn't apply (yes or no)?"; nothing here
// derives copy from a label.
//
// **Blocking vs. companion.** An ask asks for facts, and extraction maps
// facts to fields (rule 2). `askFieldIds` are the fields the ask waits
// on — the walk keeps the ask open while any of them is unresolved, and
// the dismiss chips write exactly these. `companionFieldIds` are rule 3's
// derive fields, rule 4's auto field, and rule 5's write-target rows:
// filled as companions of a sibling fact, never voiced, and never
// blocking, so a bare weight leaves its unit open and visible at Review
// rather than forcing a question nobody can answer. A one-hot group that
// is a fact's ONLY representation (sex, ongoing, abated, reappeared,
// health-professional) is blocking, not companion — it is what the ask
// asks for, and SP-7 would otherwise have no field to wait on at all.
//
// **One recorded deviation from the inventory.** AC-1 carries the
// parenthetical "always the final ask of the walk". It is left in its
// section-B topic position here instead. Moving it last requires
// reordering TOPICS, which breaks two things the contract does not
// address: topics.test.ts's "orders topics section by section, A through
// G" invariant, and the report rail — its authored "What happened" row
// bundles `event-what-happened` with `event-additional-comments`
// (report-chrome.ts), so a non-adjacent AC-1 makes the rail jump back to
// row 2 after Reporter, and `topicStatuses()`'s reduction of one
// nextStep() answer into a full done/current/upcoming split is documented
// as safe only because the walk is strictly sequential. design.md's
// round-2 unit (the nine rail rows driving progress AND ordering) is
// where that ordering belongs. Recorded here, not silent — Steve's call.
import type { AgendaRecord } from "./agenda";
import { displayName } from "./display-names";
import { fieldById } from "./form-3500-fields";
import { isResolved } from "./field-state";

// A fact an ask asks for that is carried by more than one field — a
// one-hot pair, a multi-select checkbox group — or by one field whose
// display name doesn't read as a noun phrase inside rule 9's frames.
//
// ask-copy.md rule 2: "An ask asks for facts; extraction maps facts to
// fields." Rule 9's re-ask frames name what is still open, and what is
// still open is a FACT: "And the sex?", never "Got it. Still need: sex:
// male and sex: female." Fields not named by any group are their own
// fact, under their display name — which is already a noun phrase for
// every one of them.
export interface AskFact {
  name: string;
  fieldIds: string[];
  // Checkbox facts only, and one of the two must be true for rule 7's
  // group completion to write the unnamed members `"false"` (see
  // derive.ts). Authoring has to decide which, per fact:
  //
  // - `exclusive`: the members are mutually exclusive answers to one
  //   question, so naming one entails the rest. "She's female" entails
  //   not-male whether or not the ask said the word "male".
  // - `voicesEveryMember`: the ask's own copy names every member out
  //   loud, which is rule 7's stated bound — "every one of them is voiced
  //   above, so no box is ever written false unheard". OC-1 lists all
  //   seven outcomes; RA-2 lists all four recipients.
  //
  // A checkbox fact with NEITHER is a multi-select whose options the ask
  // does not enumerate — PB-3's race/ethnicity, SP-6's product type.
  // Completing those would assert absence the clinician never stated, and
  // on PB-3 it would be wrong on the form's own terms: race and Hispanic
  // ethnicity are orthogonal, so "she's White" says nothing at all about
  // `EthnicLatino`. Such a fact instead resolves from ONE answered
  // member, so the walk moves on without asserting anything; the rest
  // stay open and answerable from the open-fields dialog.
  exclusive?: boolean;
  voicesEveryMember?: boolean;
}

export interface AuthoredAsk {
  // The contract's own ask id ("PB-1"), so a rendered question can be
  // traced back to the line of docs/ask-copy.md that authored it.
  id: string;
  topicId: string;
  copy: string;
  askFieldIds: string[];
  companionFieldIds: string[];
  // The multi-field facts among askFieldIds (see AskFact). Absent means
  // every field is its own fact.
  facts?: AskFact[];
  // OC-2 only: an ask that exists only when the record says so.
  when?: (record: AgendaRecord) => boolean;
}

const DEATH = "Page1.SecA_Patient.Death";

// Rule 5's write-target rows: everything in the lab table except LD-1's
// own anchor (row 1's test). Listed explicitly rather than derived from
// the topic, so a manifest change adds a field the inventory has to
// disposition rather than silently absorbing it. The `Row8.`-prefixed
// entries at the end are the manifest id defect ask-copy.md records for
// rows 3-7's dates and row 7's high range — real fields, correct leaves.
const LAB_WRITE_TARGET_FIELD_IDS: string[] = [
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
];

function patientBasics(): AuthoredAsk[] {
  const f = (leaf: string) => `Page1.SecA_Patient.${leaf}`;
  return [
    {
      id: "PB-1",
      topicId: "patient-basics",
      copy: "Who is the patient — an identifier like an MRN or initials, their age, and sex?",
      askFieldIds: [f("PatientIdentifier"), f("AgeValue"), f("SexM"), f("SexF")],
      facts: [{ name: "sex", fieldIds: [f("SexM"), f("SexF")], exclusive: true }],
      companionFieldIds: [f("AgeYears"), f("AgeMonths"), f("AgeWeeks"), f("AgeDays")],
    },
    {
      id: "PB-2",
      topicId: "patient-basics",
      copy: "What's the patient's weight — and date of birth, if you record it?",
      askFieldIds: [f("WeightValue"), f("DateBirth")],
      companionFieldIds: [f("WeightLB"), f("WeightKG")],
    },
    {
      id: "PB-3",
      topicId: "patient-basics",
      copy: "For FDA's demographics — the patient's race or ethnicity, if you record it? More than one is fine.",
      askFieldIds: [
        f("RaceAmInd"),
        f("RaceAsian"),
        f("RaceBlack"),
        f("EthnicLatino"),
        f("RaceMiddleEastern"),
        f("RacePacific"),
        f("RaceWhite"),
      ],
      facts: [
        {
          name: "race or ethnicity",
          fieldIds: [
            f("RaceAmInd"),
            f("RaceAsian"),
            f("RaceBlack"),
            f("EthnicLatino"),
            f("RaceMiddleEastern"),
            f("RacePacific"),
            f("RaceWhite"),
          ],
          // Deliberately neither `exclusive` nor `voicesEveryMember`:
          // PB-3 asks for "race or ethnicity" without naming the seven
          // boxes, and they are not alternatives — Hispanic ethnicity is
          // orthogonal to race on this form, so "she's White" says
          // nothing at all about EthnicLatino. One answer resolves the
          // fact; the rest stay open and answerable at Review.
        },
      ],
      companionFieldIds: [],
    },
  ];
}

function eventTopics(): AuthoredAsk[] {
  const a = (leaf: string) => `Page1.SecA_Patient.${leaf}`;
  return [
    {
      id: "WH-1",
      topicId: "event-what-happened",
      copy: "Describe what happened — the event, product problem, or medication error, in your own words.",
      askFieldIds: ["Page2.SecB_Adverse.DescEvent"],
      companionFieldIds: [],
    },
    {
      id: "WH-2",
      topicId: "event-what-happened",
      copy:
        "When did it happen — and is this an adverse reaction, a product problem like a defect, " +
        "a medication error, or a problem after switching manufacturers?",
      askFieldIds: [a("EventDate"), a("RepAdverse"), a("RepError"), a("Defects"), a("DiffManu")],
      facts: [
        { name: "report type", fieldIds: [a("RepAdverse"), a("RepError"), a("Defects"), a("DiffManu")], voicesEveryMember: true },
      ],
      // ReportDate is rule 4's auto field: stamped at export, editable at
      // Review, never asked.
      companionFieldIds: [a("ReportDate")],
    },
    {
      id: "OC-1",
      topicId: "event-outcome",
      copy:
        "How serious was the outcome — hospitalization, life-threatening, disability or permanent damage, " +
        "an intervention to prevent permanent harm, a congenital anomaly, death, another serious medical event " +
        "— or none of those?",
      askFieldIds: [
        a("Hospital"),
        a("LifeThreaten"),
        a("Disability"),
        a("ReqdInter"),
        a("Congenital"),
        a("Death"),
        a("OtherEvents"),
      ],
      facts: [
        {
          name: "outcome",
          fieldIds: [
            a("Hospital"),
            a("LifeThreaten"),
            a("Disability"),
            a("ReqdInter"),
            a("Congenital"),
            a("Death"),
            a("OtherEvents"),
          ],
          // OC-1 reads every one of the seven out loud before any can be
          // written false — rule 7's bound, met literally.
          voicesEveryMember: true,
        },
      ],
      companionFieldIds: [],
    },
    {
      id: "OC-2",
      topicId: "event-outcome",
      copy: "What was the date of death?",
      askFieldIds: [a("DeathDate")],
      companionFieldIds: [],
      // Conditional on a recorded death, and only a recorded one: a
      // checkbox answered "false" (rule 7's real negative) must not open
      // this, or "none of those" would be followed by a date-of-death
      // question.
      when: (record) => record[DEATH]?.state === "answered" && record[DEATH]?.value === "true",
    },
    {
      id: "MH-1",
      topicId: "event-medical-history",
      copy: "Any relevant history — preexisting conditions, allergies, pregnancy, tobacco or alcohol use?",
      askFieldIds: ["Page3.Sec6Data.OtherHistory"],
      companionFieldIds: [],
    },
    {
      id: "LD-1",
      topicId: "event-lab-data",
      copy:
        "Any relevant tests or labs? For each: the test, the result, the reference range if it's useful, " +
        "and the date.",
      // Rule 5: the lab rows are write-targets, never ask-targets.
      // Openness attaches to LD-1's own resolution — row 1's test — so an
      // empty row 4 is never a phantom gap in open-fields or the counts.
      askFieldIds: ["Page3.TestDataTable.Row1.TestData1"],
      companionFieldIds: LAB_WRITE_TARGET_FIELD_IDS,
    },
    {
      id: "AC-1",
      topicId: "event-additional-comments",
      copy: "Anything else FDA should know?",
      askFieldIds: ["Page3.AdditionalComments"],
      companionFieldIds: [],
    },
  ];
}

function productAvailability(): AuthoredAsk[] {
  const t = (leaf: string) => `Page3.TestDataTable.${leaf}`;
  return [
    {
      id: "PA-1",
      topicId: "product-availability",
      copy:
        "Is the product itself still available — do you have it or a picture of it, " +
        "or was it returned to the manufacturer, and when?",
      askFieldIds: [t("EvalYes"), t("EvalNo"), t("EvalRetd"), t("Row7.PicYes")],
      facts: [
        { name: "product availability", fieldIds: [t("EvalYes"), t("EvalNo"), t("EvalRetd")], exclusive: true },
      ],
      // Conditional on "returned" — fills from the same answer, never a
      // question of its own.
      companionFieldIds: [t("ReturnDate")],
    },
  ];
}

// The eight ungated asks plus the gated purchase ask, for one suspect
// product instance. "the suspect product" reads "the second suspect
// product" for instance 2 (ask-copy.md's SP pattern header).
function suspectProduct(instance: 1 | 2): AuthoredAsk[] {
  const p = (leaf: string) => (instance === 1 ? `Page4.Prod1.Prod1${leaf}` : `Page5.Prod2.Prod2${leaf}`);
  // Instance 2 spells a handful of leaves `Pdt2`/`pdt2` where instance 1
  // spells them `Prod1` — a manifest quirk, not a pattern, so those
  // leaves get their own accessor rather than bending p().
  const q = (leaf: string) => (instance === 1 ? p(leaf) : `Page5.Prod2.Pdt2${leaf}`);
  // And one leaf carries no instance marker at all, in either instance.
  const zipCode = instance === 1 ? "Page4.Prod1.ZipCode" : "Page5.Prod2.ZipCode";
  const suffix = instance === 1 ? "" : "-2";
  const it = instance === 1 ? "the suspect product" : "the second suspect product";
  return [
    {
      id: `SP-1${suffix}`,
      topicId: `suspect-product-${instance}-identity`,
      copy: `What's ${it} — name, strength, and manufacturer or compounder, if known?`,
      askFieldIds: [p("Name"), p("Strength"), p("ManuComp")],
      companionFieldIds: [p("StrengthUnit")],
    },
    {
      id: `SP-2${suffix}`,
      topicId: `suspect-product-${instance}-identity`,
      copy: "Lot number, and the NDC or other unique ID — if they're on hand.",
      askFieldIds: [p("LotNum"), p("NDC_ID")],
      companionFieldIds: [],
    },
    {
      id: `SP-3${suffix}`,
      topicId: `suspect-product-${instance}-dosing`,
      copy: "How was it taken — dose, how often, and by what route?",
      askFieldIds: [p("Dose"), p("Freq"), p("Route")],
      companionFieldIds: [p("DoseUnit"), p("FreqOther"), p("RouteOther")],
    },
    {
      id: `SP-4${suffix}`,
      topicId: `suspect-product-${instance}-usage-timeline`,
      copy:
        "When did therapy start and stop — or is it still ongoing? " +
        "If the dose was reduced instead, when?",
      askFieldIds: [
        p("TherapyStartDate"),
        p("TherapyStopDate"),
        p("TherapyOngoingYes"),
        p("TherapyOngoingNo"),
        p("TherapyReduceDate"),
      ],
      facts: [
        { name: "therapy status", fieldIds: [p("TherapyOngoingYes"), p("TherapyOngoingNo")], exclusive: true },
      ],
      // Duration fills from stated words only — never computed from the
      // dates (ask-copy.md SP-4). Absent stated words it stays open,
      // visible at Review.
      companionFieldIds: [p("TherapyDuration"), p("TherapyDurUnit")],
    },
    {
      id: `SP-5${suffix}`,
      topicId: `suspect-product-${instance}-usage-timeline`,
      copy: "What was it prescribed or used for?",
      askFieldIds: [p("Diagnosis")],
      companionFieldIds: [],
    },
    {
      id: `SP-6${suffix}`,
      topicId: `suspect-product-${instance}-type-and-expiration`,
      copy:
        "Anything notable about the product type — brand, generic or biosimilar, OTC, compounded, " +
        "cannabinoid, or cosmetic? And the expiration date, if known.",
      askFieldIds: [
        p("Brand"),
        p("Generic"),
        p("OTC"),
        p("Compounded"),
        q("Cannabi"),
        q("CosRetail"),
        instance === 1 ? "Page4.Prod1.Prod1CosmProf" : "Page5.Prod2.pdt2CosmProf",
        q("PdtOther"),
        p("ExpDate"),
      ],
      facts: [
        {
          name: "product type",
          fieldIds: [
            p("Brand"),
            p("Generic"),
            p("OTC"),
            p("Compounded"),
            q("Cannabi"),
            q("CosRetail"),
            instance === 1 ? "Page4.Prod1.Prod1CosmProf" : "Page5.Prod2.pdt2CosmProf",
            q("PdtOther"),
          ],
          // Neither, and for the same reason: SP-6 voices brand, generic,
          // OTC, compounded, cannabinoid and cosmetic, but not "other",
          // and a product can be several of these at once.
        },
      ],
      companionFieldIds: [],
    },
    {
      id: `SP-7${suffix}`,
      topicId: `suspect-product-${instance}-response`,
      copy: "After stopping or reducing it, did the event improve — yes, no, or doesn't apply?",
      askFieldIds: [p("AbatedYes"), p("AbatedNo"), p("AbatedNA")],
      facts: [
        { name: "response after stopping", fieldIds: [p("AbatedYes"), p("AbatedNo"), p("AbatedNA")], exclusive: true },
      ],
      companionFieldIds: [],
    },
    {
      id: `SP-8${suffix}`,
      topicId: `suspect-product-${instance}-response`,
      copy: "Was it given again — and if so, did the event come back?",
      askFieldIds: [p("ReappearYes"), p("ReappearNo"), p("ReappearNA")],
      facts: [
        { name: "response after restarting", fieldIds: [p("ReappearYes"), p("ReappearNo"), p("ReappearNA")], exclusive: true },
      ],
      companionFieldIds: [],
    },
    {
      id: `SP-9${suffix}`,
      topicId: `suspect-product-${instance}-purchase`,
      copy: "Where and when was it purchased — the store or website, and the date?",
      askFieldIds: [
        p("PlaceName"),
        p("Address"),
        q("City"),
        q("State"),
        zipCode,
        q("Country"),
        q("Website"),
        q("PurchaseDate"),
      ],
      // Rule 9's bulk-mapped clause: eight fields from one answer.
      facts: [
        {
          name: "rest of the purchase details",
          fieldIds: [
            p("PlaceName"),
            p("Address"),
            q("City"),
            q("State"),
            zipCode,
            q("Country"),
            q("Website"),
            q("PurchaseDate"),
          ],
        },
      ],
      companionFieldIds: [],
    },
  ];
}

function device(): AuthoredAsk[] {
  const d = (leaf: string) => `Page6.SecE_Device.${leaf}`;
  return [
    {
      id: "DV-1",
      topicId: "device-identity",
      copy:
        "What's the device — brand or common name, manufacturer, and model, serial, lot, catalog, " +
        "or UDI numbers as available? And its expiration date, if it has one.",
      askFieldIds: [
        d("BrandName"),
        d("CommName"),
        d("Procode"),
        d("ManuName"),
        d("ModelNum"),
        d("LotNum"),
        d("CatNum"),
        d("ExpDate"),
        d("SerialNum"),
        d("UDInum"),
      ],
      // Rule 9's bulk-mapped clause: ten fields from one answer.
      facts: [
        {
          name: "rest of the device details",
          fieldIds: [
            d("BrandName"),
            d("CommName"),
            d("Procode"),
            d("ManuName"),
            d("ModelNum"),
            d("LotNum"),
            d("CatNum"),
            d("ExpDate"),
            d("SerialNum"),
            d("UDInum"),
          ],
        },
      ],
      companionFieldIds: [],
    },
    {
      id: "DV-2",
      topicId: "device-usage",
      copy:
        "Who was operating the device — a health professional, the patient, or someone else? " +
        "If it was implanted or explanted, when?",
      askFieldIds: [d("HealthPro"), d("PatientCons"), d("OperatorOther"), d("ImplantDate"), d("ExplantDate")],
      facts: [
        { name: "device operator", fieldIds: [d("HealthPro"), d("PatientCons"), d("OperatorOther")], voicesEveryMember: true },
      ],
      companionFieldIds: [],
    },
    {
      id: "DV-3",
      topicId: "device-history",
      copy:
        "Two device-history checks — was it a reprocessed single-use device, and if so who reprocessed it? " +
        "And was it ever serviced by a third-party servicer?",
      askFieldIds: [d("ReuseYes"), d("ReuseNo"), d("ServicedYes"), d("ServicedNo"), d("ServiceUnk")],
      facts: [
        { name: "reprocessing history", fieldIds: [d("ReuseYes"), d("ReuseNo")], exclusive: true },
        { name: "third-party servicing history", fieldIds: [d("ServicedYes"), d("ServicedNo"), d("ServiceUnk")], exclusive: true },
      ],
      // Conditional on a "yes" to reprocessing — fills from the same
      // answer.
      companionFieldIds: [d("ReprocInfo")],
    },
  ];
}

// One ask per instance. CM-1 opens the group; CM-2 is what a repeat
// decision's "yes" leads into. The dates are companions, not blocking:
// the ask itself says "if you have them".
function concomitantMedication(instance: number): AuthoredAsk[] {
  const row = `Page6.SecF_Other.Table1.Row${instance}`;
  const end = instance <= 2 ? `${row}.End${instance}` : `${row}.Cell4`;
  return [
    {
      id: instance === 1 ? "CM-1" : `CM-2-${instance}`,
      topicId: `concomitant-medication-${instance}`,
      copy:
        instance === 1
          ? "Is the patient on other medications? Name them, with rough start and stop dates if you have them."
          : "What's the next medication — its name, and rough start and stop dates?",
      askFieldIds: [`${row}.Prod${instance}`],
      companionFieldIds: [`${row}.Start${instance}`, end],
    },
  ];
}

function reporter(): AuthoredAsk[] {
  const g = (leaf: string) => `Page7.SecG_Reporter.${leaf}`;
  return [
    {
      id: "RC-1",
      topicId: "reporter-contact-info",
      copy: "Your contact details for the report — name, address, phone, and email?",
      askFieldIds: [
        g("LastName"),
        g("FirstName"),
        g("Address"),
        g("City"),
        g("State"),
        g("ZipCode"),
        g("PhoneNum"),
        g("Email"),
      ],
      // Rule 9's bulk-mapped clause: nine fields from one answer is ONE
      // fact, so a partial answer re-asks as a line rather than a list.
      facts: [
        {
          name: "rest of your contact details",
          fieldIds: [
            g("LastName"),
            g("FirstName"),
            g("Address"),
            g("City"),
            g("State"),
            g("ZipCode"),
            g("PhoneNum"),
            g("Email"),
          ],
        },
      ],
      // Country is stated-only (ask-copy.md RC-1): it fills when the
      // clinician's address names one, and is never a question.
      companionFieldIds: [g("Country")],
    },
    {
      id: "RA-1",
      topicId: "reporter-about-you",
      copy: "Are you reporting as a health professional, and what's your occupation?",
      askFieldIds: [g("ProYes"), g("ProNo"), g("Occupation")],
      facts: [{ name: "health-professional status", fieldIds: [g("ProYes"), g("ProNo")], exclusive: true }],
      companionFieldIds: [],
    },
    {
      id: "RA-2",
      topicId: "reporter-about-you",
      copy:
        "Two housekeeping items — have you also reported this to the manufacturer, a user facility, " +
        "a distributor, or a packer? And should FDA withhold your identity from the manufacturer?",
      askFieldIds: [g("ManuComp"), g("UserFac"), g("DistImp"), g("Packer"), g("IdentityNo")],
      facts: [
        { name: "other reports", fieldIds: [g("ManuComp"), g("UserFac"), g("DistImp"), g("Packer")], voicesEveryMember: true },
        // A single box, so there is nothing to complete either way.
        { name: "identity-withholding choice", fieldIds: [g("IdentityNo")], voicesEveryMember: true },
      ],
      companionFieldIds: [],
    },
  ];
}

export const AUTHORED_ASKS: AuthoredAsk[] = [
  ...patientBasics(),
  ...eventTopics(),
  ...productAvailability(),
  ...suspectProduct(1),
  ...suspectProduct(2),
  ...device(),
  ...Array.from({ length: 10 }, (_, i) => concomitantMedication(i + 1)).flat(),
  ...reporter(),
];

// The topics whose asks are gated (rule 5). Listed here so the inventory
// stays the single place the ungated walk is described; the gate
// EVALUATION itself is topics.ts's.
export const GATED_TOPIC_IDS: ReadonlySet<string> = new Set([
  "product-availability",
  "suspect-product-1-purchase",
  "suspect-product-2-purchase",
  "device-identity",
  "device-usage",
  "device-history",
]);

const ASKS_BY_TOPIC = new Map<string, AuthoredAsk[]>();
for (const ask of AUTHORED_ASKS) {
  const list = ASKS_BY_TOPIC.get(ask.topicId) ?? [];
  list.push(ask);
  ASKS_BY_TOPIC.set(ask.topicId, list);
}

// Rule 1's build error: a topic with no authored asks is a defect, not a
// topic that quietly asks nothing.
export function asksForTopic(topicId: string): AuthoredAsk[] {
  const asks = ASKS_BY_TOPIC.get(topicId);
  if (asks === undefined || asks.length === 0) {
    throw new Error(`ask-inventory: no authored asks for topic: ${topicId}`);
  }
  return asks;
}

// An ask is open while any field it waits on is unresolved. Companions
// never hold it open (see the file header).
// Whether group completion may write the unnamed members of a checkbox
// fact `"false"` (rule 7's bound). Exported so derive.ts and the tests
// read the same predicate.
export function factCompletesFromOne(fact: AskFact): boolean {
  return fact.exclusive === true || fact.voicesEveryMember === true;
}

// A CHECKBOX fact whose options the ask does not enumerate and which is
// not mutually exclusive is answered by ONE member: the clinician
// answered the question, nothing entitles us to write the rest false, so
// the walk must not wait on them either.
//
// Checkbox-only, deliberately. RC-1's nine contact fields are also one
// fact — for naming, so a re-ask says "And the rest of your contact
// details?" rather than listing them — but each is independently
// answerable, so a name alone must not close the ask.
function factResolvesFromOne(fact: AskFact, record: AgendaRecord): boolean {
  if (factCompletesFromOne(fact)) return false;
  if (!fact.fieldIds.every((id) => fieldById(id)?.type === "checkbox")) return false;
  return fact.fieldIds.some((id) => isResolved(record[id]?.state ?? "unasked"));
}

export function unresolvedAskFieldIds(ask: AuthoredAsk, record: AgendaRecord): string[] {
  const settled = new Set<string>();
  for (const fact of ask.facts ?? []) {
    if (factResolvesFromOne(fact, record)) for (const id of fact.fieldIds) settled.add(id);
  }
  return ask.askFieldIds.filter((fieldId) => {
    const entry = record[fieldId];
    if (entry === undefined) {
      throw new Error(`ask-inventory: record missing field id: ${fieldId}`);
    }
    return !isResolved(entry.state) && !settled.has(fieldId);
  });
}

// The names of the facts an ask is still waiting on, in the ask's own
// field order, each named once — what rule 9's re-ask frames say.
export function unresolvedFactNames(ask: AuthoredAsk, record: AgendaRecord): string[] {
  const unresolved = new Set(unresolvedAskFieldIds(ask, record));
  const factByFieldId = new Map<string, AskFact>();
  for (const fact of ask.facts ?? []) for (const fieldId of fact.fieldIds) factByFieldId.set(fieldId, fact);
  const names: string[] = [];
  for (const fieldId of ask.askFieldIds) {
    if (!unresolved.has(fieldId)) continue;
    const name = factByFieldId.get(fieldId)?.name ?? displayName(fieldId);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function askApplies(ask: AuthoredAsk, record: AgendaRecord): boolean {
  return ask.when === undefined || ask.when(record);
}

// ask-copy.md's per-field disposition, for the surfaces that have to know
// WHY a field is unasked rather than just that it is.
//
// - "ask": the ask waits on it, and the walk asks until it resolves.
// - "derive" (rule 3): filled as a companion of a sibling fact. Legitimately
//   open forever — a bare weight writes the value and leaves lb/kg open,
//   "visible at Review" — so it stays a real, listable gap.
// - "auto" (rule 4): ReportDate, stamped at export. Never a gap: it is
//   determined, just not yet stamped.
// - "write-target" (rule 5): a lab row past LD-1's own anchor. "No row is
//   ever independently open — openness attaches to LD-1's own resolution,
//   so an empty row 4 is never a phantom gap in open-fields or the counts."
export type FieldDisposition = "ask" | "derive" | "auto" | "write-target";

// Which fact a derive companion hangs off (ask-copy.md rule 3, as amended
// 2026-08-27 — see isListableGap below). Authored, one entry per
// companion, because "is this an open gap?" is a different question from
// "how does this field get filled?" and only the anchor can answer it: a
// bare weight makes lb/kg a live, answerable gap, while an age nobody
// gave makes its four unit checkboxes noise. A companion with NO anchor
// listed fills only if the clinician's own words carry it (the stated-only
// country, a therapy duration nobody stated) and is never a gap.
const COMPANION_ANCHOR_LEAVES: Record<string, string> = {
  StrengthUnit: "Strength",
  DoseUnit: "Dose",
  FreqOther: "Freq",
  RouteOther: "Route",
  TherapyDurUnit: "TherapyDuration",
};

function productAnchors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prefix, leafPrefix] of [
    ["Page4.Prod1.", "Prod1"],
    ["Page5.Prod2.", "Prod2"],
  ] as const) {
    for (const [companion, anchor] of Object.entries(COMPANION_ANCHOR_LEAVES)) {
      out[`${prefix}${leafPrefix}${companion}`] = `${prefix}${leafPrefix}${anchor}`;
    }
  }
  return out;
}

function concomitantAnchors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let n = 1; n <= 10; n += 1) {
    const row = `Page6.SecF_Other.Table1.Row${n}`;
    const name = `${row}.Prod${n}`;
    out[`${row}.Start${n}`] = name;
    out[n <= 2 ? `${row}.End${n}` : `${row}.Cell4`] = name;
  }
  return out;
}

// Companions that are mutually exclusive answers to ONE question — which
// unit is this? — rather than independent facts. Once any member is
// answered the question is settled, so its siblings stop being gaps. A
// concomitant medication's start and stop dates are deliberately NOT a
// group: they are two facts, and answering one leaves the other open.
const EXCLUSIVE_COMPANION_GROUPS: string[][] = [
  [
    "Page1.SecA_Patient.AgeYears",
    "Page1.SecA_Patient.AgeMonths",
    "Page1.SecA_Patient.AgeWeeks",
    "Page1.SecA_Patient.AgeDays",
  ],
  ["Page1.SecA_Patient.WeightLB", "Page1.SecA_Patient.WeightKG"],
];

const EXCLUSIVE_GROUP_OF = new Map<string, string[]>(
  EXCLUSIVE_COMPANION_GROUPS.flatMap((group) => group.map((fieldId) => [fieldId, group] as const)),
);

const COMPANION_ANCHORS: Record<string, string> = {
  // A stated age or weight makes its unit a real, answerable gap.
  "Page1.SecA_Patient.AgeYears": "Page1.SecA_Patient.AgeValue",
  "Page1.SecA_Patient.AgeMonths": "Page1.SecA_Patient.AgeValue",
  "Page1.SecA_Patient.AgeWeeks": "Page1.SecA_Patient.AgeValue",
  "Page1.SecA_Patient.AgeDays": "Page1.SecA_Patient.AgeValue",
  "Page1.SecA_Patient.WeightLB": "Page1.SecA_Patient.WeightValue",
  "Page1.SecA_Patient.WeightKG": "Page1.SecA_Patient.WeightValue",
  // Voiced conditionals: PA-1 asks "returned to the manufacturer, and
  // when?", DV-3 asks "and if so who reprocessed it?" — each is a real
  // gap exactly when its condition holds.
  "Page3.TestDataTable.ReturnDate": "Page3.TestDataTable.EvalRetd",
  "Page6.SecE_Device.ReprocInfo": "Page6.SecE_Device.ReuseYes",
  ...productAnchors(),
  // CM-1/CM-2 voice "with rough start and stop dates": once a medication
  // is named, its dates are answerable.
  ...concomitantAnchors(),
  // Deliberately absent, and therefore never gaps: the stated-only
  // reporter country, and a therapy duration the contract says fills from
  // stated words only ("never computed from the dates").
};


const AUTO_FIELD_IDS: ReadonlySet<string> = new Set(["Page1.SecA_Patient.ReportDate"]);
const WRITE_TARGET_FIELD_IDS: ReadonlySet<string> = new Set(LAB_WRITE_TARGET_FIELD_IDS);
const ASK_BY_FIELD_ID = new Map<string, AuthoredAsk>(
  AUTHORED_ASKS.flatMap((ask) => ask.askFieldIds.map((fieldId) => [fieldId, ask] as const)),
);

export function dispositionOf(fieldId: string): FieldDisposition {
  if (ASK_BY_FIELD_ID.has(fieldId)) return "ask";
  if (AUTO_FIELD_IDS.has(fieldId)) return "auto";
  if (WRITE_TARGET_FIELD_IDS.has(fieldId)) return "write-target";
  return "derive";
}

// Whether an unresolved field is a real gap a clinician could still fill —
// what the open-fields dialog lists and what the report's counts treat as
// outstanding.
//
// Auto and write-target fields never are (rules 4 and 5). An ask field is,
// while its ask is in play: with no death recorded, OC-2 is not part of
// the walk, so "date of death" is a phantom gap of exactly the kind rule
// 5 rejects for an empty lab row — the record was never silent about it,
// the question was never in play.
//
// A derive companion is a gap **once the fact it hangs off is answered**,
// and not before (rule 3, amended 2026-08-27, #101). Disposition alone is
// the wrong discriminator, and getting that wrong was the first fix's own
// defect: excluding the whole derive bucket hid a bare weight's lb/kg —
// the very case rule 3 is written around — alongside PA-1's "and when?"
// and DV-3's "who reprocessed it?", both of which the asks voice out
// loud. Anchor state separates them. An age nobody gave makes its four
// unit checkboxes noise; a stated bare weight makes lb/kg a live,
// answerable question. A checkbox anchor must be answered TRUE: a
// product not returned to the manufacturer has no return date to give.
export function isListableGap(fieldId: string, record: AgendaRecord): boolean {
  const disposition = dispositionOf(fieldId);
  if (disposition === "auto" || disposition === "write-target") return false;
  if (disposition === "ask") return askApplies(ASK_BY_FIELD_ID.get(fieldId)!, record);

  const anchorId = COMPANION_ANCHORS[fieldId];
  if (anchorId === undefined) return false;
  const anchor = record[anchorId];
  if (anchor?.state !== "answered") return false;
  if (fieldById(anchorId)?.type === "checkbox" && anchor.value !== "true") return false;
  // A settled unit question closes its alternatives: an age derived as
  // years leaves no open question about months, weeks or days.
  const group = EXCLUSIVE_GROUP_OF.get(fieldId);
  return group === undefined || !group.some((sibling) => record[sibling]?.state === "answered");
}

// Exported for the disposition tests, which must be able to name every
// companion and its anchor without reading them back out of the function
// under test.
export function anchorOf(fieldId: string): string | undefined {
  return COMPANION_ANCHORS[fieldId];
}
