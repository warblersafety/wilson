// The right-hand Form FDA 3500 facsimile (Issue #67, design.md "The
// report chrome"): "an HTML rendering derived from the same
// field-mapping source the PDF exporter uses... labeled as a preview,
// honest about partial coverage, and never itself the sign-off artifact
// (the real PDF stays Review/Ready's on-demand artifact)."
//
// Curated, not exhaustive — a deliberate, enumerated deviation, not a
// silent gap: this preview shows a representative subset of fields from
// sections A, B, D, and G, not all 227. Sections C, E, F (product
// availability, device, concomitant meds) are in the left rail's rollup
// but not curated here; the disclosure line at the bottom says so, and
// the real, complete PDF stays generated on demand at Review. The slot
// list itself traces to `Form3500Paper.dc.html` in the tracked mockups
// zip (its own `BLANKS` object names this exact set: patientId, age,
// sex, weight, the section-B checkboxes, eventDate/reportDate,
// narrative, prodName/dose/route/therapyDates/lot/abated,
// reporterName/occupation/phone) — an earlier version of this comment
// claimed no machine-readable spec existed for the selection; it does,
// this file's SECTIONS below matches it slot-for-slot, and that same
// source is what caught this file's own value+unit composition bug
// (reviewer pass, PR #75, findings F1/F2). Section D always shows
// suspect product #1 specifically, regardless of how many products the
// record carries — the same simplification the mockups themselves make;
// every product is in the exported PDF and the left rail either way.
import type { AgendaRecord } from "@/lib/agenda";
import {
  AGE_UNIT_LABELS,
  displayFor,
  doseWithUnitAndFrequency,
  productIdentity,
  valueWithCheckedUnit,
  WEIGHT_UNIT_LABELS,
  type RenderedFacsimileValue,
} from "@/lib/form-3500-facsimile";
import { FORM_3500_FIELDS, FORM_3500_SECTIONS, type FormSection } from "@/lib/form-3500-fields";
import { formatFieldCounts, type RecordCounts } from "@/lib/report-chrome";

interface CheckboxOption {
  fieldId: string;
  shortLabel: string;
}

interface CheckboxGroup {
  label: string;
  options: CheckboxOption[];
}

interface FieldRow {
  shortLabel: string;
  render: (record: AgendaRecord) => RenderedFacsimileValue;
}

function field(fieldId: string, shortLabel: string): FieldRow {
  return { shortLabel, render: (record) => displayFor(record, fieldId) };
}

interface SectionBlock {
  section: FormSection;
  checkboxGroups?: CheckboxGroup[];
  fields?: FieldRow[];
  textBlockFieldId?: string;
  // Matches each section's own reading order on the real form/mockups —
  // section B leads with its checkbox rows, A and D lead with identity
  // fields. Defaults to fields-first.
  checkboxGroupsFirst?: boolean;
}

const SECTIONS: SectionBlock[] = [
  {
    section: "A",
    fields: [
      field("Page1.SecA_Patient.PatientIdentifier", "Patient identifier"),
      { shortLabel: "Age", render: (record) => valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNIT_LABELS) },
      {
        shortLabel: "Weight",
        render: (record) => valueWithCheckedUnit(record, "Page1.SecA_Patient.WeightValue", WEIGHT_UNIT_LABELS),
      },
    ],
    checkboxGroups: [
      {
        label: "Sex",
        options: [
          { fieldId: "Page1.SecA_Patient.SexM", shortLabel: "M" },
          { fieldId: "Page1.SecA_Patient.SexF", shortLabel: "F" },
        ],
      },
    ],
  },
  {
    section: "B",
    checkboxGroupsFirst: true,
    checkboxGroups: [
      {
        label: "Check all that apply",
        options: [
          { fieldId: "Page1.SecA_Patient.RepAdverse", shortLabel: "Adverse event" },
          { fieldId: "Page1.SecA_Patient.RepError", shortLabel: "Product use error" },
          { fieldId: "Page1.SecA_Patient.Defects", shortLabel: "Product problem" },
        ],
      },
      {
        label: "Outcomes attributed to the adverse event",
        options: [
          { fieldId: "Page1.SecA_Patient.Hospital", shortLabel: "Hospitalization" },
          { fieldId: "Page1.SecA_Patient.LifeThreaten", shortLabel: "Life-threatening" },
          { fieldId: "Page1.SecA_Patient.Disability", shortLabel: "Disability" },
          { fieldId: "Page1.SecA_Patient.ReqdInter", shortLabel: "Required intervention" },
          { fieldId: "Page1.SecA_Patient.Death", shortLabel: "Death" },
        ],
      },
    ],
    fields: [field("Page1.SecA_Patient.EventDate", "Date of event"), field("Page1.SecA_Patient.ReportDate", "Date of report")],
    textBlockFieldId: "Page2.SecB_Adverse.DescEvent",
  },
  {
    section: "D",
    fields: [
      { shortLabel: "Name, strength, manufacturer", render: productIdentity },
      { shortLabel: "Dose", render: doseWithUnitAndFrequency },
      field("Page4.Prod1.Prod1Route", "Route"),
      field("Page4.Prod1.Prod1TherapyStartDate", "Therapy start"),
      field("Page4.Prod1.Prod1TherapyStopDate", "Therapy stop"),
      field("Page4.Prod1.Prod1LotNum", "Lot #"),
    ],
    checkboxGroups: [
      {
        label: "Event abated after stopping?",
        options: [
          { fieldId: "Page4.Prod1.Prod1AbatedYes", shortLabel: "Yes" },
          { fieldId: "Page4.Prod1.Prod1AbatedNo", shortLabel: "No" },
        ],
      },
    ],
  },
  {
    section: "G",
    fields: [
      field("Page7.SecG_Reporter.LastName", "Last name"),
      field("Page7.SecG_Reporter.FirstName", "First name"),
      field("Page7.SecG_Reporter.Occupation", "Occupation"),
      field("Page7.SecG_Reporter.PhoneNum", "Phone"),
    ],
  },
];

