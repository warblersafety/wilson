// The right-hand Form FDA 3500 facsimile (Issue #67, design.md "The
// report chrome"): "an HTML rendering derived from the same
// field-mapping source the PDF exporter uses... labeled as a preview,
// honest about partial coverage, and never itself the sign-off artifact
// (the real PDF stays Review/Ready's on-demand artifact)."
//
// Curated, not exhaustive — a deliberate, enumerated deviation, not a
// silent gap: this preview shows a representative subset of fields from
// sections A, B, D, and G (matching what screens 01/04/05 themselves
// show), not all 227. Sections C, E, F (product availability, device,
// concomitant meds) are in the left rail's rollup but not curated here;
// the disclosure line at the bottom says so, and the real, complete PDF
// stays generated on demand at Review. Section D always shows suspect
// product #1 specifically, regardless of how many products the record
// carries — the same simplification the mockups themselves make; every
// product is in the exported PDF and the left rail either way.
import type { AgendaRecord } from "@/lib/agenda";
import { facsimileValue } from "@/lib/form-3500-facsimile";
import { FORM_3500_FIELDS, FORM_3500_SECTIONS, type FormFieldSpec, type FormSection } from "@/lib/form-3500-fields";
import type { RecordCounts } from "@/lib/report-chrome";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

interface CheckboxOption {
  fieldId: string;
  shortLabel: string;
}

interface CheckboxGroup {
  label: string;
  options: CheckboxOption[];
}

interface FieldRow {
  fieldId: string;
  shortLabel: string;
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
      { fieldId: "Page1.SecA_Patient.PatientIdentifier", shortLabel: "Patient identifier" },
      { fieldId: "Page1.SecA_Patient.AgeValue", shortLabel: "Age" },
      { fieldId: "Page1.SecA_Patient.WeightValue", shortLabel: "Weight" },
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
    fields: [
      { fieldId: "Page1.SecA_Patient.EventDate", shortLabel: "Date of event" },
      { fieldId: "Page1.SecA_Patient.ReportDate", shortLabel: "Date of report" },
    ],
    textBlockFieldId: "Page2.SecB_Adverse.DescEvent",
  },
  {
    section: "D",
    fields: [
      { fieldId: "Page4.Prod1.Prod1Name", shortLabel: "Name, strength, manufacturer" },
      { fieldId: "Page4.Prod1.Prod1Dose", shortLabel: "Dose" },
      { fieldId: "Page4.Prod1.Prod1Route", shortLabel: "Route" },
      { fieldId: "Page4.Prod1.Prod1TherapyStartDate", shortLabel: "Therapy start" },
      { fieldId: "Page4.Prod1.Prod1TherapyStopDate", shortLabel: "Therapy stop" },
      { fieldId: "Page4.Prod1.Prod1LotNum", shortLabel: "Lot #" },
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
      { fieldId: "Page7.SecG_Reporter.LastName", shortLabel: "Last name" },
      { fieldId: "Page7.SecG_Reporter.FirstName", shortLabel: "First name" },
      { fieldId: "Page7.SecG_Reporter.Occupation", shortLabel: "Occupation" },
      { fieldId: "Page7.SecG_Reporter.PhoneNum", shortLabel: "Phone" },
    ],
  },
];

// muted mirrors the underlying STATE (unknown/declined), never the
// string content — a clinician dictating the literal word "unknown"
// into a text field must not pick up the sentinel's own styling.
function displayFor(record: AgendaRecord, fieldId: string): { text: string | null; muted: boolean } {
  const field = FIELDS_BY_ID.get(fieldId);
  if (!field) return { text: null, muted: false };
  const entry = record[fieldId];
  const value = facsimileValue(field, entry);
  if (value === null) return { text: null, muted: false };
  if (typeof value === "boolean") return { text: value ? "Yes" : null, muted: false };
  const state = entry?.state ?? "unasked";
  return { text: value, muted: state === "unknown" || state === "declined" };
}

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
  const nothingWritten = counts.written === 0 && counts.unknown === 0;

  return (
    <aside className="report-facsimile" aria-label="Form FDA 3500 preview">
      <div className="report-facsimile__header">
        <span className="report-facsimile__title">Form FDA 3500</span>
        <span className="report-facsimile__status">
          {nothingWritten ? "nothing written yet" : `${counts.written} fields written · ${counts.unknown} unknown`}
        </span>
        <span className="report-facsimile__preview-label">Preview</span>
      </div>
      <div className="report-facsimile__paper">
        <p className="report-facsimile__masthead">MedWatch</p>
        {nothingWritten ? (
          <p className="report-facsimile__empty">
            {FORM_3500_FIELDS.length} fields, nothing written yet. Everything here comes from what you say.
          </p>
        ) : (
          SECTIONS.map(({ section, fields, checkboxGroups, textBlockFieldId, checkboxGroupsFirst }) => (
            <div key={section} className="report-facsimile__section">
              <h3 className="report-facsimile__section-title">
                {section}. {FORM_3500_SECTIONS[section]}
              </h3>
              {checkboxGroupsFirst && renderCheckboxGroups(checkboxGroups, record)}
              {fields && fields.length > 0 && (
                <div className="report-facsimile__grid">
                  {fields.map(({ fieldId, shortLabel }) => {
                    const { text, muted } = displayFor(record, fieldId);
                    return (
                      <div key={fieldId} className="report-facsimile__field">
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
                        muted ? "report-facsimile__text-block report-facsimile__field-value--muted" : "report-facsimile__text-block"
                      }
                    >
                      {text ?? "—"}
                    </p>
                  );
                })()}
            </div>
          ))
        )}
      </div>
      <p className="report-facsimile__disclosure">
        Showing selected fields from sections A, B, D, and G — the full {FORM_3500_FIELDS.length}-field form is
        generated at Review.
      </p>
    </aside>
  );
}
