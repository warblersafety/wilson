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
      facts: [{ name: "sex", fieldIds: [f("SexM"), f("SexF")] }],
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
        { name: "report type", fieldIds: [a("RepAdverse"), a("RepError"), a("Defects"), a("DiffManu")] },
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
        { name: "product availability", fieldIds: [t("EvalYes"), t("EvalNo"), t("EvalRetd")] },
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
        { name: "therapy status", fieldIds: [p("TherapyOngoingYes"), p("TherapyOngoingNo")] },
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
        { name: "response after stopping", fieldIds: [p("AbatedYes"), p("AbatedNo"), p("AbatedNA")] },
      ],
      companionFieldIds: [],
    },
    {
      id: `SP-8${suffix}`,
      topicId: `suspect-product-${instance}-response`,
      copy: "Was it given again — and if so, did the event come back?",
      askFieldIds: [p("ReappearYes"), p("ReappearNo"), p("ReappearNA")],
      facts: [
        { name: "response after restarting", fieldIds: [p("ReappearYes"), p("ReappearNo"), p("ReappearNA")] },
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
        { name: "device operator", fieldIds: [d("HealthPro"), d("PatientCons"), d("OperatorOther")] },
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
        { name: "reprocessing history", fieldIds: [d("ReuseYes"), d("ReuseNo")] },
        { name: "third-party servicing history", fieldIds: [d("ServicedYes"), d("ServicedNo"), d("ServiceUnk")] },
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
      facts: [{ name: "health-professional status", fieldIds: [g("ProYes"), g("ProNo")] }],
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
        { name: "other reports", fieldIds: [g("ManuComp"), g("UserFac"), g("DistImp"), g("Packer")] },
        { name: "identity-withholding choice", fieldIds: [g("IdentityNo")] },
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
export function unresolvedAskFieldIds(ask: AuthoredAsk, record: AgendaRecord): string[] {
  return ask.askFieldIds.filter((fieldId) => {
    const entry = record[fieldId];
    if (entry === undefined) {
      throw new Error(`ask-inventory: record missing field id: ${fieldId}`);
    }
    return !isResolved(entry.state);
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
// outstanding. Only ask fields are, and only while their ask is in play.
//
// Auto and write-target fields never are (rules 4 and 5). Nor is a derive
// companion, as of rule 3's 2026-08-27 amendment (#101): it stays
// "visible at Review" on its anchor's row, but listing it here headed a
// 28-question session with "122 fields are still open" — its first four
// rows the age-unit checkboxes nobody was ever offered — on the surface
// immediately before sign-off, burying the fields the clinician actually
// skipped under ones they were never asked about.
//
// Nor is an ask field whose ask does not apply to this record: with no
// death recorded, OC-2 is not part of the walk, so "date of death" is a
// phantom gap of exactly the kind rule 5 rejects for an empty lab row —
// the record was never silent about it, the question was never in play.
export function isListableGap(fieldId: string, record: AgendaRecord): boolean {
  if (dispositionOf(fieldId) !== "ask") return false;
  return askApplies(ASK_BY_FIELD_ID.get(fieldId)!, record);
}