function renderCheckboxGroups(groups: CheckboxGroup[] | undefined, record: AgendaRecord) {
  return groups?.map((group) => (
    <div key={group.label} className="report-facsimile__checkbox-group">
      <span className="report-facsimile__checkbox-group-label">{group.label}</span>
      <div className="report-facsimile__checkbox-options">
        {group.options.map(({ fieldId, shortLabel }) => {
          const { text } = displayFor(record, fieldId);
          return (
            <span
              key={fieldId}
              className={
                text
                  ? "report-facsimile__checkbox-option report-facsimile__checkbox-option--checked"
                  : "report-facsimile__checkbox-option"
              }
            >
              {text ? "✓ " : ""}
              {shortLabel}
            </span>
          );
        })}
      </div>
    </div>
  ));
}

interface FacsimileProps {
  record: AgendaRecord;
  counts: RecordCounts;
}

export function Facsimile({ record, counts }: FacsimileProps) {
  // `counts` is computed from the STAMPED record (ReportChrome.tsx), so
  // rule 4's auto ReportDate is on the paper below from the first render
  // — excluded from `counts` itself since #127, but still printed. A
  // "nothing written"/"nothing written yet" claim here would sit right
  // above a paper already showing DATE OF REPORT, which is exactly the
  // dishonesty ask-copy.md rule 8's #127 amendment reverses PR #107's nit
  // a to fix: this caption describes what the CLINICIAN supplied, not
  // whether the paper is blank (it isn't).
  const nothingWritten = counts.written === 0 && counts.unknown === 0;

  return (
    <aside className="report-facsimile" aria-label="Form FDA 3500 preview">
      <div className="report-facsimile__header">
        <span className="report-facsimile__title">Form FDA 3500</span>
        <span className="report-facsimile__status">
          {nothingWritten ? "none from you yet" : formatFieldCounts(counts)}
        </span>
        <span className="report-facsimile__preview-label">Preview</span>
      </div>
      <div className="report-facsimile__paper">
        <p className="report-facsimile__masthead">MedWatch</p>
        {nothingWritten && (
          <p className="report-facsimile__empty">
            {FORM_3500_FIELDS.length} items, none from you yet. Everything here comes from what you say.
          </p>
        )}
        {SECTIONS.map(({ section, fields, checkboxGroups, textBlockFieldId, checkboxGroupsFirst }) => (
          <div key={section} className="report-facsimile__section">
            <h3 className="report-facsimile__section-title">
              {section}. {FORM_3500_SECTIONS[section]}
            </h3>
            {checkboxGroupsFirst && renderCheckboxGroups(checkboxGroups, record)}
            {fields && fields.length > 0 && (
              <div className="report-facsimile__grid">
                {fields.map(({ shortLabel, render }) => {
                  const { text, muted } = render(record);
                  return (
                    <div key={shortLabel} className="report-facsimile__field">
                      <span className="report-facsimile__field-label">{shortLabel}</span>
                      <span
                        className={
                          muted
                            ? "report-facsimile__field-value report-facsimile__field-value--muted"
                            : "report-facsimile__field-value"
                        }
                      >
                        {text ?? "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {!checkboxGroupsFirst && renderCheckboxGroups(checkboxGroups, record)}
            {textBlockFieldId &&
              (() => {
                const { text, muted } = displayFor(record, textBlockFieldId);
                return (
                  <p
                    className={
                      muted ? "report-facsimile__text-block report-facsimile__text-block--muted" : "report-facsimile__text-block"
                    }
                  >
                    {text ?? "—"}
                  </p>
                );
              })()}
          </div>
        ))}
      </div>
      <p className="report-facsimile__disclosure">
        Showing selected fields from sections A, B, D, and G — the full {FORM_3500_FIELDS.length}-field form is
        generated at Review.
      </p>
    </aside>
  );
}
