// The one display-name module (docs/ask-copy.md rule 6, and its
// "Consequences for the machinery" item 2): field id → the short human
// name a clinician sees. Acknowledgments, correction offers, collisions,
// the open-fields dialog, and Review rows all read from here, so a raw
// manifest label ("Outcome Attributed to Adverse Event: Congenital
// Anomaly/Birth Defects") and a PDF field id never reach a clinician.
//
// Authored, not derived: v1.1 built clinician-facing text out of manifest
// labels and shipped "What's the yes (yes or no), the no (yes or no), and
// the doesn't apply (yes or no)?" — the defect this whole contract exists
// to remove. The names below are transcribed from ask-copy.md's per-topic
// display-name lists; the repeating families (two suspect products, eight
// lab rows, ten concomitant-medication rows) are authored once as a
// template and indexed structurally, from the field's own id — never from
// its label.
//
// Checkbox fields carry FACT PHRASES, not "true/false" (rule 6): the
// Hospital checkbox is "outcome: hospitalization", so a Review row or an
// open-fields entry reads as the fact it records.
//
// No name contains a comma: names are joined into sentences by rule 9's
// re-ask frames ("Still need: age, sex.") and by the sweep's
// acknowledgments, and a comma inside one name is indistinguishable from
// the join's own separators — the same guard ask.ts has always held its
// phrases to, now held over the names that replaced them.
import { fieldById } from "./form-3500-fields";

// --- the repeating families, authored once ---

// Suspect product #1 and #2 share a leaf vocabulary. The manifest spells
// instance 2's leaves inconsistently (`Prod2CosmProf` but `Pdt2Country`,
// and a lowercase `pdt2CosmProf`), so leaves are normalized before
// lookup rather than listed twice.
const PRODUCT_LEAF_NAMES: Record<string, string> = {
  Name: "product name",
  Strength: "strength",
  StrengthUnit: "strength unit",
  NDC_ID: "NDC or unique ID",
  ManuComp: "manufacturer/compounder",
  LotNum: "lot number",
  Dose: "dose",
  DoseUnit: "dose unit",
  Freq: "frequency",
  FreqOther: "frequency (other)",
  Route: "route",
  RouteOther: "route (other)",
  TherapyStartDate: "therapy start date",
  TherapyStopDate: "therapy stop date",
  TherapyReduceDate: "dose reduced on",
  TherapyDuration: "therapy duration",
  TherapyDurUnit: "therapy duration unit",
  TherapyOngoingYes: "therapy ongoing: yes",
  TherapyOngoingNo: "therapy ongoing: no",
  Diagnosis: "diagnosis for use",
  Brand: "product type: brand",
  Generic: "product type: generic or biosimilar",
  OTC: "product type: OTC",
  Compounded: "product type: compounded",
  Cannabi: "product type: cannabinoid",
  CosRetail: "product type: cosmetic (retail)",
  CosmProf: "product type: cosmetic (professional)",
  PdtOther: "product type: other",
  ExpDate: "expiration date",
  AbatedYes: "improved after stopping: yes",
  AbatedNo: "improved after stopping: no",
  AbatedNA: "improved after stopping: doesn't apply",
  ReappearYes: "returned after restarting: yes",
  ReappearNo: "returned after restarting: no",
  ReappearNA: "returned after restarting: doesn't apply",
  PlaceName: "purchase: place",
  Address: "purchase: address",
  City: "purchase: city",
  State: "purchase state/province",
  ZipCode: "purchase ZIP",
  Country: "purchase country",
  Website: "purchase website",
  PurchaseDate: "purchase date",
};

const LAB_LEAF_NAMES: Record<string, (row: number) => string> = {
  TestData: (n) => `test ${n}`,
  TLowRange: (n) => `test ${n} result range (low)`,
  THighRange: (n) => `test ${n} result range (high)`,
  TDate: (n) => `test ${n} date`,
};

const CONMED_LEAF_NAMES: Record<string, (row: number) => string> = {
  Prod: (n) => `other medication ${n}`,
  Start: (n) => `other medication ${n} start`,
  End: (n) => `other medication ${n} stop`,
};

// --- everything else, one entry per field ---

const NAMES: Record<string, string> = {
  // patient-basics (A)
  "Page1.SecA_Patient.PatientIdentifier": "patient identifier",
  "Page1.SecA_Patient.AgeValue": "age",
  "Page1.SecA_Patient.AgeYears": "age unit: years",
  "Page1.SecA_Patient.AgeMonths": "age unit: months",
  "Page1.SecA_Patient.AgeWeeks": "age unit: weeks",
  "Page1.SecA_Patient.AgeDays": "age unit: days",
  "Page1.SecA_Patient.DateBirth": "date of birth",
  "Page1.SecA_Patient.SexM": "sex: male",
  "Page1.SecA_Patient.SexF": "sex: female",
  "Page1.SecA_Patient.WeightValue": "weight",
  "Page1.SecA_Patient.WeightLB": "weight unit: lb",
  "Page1.SecA_Patient.WeightKG": "weight unit: kg",
  "Page1.SecA_Patient.RaceAmInd": "race/ethnicity: American Indian or Alaska Native",
  "Page1.SecA_Patient.RaceAsian": "race/ethnicity: Asian",
  "Page1.SecA_Patient.RaceBlack": "race/ethnicity: Black or African American",
  "Page1.SecA_Patient.EthnicLatino": "race/ethnicity: Hispanic or Latino",
  "Page1.SecA_Patient.RaceMiddleEastern": "race/ethnicity: Middle Eastern or North African",
  "Page1.SecA_Patient.RacePacific": "race/ethnicity: Native Hawaiian or Pacific Islander",
  "Page1.SecA_Patient.RaceWhite": "race/ethnicity: White",

  // event-what-happened (B)
  "Page2.SecB_Adverse.DescEvent": "event description",
  "Page1.SecA_Patient.EventDate": "date of event",
  "Page1.SecA_Patient.ReportDate": "date of this report",
  "Page1.SecA_Patient.RepAdverse": "report type: adverse event",
  "Page1.SecA_Patient.RepError": "report type: medication error",
  "Page1.SecA_Patient.Defects": "report type: product problem",
  "Page1.SecA_Patient.DiffManu": "report type: different-manufacturer problem",

  // event-outcome (B)
  "Page1.SecA_Patient.Death": "outcome: death",
  "Page1.SecA_Patient.DeathDate": "date of death",
  "Page1.SecA_Patient.Hospital": "outcome: hospitalization",
  "Page1.SecA_Patient.LifeThreaten": "outcome: life-threatening",
  "Page1.SecA_Patient.Disability": "outcome: disability or permanent damage",
  "Page1.SecA_Patient.ReqdInter": "outcome: required intervention",
  "Page1.SecA_Patient.Congenital": "outcome: congenital anomaly",
  "Page1.SecA_Patient.OtherEvents": "outcome: other serious event",

  // event-medical-history / event-additional-comments (B)
  "Page3.Sec6Data.OtherHistory": "relevant history",
  "Page3.AdditionalComments": "additional comments",

  // product-availability (C)
  "Page3.TestDataTable.EvalYes": "product available: yes",
  "Page3.TestDataTable.EvalNo": "product available: no",
  "Page3.TestDataTable.EvalRetd": "returned to manufacturer",
  "Page3.TestDataTable.ReturnDate": "returned to manufacturer (date)",
  "Page3.TestDataTable.Row7.PicYes": "picture of the product",

  // device-identity / device-usage / device-history (E)
  "Page6.SecE_Device.BrandName": "device brand name",
  "Page6.SecE_Device.CommName": "common device name",
  "Page6.SecE_Device.Procode": "procode",
  "Page6.SecE_Device.ManuName": "device manufacturer",
  "Page6.SecE_Device.ModelNum": "model #",
  "Page6.SecE_Device.LotNum": "device lot #",
  "Page6.SecE_Device.CatNum": "catalog #",
  "Page6.SecE_Device.ExpDate": "device expiration date",
  "Page6.SecE_Device.SerialNum": "serial #",
  "Page6.SecE_Device.UDInum": "UDI #",
  "Page6.SecE_Device.HealthPro": "operator: health professional",
  "Page6.SecE_Device.PatientCons": "operator: patient",
  "Page6.SecE_Device.OperatorOther": "operator: other",
  "Page6.SecE_Device.ImplantDate": "implant date",
  "Page6.SecE_Device.ExplantDate": "explant date",
  "Page6.SecE_Device.ReuseYes": "reprocessed single-use device: yes",
  "Page6.SecE_Device.ReuseNo": "reprocessed single-use device: no",
  "Page6.SecE_Device.ReprocInfo": "reprocessor",
  "Page6.SecE_Device.ServicedYes": "serviced by third party: yes",
  "Page6.SecE_Device.ServicedNo": "serviced by third party: no",
  "Page6.SecE_Device.ServiceUnk": "serviced by third party: unknown",

  // reporter-contact-info (G)
  "Page7.SecG_Reporter.LastName": "your last name",
  "Page7.SecG_Reporter.FirstName": "your first name",
  "Page7.SecG_Reporter.Address": "your address",
  "Page7.SecG_Reporter.City": "your city",
  "Page7.SecG_Reporter.State": "your state/province",
  "Page7.SecG_Reporter.ZipCode": "your ZIP",
  "Page7.SecG_Reporter.Country": "your country",
  "Page7.SecG_Reporter.PhoneNum": "your phone",
  "Page7.SecG_Reporter.Email": "your email",

  // reporter-about-you (G)
  "Page7.SecG_Reporter.ProYes": "health professional: yes",
  "Page7.SecG_Reporter.ProNo": "health professional: no",
  "Page7.SecG_Reporter.Occupation": "occupation",
  "Page7.SecG_Reporter.ManuComp": "also reported to: manufacturer",
  "Page7.SecG_Reporter.UserFac": "also reported to: user facility",
  "Page7.SecG_Reporter.DistImp": "also reported to: distributor",
  "Page7.SecG_Reporter.Packer": "also reported to: packer",
  "Page7.SecG_Reporter.IdentityNo": "withhold identity from manufacturer",
};

// Instance 2's names are instance 1's, prefixed (ask-copy.md: "Instance
// 2: same names prefixed 'product #2'").
const PRODUCT_INSTANCE_PREFIX: Record<number, string> = { 1: "", 2: "product #2 " };

function productName(fieldId: string): string | undefined {
  const match = fieldId.match(/^Page(?:4\.Prod1|5\.Prod2)\.(.+)$/);
  if (!match) return undefined;
  const instance = fieldId.startsWith("Page4.") ? 1 : 2;
  // Instance 2's leaves carry the instance in the leaf itself, and not
  // always the same way — `Prod2Name`, `Pdt2Country`, `pdt2CosmProf`.
  const leaf = match[1].replace(/^(?:Prod[12]|Pdt2|pdt2)/, "");
  const base = PRODUCT_LEAF_NAMES[leaf];
  return base === undefined ? undefined : `${PRODUCT_INSTANCE_PREFIX[instance]}${base}`;
}

function labName(fieldId: string): string | undefined {
  // The row index comes from the leaf's own trailing digit, never from
  // the path: the manifest files rows 3–7's dates and row 7's high range
  // under a `Row8.` prefix (a known id defect ask-copy.md records). Leaf
  // names stay unique and correct, so they are what the name is built on.
  const match = fieldId.match(/^Page3\.TestDataTable\.Row\d+\.(TestData|TLowRange|THighRange|TDate)(\d+)$/);
  if (!match) return undefined;
  return LAB_LEAF_NAMES[match[1]](Number(match[2]));
}

function conmedName(fieldId: string): string | undefined {
  // Here the ROW segment is the reliable index and the leaf is not: rows
  // 3–10 all spell the end-date leaf `Cell4` (the other id defect
  // ask-copy.md records), so leaf position within its row is what
  // determines the fact.
  const match = fieldId.match(/^Page6\.SecF_Other\.Table1\.Row(\d+)\.(Prod|Start|End|Cell)\d*$/);
  if (!match) return undefined;
  const row = Number(match[1]);
  const leaf = match[2] === "Cell" ? "End" : match[2];
  return CONMED_LEAF_NAMES[leaf](row);
}

// The short human name for a field. Throws on an unnamed field rather
// than falling back to the label or the id: rule 6 admits no fallback,
// and a silent one is exactly how the manifest labels leaked onto three
// surfaces in v1.1. displayNameFor() below is the total, id-taking form
// used where a caller may hold an id that is not in the manifest at all.
export function displayName(fieldId: string): string {
  const name = NAMES[fieldId] ?? productName(fieldId) ?? labName(fieldId) ?? conmedName(fieldId);
  if (name === undefined) {
    throw new Error(`display-names: no authored display name for field: ${fieldId}`);
  }
  return name;
}

// Same, but tolerant of an id that is not a manifest field — the shape
// several UI call sites need, where a stored session could name a field
// a later manifest no longer has. A real manifest field with no authored
// name still throws (that is the build error rule 1 asks for).
export function displayNameFor(fieldId: string): string {
  return fieldById(fieldId) ? displayName(fieldId) : fieldId;
}

// Sentence-joins names the way rule 9's re-ask frames and the sweep's
// acknowledgments need. Names are comma-free by construction (see the
// file header), so the Oxford comma here is unambiguous.
export function joinNames(names: string[]): string {
  if (names.length === 0) throw new Error("display-names: joinNames() needs at least one name");
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
